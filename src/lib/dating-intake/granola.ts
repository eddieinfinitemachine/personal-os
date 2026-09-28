import { granolaMeetingsDone } from "@/lib/dating-filer";
import { prisma } from "@/lib/prisma";
import { granolaFromEnv, granolaNoteText, type GranolaClient, type GranolaNote } from "@/lib/granola";
import { acceptRecord, json, lockOwner, updateHealth } from "./store";
import { hash, segments, IntakeError, type Envelope } from "./contracts";

const DAY = 86_400_000;
type Task = { id: string; attempts: number; retryAt: number };
export type GranolaCursor = {
  adapter: "granola-v1"; since: string; pageCursor: string | null; enumerated: boolean;
  queue: Task[]; adapterBacklog: number; adapterError: string | null; sweepStartedAt: string;
};
export function granolaCursor(raw: unknown, now: number): GranolaCursor {
  const value = raw as Partial<GranolaCursor> | null;
  if (value?.adapter === "granola-v1" && typeof value.since === "string" && Number.isFinite(Date.parse(value.since)) && Array.isArray(value.queue)) {
    return { ...value, queue: value.queue.filter((task) => typeof task.id === "string" && Number.isFinite(task.attempts) && Number.isFinite(task.retryAt)) } as GranolaCursor;
  }
  return { adapter: "granola-v1", since: new Date(now - 10 * DAY).toISOString(), pageCursor: null, enumerated: false, queue: [], adapterBacklog: 1, adapterError: null, sweepStartedAt: new Date(now).toISOString() };
}
/** Persist page IDs and the next cursor in a single save before fetching content. */
export async function runGranolaQueue(cursor: GranolaCursor, options: {
  client: GranolaClient; save: (cursor: GranolaCursor) => Promise<void>;
  upload: (note: GranolaNote) => Promise<boolean>; now?: () => number; maxMs?: number; maxNotes?: number; ownerEmail?: string;
}) {
  const now = options.now ?? Date.now;
  const deadline = now() + Math.max(0, Math.min(options.maxMs ?? 45_000, 45_000));
  const limit = Math.max(0, Math.min(options.maxNotes ?? 6, 6));
  let attempted = 0;
  const persist = async () => {
    cursor.adapterBacklog = cursor.queue.length + (cursor.enumerated ? 0 : 1);
    await options.save(structuredClone(cursor));
  };
  // A completed sweep starts another recent update sweep. Failed old tasks never expire from this queue.
  if (cursor.enumerated && cursor.queue.every((task) => task.attempts > 0)) {
    cursor = { ...granolaCursor(null, now()), queue: cursor.queue };
  }
  if (!cursor.enumerated && cursor.queue.length < 30 && now() < deadline) {
    try {
      if (!options.client.listNotesPage) throw new Error("Paged Granola client required");
      const page = await options.client.listNotesPage({ createdAfter: new Date(cursor.since), cursor: cursor.pageCursor ?? undefined });
      if (page.notes.length > 30 || (page.hasMore && (!page.cursor || page.cursor === cursor.pageCursor))) throw new Error("Invalid page");
      const known = new Set(cursor.queue.map((task) => task.id));
      for (const note of page.notes) {
        if (known.has(note.id) || (options.ownerEmail && note.owner?.email?.toLowerCase() !== options.ownerEmail.toLowerCase())) continue;
        known.add(note.id); cursor.queue.push({ id: note.id, attempts: 0, retryAt: 0 });
      }
      cursor.pageCursor = page.cursor;
      cursor.enumerated = !page.hasMore;
      cursor.adapterError = null;
      await persist();
    } catch {
      cursor.adapterError = "Granola could not list meeting notes. The saved position will retry.";
      await persist();
      // Received older tasks can still progress when enumeration fails.
    }
  }
  for (const task of [...cursor.queue]) {
    if (attempted >= limit || now() >= deadline) break;
    if (task.retryAt > now()) continue;
    attempted++;
    try {
      const note = await options.client.getNote(task.id, { transcript: true });
      if (note.id !== task.id) throw new Error("Wrong note returned");
      if (!options.ownerEmail || note.owner?.email?.toLowerCase() === options.ownerEmail.toLowerCase()) {
        if (!await options.upload(note)) { await persist(); break; }
      }
      cursor.queue = cursor.queue.filter((item) => item.id !== task.id);
    } catch {
      task.attempts++;
      task.retryAt = now() + Math.min(3_600_000, 30_000 * 2 ** Math.min(task.attempts, 7));
    }
    if (cursor.queue.some((item) => item.attempts > 0)) cursor.adapterError = "Some Granola notes could not be imported. Saved work will retry, including older notes.";
    else if (cursor.enumerated) cursor.adapterError = null;
    await persist();
  }
  await persist();
  return { attempted, remaining: cursor.adapterBacklog, complete: cursor.enumerated && !cursor.queue.length, cursor };
}

