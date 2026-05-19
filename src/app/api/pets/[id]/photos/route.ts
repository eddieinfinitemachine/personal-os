import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { safeFilename, saveFile } from "@/lib/storage";
import { getCurrentUserId } from "@/lib/auth";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const pet = await prisma.pet.findUnique({ where: { id } });
  if (!pet || pet.userId !== userId) {
    return NextResponse.json({ error: "pet not found" }, { status: 404 });
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "empty file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file too large (max 25 MB)" }, { status: 413 });
  }
  if (file.type && !ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "unsupported image type" }, { status: 415 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = safeFilename(file.name);
  const url = await saveFile(`pets/${id}`, filename, buffer);

  const max = await prisma.petPhoto.aggregate({
    where: { petId: id },
    _max: { position: true },
  });

  const photo = await prisma.petPhoto.create({
    data: {
      userId,
      petId: id,
      url,
      mimeType: file.type || null,
      size: file.size,
      caption:
        typeof form.get("caption") === "string"
          ? (form.get("caption") as string).trim() || null
          : null,
      position: (max._max.position ?? -1) + 1,
    },
  });

  return NextResponse.json({ photo });
}
