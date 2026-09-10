import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";

// Callers must authorize access to the asset before invoking this helper.
export async function deleteAssetWithBlobs(id: string) {
  const files = await prisma.attachment.findMany({
    where: { assetId: id, kind: "file" },
    select: { url: true },
  });
  for (const file of files) {
    try {
      await del(file.url);
    } catch (error) {
      console.error("asset blob delete failed (orphaned)", file.url, error);
    }
  }
  return prisma.asset.delete({ where: { id } });
}
