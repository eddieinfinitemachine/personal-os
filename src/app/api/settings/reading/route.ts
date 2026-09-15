import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function PATCH(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  
  const body = await request.json();
  const { kindleEmail: rawEmail, kindleAutoSend } = body;
  
  const updates: { kindleEmail?: string | null; kindleAutoSend?: boolean } = {};
  
  if (rawEmail !== undefined) {
    let email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : null;
    if (email === '') email = null;
    
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email) || email.length > 254) {
        return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
      }
    }
    updates.kindleEmail = email;
  }
  
  if (kindleAutoSend !== undefined) {
    updates.kindleAutoSend = Boolean(kindleAutoSend);
  }
  
  const user = await prisma.user.update({
    where: { id: userId },
    data: updates,
    select: { kindleEmail: true, kindleAutoSend: true },
  });
  
  return NextResponse.json(user);
}
