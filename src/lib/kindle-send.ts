import { sendKindleEmail } from "@/lib/email";
import { renderKindleEpub } from "@/lib/kindle";
import { KINDLE_SENDING } from "@/lib/kindle-status";
import { prisma } from "@/lib/prisma";

export const KINDLE_DAILY_LIMIT = 30;

export type KindleSendResult =
  | { ok: true; sentAt: Date; resendId: string | null }
  | { ok: false; error: string; status: 400 | 404 | 409 | 422 | 429 | 502 };

export async function sendReaderItemToKindle(
  itemId: string,
  opts?: { force?: boolean; userId?: string },
): Promise<KindleSendResult> {
  try {
    const item = await prisma.readerItem.findUnique({
      where: { id: itemId },
      include: { user: { select: { id: true, kindleEmail: true } } },
    });

    if (!item) return { ok: false, status: 404, error: "Not found" };
    if (opts?.userId && item.userId !== opts.userId) {
      return { ok: false, status: 404, error: "Not found" };
    }

    const { kindleEmail } = item.user;
    if (!kindleEmail) {
      return {
        ok: false,
        status: 400,
        error: "Add your Kindle email in Settings first.",
      };
    }
    if (!item.contentHtml) {
      await prisma.readerItem.update({
        where: { id: itemId },
        data: { kindleError: "No article text to send." },
      });
      return { ok: false, status: 422, error: "No article text to send." };
    }

    if (item.kindleSentAt && !opts?.force) {
      return { ok: true, sentAt: item.kindleSentAt, resendId: null };
    }

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const count = await prisma.readerItem.count({
      where: { userId: item.userId, kindleSentAt: { gte: dayAgo } },
    });
    if (count >= KINDLE_DAILY_LIMIT) {
      const error = "Daily Kindle limit reached (30 in 24 hours).";
      await prisma.readerItem.update({
        where: { id: itemId },
        data: { kindleError: error },
      });
      return { ok: false, status: 429, error };
    }

    if (opts?.force) {
      await prisma.readerItem.update({
        where: { id: itemId },
        data: { kindleError: KINDLE_SENDING },
      });
    } else {
      // Prisma NOT on a nullable column excludes NULL rows, so include them.
      const claimed = await prisma.readerItem.updateMany({
        where: {
          id: itemId,
          kindleSentAt: null,
          OR: [
            { kindleError: null },
            { NOT: { kindleError: KINDLE_SENDING } },
          ],
        },
        data: { kindleError: KINDLE_SENDING },
      });

      if (claimed.count === 0) {
        return { ok: false, status: 409, error: "Already sending." };
      }
    }

    try {
      const { buffer, filename, images } = await renderKindleEpub(item);
      const { id: resendId } = await sendKindleEmail({
        to: kindleEmail,
        title: item.title || "Article",
        filename,
        epub: buffer,
      });
      const sentAt = new Date();

      await prisma.readerItem.update({
        where: { id: itemId },
        data: { kindleSentAt: sentAt, kindleError: null },
      });

      console.log("[kindle] sent", {
        itemId,
        bytes: buffer.length,
        images,
        resendId,
      });
      return { ok: true, sentAt, resendId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.readerItem.update({
        where: { id: itemId },
        data: { kindleError: msg.slice(0, 500) },
      });
      console.warn("[kindle] failed", { itemId, error: msg });
      return { ok: false, status: 502, error: msg };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[kindle] unexpected error", { itemId, error: msg });
    return { ok: false, status: 502, error: msg };
  }
}
