import { NextResponse } from "next/server";
import { GranolaError, granolaFromEnv } from "@/lib/granola";
import { granolaImportGate } from "./gate";

export const dynamic = "force-dynamic";

// Recent Granola meetings for the Home "Import Granola" picker.
// → { meetings: [{ id, title, createdAt, owner: { name, email } }] }, newest first.

const WINDOW_DAYS = 14;
const MAX_MEETINGS = 30;

export async function GET(request: Request) {
  const gate = await granolaImportGate(request);
  if ("response" in gate) return gate.response;

  const client = granolaFromEnv({ signal: request.signal });
  if (!client) return NextResponse.json({ error: "GRANOLA_API_KEY not set" }, { status: 503 });

  try {
    const notes = await client.listNotes({
      createdAfter: new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000),
    });
    const meetings = notes
      .slice()
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, MAX_MEETINGS)
      .map((n) => ({
        id: n.id,
        title: n.title?.trim() || "Untitled meeting",
        createdAt: n.created_at,
        owner: { name: n.owner?.name ?? null, email: n.owner?.email ?? null },
      }));
    return NextResponse.json({ meetings });
  } catch (e) {
    if (e instanceof GranolaError) return NextResponse.json({ error: e.message }, { status: 502 });
    throw e;
  }
}
