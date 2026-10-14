import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parseTrackerSlugs, validateTrackerSlugs } from '@/lib/tracker-order';

export const dynamic = 'force-dynamic';

// Ordered sidebar trackers, synced across devices. `null` means no browser has
// uploaded its local list yet (the client then migrates its localStorage up).
export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { sidebarTrackers: true },
  });
  const stored = user?.sidebarTrackers ?? null;
  return NextResponse.json({ trackers: stored === null ? null : parseTrackerSlugs(stored) });
}

export async function PUT(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const parsed = validateTrackerSlugs((body as Record<string, unknown>).trackers);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  await prisma.user.update({
    where: { id: userId },
    data: { sidebarTrackers: parsed.value },
  });
  return NextResponse.json({ trackers: parsed.value });
}
