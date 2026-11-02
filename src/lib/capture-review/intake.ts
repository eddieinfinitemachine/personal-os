import type { Prisma } from "@prisma/client";
import type { CallSheetProposal } from "@/lib/smart-capture";
import { checkReminderDate } from "@/lib/call-sheet/service";
import { displayName, matchPerson } from "@/lib/call-sheet/resolve-person";
import { identityKey, isLocalDate, localDate } from "@/lib/call-sheet/policy";
import { formatReminderDate } from "@/lib/call-sheet/reminder-capture";
import { listAccessWhere } from "@/lib/list-access";
import { captureHash, captureKey, type CaptureMeta } from "./record";
import { CaptureReviewError, type CaptureSource, type ReviewInput, type ReviewPlacement } from "./types";

export function normalizeCaptureInput(value: unknown): ReviewInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CaptureReviewError(400, "Invalid capture input.");
  const input = value as Record<string, unknown>;
  if (input.text !== undefined && (typeof input.text !== "string" || input.text.length > 50_000)) throw new CaptureReviewError(400, "Capture text must be 50,000 characters or fewer.");
  const url = (v: unknown): string | null => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v !== "string" || v.length > 8192) throw new CaptureReviewError(400, "Invalid capture URL.");
    try { const parsed = new URL(v); if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(); return parsed.href; } catch { throw new CaptureReviewError(400, "Invalid capture URL."); }
  };
  if (input.files !== undefined && (!Array.isArray(input.files) || input.files.length > 10)) throw new CaptureReviewError(400, "Capture up to ten files.");
  const files = (Array.isArray(input.files) ? input.files : []).map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new CaptureReviewError(400, "Invalid captured file.");
    const file = item as Record<string, unknown>, link = url(file.url);
    if (!link) throw new CaptureReviewError(400, "A captured file URL is required.");
    if (file.size != null && (typeof file.size !== "number" || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 50 * 1024 * 1024)) throw new CaptureReviewError(400, "Invalid captured file size.");
    if (file.mimeType != null && (typeof file.mimeType !== "string" || file.mimeType.length > 200 || /[\r\n]/.test(file.mimeType))) throw new CaptureReviewError(400, "Invalid captured file type.");
    return { name: typeof file.name === "string" ? file.name.slice(0, 160) || "Shared file" : "Shared file", url: link, size: typeof file.size === "number" ? file.size : null, mimeType: typeof file.mimeType === "string" ? file.mimeType : null };
  });
  return { text: typeof input.text === "string" ? input.text : "", url: url(input.url), files };
}

