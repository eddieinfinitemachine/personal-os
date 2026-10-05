import { IntakeError, object } from "@/lib/dating-intake/contracts";

// EC Pad (Mac) reads the owner's notes, finds activities with existing CRM
// people and sends them here (POST /api/capture/activities). Each activity has
// a stable externalKey so re-sends upsert and edits can delete what vanished.

export const ACTIVITY_LIMITS = {
  maxBodyBytes: 160_000,
  maxActivities: 100,
  maxDeleted: 500,
  maxPeople: 20,
  maxTitle: 120,
  maxNotes: 600,
  maxSourceTitle: 200,
  maxSourceRef: 1000,
} as const;
export const ACTIVITY_KINDS = ["dinner", "call", "meeting", "event", "message", "other"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export const ECPAD_SOURCE = "ecpad";
const KEY = /^ecpad:[a-f0-9]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const DAY_MS = 86_400_000;
const FIVE_YEARS_MS = 5 * 365.25 * DAY_MS;

export type ActivityInput = {
  externalKey: string;
  personIds: string[];
  occurredAt: Date;
  kind: ActivityKind;
  title: string;
  notes: string | null;
  sourceTitle: string | null;
  sourceRef: string | null;
};
export type ActivitiesCapture = { activities: ActivityInput[]; deleted: string[] };

function fields(value: Record<string, unknown>, allowed: readonly string[]) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new IntakeError(`Unknown field: ${unknown.slice(0, 40)}`);
}
function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new IntakeError(`${field} is required`);
  if (value.length > max) throw new IntakeError(`${field} is too long`);
  return value.trim();
}
function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new IntakeError(`${field} must be text`);
  if (value.length > max) throw new IntakeError(`${field} is too long`);
  return value.trim() || null;
}
function key(value: unknown): string {
  if (typeof value !== "string" || !KEY.test(value)) throw new IntakeError("Invalid externalKey");
  return value;
}
function occurredAt(value: unknown, now: Date): Date {
  const parsed = typeof value === "string" && ISO.test(value) ? Date.parse(value) : NaN;
  if (
    !Number.isFinite(parsed) ||
    // Reject rollovers such as 2026-02-31.
    new Date(parsed).toISOString().slice(0, 19) !== (value as string).slice(0, 19)
  )
    throw new IntakeError("occurredAt must be an ISO-8601 UTC timestamp");
  if (parsed > now.getTime() + DAY_MS || parsed < now.getTime() - FIVE_YEARS_MS)
    throw new IntakeError("occurredAt is out of range");
  return new Date(parsed);
}

/** Validates the request body; ownership of personIds is checked by the caller. */
export function parseActivitiesCapture(raw: unknown, now = new Date()): ActivitiesCapture {
  const input = object(raw);
  fields(input, ["activities", "deleted"]);
  const rawActivities = input.activities ?? [];
  const rawDeleted = input.deleted ?? [];
  if (!Array.isArray(rawActivities)) throw new IntakeError("activities must be a list");
  if (!Array.isArray(rawDeleted)) throw new IntakeError("deleted must be a list");
  if (rawActivities.length > ACTIVITY_LIMITS.maxActivities)
    throw new IntakeError(`Maximum ${ACTIVITY_LIMITS.maxActivities} activities per request`, 413);
  if (rawDeleted.length > ACTIVITY_LIMITS.maxDeleted)
    throw new IntakeError(`Maximum ${ACTIVITY_LIMITS.maxDeleted} deleted keys per request`, 413);
  if (!rawActivities.length && !rawDeleted.length) throw new IntakeError("Nothing to save");

  const activities = rawActivities.map((rawActivity): ActivityInput => {
    const a = object(rawActivity);
    fields(a, ["externalKey", "personIds", "occurredAt", "kind", "title", "notes", "sourceTitle", "sourceRef"]);
    if (!Array.isArray(a.personIds) || !a.personIds.length || a.personIds.length > ACTIVITY_LIMITS.maxPeople)
      throw new IntakeError(`personIds must list 1 to ${ACTIVITY_LIMITS.maxPeople} people`);
    const personIds = a.personIds.map((id) => text(id, "personId", 200));
    if (new Set(personIds).size !== personIds.length) throw new IntakeError("Duplicate personId");
    if (!ACTIVITY_KINDS.includes(a.kind as ActivityKind)) throw new IntakeError("Invalid kind");
    const sourceRef = optionalText(a.sourceRef, "sourceRef", ACTIVITY_LIMITS.maxSourceRef);
    if (sourceRef && !sourceRef.startsWith("ecpad://note/")) throw new IntakeError("Invalid sourceRef");
    return {
      externalKey: key(a.externalKey),
      personIds,
      occurredAt: occurredAt(a.occurredAt, now),
      kind: a.kind as ActivityKind,
      title: text(a.title, "title", ACTIVITY_LIMITS.maxTitle),
      notes: optionalText(a.notes, "notes", ACTIVITY_LIMITS.maxNotes),
      sourceTitle: optionalText(a.sourceTitle, "sourceTitle", ACTIVITY_LIMITS.maxSourceTitle),
      sourceRef,
    };
  });
  const deleted = rawDeleted.map(key);
  const keys = [...activities.map((a) => a.externalKey), ...deleted];
  if (new Set(keys).size !== keys.length) throw new IntakeError("Each externalKey may appear only once");
  return { activities, deleted };
}

/** The Interaction fields written for one activity (shared by create and update). */
export function interactionData(activity: ActivityInput) {
  return {
    occurredAt: activity.occurredAt,
    kind: activity.kind,
    title: activity.title,
    // There is no column for the note link; name the note so the row explains itself.
    notes:
      [activity.notes, activity.sourceTitle ? `From EC Pad: ${activity.sourceTitle}` : null]
        .filter(Boolean)
        .join("\n\n") || null,
    personIds: activity.personIds,
  };
}
