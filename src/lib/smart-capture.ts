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

export type PersonProposal = {
  type: "person";
  firstName: string;
  lastName?: string | null;
  role?: string | null;     // "artist", "founder", "engineer"
  company?: string | null;  // "Pixar", "Carnegie Mellon"
  city?: string | null;
  email?: string | null;
  phone?: string | null;
  birthday?: string | null; // ISO YYYY-MM-DD
  strength?: "close" | "strong" | "casual" | "weak" | null;
  circles?: string[];       // social circles / tags
  notes?: string | null;
  photoUrl?: string | null;
};

export type CaptureProposal =
  | InventoryProposal
  | InteractionProposal
  | PersonProposal;

interface ParseInput {
  text: string;
  photo?: CapturePhoto;
  today: string; // YYYY-MM-DD — passed in so Claude can resolve "Friday", "yesterday"
  activeProjects: ActiveProject[];
}

const SYSTEM_PROMPT = `You classify a user's quick "capture" into one of THREE structured records and extract the fields needed to file it. The user may have attached a photo (an object they bought, a receipt, a business card, a screenshot of a profile) and a short typed description.

Decide:
- "inventory" — they bought / acquired a physical thing (object visible in photo, or text describes a purchase / "I bought / paid / got / want to buy").
- "interaction" — they're logging a social ENCOUNTER ("had dinner with X", "called Y", "met Z at the event last night"). The defining signal is an event/time happened.
- "person" — they're adding someone to the CRM directly, WITHOUT an associated event. Triggers: "add X to my CRM", "add X to my friends", "X is [a role]", "remind me about X", "save X who is …", or a business-card photo with name + role + company. NO event/time signal means person, not interaction.

Disambiguation:
- "Met Sophie at the party Friday" → interaction (event signal).
- "Add Sophie Loeb to my CRM. She is an artist." → person (no event).
- A business card with no event context → person.
- Photo of someone you met somewhere + no time signal → person (you can describe what they do, not when).

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

For person:
- "firstName" / "lastName": split the name on whitespace. "Sophie Loeb" → firstName="Sophie", lastName="Loeb". A single token → firstName only.
- "role": their work / what they do, if user said. "she is an artist" → "artist". "founder of Acme" → "founder". Lowercase, short.
- "company": if user said or if you confidently recognize the person. "founder of Acme" → "Acme".
- "city": only if user mentioned or you confidently know.
- "email" / "phone" / "birthday": only if literally in the text or photo (business card OCR).
- "strength": "close" | "strong" | "casual" | "weak" — only if user gave a clear cue ("good friend" → strong, "barely know them" → weak). Otherwise null.
- "circles": tags / groups for context (e.g. ["nyc art", "school friends"]) — only if user mentioned explicitly. Don't invent.
- "notes": 1-2 sentences with anything else worth remembering. If you confidently recognize the person from training knowledge as a notable public figure (well-known artist, founder, journalist, etc.), include 1 short factual sentence about what they're known for — clearly attributed ("known for…" / "best known as…"). DO NOT speculate or fabricate. If you don't recognize them with high confidence, leave notes null.
- "photoUrl" is handled separately by the server; don't set it.

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
    !["inventory", "interaction", "person"].includes(
      (parsed as { type: string }).type,
    )
  ) {
    throw new Error(
      `Claude returned unexpected shape: ${JSON.stringify(parsed).slice(0, 300)}`,
    );
  }

  return parsed as CaptureProposal;
}
