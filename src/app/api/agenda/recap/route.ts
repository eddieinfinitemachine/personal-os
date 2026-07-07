import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

// Persist a 1:1 session as a Note under the "1:1s" project (created lazily).
// The note is the durable session log: recap text plus the meeting-notes
// link (Granola or anything else) when one was attached.
export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    listName?: string;
    recap?: string;
    notesUrl?: string | null;
  };
  if (!body.listName || !body.recap) {
    return NextResponse.json({ error: "listName and recap required" }, { status: 400 });
  }

  let project = await prisma.project.findFirst({
    where: { userId, name: "1:1s", archived: false },
  });
  if (!project) {
    project = await prisma.project.create({
      data: { userId, name: "1:1s" },
    });
  }

  const person = body.listName.replace(/^EC\//i, "");
  const date = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const note = await prisma.note.create({
    data: {
      userId,
      projectId: project.id,
      title: `${person} · ${date}`,
      body: [body.notesUrl ? `Notes: ${body.notesUrl}` : null, body.recap]
        .filter(Boolean)
        .join("\n\n"),
    },
  });
  return NextResponse.json({ note });
}
