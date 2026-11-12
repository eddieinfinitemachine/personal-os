import type { PrismaClient } from "@prisma/client";
import { addLocalDays, identityKey, localDate, snoozeUntil, type Identity } from "./policy";

/** A new person first comes up on the call sheet this many days after you met. */
export const FIRST_CHECK_IN_DAYS = 30;
export const FIRST_CHECK_IN_NOTE = "You met a month ago. Decide how often to check in.";

/**
 * When someone new first belongs on the sheet: the local date 30 days after
 * `metAt`, and the instant that day starts. Until then they are snoozed, so
 * routine suggestions wait; on the day the reminder puts them on the sheet,
 * and the cadence is the owner's to choose from there (none is set here).
 */
export function firstCheckIn(metAt: Date, timezone: string) {
  return {
    dueOn: addLocalDays(localDate(metAt, timezone), FIRST_CHECK_IN_DAYS),
    snoozedUntil: snoozeUntil(metAt, FIRST_CHECK_IN_DAYS, timezone),
  };
}

type Db = Pick<PrismaClient, "callSheetSettings" | "callSheetContact">;

/**
 * Gives a newly created person their first check-in. Never touches a person
 * who already has call sheet preferences. A date already past (a card from
 * weeks ago) means the next sheet.
 */
export async function scheduleFirstCheckIn(
  db: Db,
  userId: string,
  person: Identity & { id: string },
  metAt: Date = new Date(),
) {
  const settings = await db.callSheetSettings.upsert({ where: { userId }, create: { userId }, update: {} });
  const when = firstCheckIn(Number.isNaN(metAt.getTime()) ? new Date() : metAt, settings.timezone);
  await db.callSheetContact.upsert({
    where: { userId_personId: { userId, personId: person.id } },
    create: { userId, personId: person.id, identityKey: identityKey(person), dueOn: when.dueOn, dueNote: FIRST_CHECK_IN_NOTE, snoozedUntil: when.snoozedUntil },
    update: {},
  });
}
