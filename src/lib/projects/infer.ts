// /projects inference: one Claude call turns the gated evidence (meetings,
// sent email, todos, notes) into projects, with their next steps and anything
// stuck. Pure apart from that call, which is injectable: no database access here.
//
// Stability: the previous projects, pinned, hidden and finished ones included, go into
// the prompt with the evidence they already own, and a card that comes back
// without its key inherits it from the previous card it shares at least half
// its evidence with. Hidden cards stay in the output so they keep their key
// and don't come back under a new name; the page filters them out.

import { createHash } from "node:crypto";
import { callClaudeJSON } from "@/lib/claude";
import type { Visibility } from "./board-model";
import { isCompany, type Company } from "./company";
import type { EvidenceKind, SignalItem, StoredEvidence } from "./signals/types";

/** A backstop, not a target: a silent cut is how real projects went missing. */
export const MAX_CARDS = 40;
export const MAX_STEPS = 3;
export const NAME_CHARS = 60;
export const LINE_CHARS = 160;
const STEP_CHARS = 100;
const WHO_CHARS = 40;
/** A thread this long is enough for a new card by itself. */
const LONG_THREAD = 3;
/** Share of a step's words found in a closed todo for it to count as a copy. */
const CLOSED_COPY = 0.6;
/** Prompt size cap (the email-scan.ts approach): items are added newest first until it is reached. */
export const PROMPT_CHARS = 130_000;
const DETAIL_CHARS: Record<EvidenceKind, number> = { meeting: 1900, email: 1100, todo: 160, note: 400 };
/** Long notes keep both ends: next steps are usually last. */
const NOTE_HEAD = 650;
const NOTE_TAIL = 1200;
const COMING_DAYS = 14;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const OWNER = /^(eddie|eddie cohen|me)$/i;
const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
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

export type ProjectStep = {
  text: string;
  /** YYYY-MM-DD, only when the evidence gives a date. */
  due: string | null;
  who: string | null;
  /** The next move belongs to `who`, not Eddie. */
  waiting: boolean;
};

