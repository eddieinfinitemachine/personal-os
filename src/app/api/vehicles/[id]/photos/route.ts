import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { safeFilename, saveFile } from "@/lib/storage";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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
  const url = await saveFile(`vehicles/${id}`, filename, buffer);

  const max = await prisma.vehiclePhoto.aggregate({
    where: { vehicleId: id },
    _max: { position: true },
  });

  const photo = await prisma.vehiclePhoto.create({
    data: {
      vehicleId: id,
      url,
      mimeType: file.type || null,
      size: file.size,
      caption: typeof form.get("caption") === "string"
        ? (form.get("caption") as string).trim() || null
        : null,
      position: (max._max.position ?? -1) + 1,
    },
  });

  return NextResponse.json({ photo });
}
