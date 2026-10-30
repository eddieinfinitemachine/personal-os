import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { isFounderUser } from "@/lib/cron";
import { AGENT_JOB_SELECT, parseAgentRepos, toAgentJobView } from "@/lib/agent/job";

export const dynamic = "force-dynamic";

/** The agent's decision and result for one todo (null when it was never triaged). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId(_request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const job = await prisma.agentJob.findFirst({ where: { todoId: id, userId }, select: AGENT_JOB_SELECT });
  return NextResponse.json({ job: job ? toAgentJobView(job) : null });
}

/**
 * Queue (or re-queue) a code job for a todo by hand, skipping triage:
 * `{ "repo": "owner/name" }`. Founder-only, because the worker runs Claude
 * Code with every permission; the repo must be in AGENT_REPOS.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isFounderUser(userId))) {
    return NextResponse.json({ error: "The todo agent isn't enabled for this account." }, { status: 403 });
  }
  const { id } = await params;
  const todo = await prisma.todo.findFirst({ where: { id, userId }, select: { id: true } });
  if (!todo) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const repo = body && typeof body === "object" ? (body as Record<string, unknown>).repo : undefined;
  const allowed = parseAgentRepos(process.env.AGENT_REPOS).map((r) => r.name);
  if (typeof repo !== "string" || !allowed.includes(repo)) {
    return NextResponse.json({ error: `repo must be one of: ${allowed.join(", ") || "(none configured)"}` }, { status: 400 });
  }

  const existing = await prisma.agentJob.findUnique({ where: { todoId: id }, select: { status: true } });
  if (existing && (existing.status === "queued" || existing.status === "running")) {
    return NextResponse.json({ error: "A job for this todo is already queued or running." }, { status: 409 });
  }
  const data = {
    kind: "code",
    status: "queued",
    repo,
    plan: "Queued by hand.",
    confidence: null,
    branch: null,
    resultUrl: null,
    summary: null,
    resultJson: undefined,
    error: null,
    costUsd: null,
    startedAt: null,
    completedAt: null,
  };
  const job = await prisma.agentJob.upsert({
    where: { todoId: id },
    create: { userId, todoId: id, ...data },
    update: data,
    select: AGENT_JOB_SELECT,
  });
  return NextResponse.json({ job: toAgentJobView(job) });
}
