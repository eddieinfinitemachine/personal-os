import { createHash, randomUUID } from "node:crypto";
import type { Prisma, CaptureReview } from "@prisma/client";
import type { CaptureProposal } from "@/lib/smart-capture";
import { prisma } from "@/lib/prisma";
import { domainSnapshot, journalClient, type CaptureEffects, type DomainModel } from "./journal";
import { getCaptureReview } from "./read";
import { CaptureReviewError, type CaptureSource, type ReviewInput, type ReviewPlacement } from "./types";

export function captureKey(userId: string, namespace: string, requestId?: unknown): string {
  if (requestId === undefined || requestId === null || requestId === "") return randomUUID();
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) throw new CaptureReviewError(400, "Invalid capture request ID.");
  return createHash("sha256").update(JSON.stringify([userId, namespace, requestId])).digest("hex");
}
export function captureHash(value: unknown): string {
  const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)])) : v;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
export function quickSource(value: unknown): CaptureSource { return value === "mac" || value === "chrome" ? value : "quick"; }
export async function captureLock(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`capture-review:${userId}`}, 0))::text AS locked`;
}
export function assertReplay(review: CaptureReview, requestHash: string) {
  if (review.requestHash !== requestHash) throw new CaptureReviewError(409, "This capture ID was already used for different content. Create a new capture to change it.");
}
export interface RecordCapture {
  id: string;
  userId: string;
  source: CaptureSource;
  requestHash: string | null;
  input: ReviewInput;
  proposal?: CaptureProposal | null;
  placement: ReviewPlacement;
  effects: CaptureEffects;
  createdAt?: Date;
}
export async function recordCapture(tx: Prisma.TransactionClient, capture: RecordCapture) {
  const { placement, effects } = capture;
  const model: DomainModel = placement.type === "board" ? "boardItem" : placement.type === "reader" ? "readerItem" : placement.type === "call_sheet" ? "person" : placement.type;
  if (!effects.writes.some(w => w.model === model && w.id === placement.id)) {
    const record = await (tx[model] as unknown as { findFirst(args: unknown): Promise<Record<string, unknown> | null> }).findFirst({ where: { id: placement.id, userId: capture.userId } });
    if (record) { const snapshot = domainSnapshot(model, record); effects.writes.push({ model, id: placement.id, action: "update", before: snapshot, after: snapshot, fields: [] }); }
  }
  const related = effects.writes.filter(w => w.model === "todo" && w.action === "create" && w.id !== placement.id).map(w => ({ type: "todo" as const, id: w.id, title: String(w.after.title ?? "Supporting task"), destination: "Supporting task", path: "/" }));
  const input = { ...capture.input, files: capture.input.files.map(file => { const { attachmentId: _untrusted, ...safe } = file; const attached = effects.writes.find(w => w.model === "attachment" && w.after.url === file.url); return { ...safe, ...(attached ? { attachmentId: attached.id } : {}) }; }) };
  return tx.captureReview.create({ data: {
    id: capture.id, userId: capture.userId, source: capture.source, requestHash: capture.requestHash,
    input: input as unknown as Prisma.InputJsonValue,
    ...(capture.proposal ? { proposal: capture.proposal as unknown as Prisma.InputJsonValue } : {}),
    placement: { ...placement, ...(related.length ? { related } : {}) } as unknown as Prisma.InputJsonValue,
    effects: effects as unknown as Prisma.InputJsonValue,
    ...(capture.createdAt ? { createdAt: capture.createdAt } : {}),
  } });
}

export type CaptureMeta = Omit<RecordCapture, "placement" | "effects">;
export async function findCaptureReplay(userId: string, id: string, requestHash: string) {
  const previous = await prisma.captureReview.findFirst({ where: { userId, id } });
  if (!previous) return null;
  assertReplay(previous, requestHash);
  return getCaptureReview(userId, id);
}
export async function withCaptureReview<T>(meta: CaptureMeta, handlers: {
  commit: (tx: Prisma.TransactionClient) => Promise<{ value: T; placement: ReviewPlacement; proposal?: CaptureProposal | null }>;
  replay: (tx: Prisma.TransactionClient, placement: ReviewPlacement) => Promise<T>;
}) {
  return prisma.$transaction(async tx => {
    await captureLock(tx, meta.userId);
    const existing = await tx.captureReview.findFirst({ where: { id: meta.id, userId: meta.userId } });
    if (existing) {
      assertReplay(existing, meta.requestHash!);
      const current = await getCaptureReview(meta.userId, meta.id, tx);
      return { value: await handlers.replay(tx, current!.placement), reviewId: meta.id, created: false };
    }
    const journal = journalClient(tx, meta.userId);
    const result = await handlers.commit(journal.client);
    await recordCapture(tx, { ...meta, ...(result.proposal ? { proposal: result.proposal } : {}), placement: result.placement, effects: journal.effects() });
    return { value: result.value, reviewId: meta.id, created: true };
  }, { maxWait: 10_000, timeout: 20_000, isolationLevel: "ReadCommitted" });
}
