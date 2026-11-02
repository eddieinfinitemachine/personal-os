import { NextResponse, after } from "next/server";
import { DEFAULT_LISTS, CAPTURE_LIST_NAME } from "@/lib/lists";
import { parseAliasToken } from "@/lib/alias";
import { resolveCaptureUser } from "@/lib/capture-auth";
import { syncRecentTodos } from "@/lib/gcal";
import { commitCore, validateCoreProposal } from "@/lib/capture-review/commit";
import { quickSource, withCaptureReview } from "@/lib/capture-review/record";
import { captureResponse, intakeMeta } from "@/lib/capture-review/intake";
import { CaptureReviewError } from "@/lib/capture-review/types";
export const dynamic = "force-dynamic";
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
const str = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
async function handle(request: Request, userId: string, body: Record<string, unknown>) {
  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new CaptureReviewError(400, "title required");
    const title = str(body.title) ?? str(body.text);
    if (!title) throw new CaptureReviewError(400, "title required");
    const input = { text: title, url: str(body.url), files: [] };
    const proposal = { type: "todo" as const, title, notes: str(body.notes), dueDate: str(body.dueDate) };
    validateCoreProposal(proposal);
    const meta = intakeMeta(request, userId, "todo", input, quickSource(request.headers.get("X-Capture-Source") ?? body.source), body.requestId, { input, proposal, list: str(body.list), project: str(body.project) });
    const outcome = await withCaptureReview({ ...meta, proposal }, {
      commit: async tx => {
        let aliasList = null;
        let actualTitle = title;
        if (!str(body.list)) {
          const alias = parseAliasToken(title);
          if (alias) {
            aliasList = await tx.list.findFirst({ where: { userId, OR: [{ name: { equals: `EC/${alias.token}`, mode: "insensitive" } }, { name: { equals: alias.token, mode: "insensitive" } }] } });
            if (aliasList) actualTitle = alias.rest;
          }
        }
        let projectId: string | null | undefined = aliasList ? null : undefined;
        const projectName = str(body.project);
        if (projectName) {
          const project = await tx.project.findFirst({ where: { userId, archived: false, name: { equals: projectName, mode: "insensitive" } } });
          if (!project) throw new CaptureReviewError(404, `project "${projectName}" not found`);
          projectId = project.id;
        }
        const listName = str(body.list) ?? aliasList?.name ?? CAPTURE_LIST_NAME;
        let list = aliasList ?? await tx.list.findFirst({ where: { userId, name: { equals: listName, mode: "insensitive" } } });
        if (!list) {
          const defaults = DEFAULT_LISTS.find(item => item.name === listName);
          if (!defaults) throw new CaptureReviewError(404, `list "${listName}" not found`);
          list = await tx.list.create({ data: { ...defaults, userId, isDefault: true } });
        }
        const finalProposal = { ...proposal, title: actualTitle };
        const placement = await commitCore(tx, userId, input, finalProposal, [], { mode: "web", listId: list.id, ...(projectId !== undefined ? { projectId } : {}) });
        // Explicit legacy lists still inherit the Inbox project unless an alias routes them.
        if (projectId === undefined) {
          const inbox = await tx.project.findFirst({ where: { userId, name: { equals: "Inbox", mode: "insensitive" } } }) ?? await tx.project.create({ data: { userId, name: "Inbox", icon: "Inbox", color: "neutral", position: 0 } });
          await tx.todo.update({ where: { id: placement.id }, data: { projectId: inbox.id } });
        }
        return { value: await captureResponse(tx, userId, placement, "legacy"), placement, proposal: finalProposal };
      },
      replay: (tx, placement) => captureResponse(tx, userId, placement, "legacy"),
    });
    if (outcome.created) after(() => syncRecentTodos());
    return NextResponse.json({ ...outcome.value, reviewId: outcome.reviewId });
  } catch (error) {
    if (error instanceof CaptureReviewError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("legacy capture failed", error);
    return NextResponse.json({ error: "Couldn't save this capture. Please try again." }, { status: 500 });
  }
}
