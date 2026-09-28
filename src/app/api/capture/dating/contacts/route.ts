import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCaptureUser } from "@/lib/capture-auth";
import {
  contactNameKey,
  recordContactLookup,
} from "@/lib/dating-contact-lookup";
import { readJSON } from "@/lib/dating-intake/contracts";
import { failure } from "@/lib/dating-intake/http";

export const dynamic = "force-dynamic";
// Only contacts for existing dating profiles leave the Mac, never its directory.
export async function GET(request: Request) {
  const userId = await resolveCaptureUser(request);
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const all = await prisma.datingPerson.findMany({
    where: { userId },
    select: { id: true, name: true, handles: true },
  });
  const counts = new Map<string, number>();
  for (const p of all)
    counts.set(
      contactNameKey(p.name),
      (counts.get(contactNameKey(p.name)) ?? 0) + 1,
    );
  return NextResponse.json(
    {
      people: all
        .filter(
          (p) => !p.handles.length && counts.get(contactNameKey(p.name)) === 1,
        )
        .map(({ id, name }) => ({ id, name })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
export async function POST(request: Request) {
  const userId = await resolveCaptureUser(request);
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(
      await recordContactLookup(userId, await readJSON(request, 32768)),
    );
  } catch (error) {
    return failure(error);
  }
}
