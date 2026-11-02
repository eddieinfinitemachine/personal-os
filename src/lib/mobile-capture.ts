import { randomUUID } from "node:crypto";
import { put, del } from "@vercel/blob";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseCapture, type CaptureProposal } from "@/lib/smart-capture";
import { parseAliasToken } from "@/lib/alias";
import { DEFAULT_LISTS, CAPTURE_LIST_NAME, INBOX_PROJECT_NAME } from "@/lib/lists";
import { MOBILE_QUOTA_BYTES, MobileCaptureError, mobileCaptureHash, mobileReceiptId, type MobileCaptureInput } from "./mobile-capture-input";

type MobileProposal = Extract<CaptureProposal, { type: "todo" | "asset" | "person" | "trip" | "interaction" }>;

export interface MobileCaptureResult {
  ok: true;
  id: string;
  type: MobileProposal["type"];
  assetKind?: string;
  title: string;
  destination: string;
  path: string;
}
type Tx = Prisma.TransactionClient;
type StoredFile = { file: File; url: string };
const ASSET_DESTINATIONS: Record<string, { destination: string; path: string; status: string }> = {
  inventory: { destination: "Inventory", path: "/inventory", status: "owned" },
  investment: { destination: "Investments", path: "/investments", status: "active" },
  media: { destination: "Media", path: "/media", status: "wishlist" },
  place: { destination: "Places", path: "/places", status: "wishlist" },
  practice: { destination: "Best practices", path: "/best-practices", status: "active" },
};
const VISION_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function replay(receipt: { requestHash: string; result: unknown }, requestHash: string): MobileCaptureResult {
  if (receipt.requestHash !== requestHash) throw new MobileCaptureError(409, "This requestId was already used for different content. Create a new capture to change its content.");
  return receipt.result as MobileCaptureResult;
}
function date(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new MobileCaptureError(502, "The organizer returned an invalid date. Try again.");
  return parsed;
}
function validateProposal(proposal: CaptureProposal): asserts proposal is MobileProposal {
  if (!proposal || (proposal.type !== "todo" && proposal.type !== "asset" && proposal.type !== "person" && proposal.type !== "trip" && proposal.type !== "interaction")) throw new MobileCaptureError(502, "The organizer returned an unknown record type. Try again.");
  const title = proposal.type === "person" ? proposal.firstName : proposal.type === "trip" ? proposal.name : proposal.title;
  if (typeof title !== "string" || !title.trim() || title.length > 2000) throw new MobileCaptureError(502, "The organizer returned an incomplete result. Try again.");
  if (proposal.type === "asset" && !Object.hasOwn(ASSET_DESTINATIONS, proposal.assetKind)) throw new MobileCaptureError(502, "The organizer returned an unknown destination. Try again.");
  if (proposal.type === "interaction") {
    if (!date(proposal.occurredAt) || !Array.isArray(proposal.personHints)) throw new MobileCaptureError(502, "The organizer returned an incomplete interaction. Try again.");
  }
  if (proposal.type === "todo") date(proposal.dueDate);
  if (proposal.type === "asset") date(proposal.acquiredAt);
  if (proposal.type === "person") date(proposal.birthday);
  if (proposal.type === "trip") { date(proposal.startDate); date(proposal.endDate); }
}
function joinNotes(...parts: Array<string | null | undefined>): string | null {
  return parts.filter((part): part is string => typeof part === "string" && part.trim().length > 0).join("\n\n") || null;
}
async function assertQuota(db: Pick<Tx, "attachment">, userId: string, bytes: number): Promise<void> {
  if (!bytes) return;
  const used = await db.attachment.aggregate({ where: { userId, kind: "file" }, _sum: { size: true } });
  if ((used._sum.size ?? 0) + bytes > MOBILE_QUOTA_BYTES) throw new MobileCaptureError(413, "Storage quota exceeded. Remove some files from Personal OS and retry.");
}
async function ensureList(tx: Tx, userId: string, name: string) {
  const existing = await tx.list.findFirst({ where: { userId, name: { equals: name, mode: "insensitive" } } });
  if (existing) return existing;
  const defaults = DEFAULT_LISTS.find(item => item.name === name);
  if (!defaults) throw new MobileCaptureError(409, "The selected list no longer exists. Try a new capture.");
  return tx.list.create({ data: { ...defaults, userId, isDefault: true } });
}
async function inboxTodo(tx: Tx, userId: string, title: string, notes: string | null) {
  const list = await ensureList(tx, userId, CAPTURE_LIST_NAME);
  let project = await tx.project.findFirst({ where: { userId, name: { equals: INBOX_PROJECT_NAME, mode: "insensitive" } } });
  if (!project) project = await tx.project.create({ data: { userId, name: INBOX_PROJECT_NAME, icon: "Inbox", color: "neutral", position: 0 } });
  return tx.todo.create({ data: { userId, title, notes, listId: list.id, projectId: project.id } });
}