export type InferredProject = {
  key: string;
  name: string;
  company: Company;
  status: string | null;
  /** What is stuck, late or at risk. */
  problem: string | null;
  steps: ProjectStep[];
  /** The first step's text. */
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

export const SYSTEM = `You keep Eddie Cohen's project board. From his last two weeks of meetings, sent email, todos and notes, plus his calendar for the coming week, work out the projects he is moving forward right now and what has to happen next on each.
Eddie runs Infinite Machine (electric vehicles; Olto and C2 are its products). He also works on Silo and Walden. Anything else is Personal.

A project is a piece of work with a goal and an end that takes several steps or other people over more than a few days. A single production order, a collaboration with one outside studio, one regulatory filing or one event all count, however small the budget.

Not a project: a one-off errand (activating software, sending images, one refund, signing one form, a reimbursement), a person, a whole company, a recurring meeting, or anything already finished or declined with nothing left to do. A first intro with no agreed work is not its own project: put it under the fundraise or partnership project it feeds. Errands stay on his todo list, so leave them out.

Rules:
- List every real project: most weeks that is 20 to 35. Never drop one to reach a count.
- Before you answer, go through the upcoming meetings. Any that isn't routine and belongs to a project must be on that project's card, as a step.
- One project across todos, email and meetings is one card. Keep projects separate when they have a different vendor, product, deadline or outcome. No umbrella cards that collect unrelated items.
- Name each project the way the people doing it would, using the product, vendor or partner name when the evidence gives one.
- Routine 1:1s, standups, all-hands and recurring series are not projects by themselves. Use them only as supporting evidence for a project other items establish.
- Every project needs evidence that Eddie himself was involved: he sent the email, attended the meeting, or wrote the todo or note.
- Work and personal both count, but leave out anything about health, therapy, dating, family or relationships entirely.
- company: one of "Infinite Machine", "Silo", "Walden", "Personal".
- status: one factual line (under 140 characters) on where it stands, from the evidence only. State figures only when an item states them.
- problem: one short factual line naming what is stuck, late or at risk, with any amount at stake. null otherwise.
- A todo marked CLOSED is off Eddie's list. That does not prove the work happened. Never make it a step, and never report it as pending or as done. When a CLOSED todo is the only sign of whether something happened, say in status that it is unclear. A CLOSED todo never cancels a meeting still on the calendar.
- steps: the open next actions, 0 to ${MAX_STEPS}, from the evidence only, most urgent first. An upcoming meeting that belongs to the project is a step with its date. Each step has:
  - text: under 80 characters.
  - due: YYYY-MM-DD only when the evidence gives a date. Resolve a weekday or "this weekend" in a todo from the day it was written, and in a meeting or email from its date, using the coming dates listed. A deadline may already be past: keep the real date. Otherwise null. Never guess.
  - who: "Eddie", a colleague, or the outside company. null if unclear.
  - waiting: true only when the next move belongs to someone other than Eddie, and who names them. When Eddie sent the last message in a thread more than 3 days ago with no reply, the next move is theirs: list it as waiting and say since when.
- Never name personal contacts in name, status, problem or steps. Company names, colleagues and roles are fine.
- evidence: the ids (m…, e…, t…, n…) that belong to the project, only from the list. Never mention these ids in name, status, problem or steps.
- key: for a project that continues one under "Previous projects", that project's key exactly. Return every previous project that still has evidence. null for a new project.
- Previous projects marked hidden are ones Eddie said are not projects. Return them with the same key while their evidence continues, and never re-create them under another name.
- Previous projects marked finished are ones Eddie closed out. Return them with the same key and no steps while their evidence continues, and never re-create them under another name.
- If you are unsure whether a project touches a private matter, set "sensitive": true and keep its key if it has one.

Reply with JSON only:
{"projects":[{"key":"…"|null,"name":"…","company":"…","status":"…","problem":"…"|null,"steps":[{"text":"…","due":"…"|null,"who":"…"|null,"waiting":false}],"evidence":["m1","e2"],"sensitive":false}]}`;

const oneLine = (s: string | null | undefined, max: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
/** The calendar day in New York, where "by Sunday" is meant. */
const day = (iso: string | Date) => dayFormat.format(new Date(iso));
const weekdayOf = (ymd: string): string | undefined => WEEKDAYS[new Date(`${ymd}T12:00:00Z`).getUTCDay()];

/** "Today is tuesday 2026-11-03. Coming dates: wed 2026-11-04, …" */
function datesLine(now: Date): string {
  const noon = Date.parse(`${day(now)}T12:00:00Z`);
  const coming = Array.from({ length: COMING_DAYS }, (_, i) => {
    const ymd = new Date(noon + (i + 1) * SKIP_WINDOW_MS).toISOString().slice(0, 10);
    return `${weekdayOf(ymd)!.slice(0, 3)} ${ymd}`;
  });
  return `Today is ${weekdayOf(day(now))} ${day(now)}. Coming dates: ${coming.join(", ")}.`;
}

function itemDetail(item: SignalItem): string {
  if (item.kind !== "meeting") return oneLine(item.detail, DETAIL_CHARS[item.kind]);
  const text = oneLine(item.detail, Number.POSITIVE_INFINITY);
  return text.length > DETAIL_CHARS.meeting ? `${text.slice(0, NOTE_HEAD)} … ${text.slice(-NOTE_TAIL)}` : text;
}

function itemLine(id: string, item: SignalItem): string {
  const parts = [id];
  if (item.kind === "todo") {
    if (item.writtenAt) parts.push(`written ${day(item.writtenAt)}`);
    parts.push(item.done ? `CLOSED ${day(item.at)}` : "OPEN");
  } else {
    parts.push(item.upcoming ? `UPCOMING ${day(item.at)}` : day(item.at));
  }
  parts.push(oneLine(item.title, 160));
  if (item.series) parts.push("recurring");
  if (item.project) parts.push(`project: ${oneLine(item.project, 60)}`);
  if (item.from) parts.push(`sent as ${item.from}`);
  if (item.domains?.length) parts.push(`with: ${item.domains.slice(0, 6).join(", ")}`);
  if (item.threadCount) parts.push(`${item.threadCount} messages${item.lastFrom ? `, last from ${item.lastFrom}` : ""}`);
  const detail = itemDetail(item);
  if (detail) parts.push(detail);
  return parts.join(" | ");
}

export type Prompt = {
  user: string;
  /** Prompt id ("m1") → item. */
  ids: Map<string, SignalItem>;
  omitted: number;
};

export function buildPrompt(items: SignalItem[], previous: PreviousProject[], now: Date, budget = PROMPT_CHARS): Prompt {
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
  const dates = datesLine(now);
  let used = SYSTEM.length + dates.length + prevBlock(() => []).length + previous.length * 40;
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
    dates,
    `Previous projects (key | name | company | state | status | next | evidence ids this run):\n${prevBlock((refs) =>
      refs.map((r) => idOf.get(r)).filter((x): x is string => !!x),
    )}`,
    "Evidence (id | date | … ). Dates are YYYY-MM-DD. Todos show the day they were written and whether they are OPEN or CLOSED.",
    section("Meetings", "meeting"),
    section("Sent email threads", "email"),
    section("Todos", "todo"),
    section("Notes", "note"),
  ].join("\n\n");
  return { user, ids, omitted };
}

// ---------------------------------------------------------------------------
// Validation

type RawStep = { text?: unknown; due?: unknown; who?: unknown; waiting?: unknown };

type RawProject = {
  key?: unknown;
  name?: unknown;
  company?: unknown;
  status?: unknown;
  problem?: unknown;
  steps?: unknown;
  evidence?: unknown;
  sensitive?: unknown;
};

const clip = (v: unknown, max: number): string => {
  if (typeof v !== "string") return "";
  const t = v.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** A real date, unless the step's text names a different weekday. */
function readDue(value: unknown, text: string): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const weekday = weekdayOf(value);
  if (!weekday) return null;
  const named = WEEKDAYS.find((d) => new RegExp(`\\b${d}\\b`, "i").test(text));
  return named && named !== weekday ? null : value;
}

const wordsOf = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9$ ]+/g, " ").split(/\s+/).filter((w) => w.length > 2));

