// Local enrichment of the Inventory page with REAL online data.
// Uses Claude with the web_search server tool to look up current resale
// prices, reference URLs, and (when available) an image URL per item.
// Run with: ANTHROPIC_API_KEY=... pnpm dlx tsx scripts/enrich-inventory-web.ts

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

try {
  const env = readFileSync(".env", "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([\w]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const prisma = new PrismaClient();
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY missing");
  process.exit(1);
}

type Enriched = {
  id: string;
  currentValue?: number | null;
  url?: string | null;
  imageUrl?: string | null;
  notes?: string | null;
};

const CHUNK_SIZE = 4; // items per Claude call
const MAX_SEARCHES = 20; // web searches Claude is allowed per call

async function enrichChunk(items: { id: string; description: string }[]): Promise<Enriched[]> {
  const today = new Date().toISOString().slice(0, 10);
  const list = items
    .map((i) => `id: ${i.id}\n${i.description}`)
    .join("\n---\n");

  const systemPrompt = `You are a market-pricing research assistant. For each item, use the web_search tool to find:
1. A realistic current secondary-market resale price in USD (eBay sold listings, Chrono24, Reverb, Grailed, StockX, AbeBooks, etc. — not retail).
2. A canonical reference URL: the brand's product page, a high-quality marketplace listing, a Wikipedia entry, or a manufacturer page.
3. An image URL: a clean product image from the brand site, Wikipedia, or a marketplace.

Return ONLY a JSON array. No prose, no markdown, no code fences. Each element: { "id": string, "currentValue": integer USD, "url": "https://...", "imageUrl": "https://...", "notes": "one-sentence pricing context with the source you used" }

If a field is genuinely unknowable, return null for that field. If an item is consumable / no resale value, set currentValue to 0.
Today's date is ${today}.`;

  const userPrompt = `INVENTORY:\n${list}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      system: systemPrompt,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: MAX_SEARCHES,
        },
      ],
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic error ${res.status}: ${err.slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text =
    data.content
      ?.filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n") ?? "";
  const cleaned = text
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/```\s*$/im, "")
    .trim();
  // Pull the first JSON array out of the message.
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  const json = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    return JSON.parse(json) as Enriched[];
  } catch (e) {
    console.warn("JSON parse failed for chunk, sample:", cleaned.slice(0, 300));
    return [];
  }
}

async function main() {
  const items = await prisma.asset.findMany({
    where: { kind: "inventory", archived: false },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Enriching ${items.length} inventory items via web search.`);

  let updated = 0;
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    const payload = chunk.map((a) => {
      const lines = [
        `title: ${a.title}`,
        a.subtitle ? `brand_model: ${a.subtitle}` : null,
        a.category ? `category: ${a.category}` : null,
        a.costBasis != null ? `purchase_price_usd: ${a.costBasis}` : null,
        a.notes ? `notes: ${a.notes.slice(0, 150)}` : null,
      ].filter(Boolean);
      return { id: a.id, description: lines.join("\n") };
    });
    process.stdout.write(`  chunk ${i / CHUNK_SIZE + 1}/${Math.ceil(items.length / CHUNK_SIZE)} (${chunk.length} items) … `);
    let enriched: Enriched[] = [];
    try {
      enriched = await enrichChunk(payload);
    } catch (e) {
      console.warn("\nclaude call failed:", e instanceof Error ? e.message : e);
      continue;
    }
    for (const e of enriched) {
      const item = items.find((x) => x.id === e.id);
      if (!item) continue;
      const data: Record<string, unknown> = {};
      if (typeof e.currentValue === "number") data.currentValue = e.currentValue;
      if (typeof e.url === "string" && e.url.startsWith("http")) data.url = e.url;
      if (typeof e.imageUrl === "string" && e.imageUrl.startsWith("http"))
        data.imageUrl = e.imageUrl;
      if (typeof e.notes === "string" && e.notes.length > 0 && !item.notes) {
        data.notes = e.notes;
      }
      if (Object.keys(data).length === 0) continue;
      await prisma.asset.update({ where: { id: item.id }, data });
      updated++;
    }
    process.stdout.write(`updated ${enriched.length}\n`);
  }
  console.log(`Done. Total updated: ${updated}/${items.length}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
