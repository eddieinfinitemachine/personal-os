import type { CaptureReview, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { listAccessWhere } from "@/lib/list-access";
import type { CaptureProposal } from "@/lib/smart-capture";
import { readEffects } from "./journal";
import { ASSET_PLACES, SOURCE_LABELS, type CaptureReviewItem, type CaptureReviewList, type CaptureSource, type ReviewInput, type ReviewKind, type ReviewListOptions, type ReviewPlacement } from "./types";

type Row = Record<string, unknown>;
type ReadDb = Pick<Prisma.TransactionClient, "captureReview" | "todo" | "asset" | "person" | "trip" | "interaction" | "boardItem" | "readerItem" | "callSheetContact">;
type ReadDelegate = { findMany(args: unknown): Promise<Row[]> };
const CORE = new Set<ReviewKind>(["todo", "asset", "person", "trip", "interaction"]);
const KIND_MODEL = { todo: "todo", asset: "asset", person: "person", trip: "trip", interaction: "interaction", call_sheet: "person", board: "boardItem", reader: "readerItem" } as const;
const string = (r: Row, key: string): string | null => typeof r[key] === "string" ? r[key] as string : null;
const iso = (value: unknown): string | null => value instanceof Date ? value.toISOString() : typeof value === "string" ? value : null;
const object = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const safePath = (v: unknown) => typeof v === "string" && v.startsWith("/") && !v.startsWith("//") && !v.includes("\\") ? v : "/";
const webUrl = (v: unknown) => typeof v === "string" && /^https?:\/\//i.test(v) ? v : null;
export function reviewInput(value: unknown): ReviewInput {
  const r = object(value);
  return { text: typeof r.text === "string" ? r.text : "", url: webUrl(r.url), files: Array.isArray(r.files) ? r.files.slice(0, 10).flatMap(value => {
    const f = object(value), url = webUrl(f.url); if (!url) return [];
    return [{ name: string(f, "name") ?? "Shared file", mimeType: string(f, "mimeType"), size: typeof f.size === "number" ? f.size : null, url, ...(typeof f.attachmentId === "string" ? { attachmentId: f.attachmentId } : {}) }];
  }) : [] };
}
export function storedPlacement(value: unknown): ReviewPlacement {
  const r = object(value), type = typeof r.type === "string" && r.type in KIND_MODEL ? r.type as ReviewKind : "todo";
  return { type, id: string(r, "id") ?? "", title: string(r, "title") ?? "Captured item", destination: string(r, "destination") ?? "Personal OS", path: safePath(r.path), ...(typeof r.assetKind === "string" ? { assetKind: r.assetKind } : {}), ...(Array.isArray(r.related) ? { related: r.related.slice(0, 20).map(storedPlacement) } : {}) };
}

/** Resolve in batches, including ordinary moves/renames made outside the Inbox. */
async function destinationRows(db: ReadDb, userId: string, rows: CaptureReview[]) {
  const ids = new Map<string, Set<string>>();
  for (const row of rows) {
    const p = storedPlacement(row.placement);
    for (const place of [p, ...(p.related ?? [])]) {
      const model = KIND_MODEL[place.type];
      if (!ids.has(model)) ids.set(model, new Set());
      ids.get(model)!.add(place.id);
    }
  }
  const all = new Map<string, Row>();
  await Promise.all([...ids].map(async ([model, values]) => {
    const delegate = db[model as keyof ReadDb] as unknown as ReadDelegate;
    const records = await delegate.findMany({ where: { userId, id: { in: [...values] }, ...(model === "todo" ? { list: listAccessWhere(userId) } : {}) }, ...(model === "todo" ? { include: { list: { select: { name: true, userId: true, isDefault: true, members: { where: { userId }, select: { role: true } } } } } } : model === "asset" ? { include: { project: { select: { name: true } } } } : {}) });
    records.forEach(record => all.set(`${model}:${record.id}`, record));
  }));
  const people = new Set<string>();
  for (const [key, row] of all) if (key.startsWith("interaction:") && Array.isArray(row.personIds)) row.personIds.forEach(id => { if (typeof id === "string") people.add(id); });
  if (people.size) (await db.person.findMany({ where: { userId, id: { in: [...people] } } })).forEach(row => all.set(`person:${row.id}`, row as unknown as Row));
  const callIds = rows.map(row => storedPlacement(row.placement)).filter(p => p.type === "call_sheet").map(p => p.id);
  if (callIds.length) (await db.callSheetContact.findMany({ where: { userId, personId: { in: callIds } } })).forEach(row => all.set(`call_sheet:${row.personId}`, row as unknown as Row));
  return all;
}

function resolvePlacement(place: ReviewPlacement, rows: Map<string, Row>): ReviewPlacement {
  const row = rows.get(`${KIND_MODEL[place.type]}:${place.id}`);
  if (!row) return { ...place, missing: true, related: place.related?.map(p => resolvePlacement(p, rows)) };
  let next = { ...place, missing: false };
  if (place.type === "todo") {
    const list = string(object(row.list), "name") ?? "Tasks";
    next = { ...next, title: string(row, "title") ?? place.title, destination: list, path: "/" };
  } else if (place.type === "asset") {
    const kind = string(row, "kind") as keyof typeof ASSET_PLACES, location = ASSET_PLACES[kind];
    const category = string(row, "category"), project = string(object(row.project), "name");
    next = { ...next, title: string(row, "title") ?? place.title, assetKind: kind, destination: `${location?.destination ?? "Assets"}${category ? ` → ${category}` : ""}${project ? ` · ${project}` : ""}${row.archived ? " (archived)" : ""}`, path: location?.path ?? safePath(place.path) };
  } else if (place.type === "person" || place.type === "call_sheet") {
    const title = [string(row, "firstName"), string(row, "lastName")].filter(Boolean).join(" ");
    const reminder = rows.get(`call_sheet:${place.id}`);
    next = { ...next, title, destination: place.type === "call_sheet" ? `Call Sheet${reminder?.dueOn ? ` · ${reminder.dueOn}` : ""}` : `People${row.archived ? " (archived)" : ""}`, path: place.type === "call_sheet" ? "/call-sheet" : "/friends" };
  } else if (place.type === "trip") next = { ...next, title: string(row, "name") ?? place.title, destination: row.archived ? "Trips (archived)" : "Trips", path: `/trips/${place.id}` };
  else if (place.type === "interaction") next = { ...next, title: string(row, "title") ?? place.title, destination: "People → Interactions", path: "/friends" };
  else if (place.type === "board") next = { ...next, title: string(row, "title") ?? string(row, "siteName") ?? "Board item", destination: `Board → ${string(row, "kind") ?? "link"}`, path: "/board" };
  else if (place.type === "reader") next = { ...next, title: string(row, "title") ?? place.title, destination: row.archivedAt ? "Read Later (archived)" : "Read Later", path: `/reader/${place.id}` };
  return { ...next, related: place.related?.map(p => resolvePlacement(p, rows)) };
}

function currentProposal(kind: ReviewKind, row: Row, original: unknown, rows: Map<string, Row>, related?: ReviewPlacement[]): CaptureProposal | null {
  const old = object(original);
  if (kind === "todo") return { type: "todo", title: String(row.title), notes: string(row, "notes"), dueDate: iso(row.dueDate), listName: string(object(row.list), "name"), projectId: string(row, "projectId"), routedByAlias: true };
  if (kind === "asset") { const task = related?.find(p => p.type === "todo" && !p.missing), todo = task ? rows.get(`todo:${task.id}`) : null; return { ...old, type: "asset", assetKind: row.kind, title: row.title, subtitle: row.subtitle, category: row.category, status: row.status, costBasis: row.costBasis, currentValue: row.currentValue, amountUsd: row.amountUsd, rating: row.rating, location: row.location, acquiredAt: iso(row.acquiredAt), url: row.url, notes: row.notes, projectId: row.projectId, photoUrl: row.imageUrl, details: row.detailsJson, sourceVendor: object(row.detailsJson).sourceVendor ?? null, followupTodo: todo ? { title: todo.title, listName: object(todo.list).name ?? null } : null } as CaptureProposal; }
  if (kind === "person") return { type: "person", firstName: row.firstName, lastName: row.lastName, role: row.role, company: row.company, city: row.city, country: row.country, email: row.email, phone: row.phone, howWeMet: row.howWeMet, strength: row.strength, circles: row.circles, interests: row.interests, birthday: iso(row.birthday), socialUrls: row.socialUrls, notes: row.notes, photoUrl: row.imageUrl } as CaptureProposal;
  if (kind === "trip") return { type: "trip", name: row.name, destination: row.destination, startDate: iso(row.startDate), endDate: iso(row.endDate), status: row.status, travelers: row.travelers, transport: row.transport, accommodation: row.accommodation, costUsd: row.costUsd, bookingUrl: row.bookingUrl, notes: row.notes, photoUrl: row.imageUrl } as CaptureProposal;
  if (kind === "interaction") return { type: "interaction", title: row.title, kind: row.kind, occurredAt: iso(row.occurredAt), location: row.location, notes: row.notes, projectId: row.projectId, photoUrl: row.photoUrl, personHints: (Array.isArray(row.personIds) ? row.personIds : []).flatMap(id => { const person = rows.get(`person:${id}`); return person ? [{ firstName: person.firstName, lastName: person.lastName }] : []; }) } as CaptureProposal;
  if (kind === "call_sheet") { const contact = rows.get(`call_sheet:${row.id}`); return { type: "call_sheet", firstName: String(row.firstName), lastName: string(row, "lastName"), date: typeof contact?.dueOn === "string" ? contact.dueOn : String(old.date ?? ""), note: typeof contact?.dueNote === "string" ? contact.dueNote : null }; }
  return null;
}

export async function serializeReviews(userId: string, reviews: CaptureReview[], db: ReadDb = prisma): Promise<CaptureReviewItem[]> {
  const rows = await destinationRows(db, userId, reviews);
  return reviews.map(review => {
    const stored = storedPlacement(review.placement), placement = resolvePlacement(stored, rows), row = rows.get(`${KIND_MODEL[stored.type]}:${stored.id}`), effects = readEffects(review.effects);
    const source = review.source in SOURCE_LABELS ? review.source as CaptureSource : "quick";
    const fields: CaptureReviewItem["fields"] = {};
    if (row && stored.type === "todo") { fields.listId = string(row, "listId"); fields.projectId = string(row, "projectId"); }
    if (row && stored.type === "board") { for (const key of ["title", "note", "kind"]) fields[key] = string(row, key); }
    if (row && stored.type === "reader") { for (const key of ["title", "byline", "excerpt"]) fields[key] = string(row, key); fields.read = !!row.readAt; fields.archived = !!row.archivedAt; }
    const list = row ? object(row.list) : {};
    const writable = stored.type !== "todo" || list.userId === userId || (!list.isDefault && Array.isArray(list.members) && list.members.some(m => ["editor", "admin"].includes(String(object(m).role))));
    const tracked = !!effects?.writes.length;
    return { id: review.id, source, sourceLabel: SOURCE_LABELS[source], input: reviewInput(review.input), proposal: row ? currentProposal(stored.type, row, review.proposal, rows, placement.related) : null, placement, fields, revision: review.revision, dismissedAt: review.dismissedAt?.toISOString() ?? null, createdAt: review.createdAt.toISOString(), updatedAt: review.updatedAt.toISOString(), correctedAt: effects?.correctedAt ?? null, correctable: !!row && tracked && writable, movable: !!row && tracked && writable && CORE.has(stored.type) };
  });
}
export async function getCaptureReview(userId: string, id: string, db: ReadDb = prisma) {
  const row = await db.captureReview.findFirst({ where: { id, userId } });
  return row ? (await serializeReviews(userId, [row], db))[0] : null;
}
export async function listCaptureReviews(userId: string, options: ReviewListOptions = {}, db: ReadDb = prisma): Promise<CaptureReviewList> {
  const offset = Number.isSafeInteger(options.offset) ? Math.max(0, options.offset!) : 0;
  const limit = Number.isSafeInteger(options.limit) ? Math.max(1, Math.min(50, options.limit!)) : 10;
  const where = { userId, dismissedAt: options.state === "dismissed" ? { not: null } : null };
  const [reviews, total] = await Promise.all([db.captureReview.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: offset, take: limit }), db.captureReview.count({ where })]);
  return { items: await serializeReviews(userId, reviews, db), total, hasMore: offset + reviews.length < total, offset, limit };
}
