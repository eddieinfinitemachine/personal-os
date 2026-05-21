// Shared helper for /api/capture/smart/parse — sends an optional photo + a
// short text description to Claude and asks for a structured proposal:
// either an inventory item or a social interaction. Claude can also pick a
// matching project from the user's active list, and (for inventory only)
// suggest a follow-up todo.

export type CapturePhoto = { mediaType: string; base64: string };

export type ActiveProject = { id: string; name: string; kind: string };

// One proposal for all five Asset kinds in the schema. Same fields apply
// across the lot; only the destination page and label differ. Sub-type
// chosen by Claude via `assetKind`.
export type AssetKind =
  | "inventory" // physical things you own / want
  | "investment" // ventures, stocks, crypto, real estate
  | "media" // books, movies, shows, albums, podcasts
  | "place" // restaurants, hotels, parks, neighborhoods
  | "practice"; // habits, routines, principles

export type AssetProposal = {
  type: "asset";
  assetKind: AssetKind;
  title: string;
  subtitle?: string | null; // "Brand · Model", creator, address, etc.
  category?: string | null;
  status?: string | null;
  costBasis?: number | null;
  currentValue?: number | null;
  amountUsd?: number | null; // for investments — committed dollars
  rating?: number | null; // 1-5, mainly for media + place
  location?: string | null;
  acquiredAt?: string | null;
  sourceVendor?: string | null;
  url?: string | null;       // canonical URL (article, product page, place website)
  notes?: string | null;
  projectId?: string | null;
  followupTodo?: { title: string; listName?: string | null } | null;
  photoUrl?: string | null;
  // Per-assetKind enrichment — schema-free key/value. See SYSTEM_PROMPT for
  // the suggested keys per kind. Merged into Asset.detailsJson at commit.
  details?: Record<string, unknown> | null;
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
  city?: string | null;     // city ONLY — not a country
  country?: string | null;  // separate from city ("Saudi Arabia", "United States")
  socialUrls?: {
    linkedin?: string | null;
    twitter?: string | null;
    instagram?: string | null;
    github?: string | null;
    website?: string | null;
  } | null;
  howWeMet?: string | null; // "intro from Maya at Lucali", "Stanford '22"
  interests?: string[];     // ["climbing", "chess", "Brazilian art"]
  email?: string | null;
  phone?: string | null;
  birthday?: string | null; // ISO YYYY-MM-DD
  strength?: "close" | "strong" | "casual" | "weak" | null;
  circles?: string[];       // social circles / tags
  notes?: string | null;
  photoUrl?: string | null;
};

export type TripProposal = {
  type: "trip";
  name: string;             // "Tokyo Jan 5–12" or just "Tokyo"
  destination?: string | null;
  startDate?: string | null; // ISO YYYY-MM-DD
  endDate?: string | null;
  status?: "planned" | "booked" | "active" | "past" | "cancelled" | null;
  travelers?: string[];     // first names extracted from "with X and Y"
  transport?: string | null;
  accommodation?: string | null;
  costUsd?: number | null;
  bookingUrl?: string | null;
  notes?: string | null;
  photoUrl?: string | null;
};

export type TodoProposal = {
  type: "todo";
  title: string;
  notes?: string | null;
  dueDate?: string | null;     // ISO YYYY-MM-DD
  listName?: string | null;    // "To Do" | "Monitor" | "Later" | custom
  projectId?: string | null;
};

export type CaptureProposal =
  | AssetProposal
  | InteractionProposal
  | PersonProposal
  | TripProposal
  | TodoProposal;

interface ParseInput {
  text: string;
  photo?: CapturePhoto;
  today: string; // YYYY-MM-DD — passed in so Claude can resolve "Friday", "yesterday"
  activeProjects: ActiveProject[];
}

