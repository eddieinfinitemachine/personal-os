import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { sniffImage } from "@/lib/board-sniff";
import { MAX_UPLOAD_BYTES, storeUserImage } from "@/lib/user-image";
import { cleanCaption, datingPhotoFolder, toPhotoDTO } from "@/lib/dating-photos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// A generous ceiling so a runaway client can't fill Blob storage.
const MAX_PHOTOS_PER_PERSON = 60;

type Ctx = { params: Promise<{ id: string }> };

async function ownPerson(userId: string, id: string) {
  return prisma.datingPerson.findFirst({ where: { id, userId }, select: { id: true } });
}

// GET → this person's photos, newest first.
export async function GET(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await ownPerson(userId, id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  const photos = await prisma.datingPhoto.findMany({ where: { personId: id, userId }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ photos: photos.map(toPhotoDTO) });
}

// POST multipart (`file`, optional `caption`) or a raw image body. Same
// approach as the mood board: the client shrinks photos first, and Vercel
// caps request bodies at 4.5 MB, so we reject anything over 4.4 MB.
export async function POST(request: Request, { params }: Ctx) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await ownPerson(userId, id))) return NextResponse.json({ error: "not found" }, { status: 404 });

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "Image too large. Keep it under 4 MB." }, { status: 413 });
  }

  let image: Buffer | null = null;
  let caption: string | null = null;
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  try {
    if (type.startsWith("multipart/form-data")) {
      const form = await request.formData();
      caption = cleanCaption(form.get("caption"));
      const file = form.get("file");
      if (file && typeof file !== "string" && file.size > 0) {
        if (file.size > MAX_UPLOAD_BYTES) {
          return NextResponse.json({ error: "Image too large. Keep it under 4 MB." }, { status: 413 });
        }
        image = Buffer.from(await file.arrayBuffer());
      }
    } else {
      const buf = Buffer.from(await request.arrayBuffer());
      if (buf.length > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: "Image too large. Keep it under 4 MB." }, { status: 413 });
      }
      if (buf.length) image = buf;
    }
  } catch {
    return NextResponse.json({ error: "Could not read the upload." }, { status: 400 });
  }
  if (!image || (!type.startsWith("multipart/") && !type.startsWith("image/") && !sniffImage(image))) {
    return NextResponse.json({ error: "Send an image file." }, { status: 400 });
  }

  const count = await prisma.datingPhoto.count({ where: { personId: id, userId } });
  if (count >= MAX_PHOTOS_PER_PERSON) {
    return NextResponse.json({ error: `Up to ${MAX_PHOTOS_PER_PERSON} photos per person.` }, { status: 400 });
  }

  const stored = await storeUserImage(userId, datingPhotoFolder(id), image);
  if (!stored) return NextResponse.json({ error: "That file isn't an image we can read." }, { status: 415 });
  const photo = await prisma.datingPhoto.create({ data: { userId, personId: id, url: stored.imageUrl, caption } });
  return NextResponse.json({ photo: toPhotoDTO(photo) });
}
