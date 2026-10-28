import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const report = await prisma.researchReport.findFirst({ where: { id, userId }, select: { id: true, pdfUrl: true } });
  if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.researchReport.delete({ where: { id: report.id } });
  if (report.pdfUrl) {
    try {
      await del(report.pdfUrl);
    } catch (error) {
      console.error("research blob delete failed (orphaned)", report.pdfUrl, error);
    }
  }
  return NextResponse.json({ ok: true });
}
