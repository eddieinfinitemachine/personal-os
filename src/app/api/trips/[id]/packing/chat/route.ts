import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { callClaudeText } from "@/lib/claude";
import { tripWeatherSummary } from "@/lib/trip-weather";
import {
  applyPackingActions,
  buildTripPackingContext,
  CATEGORIES,
  validatePackingActions,
} from "@/lib/packing-edit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ChatTurn = { role: "user" | "assistant"; content: string };

// Mirrors the pet chat in /api/projects/[id]/ask: Claude replies with a JSON
// object carrying the answer plus zero or more structured edit actions, which
// are validated and applied server-side.
const EDIT_INSTRUCTIONS = `
You tune this trip's packing list through conversation. When the traveler asks
for changes — add gear, trim for carry-on, adjust quantities, swap items —
include actions. Item ids come from the current list below.

Respond with ONLY a JSON object, no other text:
{"answer": "<markdown reply confirming changes and/or answering the question>", "actions": [ ... ]}

Available actions (omit "actions" or use [] when nothing should change):
- {"type": "add_item", "title": "<item>", "category": "<one of: ${CATEGORIES}>", "quantity": <number>, "notes": <string|null>}
- {"type": "update_item", "id": "<item id>", "fields": {<subset of: title, category, quantity, notes>}}
- {"type": "remove_item", "id": "<item id>"}
- {"type": "set_packed", "id": "<item id>", "packed": <boolean>}

Rules:
- Only change what the traveler asked for; questions and musings get an answer
  with no actions.
- When trimming ("carry-on only", "make it lighter"), remove or reduce the
  least essential items and say what went and why.
- Never remove an item marked PACKED unless explicitly asked.
- Keep the answer short — a sentence or two plus the changes.`;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const trip = await prisma.trip.findUnique({
    where: { id },
    include: { items: { orderBy: { startAt: "asc" } } },
  });
  if (!trip || trip.userId !== userId) {
    return NextResponse.json({ error: "trip not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    question?: string;
    history?: ChatTurn[];
  };
  const question = body.question?.trim();
  if (!question) {
    return NextResponse.json({ error: "question required" }, { status: 400 });
  }

  const [weather, packingItems] = await Promise.all([
    tripWeatherSummary(trip.destination, trip.startDate, trip.endDate),
    prisma.packingItem.findMany({
      where: { tripId: id },
      orderBy: [{ category: "asc" }, { position: "asc" }],
    }),
  ]);

  const tripState = buildTripPackingContext({
    trip,
    itinerary: trip.items,
    packingItems,
    weather,
    packingContext: trip.packingContext,
  });

  const system = `You are the packing assistant for this trip. You have the full trip state and current packing list below. Answer directly using this data.
${EDIT_INSTRUCTIONS}
=== TRIP STATE ===
${tripState}`;

  const history = Array.isArray(body.history) ? body.history.slice(-20) : [];
  let raw: string;
  try {
    raw = await callClaudeText({
      system,
      messages: [...history, { role: "user", content: question }],
      maxTokens: 2000,
    });
  } catch (e) {
    console.error("packing chat failed", e);
    return NextResponse.json({ error: "chat failed" }, { status: 502 });
  }
  if (!raw) {
    return NextResponse.json({ error: "empty response" }, { status: 502 });
  }

  // Lenient parse: pull the JSON object out of the reply; if the model spoke
  // plain text anyway, treat the whole reply as the answer with no actions.
  let answer = raw;
  let applied: string[] = [];
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as {
        answer?: string;
        actions?: unknown;
      };
      if (typeof parsed.answer === "string" && parsed.answer.trim()) {
        answer = parsed.answer.trim();
      }
      const actions = validatePackingActions(parsed.actions);
      if (actions.length > 0) {
        applied = await applyPackingActions(userId, id, actions);
      }
    } catch {
      // Not valid JSON — keep the raw reply as the answer.
    }
  }

  const items = await prisma.packingItem.findMany({
    where: { tripId: id },
    orderBy: [{ category: "asc" }, { position: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ answer, applied, items });
}
