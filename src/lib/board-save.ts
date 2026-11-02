import type { Prisma, BoardItem } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { InputError, shareCaption, type BoardInput } from "@/lib/board-input";
import { deleteBoardImage, fetchImage, resolveLink, storeBoardImage, type StoredImage } from "@/lib/board";
import { displayHost } from "@/lib/board-embed";
import { findCaptureReplay, withCaptureReview } from "./capture-review/record";
import { intakeMeta } from "./capture-review/intake";
import { CaptureReviewError, type CaptureSource } from "./capture-review/types";
function joinNote(...parts: Array<string | null | undefined>): string | null {
  const kept = parts.map(p => p?.trim()).filter((p): p is string => Boolean(p));
  return kept.length ? kept.join("\n\n").slice(0, 4000) : null;
}
type Prepared = { data: Prisma.BoardItemUncheckedCreateInput; uploadedUrl?: string };
async function prepare(userId: string, input: BoardInput): Promise<Prepared> {
  const common = { userId, via: input.via, title: input.title ?? null, note: joinNote(input.note, input.text), url: input.url ?? null, siteName: displayHost(input.url) };
  if (input.image || input.imageSrc) {
    const body = input.image ?? await fetchImage(input.imageSrc!);
    const stored = body ? await storeBoardImage(userId, body) : null;
    if (input.image && !stored) throw new InputError("Couldn't read that image.", 415);
    return { data: { ...common, kind: "image", url: input.url ?? input.imageSrc ?? null, siteName: displayHost(input.url ?? input.imageSrc), ...(stored ?? { imageUrl: input.imageSrc }) }, uploadedUrl: stored?.imageUrl };
  }
  if (input.url) {
    // Avoid downloads for an existing save; recheck deduplication under the transaction lock.
    const existing = await prisma.boardItem.findFirst({ where: { userId, url: input.url } });
    if (existing) return { data: { ...common, kind: existing.kind } };
    const link = await resolveLink(input.url);
    let stored: StoredImage | null = null;
    const body = link.imageBody ?? (link.imageSrc ? await fetchImage(link.imageSrc) : null);
    if (body) stored = await storeBoardImage(userId, body);
    const title = input.title ?? link.title;
    return { data: { ...common, kind: link.kind, url: link.url, title: title?.slice(0, 300) ?? null, note: joinNote(input.note, shareCaption(input.text, title)), siteName: link.siteName ?? displayHost(link.url), price: link.price, ...(stored ?? (link.imageSrc ? { imageUrl: link.imageSrc } : {})) }, uploadedUrl: stored?.imageUrl };
  }
  if (!common.note) throw new InputError("Nothing to save: send a link, an image, or some text.");
  return { data: { ...common, kind: "note" } };
}
async function commit(tx: Prisma.TransactionClient, userId: string, input: BoardInput, prepared: Prepared) {
  if (input.url && !input.image && !input.imageSrc) {
    const existing = await tx.boardItem.findFirst({ where: { userId, url: { in: [...new Set([input.url, prepared.data.url].filter((url): url is string => typeof url === "string"))] } } });
    if (existing) {
      const note = input.note && !existing.note?.includes(input.note) ? joinNote(existing.note, input.note) : existing.note;
      return { item: await tx.boardItem.update({ where: { id: existing.id }, data: { savedAt: new Date(), note } }), duplicate: true };
    }
  }
  return { item: await tx.boardItem.create({ data: prepared.data }), duplicate: false };
}
export async function saveToBoard(userId: string, input: BoardInput, capture?: { request: Request; source: CaptureSource }) {
  const reviewInput = { text: joinNote(input.text, input.note) ?? "", url: input.url ?? input.imageSrc ?? null, files: [] };
  const meta = capture ? intakeMeta(capture.request, userId, "board", reviewInput, capture.source, input.requestId, { ...input, image: input.image?.toString("base64") }) : null;
  async function replay(tx: Prisma.TransactionClient, id: string): Promise<{ item: BoardItem; duplicate: boolean }> {
    const item = await tx.boardItem.findFirst({ where: { id, userId } });
    if (!item) throw new CaptureReviewError(409, "The saved Board item has been removed.");
    return { item, duplicate: true };
  }
  if (meta) {
    const previous = await findCaptureReplay(userId, meta.id, meta.requestHash!);
    if (previous) return { ...await replay(prisma, previous.placement.id), reviewId: meta.id, created: false };
  }
  const prepared = await prepare(userId, input);
  if (meta && (input.image || input.imageSrc) && typeof prepared.data.imageUrl === "string") {
    meta.input.files = [{ name: input.title ?? "Shared Board image", mimeType: prepared.uploadedUrl ? "image/webp" : null, size: input.image?.length ?? null, url: prepared.data.imageUrl }];
  }
  try {
    if (!meta) return { ...await commit(prisma, userId, input, prepared), created: true, reviewId: undefined };
    const outcome = await withCaptureReview(meta, {
      commit: async tx => {
        const value = await commit(tx, userId, input, prepared);
        return { value, placement: { type: "board", id: value.item.id, title: value.item.title ?? value.item.siteName ?? value.item.note?.slice(0, 120) ?? "Board item", destination: "Board", path: "/board" } };
      }, replay: (tx, placement) => replay(tx, placement.id),
    });
    return { ...outcome.value, reviewId: outcome.reviewId, created: outcome.created };
  } finally {
    if (prepared.uploadedUrl) {
      try {
        const used = await prisma.boardItem.findFirst({ where: { userId, imageUrl: prepared.uploadedUrl }, select: { id: true } });
        if (!used) await deleteBoardImage(userId, prepared.uploadedUrl);
      } catch (error) { console.error("[board] unused image cleanup deferred", error); }
    }
  }
}
