import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDropboxFolderUrl } from "@/lib/dropbox";

const VALID_KINDS = new Set(["file", "link", "dropbox"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const attachments = await prisma.attachment.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ attachments });
}

export async function POST(request: Request) {
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
  const url = body.url?.trim();
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });
  // Auto-detect Dropbox folder URLs so they render as expandable folders.
  let kind = body.kind && VALID_KINDS.has(body.kind) ? body.kind : "link";
  if (kind === "link" && isDropboxFolderUrl(url)) kind = "dropbox";
  const title = body.title?.trim() || url;

  const attachment = await prisma.attachment.create({
    data: {
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
