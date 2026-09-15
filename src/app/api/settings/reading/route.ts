import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { normalizeKindleEmail } from '@/lib/kindle-settings';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request) {
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

  const input = body as Record<string, unknown>;
  const updates: { kindleEmail?: string | null; kindleAutoSend?: boolean } = {};

  if (Object.prototype.hasOwnProperty.call(input, 'kindleEmail')) {
    const normalized = normalizeKindleEmail(input.kindleEmail);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }
    updates.kindleEmail = normalized.value;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'kindleAutoSend')) {
    if (typeof input.kindleAutoSend !== 'boolean') {
      return NextResponse.json(
        { error: 'kindleAutoSend must be a boolean.' },
        { status: 400 },
      );
    }
    updates.kindleAutoSend = input.kindleAutoSend;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: 'No reading settings provided.' },
      { status: 400 },
    );
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: updates,
    select: { kindleEmail: true, kindleAutoSend: true },
  });

  return NextResponse.json(user);
}
