import { NextResponse } from "next/server";
import { GranolaError, granolaFromEnv } from "@/lib/granola";
import { prisma } from "@/lib/prisma";
import { granolaImportGate } from "./gate";

export const dynamic = "force-dynamic";

// Recent Granola meetings for the Home "Import Granola" picker.
// → { meetings: [{ id, title, createdAt, owner: { name, email }, imported }] }, newest first.
// `imported` is true once the note has been turned into todos (by the button
// or the GTM / C2 / Leads cron); the picker tags it but keeps it selectable.

const WINDOW_DAYS = 14;
const MAX_MEETINGS = 30;

export async function GET(request: Request) {
  const gate = await granolaImportGate(request);
  if ("response" in gate) return gate.response;
  const { userId } = gate;

  const client = granolaFromEnv({ signal: request.signal });
  if (!client) return NextResponse.json({ error: "GRANOLA_API_KEY not set" }, { status: 503 });

  try {
    const notes = await client.listNotes({
      createdAfter: new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000),
    });
    const recent = notes
      .slice()
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, MAX_MEETINGS);
    const done = await prisma.granolaImport.findMany({
      where: { userId, noteId: { in: recent.map((n) => n.id) } },
      select: { noteId: true },
    });
    const imported = new Set(done.map((d) => d.noteId));
    const meetings = recent.map((n) => ({
      id: n.id,
      title: n.title?.trim() || "Untitled meeting",
      createdAt: n.created_at,
      owner: { name: n.owner?.name ?? null, email: n.owner?.email ?? null },
      imported: imported.has(n.id),
    }));
    return NextResponse.json({ meetings });
  } catch (e) {
    if (e instanceof GranolaError) return NextResponse.json({ error: e.message }, { status: 502 });
    throw e;
  }
}
