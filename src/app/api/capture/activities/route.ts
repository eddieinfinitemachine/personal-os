import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { IntakeError, readJSON } from "@/lib/dating-intake/contracts";
import { ACTIVITY_LIMITS, ECPAD_SOURCE, interactionData, parseActivitiesCapture } from "@/lib/ecpad-activities";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

// Note excerpts are written to Interaction only; never logged.
function failure(error: unknown) {
  if (error instanceof IntakeError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  // Two concurrent sends of the same new key: the loser retries and updates.
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    return NextResponse.json({ error: "An activity changed while saving; try again" }, { status: 409, headers });
  console.error("activities capture failed");
  return NextResponse.json({ error: "Could not save activities; try again" }, { status: 500, headers });
}

/** EC Pad note activities → Interaction rows (source "ecpad"), upserted by externalKey. */
export async function POST(request: Request) {
  try {
    const userId = await resolveCaptureUser(request);
    if (!userId) throw new IntakeError("unauthorized", 401);
    const { activities, deleted } = parseActivitiesCapture(await readJSON(request, ACTIVITY_LIMITS.maxBodyBytes));
    const personIds = [...new Set(activities.flatMap((a) => a.personIds))];
    if (personIds.length) {
      const owned = await prisma.person.findMany({ where: { userId, id: { in: personIds } }, select: { id: true } });
      if (owned.length !== personIds.length) throw new IntakeError("Unknown personId", 400);
    }
    // One transaction: a batch lands whole or not at all. Deletes only ever
    // touch this user's EC Pad rows; keys are "ecpad:"-prefixed and only this
    // route sets externalKey, so an upsert can only match an EC Pad row.
    const results = await prisma.$transaction([
      ...activities.map((activity) =>
        prisma.interaction.upsert({
          where: { userId_externalKey: { userId, externalKey: activity.externalKey } },
          create: { ...interactionData(activity), userId, externalKey: activity.externalKey, source: ECPAD_SOURCE },
          update: interactionData(activity),
          select: { id: true },
        }),
      ),
      prisma.interaction.deleteMany({ where: { userId, source: ECPAD_SOURCE, externalKey: { in: deleted } } }),
    ]);
    const removed = results[results.length - 1] as Prisma.BatchPayload;
    return NextResponse.json({ upserted: activities.length, deleted: removed.count }, { headers });
  } catch (error) {
    return failure(error);
  }
}
