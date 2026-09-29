/**
 * AI-written context about a CRM Person, derived from iMessage/WhatsApp threads
 * (read on the Mac, never stored server-side), existing CRM fields and
 * interactions, Granola meetings, and optional public web search.
 *
 * Stored in `Person.context` (Json) with `Person.contextAt`. Manual fields
 * (`notes`, `howWeMet`, `role`, …) are inputs only and are never written by
 * this pipeline.
 */
export const PERSON_CONTEXT_VERSION = "2026-09-29.1";

export type ContextBasis = "stated" | "inferred";
export type ContextConfidence = "high" | "medium" | "low";

export type ContextSource = "imessage" | "whatsapp" | "crm" | "granola" | "web";

export type ContextEvidence = {
  source: ContextSource;
  /** ISO date of the message/meeting the quote comes from, when known. */
  at?: string;
  /** Short verbatim quote (≤ 200 chars). For web: the page title. */
  quote: string;
  /** Web only: page URL. */
  url?: string;
};

export type ContextItem = {
  text: string;
  confidence: ContextConfidence;
  evidence?: ContextEvidence;
};

export type PersonContext = {
  version: string;
  generatedAt: string;
  model: string;
  /** 2–3 sentences: who this person is to Eddie, in plain language. */
  summary: string;
  /** How Eddie knows them. `basis: "inferred"` unless a message/CRM field states it outright. */
  relationship: { text: string; basis: ContextBasis };
  /** Recent recurring subjects, newest first (≤ 6). */
  topics: string[];
  /** Durable facts: job change, move, kids, health, plans (≤ 8). */
  facts: ContextItem[];
  /** Promises made, questions unanswered, plans to follow up on (≤ 5). */
  openLoops: ContextItem[];
  /** Public info from web search, only when Person.company or role is set. */
  publicContext?: { text: string; sources: { title: string; url: string }[] };
  /** What went into this generation. Counts only, no message text. */
  inputs: {
    imessage?: { messages: number; from: string; to: string };
    whatsapp?: { messages: number; from: string; to: string };
    interactions?: number;
    granolaMeetings?: number;
    webSearched?: boolean;
  };
  /** sha256 of every input, so unchanged inputs skip regeneration. */
  sourceFingerprint: string;
  /** Present while a generation is in flight (lease), like DatingPerson.insights. */
  generation?: { owner: string; startedAt: string };
};

/** One bounded thread posted from the Mac. Never persisted. */
export type ContextThread = {
  source: "imessage" | "whatsapp";
  messages: { id: string; sentAt: string; fromMe: boolean; text: string }[];
};

export const CONTEXT_LIMITS = {
  threadDays: 365,
  maxMessagesPerPerson: 600,
  maxCharsPerMessage: 2000,
  maxThreadChars: 80_000,
  maxBodyBytes: 200_000,
  maxGranolaMeetings: 5,
  /** Newest notes whose attendees/summary are read; older ones match on title only. */
  maxGranolaDetailNotes: 40,
  maxGranolaCharsPerMeeting: 4000,
} as const;
