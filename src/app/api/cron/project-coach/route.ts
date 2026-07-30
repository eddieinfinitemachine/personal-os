import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCron, getFounderUser } from "@/lib/cron";
import { buildProjectContext } from "@/lib/project-context";
import { callClaudeJSON } from "@/lib/claude";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Weekly AI coach: reads the full state of every active project and drops a
// handful of recommended todos into the three main lists. Complements
// renewal-autopilot, which handles the deterministic date/mileage triggers —
// this covers the judgement calls (seasonal prep, follow-ups implied by
// notes, neglected projects, health trends).

const MAIN_LISTS = ["To Do", "Monitor", "Later"] as const;
const MAX_PROJECTS = 20;
const MAX_TODOS_PER_RUN = 12;
// Suppress re-suggesting something completed or dismissed within this window.
const DEDUPE_WINDOW_DAYS = 45;

type CoachTodo = {
  projectId?: string;
  list?: string;
  title?: string;
  notes?: string;
  dueDate?: string | null;
};

const SYSTEM_PROMPT = `You are a proactive personal-operations coach. Below is the full state of every active project the owner tracks (pets, vehicles, health, trips, generic projects). Recommend the todos that most deserve a slot on their main lists in the next 1-2 weeks.

Routing:
- "To Do" — act this week. Time-sensitive or clearly overdue.
- "Monitor" — check on it; watch a trend or await an external event.
- "Later" — worth doing, not urgent.

Rules:
- 0-2 todos per project. Most projects deserve ZERO — only recommend what genuinely matters. 5-10 total across everything is ideal.
- Be specific to the project's actual state (reference its records, dates, trends). Generic advice is useless.
- NEVER duplicate or rephrase an open todo listed in a project's state, or anything in the "recently handled" list.
- Skip container/journal projects (captures, AI recaps) — they aren't real work.
- Title: imperative verb, under 12 words, prefixed naturally with what it's about. notes: 1-2 sentences on WHY, citing the state that triggered it.
- dueDate: ISO date only when a real deadline exists; otherwise null.

Output strict JSON, no prose, no markdown fences:
{ "todos": [ { "projectId": "...", "list": "To Do|Monitor|Later", "title": "...", "notes": "...", "dueDate": "YYYY-MM-DD or null" } ] }`;

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function coachKey(projectId: string, title: string): string {
  const slug = normalizeTitle(title).replace(/ /g, "-").slice(0, 60);
  return `coach:${projectId}:${slug}`;
}

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const founder = await getFounderUser();
  if (!founder) {
    return NextResponse.json({ error: "founder user missing" }, { status: 500 });
  }
  const userId = founder.id;

  const [projects, lists] = await Promise.all([
    prisma.project.findMany({
      where: { userId, archived: false },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      take: MAX_PROJECTS,
    }),
    prisma.list.findMany({ where: { userId, isDefault: true } }),
  ]);
  const listByName = new Map(lists.map((l) => [l.name, l.id]));
  if (!listByName.has("To Do")) {
    return NextResponse.json({ error: "default lists missing" }, { status: 500 });
  }

  // Dedupe set: open todo titles anywhere, plus every coach key minted in the
  // recent window (open or completed — a just-completed suggestion shouldn't
  // come right back).
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - DEDUPE_WINDOW_DAYS);
  const [openTodos, recentCoachTodos] = await Promise.all([
    prisma.todo.findMany({
      where: { userId, completedAt: null },
      select: { title: true, autopilotKey: true },
    }),
    prisma.todo.findMany({
      where: {
        userId,
        autopilotKey: { startsWith: "coach:" },
        createdAt: { gte: windowStart },
      },
      select: { autopilotKey: true },
    }),
  ]);
  const seenTitles = new Set(openTodos.map((t) => normalizeTitle(t.title)));
  const seenKeys = new Set<string>();
  for (const t of [...openTodos, ...recentCoachTodos]) {
    if (t.autopilotKey) seenKeys.add(t.autopilotKey);
  }

  // Chunked parallelism: each context builder runs several queries, so full
  // fan-out would exhaust the pooled connection limit, but sequential risks
  // the 60s budget. Four projects at a time is a safe middle.
  const sections: string[] = [];
  for (let i = 0; i < projects.length; i += 4) {
    const chunk = projects.slice(i, i + 4);
    const ctxs = await Promise.all(
      chunk.map((p) => buildProjectContext(p.id, userId))
    );
    chunk.forEach((p, j) => {
      sections.push(`=== PROJECT id=${p.id} ===\n${ctxs[j]}`);
    });
  }

  const parsed = await callClaudeJSON<{ todos?: CoachTodo[] }>({
    system: SYSTEM_PROMPT,
    user: sections.join("\n\n"),
    maxTokens: 3000,
  });

  const projectIds = new Set(projects.map((p) => p.id));
  const toCreate: {
    userId: string;
    title: string;
    notes: string;
    listId: string;
    projectId: string;
    dueDate: Date | null;
    autopilotKey: string;
  }[] = [];
  const skipped: string[] = [];

  for (const t of (parsed.todos ?? []).slice(0, MAX_TODOS_PER_RUN * 2)) {
    if (toCreate.length >= MAX_TODOS_PER_RUN) break;
    const title = typeof t.title === "string" ? t.title.trim().slice(0, 200) : "";
    if (!title || !t.projectId || !projectIds.has(t.projectId)) continue;
    const listName = MAIN_LISTS.includes(t.list as (typeof MAIN_LISTS)[number])
      ? (t.list as string)
      : "To Do";
    const listId = listByName.get(listName) ?? listByName.get("To Do")!;
    const key = coachKey(t.projectId, title);
    if (seenKeys.has(key) || seenTitles.has(normalizeTitle(title))) {
      skipped.push(title);
      continue;
    }
    const due = t.dueDate ? new Date(t.dueDate) : null;
    toCreate.push({
      userId,
      title,
      notes: typeof t.notes === "string" ? t.notes.trim().slice(0, 800) : "",
      listId,
      projectId: t.projectId,
      dueDate: due && !Number.isNaN(due.getTime()) ? due : null,
      autopilotKey: key,
    });
    seenKeys.add(key);
    seenTitles.add(normalizeTitle(title));
  }

  if (toCreate.length > 0) {
    await prisma.todo.createMany({ data: toCreate });
  }

  return NextResponse.json({
    ok: true,
    projectsScanned: projects.length,
    createdTodos: toCreate.length,
    titles: toCreate.map((t) => t.title),
    skippedAsDuplicates: skipped,
  });
}