function copiesClosedTodo(text: string, closedTitles: Set<string>[]): boolean {
  const words = [...wordsOf(text)];
  return !!words.length && closedTitles.some((t) => words.filter((w) => t.has(w)).length / words.length >= CLOSED_COPY);
}

/**
 * A flagged step goes on its own: the card's name and status decide whether the
 * card stays. An undated step that copies a closed todo goes too. A dated one
 * stays, since it can be a real event that outlived its todo.
 */
function readSteps(value: unknown, items: SignalItem[], isSensitive?: (text: string) => boolean): ProjectStep[] {
  const closedTitles = items.filter((i) => i.kind === "todo" && i.done).map((i) => wordsOf(i.title));
  if (!Array.isArray(value)) return [];
  const steps: ProjectStep[] = [];
  for (const entry of value) {
    if (steps.length === MAX_STEPS) break;
    if (!entry || typeof entry !== "object") continue;
    const r = entry as RawStep;
    const text = clip(r.text, STEP_CHARS);
    if (!text || isSensitive?.(text)) continue;
    const named = clip(r.who, WHO_CHARS);
    const who = named && !isSensitive?.(named) ? named : null;
    const due = readDue(r.due, text);
    if (!due && copiesClosedTodo(text, closedTitles)) continue;
    steps.push({ text, due, who, waiting: r.waiting === true && !!who && !OWNER.test(who) });
  }
  return steps;
}

export type ValidatedProjects = {
  projects: InferredProject[];
  /** Previous cards Claude or the gate flagged as private: the store removes them now. */
  rejectedKeys: string[];
};

