import { REACH_OUT_METHODS, isReachOutMethod } from "./reach-out";
import { randomUUID } from "node:crypto";
import {
  Prisma,
  type CallSheetContact,
  type CallSheetDay,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { IntakeError, object } from "@/lib/dating-intake/contracts";
import {
  cadence,
  identityKey,
  latestContact,
  liveCues,
  limitPersonCues,
  relationshipCategory,
  localDate,
  NO_CONTACT_REASON,
  personName,
  rankCandidates,
  reviewQueue,
  selectCandidates,
  snoozeUntil,
  SOURCES,
  validTimezone,
  type Candidate,
  type PolicyPerson,
} from "./policy";
import type {
  CallSheetEntry,
  CallSheetMutation,
  CallSheetResponse,
  CallSheetReview,
  CallSheetReviewDecision,
  CallSheetSettingsMutation,
  CallSheetSource,
  ContactSourceData,
  SourceHealth,
} from "./types";

export type Tx = Prisma.TransactionClient;
export type InternalHealth = SourceHealth & {
  epoch: string;
  attemptAt?: string;
};
export type SourceState = Record<CallSheetSource, InternalHealth>;
export type StoredEntry = CallSheetEntry & {
  identityKey: string;
  generatedAt: string;
};
type PreferenceSnapshot = {
  personId: string;
  snoozedUntil: string | null;
  excludedAt: string | null;
  lastSuggestedAt: string | null;
  lastCompletedAt: string | null;
};
type Undo = {
  token: string;
  entries: StoredEntry[];
  skipped: string[];
  preference: PreferenceSnapshot;
  interactionId?: string;
  previousInteractionAt?: string | null;
  completedAt?: string;
  replacement?: {
    personId: string;
    previousSuggestedAt: string | null;
    suggestedAt: string;
  };
};
export type DayData = {
  entries: StoredEntry[];
  skipped: string[];
  undo?: Undo;
};
export const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export function readSources(raw: unknown): SourceState {
  const value =
    raw && typeof raw === "object" ? (raw as Partial<SourceState>) : {};
  return Object.fromEntries(
    SOURCES.map((source) => [
      source,
      {
        enabled: false,
        status: "not_connected",
        lastSuccessAt: null,
        error: null,
        epoch: "initial",
        ...(value[source] ?? {}),
      },
    ]),
  ) as SourceState;
}
export function readSourceData(
  raw: unknown,
): Partial<Record<CallSheetSource, ContactSourceData>> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Partial<Record<CallSheetSource, ContactSourceData>>)
    : {};
}
export function readDay(raw: unknown): DayData {
  const data = raw as Partial<DayData> | null;
  return {
    entries: Array.isArray(data?.entries) ? data.entries.slice(0, 5) : [],
    skipped: Array.isArray(data?.skipped) ? data.skipped.slice(-100) : [],
    ...(data?.undo ? { undo: data.undo } : {}),
  };
}
export async function ownerTransaction<T>(
  userId: string,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`call-sheet:${userId}`}))`;
      return work(tx);
    },
    { timeout: 20_000, maxWait: 20_000 },
  );
}
/** Remove durable personal snapshots as well as visible rows. Undo may retain
 * unrelated valid rows, but cannot restore an action involving a revoked identity. */
function scrubDayPeople(
  data: DayData,
  entryAllowed: (entry: StoredEntry) => boolean,
  personAllowed: (personId: string) => boolean,
) {
  const undo = data.undo;
  if (
    undo &&
    (!personAllowed(undo.preference.personId) ||
      !undo.entries.some(
        (entry) =>
          entry.personId === undo.preference.personId && entryAllowed(entry),
      ) ||
      (undo.replacement &&
        (!personAllowed(undo.replacement.personId) ||
          !data.entries.some(
            (entry) =>
              entry.personId === undo.replacement!.personId &&
              entryAllowed(entry),
          ))))
  )
    delete data.undo;
  data.entries = data.entries.filter(entryAllowed);
  data.skipped = data.skipped.filter(personAllowed);
  if (data.undo) {
    data.undo.entries = data.undo.entries.filter(entryAllowed);
    data.undo.skipped = data.undo.skipped.filter(personAllowed);
  }
}

/** Called by the CRM delete route so snapshots disappear in the same transaction
 * as the person and cascading evidence, without waiting for another sheet read. */
export function deletePersonWithCallSheetCleanup(
  userId: string,
  personId: string,
): Promise<number> {
  return ownerTransaction(userId, async (tx) => {
    const result = await tx.person.deleteMany({
      where: { id: personId, userId },
    });
    if (!result.count) return 0;
    const days = await tx.callSheetDay.findMany({
      where: { userId },
      select: { id: true, entries: true },
    });
    for (const day of days) {
      const data = readDay(day.entries);
      const before = JSON.stringify(data);
      scrubDayPeople(
        data,
        (entry) => entry.personId !== personId,
        (id) => id !== personId,
      );
      if (JSON.stringify(data) !== before)
        await tx.callSheetDay.update({
          where: { id: day.id },
          data: { entries: json(data), version: { increment: 1 } },
        });
    }
    return result.count;
  });
}

export async function ensureSettings(tx: Tx, userId: string) {
  return tx.callSheetSettings.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}
async function context(tx: Tx, userId: string, now: Date) {
  const settings = await ensureSettings(tx, userId);
  const [records, contacts, interactions] = await Promise.all([
    tx.person.findMany({ where: { userId, archived: false } }),
    tx.callSheetContact.findMany({ where: { userId } }),
    tx.interaction.findMany({
      where: {
        userId,
        source: { in: ["manual", "smart-capture", "call-sheet", "checkin"] },
        occurredAt: { lte: now },
      },
      select: { personIds: true, occurredAt: true },
      orderBy: { occurredAt: "desc" },
    }),
  ]);
  const manual = new Map<string, Date>();
  for (const item of interactions)
    for (const id of item.personIds)
      if (!manual.has(id)) manual.set(id, item.occurredAt);
  // Expire stored excerpts, not merely the response projection. Identity edits also
  // revoke evidence while preserving manual cadence/hide/snooze preferences.
  const recordMap = new Map(records.map((person) => [person.id, person]));
  for (const contact of contacts) {
    const person = recordMap.get(contact.personId);
    const data = limitPersonCues(
      person && contact.identityKey === identityKey(person)
        ? readSourceData(contact.sourceData)
        : {},
      now,
    );
    if (JSON.stringify(data) !== JSON.stringify(contact.sourceData)) {
      contact.sourceData = json(data) as Prisma.JsonValue;
      await tx.callSheetContact.update({
        where: { id: contact.id },
        data: { sourceData: json(data) },
      });
    }
  }
  const preferences = new Map(
    contacts.map((contact) => [contact.personId, contact]),
  );
  const people: PolicyPerson[] = records.map((person) => {
    const preference = preferences.get(person.id);
    return {
      ...person,
      manualAt: manual.get(person.id) ?? null,
      preference,
      sourceData:
        preference?.identityKey === identityKey(person)
          ? readSourceData(preference.sourceData)
          : {},
    };
  });
  return {
    settings,
    sources: readSources(settings.sources),
    people,
    preferences,
    records,
  };
}
function makeEntry(candidate: Candidate, now: Date): StoredEntry {
  const { person } = candidate;
  return {
    id: randomUUID(),
    personId: person.id,
    name: personName(person),
    imageUrl: person.imageUrl,
    phone: person.phone,
    email: person.email,
    reason: candidate.reason,
    topic: candidate.cues[0]?.text ?? null,
    lastContactAt: candidate.lastContactAt,
    lastContactSource: candidate.lastContactSource,
    status: "pending",
    cues: candidate.cues,
    cadenceDays: candidate.cadenceDays,
    identityKey: identityKey(person),
    generatedAt: now.toISOString(),
  };
}
async function markSuggested(
  tx: Tx,
  userId: string,
  entries: StoredEntry[],
  now: Date,
) {
  for (const entry of entries)
    await tx.callSheetContact.upsert({
      where: { userId_personId: { userId, personId: entry.personId } },
      create: {
        userId,
        personId: entry.personId,
        identityKey: entry.identityKey,
        lastSuggestedAt: now,
      },
      update: { lastSuggestedAt: now },
    });
}
export async function sheetInTransaction(
  tx: Tx,
  userId: string,
  now: Date,
): Promise<CallSheetResponse> {
  const ctx = await context(tx, userId, now);
  const activeIdentities = new Map(
    ctx.people.map((person) => [person.id, identityKey(person)]),
  );
  // Retained history and Undo must respect the current active identity, including
  // changes or deletions made through another code path.
  const history = await tx.callSheetDay.findMany({
    where: { userId },
    select: { id: true, entries: true },
  });
  for (const item of history) {
    const stored = readDay(item.entries);
    const before = JSON.stringify(stored);
    scrubDayPeople(
      stored,
      (entry) => activeIdentities.get(entry.personId) === entry.identityKey,
      (personId) => activeIdentities.has(personId),
    );
    for (const entry of [...stored.entries, ...(stored.undo?.entries ?? [])]) {
      entry.cues = liveCues(entry.cues, now);
      entry.topic = entry.cues[0]?.text ?? null;
    }
    if (JSON.stringify(stored) !== before)
      await tx.callSheetDay.update({
        where: { id: item.id },
        data: { entries: json(stored), version: { increment: 1 } },
      });
  }
  const timezone = ctx.settings.timezone;
  const date = localDate(now, timezone);
  let day = await tx.callSheetDay.findUnique({
    where: { userId_localDate: { userId, localDate: date } },
  });
  const candidates = rankCandidates(ctx.people, ctx.sources, now, timezone);
  if (!day) {
    const entries = selectCandidates(candidates).map((candidate) =>
      makeEntry(candidate, now),
    );
    day = await tx.callSheetDay.create({
      data: {
        userId,
        localDate: date,
        timezone,
        entries: json({ entries, skipped: [] }),
      },
    });
    await markSuggested(tx, userId, entries, now);
  }
  const data = readDay(day.entries);
  const before = JSON.stringify(data);
  const people = new Map(ctx.people.map((person) => [person.id, person]));
  const staleContactSlots: number[] = [];
  data.entries = data.entries.flatMap((entry, index) => {
    const person = people.get(entry.personId);
    if (
      !person ||
      person.preference?.excludedAt ||
      entry.identityKey !== identityKey(person)
    )
      return [];
    const last = latestContact(person, ctx.sources, now);
    const newlyContacted =
      entry.status === "pending" &&
      last.at &&
      Date.parse(last.at) > Date.parse(entry.lastContactAt ?? "1970-01-01") &&
      now.getTime() - Date.parse(last.at) < 7 * 86_400_000;
    // Initial source sync can discover a conversation that preceded this sheet.
    // Replace that stale suggestion; only an actual later encounter is progress.
    if (
      newlyContacted &&
      Date.parse(last.at!) < Date.parse(entry.generatedAt)
    ) {
      staleContactSlots.push(index);
      return [];
    }
    const cues =
      entry.status === "pending" && !newlyContacted && last.complete
        ? liveCues(
            SOURCES.flatMap((source) =>
              ctx.sources[source].enabled
                ? liveCues(person.sourceData[source]?.cues ?? [], now, source)
                : [],
            ),
            now,
          )
        : [];
    return [
      {
        ...entry,
        name: personName(person),
        phone: person.phone,
        email: person.email,
        imageUrl: person.imageUrl,
        cadenceDays: cadence(person, person.preference?.cadenceDays),
        lastContactAt: last.at,
        lastContactSource: last.source,
        status: newlyContacted ? ("contacted" as const) : entry.status,
        reason:
          newlyContacted || entry.status === "contacted"
            ? "You have been in touch since this was suggested."
            : entry.status === "done"
              ? isReachOutMethod(entry.method)
                ? `${REACH_OUT_METHODS[entry.method].label} check-in logged today.`
                : "Check-in logged today."
              : (!last.reliable && !entry.reason.includes("birthday")) ||
                  (entry.reason.startsWith("A possible follow-up") &&
                    !cues.some((cue) => cue.kind === "follow_up")) ||
                  // Older contact surfaced after suggesting: no longer "none".
                  (entry.reason === NO_CONTACT_REASON && last.at)
                ? "A suggested check-in."
                : entry.reason.startsWith("Time for your")
                  ? `Time for your ${cadence(person, person.preference?.cadenceDays)}-day check-in.`
                  : entry.reason,
        cues,
        topic: cues[0]?.text ?? null,
      },
    ];
  });
  const excluded = new Set([
    ...data.entries.map((entry) => entry.personId),
    ...data.skipped,
  ]);
  const additions = selectCandidates(
    candidates.filter((candidate) => !excluded.has(candidate.person.id)),
    5 - data.entries.length,
    ctx.people
      .filter((person) =>
        data.entries.some((entry) => entry.personId === person.id),
      )
      .map((person) => ({ category: relationshipCategory(person) })),
  ).map((candidate) => makeEntry(candidate, now));
  additions.forEach((entry, index) => {
    const slot = staleContactSlots[index] ?? data.entries.length;
    data.entries.splice(Math.min(slot, data.entries.length), 0, entry);
  });
  await markSuggested(tx, userId, additions, now);
  if (JSON.stringify(data) !== before)
    day = await tx.callSheetDay.update({
      where: { id: day.id },
      data: { entries: json(data), version: { increment: 1 } },
    });
  return response(
    day,
    data,
    ctx.sources,
    timezone,
    ctx.people,
    reviewQueue(ctx.people, ctx.sources, now).length,
  );
}
function response(
  day: CallSheetDay,
  data: DayData,
  sources: SourceState,
  timezone: string,
  people: PolicyPerson[],
  reviewCount: number,
): CallSheetResponse {
  return {
    day: { id: day.id, localDate: day.localDate, version: day.version },
    entries: data.entries.map(
      ({ identityKey: _identity, generatedAt: _generated, ...entry }) => entry,
    ),
    sources: Object.fromEntries(
      SOURCES.map((source) => {
        const {
          epoch: _epoch,
          attemptAt: _attempt,
          ...health
        } = sources[source];
        return [source, health];
      }),
    ) as Record<CallSheetSource, SourceHealth>,
    timezone,
    hidden: people
      .filter((person) => person.preference?.excludedAt)
      .map((person) => ({ personId: person.id, name: personName(person) })),
    reviewCount,
    ...(data.undo ? { undoToken: data.undo.token } : {}),
  };
}
export function getCallSheet(userId: string, now = new Date()) {
  return ownerTransaction(userId, (tx) => sheetInTransaction(tx, userId, now));
}
function strictFields(input: Record<string, unknown>, fields: string[]) {
  if (Object.keys(input).some((key) => !fields.includes(key)))
    throw new IntakeError("Unknown field");
}
function id(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 200)
    throw new IntakeError("Invalid identifier");
  return value;
}
export function parseMutation(raw: unknown): CallSheetMutation {
  const input = object(raw);
  strictFields(input, [
    "dayId",
    "version",
    "entryId",
    "action",
    "days",
    "undoToken",
    "method",
  ]);
  const dayId = id(input.dayId);
  if (!Number.isInteger(input.version) || (input.version as number) < 0)
    throw new IntakeError("Invalid version");
  if (
    !["done", "undo", "snooze", "replace", "hide"].includes(
      input.action as string,
    )
  )
    throw new IntakeError("Invalid action");
  if (
    input.days !== undefined &&
    (!Number.isInteger(input.days) ||
      (input.days as number) < 1 ||
      (input.days as number) > 365)
  )
    throw new IntakeError("Choose 1 to 365 days");
  if (input.action === "done" && !isReachOutMethod(input.method))
    throw new IntakeError("Choose how you reached out");
  if (input.action !== "done" && input.method !== undefined)
    throw new IntakeError("Reach-out method is only for check-ins");
  if (input.action === "undo") id(input.undoToken);
  else id(input.entryId);
  return { ...input, dayId } as CallSheetMutation;
}
function snapshot(
  contact: CallSheetContact,
  personId: string,
): PreferenceSnapshot {
  return {
    personId,
    snoozedUntil: contact.snoozedUntil?.toISOString() ?? null,
    excludedAt: contact.excludedAt?.toISOString() ?? null,
    lastSuggestedAt: contact.lastSuggestedAt?.toISOString() ?? null,
    lastCompletedAt: contact.lastCompletedAt?.toISOString() ?? null,
  };
}
export function mutateCallSheet(
  userId: string,
  raw: unknown,
  now = new Date(),
) {
  const action = parseMutation(raw);
  return ownerTransaction(userId, async (tx) => {
    // Refresh identity and new-contact suppression before accepting an action.
    const current = await sheetInTransaction(tx, userId, now);
    if (current.day.id !== action.dayId)
      throw new IntakeError(
        "This sheet is no longer current. Refresh it.",
        409,
      );
    const day = await tx.callSheetDay.findFirstOrThrow({
      where: { id: action.dayId, userId },
    });
    const data = readDay(day.entries);
    const entry = data.entries.find((item) => item.id === action.entryId);
    if (action.action === "done" && entry?.status === "done") return current;
    if (day.version !== action.version)
      throw new IntakeError("The call sheet changed. Refresh it.", 409);
    if (action.action === "undo") {
      const undo = data.undo;
      if (!undo || undo.token !== action.undoToken)
        throw new IntakeError("That action can no longer be undone.", 409);
      const person = await tx.person.findFirst({
        where: { id: undo.preference.personId, userId, archived: false },
      });
      const original = undo.entries.find(
        (item) => item.personId === person?.id,
      );
      if (!person || !original || identityKey(person) !== original.identityKey)
        throw new IntakeError("This contact has changed. Refresh it.", 409);
      if (undo.interactionId) {
        await tx.interaction.deleteMany({
          where: {
            id: undo.interactionId,
            userId,
            source: "call-sheet",
            personIds: { equals: [person.id] },
          },
        });
        const latest = await tx.interaction.findFirst({
          where: { userId, personIds: { has: person.id } },
          orderBy: { occurredAt: "desc" },
        });
        const preserved =
          person.lastInteractionAt?.toISOString() === undo.completedAt
            ? undo.previousInteractionAt
            : person.lastInteractionAt?.toISOString();
        const dates = [preserved, latest?.occurredAt.toISOString()]
          .filter((value): value is string => !!value)
          .sort((a, b) => Date.parse(b) - Date.parse(a));
        // Avoid overwriting a concurrent non-call-sheet encounter update.
        await tx.person.updateMany({
          where: {
            id: person.id,
            userId,
            lastInteractionAt: person.lastInteractionAt,
          },
          data: { lastInteractionAt: dates[0] ? new Date(dates[0]) : null },
        });
      }
      const { personId, ...preference } = undo.preference;
      await tx.callSheetContact.updateMany({
        where: { userId, personId },
        data: Object.fromEntries(
          Object.entries(preference).map(([key, value]) => [
            key,
            value ? new Date(value) : null,
          ]),
        ),
      });
      if (undo.replacement)
        await tx.callSheetContact.updateMany({
          where: {
            userId,
            personId: undo.replacement.personId,
            lastSuggestedAt: new Date(undo.replacement.suggestedAt),
          },
          data: {
            lastSuggestedAt: undo.replacement.previousSuggestedAt
              ? new Date(undo.replacement.previousSuggestedAt)
              : null,
          },
        });
      data.entries = undo.entries;
      data.skipped = undo.skipped;
      delete data.undo;
    } else {
      if (!entry) throw new IntakeError("Entry not found", 404);
      if (entry.status !== "pending")
        throw new IntakeError("This person has already been contacted.", 409);
      const person = await tx.person.findFirst({
        where: { id: entry.personId, userId, archived: false },
      });
      if (!person || identityKey(person) !== entry.identityKey)
        throw new IntakeError("Contact changed", 409);
      const contact = await tx.callSheetContact.upsert({
        where: { userId_personId: { userId, personId: person.id } },
        create: { userId, personId: person.id, identityKey: entry.identityKey },
        update: {},
      });
      const undo: Undo = {
        token: randomUUID(),
        entries: structuredClone(data.entries),
        skipped: [...data.skipped],
        preference: snapshot(contact, person.id),
      };
      if (action.action === "done") {
        const method = action.method!;
        const choice = REACH_OUT_METHODS[method];
        const interaction = await tx.interaction.create({
          data: {
            userId,
            personIds: [person.id],
            occurredAt: now,
            kind: choice.kind,
            title: `${choice.title} ${personName(person)}`,
            source: "call-sheet",
          },
        });
        undo.interactionId = interaction.id;
        undo.previousInteractionAt =
          person.lastInteractionAt?.toISOString() ?? null;
        undo.completedAt = now.toISOString();
        await tx.person.updateMany({
          where: {
            id: person.id,
            userId,
            OR: [
              { lastInteractionAt: null },
              { lastInteractionAt: { lt: now } },
            ],
          },
          data: { lastInteractionAt: now },
        });
        await tx.callSheetContact.update({
          where: { id: contact.id },
          data: { lastCompletedAt: now },
        });
        entry.status = "done";
        entry.method = method;
        entry.interactionId = interaction.id;
        entry.cues = [];
        entry.topic = null;
      } else {
        const settings = await ensureSettings(tx, userId);
        await tx.callSheetContact.update({
          where: { id: contact.id },
          data:
            action.action === "hide"
              ? { excludedAt: now }
              : {
                  snoozedUntil: snoozeUntil(
                    now,
                    action.action === "snooze" ? (action.days ?? 7) : 7,
                    settings.timezone,
                  ),
                },
        });
        data.skipped = [...data.skipped, person.id].slice(-100);
        // Insert the replacement into the removed slot, keeping all other IDs and positions stable.
        const ctx = await context(tx, userId, now);
        const candidates = rankCandidates(
          ctx.people,
          ctx.sources,
          now,
          settings.timezone,
        );
        const excluded = new Set([
          ...data.entries.map((item) => item.personId),
          ...data.skipped,
        ]);
        const replacement = selectCandidates(
          candidates.filter((item) => !excluded.has(item.person.id)),
          1,
          ctx.people
            .filter((person) =>
              data.entries.some(
                (existing) =>
                  existing.personId === person.id && existing.id !== entry.id,
              ),
            )
            .map((person) => ({ category: relationshipCategory(person) })),
        )[0];
        // "Someone else" with nobody else due would only shorten the list.
        // Throwing rolls back the snooze above, so the person stays put.
        if (!replacement && action.action === "replace")
          throw new IntakeError(
            `No one else is due for a check-in right now, so ${personName(person)} stays on today’s list.`,
            422,
          );
        const index = data.entries.findIndex((item) => item.id === entry.id);
        if (replacement) {
          undo.replacement = {
            personId: replacement.person.id,
            previousSuggestedAt:
              ctx.preferences
                .get(replacement.person.id)
                ?.lastSuggestedAt?.toISOString() ?? null,
            suggestedAt: now.toISOString(),
          };
          const added = makeEntry(replacement, now);
          data.entries.splice(index, 1, added);
          await markSuggested(tx, userId, [added], now);
        } else data.entries.splice(index, 1);
      }
      data.undo = undo;
    }
    await tx.callSheetDay.update({
      where: { id: day.id },
      data: { entries: json(data), version: { increment: 1 } },
    });
    return sheetInTransaction(tx, userId, now);
  });
}
export function parseSettings(raw: unknown): CallSheetSettingsMutation {
  const input = object(raw);
  strictFields(input, [
    "source",
    "enabled",
    "restorePersonId",
    "personId",
    "cadenceDays",
    "timezone",
  ]);
  if (!Object.keys(input).length)
    throw new IntakeError("A setting is required");
  if (input.source !== undefined || input.enabled !== undefined) {
    if (
      !SOURCES.includes(input.source as CallSheetSource) ||
      typeof input.enabled !== "boolean"
    )
      throw new IntakeError("Source and enabled are required together");
  }
  if (input.personId !== undefined || input.cadenceDays !== undefined) {
    id(input.personId);
    if (
      input.cadenceDays !== null &&
      (!Number.isInteger(input.cadenceDays) ||
        (input.cadenceDays as number) < 7 ||
        (input.cadenceDays as number) > 730)
    )
      throw new IntakeError("Cadence must be 7 to 730 days, or null");
  }
  if (input.restorePersonId !== undefined) id(input.restorePersonId);
  if (
    input.timezone !== undefined &&
    (typeof input.timezone !== "string" || !validTimezone(input.timezone))
  )
    throw new IntakeError("Invalid timezone");
  return input as CallSheetSettingsMutation;
}
export function updateCallSheetSettings(
  userId: string,
  raw: unknown,
  now = new Date(),
) {
  const input = parseSettings(raw);
  return ownerTransaction(userId, async (tx) => {
    const settings = await ensureSettings(tx, userId);
    const sources = readSources(settings.sources);
    if (input.source && sources[input.source].enabled !== input.enabled) {
      const source = input.source;
      sources[source] = {
        enabled: input.enabled!,
        status: "not_connected",
        lastSuccessAt: null,
        error: null,
        epoch: randomUUID(),
      };
      // Delete excerpts in live state AND every durable snapshot, including Undo.
      const contacts = await tx.callSheetContact.findMany({
        where: { userId },
      });
      for (const contact of contacts) {
        const sourceData = readSourceData(contact.sourceData);
        delete sourceData[source];
        await tx.callSheetContact.update({
          where: { id: contact.id },
          data: { sourceData: json(sourceData) },
        });
      }
      const days = await tx.callSheetDay.findMany({ where: { userId } });
      for (const day of days) {
        const data = readDay(day.entries);
        for (const entry of [...data.entries, ...(data.undo?.entries ?? [])]) {
          entry.cues = entry.cues.filter((cue) =>
            cue.evidence.every((evidence) => evidence.source !== source),
          );
          entry.topic = entry.cues[0]?.text ?? null;
          if (entry.lastContactSource === source) {
            entry.lastContactAt = null;
            entry.lastContactSource = null;
            entry.reason = "A suggested check-in.";
          }
        }
        await tx.callSheetDay.update({
          where: { id: day.id },
          data: { entries: json(data), version: { increment: 1 } },
        });
      }
    }
    await tx.callSheetSettings.update({
      where: { userId },
      data: {
        sources: json(sources),
        ...(input.timezone ? { timezone: input.timezone } : {}),
      },
    });
    for (const personId of [input.restorePersonId, input.personId].filter(
      (value): value is string => !!value,
    )) {
      const person = await tx.person.findFirst({
        where: { id: personId, userId, archived: false },
      });
      if (!person) throw new IntakeError("Person not found", 404);
      const values = {
        ...(personId === input.restorePersonId ? { excludedAt: null } : {}),
        ...(personId === input.personId
          ? { cadenceDays: input.cadenceDays }
          : {}),
      };
      await tx.callSheetContact.upsert({
        where: { userId_personId: { userId, personId } },
        create: {
          userId,
          personId,
          identityKey: identityKey(person),
          ...values,
        },
        update: values,
      });
    }
    return sheetInTransaction(tx, userId, now);
  });
}
function reviewSummary(raw: unknown): string | null {
  const summary =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as { summary?: unknown }).summary
      : null;
  if (typeof summary !== "string" || !summary.trim()) return null;
  const text = summary.trim().replace(/\s+/g, " ");
  return text.length > 240 ? `${text.slice(0, 239).trimEnd()}…` : text;
}
export function getCallSheetReview(
  userId: string,
  now = new Date(),
): Promise<CallSheetReview> {
  return ownerTransaction(userId, async (tx) => {
    const ctx = await context(tx, userId, now);
    const records = new Map(ctx.records.map((person) => [person.id, person]));
    const people = reviewQueue(ctx.people, ctx.sources, now).flatMap((item) => {
      const person = records.get(item.id);
      if (!person) return [];
      return [
        {
          personId: person.id,
          name: personName(person),
          imageUrl: person.imageUrl,
          company: person.company,
          role: person.role,
          city: person.city,
          howWeMet: person.howWeMet,
          strength: person.strength,
          circles: person.circles,
          tags: person.tags,
          summary: reviewSummary(person.context),
          reachable: !!(person.phone?.trim() || person.email?.trim()),
        },
      ];
    });
    return { total: people.length, people };
  });
}
export function parseReviewDecision(raw: unknown): CallSheetReviewDecision {
  const input = object(raw);
  strictFields(input, ["personId", "decision", "cadenceDays"]);
  const personId = id(input.personId);
  if (input.decision === "keep") {
    if (
      !Number.isInteger(input.cadenceDays) ||
      (input.cadenceDays as number) < 7 ||
      (input.cadenceDays as number) > 730
    )
      throw new IntakeError("Cadence must be 7 to 730 days");
    return {
      personId,
      decision: "keep",
      cadenceDays: input.cadenceDays as number,
    };
  }
  if (input.decision !== "hide" && input.decision !== "reset")
    throw new IntakeError("Invalid decision");
  if (input.cadenceDays !== undefined)
    throw new IntakeError("Cadence is only for keep");
  return { personId, decision: input.decision };
}
/** One quick-review answer. Light on purpose: the sheet re-ranks on its next read. */
export function decideCallSheetReview(
  userId: string,
  raw: unknown,
  now = new Date(),
) {
  const input = parseReviewDecision(raw);
  return ownerTransaction(userId, async (tx) => {
    const person = await tx.person.findFirst({
      where: { id: input.personId, userId, archived: false },
    });
    if (!person) throw new IntakeError("Person not found", 404);
    const values =
      input.decision === "keep"
        ? { cadenceDays: input.cadenceDays }
        : input.decision === "hide"
          ? { excludedAt: now }
          : { excludedAt: null, cadenceDays: null };
    await tx.callSheetContact.upsert({
      where: { userId_personId: { userId, personId: person.id } },
      create: {
        userId,
        personId: person.id,
        identityKey: identityKey(person),
        ...values,
      },
      update: values,
    });
    return { ok: true as const };
  });
}
