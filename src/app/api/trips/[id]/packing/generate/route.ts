import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { callClaudeJSON } from "@/lib/claude";
import { tripWeatherSummary } from "@/lib/trip-weather";
import { buildTripPackingContext, CATEGORIES } from "@/lib/packing-edit";

export const dynamic = "force-dynamic";
// Claude call + weather fetch can exceed the default function window.
export const maxDuration = 60;

const MAX_ITEMS = 80;

type GeneratedItem = {
  title: string;
  category: string;
  quantity: number;
  reason: string | null;
};

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

  const body = (await request.json().catch(() => ({}))) as {
    context?: string;
  };
  const context =
    typeof body.context === "string" ? body.context.trim().slice(0, 4000) : "";
  if (context && context !== trip.packingContext) {
    await prisma.trip.update({
      where: { id },
      data: { packingContext: context },
    });
  }
  const packingContext = context || trip.packingContext;

  const weather = await tripWeatherSummary(
    trip.destination,
    trip.startDate,
    trip.endDate
  );

  const existing = await prisma.packingItem.findMany({ where: { tripId: id } });
  const tripState = buildTripPackingContext({
    trip,
    itinerary: trip.items,
    weather,
    packingContext,
  });

  const system = `You build packing lists for trips. Given the trip state below, produce a practical, complete packing checklist tailored to the destination, dates, weather, and what the traveler says they're doing.

Respond with ONLY a JSON object, no other text:
{"items": [{"title": "<short item name>", "category": "<one of: ${CATEGORIES}>", "quantity": <number>, "reason": <string|null>}]}

Rules:
- Quantities scale with trip length (e.g. one pair of socks per day, capped sensibly by laundry access).
- Set "reason" ONLY when an item is there for a non-obvious reason (weather, a specific activity) — one short phrase. Obvious items get null.
- Cover the specific activities mentioned; skip gear for activities that aren't happening.
- Weather-appropriate: rain gear when rain is likely, layers for cold mornings, etc.
- Include travel documents/chargers/meds staples, but keep the list realistic — no kitchen-sink padding.${
    existing.length > 0
      ? `\n- The list already contains some items (below). Only propose items that are missing — never repeat an existing item.\n\nExisting items: ${existing.map((e) => e.title).join("; ")}`
      : ""
  }

=== TRIP STATE ===
${tripState}`;

  let parsed: { items?: unknown };
  try {
    parsed = await callClaudeJSON<{ items?: unknown }>({
      system,
      user: "Generate the packing list.",
      maxTokens: 4000,
    });
  } catch (e) {
    console.error("packing generate failed", e);
    return NextResponse.json({ error: "generation failed" }, { status: 502 });
  }

  const raw = Array.isArray(parsed.items) ? parsed.items : [];
  const seen = new Set(existing.map((e) => e.title.trim().toLowerCase()));
  const items: GeneratedItem[] = [];
  for (const entry of raw.slice(0, MAX_ITEMS)) {
    if (!entry || typeof entry !== "object") continue;
    const a = entry as Record<string, unknown>;
    const title = typeof a.title === "string" ? a.title.trim() : "";
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      title,
      category:
        typeof a.category === "string" && a.category.trim()
          ? a.category.trim()
          : "Other",
      quantity:
        typeof a.quantity === "number" && a.quantity >= 1
          ? Math.min(Math.round(a.quantity), 99)
          : 1,
      reason:
        typeof a.reason === "string" && a.reason.trim() ? a.reason.trim() : null,
    });
  }
  if (items.length === 0) {
    return NextResponse.json({ error: "no items generated" }, { status: 502 });
  }

  const max = await prisma.packingItem.aggregate({
    where: { tripId: id },
    _max: { position: true },
  });
  let position = (max._max.position ?? -1) + 1;
  await prisma.packingItem.createMany({
    data: items.map((it) => ({
      userId,
      tripId: id,
      title: it.title,
      category: it.category,
      quantity: it.quantity,
      notes: it.reason,
      position: position++,
    })),
  });

  const all = await prisma.packingItem.findMany({
    where: { tripId: id },
    orderBy: [{ category: "asc" }, { position: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({
    items: all,
    added: items.length,
    hadWeather: weather != null,
  });
}
