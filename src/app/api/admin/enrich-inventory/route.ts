import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

type Enriched = {
  id: string;
  category?: string | null;
  subtitle?: string | null;
  currentValue?: number | null;
  costBasis?: number | null;
  notes?: string | null;
};

// Asks Claude to estimate fair market resale value (USD) for each inventory
// item plus fill in any missing brand/model/category/notes. Today's date is
// passed in so estimates reflect current resale conditions.
export async function POST() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not set" },
      { status: 500 }
    );
  }

  const FOUNDER_EMAIL = process.env.FOUNDER_EMAIL ?? "emcohen@me.com";
  const founder = await prisma.user.findUnique({ where: { email: FOUNDER_EMAIL } });
  if (!founder) return NextResponse.json({ error: "founder user missing" }, { status: 500 });
  const userId = founder.id;

  const items = await prisma.asset.findMany({
    where: { userId, kind: "inventory", archived: false },
    orderBy: { createdAt: "asc" },
  });

  if (items.length === 0) {
    return NextResponse.json({ ok: true, updated: 0 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const list = items
    .map((a) => {
      const lines = [
        `id: ${a.id}`,
        `title: ${a.title}`,
        a.subtitle ? `brand_model: ${a.subtitle}` : null,
        a.category ? `category: ${a.category}` : null,
        a.location ? `location: ${a.location}` : null,
        a.costBasis != null ? `purchase_price_usd: ${a.costBasis}` : null,
        a.currentValue != null ? `current_value_usd: ${a.currentValue}` : null,
        a.notes ? `notes: ${a.notes.slice(0, 200)}` : null,
      ].filter(Boolean);
      return lines.join("\n");
    })
    .join("\n---\n");

  const prompt = `Today is ${today}. Below is an inventory list. For each item, return a JSON object with the item's id and best estimates for any MISSING fields. If a field is already populated and reasonable, keep it (return the original value or omit).

Fields you should fill:
- "currentValue": fair market resale value in USD as of ${today}, integer. For watches, cameras, audio, instruments, electronics, kitchen gear, art, and collectibles use realistic secondary-market pricing (eBay sold listings, Chrono24, Reverb, etc.) — not retail. If something is consumable or has near-zero resale, use 0.
- "costBasis": realistic original purchase price in USD if not given (best guess), integer.
- "category": short bucket like "watch", "camera", "audio", "kitchen", "tools", "instrument", "electronics", "art", "furniture", "clothing", "outdoor", "collectible".
- "subtitle": "Brand · Model" if you can identify them from the title (or keep existing).
- "notes": 1-2 short sentences with anything notable about value, depreciation trend, or how to verify (skip if existing notes are good).

Return ONLY a JSON array. No prose, no markdown, no code fences. Each element: { "id": string, ...filled fields }. Items you have no useful info on can be returned with just { "id": "..." }.

INVENTORY:
${list}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json(
      { error: `Claude error (${res.status}): ${err}` },
      { status: 502 }
    );
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = data.content?.find((c) => c.type === "text")?.text?.trim() ?? "";

  // Pull out the JSON array from the response (Claude is generally well-behaved
  // here, but strip code fences just in case).
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  let parsed: Enriched[];
  try {
    parsed = JSON.parse(cleaned) as Enriched[];
  } catch (e) {
    return NextResponse.json(
      {
        error: "could not parse Claude JSON",
        sample: cleaned.slice(0, 500),
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }
  if (!Array.isArray(parsed)) {
    return NextResponse.json(
      { error: "expected array", sample: cleaned.slice(0, 500) },
      { status: 502 }
    );
  }

  let updated = 0;
  for (const e of parsed) {
    if (!e.id) continue;
    const item = items.find((i) => i.id === e.id);
    if (!item) continue;
    const data: Record<string, unknown> = {};
    if (e.currentValue != null && item.currentValue == null)
      data.currentValue = e.currentValue;
    if (e.costBasis != null && item.costBasis == null)
      data.costBasis = e.costBasis;
    if (e.category && !item.category) data.category = e.category;
    if (e.subtitle && !item.subtitle) data.subtitle = e.subtitle;
    if (e.notes && !item.notes) data.notes = e.notes;
    if (Object.keys(data).length === 0) continue;
    await prisma.asset.update({ where: { id: item.id }, data });
    updated++;
  }

  return NextResponse.json({
    ok: true,
    items: items.length,
    enriched: parsed.length,
    updated,
  });
}
