import webpush from "web-push";
import { db } from "@/lib/db";

let configured = false;

function ensureConfigured() {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT ?? "mailto:noreply@eventchart.vercel.app";
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subj, pub, priv);
  configured = true;
  return true;
}

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; url?: string; tag?: string },
): Promise<{ sent: number; pruned: number }> {
  if (!ensureConfigured()) return { sent: 0, pruned: 0 };
  const subs = await db.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return { sent: 0, pruned: 0 };

  let sent = 0;
  const expiredIds: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
      );
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number })?.statusCode;
      // 404/410 = subscription expired/unsubscribed → prune
      if (status === 404 || status === 410) {
        expiredIds.push(s.id);
      }
    }
  }));
  if (expiredIds.length) {
    await db.pushSubscription.deleteMany({ where: { id: { in: expiredIds } } });
  }
  return { sent, pruned: expiredIds.length };
}
