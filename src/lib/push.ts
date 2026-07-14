import webpush from "web-push";
import { prisma } from "@/lib/prisma";

// Web-push sender. VAPID keys come from env; without them every send is a
// silent no-op so the app never breaks when push isn't configured.

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:emcohen@me.com",
    pub,
    priv
  );
  configured = true;
  return true;
}

export type PushPayload = {
  title: string;
  body?: string;
  url?: string; // opened on tap
  tag?: string; // replaces earlier notification with the same tag
};

/** Send to every device the user has subscribed. Dead subs are pruned. */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<number> {
  if (!ensureConfigured()) return 0;
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  let delivered = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 12 }
        );
        delivered++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // Subscription expired or unsubscribed — prune it.
          await prisma.pushSubscription
            .delete({ where: { id: sub.id } })
            .catch(() => {});
        } else {
          console.error("push send failed", status, sub.endpoint.slice(0, 40));
        }
      }
    })
  );
  return delivered;
}
