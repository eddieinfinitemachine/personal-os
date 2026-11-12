import type { Prisma } from "@prisma/client";
import type { CaptureProposal } from "@/lib/smart-capture";
import { requireListWrite } from "./access";
import { DEFAULT_LISTS, CAPTURE_LIST_NAME, INBOX_PROJECT_NAME } from "@/lib/lists";
import { nextTodoPosition } from "@/lib/todo-position";
import { ASSET_PLACES as ASSET_DESTINATIONS, CaptureReviewError, type ReviewPlacement } from "./types";
export type CoreProposal = Extract<CaptureProposal, { type: "todo" | "asset" | "person" | "trip" | "interaction" }>;
export interface StoredCaptureFile { file: Pick<File, "name" | "type" | "size">; url: string; attachmentId?: string }
type Tx = Prisma.TransactionClient;
const VISION_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
function fail(message: string): never { throw new CaptureReviewError(400, message); }
function httpUrl(value: unknown) {
  if (value == null || value === "") return;
  if (typeof value !== "string" || value.length > 8192) fail("Invalid capture URL.");
  try { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) fail("Invalid capture URL."); } catch { fail("Invalid capture URL."); }
}
function date(value: string | null | undefined): Date | null {
  if (!value) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) fail("Invalid capture date.");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || new Date(value.slice(0, 10)).toISOString().slice(0, 10) !== value.slice(0, 10)) fail("Invalid capture date.");
  return parsed;
}
export function validateCoreProposal(value: unknown): asserts value is CoreProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Proposal required.");
  const p = value as Record<string, unknown>;
  if (!["todo", "asset", "person", "trip", "interaction"].includes(String(p.type))) fail("Unknown capture type.");
  const title = p.type === "person" ? p.firstName : p.type === "trip" ? p.name : p.title;
  if (typeof title !== "string" || !title.trim() || title.length > 2000) fail("A capture title is required.");
  const strings = ["title", "name", "firstName", "lastName", "subtitle", "category", "status", "location", "sourceVendor", "notes", "projectId", "listName", "role", "company", "city", "country", "howWeMet", "email", "phone", "strength", "destination", "transport", "accommodation"];
  for (const key of strings) if (p[key] != null && (typeof p[key] !== "string" || (p[key] as string).length > (key === "notes" ? 100_000 : 2000))) fail(`Invalid ${key}.`);
  for (const key of ["costBasis", "currentValue", "amountUsd", "rating", "costUsd"]) if (p[key] != null && (typeof p[key] !== "number" || !Number.isFinite(p[key]))) fail(`Invalid ${key}.`);
  for (const key of ["dueDate", "acquiredAt", "birthday", "startDate", "endDate", "occurredAt"]) if (p[key] != null) date(p[key] as string);
  for (const key of ["url", "photoUrl", "bookingUrl"]) httpUrl(p[key]);
  for (const key of ["circles", "interests", "travelers"]) if (p[key] !== undefined && (!Array.isArray(p[key]) || p[key].length > 100 || p[key].some(x => typeof x !== "string" || x.length > 2000))) fail(`Invalid ${key}.`);
  if (p.routedByAlias !== undefined && typeof p.routedByAlias !== "boolean") fail("Invalid alias routing.");
  if (p.type === "asset" && !Object.hasOwn(ASSET_DESTINATIONS, String(p.assetKind))) fail("Unknown asset destination.");
  if (p.type === "interaction") {
    if (!["dinner", "call", "meeting", "event", "message", "other"].includes(String(p.kind)) || !p.occurredAt || !Array.isArray(p.personHints) || p.personHints.length > 100) fail("Invalid interaction.");
    for (const hint of p.personHints) {
      if (!hint || typeof hint !== "object" || typeof hint.firstName !== "string" || !hint.firstName.trim() || hint.firstName.length > 2000 || (hint.lastName != null && (typeof hint.lastName !== "string" || hint.lastName.length > 2000))) fail("Invalid interaction person.");
    }
  }
  if (p.type === "person" && p.strength != null && !["close", "strong", "casual", "weak"].includes(String(p.strength))) fail("Invalid relationship strength.");
  if (p.type === "trip" && p.status != null && !["planned", "booked", "active", "past", "cancelled"].includes(String(p.status))) fail("Invalid trip status.");
  if (p.followupTodo != null) {
    const task = p.followupTodo as Record<string, unknown>;
    if (typeof task !== "object" || Array.isArray(task) || typeof task.title !== "string" || !task.title.trim() || task.title.length > 2000 || (task.listName != null && typeof task.listName !== "string")) fail("Invalid follow-up task.");
  }
  if (p.socialUrls != null) {
    if (typeof p.socialUrls !== "object" || Array.isArray(p.socialUrls)) fail("Invalid social links.");
    for (const url of Object.values(p.socialUrls)) httpUrl(url);
  }
  if (p.details != null) {
    if (typeof p.details !== "object" || Array.isArray(p.details)) fail("Invalid asset details.");
    const check = (v: unknown, depth: number): void => {
      if (depth > 8) fail("Asset details are too deeply nested.");
      if (v == null || typeof v === "boolean" || typeof v === "string") return;
      if (typeof v === "number" && Number.isFinite(v)) return;
      if (typeof v !== "object") fail("Invalid asset details.");
      for (const [key, item] of Object.entries(v)) { if (/url$/i.test(key)) httpUrl(item); check(item, depth + 1); }
    };
    check(p.details, 0);
    if (JSON.stringify(p.details).length > 50_000) fail("Asset details are too long.");
  }
}
function joinNotes(...parts: Array<string | null | undefined>): string | null {
  const kept: string[] = [];
  for (const part of parts) if (part?.trim() && !kept.some(existing => existing.includes(part.trim()))) kept.push(part.trim());
  return kept.join("\n\n") || null;
}
async function ensureList(tx: Tx, userId: string, name: string) {
  const existing = await tx.list.findFirst({ where: { userId, name: { equals: name, mode: "insensitive" } } });
  if (existing) return existing;
  const defaults = DEFAULT_LISTS.find(item => item.name === name);
  if (!defaults) throw new CaptureReviewError(404, "The selected list no longer exists.");
  return tx.list.create({ data: { ...defaults, userId, isDefault: true } });
}
async function inboxTodo(tx: Tx, userId: string, title: string, notes: string | null, explicitProjectId?: string | null, dueDate: Date | null = null, createdAt?: Date) {
  const list = await ensureList(tx, userId, CAPTURE_LIST_NAME);
  let projectId = explicitProjectId;
  if (projectId === undefined) {
    let project = await tx.project.findFirst({ where: { userId, name: { equals: INBOX_PROJECT_NAME, mode: "insensitive" } } });
    if (!project) project = await tx.project.create({ data: { userId, name: INBOX_PROJECT_NAME, icon: "Inbox", color: "neutral", position: 0 } });
    projectId = project.id;
  }
  return tx.todo.create({ data: { userId, title, notes, listId: list.id, position: await nextTodoPosition(tx, list.id), projectId, dueDate, ...(createdAt ? { createdAt } : {}) } });
}

