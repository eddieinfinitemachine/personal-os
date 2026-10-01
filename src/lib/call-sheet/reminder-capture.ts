import { prisma } from "@/lib/prisma";
import { IntakeError } from "@/lib/dating-intake/contracts";
import type { CallSheetProposal } from "@/lib/smart-capture";
import { isLocalDate, localDate } from "./policy";
import { checkReminderDate, setCallSheetReminder } from "./service";
import { displayName, resolveOrCreatePerson } from "./resolve-person";

export type CallSheetCaptureResult =
  | {
      ok: true;
      personId: string;
      name: string;
      dueOn: string;
      note: string | null;
      created: boolean;
      message: string;
    }
  | { ok: false; status: number; error: string; candidates?: string[] };

async function userTimezone(userId: string) {
  const settings = await prisma.callSheetSettings.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  return settings?.timezone ?? "America/New_York";
}
/** The user's local date (Call Sheet timezone) for resolving "Tuesday" or
 * "tomorrow"; a UTC date is a day ahead every US evening. */
export async function userLocalToday(userId: string, now = new Date()) {
  return localDate(now, await userTimezone(userId));
}

/** "Tue, Oct 6" for a local YYYY-MM-DD. */
export function formatReminderDate(dueOn: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dueOn}T12:00:00Z`));
}

/** Commit a call_sheet capture: validate the date, resolve (or create) the
 * person, then set the reminder. Never guesses between people with one name. */
export async function commitCallSheetProposal(
  userId: string,
  proposal: CallSheetProposal,
  now = new Date(),
): Promise<CallSheetCaptureResult> {
  const firstName = proposal.firstName?.trim();
  if (!firstName)
    return { ok: false, status: 400, error: "Who should go on the call sheet?" };
  if (!isLocalDate(proposal.date))
    return { ok: false, status: 400, error: "Choose a valid date" };
  const note = proposal.note?.trim() || null;
  if (note && note.length > 200)
    return { ok: false, status: 400, error: "Keep the note to 200 characters" };
  const timezone = await userTimezone(userId);
  try {
    // Check before resolving so a bad date never leaves a stray new person.
    checkReminderDate(proposal.date, timezone, now);
    const resolved = await resolveOrCreatePerson(userId, {
      firstName,
      lastName: proposal.lastName,
    });
    if (resolved.kind === "ambiguous") {
      const candidates = resolved.candidates.map(displayName);
      return {
        ok: false,
        status: 409,
        error: `More than one person is called ${displayName({ firstName, lastName: proposal.lastName })}: ${candidates.join(", ")}. Use their full name.`,
        candidates,
      };
    }
    await setCallSheetReminder(
      userId,
      { personId: resolved.person.id, dueOn: proposal.date, note },
      now,
    );
    const name = displayName(resolved.person);
    const today = localDate(now, timezone);
    return {
      ok: true,
      personId: resolved.person.id,
      name,
      dueOn: proposal.date,
      note,
      created: resolved.kind === "created",
      message:
        proposal.date === today
          ? `${name} is on your call sheet today`
          : `${name} will be on your call sheet ${formatReminderDate(proposal.date)}`,
    };
  } catch (error) {
    if (error instanceof IntakeError)
      return { ok: false, status: error.status, error: error.message };
    throw error;
  }
}
