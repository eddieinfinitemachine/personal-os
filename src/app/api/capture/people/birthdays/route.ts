import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { IntakeError, readJSON } from "@/lib/dating-intake/contracts";
import { PEOPLE_CAPTURE_LIMITS, parseBirthdayCapture, planBirthdayFill } from "@/lib/people-capture";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

// Contact details are matched only; never logged or returned.
function failure(error: unknown) {
  if (error instanceof IntakeError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  console.error("birthday capture failed");
  return NextResponse.json({ error: "Could not save birthdays; try again" }, { status: 502, headers });
}

/**
 * macOS Contacts birthdays → existing CRM people (Mac worker
 * scripts/contacts-crm-sync.ts). Fill-only: never creates a person and never
 * overwrites a birthday already in the CRM. Answers with counts only.
 */
export async function POST(request: Request) {
  try {
    const userId = await resolveCaptureUser(request);
    if (!userId) throw new IntakeError("unauthorized", 401);
    const cards = parseBirthdayCapture(await readJSON(request, PEOPLE_CAPTURE_LIMITS.maxBodyBytes));
    const people = await prisma.person.findMany({
      where: { userId, archived: false },
      select: { id: true, phone: true, email: true, externalId: true, birthday: true },
    });
    const plan = planBirthdayFill(cards, people);
    let filled = 0;
    for (const { personId, birthday } of plan.fill) {
      // `birthday: null` keeps a concurrent edit in the CRM from being overwritten.
      const result = await prisma.person.updateMany({ where: { id: personId, userId, birthday: null }, data: { birthday } });
      filled += result.count;
    }
    return NextResponse.json({ filled, ...plan.counts }, { headers });
  } catch (error) {
    return failure(error);
  }
}