export async function commitCore(tx: Tx, userId: string, input: { text: string; url: string | null }, proposal: CoreProposal, stored: StoredCaptureFile[], options: { mode?: "mobile" | "web" | "auto" | "correction"; listId?: string | null; projectId?: string | null; autoFollowup?: boolean; createdAt?: Date } = {}): Promise<ReviewPlacement & { ok: true }> {
  validateCoreProposal(proposal);
  if (typeof input.text !== "string" || input.text.length > 100_000) fail("Invalid original capture text.");
  httpUrl(input.url);
  const mode = options.mode ?? "mobile";
  // Preflight transfers and explicit destinations before creating any records.
  for (const item of stored) {
    httpUrl(item.url);
    if (item.attachmentId) {
      const attachment = await tx.attachment.findFirst({ where: { id: item.attachmentId, userId } });
      if (!attachment || attachment.url !== item.url) throw new CaptureReviewError(409, "The original file is no longer available.");
    }
  }
  const explicitList = options.listId ? await requireListWrite(tx, userId, options.listId) : null;
  if (options.listId && !explicitList) throw new CaptureReviewError(404, "List not found.");
  const requestedProjectId = options.projectId !== undefined ? options.projectId : (proposal.type === "asset" || proposal.type === "interaction" ? proposal.projectId : null);
  const ownedProject = requestedProjectId ? await tx.project.findFirst({ where: { id: requestedProjectId, userId, archived: false }, select: { id: true } }) : null;
  if (options.projectId && !ownedProject) throw new CaptureReviewError(404, "Project not found.");
  const projectId = ownedProject?.id ?? null;
  const related: ReviewPlacement[] = [];
  async function companion(title: string, notes: string | null, toLater = false) {
    let todo;
    if (toLater) {
      const later = await ensureList(tx, userId, "Later");
      todo = await tx.todo.create({ data: { userId, title, notes, listId: later.id, position: await nextTodoPosition(tx, later.id), projectId } });
    } else todo = await inboxTodo(tx, userId, title, notes, mode === "auto" ? projectId : undefined);
    related.push({ type: "todo", id: todo.id, title: todo.title, destination: toLater ? "Later" : CAPTURE_LIST_NAME, path: "/" });
    return todo;
  }
  const imageUrl = stored.find(item => VISION_TYPES.has(item.file.type.toLowerCase()))?.url ?? ("photoUrl" in proposal ? proposal.photoUrl ?? null : null);
  const original = input.text ? `Shared text:\n${input.text}` : null;
  const fileLinks = stored.length ? `Shared files:\n${stored.map(item => `${item.file.name}: ${item.url}`).join("\n")}` : null;
  const notes = joinNotes(proposal.notes, original, input.url, fileLinks);
  let result: ReviewPlacement & { ok: true };
  let attachmentOwner: { todoId: string } | { assetId: string };

  if (proposal.type === "todo") {
    let todo;
    if (explicitList || (proposal.routedByAlias && proposal.listName)) {
      const list = explicitList ?? await ensureList(tx, userId, proposal.listName!);
      todo = await tx.todo.create({ data: { userId, title: proposal.title, notes, listId: list.id, position: await nextTodoPosition(tx, list.id), projectId, dueDate: date(proposal.dueDate) } });
      result = { ok: true, id: todo.id, type: "todo", title: todo.title, destination: list.name, path: "/" };
    } else {
      todo = await inboxTodo(tx, userId, proposal.title, notes, options.projectId !== undefined ? projectId : undefined, date(proposal.dueDate), options.createdAt);
      result = { ok: true, id: todo.id, type: "todo", title: todo.title, destination: CAPTURE_LIST_NAME, path: "/" };
    }
    attachmentOwner = { todoId: todo.id };
  } else if (proposal.type === "asset") {
    const destination = ASSET_DESTINATIONS[proposal.assetKind];
    const asset = await tx.asset.create({ data: {
      userId, kind: proposal.assetKind, title: proposal.title, subtitle: proposal.subtitle ?? null,
      category: proposal.category ?? null, status: proposal.status ?? destination.status,
      costBasis: proposal.costBasis ?? null, currentValue: proposal.currentValue ?? null,
      amountUsd: proposal.amountUsd ?? null, rating: proposal.rating ?? null, location: proposal.location ?? null,
      acquiredAt: date(proposal.acquiredAt) ?? (mode === "web" && proposal.assetKind === "inventory" && (proposal.status ?? "owned") === "owned" ? new Date() : null), url: mode === "mobile" ? input.url ?? proposal.url ?? null : proposal.url ?? input.url ?? null, imageUrl, notes, projectId,
      detailsJson: { ...(proposal.details ?? {}), source: mode === "mobile" ? "mobile-capture" : mode === "auto" ? "smart-capture-auto" : "smart-capture", sourceVendor: proposal.sourceVendor ?? null } as Prisma.InputJsonValue,
    } });
    result = { ok: true, id: asset.id, type: "asset", assetKind: proposal.assetKind, title: asset.title, destination: destination.destination, path: destination.path };
    attachmentOwner = { assetId: asset.id };
    if (mode !== "auto" && proposal.followupTodo?.title) {
      if (mode === "correction" && proposal.followupTodo.listName) {
        const list = await ensureList(tx, userId, proposal.followupTodo.listName);
        const todo = await tx.todo.create({ data: { userId, title: proposal.followupTodo.title, notes: joinNotes(`Related ${destination.destination} record: ${asset.id}`, destination.path, input.url), listId: list.id, position: await nextTodoPosition(tx, list.id), projectId } });
        related.push({ type: "todo", id: todo.id, title: todo.title, destination: list.name, path: "/" });
      } else await companion(proposal.followupTodo.title, joinNotes(`Related ${destination.destination} record: ${asset.id}`, destination.path, input.url));
    } else if (options.autoFollowup !== false && mode !== "web" && ["media", "place"].includes(proposal.assetKind) && ["to-read", "to-watch", "to-listen", "wishlist", "in-progress"].includes(asset.status ?? "")) {
      const format = String(proposal.details?.format ?? "").toLowerCase();
      const verb = proposal.assetKind === "place" ? "Try" : ["film", "show", "video"].includes(format) ? "Watch" : ["podcast", "album"].includes(format) ? "Listen" : mode === "auto" && !["book", "essay", "article"].includes(format) ? "Read/watch" : "Read";
      const companionNotes = mode === "auto"
        ? joinNotes(proposal.url ?? input.url, proposal.notes, `Related record: ${asset.id}`, destination.path)
        : joinNotes(input.url ?? proposal.url, `Related record: ${asset.id}`, destination.path);
      await companion(`${verb}: ${asset.title}`, companionNotes, true);
    }
  } else if (proposal.type === "person") {
    const firstName = proposal.firstName.trim();
    const lastName = proposal.lastName?.trim() || null;
    const existing = mode === "auto" ? null : await tx.person.findFirst({ where: { userId, firstName: { equals: firstName, mode: "insensitive" }, lastName: lastName ? { equals: lastName, mode: "insensitive" } : null } });
    const person = existing
      ? await tx.person.update({ where: { id: existing.id }, data: {
          ...(mode === "correction" && existing.archived ? { archived: false } : {}),
          role: existing.role || proposal.role || null, company: existing.company || proposal.company || null,
          city: existing.city || proposal.city || null, country: existing.country || proposal.country || null,
          email: existing.email || proposal.email || null, phone: existing.phone || proposal.phone || null,
          howWeMet: existing.howWeMet || proposal.howWeMet || null, strength: existing.strength || proposal.strength || null,
          imageUrl: existing.imageUrl || imageUrl, notes: joinNotes(existing.notes, notes),
          circles: existing.circles.length ? existing.circles : proposal.circles ?? [],
          interests: existing.interests.length ? existing.interests : proposal.interests ?? [],
          birthday: existing.birthday || date(proposal.birthday),
          ...(proposal.socialUrls && !existing.socialUrls ? { socialUrls: proposal.socialUrls } : {}),
        } })
      : await tx.person.create({ data: {
          userId, firstName, lastName, role: proposal.role ?? null, company: proposal.company ?? null,
          city: proposal.city ?? null, country: proposal.country ?? null, howWeMet: proposal.howWeMet ?? null,
          socialUrls: proposal.socialUrls ?? undefined, interests: proposal.interests ?? [],
          email: proposal.email ?? null, phone: proposal.phone ?? null, strength: proposal.strength ?? null,
          circles: proposal.circles ?? [], notes, imageUrl, birthday: date(proposal.birthday),
        } });
    const title = [firstName, lastName].filter(Boolean).join(" ");
    result = { ok: true, id: person.id, type: "person", title, destination: "People", path: "/friends" };
    const todo = mode !== "web" || stored.length ? await companion(`Follow up with ${title}`, joinNotes(`Related person: ${person.id}`, "/friends", notes)) : null;
    attachmentOwner = { todoId: todo?.id ?? "" };
  } else if (proposal.type === "trip") {
    const trip = await tx.trip.create({ data: {
      userId, name: proposal.name, destination: proposal.destination ?? null, startDate: date(proposal.startDate), endDate: date(proposal.endDate),
      status: proposal.status ?? "planned", travelers: proposal.travelers ?? [], transport: proposal.transport ?? null,
      accommodation: proposal.accommodation ?? null, costUsd: proposal.costUsd ?? null,
      bookingUrl: mode === "mobile" ? input.url ?? proposal.bookingUrl ?? null : proposal.bookingUrl ?? input.url ?? null, notes, imageUrl,
    } });
    result = { ok: true, id: trip.id, type: "trip", title: trip.name, destination: "Trips", path: `/trips/${trip.id}` };
    const todo = stored.length ? await companion(`Files for ${trip.name}`, joinNotes(`Related trip: ${trip.id}`, result.path, notes)) : null;
    attachmentOwner = { todoId: todo?.id ?? "" };
  } else {
    const occurredAt = date(proposal.occurredAt)!;
    const personIds: string[] = [];
    for (const hint of proposal.personHints) {
      const firstName = hint.firstName?.trim();
      if (!firstName) continue;
      const lastName = hint.lastName?.trim() || null;
      let person = await tx.person.findFirst({ where: { userId, firstName: { equals: firstName, mode: "insensitive" }, lastName: lastName ? { equals: lastName, mode: "insensitive" } : null } });
      if (!person) person = await tx.person.create({ data: { userId, firstName, lastName } });
      else if (mode === "correction" && person.archived) person = await tx.person.update({ where: { id: person.id }, data: { archived: false } });
      if (!personIds.includes(person.id)) personIds.push(person.id);
    }
    const interaction = await tx.interaction.create({ data: {
      userId, title: proposal.title, kind: proposal.kind, occurredAt, location: proposal.location ?? null,
      notes, photoUrl: imageUrl, personIds, projectId, source: mode === "mobile" ? "mobile-capture" : mode === "auto" ? "smart-capture-auto" : "smart-capture",
    } });
    if (personIds.length) await tx.person.updateMany({ where: { userId, id: { in: personIds }, OR: [{ lastInteractionAt: null }, { lastInteractionAt: { lt: occurredAt } }] }, data: { lastInteractionAt: occurredAt } });
    result = { ok: true, id: interaction.id, type: "interaction", title: interaction.title, destination: "People", path: "/friends" };
    const todo = mode !== "web" || stored.length ? await companion(proposal.title, joinNotes(`Related interaction: ${interaction.id}`, result.path, notes)) : null;
    attachmentOwner = { todoId: todo?.id ?? "" };
  }
  for (const item of stored) {
    if (item.attachmentId) {
      await tx.attachment.update({ where: { id: item.attachmentId }, data: { todoId: null, projectId: null, assetId: null, ...attachmentOwner } });
      continue;
    }
    await tx.attachment.create({ data: { userId, ...attachmentOwner, kind: "file", title: item.file.name || "Shared file", url: item.url, mimeType: item.file.type || null, size: item.file.size } });
  }
  return { ...result, ...(related.length ? { related } : {}) };
}