/** Never truncate a transcript; oversized documents fail visibly and remain queued. */
export function granolaEnvelopes(note: GranolaNote, documentVersion: number): Envelope[] {
  const text = `Meeting: ${note.title ?? "Granola meeting"}\nSource date: ${note.calendar_event?.scheduled_start_time || note.created_at || "unknown"}\nSource link: ${note.web_url || ""}\n\n${granolaNoteText(note, Infinity)}`;
  const parts = segments(text);
  const occurredAt = note.calendar_event?.scheduled_start_time || note.created_at || null;
  return parts.map((part, segmentIndex) => ({ version: 1, externalId: note.id, revision: hash(text), documentVersion,
    segmentIndex, segmentCount: parts.length, text: part, title: note.title?.trim().slice(0, 200) || "Granola meeting",
    occurredAt, url: note.web_url?.startsWith("https://") ? note.web_url : null, identities: [], evidenceFamily: `granola:${note.id}`,
  }));
}

export async function syncGranolaIntake(userId: string, stateId: string, options: { client?: GranolaClient; maxMs?: number; maxNotes?: number; ownerEmail?: string; since?: Date } = {}) {
  const maxMs = Math.max(1, Math.min(options.maxMs ?? 45_000, 45_000));
  const started = Date.now();
  const client = options.client ?? granolaFromEnv({ signal: AbortSignal.timeout(maxMs) });
  if (!client) throw new IntakeError("Granola is not configured", 503);
  const state = await prisma.$transaction(async (tx) => {
    await lockOwner(tx, userId);
    const source = await tx.datingSourceState.findFirst({ where: { id: stateId, userId, source: "granola", enabled: true } });
    if (!source) return null;
    if (source.leaseUntil && source.leaseUntil.getTime() > Date.now()) {
      if (options.since && options.since.getTime() < Date.parse(granolaCursor(source.cursor, started).since)) throw new IntakeError("Granola is already checking notes. Try this earlier import again shortly.", 409);
      return null;
    }
    return tx.datingSourceState.update({ where: { id: stateId }, data: { version: { increment: 1 }, leaseUntil: new Date(Date.now() + 90_000), lastAttemptAt: new Date(), status: "checking" } });
  });
  if (!state) return { skipped: true, attempted: 0, remaining: 0 };
  const save = async (cursor: GranolaCursor) => prisma.$transaction(async (tx) => {
    await lockOwner(tx, userId);
    const complete = cursor.enumerated && !cursor.queue.length;
    const changed = await tx.datingSourceState.updateMany({ where: { id: stateId, userId, enabled: true, version: state.version }, data: {
      cursor: json(cursor), manifest: json({ complete }), lastAttemptAt: new Date(),
      ...(complete ? { coverageStart: new Date(cursor.since), coverageEnd: new Date(cursor.sweepStartedAt) } : {}),
    } });
    if (!changed.count) throw new IntakeError("Source changed during sync", 409);
    await updateHealth(tx, userId, stateId);
  });
  try {
    let cursor = granolaCursor(state.cursor, started);
    if (options.since && options.since.getTime() < Date.parse(cursor.since)) {
      // An explicit earlier import widens enumeration while retaining every queued failure.
      cursor = { ...cursor, since: options.since.toISOString(), pageCursor: null, enumerated: false, sweepStartedAt: new Date(started).toISOString() };
    }
    return await runGranolaQueue(cursor, {
      client, save, maxNotes: options.maxNotes, maxMs: Math.max(0, maxMs - (Date.now() - started)), ownerEmail: options.ownerEmail ?? process.env.GRANOLA_OWNER_EMAIL,
      upload: async (note) => {
        const initial = granolaEnvelopes(note, 1);
        const latest = await prisma.datingSourceRecord.findFirst({ where: { userId, stateId, externalId: note.id }, orderBy: { documentVersion: "desc" } });
        // Retain only a hash baseline for already-filed legacy meetings; future edits get a normal new revision.
        if (!latest && (await granolaMeetingsDone(userId, [note.id])).has(note.id)) {
          await prisma.$transaction(async (tx) => {
            await lockOwner(tx, userId);
            const current = await tx.datingSourceState.findFirst({ where: { id: stateId, userId, enabled: true, version: state.version } });
            if (!current) throw new IntakeError("Source changed during sync", 409);
            await tx.datingSourceRecord.createMany({ data: initial.map((entry) => ({ userId, stateId, source: "granola", externalId: entry.externalId, revision: entry.revision, documentVersion: 1, segmentIndex: entry.segmentIndex, segmentCount: entry.segmentCount, title: entry.title, url: entry.url, occurredAt: entry.occurredAt ? new Date(entry.occurredAt) : null, evidenceFamily: entry.evidenceFamily, status: "processed" })), skipDuplicates: true });
          });
          return true;
        }
        const version = latest ? latest.revision === initial[0].revision && !["withdrawn", "superseded"].includes(latest.status) ? latest.documentVersion : latest.documentVersion + 1 : 1;
        const accepted = await prisma.datingSourceRecord.findMany({ where: { userId, stateId, externalId: note.id, revision: initial[0].revision, documentVersion: version, status: { notIn: ["expired", "superseded", "withdrawn"] } }, select: { segmentIndex: true } });
        const done = new Set(accepted.map((record) => record.segmentIndex));
        for (const envelope of initial) {
          if (done.has(envelope.segmentIndex)) continue;
          if (Date.now() - started >= maxMs) return false;
          await acceptRecord(userId, stateId, { ...envelope, documentVersion: version });
        }
        return true;
      },
    });
  } finally {
    await prisma.datingSourceState.updateMany({ where: { id: stateId, userId, version: state.version }, data: { leaseUntil: null } });
  }
}
