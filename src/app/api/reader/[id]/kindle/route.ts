import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { sendReaderItemToKindle } from '@/lib/kindle-send';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  
  const { id } = await context.params;
  const result = await sendReaderItemToKindle(id, { force: true, userId });
  
  if (result.ok) {
    return NextResponse.json({ ok: true, sentAt: result.sentAt });
  } else {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
}