export function intakeMeta(request: Request, userId: string, namespace: string, input: ReviewInput, source: CaptureSource, requestId?: unknown, hashInput: unknown = input): CaptureMeta {
  return { id: captureKey(userId, namespace, request.headers.get("X-Capture-ID") ?? requestId), userId, source, requestHash: captureHash(hashInput), input };
}
export async function captureResponse(tx: Prisma.TransactionClient, userId: string, placement: ReviewPlacement, mode: "web" | "auto" | "legacy", extras: { created?: boolean; createdPersons?: unknown[]; routedByAlias?: boolean } = {}): Promise<Record<string, unknown>> {
  const { type, id } = placement;
  if (placement.missing) return { ok: true, type, id, removed: true, placement };
  const todo = type === "todo" ? await tx.todo.findFirst({ where: { id, userId, list: listAccessWhere(userId) } }) : null;
  if (mode === "legacy") return todo ? { ok: true, todo } : { ok: true, type, id, placement };
  const companionTodoId = placement.related?.find(item => item.type === "todo" && !item.missing)?.id ?? null;
  if (mode === "auto") return { ok: true, type, id, ...(type === "asset" ? { assetKind: placement.assetKind } : {}), ...(["asset", "person", "interaction"].includes(type) ? { companionTodoId } : {}), ...(extras.routedByAlias && todo ? { todo, routedByAlias: true } : {}) };
  if (type === "todo") return { todo };
  if (type === "asset") {
    const followupTodo = companionTodoId ? await tx.todo.findFirst({ where: { id: companionTodoId, userId, list: listAccessWhere(userId) }, select: { id: true, title: true } }) : null;
    return { asset: await tx.asset.findFirst({ where: { id, userId } }), followupTodo };
  }
  if (type === "person") return { person: await tx.person.findFirst({ where: { id, userId } }), created: extras.created ?? false };
  if (type === "trip") return { trip: await tx.trip.findFirst({ where: { id, userId } }) };
  if (type === "interaction") return { interaction: await tx.interaction.findFirst({ where: { id, userId } }), createdPersons: extras.createdPersons ?? [] };
  return { ok: true, type, id, placement };
}
export class CallSheetIntakeError extends CaptureReviewError {
  constructor(status: number, message: string, public candidates?: string[]) { super(status, message); }
}
/** Uses the caller's tracked transaction; the existing global reminder helper must not be called here. */
export async function commitCallSheetCapture(tx: Prisma.TransactionClient, userId: string, proposal: CallSheetProposal, now = new Date()) {
  if (typeof proposal.firstName !== "string" || !proposal.firstName.trim() || proposal.firstName.length > 2000 || (proposal.lastName != null && typeof proposal.lastName !== "string") || (proposal.note != null && typeof proposal.note !== "string")) throw new CaptureReviewError(400, "Invalid call sheet reminder.");
  if (!isLocalDate(proposal.date)) throw new CaptureReviewError(400, "Choose a valid date.");
  const note = proposal.note?.trim() || null;
  if (note && note.length > 200) throw new CaptureReviewError(400, "Keep the note to 200 characters.");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`call-sheet:${userId}`}))`;
  const settings = await tx.callSheetSettings.findUnique({ where: { userId }, select: { timezone: true } });
  const timezone = settings?.timezone ?? "America/New_York";
  try { checkReminderDate(proposal.date, timezone, now); } catch (error) { throw new CaptureReviewError(400, error instanceof Error ? error.message : "Invalid reminder date."); }
  const firstName = proposal.firstName.trim().replace(/\s+/g, " ");
  const lastName = proposal.lastName?.trim().replace(/\s+/g, " ") || null;
  const people = await tx.person.findMany({ where: { userId, archived: false, firstName: { startsWith: firstName.split(" ")[0], mode: "insensitive" } } });
  const match = matchPerson(people, { firstName, lastName });
  if (match.kind === "ambiguous") {
    const candidates = match.candidates.map(displayName);
    throw new CallSheetIntakeError(409, `More than one person is called ${displayName({ firstName, lastName })}: ${candidates.join(", ")}. Use their full name.`, candidates);
  }
  const person = match.kind === "match" ? people.find(item => item.id === match.person.id)! : await tx.person.create({ data: { userId, firstName, lastName } });
  const values = { dueOn: proposal.date, dueNote: note, snoozedUntil: null, excludedAt: null };
  await tx.callSheetContact.upsert({ where: { userId_personId: { userId, personId: person.id } }, create: { userId, personId: person.id, identityKey: identityKey(person), ...values }, update: values });
  const name = displayName(person);
  const message = proposal.date === localDate(now, timezone) ? `${name} is on your call sheet today` : `${name} will be on your call sheet ${formatReminderDate(proposal.date)}`;
  const result = { personId: person.id, name, dueOn: proposal.date, note, created: match.kind === "none", message };
  return { result, placement: { type: "call_sheet" as const, id: person.id, title: name, destination: "Call sheet", path: "/call-sheet" } };
}
export async function callSheetResponse(tx: Prisma.TransactionClient, userId: string, placement: ReviewPlacement, mode: "web" | "auto") {
  if (placement.type !== "call_sheet") return captureResponse(tx, userId, placement, mode);
  const contact = await tx.callSheetContact.findFirst({ where: { userId, personId: placement.id } });
  const callSheet = { personId: placement.id, name: placement.title, dueOn: contact?.dueOn ?? null, note: contact?.dueNote ?? null, created: false };
  const message = `Saved call sheet reminder for ${placement.title}`;
  return mode === "web" ? { callSheet, message } : { ok: true, type: "call_sheet", id: placement.id, dueOn: callSheet.dueOn, created: false, message };
}
