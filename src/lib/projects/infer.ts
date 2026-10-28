// /projects inference: one Claude call turns the gated evidence (meetings,
// sent email, todos, notes) into initiative-level projects. Pure apart from
// that call, which is injectable: no database access here.
//
// Stability: the previous projects, pinned and hidden ones included, go into
// the prompt with the evidence they already own, and a card that comes back
// without its key inherits it from the previous card it shares at least half
// its evidence with. Hidden cards stay in the output so they keep their key
// and don't come back under a new name; the page filters them out.

import { createHash } from "node:crypto";
import { callClaudeJSON } from "@/lib/claude";
import type { Visibility } from "./board-model";
import { isCompany, type Company } from "./company";
import type { EvidenceKind, SignalItem, StoredEvidence } from "./signals/types";

export const MAX_CARDS = 12;
export const NAME_CHARS = 60;
export const LINE_CHARS = 160;
/** Prompt size cap (the email-scan.ts approach): items are added newest first until it is reached. */
export const PROMPT_CHARS = 60_000;
const DETAIL_CHARS: Record<EvidenceKind, number> = { meeting: 600, email: 240, todo: 160, note: 400 };
const SKIP_WINDOW_MS = 24 * 60 * 60 * 1000;
const PREFIX: Record<EvidenceKind, string> = { meeting: "m", email: "e", todo: "t", note: "n" };
const KIND_ORDER: EvidenceKind[] = ["meeting", "email", "todo", "note"];

export type PreviousProject = {
  key: string;
  name: string;
  company: Company;
  status: string | null;
  next: string | null;
  state: Visibility;
  /** Evidence refs the card holds. */
  refs: string[];
};

export type InferredProject = {
  key: string;
  name: string;
  company: Company;
  status: string | null;
  next: string | null;
  /** Newest first. */
  evidence: StoredEvidence[];
  /** The newest evidence that has already happened. */
  lastActivityAt: string | null;
};

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ---------------------------------------------------------------------------
// Change check

/** Refs plus timestamps: changes when evidence appears, disappears or moves. */
export function evidenceHash(items: SignalItem[]): string {
  const lines = items.map((i) => `${i.ref}|${i.at}`).sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 32);
}

/** Skip Claude when nothing changed since a success less than a day old. */
export function shouldSkip(
  run: { hash: string | null; lastSuccessAt: string | null } | null,
  hash: string,
  now: Date,
): boolean {
  if (!run?.hash || !run.lastSuccessAt) return false;
  return run.hash === hash && now.getTime() - Date.parse(run.lastSuccessAt) < SKIP_WINDOW_MS;
}

// ---------------------------------------------------------------------------
// Prompt

export const SYSTEM = `You work out which projects Eddie Cohen is working on right now, from his last two weeks of meetings, sent email, todos and notes, plus his calendar for the coming week.
Eddie runs Infinite Machine (electric scooters/vehicles; "C2" is a product), and also works on Olto, Silo and Walden; anything else is Personal.

A project is an initiative: a distinct piece of work with a goal, such as "ERP migration", "Product launch", "Inventory financing" or "Apartment search". Not a person, not a whole company, not a single errand, not a recurring meeting.

Rules:
- Expect 5–12 projects. Group evidence at initiative level and merge near-duplicates.
- Routine 1:1s, standups, all-hands and recurring series are not projects by themselves. Use them only as supporting evidence for a project other items establish.
- Every project needs evidence that Eddie himself was involved: he sent the email, attended the meeting, or wrote the todo or note.
- Work and personal both count, but leave out anything about health, therapy, dating, family or relationships entirely.
- company: one of "Infinite Machine", "Olto", "Silo", "Walden", "Personal".
- status: one factual line (under 140 characters) on where it stands, from the evidence only.
- next: one factual line (under 140 characters) on the next concrete step, such as an upcoming meeting, an open todo or an awaited reply. null when nothing is evident.
- Never name personal contacts in name, status or next. Company names and roles are fine.
- evidence: the ids (m…, e…, t…, n…) that belong to the project, only from the list.
- key: for a project that continues one under "Previous projects", that project's key exactly. null for a new project.
- Previous projects marked hidden are ones Eddie said are not projects. Return them with the same key while their evidence continues, and never re-create them under another name.
- If you are unsure whether a project touches a private matter, set "sensitive": true.

Reply with JSON only:
{"projects":[{"key":"…"|null,"name":"…","company":"…","status":"…","next":"…"|null,"evidence":["m1","e2"],"sensitive":false}]}`;

