import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeInstagram, parseHandles } from "@/lib/dating";
import { IntakeError, object, string } from "@/lib/dating-intake/contracts";
import { json, lockOwner, type Tx } from "@/lib/dating-intake/store";
import { resolveIdentity } from "@/lib/dating-intake/review";

export type ContactLookupStatus =
  | "pending"
  | "matched"
  | "ambiguous"
  | "not_found"
  | "unavailable"
  | "insufficient_name";
export type ContactLookupCandidate = {
  name: string;
  phones: string[];
  emails: string[];
  instagram?: string;
};
export type ContactLookup = {
  status: ContactLookupStatus;
  name: string;
  checkedAt: string | null;
  messagesCheckedAt: string | null;
  messagesError: boolean;
  candidates: ContactLookupCandidate[];
};
type StoredLookup = ContactLookup & { handles?: string[] };
const sameHandles = (a: string[] = [], b: string[] = []) =>
  a.length === b.length &&
  [...a].sort().every((value, index) => value === [...b].sort()[index]);
export const contactNameKey = (name: string) =>
  name.normalize("NFKC").toLowerCase().trim().replace(/\s+/gu, " ");
const phone = /^\+[1-9]\d{6,14}$/;
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function contactHandles(input: unknown): string[] {
  if (
    !Array.isArray(input) ||
    input.length > 20 ||
    input.some((v) => typeof v !== "string" || v.length > 254)
  )
    throw new IntakeError("Invalid contact details");
  return parseHandles(input).filter((h) => phone.test(h) || email.test(h));
}
export function contactCandidates(input: unknown): ContactLookupCandidate[] {
  if (!Array.isArray(input) || input.length > 5)
    throw new IntakeError("At most five contact matches are allowed");
  return input.map((value) => {
    const candidate = object(value);
    const name = string(candidate.name, 200).trim();
    const phones = contactHandles(candidate.phones ?? []).filter((h) =>
      phone.test(h),
    );
    const emails = contactHandles(candidate.emails ?? []).filter((h) =>
      email.test(h),
    );
    if (!name || (!phones.length && !emails.length))
      throw new IntakeError("Each match needs a name and contact details");
    contactHandles([...phones, ...emails]);
    const instagram = normalizeInstagram(candidate.instagram);
    return { name, phones, emails, ...(instagram ? { instagram } : {}) };
  });
}
const candidateKey = (candidates: ContactLookupCandidate[]) =>
  JSON.stringify(
    candidates.map((c) => [
      c.name,
      [...c.phones].sort(),
      [...c.emails].sort(),
      c.instagram ?? null,
    ]),
  );
