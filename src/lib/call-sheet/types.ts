import type { ReachOutMethod } from "./reach-out";
export type CallSheetSource = "imessage" | "whatsapp";
export type EvidenceCue = {
  kind: "topic" | "follow_up";
  text: string;
  evidence: {
    source: CallSheetSource;
    messageId: string;
    sentAt: string;
    excerpt: string;
  }[];
};
export type SourceHealth = {
  enabled: boolean;
  status: "not_connected" | "ready" | "error" | "syncing";
  lastSuccessAt: string | null;
  error: string | null;
};
export type CallSheetEntry = {
  id: string;
  personId: string;
  name: string;
  imageUrl: string | null;
  phone: string | null;
  email: string | null;
  reason: string;
  topic: string | null;
  lastContactAt: string | null;
  lastContactSource: string | null;
  status: "pending" | "done" | "contacted";
  cues: EvidenceCue[];
  cadenceDays: number;
  interactionId?: string;
  method?: ReachOutMethod;
};
export type CallSheetResponse = {
  day: { id: string; localDate: string; version: number };
  entries: CallSheetEntry[];
  sources: Record<CallSheetSource, SourceHealth>;
  timezone: string;
  hidden: { personId: string; name: string }[];
  /** People with no contact on record waiting for a quick review. */
  reviewCount: number;
  undoToken?: string;
};
export type CallSheetReviewPerson = {
  personId: string;
  name: string;
  imageUrl: string | null;
  company: string | null;
  role: string | null;
  city: string | null;
  howWeMet: string | null;
  strength: string | null;
  circles: string[];
  tags: string[];
  summary: string | null;
  reachable: boolean;
};
export type CallSheetReview = {
  total: number;
  people: CallSheetReviewPerson[];
};
export type CallSheetReviewDecision =
  | { personId: string; decision: "keep"; cadenceDays: number }
  | { personId: string; decision: "hide" | "reset" };
export type CallSheetMutation = {
  dayId: string;
  version: number;
  entryId?: string;
  action: "done" | "undo" | "snooze" | "replace" | "hide";
  days?: number;
  method?: ReachOutMethod;
  undoToken?: string;
};
export type CallSheetSettingsMutation = {
  source?: CallSheetSource;
  enabled?: boolean;
  restorePersonId?: string;
  personId?: string;
  cadenceDays?: number | null;
  timezone?: string;
};
export type CaptureMessage = {
  guid: string;
  sentAt: string;
  fromMe: boolean;
  text: string;
};
export type CapturePerson = {
  type: "person";
  sourceEpoch: string;
  extract?: boolean;
  personId: string;
  identityKey: string;
  handles: string[];
  source: CallSheetSource;
  capturedAt: string;
  coverageStart: string;
  lastContactAt: string | null;
  messageCount: number;
  messages: CaptureMessage[];
};
export type CaptureHealth = {
  type: "health";
  sourceEpoch: string;
  source: CallSheetSource;
  status: "ready" | "error" | "syncing";
  capturedAt: string;
  error?: string;
};
export type CaptureConfig = {
  sourceEpochs?: Record<CallSheetSource, string>;
  sources: Record<CallSheetSource, boolean>;
  people: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    identityKey: string;
    starred?: boolean;
    strength?: string | null;
    cadenceDays?: number;
    lastSuggestedAt?: string | null;
  }[];
  blockedHandles: string[];
};
export type ContactSourceData = {
  handles?: string[];
  revision?: string;
  capturedAt: string;
  coverageStart: string;
  lastContactAt: string | null;
  messageCount: number;
  cues: EvidenceCue[];
  extractionPending: boolean;
};
