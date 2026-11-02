import type { Prisma } from "@prisma/client";
import { CaptureReviewError } from "./types";

/** Keep a granted membership valid through the write transaction. */
export async function requireListWrite(tx: Prisma.TransactionClient, userId: string, listId: string) {
  const list = await tx.list.findFirst({ where: { id: listId } });
  if (!list) throw new CaptureReviewError(404, "List not found.");
  if (list.userId === userId) return list;
  if (list.isDefault) throw new CaptureReviewError(404, "List not found.");
  const members = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "ListMember" WHERE "listId" = ${listId} AND "userId" = ${userId} AND "role" IN ('editor', 'admin') FOR SHARE`;
  if (!members.length) throw new CaptureReviewError(404, "List not found.");
  return list;
}