const oneLine = (s: string | null | undefined, max: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const day = (iso: string) => iso.slice(0, 10);

function itemLine(id: string, item: SignalItem): string {
  const parts = [id, item.upcoming ? `UPCOMING ${day(item.at)}` : day(item.at)];
  if (item.kind === "todo") parts.push(item.done ? "done" : "open");
  parts.push(oneLine(item.title, 160));
  if (item.series) parts.push("recurring");
  if (item.project) parts.push(`project: ${oneLine(item.project, 60)}`);
  if (item.from) parts.push(`sent as ${item.from}`);
  if (item.domains?.length) parts.push(`with: ${item.domains.slice(0, 6).join(", ")}`);
  const detail = oneLine(item.detail, DETAIL_CHARS[item.kind]);
  if (detail) parts.push(detail);
  return parts.join(" | ");
}

export type Prompt = {
  user: string;
  /** Prompt id ("m1") → item. */
  ids: Map<string, SignalItem>;
  omitted: number;
};

export function buildPrompt(items: SignalItem[], previous: PreviousProject[], budget = PROMPT_CHARS): Prompt {
  // Upcoming first (soonest first), then newest first, per kind; kinds take turns.
  const order = (a: SignalItem, b: SignalItem) =>
    Number(!!b.upcoming) - Number(!!a.upcoming) ||
    (a.upcoming ? Date.parse(a.at) - Date.parse(b.at) : Date.parse(b.at) - Date.parse(a.at));
  const queues = KIND_ORDER.map((k) => items.filter((i) => i.kind === k).sort(order));
  const counters: Record<EvidenceKind, number> = { meeting: 0, email: 0, todo: 0, note: 0 };

  const ids = new Map<string, SignalItem>();
  const idOf = new Map<string, string>();
  const lines: Record<EvidenceKind, string[]> = { meeting: [], email: [], todo: [], note: [] };
  // Previous projects are sized first: they always go in.
  const prevBlock = (refsToIds: (refs: string[]) => string[]) =>
    previous.length
      ? previous
          .map(
            (p) =>
              `- ${p.key} | ${p.name} | ${p.company} | ${p.state} | ${oneLine(p.status, LINE_CHARS) || "-"} | ${
                oneLine(p.next, LINE_CHARS) || "-"
              } | ${refsToIds(p.refs).join(", ") || "-"}`,
          )
          .join("\n")
      : "(none)";
  let used = SYSTEM.length + prevBlock(() => []).length + previous.length * 40;
  let omitted = 0;
  const full = new Set<EvidenceKind>();
  for (let round = 0; full.size < KIND_ORDER.length; round++) {
    for (const [k, kind] of KIND_ORDER.entries()) {
      if (full.has(kind)) continue;
      const item = queues[k][round];
      if (!item) {
        full.add(kind);
        continue;
      }
      const id = `${PREFIX[kind]}${counters[kind] + 1}`;
      const line = itemLine(id, item);
      if (used + line.length + 1 > budget) {
        full.add(kind);
        omitted += queues[k].length - round;
        continue;
      }
      counters[kind]++;
      used += line.length + 1;
      ids.set(id, item);
      idOf.set(item.ref, id);
      lines[kind].push(line);
    }
  }

  const section = (title: string, kind: EvidenceKind) => `${title}:\n${lines[kind].join("\n") || "(none)"}`;
  const user = [
    `Previous projects (key | name | company | state | status | next | evidence ids this run):\n${prevBlock((refs) =>
      refs.map((r) => idOf.get(r)).filter((x): x is string => !!x),
    )}`,
    "Evidence (id | date | … ). Dates are YYYY-MM-DD.",
    section("Meetings", "meeting"),
    section("Sent email threads", "email"),
    section("Todos", "todo"),
    section("Notes", "note"),
  ].join("\n\n");
  return { user, ids, omitted };
}

// ---------------------------------------------------------------------------
// Validation

type RawProject = {
  key?: unknown;
  name?: unknown;
  company?: unknown;
  status?: unknown;
  next?: unknown;
  evidence?: unknown;
  sensitive?: unknown;
};

const clip = (v: unknown, max: number): string => {
  if (typeof v !== "string") return "";
  const t = v.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

export function validateProjects(
  raw: unknown,
  ctx: {
    ids: Map<string, SignalItem>;
    previous: PreviousProject[];
    now: Date;
    /** The privacy gate's text check, applied to names, status and next. */
    isSensitive?: (text: string) => boolean;
  },
): InferredProject[] {
  const list = (raw as { projects?: unknown } | null)?.projects;
  if (!Array.isArray(list)) throw new ValidationError("no projects array");
  const prevByKey = new Map(ctx.previous.map((p) => [p.key, p]));
  const taken = new Set<string>();
  const out: (InferredProject & { state: Visibility })[] = [];

  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as RawProject;
    if (r.sensitive === true) continue;
    const name = clip(r.name, NAME_CHARS);
    if (!name) continue;
    const status = clip(r.status, LINE_CHARS) || null;
    const next = clip(r.next, LINE_CHARS) || null;
    if ([name, status, next].some((t) => t && ctx.isSensitive?.(t))) continue;

    const seen = new Set<string>();
    const items: SignalItem[] = [];
    for (const id of Array.isArray(r.evidence) ? r.evidence : []) {
      const item = typeof id === "string" ? ctx.ids.get(id.trim()) : undefined;
      if (item && !seen.has(item.ref)) {
        seen.add(item.ref);
        items.push(item);
      }
    }

    const free = (k: string) => prevByKey.has(k) && !taken.has(k);
    let key = typeof r.key === "string" && free(r.key) ? r.key : null;
    if (!key) key = carryOver([...seen], ctx.previous, taken);
    if (!key && free(slugify(name))) key = slugify(name);
    const existing = !!key;
    if (items.length < (existing ? 1 : 2)) continue;
    // One recurring series alone (a weekly 1:1) is not a project.
    const series = new Set(items.map((i) => i.series ?? null));
    if (series.size === 1 && !series.has(null)) continue;
    if (!key) key = uniqueSlug(name, taken, prevByKey);
    if (!key) continue;
    taken.add(key);

    const evidence = items
      .map(({ ref, kind, title, at, url }) => ({ ref, kind, title, at, url }))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const past = evidence.find((e) => Date.parse(e.at) <= ctx.now.getTime());
    out.push({
      key,
      name,
      company: isCompany(r.company) ? r.company : "Personal",
      status,
      next,
      evidence,
      lastActivityAt: past?.at ?? null,
      state: prevByKey.get(key)?.state ?? "auto",
    });
  }

  // At most MAX_CARDS shown: pinned first, then the most recent. Hidden ones don't count.
  const at = (p: InferredProject) => (p.lastActivityAt ? Date.parse(p.lastActivityAt) : 0);
  const shown = out
    .filter((p) => p.state !== "hidden")
    .sort((a, b) => Number(b.state === "pinned") - Number(a.state === "pinned") || at(b) - at(a))
    .slice(0, MAX_CARDS);
  const keep = new Set([...shown, ...out.filter((p) => p.state === "hidden")]);
  return out.filter((p) => keep.has(p)).map(({ state: _state, ...p }) => p);
}

/** The previous card sharing at least half of this card's evidence (the most, if several). */
function carryOver(refs: string[], previous: PreviousProject[], taken: Set<string>): string | null {
  if (!refs.length) return null;
  let best: { key: string; overlap: number } | null = null;
  for (const p of previous) {
    if (taken.has(p.key)) continue;
    const own = new Set(p.refs);
    const overlap = refs.filter((r) => own.has(r)).length;
    if (overlap * 2 >= refs.length && overlap > 0 && (!best || overlap > best.overlap)) best = { key: p.key, overlap };
  }
  return best?.key ?? null;
}

function uniqueSlug(name: string, taken: Set<string>, previous: Map<string, PreviousProject>): string | null {
  const base = slugify(name);
  if (!base) return null;
  let key = base;
  for (let n = 2; taken.has(key) || previous.has(key); n++) key = `${base}-${n}`;
  return key;
}

// ---------------------------------------------------------------------------
// The call

export async function inferProjects(input: {
  items: SignalItem[];
  previous: PreviousProject[];
  now: Date;
  isSensitive?: (text: string) => boolean;
  claude?: typeof callClaudeJSON;
}): Promise<{ projects: InferredProject[]; omitted: number }> {
  if (!input.items.length) return { projects: [], omitted: 0 };
  const prompt = buildPrompt(input.items, input.previous);
  const raw = await (input.claude ?? callClaudeJSON)<unknown>({
    system: SYSTEM,
    user: prompt.user,
    maxTokens: 8000,
    timeoutMs: 150_000,
  });
  return {
    projects: validateProjects(raw, { ids: prompt.ids, previous: input.previous, now: input.now, isSensitive: input.isSensitive }),
    omitted: prompt.omitted,
  };
}
