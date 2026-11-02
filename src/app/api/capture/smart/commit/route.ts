import { NextResponse, after } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { syncRecentTodos } from "@/lib/gcal";
import type { CaptureProposal } from "@/lib/smart-capture";
import { commitCore, validateCoreProposal } from "@/lib/capture-review/commit";
import { withCaptureReview } from "@/lib/capture-review/record";
import { callSheetResponse, captureResponse, commitCallSheetCapture, intakeMeta, normalizeCaptureInput, CallSheetIntakeError } from "@/lib/capture-review/intake";
import { CaptureReviewError } from "@/lib/capture-review/types";
import { reviewJson } from "@/lib/capture-review/http";

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = await reviewJson(request) as { proposal?: CaptureProposal; text?: string; url?: string | null; input?: unknown; requestId?: unknown };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new CaptureReviewError(400, "proposal required");
    const proposal = body.proposal;
    if (!proposal) throw new CaptureReviewError(400, "proposal required");
    if (proposal.type !== "call_sheet") validateCoreProposal(proposal);
    const input = normalizeCaptureInput(body.input ?? { text: body.text, url: body.url, files: [] });
    if ("photoUrl" in proposal && typeof proposal.photoUrl === "string" && !input.files.some(file => file.url === proposal.photoUrl)) input.files.push({ name: "Shared image", mimeType: "image/jpeg", size: null, url: proposal.photoUrl });
    const outcome = await withCaptureReview({ ...intakeMeta(request, userId, "web", input, "web", body.requestId, { input, proposal }), proposal }, {
      commit: async tx => {
        if (proposal.type === "call_sheet") {
          const { result, placement } = await commitCallSheetCapture(tx, userId, proposal);
          const { message, ...callSheet } = result;
          return { value: { callSheet, message } as Record<string, unknown>, placement };
        }
        const existing = proposal.type === "person" ? await tx.person.findFirst({ where: { userId, firstName: { equals: proposal.firstName.trim(), mode: "insensitive" }, lastName: proposal.lastName?.trim() ? { equals: proposal.lastName.trim(), mode: "insensitive" } : null } }) : null;
        const beforePeople = proposal.type === "interaction" ? await tx.person.findMany({ where: { userId, OR: proposal.personHints.map(hint => ({ firstName: { equals: hint.firstName.trim(), mode: "insensitive" as const }, lastName: hint.lastName?.trim() ? { equals: hint.lastName.trim(), mode: "insensitive" as const } : null })) }, select: { id: true } }) : [];
        const placement = await commitCore(tx, userId, input, proposal, [], { mode: "web" });
        const interaction = proposal.type === "interaction" ? await tx.interaction.findFirst({ where: { id: placement.id, userId }, select: { personIds: true } }) : null;
        const createdPersons = interaction ? await tx.person.findMany({ where: { userId, id: { in: interaction.personIds.filter(id => !beforePeople.some(item => item.id === id)) } }, select: { id: true, firstName: true, lastName: true } }) : [];
        return { value: await captureResponse(tx, userId, placement, "web", { created: !existing, createdPersons }), placement };
      },
      replay: (tx, placement) => callSheetResponse(tx, userId, placement, "web"),
    });
    if (outcome.created && (outcome.value.todo || outcome.value.followupTodo)) after(() => syncRecentTodos());
    return NextResponse.json({ ...outcome.value, reviewId: outcome.reviewId });
  } catch (error) {
    if (error instanceof CaptureReviewError) return NextResponse.json({ error: error.message, ...(error instanceof CallSheetIntakeError ? { candidates: error.candidates } : {}) }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "bad json" }, { status: 400 });
    console.error("web capture save failed", error);
    return NextResponse.json({ error: "Couldn't save this capture. Please try again." }, { status: 500 });
  }
}
