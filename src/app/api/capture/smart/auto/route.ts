import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseCapture, type CaptureProposal } from "@/lib/smart-capture";
import { parseAliasToken } from "@/lib/alias";
import { captureListNames } from "@/lib/lists";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { syncRecentTodos } from "@/lib/gcal";
import { userLocalToday } from "@/lib/call-sheet/reminder-capture";
import { commitCore, validateCoreProposal } from "@/lib/capture-review/commit";
import { findCaptureReplay, quickSource, withCaptureReview } from "@/lib/capture-review/record";
import { callSheetResponse, captureResponse, commitCallSheetCapture, intakeMeta, CallSheetIntakeError } from "@/lib/capture-review/intake";
import { CaptureReviewError } from "@/lib/capture-review/types";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  const userId = await resolveCaptureUser(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return handle(request, userId, await request.json().catch(() => ({})));
}
export async function GET(request: Request) {
  const userId = await resolveCaptureUser(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return handle(request, userId, Object.fromEntries(new URL(request.url).searchParams));
}
async function handle(request: Request, userId: string, body: Record<string, unknown>) {
  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new CaptureReviewError(400, "text required");
    if (typeof body.text !== "string" || !body.text.trim()) throw new CaptureReviewError(400, "text required");
    const input = { text: body.text.trim(), url: typeof body.url === "string" ? body.url : null, files: [] };
    const meta = intakeMeta(request, userId, "auto", input, quickSource(request.headers.get("X-Capture-Source") ?? body.source), body.requestId);
    const previous = await findCaptureReplay(userId, meta.id, meta.requestHash!);
    if (previous) return NextResponse.json({ ...await callSheetResponse(prisma, userId, previous.placement, "auto"), reviewId: meta.id });
    const alias = parseAliasToken(input.text);
    const aliasList = alias ? await prisma.list.findFirst({ where: { userId, OR: [{ name: { equals: `EC/${alias.token}`, mode: "insensitive" } }, { name: { equals: alias.token, mode: "insensitive" } }] } }) : null;
    let proposal: CaptureProposal;
    if (alias && aliasList) proposal = { type: "todo", title: alias.rest, listName: aliasList.name, routedByAlias: true };
    else {
      const projects = await prisma.project.findMany({ where: { userId, archived: false }, select: { id: true, name: true, kind: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
      try { proposal = await parseCapture({ text: [input.text, input.url].filter(Boolean).join("\n\n"), today: await userLocalToday(userId), activeProjects: projects, listNames: await captureListNames(userId) }); }
      catch (error) { console.error("smart auto parse failed", error); return NextResponse.json({ error: error instanceof Error ? error.message : "parse failed" }, { status: 502 }); }
      if (proposal.type === "todo") proposal = { ...proposal, routedByAlias: false };
    }
    if (proposal.type !== "call_sheet") validateCoreProposal(proposal);
    const outcome = await withCaptureReview({ ...meta, proposal }, {
      commit: async tx => {
        if (proposal.type === "call_sheet") {
          const { result, placement } = await commitCallSheetCapture(tx, userId, proposal);
          return { value: { ok: true, type: "call_sheet", id: result.personId, dueOn: result.dueOn, created: result.created, message: result.message } as Record<string, unknown>, placement };
        }
        const placement = await commitCore(tx, userId, input, proposal, [], { mode: "auto" });
        return { value: await captureResponse(tx, userId, placement, "auto", { routedByAlias: proposal.type === "todo" && proposal.routedByAlias }), placement };
      },
      replay: (tx, placement) => callSheetResponse(tx, userId, placement, "auto"),
    });
    if (outcome.created && (outcome.value.type === "todo" || outcome.value.companionTodoId)) after(() => syncRecentTodos());
    return NextResponse.json({ ...outcome.value, reviewId: outcome.reviewId });
  } catch (error) {
    if (error instanceof CaptureReviewError) return NextResponse.json({ error: error.message, ...(error instanceof CallSheetIntakeError ? { candidates: error.candidates } : {}) }, { status: error.status });
    console.error("smart auto save failed", error);
    return NextResponse.json({ error: "Couldn't save this capture. Please try again." }, { status: 500 });
  }
}
