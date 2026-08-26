import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { SCAN_KINDS } from "@/lib/email-scan";

export const dynamic = "force-dynamic";

// Bulk-create trip items from reviewed email-scan proposals. Auth + ownership
// mirror /api/trips/[id]/items. Only ever called after the user confirms the
// rows in TripEmailImport — nothing here writes without that explicit click.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const trip = await prisma.trip.findUnique({ where: { id } });
  if (!trip || trip.userId !== userId) {
    return NextResponse.json({ error: "trip not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { items?: unknown[] };
  const rawItems = Array.isArray(body.items) ? body.items : [];

  const toDate = (v: unknown): Date | null =>
    typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v) : null;
  const strOrNull = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;

  const normalized: Array<{
    kind: string;
    title: string;
    startAt: Date | null;
    endAt: Date | null;
    location: string | null;
    fromLocation: string | null;
    toLocation: string | null;
    confirmation: string | null;
    url: string | null;
    costUsd: number | null;
    notes: string | null;
  }> = [];

  for (const entry of rawItems) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;

    const title = typeof e.title === "string" ? e.title.trim() : "";
    if (!title) continue;

    const kind = typeof e.kind === "string" ? e.kind : "";
    if (!(SCAN_KINDS as readonly string[]).includes(kind)) {
      return NextResponse.json({ error: `invalid kind: ${kind}` }, { status: 400 });
    }

    normalized.push({
      kind,
      title,
      startAt: toDate(e.startAt),
      endAt: toDate(e.endAt),
      location: strOrNull(e.location),
      fromLocation: strOrNull(e.fromLocation),
      toLocation: strOrNull(e.toLocation),
      confirmation: strOrNull(e.confirmation),
      url: strOrNull(e.url),
      costUsd:
        typeof e.costUsd === "number" && Number.isFinite(e.costUsd) ? e.costUsd : null,
      notes: strOrNull(e.notes),
    });
  }

  if (normalized.length === 0) {
    return NextResponse.json({ error: "no items to add" }, { status: 400 });
  }
  if (normalized.length > 100) {
    return NextResponse.json({ error: "too many items (max 100)" }, { status: 400 });
  }

  const max = await prisma.tripItem.aggregate({
    where: { tripId: id },
    _max: { position: true },
  });
  const base = (max._max.position ?? -1) + 1;

  const rows = normalized.map((r, i) => ({
    ...r,
    tripId: id,
    userId,
    position: base + i,
  }));

  const items = await prisma.tripItem.createManyAndReturn({ data: rows });
  return NextResponse.json({ items });
}
