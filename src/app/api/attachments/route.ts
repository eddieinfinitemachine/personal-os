import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDropboxFolderUrl } from "@/lib/dropbox";
import { getCurrentUserId } from "@/lib/auth";
import { listAccessWhere } from "@/lib/list-access";

const VALID_KINDS = new Set(["file", "link", "dropbox"]);

// Resolve + authorize the attachment owner (a project or a todo) from a
// projectId/todoId pair. Returns the Prisma `where` to scope a listing and the
// `data` fields to stamp on a create, or a NextResponse error to short-circuit.
async function resolveOwner(
  userId: string,
  projectId: string | null | undefined,
  todoId: string | null | undefined,
): Promise<
  | { error: NextResponse }
  | { listWhere: { projectId: string; userId: string } | { todoId: string }; ownerData: { projectId?: string; todoId?: string } }
> {
  const hasProject = typeof projectId === "string" && projectId.length > 0;
  const hasTodo = typeof todoId === "string" && todoId.length > 0;
  if (hasProject === hasTodo) {
    return {
      error: NextResponse.json(
        { error: "exactly one of projectId or todoId required" },
        { status: 400 },
      ),
    };
  }
  if (hasProject) {
    const project = await prisma.project.findUnique({ where: { id: projectId as string } });
    if (!project || project.userId !== userId) {
      return { error: NextResponse.json({ error: "project not found" }, { status: 404 }) };
    }
    // Projects aren't shared — scope the listing to the owner.
    return {
      listWhere: { projectId: projectId as string, userId },
      ownerData: { projectId: projectId as string },
    };
  }
  // Authorize via parent list membership so shared-list collaborators can see
  // and add a todo's files.
  const todo = await prisma.todo.findFirst({
    where: { id: todoId as string, list: listAccessWhere(userId) },
  });
  if (!todo) {
    return { error: NextResponse.json({ error: "todo not found" }, { status: 404 }) };
  }
  // Shared todos: every collaborator sees all files, regardless of uploader.
  return { listWhere: { todoId: todoId as string }, ownerData: { todoId: todoId as string } };
}

export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const owner = await resolveOwner(
    userId,
    url.searchParams.get("projectId"),
    url.searchParams.get("todoId"),
  );
  if ("error" in owner) return owner.error;

  const attachments = await prisma.attachment.findMany({
    where: owner.listWhere,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ attachments });
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    projectId?: string;
    todoId?: string;
    kind?: string;
    title?: string;
    url?: string;
    mimeType?: string;
    size?: number;
  };

  const owner = await resolveOwner(userId, body.projectId, body.todoId);
  if ("error" in owner) return owner.error;

  const url = body.url?.trim();
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });
  // Auto-detect Dropbox folder URLs so they render as expandable folders.
  let kind = body.kind && VALID_KINDS.has(body.kind) ? body.kind : "link";
  if (kind === "link" && isDropboxFolderUrl(url)) kind = "dropbox";
  const title = body.title?.trim() || url;

  const attachment = await prisma.attachment.create({
    data: {
      userId,
      ...owner.ownerData,
      kind,
      title,
      url,
      mimeType: body.mimeType ?? null,
      size: body.size ?? null,
    },
  });
  return NextResponse.json({ attachment });
}
