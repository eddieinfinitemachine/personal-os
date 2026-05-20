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

STATUS — read the text carefully. Status is the single most important field.
- "owned" → past-tense acquisition phrasing. Trigger phrases: "bought", "got", "paid", "picked up", "purchased", "received", "have", "own", "snagged", "scored", "took home", "brought home", or just a price + item name with no verb at all ("$850 watch from Brooklyn Flea"). DEFAULT to this when ambiguous.
- "wishlist" → forward-looking / desire phrasing. Trigger phrases: "want", "want to buy", "looking at", "saving for", "considering", "thinking about", "on my list", "would love", "next purchase", "obsessed with", "eyeing". Anything that implies the user does NOT yet possess it.
- "exited" → past disposal. "Sold", "gave away", "donated", "returned", "got rid of".
- "lost" → "lost", "stolen", "broken beyond repair".

Consequences of status (don't violate these):
- If status is "wishlist": costBasis MUST be null (they haven't paid). acquiredAt MUST be null. sourceVendor can still be the store they're considering. A natural followupTodo is "Buy <item>" — include it.
- If status is "owned" with NO price in the text: costBasis = null (don't invent).
- If status is "exited": acquiredAt can stay null unless they mentioned when they got it.

OTHER FIELDS:
- "title": short product name ("Submariner", "KitchenAid Pro 600", "Oil filter").
- "subtitle": "Brand · Model" when identifiable from the photo or text.
- "category": one short bucket ("watch", "camera", "audio", "kitchen", "tools", "instrument", "electronics", "art", "furniture", "clothing", "outdoor", "collectible", "auto-part").
- "costBasis": price the user mentioned (USD). Strip "$", commas. Null if not mentioned OR status is wishlist.
- "currentValue": REALISTIC fair-market value as of <TODAY>, integer USD. ALWAYS attempt this when the item is identifiable. For OWNED items use secondary-market resale (eBay sold / Chrono24 / Reverb / StockX / KBB). For WISHLIST items use what the user would PAY today (retail / current asking / typical street price). Don't be timid: Submariner ~$10K, used iPhone 14 ~$400, generic oil filter ~$8. Null ONLY when truly unidentifiable.
- "location": physical location only if user mentioned. Don't invent. Leave null for wishlist (they don't have it).
- "acquiredAt": ISO date if user gave one. Null for wishlist / exited / lost unless explicitly stated.
- "sourceVendor": store / market / dealer name if mentioned. For wishlist, this can be where they're considering buying from.
- "notes": 1–2 short sentences with anything non-obvious (depreciation trend, authenticity tips, "back in stock soon", etc.). Skip if generic.
- "projectId": scan ACTIVE_PROJECTS for a clear semantic match (e.g. "oil filter for the Ferrari" → the Ferrari project's id). Return the id verbatim. Null if no clear match.
- "followupTodo": if the item naturally implies a next action, include one short title. Use "Buy <item>" for wishlist items, "Install <item>" / "Register warranty" / "Photograph for insurance" for owned items. Null if no obvious follow-up.

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

  // Haiku 4.5 — vision-capable, fast (~1-2s parse), and much less likely
  // to hit 529 overload than Sonnet. For structured extraction from text +
  // image, it's the right size of model. Trade: slightly weaker on nuanced
  // market-value estimates — but the user can edit in the preview anyway.
  const body = JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2000,
    system: SYSTEM_PROMPT.replace(/<TODAY>/g, input.today),
    messages: [{ role: "user", content: userContent }],
  });

  // Anthropic returns 529 "Overloaded" + 503 / 502 transient errors under load.
  // Retry with exponential-ish backoff before surfacing to the user.
  let res: Response | null = null;
  let lastErr: { status: number; body: string } | null = null;
  const delaysMs = [0, 1200, 3000];
  for (const delay of delaysMs) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body,
    });
    if (res.ok) break;
    const errBody = await res.text();
    lastErr = { status: res.status, body: errBody };
    // Only retry transient server errors. 4xx (bad request, auth, etc.) bails immediately.
    if (![502, 503, 529].includes(res.status)) break;
  }

  if (!res || !res.ok) {
    const status = lastErr?.status ?? 0;
    if (status === 529) {
      throw new Error(
        "Claude is overloaded right now — try again in a few seconds.",
      );
    }
    throw new Error(
      `Claude error (${status}): ${(lastErr?.body ?? "").slice(0, 500)}`,
    );
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