export async function captureMobile(userId: string, input: MobileCaptureInput): Promise<MobileCaptureResult> {
  const id = mobileReceiptId(userId, input.requestId);
  const requestHash = await mobileCaptureHash(input);
  const previous = await prisma.mobileCaptureReceipt.findFirst({ where: { id, userId } });
  if (previous) return replay(previous, requestHash);
  const fileBytes = input.files.reduce((sum, file) => sum + file.size, 0);
  await assertQuota(prisma, userId, fileBytes);
  const projects = await prisma.project.findMany({ where: { userId, archived: false }, select: { id: true, name: true, kind: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  const alias = parseAliasToken(input.text);
  const aliasList = alias ? await prisma.list.findFirst({ where: { userId, OR: [{ name: { equals: `EC/${alias.token}`, mode: "insensitive" } }, { name: { equals: alias.token, mode: "insensitive" } }] } }) : null;
  let proposal: CaptureProposal;
  if (alias && aliasList) {
    proposal = { type: "todo", title: alias.rest, listName: aliasList.name, routedByAlias: true, projectId: null };
  } else {
    const image = input.files.find(file => VISION_TYPES.has(file.type.toLowerCase()));
    try {
      proposal = await parseCapture({
        text: joinNotes(input.text, input.url, input.files.length ? `Shared files: ${input.files.map(file => file.name).join(", ")}` : null) || "Organize this shared item.",
        photo: image ? { mediaType: image.type.toLowerCase(), base64: Buffer.from(await image.arrayBuffer()).toString("base64") } : undefined,
        today: new Date().toISOString().slice(0, 10), activeProjects: projects,
      });
      validateProposal(proposal);
      if (proposal.type === "todo") proposal = { ...proposal, routedByAlias: false };
    } catch (error) {
      console.error("mobile capture classification failed", error);
      throw new MobileCaptureError(502, "Personal OS could not organize this yet. Your capture is safe on this device; try again.");
    }
  }
  const stored: StoredFile[] = [];
  let committed = false;
  try {
    for (const file of input.files) {
      const name = (file.name || "shared-file").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
      const blob = await put(`users/${userId}/mobile/${input.requestId}/${randomUUID()}-${name}`, file, { access: "public", addRandomSuffix: true, contentType: file.type || "application/octet-stream" });
      stored.push({ file, url: blob.url });
    }
    const outcome = await prisma.$transaction(async tx => {
      // No external calls occur while the per-user transaction lock is held.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mobile-capture:${userId}`}, 0))::text AS locked`;
      const existing = await tx.mobileCaptureReceipt.findFirst({ where: { id, userId } });
      if (existing) return { result: replay(existing, requestHash), created: false };
      await assertQuota(tx, userId, fileBytes);
      const result = await commitMobile(tx, userId, input, proposal, stored);
      await tx.mobileCaptureReceipt.create({ data: { id, userId, requestHash, result: result as unknown as Prisma.InputJsonValue } });
      return { result, created: true };
    }, { maxWait: 10_000, timeout: 15_000, isolationLevel: "ReadCommitted" });
    committed = outcome.created;
    return outcome.result;
  } finally {
    if (!committed && stored.length) {
      try {
        const urls = stored.map(item => item.url);
        const referenced = await prisma.attachment.findMany({ where: { userId, url: { in: urls } }, select: { url: true } });
        const keep = new Set(referenced.map(item => item.url));
        const unused = urls.filter(url => !keep.has(url));
        if (unused.length) await del(unused);
      } catch (error) {
        console.error("mobile capture unused blob cleanup deferred", error);
      }
    }
  }
}

async function commitMobile(tx: Tx, userId: string, input: MobileCaptureInput, proposal: MobileProposal, stored: StoredFile[]): Promise<MobileCaptureResult> {
  const imageUrl = stored.find(item => VISION_TYPES.has(item.file.type.toLowerCase()))?.url ?? null;
  const original = input.text ? `Shared text:\n${input.text}` : null;
  const fileLinks = stored.length ? `Shared files:\n${stored.map(item => `${item.file.name}: ${item.url}`).join("\n")}` : null;
  const notes = joinNotes(proposal.notes, original, input.url, fileLinks);
  const suggestedProjectId = proposal.type === "asset" || proposal.type === "interaction" ? proposal.projectId : null;
  const ownedProject = suggestedProjectId ? await tx.project.findFirst({ where: { id: suggestedProjectId, userId, archived: false }, select: { id: true } }) : null;
  const projectId = ownedProject?.id ?? null;
  let result: MobileCaptureResult;
  let attachmentOwner: { todoId: string } | { assetId: string };

  if (proposal.type === "todo") {
    let todo;
    if (proposal.routedByAlias && proposal.listName) {
      const list = await ensureList(tx, userId, proposal.listName);
      todo = await tx.todo.create({ data: { userId, title: proposal.title, notes, listId: list.id, projectId: null, dueDate: date(proposal.dueDate) } });
      result = { ok: true, id: todo.id, type: "todo", title: todo.title, destination: list.name, path: "/" };
    } else {
      todo = await inboxTodo(tx, userId, proposal.title, notes);
      if (proposal.dueDate) await tx.todo.update({ where: { id: todo.id }, data: { dueDate: date(proposal.dueDate) } });
      result = { ok: true, id: todo.id, type: "todo", title: todo.title, destination: "Inbox", path: "/inbox" };
    }
    attachmentOwner = { todoId: todo.id };
  } else if (proposal.type === "asset") {
    const destination = ASSET_DESTINATIONS[proposal.assetKind];
    const asset = await tx.asset.create({ data: {
      userId, kind: proposal.assetKind, title: proposal.title, subtitle: proposal.subtitle ?? null,
      category: proposal.category ?? null, status: proposal.status ?? destination.status,
      costBasis: proposal.costBasis ?? null, currentValue: proposal.currentValue ?? null,
      amountUsd: proposal.amountUsd ?? null, rating: proposal.rating ?? null, location: proposal.location ?? null,
      acquiredAt: date(proposal.acquiredAt), url: input.url ?? proposal.url ?? null, imageUrl, notes, projectId,
      detailsJson: { ...(proposal.details ?? {}), source: "mobile-capture", sourceVendor: proposal.sourceVendor ?? null } as Prisma.InputJsonValue,
    } });
    result = { ok: true, id: asset.id, type: "asset", assetKind: proposal.assetKind, title: asset.title, destination: destination.destination, path: destination.path };
    attachmentOwner = { assetId: asset.id };
    if (proposal.followupTodo?.title) {
      await inboxTodo(tx, userId, proposal.followupTodo.title, joinNotes(`Related ${destination.destination} record: ${asset.id}`, destination.path, input.url));
    } else if (["media", "place"].includes(proposal.assetKind) && ["to-read", "to-watch", "to-listen", "wishlist", "in-progress"].includes(asset.status ?? "")) {
      const list = await ensureList(tx, userId, "Later");
      const format = String(proposal.details?.format ?? "").toLowerCase();
      const verb = proposal.assetKind === "place" ? "Try" : ["film", "show", "video"].includes(format) ? "Watch" : ["podcast", "album"].includes(format) ? "Listen" : "Read";
      await tx.todo.create({ data: { userId, listId: list.id, projectId, title: `${verb}: ${asset.title}`, notes: joinNotes(input.url ?? proposal.url, `Related record: ${asset.id}`, destination.path) } });
    }
  } else if (proposal.type === "person") {
    const firstName = proposal.firstName.trim();
    const lastName = proposal.lastName?.trim() || null;
    const existing = await tx.person.findFirst({ where: { userId, firstName: { equals: firstName, mode: "insensitive" }, lastName: lastName ? { equals: lastName, mode: "insensitive" } : null } });
    const person = existing
      ? await tx.person.update({ where: { id: existing.id }, data: {
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
    const todo = await inboxTodo(tx, userId, `Follow up with ${title}`, joinNotes(`Related person: ${person.id}`, "/friends", notes));
    attachmentOwner = { todoId: todo.id };
  } else if (proposal.type === "trip") {
    const trip = await tx.trip.create({ data: {
      userId, name: proposal.name, destination: proposal.destination ?? null, startDate: date(proposal.startDate), endDate: date(proposal.endDate),
      status: proposal.status ?? "planned", travelers: proposal.travelers ?? [], transport: proposal.transport ?? null,
      accommodation: proposal.accommodation ?? null, costUsd: proposal.costUsd ?? null,
      bookingUrl: input.url ?? proposal.bookingUrl ?? null, notes, imageUrl,
    } });
    result = { ok: true, id: trip.id, type: "trip", title: trip.name, destination: "Trips", path: `/trips/${trip.id}` };
    const todo = stored.length ? await inboxTodo(tx, userId, `Files for ${trip.name}`, joinNotes(`Related trip: ${trip.id}`, result.path, notes)) : null;
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
      if (!personIds.includes(person.id)) personIds.push(person.id);
    }
    const interaction = await tx.interaction.create({ data: {
      userId, title: proposal.title, kind: proposal.kind, occurredAt, location: proposal.location ?? null,
      notes, photoUrl: imageUrl, personIds, projectId, source: "mobile-capture",
    } });
    if (personIds.length) await tx.person.updateMany({ where: { userId, id: { in: personIds }, OR: [{ lastInteractionAt: null }, { lastInteractionAt: { lt: occurredAt } }] }, data: { lastInteractionAt: occurredAt } });
    result = { ok: true, id: interaction.id, type: "interaction", title: interaction.title, destination: "People", path: "/friends" };
    const todo = await inboxTodo(tx, userId, proposal.title, joinNotes(`Related interaction: ${interaction.id}`, result.path, notes));
    attachmentOwner = { todoId: todo.id };
  }
  for (const item of stored) {
    await tx.attachment.create({ data: { userId, ...attachmentOwner, kind: "file", title: item.file.name || "Shared file", url: item.url, mimeType: item.file.type || null, size: item.file.size } });
  }
  return result;
}
