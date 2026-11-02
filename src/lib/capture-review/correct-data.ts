import { Prisma } from "@prisma/client";
import type { CoreProposal } from "./commit";
import { CaptureReviewError } from "./types";
import { requireListWrite } from "./access";

const optional = (proposal: object, key: string) => Object.hasOwn(proposal, key);
const date = (value: string | null | undefined) => value ? new Date(value) : null;
/** Explicit field allowlists; never spread a request into a Prisma mutation. */
export function correctionData(proposal: CoreProposal, existing: Record<string, unknown> = {}): Record<string, unknown> {
  const p = proposal as unknown as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  const copy = (keys: string[]) => keys.forEach(key => { if (optional(p, key)) data[key] = p[key] ?? null; });
  if (proposal.type === "todo") { data.title = proposal.title.trim(); copy(["notes"]); if (optional(p, "dueDate")) data.dueDate = date(proposal.dueDate); }
  else if (proposal.type === "asset") {
    data.kind = proposal.assetKind; data.title = proposal.title.trim();
    copy(["subtitle", "category", "status", "costBasis", "currentValue", "amountUsd", "rating", "location", "url", "notes"]);
    if (optional(p, "acquiredAt")) data.acquiredAt = date(proposal.acquiredAt);
    if (optional(p, "details") || optional(p, "sourceVendor")) data.detailsJson = { ...(existing.detailsJson && typeof existing.detailsJson === "object" ? existing.detailsJson : {}), ...(proposal.details ?? {}), ...(optional(p, "sourceVendor") ? { sourceVendor: proposal.sourceVendor ?? null } : {}) };
  } else if (proposal.type === "person") {
    data.firstName = proposal.firstName.trim();
    copy(["lastName", "role", "company", "city", "country", "email", "phone", "howWeMet", "strength", "circles", "interests", "notes"]);
    if (optional(p, "birthday")) data.birthday = date(proposal.birthday);
    if (optional(p, "socialUrls")) data.socialUrls = proposal.socialUrls ?? Prisma.DbNull;
  } else if (proposal.type === "trip") {
    data.name = proposal.name.trim(); copy(["destination", "status", "travelers", "transport", "accommodation", "costUsd", "bookingUrl", "notes"]);
    if (optional(p, "startDate")) data.startDate = date(proposal.startDate);
    if (optional(p, "endDate")) data.endDate = date(proposal.endDate);
  } else { data.title = proposal.title.trim(); data.kind = proposal.kind; data.occurredAt = date(proposal.occurredAt); copy(["location", "notes"]); }
  return data;
}
export async function placementIds(tx: Prisma.TransactionClient, userId: string, proposal: CoreProposal, fields: Record<string, unknown>) {
  const result: { listId?: string; projectId?: string | null } = {};
  if (proposal.type === "todo" && Object.hasOwn(fields, "listId")) {
    if (typeof fields.listId !== "string" || !fields.listId) throw new CaptureReviewError(400, "Choose a list.");
    const list = await requireListWrite(tx, userId, fields.listId); result.listId = list.id;
  } else if (proposal.type === "todo" && proposal.listName) {
    const list = await tx.list.findFirst({ where: { userId, name: { equals: proposal.listName, mode: "insensitive" } }, select: { id: true } });
    if (!list) throw new CaptureReviewError(404, "List not found."); result.listId = list.id;
  }
  if (["todo", "asset", "interaction"].includes(proposal.type)) {
    const value = Object.hasOwn(fields, "projectId") ? fields.projectId : "projectId" in proposal ? proposal.projectId : undefined;
    if (value !== undefined) {
      if (value !== null && (typeof value !== "string" || !value)) throw new CaptureReviewError(400, "Choose a project.");
      if (value !== null && !await tx.project.findFirst({ where: { id: value as string, userId, archived: false }, select: { id: true } })) throw new CaptureReviewError(404, "Project not found.");
      result.projectId = value as string | null;
    }
  }
  return result;
}
export function directFields(kind: "board" | "reader", fields: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const keys = kind === "board" ? ["title", "note", "kind"] : ["title", "byline", "excerpt", "read", "archived"];
  for (const key of Object.keys(fields)) if (!keys.includes(key)) throw new CaptureReviewError(400, "Unsupported correction field.");
  for (const key of keys) {
    if (!Object.hasOwn(fields, key)) continue;
    const value = fields[key];
    if (key === "read" || key === "archived") {
      if (typeof value !== "boolean") throw new CaptureReviewError(400, "Invalid reader state.");
      data[key === "read" ? "readAt" : "archivedAt"] = value ? new Date() : null;
    } else {
      if (value !== null && typeof value !== "string") throw new CaptureReviewError(400, "Invalid correction text.");
      const text = typeof value === "string" ? value.trim() : "";
      if (text.length > (key === "note" || key === "excerpt" ? 4000 : 300)) throw new CaptureReviewError(400, "Correction text is too long.");
      if ((key === "title" && kind === "reader") && !text) throw new CaptureReviewError(400, "A title is required.");
      if (key === "kind" && !["image", "video", "music", "product", "link", "note"].includes(text)) throw new CaptureReviewError(400, "Invalid Board kind.");
      data[key] = text || null;
    }
  }
  return data;
}
