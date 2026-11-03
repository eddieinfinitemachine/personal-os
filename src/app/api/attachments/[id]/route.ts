import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.attachment.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await prisma.attachment.delete({ where: { id } });

  // For uploaded files, also delete the blob. Best-effort: if the blob delete
  // fails (404, network, etc.), we still report success to the user since the
  // DB row is gone.
  if (existing.kind === "file" && existing.url) {
    try {
      // A notebook scan's items share one page photo: keep it while another
      // attachment still points at it.
      const shared = await prisma.attachment.count({ where: { userId, url: existing.url } });
      if (!shared) await del(existing.url);
    } catch (err) {
      console.error("blob delete failed (orphaned)", existing.url, err);
    }
  }

  return NextResponse.json({ ok: true });
}
