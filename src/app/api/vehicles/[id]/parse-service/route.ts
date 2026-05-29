import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { callClaudeJSON } from "@/lib/claude";

type Parsed = {
  performedAt?: string;
  mileage?: number | null;
  shop?: string | null;
  workSummary?: string;
  costUsd?: number | null;
  serviceItemIds?: string[];
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = (await request.json()) as { text?: string };
  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not set" },
      { status: 500 }
    );
  }

  const vehicle = await prisma.vehicle.findUnique({ where: { id } });
  if (!vehicle || vehicle.userId !== userId) {
    return NextResponse.json({ error: "vehicle not found" }, { status: 404 });
  }

  const items = await prisma.serviceItem.findMany({
    where: { vehicleId: id, userId },
    select: { id: true, name: true, intervalMonths: true, intervalMileage: true },
    orderBy: { position: "asc" },
  });

  const today = new Date().toISOString().slice(0, 10);
  const itemsForPrompt = items
    .map(
      (i) =>
        `- ${i.id}: ${i.name}${
          i.intervalMonths
            ? ` (every ${i.intervalMonths}mo)`
            : ""
        }${i.intervalMileage ? ` (every ${i.intervalMileage.toLocaleString()})` : ""}`
    )
    .join("\n");

  const systemPrompt = `You convert free-form service-log text into structured JSON for a vehicle maintenance app.

Today's date is ${today}.

Available maintenance items for this vehicle (use the exact id when picking matches):
${itemsForPrompt}

Output ONLY a single JSON object on a single line, no prose. Schema:
{
  "performedAt": "YYYY-MM-DD",          // required; if user says "today" use today's date; resolve "yesterday" / "last week" relative to today
  "mileage": number | null,              // odometer reading when service happened, integer; null if not stated
  "shop": string | null,                 // shop name if mentioned, else null
  "workSummary": string,                 // a clean 1-2 sentence summary of what was done
  "costUsd": number | null,              // total in USD, null if not stated
  "serviceItemIds": string[]             // ids from the list above whose maintenance the work satisfies; [] if none clearly match
}

Rules:
- If the user gives a partial date like "April 2023" pick the 1st of that month.
- Prefer being permissive on serviceItemIds: if work was "oil change" mark "Engine oil & filter".
- A "major service" likely also covers Engine oil, Coolant, Spark plugs etc IF the user mentioned those individually.
- Never hallucinate ids. Only include ids from the list above.
- If the user provided shop nicknames, expand to the full name when obvious from context (e.g. "Scuderia" → "J. Scuderia Automotive").`;

  let parsed: Parsed;
  try {
    parsed = await callClaudeJSON<Parsed>({
      system: systemPrompt,
      user: text,
      maxTokens: 600,
    });
  } catch {
    return NextResponse.json(
      { error: "could not parse model output" },
      { status: 502 }
    );
  }

  // Defensive filter: keep only valid service item IDs.
  const validIds = new Set(items.map((i) => i.id));
  if (Array.isArray(parsed.serviceItemIds)) {
    parsed.serviceItemIds = parsed.serviceItemIds.filter((id) => validIds.has(id));
  } else {
    parsed.serviceItemIds = [];
  }

  return NextResponse.json({ parsed });
}
