import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { sendPushToUser } from "@/lib/push";

// Register (POST) / remove (DELETE) a device's push subscription, and send a
// test notification (PUT) so enabling can be verified on the spot.

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  } | null;
  if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ error: "subscription required" }, { status: 400 });
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint: body.endpoint },
    update: { userId, p256dh: body.keys.p256dh, auth: body.keys.auth },
    create: {
      userId,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: request.headers.get("user-agent")?.slice(0, 200) ?? null,
    },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    endpoint?: string;
  } | null;
  if (!body?.endpoint) {
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  }
  await prisma.pushSubscription.deleteMany({
    where: { userId, endpoint: body.endpoint },
  });
  return NextResponse.json({ ok: true });
}

// Test push to all of the caller's devices.
export async function PUT(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const delivered = await sendPushToUser(userId, {
    title: "EC",
    body: "Notifications are on. You'll get a morning push for anything due that day.",
    url: "/",
    tag: "test",
  });
  return NextResponse.json({ delivered });
}