export function validateProjects(
  raw: unknown,
  ctx: {
    ids: Map<string, SignalItem>;
    previous: PreviousProject[];
    now: Date;
    /** The privacy gate's text check, applied to names, status, problem and steps. */
    isSensitive?: (text: string) => boolean;
  },
): ValidatedProjects {
  const list = (raw as { projects?: unknown } | null)?.projects;
  if (!Array.isArray(list)) throw new ValidationError("no projects array");
  const prevByKey = new Map(ctx.previous.map((p) => [p.key, p]));
  const entries = list.filter((e): e is RawProject => !!e && typeof e === "object");
  const taken = new Set<string>();
  const out: (InferredProject & { state: Visibility })[] = [];
  const rejected = new Set<string>();

  // Keys Claude stated bind first, so a small card matched on shared evidence
  // below can't take the key, pin or history of the card that really owns it.
  const stated = new Map<RawProject, string>();
  for (const r of entries) {
    if (typeof r.key !== "string" || !prevByKey.has(r.key) || taken.has(r.key)) continue;
    stated.set(r, r.key);
    taken.add(r.key);
  }

  for (const r of entries) {
    const seen = new Set<string>();
    const items: SignalItem[] = [];
    for (const id of Array.isArray(r.evidence) ? r.evidence : []) {
      const item = typeof id === "string" ? ctx.ids.get(id.trim()) : undefined;
      if (item && !seen.has(item.ref)) {
        seen.add(item.ref);
        items.push(item);
      }
    }
    const reject = () => {
      const key = stated.get(r) ?? carryOver([...seen], ctx.previous, taken);
      if (key) rejected.add(key);
    };

    if (r.sensitive === true) {
      reject();
      continue;
    }
    const name = clip(r.name, NAME_CHARS);
    if (!name) continue;
    const status = clip(r.status, LINE_CHARS) || null;
    const problem = clip(r.problem, LINE_CHARS) || null;
    if ([name, status, problem].some((t) => t && ctx.isSensitive?.(t))) {
      reject();
      continue;
    }

    const free = (k: string) => prevByKey.has(k) && !taken.has(k);
    let key = stated.get(r) ?? carryOver([...seen], ctx.previous, taken);
    if (!key && free(slugify(name))) key = slugify(name);
    const existing = !!key;
    const longThread = items.some((i) => (i.threadCount ?? 0) >= LONG_THREAD);
    if (items.length < (existing ? 1 : 2) && !longThread) continue;
    // One recurring series alone (a weekly 1:1) is not a project.
    const series = new Set(items.map((i) => i.series ?? null));
    if (series.size === 1 && !series.has(null)) continue;
    if (!key) key = uniqueSlug(name, taken, prevByKey);
    if (!key) continue;
    taken.add(key);

    const finished = prevByKey.get(key)?.state === "finished";
    const steps = finished ? [] : readSteps(r.steps, items, ctx.isSensitive);
    const evidence = items
      .map(({ ref, kind, title, at, url }) => ({ ref, kind, title, at, url }))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const past = evidence.find((e) => Date.parse(e.at) <= ctx.now.getTime());
    out.push({
      key,
      name,
      company: isCompany(r.company) ? r.company : "Personal",
      status,
      problem,
      steps,
      next: steps[0]?.text ?? null,
      evidence,
      lastActivityAt: past?.at ?? null,
      state: prevByKey.get(key)?.state ?? "auto",
    });
  }

  // At most MAX_CARDS shown: pinned first, then the most recent. Hidden and finished ones don't count.
  const at = (p: InferredProject) => (p.lastActivityAt ? Date.parse(p.lastActivityAt) : 0);
  const shown = out
    .filter((p) => p.state !== "hidden" && p.state !== "finished")
    .sort((a, b) => Number(b.state === "pinned") - Number(a.state === "pinned") || at(b) - at(a))
    .slice(0, MAX_CARDS);
  const keep = new Set([...shown, ...out.filter((p) => p.state === "hidden" || p.state === "finished")]);
  const projects = out.filter((p) => keep.has(p)).map(({ state: _state, ...p }) => p);
  const returned = new Set(projects.map((p) => p.key));
  return { projects, rejectedKeys: [...rejected].filter((k) => !returned.has(k)) };
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
}): Promise<ValidatedProjects & { omitted: number }> {
  if (!input.items.length) return { projects: [], rejectedKeys: [], omitted: 0 };
  const prompt = buildPrompt(input.items, input.previous, input.now);
  const raw = await (input.claude ?? callClaudeJSON)<unknown>({
    system: SYSTEM,
    user: prompt.user,
    maxTokens: 16_000,
    timeoutMs: 150_000,
  });
  return {
    ...validateProjects(raw, { ids: prompt.ids, previous: input.previous, now: input.now, isSensitive: input.isSensitive }),
    omitted: prompt.omitted,
  };
}
