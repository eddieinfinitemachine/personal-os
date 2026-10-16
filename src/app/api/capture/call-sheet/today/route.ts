import { NextResponse } from "next/server";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { IntakeError, object, readJSON } from "@/lib/dating-intake/contracts";
import {
  checkInUndoToken,
  getCallSheet,
  mutateCallSheet,
} from "@/lib/call-sheet/service";
import { callSheetFailure } from "@/lib/call-sheet/http";
import { appUrl } from "@/lib/gcal";
import type { CallSheetResponse } from "@/lib/call-sheet/types";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

// Today's call sheet for native clients (Fork Calendar), behind the capture
// bearer. Same service as GET /api/call-sheet, mapped into a small fixed
// contract instead of the web UI's full shape:
//   { date: "YYYY-MM-DD",
//     items: [{ personId, name, reason: string | null, done, url }] }
export async function GET(request: Request) {
  try {
    const userId = await resolveCaptureUser(request);
    if (!userId) throw new IntakeError("unauthorized", 401);
    return NextResponse.json(toFeed(await getCallSheet(userId)), { headers });
  } catch (error) {
    return callSheetFailure(error);
  }
}

// Change one person on today's sheet, keyed by personId so native clients never
// handle day ids, versions or undo tokens. Body is one of:
//   { personId, done: true }    check in (logged as method "other": the client
//                               doesn't know the channel)
//   { personId, done: false }   undo that check-in, only while it is still the
//                               sheet's last change (the web's single-slot Undo)
//   { personId, replace: true } "Someone else today"
// Answers with the updated feed in the GET's shape. `done` is idempotent
// against the feed's own `done` flag, so a "contacted" row is left alone.
export async function POST(request: Request) {
  try {
    const userId = await resolveCaptureUser(request);
    if (!userId) throw new IntakeError("unauthorized", 401);
    const change = parseChange(await readJSON(request, 4096));
    let sheet: CallSheetResponse;
    try {
      sheet = await apply(userId, change);
    } catch (error) {
      // The service answers 409 when the sheet moved between our read and the
      // write (version bump, day rollover, a concurrent change). apply()
      // decides everything from a fresh read, so one retry is safe.
      if (
        !(error instanceof IntakeError) ||
        error.status !== 409 ||
        error instanceof Declined
      )
        throw error;
      sheet = await apply(userId, change);
    }
    return NextResponse.json(toFeed(sheet), { headers });
  } catch (error) {
    return callSheetFailure(error);
  }
}

type Change =
  | { personId: string; done: boolean }
  | { personId: string; replace: true };

function parseChange(raw: unknown): Change {
  const input = object(raw);
  if (Object.keys(input).some((key) => !["personId", "done", "replace"].includes(key)))
    throw new IntakeError("Unknown field");
  const { personId, done, replace } = input;
  if (typeof personId !== "string" || !personId || personId.length > 200)
    throw new IntakeError("personId must be a non-empty string");
  if ((done === undefined) === (replace === undefined))
    throw new IntakeError("Send exactly one of done or replace");
  if (replace !== undefined) {
    if (replace !== true) throw new IntakeError("replace must be true");
    return { personId, replace };
  }
  if (typeof done !== "boolean") throw new IntakeError("done must be a boolean");
  return { personId, done };
}

async function apply(userId: string, change: Change): Promise<CallSheetResponse> {
  const sheet = await getCallSheet(userId);
  const entry = sheet.entries.find((item) => item.personId === change.personId);
  if (!entry) throw new IntakeError("not on today's call sheet", 404);
  const base = { dayId: sheet.day.id, version: sheet.day.version, entryId: entry.id };
  if ("replace" in change) {
    try {
      return await mutateCallSheet(userId, { ...base, action: "replace" });
    } catch (error) {
      // 422 is the service declining on purpose: nobody else is due, so the
      // person stays.
      if (error instanceof IntakeError && error.status === 422)
        throw new Declined(error.message);
      throw error;
    }
  }
  if (change.done === (entry.status !== "pending")) return sheet;
  if (change.done)
    return mutateCallSheet(userId, { ...base, action: "done", method: "other" });
  // Un-checking. A "contacted" row came from message evidence, not a check-in,
  // and already reads as done; leave it.
  if (entry.status !== "done") return sheet;
  const undoToken = await checkInUndoToken(userId, sheet.day.id, entry.personId);
  if (!undoToken)
    throw new Declined("Only the most recent call-sheet change can be undone.");
  return mutateCallSheet(userId, {
    dayId: sheet.day.id,
    version: sheet.day.version,
    action: "undo",
    undoToken,
  });
}

/** A 409 that a retry wouldn't change, so the conflict retry skips it. */
class Declined extends IntakeError {
  constructor(message: string) {
    super(message, 409);
  }
}

function toFeed(sheet: CallSheetResponse) {
  // The web sheet shows "Birthdays today" above the regular list; keep that
  // order (each group in service order).
  const entries = [
    ...sheet.entries.filter((entry) => entry.section === "birthday"),
    ...sheet.entries.filter((entry) => entry.section !== "birthday"),
  ];
  return {
    date: sheet.day.localDate,
    items: entries.map((entry) => ({
      personId: entry.personId,
      name: entry.name,
      reason: entry.reason || null,
      // "done" (checked in) and "contacted" (recent message seen) both count
      // as checked in on the web sheet.
      done: entry.status !== "pending",
      // Same profile link as the web call sheet row.
      url: new URL(
        `/friends?person=${encodeURIComponent(entry.personId)}`,
        appUrl(),
      ).toString(),
    })),
  };
}
