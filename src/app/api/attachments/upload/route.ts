import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { listAccessWhere } from "@/lib/list-access";

// Per-user storage quota — keep tight while we're friends-only.
const QUOTA_BYTES = 1024 * 1024 * 1024; // 1 GB
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB / file

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await request.formData();
  const projectId = form.get("projectId");
  const todoId = form.get("todoId");
  const file = form.get("file");

  // An attachment belongs to exactly one owner — a project or a todo.
  const hasProject = typeof projectId === "string" && projectId.length > 0;
  const hasTodo = typeof todoId === "string" && todoId.length > 0;
  if (hasProject === hasTodo) {
    return NextResponse.json(
      { error: "exactly one of projectId or todoId required" },
      { status: 400 },
    );
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "empty file" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File too large. Max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.` },
      { status: 413 },
    );
  }

  // Ownership check + blob path scope.
  let scope: string;
  if (hasProject) {
    const project = await prisma.project.findUnique({ where: { id: projectId as string } });
    if (!project || project.userId !== userId) {
      return NextResponse.json({ error: "project not found" }, { status: 404 });
    }
    scope = `projects/${projectId}`;
  } else {
    // Authorize via parent list membership so shared-list collaborators can
    // attach files to a todo too.
    const todo = await prisma.todo.findFirst({
      where: { id: todoId as string, list: listAccessWhere(userId) },
    });
    if (!todo) {
      return NextResponse.json({ error: "todo not found" }, { status: 404 });
    }
    scope = `todos/${todoId}`;
  }

  // Quota check — sum of all files for this user.
  const used = await prisma.attachment.aggregate({
    where: { userId, kind: "file" },
    _sum: { size: true },
  });
  const usedBytes = used._sum.size ?? 0;
  if (usedBytes + file.size > QUOTA_BYTES) {
    const remaining = Math.max(0, QUOTA_BYTES - usedBytes);
    return NextResponse.json(
      {
        error: "Storage quota exceeded.",
        usedBytes,
        quotaBytes: QUOTA_BYTES,
        remainingBytes: remaining,
      },
      { status: 413 },
    );
  }

  // Upload to Vercel Blob. Path prefix scoped by user so listings/deletes are easy.
  const safeName = (file.name || "file").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
  const key = `users/${userId}/${scope}/${Date.now()}-${safeName}`;

  let blobUrl: string;
  try {
    const blob = await put(key, file, {
      access: "public",
      addRandomSuffix: false,
      contentType: file.type || "application/octet-stream",
    });
    blobUrl = blob.url;
  } catch (err) {
    console.error("blob upload failed", err);
    return NextResponse.json({ error: "upload failed" }, { status: 502 });
  }

  const attachment = await prisma.attachment.create({
    data: {
      userId,
      projectId: hasProject ? (projectId as string) : null,
      todoId: hasTodo ? (todoId as string) : null,
      kind: "file",
      title: file.name || "Untitled",
      url: blobUrl,
      mimeType: file.type || null,
      size: file.size,
    },
  });

  return NextResponse.json({ attachment });
}
