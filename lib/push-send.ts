// The ONE Web Push sender. Used by /api/push (webhook on notification insert) and /api/push/test
// (a signed-in person pushing to their own devices). Records every call in push_delivery_log so
// "was a push ever sent to me, and did it arrive at the push service?" has an answer (0172).
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SendOutcome = { endpoints: number; sent: number; failed: number; result: string };

export async function sendPushToUser(
  admin: SupabaseClient,
  opts: { userId: string; payload: { title: string; body: string; link?: string; tag?: string };
          vapidPub: string; vapidPriv: string; log: { notificationId?: string | null; type: string | null; delivery: string } },
): Promise<SendOutcome> {
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, fail_count")
    .eq("user_id", opts.userId)
    .eq("disabled", false);

  let sent = 0, failed = 0;
  const notes: string[] = [];
  if (subs && subs.length) {
    webpush.setVapidDetails("mailto:support@birdienumnum.app", opts.vapidPub, opts.vapidPriv);
    const payload = JSON.stringify({ title: opts.payload.title, body: opts.payload.body, link: opts.payload.link || "/", tag: opts.payload.tag });
    await Promise.all(subs.map(async (s: any) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        sent++;
        // A success proves the subscription is healthy — clear accumulated transient failures.
        if (typeof s.fail_count === "number" && s.fail_count > 0) {
          await admin.from("push_subscriptions").update({ fail_count: 0 }).eq("id", s.id);
        }
      } catch (err: any) {
        failed++;
        const code = err?.statusCode;
        if (code === 404 || code === 410) {
          // Subscription is dead — remove it.
          await admin.from("push_subscriptions").delete().eq("id", s.id);
          notes.push(`endpoint gone (${code}), removed`);
        } else {
          const next = (typeof s.fail_count === "number" ? s.fail_count : 0) + 1;
          await admin.from("push_subscriptions").update({ fail_count: next, disabled: next >= 8 }).eq("id", s.id);
          notes.push(`HTTP ${code ?? "?"}${next >= 8 ? ", endpoint disabled after 8 failures" : ""}`);
        }
      }
    }));
  }
  const result = !subs || subs.length === 0
    ? "no enrolled devices"
    : `${sent} delivered to the push service, ${failed} failed${notes.length ? ": " + notes.join("; ") : ""}`;
  try {
    await admin.from("push_delivery_log").insert({
      notification_id: opts.log.notificationId ?? null, user_id: opts.userId, type: opts.log.type,
      delivery: opts.log.delivery, endpoints: subs?.length ?? 0, sent, failed, result: result.slice(0, 300),
    });
  } catch { /* the log must never block a send */ }
  return { endpoints: subs?.length ?? 0, sent, failed, result };
}

// A decision not to push is still worth a row: it is the answer to "why didn't I get one".
export async function logPushDecision(admin: SupabaseClient, row: { notificationId?: string | null; userId: string; type: string | null; delivery: string; result: string }) {
  try {
    await admin.from("push_delivery_log").insert({ notification_id: row.notificationId ?? null, user_id: row.userId, type: row.type, delivery: row.delivery, endpoints: 0, sent: 0, failed: 0, result: row.result.slice(0, 300) });
  } catch { /* never block */ }
}
