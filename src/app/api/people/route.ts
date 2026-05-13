import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const people = await prisma.person.findMany({
    where: { archived: false },
    orderBy: [
      { starred: "desc" },
      { lastInteractionAt: { sort: "asc", nulls: "first" } },
      { firstName: "asc" },
    ],
  });
  return NextResponse.json({ people });
}

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
  if (!firstName) {
    return NextResponse.json({ error: "firstName required" }, { status: 400 });
  }
  const snapshot = {
    firstName,
    lastName: typeof body.lastName === "string" ? body.lastName : null,
    strength: typeof body.strength === "string" ? body.strength : null,
    circles: Array.isArray(body.circles) ? (body.circles as string[]) : [],
    tags: Array.isArray(body.tags) ? (body.tags as string[]) : [],
    email: typeof body.email === "string" ? body.email : null,
    phone: typeof body.phone === "string" ? body.phone : null,
    company: typeof body.company === "string" ? body.company : null,
    role: typeof body.role === "string" ? body.role : null,
    city: typeof body.city === "string" ? body.city : null,
    birthday: typeof body.birthday === "string" ? new Date(body.birthday) : null,
    lastInteractionAt:
      typeof body.lastInteractionAt === "string"
        ? new Date(body.lastInteractionAt)
        : null,
    notes: typeof body.notes === "string" ? body.notes : null,
    imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : null,
  };

  const person = await prisma.person.create({ data: snapshot });
  return NextResponse.json({ person });
}
