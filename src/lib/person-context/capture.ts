import { IntakeError } from "@/lib/dating-intake/contracts";
import { normalizeHandle, personName } from "@/lib/call-sheet/policy";
import { prisma } from "@/lib/prisma";
import { CONTEXT_LIMITS, type ContextThread, type PersonContext } from "./types";

const DAY = 86_400_000;
// Clock skew between the Mac and the server.
const SKEW_MS = 5 * 60_000;

export type ContextCapture = { personId: string; threads: ContextThread[]; force: boolean };

const fail = (message: string): never => {
  throw new IntakeError(message, 400);
};

/** Strictly validate a Mac POST. Rejects (400) rather than trims: the Mac bounds before sending. */
export function parseContextCapture(input: unknown, now = new Date()): ContextCapture {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Invalid body");
  const body = input as Record<string, unknown>;
  const personId = body.personId;
  if (typeof personId !== "string" || !personId.trim() || personId.length > 200) fail("personId required");
  if (body.force !== undefined && typeof body.force !== "boolean") fail("force must be a boolean");
  if (!Array.isArray(body.threads) || body.threads.length > 2) fail("threads must be an array of at most 2");
  const earliest = now.getTime() - CONTEXT_LIMITS.threadDays * DAY - DAY;
  const latest = now.getTime() + SKEW_MS;
  const sources = new Set<string>();
  const ids = new Set<string>();
  let count = 0;
  let chars = 0;
  const threads = (body.threads as unknown[]).map((raw): ContextThread => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("Invalid thread");
    const t = raw as Record<string, unknown>;
    if (t.source !== "imessage" && t.source !== "whatsapp") fail("Invalid thread source");
    if (sources.has(t.source as string)) fail("Duplicate thread source");
    sources.add(t.source as string);
    if (!Array.isArray(t.messages)) fail("Invalid thread messages");
    const messages = (t.messages as unknown[]).map((rawMessage) => {
      if (!rawMessage || typeof rawMessage !== "object" || Array.isArray(rawMessage)) fail("Invalid message");
      const m = rawMessage as Record<string, unknown>;
      if (typeof m.id !== "string" || !m.id || m.id.length > 200) fail("Invalid message id");
      if (typeof m.text !== "string" || m.text.length > CONTEXT_LIMITS.maxCharsPerMessage) fail("Invalid message text");
      if (typeof m.fromMe !== "boolean") fail("Invalid message sender");
      const sentAt = typeof m.sentAt === "string" ? Date.parse(m.sentAt) : NaN;
      if (!Number.isFinite(sentAt) || sentAt < earliest || sentAt > latest) fail("Message date out of range");
      const key = `${t.source}:${m.id}`;
      if (ids.has(key)) fail("Duplicate message id");
      ids.add(key);
      count++;
      chars += (m.text as string).length;
      return { id: m.id as string, sentAt: new Date(sentAt).toISOString(), fromMe: m.fromMe as boolean, text: m.text as string };
    });
    return { source: t.source as ContextThread["source"], messages };
  });
  if (count > CONTEXT_LIMITS.maxMessagesPerPerson) fail("Too many messages");
  if (chars > CONTEXT_LIMITS.maxThreadChars) fail("Threads too long");
  return { personId: (personId as string).trim(), threads, force: body.force === true };
}

export type ContextTargets = {
  people: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    contextAt: string | null;
    fingerprint: string | null;
  }[];
  blockedHandles: string[];
};

/** Active people for the Mac, plus handles it must not read (shared, or owned by an archived person). */
export async function contextTargets(userId: string): Promise<ContextTargets> {
  const people = await prisma.person.findMany({
    where: { userId },
    orderBy: { id: "asc" },
    select: { id: true, firstName: true, lastName: true, phone: true, email: true, archived: true, context: true, contextAt: true },
  });
  const owners = new Map<string, Set<string>>();
  for (const person of people)
    for (const raw of [person.phone, person.email]) {
      const handle = normalizeHandle(raw ?? "");
      if (!handle) continue;
      if (!owners.has(handle)) owners.set(handle, new Set());
      owners.get(handle)!.add(person.id);
    }
  const archived = new Set(people.filter((p) => p.archived).map((p) => p.id));
  return {
    people: people
      .filter((p) => !p.archived)
      .map((p) => {
        const context = p.context as Partial<PersonContext> | null;
        return {
          id: p.id,
          name: personName(p),
          phone: p.phone,
          email: p.email,
          contextAt: p.contextAt?.toISOString() ?? null,
          fingerprint: typeof context?.sourceFingerprint === "string" ? context.sourceFingerprint : null,
        };
      }),
    blockedHandles: [...owners]
      .filter(([, ids]) => ids.size > 1 || [...ids].some((id) => archived.has(id)))
      .map(([handle]) => handle)
      .sort(),
  };
}
