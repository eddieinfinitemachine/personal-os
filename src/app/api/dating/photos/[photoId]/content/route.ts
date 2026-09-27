import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { datingPhotoFolder } from "@/lib/dating-photos";
import { readUserImage } from "@/lib/user-image";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(_request: Request, { params }: { params: Promise<{ photoId: string }> }) {
  // Verify the session here, immediately before accessing storage. Never accept
  // a client URL/path or rely on middleware alone for private image delivery.
  const session = await getSession();
  if (!session) return new NextResponse(null, { status: 401, headers });
  const { photoId } = await params;
  const photo = await prisma.datingPhoto.findFirst({ where: { id: photoId, userId: session.userId } });
  if (!photo) return new NextResponse(null, { status: 404, headers });
  const bytes = await readUserImage(session.userId, datingPhotoFolder(photo.personId), photo.url);
  if (!bytes) return new NextResponse(null, { status: 404, headers });
  return new NextResponse(new Uint8Array(bytes), { headers: { ...headers, "Content-Type": "image/webp" } });
}
