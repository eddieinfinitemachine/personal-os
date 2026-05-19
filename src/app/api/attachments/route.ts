import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDropboxFolderUrl } from "@/lib/dropbox";
import { getCurrentUserId } from "@/lib/auth";

const VALID_KINDS = new Set(["file", "link", "dropbox"]);

export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  const attachments = await prisma.attachment.findMany({
    where: { userId, projectId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ attachments });
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    projectId?: string;
    kind?: string;
    title?: string;
    url?: string;
    mimeType?: string;
    size?: number;
  };
  if (!body.projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const project = await prisma.project.findUnique({ where: { id: body.projectId } });
  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  const url = body.url?.trim();
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });
  // Auto-detect Dropbox folder URLs so they render as expandable folders.
  let kind = body.kind && VALID_KINDS.has(body.kind) ? body.kind : "link";
  if (kind === "link" && isDropboxFolderUrl(url)) kind = "dropbox";
  const title = body.title?.trim() || url;

  const attachment = await prisma.attachment.create({
    data: {
      userId,
      projectId: body.projectId,
      kind,
      title,
      url,
      mimeType: body.mimeType ?? null,
      size: body.size ?? null,
    },
  });
  return NextResponse.json({ attachment });
}
