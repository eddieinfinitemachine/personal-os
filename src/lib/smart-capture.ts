// Shared helper for /api/capture/smart/parse — sends an optional photo + a
// short text description to Claude and asks for a structured proposal:
// either an inventory item or a social interaction. Claude can also pick a
// matching project from the user's active list, and (for inventory only)
// suggest a follow-up todo.

export type CapturePhoto = { mediaType: string; base64: string };

export type ActiveProject = { id: string; name: string; kind: string };

export type InventoryProposal = {
  type: "inventory";
  title: string;
  subtitle?: string | null; // "Brand · Model" if identifiable
  category?: string | null; // "watch" | "kitchen" | "tools" | ...
  status?: string | null; // "owned" | "wishlist" | "exited" | "lost" — defaults to "owned" for "I bought / I have" captures
  costBasis?: number | null; // user-paid (from text), USD
  currentValue?: number | null; // Claude estimate, USD
  location?: string | null; // "living room shelf", "garage"
  acquiredAt?: string | null; // ISO date (yyyy-mm-dd) if mentioned
  sourceVendor?: string | null; // "Brooklyn Flea", "NAPA"
  notes?: string | null;
  projectId?: string | null;
  followupTodo?: { title: string; listName?: string | null } | null;
  photoUrl?: string | null; // populated by /api/capture/smart/parse after Blob upload
};

export type InteractionProposal = {
  type: "interaction";
  kind: "dinner" | "call" | "meeting" | "event" | "message" | "other";
  title: string;
  occurredAt: string; // ISO date
  location?: string | null;
  notes?: string | null;
  personHints: { firstName: string; lastName?: string | null }[];
  projectId?: string | null;
  photoUrl?: string | null;
};

export type CaptureProposal = InventoryProposal | InteractionProposal;

interface ParseInput {
  text: string;
  photo?: CapturePhoto;
  today: string; // YYYY-MM-DD — passed in so Claude can resolve "Friday", "yesterday"
  activeProjects: ActiveProject[];
}

const SYSTEM_PROMPT = `You classify a user's quick "capture" into one of two structured records and extract the fields needed to file it. The user may have attached a photo (often the object they bought, or a receipt) and a short typed description.

Decide:
- "inventory" — they bought / acquired a physical thing (object visible in photo, or text describes a purchase)
- "interaction" — they're logging a social encounter ("had dinner with X", "called Y", "met Z")

Be conservative. If the text/photo doesn't clearly fit, pick inventory only if there's a visible object + price-like signal, otherwise interaction if any person name is mentioned.

For inventory:
- "title": short product name ("Submariner", "KitchenAid Pro 600", "Oil filter").
- "subtitle": "Brand · Model" when identifiable from the photo or text.
- "category": one short bucket ("watch", "camera", "audio", "kitchen", "tools", "instrument", "electronics", "art", "furniture", "clothing", "outdoor", "collectible", "auto-part").
- "status": DEFAULT TO "owned" — anything the user is logging via a "bought / paid / got / picked up / have" phrasing is presumed owned. Use "wishlist" only if the user said "want", "looking at", or "saving for". Use "exited" if they explicitly said "sold / gave away".
- "costBasis": price the user mentioned (USD). Strip "$", commas. Null if not mentioned.
- "currentValue": REALISTIC fair-market resale value as of <TODAY>, integer USD. ALWAYS attempt this when the item is identifiable from the photo or title — use your knowledge of eBay sold listings, Chrono24, Reverb, StockX, KBB, and similar secondary-market data sources to estimate. Don't be timid: for a typical Submariner give ~$10K, not null; for a used iPhone 14 give ~$400, not null. Use null ONLY when the item is genuinely ambiguous (e.g. a no-name generic photo with no make/model). For consumables that depreciate to zero once used (oil filter, food, beauty products), use a small realistic value (often the purchase price minus 20–50%) rather than 0 — they have some salvage / unopened value.
- "location": physical location only if user mentioned ("living room shelf", "garage"). Don't invent.
- "acquiredAt": ISO date if user gave one ("last weekend" → most recent Sat/Sun before <TODAY>). Default to <TODAY> if status is "owned" and no date was given.
- "sourceVendor": store / market / dealer name if mentioned.
- "notes": 1–2 short sentences with anything non-obvious (depreciation trend, authenticity tips, etc.). Skip if generic.
- "projectId": scan ACTIVE_PROJECTS for a clear semantic match (e.g. "oil filter for the Ferrari" → the Ferrari project's id). Return the id verbatim. Null if no clear match.
- "followupTodo": if the item naturally implies a next action ("Install on car", "Register warranty", "Photograph for insurance"), include one short title. Only if obvious. Null otherwise.

For interaction:
- "kind": one of "dinner", "call", "meeting", "event", "message", "other".
- "title": one short line capturing what happened ("Dinner with Joe Milstein at Lucali").
- "occurredAt": ISO date. Resolve relative phrases against <TODAY> ("Friday" → most recent Friday, "yesterday" → <TODAY>-1, default <TODAY>).
- "location": only if mentioned.
- "notes": only if there's substance beyond the title.
- "personHints": every person named, as { firstName, lastName }. Best effort split on whitespace ("Joe Milstein" → firstName "Joe", lastName "Milstein"; "Joe" alone → firstName "Joe", no lastName).
- "projectId": match against ACTIVE_PROJECTS only if the meeting is clearly *about* a project ("met with Joe about Walden" → Walden project id). Null otherwise.

OUTPUT FORMAT: strict JSON, single object, no prose, no markdown fences. Discriminator is the "type" field.`;

export async function parseCapture(input: ParseInput): Promise<CaptureProposal> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const projectsList = input.activeProjects
    .map((p) => `- id=${p.id} | name=${p.name} | kind=${p.kind}`)
    .join("\n");

  const userText = [
    `TODAY: ${input.today}`,
    "",
    "ACTIVE_PROJECTS:",
    projectsList || "(none)",
    "",
    "CAPTURE TEXT:",
    input.text || "(no text provided)",
  ].join("\n");

  const userContent: Array<
    | { type: "text"; text: string }
    | {
        type: "image";
        source: { type: "base64"; media_type: string; data: string };
      }
  > = [{ type: "text", text: userText }];

  if (input.photo) {
    userContent.unshift({
      type: "image",
      source: {
        type: "base64",
        media_type: input.photo.mediaType,
        data: input.photo.base64,
      },
    });
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: SYSTEM_PROMPT.replace(/<TODAY>/g, input.today),
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude error (${res.status}): ${err.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text =
    data.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(
      `Could not parse Claude JSON: ${e instanceof Error ? e.message : String(e)} — sample: ${cleaned.slice(0, 300)}`,
    );
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("type" in parsed) ||
    ((parsed as { type: unknown }).type !== "inventory" &&
      (parsed as { type: unknown }).type !== "interaction")
  ) {
    throw new Error(
      `Claude returned unexpected shape: ${JSON.stringify(parsed).slice(0, 300)}`,
    );
  }

  return parsed as CaptureProposal;
}
