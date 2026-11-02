import { randomUUID } from "node:crypto";
import { put, del } from "@vercel/blob";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseCapture, type CaptureProposal } from "@/lib/smart-capture";
import { parseAliasToken } from "@/lib/alias";
import { MOBILE_QUOTA_BYTES, MobileCaptureError, mobileCaptureHash, mobileReceiptId, type MobileCaptureInput } from "./mobile-capture-input";
import { journalClient } from "./capture-review/journal";
import { captureLock, recordCapture } from "./capture-review/record";
import { getCaptureReview } from "./capture-review/read";
import { commitCore, validateCoreProposal, type CoreProposal, type StoredCaptureFile } from "./capture-review/commit";

type MobileProposal = CoreProposal;

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
const VISION_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function replay(receipt: { requestHash: string; result: unknown }, requestHash: string): MobileCaptureResult {
  if (receipt.requestHash !== requestHash) throw new MobileCaptureError(409, "This requestId was already used for different content. Create a new capture to change its content.");
  return receipt.result as MobileCaptureResult;
}
function joinNotes(...parts: Array<string | null | undefined>): string | null {
  return parts.filter((part): part is string => typeof part === "string" && part.trim().length > 0).join("\n\n") || null;
}
async function assertQuota(db: Pick<Tx, "attachment">, userId: string, bytes: number): Promise<void> {
  if (!bytes) return;
  const used = await db.attachment.aggregate({ where: { userId, kind: "file" }, _sum: { size: true } });
  if ((used._sum.size ?? 0) + bytes > MOBILE_QUOTA_BYTES) throw new MobileCaptureError(413, "Storage quota exceeded. Remove some files from Personal OS and retry.");
}
export async function captureMobile(userId: string, input: MobileCaptureInput): Promise<MobileCaptureResult> {
  const id = mobileReceiptId(userId, input.requestId);
  const requestHash = await mobileCaptureHash(input);
  const previous = await prisma.mobileCaptureReceipt.findFirst({ where: { id, userId } });
  if (previous) {
    const original = replay(previous, requestHash);
    const review = await getCaptureReview(userId, id);
    return review && (review.correctedAt || review.placement.missing) ? { ok: true, ...review.placement } as MobileCaptureResult : original;
  }
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
      validateCoreProposal(proposal);
      if (proposal.type === "todo") proposal = { ...proposal, routedByAlias: false };
    } catch (error) {
      console.error("mobile capture classification failed", error);
      throw new MobileCaptureError(502, "Personal OS could not organize this yet. Your capture is safe on this device; try again.");
    }
  }
  const stored: StoredCaptureFile[] = [];
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
      if (existing) {
        const original = replay(existing, requestHash);
        const review = await getCaptureReview(userId, id, tx);
        return { result: review && (review.correctedAt || review.placement.missing) ? { ok: true, ...review.placement } as MobileCaptureResult : original, created: false };
      }
      await captureLock(tx, userId);
      await assertQuota(tx, userId, fileBytes);
      const journal = journalClient(tx, userId);
      const result = await commitCore(journal.client, userId, input, proposal as CoreProposal, stored, { mode: "mobile" }) as MobileCaptureResult;
      await recordCapture(tx, {
        id, userId, source: "ec", requestHash,
        input: { text: input.text, url: input.url, files: stored.map(item => ({ name: item.file.name, mimeType: item.file.type || null, size: item.file.size, url: item.url })) },
        proposal, placement: result, effects: journal.effects(),
      });
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