const SYSTEM_PROMPT = `You classify a user's quick "capture" into one of FIVE structured record types and extract the fields needed to file it. The user may have attached a photo (an object, a receipt, a business card, a screenshot) and a short typed description.

You have access to a \`web_search\` tool (up to 3 searches per request). Use it WHEN it materially improves the record — not for every capture. Specifically:
- PERSON: if the person's full name is given, search for them to fill role, company, city, recent work / what they're known for, and a 1-2 sentence bio in "notes". Cite the gist (e.g. "represented by Mendes Wood DM" / "based in São Paulo"). Cross-reference at least 2 sources before populating a confident field. If the name is too common or ambiguous, leave fields null rather than guess.
- ASSET (inventory / investment / media / place): search if it materially improves the value estimate, edition, or factual details ("current eBay sold for Submariner 124060", "current price Anthropic Series E"). Skip for clear consumables.
- INTERACTION / TRIP / TODO: do NOT search. These don't need lookups.

CRITICAL OUTPUT FORMAT:
- Your ENTIRE final text response must be a single JSON object — nothing else.
- NO prose, NO commentary, NO "Here is the JSON:" preamble, NO "I'll record what's given" trailing notes.
- NO markdown code fences (no \`\`\`json).
- If you need to think out loud, do it via tool calls (search queries), not in text blocks.
- The last text block in your response will be JSON-parsed verbatim. If it has any non-JSON text it will fail.



Top-level types (the "type" discriminator):
- "asset"       — anything that lives in their asset library. Has 5 sub-kinds (assetKind):
                  • inventory  — physical things owned/wanted (watches, gear, tools)
                  • investment — ventures, stocks, crypto, real estate
                  • media      — books, movies, shows, albums, podcasts ("watched X", "reading Y")
                  • place      — restaurants, hotels, parks, neighborhoods ("want to try X", "visited Y")
                  • practice   — habits, routines, principles ("habit: meditate 20min")
- "interaction" — a social ENCOUNTER that happened. Time/event signal: "had dinner with X", "called Y", "met Z Friday".
- "person"      — adding someone to the CRM directly, no event. "add X to my CRM", "X is a [role]", business cards.
- "trip"        — a planned or past trip: "trip to Tokyo Jan 5–12", "going to Lisbon in March", "Aspen with the kids".
- "todo"        — a task to do: "remind me to call dentist", "I need to renew passport", "todo: send invoice to Acme".

Disambiguation rules:
- A time + person signal → interaction. "Met Sophie at the party Friday" = interaction; "add Sophie to my CRM, she is an artist" = person.
- A book/movie/show/album → asset/media. Don't make it inventory.
- A restaurant or location you've been or want to go → asset/place (NOT a trip — trips have date ranges and a destination city).
- "I bought X" / "got X" / "want X" → asset (default assetKind = inventory unless clearly a book/film/place/etc).
- "Invested $X in Y" / "bought Y shares" → asset/investment.
- "Habit: …" / "Principle: …" / "Best practice: …" → asset/practice.
- "Remind me to …" / "todo: …" / "I need to …" → todo (NOT a person, NOT an interaction).
- A future trip with dates → trip. A wished-for restaurant → asset/place.
- TEXT THAT IS JUST A URL or "read this / bookmark this / save this <URL>" → asset/media. Treat as a "to read / to watch" bookmark: visit the URL via web_search if useful, set title = the page/article title, creator = the publication or author, url = the URL itself, status = "wishlist". Same for "want to watch <YouTube URL>" → asset/media with format="video".

For asset (across all assetKinds):

Per-assetKind ENRICHMENT goes into a "details" object (we'll merge it into the row's detailsJson). Always populate ANY of these you can extract from the text or via web search; omit (don't fabricate) the rest.

- inventory.details: { brand, model, year, condition ("new"|"used"|"vintage"), warranty (months remaining), serialNumber, purchaseChannel ("ebay"|"NAPA"|...) }
- investment.details: { round ("pre-seed"|"seed"|"A"|"B"|...), leadInvestor, coInvestors[], valuationUsd, ourStakePct, vehicle ("safe"|"equity"|"convertible"|"common"|"crypto"), assetClass ("venture"|"public-equity"|"crypto"|"real-estate"|"art") }
- media.details: { format ("book"|"film"|"show"|"album"|"podcast"|"essay"), creator, genre, releaseYear, runtimeMinutes, language, recommendedBy }
- place.details: { neighborhood, cuisine ("ramen"|"izakaya"|"steakhouse"|...), priceRange ("$"|"$$"|"$$$"|"$$$$"), reservationRequired (bool), dressCode, hours, websiteUrl, instagramUrl, michelin (1|2|3 stars), nearestSubway }
- practice.details: { cadence ("daily"|"weekly"|"seasonal"), trigger ("after coffee"|"before bed"), durationMinutes, why, anchoredHabit }

assetKind defaults & status semantics:
- inventory: status defaults to "owned" (or "wishlist" if forward-looking).
- investment: status defaults to "active". Use "exited" if sold, "wishlist" if "thinking about investing".
- media: status reflects format-specific intent.
  • Future-tense by format: book / essay / article → "to-read"; film / show / video → "to-watch"; podcast / album → "to-listen". Use the most specific one based on the "format" field in details.
  • Past-tense / consumed: "watched" / "read" / "listened" / "finished" → "consumed".
  • Mid-consumption: "reading", "watching" → "in-progress".
  • If genuinely ambiguous (no format known and no past tense), fall back to "wishlist".
- place: status "visited" if past tense / "loved" / "had dinner at", "wishlist" / "want to try" if forward-looking.
- practice: status "active" by default (it's a habit they're adopting). Use "exited" for explicitly-abandoned practices.

For inventory specifically — read the text carefully. Status is the single most important field.
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
- "city": the CITY only ("São Paulo", "Brooklyn", "Riyadh"). Do NOT put a country here — that's "country".
- "country": country name ("Brazil", "United States", "Saudi Arabia"). Extract from text ("from Saudi" → country="Saudi Arabia") or from web search.
- "socialUrls": object with optional keys linkedin / twitter / instagram / github / website. Populate ONLY when the URL or handle is mentioned in the text, visible in a photo (business card / screenshot), or found via your web search with high confidence. For Twitter/IG, store the full URL (https://twitter.com/handle), not just the handle.
- "howWeMet": short context if user mentioned it ("intro from Maya", "met at the Olto launch", "Stanford 2018"). Otherwise null.
- "interests": short array of topics they care about ("climbing", "Brazilian art", "VC", "kid swaps") — only if the user mentioned them or you're highly confident from web search. Maximum 5.
- "email" / "phone" / "birthday": only if literally in the text or photo (business card OCR).
- "strength": "close" | "strong" | "casual" | "weak" — only if user gave a clear cue ("good friend" → strong, "barely know them" → weak). Otherwise null.
- "circles": tags / groups for context (e.g. ["nyc art", "school friends"]) — only if user mentioned explicitly. Don't invent.
- "notes": 1-2 sentences with anything else worth remembering. If you confidently recognize the person from training knowledge or web search as a notable public figure, include 1 short factual sentence about what they're known for. DO NOT speculate or fabricate. If you don't recognize them with high confidence, leave notes null.
- "photoUrl" is handled separately by the server; don't set it.

For trip:
- "name": short label. "Tokyo Jan 5–12" or "Tokyo with Maya" or "Tokyo".
- "destination": primary city / region. "Tokyo, Japan".
- "startDate" / "endDate": ISO dates if user gave them (resolve "next month" / "Jan 5" against <TODAY>).
- "status": "planned" default. "booked" if user mentioned flights/hotel booked. "past" if past dates. "cancelled" only if explicit.
- "travelers": first names of co-travelers from "with X" / "X and I" — array of strings.
- "transport" / "accommodation": short phrases if mentioned ("flight on ANA", "Park Hyatt").
- "costUsd": total trip budget if mentioned. Strip "$", commas.
- "bookingUrl": if user pasted a URL.
- "notes": anything notable.

For todo:
- "title": short imperative — "Call dentist", "Renew passport", "Send invoice to Acme".
- "notes": longer context if any.
- "dueDate": ISO if user said "tomorrow" / "Friday" / "by next week". Resolve against <TODAY>. Default null.
- "listName": "To Do" by default. "Monitor" if user said "watch / monitor / keep an eye on". "Later" if "someday / eventually / no rush".
- "projectId": match ACTIVE_PROJECTS like for asset (e.g. "todo: change Ferrari oil" → Ferrari project). Null otherwise.

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

  // Sonnet 4.6 + Anthropic's web_search server tool. Sonnet handles tool use
  // more reliably than Haiku, and web_search lets it actually look up real
  // information about a person, current market prices, place reviews, etc.
  // Anthropic runs the search behind the scenes — we just declare the tool.
  // max_uses caps total searches per request to keep latency + cost bounded.
  const body = JSON.stringify({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: SYSTEM_PROMPT.replace(/<TODAY>/g, input.today),
    messages: [{ role: "user", content: userContent }],
    tools: [
      { type: "web_search_20250305", name: "web_search", max_uses: 3 },
    ],
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
  // After tool use, the final answer is the LAST text block, not the first.
  // (Intermediate text may explain what Claude is searching for.)
  const textBlocks = (data.content ?? []).filter(
    (c): c is { type: "text"; text: string } =>
      c.type === "text" && typeof c.text === "string",
  );
  // Try parsing the LAST text block first (the intended JSON). If that fails,
  // fall back to scanning every text block for the first balanced { … } object
  // — Claude sometimes narrates its reasoning alongside the JSON instead of
  // emitting pure JSON, despite the prompt's instructions.
  const candidates: string[] = [];
  for (let i = textBlocks.length - 1; i >= 0; i--) {
    const raw = textBlocks[i].text.trim();
    candidates.push(
      raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim(),
    );
  }

  let parsed: unknown = null;
  let lastError: string | null = null;

  for (const cleaned of candidates) {
    // Direct parse.
    try {
      parsed = JSON.parse(cleaned);
      break;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    // Brace-extracted parse — find the first balanced {…} and try that.
    const extracted = extractFirstJsonObject(cleaned);
    if (extracted) {
      try {
        parsed = JSON.parse(extracted);
        break;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
  }

  if (parsed == null) {
    const sample = candidates[0]?.slice(0, 300) ?? "";
    throw new Error(
      `Could not parse Claude JSON: ${lastError ?? "no candidate parsed"} — sample: ${sample}`,
    );
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("type" in parsed) ||
    !["asset", "interaction", "person", "trip", "todo"].includes(
      (parsed as { type: string }).type,
    )
  ) {
    throw new Error(
      `Claude returned unexpected shape: ${JSON.stringify(parsed).slice(0, 300)}`,
    );
  }

  return parsed as CaptureProposal;
}

// Scan a string for the first top-level balanced {…} object, respecting
// string literals (so braces inside JSON string values don't break the count).
// Returns null if no balanced object is found.
function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inStr) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
