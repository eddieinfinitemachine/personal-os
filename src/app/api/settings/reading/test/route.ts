import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildEpub, kindleFilename } from '@/lib/kindle-epub';
import { sendKindleEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { kindleEmail: true } });
  if (!user?.kindleEmail) {
    return NextResponse.json({ error: 'Kindle email not configured' }, { status: 400 });
  }
  
  try {
    const title = 'EC · Send to Kindle test';
    const testContent = '<p>If you can read this on your Kindle, Send to Kindle is working.</p>';
    const buffer = await buildEpub({
      title,
      author: 'EC',
      siteName: 'EC Read Later',
      sourceUrl: 'https://kaizen.eddiecohen.com',
      savedAt: new Date(),
      contentHtml: testContent,
      images: [],
    });
    const filename = kindleFilename(title);
    
    await sendKindleEmail({
      to: user.kindleEmail,
      title,
      filename,
      epub: buffer,
    });
    
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Test send failed';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
