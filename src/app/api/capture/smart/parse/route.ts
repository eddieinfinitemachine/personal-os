import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import {
  parseCapture,
  type CapturePhoto,
  type CaptureProposal,
} from "@/lib/smart-capture";

// Same per-user storage caps as the regular attachments upload route.
const QUOTA_BYTES = 1024 * 1024 * 1024; // 1 GB
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

// Smart-capture parse: accepts multipart (photo + text), uploads the photo to
// Vercel Blob, asks Claude to classify the capture into either an inventory
// item or an interaction proposal, and returns the proposal (no DB write).
// The user then reviews/edits before POSTing to /api/capture/smart/commit.
export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const form = await request.formData();
  const text = form.get("text");
  const photo = form.get("photo");

  if (typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  let photoUrl: string | null = null;
  let photoForClaude: CapturePhoto | undefined;

  if (photo instanceof File && photo.size > 0) {
    if (photo.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          error: `Photo too large. Max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`,
        },
        { status: 413 },
      );
    }

    // Per-user storage quota — shared with the regular Attachments upload.
    const used = await prisma.attachment.aggregate({
      where: { userId, kind: "file" },
      _sum: { size: true },
    });
    const usedBytes = used._sum.size ?? 0;
    if (usedBytes + photo.size > QUOTA_BYTES) {
      return NextResponse.json(
        { error: "Storage quota exceeded." },
        { status: 413 },
      );
    }

    const safeName = (photo.name || "capture").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
    const key = `users/${userId}/captures/${Date.now()}-${safeName}`;

    try {
      const blob = await put(key, photo, {
        access: "public",
        addRandomSuffix: false,
        contentType: photo.type || "application/octet-stream",
      });
      photoUrl = blob.url;
    } catch (err) {
      console.error("smart-capture blob upload failed", err);
      return NextResponse.json({ error: "photo upload failed" }, { status: 502 });
    }

    const buf = Buffer.from(await photo.arrayBuffer());
    photoForClaude = {
      mediaType: photo.type || "image/jpeg",
      base64: buf.toString("base64"),
    };
  }

  const activeProjects = await prisma.project.findMany({
    where: { userId, archived: false },
    select: { id: true, name: true, kind: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });

  const today = new Date().toISOString().slice(0, 10);

  let proposal: CaptureProposal;
  try {
    proposal = await parseCapture({
      text: text.trim(),
      photo: photoForClaude,
      today,
      activeProjects,
    });
  } catch (err) {
    console.error("smart-capture parse failed", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "parse failed",
      },
      { status: 502 },
    );
  }

  // Validate the projectId Claude returned (if any) actually belongs to this user.
  // Only types that carry a projectId: asset, interaction, todo.
  if (
    proposal.type === "asset" ||
    proposal.type === "interaction" ||
    proposal.type === "todo"
  ) {
    const pid = proposal.projectId;
    if (pid && !activeProjects.some((p) => p.id === pid)) {
      proposal = { ...proposal, projectId: null };
    }
  }

  // Attach the uploaded photo URL onto the proposal so the commit step can use it.
  if (photoUrl) {
    if (proposal.type === "asset" || proposal.type === "trip") {
      proposal = { ...proposal, photoUrl };
    } else if (proposal.type === "interaction" || proposal.type === "person") {
      proposal = { ...proposal, photoUrl };
    }
    // (todo has no photoUrl field; skip silently)
  }

  return NextResponse.json({ proposal });
}
