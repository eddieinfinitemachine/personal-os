import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

type IncomingPerson = {
  firstName?: unknown;
  lastName?: unknown;
  strength?: unknown;
  email?: unknown;
  phone?: unknown;
  company?: unknown;
  role?: unknown;
  city?: unknown;
  country?: unknown;
  howWeMet?: unknown;
  interests?: unknown;
  tags?: unknown;
  birthday?: unknown;
  notes?: unknown;
  socialUrls?: unknown;
};

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : [];

/**
 * Bulk-create people from the review step of the bulk-add flow. Accepts an
 * array of already-edited person objects and inserts them all scoped to the
 * current user. Returns how many were created.
 */
export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as { people?: IncomingPerson[] };
  if (!Array.isArray(body.people) || body.people.length === 0) {
    return NextResponse.json({ error: "people required" }, { status: 400 });
  }
  if (body.people.length > 200) {
    return NextResponse.json({ error: "too many people (max 200)" }, { status: 400 });
  }

  const rows: Prisma.PersonCreateManyInput[] = [];
  for (const p of body.people) {
    const firstName = str(p.firstName);
    if (!firstName) continue; // silently skip rows the user blanked out

    let birthday: Date | null = null;
    if (typeof p.birthday === "string" && p.birthday.trim()) {
      const d = new Date(p.birthday);
      if (!Number.isNaN(d.getTime())) birthday = d;
    }

    const social =
      p.socialUrls && typeof p.socialUrls === "object" && !Array.isArray(p.socialUrls)
        ? (p.socialUrls as Record<string, string | null>)
        : null;

    rows.push({
      userId,
      firstName,
      lastName: str(p.lastName),
      strength: str(p.strength),
      circles: [],
      tags: strArr(p.tags),
      interests: strArr(p.interests),
      email: str(p.email),
      phone: str(p.phone),
      company: str(p.company),
      role: str(p.role),
      city: str(p.city),
      country: str(p.country),
      howWeMet: str(p.howWeMet),
      notes: str(p.notes),
      birthday,
      socialUrls: social ?? undefined,
    });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "no valid people" }, { status: 400 });
  }

  const result = await prisma.person.createMany({ data: rows });
  return NextResponse.json({ created: result.count });
}
