// Evidence for /projects inference. Pure types, shared by the collectors, the
// inference step, the store and the client board.

export type EvidenceKind = "meeting" | "email" | "todo" | "note";
export const EVIDENCE_KINDS: readonly EvidenceKind[] = ["meeting", "email", "todo", "note"];

/** What a card keeps per piece of evidence (ProjectSource.commits). */
export type StoredEvidence = {
  /** Stable source id: gmail:<threadId>, granola:<id>, gcal:<id>, todo:<id>, note:<id>. */
  ref: string;
  kind: EvidenceKind;
  title: string;
  at: string;
  /** Built from the source's own ids, never from model output. */
  url: string | null;
};

/** One collected item, after the privacy gate. The extra fields only feed the prompt. */
export type SignalItem = StoredEvidence & {
  /** A calendar event that hasn't happened yet (feeds "Next:"). */
  upcoming?: boolean;
  /** Calendar recurring series id. */
  series?: string | null;
  /** Meeting summary, email snippet or note body (already gated; truncated in the prompt). */
  detail?: string | null;
  /** Other participants' email domains. */
  domains?: string[];
  /** The address Eddie sent from (a company signal). */
  from?: string | null;
  /** The personal-os Project a todo or note lives in. */
  project?: string | null;
  /** A completed todo. */
  done?: boolean;
};
