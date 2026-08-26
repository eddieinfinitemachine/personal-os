import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { isFounderUser } from "@/lib/cron";
import { callClaudeJSON } from "@/lib/claude";
import { prisma } from "@/lib/prisma";
import {
  fetchEmail,
  isGmailConfigured,
  searchMessageIds,
  type GmailEmail,
} from "@/lib/google";
import {
  buildGmailQueries,
  buildScanSystemPrompt,
  interleaveIds,
  markDuplicates,
  serializeEmailsForPrompt,
  validateProposals,
  MAX_MESSAGES,
  PER_EMAIL_CHARS,
  TOTAL_CHARS,
  type ExistingItemLite,
  type ScanTripContext,
} from "@/lib/email-scan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Scan the founder's Gmail for booking confirmations that belong to a trip and
// return AI-extracted itinerary proposals. Read-only: this route NEVER writes —
// the client reviews the proposals and commits via /items/bulk.

const FETCH_BATCH = 8;

async function chunkedFetch(ids: string[]): Promise<GmailEmail[]> {
  const out: GmailEmail[] = [];
  for (let i = 0; i < ids.length; i += FETCH_BATCH) {
    const batch = ids.slice(i, i + FETCH_BATCH);
    const results = await Promise.all(batch.map((id) => fetchEmail(id, PER_EMAIL_CHARS)));
    for (const r of results) {
      if (r) out.push(r);
    }
  }
  return out;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!(await isFounderUser(userId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (!isGmailConfigured()) {
    return NextResponse.json(
      {
        error:
          "Gmail not configured (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN)",
      },
      { status: 500 }
    );
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const { id } = await params;
  const trip = await prisma.trip.findUnique({ where: { id }, include: { items: true } });
  if (!trip || trip.userId !== userId) {
    return NextResponse.json({ error: "trip not found" }, { status: 404 });
  }

  const tripCtx: ScanTripContext = {
    name: trip.name,
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    travelers: trip.travelers,
  };

  let emails: GmailEmail[];
  try {
    const queries = buildGmailQueries(tripCtx);
    const lists = await Promise.all(
      queries.map(({ q, maxResults }) =>
        // A malformed/unsupported operator in one query must not sink the scan.
        searchMessageIds(q, maxResults).catch(() => [] as string[])
      )
    );
    const capped = interleaveIds(lists, MAX_MESSAGES);
    const fetched = await chunkedFetch(capped);

    // Accumulate text, stop including once the total-chars budget is exceeded.
    emails = [];
    let total = 0;
    for (const em of fetched) {
      if (total > TOTAL_CHARS) break;
      emails.push(em);
      total += em.text.length;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gmail request failed";
    if (message.includes("token refresh failed")) {
      return NextResponse.json(
        {
          error:
            "Gmail authorization failed — the refresh token may be revoked. Re-run scripts/google-oauth-mint.ts and update GOOGLE_REFRESH_TOKEN.",
        },
        { status: 502 }
      );
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (emails.length === 0) {
    return NextResponse.json({ proposals: [], scanned: 0 });
  }

  const today = new Date().toISOString().slice(0, 10);
  let raw: unknown;
  try {
    raw = await callClaudeJSON({
      system: buildScanSystemPrompt(tripCtx, today),
      user: serializeEmailsForPrompt(emails),
      maxTokens: 8000,
    });
  } catch {
    return NextResponse.json({ error: "could not parse model output" }, { status: 502 });
  }

  const validated = validateProposals(raw, emails);
  const existing: ExistingItemLite[] = trip.items.map((it) => ({
    kind: it.kind,
    title: it.title,
    startAt: it.startAt,
    endAt: it.endAt,
    confirmation: it.confirmation,
    fromLocation: it.fromLocation,
    toLocation: it.toLocation,
  }));
  const proposals = markDuplicates(validated, existing);

  return NextResponse.json({ proposals, scanned: emails.length });
}
