import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { IntakeError, readJSON } from "@/lib/dating-intake/contracts";
import { scheduleFirstCheckIn } from "@/lib/call-sheet/first-check-in";
import { PEOPLE_CAPTURE_LIMITS, parsePeopleCapture, planPeopleCapture, type SkipReason } from "@/lib/people-capture";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

// Contact details are written to Person only; never logged.
function failure(error: unknown) {
  if (error instanceof IntakeError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  console.error("people capture failed");
  return NextResponse.json({ error: "Could not add people; try again" }, { status: 502, headers });
}

/** New macOS Contacts cards → CRM people (Mac worker scripts/contacts-crm-sync.ts). */
export async function POST(request: Request) {
  try {
    const userId = await resolveCaptureUser(request);
    if (!userId) throw new IntakeError("unauthorized", 401);
    const cards = parsePeopleCapture(await readJSON(request, PEOPLE_CAPTURE_LIMITS.maxBodyBytes));
    const existing = await prisma.person.findMany({
      where: { userId },
      select: { id: true, firstName: true, lastName: true, phone: true, email: true, externalId: true, archived: true },
    });
    const plan = planPeopleCapture(cards, existing);
    const created: { cardId: string; personId: string }[] = [];
    const skipped: { cardId: string; reason: SkipReason }[] = [...plan.skipped];
    const metAt = new Map(cards.map((card) => [card.cardId, card.createdAt]));
    for (const { cardId, data } of plan.create) {
      try {
        const person = await prisma.person.create({ data: { ...data, userId }, select: { id: true } });
        created.push({ cardId, personId: person.id });
        // New people first come up on the call sheet 30 days after the card was
        // made (when you met). The person is saved either way.
        try {
          const met = metAt.get(cardId);
          await scheduleFirstCheckIn(prisma, userId, { id: person.id, ...data }, met ? new Date(met) : new Date());
        } catch {
          console.error("first check-in not scheduled");
        }
      } catch (e) {
        // externalId is globally unique: a concurrent run (or another account) already holds it.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") skipped.push({ cardId, reason: "exists" });
        else throw e;
      }
    }
    return NextResponse.json({ created, skipped }, { headers });
  } catch (error) {
    return failure(error);
  }
}
