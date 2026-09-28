import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockOwner } from "./store";
import type { eventPatch } from "@/lib/dating-server";
export async function mutateEvent(
  userId: string,
  id: string,
  patch: ReturnType<typeof eventPatch> | null,
) {
  return prisma.$transaction(async (tx) => {
    await lockOwner(tx, userId);
    const existing = await tx.datingEvent.findFirst({ where: { userId, id } });
    if (!existing) return null;
    const event = patch
      ? await tx.datingEvent.update({ where: { id }, data: patch })
      : await tx.datingEvent.delete({ where: { id } });
    await tx.datingPerson.updateMany({
      where: { id: event.personId, userId },
      data: { insights: Prisma.DbNull, insightsAt: null },
    });
    return event;
  });
}
export async function createEvent(
  userId: string,
  personId: string,
  data: ReturnType<typeof eventPatch> & { title: string },
) {
  return prisma.$transaction(async (tx) => {
    await lockOwner(tx, userId);
    const person = await tx.datingPerson.findFirst({
      where: { userId, id: personId },
    });
    if (!person) return null;
    const event = await tx.datingEvent.create({
      data: {
        userId,
        personId,
        title: data.title,
        kind: data.kind ?? "date",
        occurredAt: data.occurredAt ?? new Date(),
        notes: data.notes ?? null,
        vibe: data.vibe ?? null,
      },
    });
    await tx.datingPerson.update({
      where: { id: personId },
      data: { insights: Prisma.DbNull, insightsAt: null },
    });
    return event;
  });
}
