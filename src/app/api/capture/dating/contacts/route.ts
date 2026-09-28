import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { parseHandles } from "@/lib/dating";

import {lockOwner} from "@/lib/dating-intake/store";
import {resolveIdentity} from "@/lib/dating-intake/review";

export const dynamic = "force-dynamic";
const nameKey = (name: string) =>
  name.normalize("NFKC").toLowerCase().trim().replace(/\s+/gu, " ");

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
    counts.set(nameKey(p.name), (counts.get(nameKey(p.name)) ?? 0) + 1);
  return NextResponse.json({
    people: all
      .filter((p) => !p.handles.length && counts.get(nameKey(p.name)) === 1)
      .map(({ id, name }) => ({ id, name })),
  });
}

export async function POST(request: Request) {
  const userId = await resolveCaptureUser(request);
  if (!userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.personId !== "string" ||
    typeof body.name !== "string" ||
    !Array.isArray(body.handles) ||
    body.handles.length > 20
  ) {
    return NextResponse.json(
      { error: "personId, name and handles required" },
      { status: 400 },
    );
  }
  const handles = parseHandles(body.handles).filter(
    (h) => /^\+[1-9]\d{6,14}$/.test(h) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(h),
  );
  if (!handles.length)
    return NextResponse.json(
      { error: "No valid contact details" },
      { status: 400 },
    );
  const result = await prisma.$transaction(async (tx) => {
    // Serialize competing automatic resolutions for this account without schema changes.
    await lockOwner(tx,userId);
    const identity=await resolveIdentity(tx,userId,handles);
    if(identity.excluded || (identity.personId && identity.personId !== body.personId)) return {status:200,body:{resolved:false,reason:"shared_contact"}};
    const person = await tx.datingPerson.findFirst({
      where: { id: body.personId, userId },
      select: { id: true, name: true, handles: true },
    });
    if (!person) return { status: 404, body: { error: "not found" } };
    if (person.name !== body.name)
      return { status: 409, body: { error: "Name changed; match again" } };
    if (person.handles.length)
      return { status: 200, body: { resolved: false, reason: "already_set" } };
    const all = await tx.datingPerson.findMany({
      where: { userId },
      select: { id: true, name: true, handles: true },
    });
    if (
      all.some(
        (p) => p.id !== person.id && nameKey(p.name) === nameKey(person.name),
      )
    )
      return {
        status: 200,
        body: { resolved: false, reason: "ambiguous_name" },
      };
    if (
      all.some(
        (p) => p.id !== person.id && p.handles.some((h) => handles.includes(h)),
      )
    )
      return {
        status: 200,
        body: { resolved: false, reason: "shared_contact" },
      };
    const saved = await tx.datingPerson.updateMany({
      where: {
        id: person.id,
        userId,
        name: body.name,
        handles: { isEmpty: true },
      },
      data: { handles },
    });
    return { status: 200, body: { resolved: saved.count === 1 } };
  });
  return NextResponse.json(result.body, { status: result.status });
}