const stateKey = (userId: string) => ({
  userId_source_scope: { userId, source: "texts", scope: "default" },
});
async function readSaved(tx: Tx, userId: string, personId: string) {
  const state = await tx.datingSourceState.findUnique({
    where: stateKey(userId),
  });
  return {
    state,
    saved: object(object(state?.config ?? {}).contactLookups ?? {})[
      personId
    ] as StoredLookup | undefined,
  };
}
// All writers merge under the same owner lock used by source settings/discovery.
async function saveLookup(
  tx: Tx,
  userId: string,
  personId: string,
  lookup: StoredLookup | null,
) {
  const { state } = await readSaved(tx, userId, personId);
  const config = object(state?.config ?? {});
  const lookups = { ...object(config.contactLookups ?? {}) };
  const people = await tx.datingPerson.findMany({
    where: { userId },
    select: { id: true },
  });
  const owned = new Set(people.map((p) => p.id));
  for (const id of Object.keys(lookups)) if (!owned.has(id)) delete lookups[id];
  if (lookup) lookups[personId] = lookup;
  else delete lookups[personId];
  await tx.datingSourceState.upsert({
    where: stateKey(userId),
    create: {
      userId,
      source: "texts",
      scope: "default",
      enabled: false,
      config: json({ contactLookups: lookups }),
    },
    update: { config: json({ ...config, contactLookups: lookups }) },
  });
}
function nextCheckedAt(previous?: ContactLookup) {
  return new Date(
    Math.max(Date.now(), (Date.parse(previous?.checkedAt ?? "") || 0) + 1),
  ).toISOString();
}
async function currentPerson(
  tx: Tx,
  userId: string,
  personId: string,
  name?: string,
) {
  const person = await tx.datingPerson.findFirst({
    where: { id: personId, userId },
    select: { id: true, name: true, handles: true, lastMessageAt: true },
  });
  if (!person) throw new IntakeError("not found", 404);
  if (name !== undefined && name !== person.name)
    throw new IntakeError("Name changed; match again", 409);
  return person;
}
async function attach(
  tx: Tx,
  userId: string,
  person: { id: string; name: string; handles: string[] },
  handles: string[],
  automatic: boolean,
) {
  if (person.handles.length) return { resolved: false, reason: "already_set" };
  if (automatic) {
    const all = await tx.datingPerson.findMany({
      where: { userId },
      select: { id: true, name: true },
    });
    if (
      all.some(
        (p) =>
          p.id !== person.id &&
          contactNameKey(p.name) === contactNameKey(person.name),
      )
    )
      return { resolved: false, reason: "ambiguous_name" };
  }
  const identity = await resolveIdentity(tx, userId, handles);
  if (
    identity.excluded ||
    (identity.personId && identity.personId !== person.id)
  )
    return { resolved: false, reason: "shared_contact" };
  const result = await tx.datingPerson.updateMany({
    where: {
      id: person.id,
      userId,
      name: person.name,
      handles: { isEmpty: true },
    },
    data: { handles, insights: Prisma.DbNull, insightsAt: null },
  });
  if (result.count) {
    const { saved } = await readSaved(tx, userId, person.id);
    await saveLookup(tx, userId, person.id, {
      status: "matched",
      name: person.name,
      checkedAt: nextCheckedAt(saved),
      messagesCheckedAt: null,
      messagesError: false,
      candidates: [],
      handles,
    });
  }
  return { resolved: result.count === 1 };
}
export async function recordContactLookup(userId: string, input: unknown) {
  const body = object(input);
  const personId = string(body.personId, 200);
  const name = string(body.name, 200);
  const messageReport =
    body.status === "messages_checked" ||
    body.status === "messages_unavailable";
  const hasHandles = body.handles !== undefined;
  if (messageReport && !hasHandles)
    throw new IntakeError("Message checks require contact details");
  const handles = hasHandles ? contactHandles(body.handles) : [];
  if (hasHandles && !handles.length)
    throw new IntakeError("No valid contact details");
  const allowed = [
    "ambiguous",
    "not_found",
    "unavailable",
    "insufficient_name",
  ] as const;
  if (!hasHandles && !allowed.includes(body.status as (typeof allowed)[number]))
    throw new IntakeError("Invalid contact lookup status");
  const candidates = hasHandles ? [] : contactCandidates(body.candidates ?? []);
  if (
    !hasHandles &&
    (body.status === "ambiguous"
      ? candidates.length === 0
      : candidates.length !== 0)
  )
    throw new IntakeError(
      "Contact matches are only allowed for an ambiguous lookup",
    );
  return prisma.$transaction(async (tx) => {
    await lockOwner(tx, userId);
    const person = await currentPerson(tx, userId, personId, name);
    if (messageReport) {
      if (!sameHandles(person.handles, handles))
        throw new IntakeError(
          "Contact details changed; check messages again",
          409,
        );
      const { saved } = await readSaved(tx, userId, personId);
      const current =
        saved?.name === name && sameHandles(saved.handles, handles)
          ? saved
          : undefined;
      await saveLookup(tx, userId, personId, {
        status: "matched",
        name,
        checkedAt: current?.checkedAt ?? new Date().toISOString(),
        messagesCheckedAt:
          body.status === "messages_checked"
            ? new Date().toISOString()
            : (current?.messagesCheckedAt ?? null),
        messagesError: body.status === "messages_unavailable",
        candidates: [],
        handles,
      });
      return { resolved: true, recorded: true };
    }
    if (hasHandles) return attach(tx, userId, person, handles, true);
    if (person.handles.length)
      return { resolved: false, reason: "already_set" };
    const { saved } = await readSaved(tx, userId, personId);
    const unchanged =
      saved?.name === name &&
      saved.status === body.status &&
      candidateKey(saved.candidates) === candidateKey(candidates);
    await saveLookup(tx, userId, personId, {
      status: body.status as ContactLookupStatus,
      name,
      checkedAt: unchanged ? saved.checkedAt : nextCheckedAt(saved),
      messagesCheckedAt: null,
      messagesError: false,
      candidates,
    });
    return { resolved: false, recorded: true };
  });
}
export async function getContactLookup(userId: string, personId: string) {
  return prisma.$transaction(async (tx) => {
    await lockOwner(tx, userId);
    const person = await currentPerson(tx, userId, personId);
    const { saved } = await readSaved(tx, userId, personId);
    const current = saved?.name === person.name ? saved : undefined;
    const lookup: ContactLookup = person.handles.length
      ? {
          status: "matched",
          name: person.name,
          checkedAt:
            (current?.status === "matched" || current?.status === "pending") &&
            sameHandles(current.handles, person.handles)
              ? current.checkedAt
              : null,
          messagesCheckedAt:
            current?.status === "matched" &&
            sameHandles(current.handles, person.handles)
              ? current.messagesCheckedAt
              : null,
          messagesError:
            current?.status === "matched" &&
            sameHandles(current.handles, person.handles)
              ? current.messagesError
              : false,
          candidates: [],
        }
      : ((current?.status !== "matched" ? current : undefined) ?? {
          status: "pending",
          name: person.name,
          checkedAt: null,
          messagesCheckedAt: null,
          messagesError: false,
          candidates: [],
        });
    const messageCount = await tx.datingMessage.count({
      where: { userId, personId },
    });
    return {
      lookup,
      messageCount,
      lastMessageAt: person.lastMessageAt?.toISOString() ?? null,
    };
  });
}
export async function actOnContactLookup(
  userId: string,
  personId: string,
  input: unknown,
) {
  const body = object(input);
  if (body.action !== "retry" && body.action !== "choose")
    throw new IntakeError("Invalid contact action");
  return prisma.$transaction(async (tx) => {
    await lockOwner(tx, userId);
    const person = await currentPerson(tx, userId, personId);
    if (body.action === "retry") {
      const { saved } = await readSaved(tx, userId, personId);
      await saveLookup(
        tx,
        userId,
        personId,
        person.handles.length
          ? {
              status: "pending",
              name: person.name,
              handles: person.handles,
              checkedAt: nextCheckedAt(saved),
              messagesCheckedAt: null,
              messagesError: false,
              candidates: [],
            }
          : null,
      );
      return { ok: true };
    }
    const { saved } = await readSaved(tx, userId, personId);
    if (
      !saved ||
      saved.name !== person.name ||
      saved.status !== "ambiguous" ||
      typeof body.checkedAt !== "string" ||
      saved.checkedAt !== body.checkedAt
    )
      throw new IntakeError(
        "These matches changed. Refresh and choose again.",
        409,
      );
    if (
      !Number.isInteger(body.index) ||
      (body.index as number) < 0 ||
      (body.index as number) >= saved.candidates.length
    )
      throw new IntakeError("Invalid contact choice");
    const candidate = saved.candidates[body.index as number];
    const handles = contactHandles([...candidate.phones, ...candidate.emails]);
    if (!handles.length) throw new IntakeError("No valid contact details");
    const result = await attach(tx, userId, person, handles, false);
    if (!result.resolved)
      throw new IntakeError(
        result.reason === "shared_contact"
          ? "These contact details belong to another profile or an excluded person."
          : "Contact details changed. Refresh this person.",
        409,
      );
    return { ok: true, resolved: true };
  });
}

/** A durable retry signal lets the Mac rescan an unchanged, already-resolved contact. */
export async function getContactMessageRetries(userId: string) {
  return prisma.$transaction(async (tx) => {
    await lockOwner(tx, userId);
    const state = await tx.datingSourceState.findUnique({
      where: stateKey(userId),
    });
    const lookups = object(object(state?.config ?? {}).contactLookups ?? {});
    const people = await tx.datingPerson.findMany({
      where: { userId, handles: { isEmpty: false } },
      select: { id: true, name: true, handles: true },
    });
    return people.filter((person) => {
      const saved = lookups[person.id] as StoredLookup | undefined;
      return (
        saved?.status === "pending" &&
        saved.name === person.name &&
        sameHandles(saved.handles, person.handles)
      );
    });
  });
}
