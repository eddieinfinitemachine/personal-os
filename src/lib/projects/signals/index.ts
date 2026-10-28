// Every /projects signal for one run, privacy-gated. Read-only: nothing here
// writes to the database. Any source failing fails the whole collection (a
// partial picture would make the run delete real projects).

import { getGmailAddresses, isGoogleConfigured } from "@/lib/google";
import { granolaFromEnv, type GranolaClient } from "@/lib/granola";
import { SourceError, fromSource, notConfigured } from "./errors";
import { createGate, loadGateContext, type ExclusionCounts, type Gate } from "./gate";
import { collectEmails } from "./gmail";
import { collectMeetings, listPrimaryEvents } from "./meetings";
import { collectPersonal } from "./personal";
import type { SignalItem } from "./types";

const DAY = 24 * 60 * 60 * 1000;
export const PAST_DAYS = 14;
export const FUTURE_DAYS = 7;
/** Granola listing + note fetches share one deadline. */
const GRANOLA_DEADLINE_MS = 90_000;

export type SignalCounts = {
  calendarEvents: number;
  /** null: GRANOLA_API_KEY isn't set, so meetings come from the calendar only. */
  granolaNotes: number | null;
  gmailThreads: number;
  gmailRsvp: number;
  gmailSelfOnly: number;
  todos: number;
  notes: number;
  /** Items left after the gate, by kind. */
  meetings: number;
  emails: number;
  todoItems: number;
  noteItems: number;
};

export type Signals = {
  items: SignalItem[];
  counts: SignalCounts;
  excluded: ExclusionCounts;
  gate: Gate;
};

export async function collectSignals(
  userId: string,
  opts: { now?: Date; granola?: GranolaClient | null; listEvents?: typeof listPrimaryEvents } = {},
): Promise<Signals> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - PAST_DAYS * DAY);
  const until = new Date(now.getTime() + FUTURE_DAYS * DAY);
  if (!isGoogleConfigured()) throw new SourceError("google", notConfigured("Google"));

  const gate = createGate(await fromSource("gate", () => loadGateContext(userId)));
  const { account, addresses } = await fromSource("gmail", getGmailAddresses);
  const mine = new Set(addresses);
  for (const raw of [process.env.FOUNDER_EMAIL, process.env.GRANOLA_OWNER_EMAIL]) {
    const v = raw?.trim().toLowerCase();
    if (v?.includes("@")) mine.add(v);
  }
  const granola =
    opts.granola !== undefined ? opts.granola : granolaFromEnv({ signal: AbortSignal.timeout(GRANOLA_DEADLINE_MS) });

  const [meetings, emails] = await Promise.all([
    collectMeetings({
      since,
      until,
      now,
      mine,
      gate,
      granola,
      ownerEmail: process.env.GRANOLA_OWNER_EMAIL,
      listEvents: opts.listEvents,
    }),
    fromSource("gmail", () => collectEmails({ mine, account, gate })),
  ]);
  // After meetings: a todo made from an excluded Granola note is dropped too.
  const personal = await fromSource("personal", () => collectPersonal(userId, { since, gate }));

  const items = [...meetings.items, ...emails.items, ...personal.items];
  const count = (kind: SignalItem["kind"]) => items.filter((i) => i.kind === kind).length;
  return {
    items,
    counts: {
      calendarEvents: meetings.calendarEvents,
      granolaNotes: meetings.granolaNotes,
      gmailThreads: emails.threads,
      gmailRsvp: emails.rsvp,
      gmailSelfOnly: emails.selfOnly,
      todos: personal.todos,
      notes: personal.notes,
      meetings: count("meeting"),
      emails: count("email"),
      todoItems: count("todo"),
      noteItems: count("note"),
    },
    excluded: { ...gate.counts },
    gate,
  };
}
