import { createHash } from "node:crypto";
import { IntakeError, object } from "@/lib/dating-intake/contracts";
import {
  cadence,
  DAY_MS,
  fresh,
  identityKey,
  liveCues,
  normalizeHandle,
  personName,
  SOURCES,
} from "./policy";
import {
  ensureSettings,
  json,
  ownerTransaction,
  readSourceData,
  readSources,
  type Tx,
} from "./service";
import { extractCallSheetCues } from "./extract";
import type {
  CaptureConfig,
  CaptureHealth,
  CaptureMessage,
  CapturePerson,
  CallSheetSource,
  EvidenceCue,
} from "./types";

function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new IntakeError("Unknown field");
}
function text(value: unknown, max: number, empty = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!empty && !value.trim())
  )
    throw new IntakeError("Invalid text field");
  return value;
}
function date(value: unknown, now: Date, oldest: number) {
  const iso = text(value, 40);
  const parsed = Date.parse(iso);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(iso) ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 19) !== iso.slice(0, 19) ||
    parsed > now.getTime() + 300_000 ||
    parsed < now.getTime() - oldest * DAY_MS
  )
    throw new IntakeError("Invalid capture timestamp");
  return new Date(parsed).toISOString();
}
export function parseCapture(
  raw: unknown,
  now = new Date(),
): CapturePerson | CaptureHealth {
  const input = object(raw);
  if (!SOURCES.includes(input.source as CallSheetSource))
    throw new IntakeError("Invalid source");
  const source = input.source as CallSheetSource;
  const capturedAt = date(input.capturedAt, now, 2);
  const sourceEpoch = text(input.sourceEpoch, 100);
  if (input.type === "health") {
    fields(input, [
      "type",
      "source",
      "status",
      "capturedAt",
      "error",
      "sourceEpoch",
    ]);
    if (!["ready", "error", "syncing"].includes(input.status as string))
      throw new IntakeError("Invalid source status");
    // Errors are deliberately coarse; never retain exception messages containing transcripts/paths.
    return {
      type: "health",
      source,
      sourceEpoch,
      capturedAt,
      status: input.status as CaptureHealth["status"],
      ...(input.error === undefined ? {} : { error: text(input.error, 300) }),
    };
  }
  if (input.type !== "person") throw new IntakeError("Invalid capture type");
  fields(input, [
    "type",
    "personId",
    "identityKey",
    "handles",
    "source",
    "capturedAt",
    "coverageStart",
    "lastContactAt",
    "messageCount",
    "messages",
    "extract",
    "sourceEpoch",
  ]);
  const personId = text(input.personId, 200);
  const key = text(input.identityKey, 64);
  if (!/^[a-f0-9]{64}$/.test(key))
    throw new IntakeError("Invalid identity key");
  if (!Array.isArray(input.handles) || input.handles.length > 20)
    throw new IntakeError("Invalid handles");
  const handles = input.handles.map((value) => {
    const raw = text(value, 254);
    const handle = normalizeHandle(raw);
    if (!handle || handle !== raw)
      throw new IntakeError("Handles must be normalized");
    return handle;
  });
  if (new Set(handles).size !== handles.length)
    throw new IntakeError("Duplicate handle");
  if (!Array.isArray(input.messages) || input.messages.length > 200)
    throw new IntakeError("Maximum 200 messages", 413);
  if (
    !Number.isInteger(input.messageCount) ||
    (input.messageCount as number) < input.messages.length ||
    (input.messageCount as number) > 1_000_000
  )
    throw new IntakeError("Invalid message count");
  if (input.extract !== undefined && typeof input.extract !== "boolean")
    throw new IntakeError("Invalid extraction flag");
  const coverageStart = date(input.coverageStart, now, 370);
  if (Date.parse(coverageStart) > Date.parse(capturedAt))
    throw new IntakeError("Invalid coverage interval");
  const lastContactAt =
    input.lastContactAt === null ? null : date(input.lastContactAt, now, 370);
  if (
    lastContactAt &&
    (Date.parse(lastContactAt) < Date.parse(coverageStart) ||
      Date.parse(lastContactAt) > Date.parse(capturedAt))
  )
    throw new IntakeError("Last contact falls outside coverage");
  const messages: CaptureMessage[] = input.messages.map((rawMessage) => {
    const message = object(rawMessage);
    fields(message, ["guid", "sentAt", "fromMe", "text"]);
    if (typeof message.fromMe !== "boolean")
      throw new IntakeError("Invalid message direction");
    const sentAt = date(message.sentAt, now, 90);
    if (
      !lastContactAt ||
      Date.parse(sentAt) > Date.parse(lastContactAt) ||
      Date.parse(sentAt) < Date.parse(coverageStart)
    )
      throw new IntakeError("Message falls outside capture interval");
    return {
      guid: text(message.guid, 300),
      sentAt,
      fromMe: message.fromMe,
      text: text(message.text, 20_000),
    };
  });
  if (new Set(messages.map((message) => message.guid)).size !== messages.length)
    throw new IntakeError("Duplicate message identifier");
  if (messages.reduce((sum, message) => sum + message.text.length, 0) > 20_000)
    throw new IntakeError("Maximum 20000 text characters", 413);
  if ((input.messageCount as number) > 0 !== (lastContactAt !== null))
    throw new IntakeError("Contact time and message count disagree");
  if (
    !handles.length &&
    (lastContactAt || input.messageCount || messages.length)
  )
    throw new IntakeError("Matched handles are required for activity");
  if (input.extract === false && messages.length)
    throw new IntakeError("Metadata-only capture must omit messages");
  return {
    type: "person",
    source,
    sourceEpoch,
    personId,
    identityKey: key,
    capturedAt,
    coverageStart,
    lastContactAt,
    messageCount: input.messageCount as number,
    handles,
    messages,
    ...(input.extract === undefined
      ? {}
      : { extract: input.extract as boolean }),
  };
}
async function identities(tx: Tx, userId: string) {
  const people = await tx.person.findMany({ where: { userId } });
  const owners = new Map<string, Set<string>>();
  for (const person of people)
    for (const raw of [person.phone, person.email]) {
      const handle = normalizeHandle(raw ?? "");
      if (handle) {
        if (!owners.has(handle)) owners.set(handle, new Set());
        owners.get(handle)!.add(person.id);
      }
    }
  return { people, owners };
}
export function getCaptureConfig(userId: string): Promise<CaptureConfig> {
  return ownerTransaction(userId, async (tx) => {
    const settings = await ensureSettings(tx, userId);
    const sourceState = readSources(settings.sources);
    const sources = {
      imessage: sourceState.imessage.enabled,
      whatsapp: sourceState.whatsapp.enabled,
    };
    const sourceEpochs = {
      imessage: sourceState.imessage.epoch,
      whatsapp: sourceState.whatsapp.epoch,
    };
    if (!sources.imessage && !sources.whatsapp)
      return { sources, sourceEpochs, people: [], blockedHandles: [] };
    const { people, owners } = await identities(tx, userId);
    const preferences = await tx.callSheetContact.findMany({
      where: { userId },
    });
    const archived = new Set(
      people.filter((person) => person.archived).map((person) => person.id),
    );
    const blockedHandles = [...owners]
      .filter(
        ([, ids]) => ids.size > 1 || [...ids].some((id) => archived.has(id)),
      )
      .map(([handle]) => handle)
      .sort();
    return {
      sources,
      sourceEpochs,
      people: people
        .filter((person) => !person.archived)
        .map((person) => {
          const pref = preferences.find((item) => item.personId === person.id);
          return {
            id: person.id,
            name: personName(person),
            phone: person.phone,
            email: person.email,
            identityKey: identityKey(person),
            starred: person.starred,
            strength: person.strength,
            cadenceDays: cadence(person, pref?.cadenceDays),
            lastSuggestedAt: pref?.lastSuggestedAt?.toISOString() ?? null,
          };
        }),
      blockedHandles,
    };
  });
}
async function validatePerson(tx: Tx, userId: string, input: CapturePerson) {
  // CRM editing routes do not use our advisory lock; hold the actual identity row
  // while validating/saving so an archive or identity edit cannot race the write.
  await tx.$queryRaw`SELECT "id" FROM "Person" WHERE "id" = ${input.personId} AND "userId" = ${userId} FOR UPDATE`;
  const settings = await ensureSettings(tx, userId);
  const sources = readSources(settings.sources);
  if (!sources[input.source].enabled)
    throw new IntakeError("Source is disabled", 409);
  if (sources[input.source].epoch !== input.sourceEpoch)
    throw new IntakeError("Source configuration changed", 409);
  const { people, owners } = await identities(tx, userId);
  const person = people.find(
    (person) => person.id === input.personId && !person.archived,
  );
  if (!person) throw new IntakeError("Person not found", 404);
  if (identityKey(person) !== input.identityKey)
    throw new IntakeError("Person identity changed", 409);
  const own = new Set(
    [
      normalizeHandle(person.phone ?? ""),
      normalizeHandle(person.email ?? ""),
    ].filter(Boolean),
  );
  const fullName = personName(person).toLowerCase();
  const uniqueName =
    fullName.split(/\s+/).length >= 2 &&
    people.filter((other) => personName(other).toLowerCase() === fullName)
      .length === 1;
  const otherStates = await tx.callSheetContact.findMany({
    where: { userId, personId: { not: person.id } },
  });
  for (const handle of input.handles) {
    if ([...(owners.get(handle) ?? [])].some((owner) => owner !== person.id))
      throw new IntakeError("Handle is shared with another CRM record", 409);
    if (!own.has(handle) && !uniqueName)
      throw new IntakeError("Handle has no unambiguous identity", 409);
    for (const other of otherStates) {
      const otherPerson = people.find((item) => item.id === other.personId);
      if (
        otherPerson &&
        identityKey(otherPerson) === other.identityKey &&
        SOURCES.some((source) =>
          readSourceData(other.sourceData)[source]?.handles?.includes(handle),
        )
      )
        throw new IntakeError("Handle was matched to another CRM record", 409);
    }
  }
  return { person, sources };
}
function grounded(cues: EvidenceCue[], input: CapturePerson, now: Date) {
  const messages = new Map(
    input.messages.map((message) => [message.guid, message]),
  );
  return liveCues(cues, now, input.source)
    .flatMap((cue) => {
      if (
        !["topic", "follow_up"].includes(cue.kind) ||
        typeof cue.text !== "string" ||
        !cue.text.trim() ||
        cue.text.length > 500 ||
        cue.evidence.length > 3
      )
        return [];
      const evidence = cue.evidence.flatMap((item) => {
        const message = messages.get(item.messageId);
        if (
          !message ||
          item.sentAt !== message.sentAt ||
          item.excerpt.length > 240 ||
          !item.excerpt ||
          !message.text.includes(item.excerpt)
        )
          return [];
        return [item];
      });
      return evidence.length === cue.evidence.length
        ? [{ ...cue, evidence }]
        : [];
    })
    .slice(0, 3);
}
export async function captureCallSheet(
  userId: string,
  raw: unknown,
  now = new Date(),
): Promise<{ ok: true; extracted: boolean }> {
  const input = parseCapture(raw, now);
  if (input.type === "health") {
    return ownerTransaction(userId, async (tx) => {
      const settings = await ensureSettings(tx, userId);
      const sources = readSources(settings.sources);
      const state = sources[input.source];
      if (!state.enabled) throw new IntakeError("Source is disabled", 409);
      if (state.epoch !== input.sourceEpoch)
        throw new IntakeError("Source configuration changed", 409);
      if (
        state.attemptAt &&
        Date.parse(input.capturedAt) < Date.parse(state.attemptAt)
      )
        throw new IntakeError("A newer scan has started", 409);
      if (input.status === "ready") {
        const people = await tx.person.findMany({
          where: { userId, archived: false },
        });
        const contacts = await tx.callSheetContact.findMany({
          where: { userId },
        });
        if (
          people.some((person) => {
            const contact = contacts.find(
              (item) => item.personId === person.id,
            );
            return (
              !contact ||
              contact.identityKey !== identityKey(person) ||
              !fresh(
                readSourceData(contact.sourceData)[input.source]?.capturedAt,
                now,
              )
            );
          })
        )
          throw new IntakeError("Source scan is incomplete", 409);
      }
      sources[input.source] = {
        ...state,
        status: input.status,
        error:
          input.status === "error"
            ? "The local source could not finish syncing. Check the connector and try again."
            : null,
        attemptAt: input.capturedAt,
        lastSuccessAt:
          input.status === "ready" ? input.capturedAt : state.lastSuccessAt,
      };
      await tx.callSheetSettings.update({
        where: { userId },
        data: { sources: json(sources) },
      });
      return { ok: true, extracted: false };
    });
  }
  const revision = createHash("sha256")
    .update(
      JSON.stringify([
        input.identityKey,
        input.handles,
        input.coverageStart,
        input.lastContactAt,
        input.messageCount,
        input.messages,
      ]),
    )
    .digest("hex");
  const initial = await ownerTransaction(userId, async (tx) => {
    const { sources } = await validatePerson(tx, userId, input);
    const previous = await tx.callSheetContact.findUnique({
      where: { userId_personId: { userId, personId: input.personId } },
    });
    const sourceData =
      previous?.identityKey === input.identityKey
        ? readSourceData(previous.sourceData)
        : {};
    const prior = sourceData[input.source];
    if (prior && Date.parse(prior.capturedAt) > Date.parse(input.capturedAt))
      throw new IntakeError("Newer evidence is already available", 409);
    const unchanged =
      prior?.lastContactAt === input.lastContactAt &&
      prior?.messageCount === input.messageCount &&
      JSON.stringify([...(prior?.handles ?? [])].sort()) ===
        JSON.stringify([...input.handles].sort());
    sourceData[input.source] = {
      capturedAt: input.capturedAt,
      coverageStart: input.coverageStart,
      lastContactAt: input.lastContactAt,
      messageCount: input.messageCount,
      handles: input.handles,
      revision,
      cues: unchanged ? liveCues(prior?.cues ?? [], now, input.source) : [],
      extractionPending:
        input.extract === false && unchanged
          ? (prior?.extractionPending ?? true)
          : true,
    };
    await tx.callSheetContact.upsert({
      where: { userId_personId: { userId, personId: input.personId } },
      create: {
        userId,
        personId: input.personId,
        identityKey: input.identityKey,
        sourceData: json(sourceData),
      },
      update: { identityKey: input.identityKey, sourceData: json(sourceData) },
    });
    return { epoch: sources[input.source].epoch };
  });
  if (input.extract === false) return { ok: true, extracted: false };
  let cues: EvidenceCue[];
  try {
    cues = input.messages.length
      ? grounded(
          await extractCallSheetCues(input.messages, input.source, now),
          input,
          now,
        )
      : [];
  } catch {
    return { ok: true, extracted: false };
  }
  // The model ran without a transaction/lock. Recheck ALL authorization and identity constraints.
  return ownerTransaction(userId, async (tx) => {
    const { sources } = await validatePerson(tx, userId, input);
    if (sources[input.source].epoch !== initial.epoch)
      throw new IntakeError("Source configuration changed", 409);
    const contact = await tx.callSheetContact.findUnique({
      where: { userId_personId: { userId, personId: input.personId } },
    });
    if (!contact || contact.identityKey !== input.identityKey)
      throw new IntakeError("Person identity changed", 409);
    const sourceData = readSourceData(contact.sourceData);
    const data = sourceData[input.source];
    if (
      !data ||
      data.revision !== revision ||
      data.capturedAt !== input.capturedAt
    )
      return { ok: true, extracted: false };
    sourceData[input.source] = { ...data, cues, extractionPending: false };
    await tx.callSheetContact.update({
      where: { id: contact.id },
      data: { sourceData: json(sourceData) },
    });
    return { ok: true, extracted: true };
  });
}
