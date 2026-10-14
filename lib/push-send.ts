// The ONE Web Push sender. Used by /api/push (webhook on notification insert) and /api/push/test
// (a signed-in person pushing to their own devices). Records every call in push_delivery_log so
// "was a push ever sent to me, and did it arrive at the push service?" has an answer (0172).
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SendOutcome = {
  endpoints: number; sent: number; failed: number; result: string;
  /** 206.1 (review finding 10): what kind of failure, so the caller can answer honestly. */
  lookupFailed: boolean;      // the device lookup itself failed — NOT "no enrolled devices"
  retryableFailed: number;    // still failing after retries (429 / 5xx / network)
  permanentFailed: number;    // gone (404/410, removed) or rejected (4xx) — retrying cannot help
};

type Sub = { id: string; endpoint: string; p256dh: string; auth: string; fail_count: number | null };
type SendOne = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown>;
const RETRY_DELAYS_MS = [400, 1200];
/** Transient: rate limited, push-service error, or no status at all (network). Everything else is final. */
export const isRetryable = (code: number | undefined) => code === undefined || code === 429 || (code >= 500 && code <= 599);

export async function sendPushToUser(
  admin: SupabaseClient,
  opts: { userId: string; payload: { title: string; body: string; link?: string; tag?: string };
          vapidPub: string; vapidPriv: string; log: { notificationId?: string | null; type: string | null; delivery: string };
          /** Test seam: replaces web-push's sender (and the retry pause). */
          sendImpl?: SendOne; sleep?: (ms: number) => Promise<void> },
): Promise<SendOutcome> {
  const { data: subs, error: lookupErr } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, fail_count")
    .eq("user_id", opts.userId)
    .eq("disabled", false);

  let sent = 0, permanentFailed = 0, retryableFailed = 0;
  const notes: string[] = [];
  const list = (subs || []) as Sub[];
  if (!lookupErr && list.length) {
    if (!opts.sendImpl) webpush.setVapidDetails("mailto:support@birdienumnum.app", opts.vapidPub, opts.vapidPriv);
    const send: SendOne = opts.sendImpl ?? ((sub, p) => webpush.sendNotification(sub, p));
    const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const payload = JSON.stringify({ title: opts.payload.title, body: opts.payload.body, link: opts.payload.link || "/", tag: opts.payload.tag });
    // Retry ONLY devices that have not yet received it — a device that succeeded is never sent twice.
    let pending = list;
    const lastCode = new Map<string, number | undefined>();
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length && pending.length; attempt++) {
      if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
      const retry: Sub[] = [];
      await Promise.all(pending.map(async (s) => {
        try {
          await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
          sent++;
          if (typeof s.fail_count === "number" && s.fail_count > 0) await admin.from("push_subscriptions").update({ fail_count: 0 }).eq("id", s.id);
        } catch (err: any) {
          const code = err?.statusCode as number | undefined;
          lastCode.set(s.id, code);
          if (code === 404 || code === 410) {
            permanentFailed++;
            await admin.from("push_subscriptions").delete().eq("id", s.id);
            notes.push(`endpoint gone (${code}), removed`);
          } else if (!isRetryable(code)) {
            permanentFailed++;
            notes.push(`rejected (HTTP ${code})`);
          } else {
            retry.push(s);
          }
        }
      }));
      pending = retry;
    }
    // Still failing after the retries: count it against the subscription, as before.
    for (const s of pending) {
      retryableFailed++;
      const next = (typeof s.fail_count === "number" ? s.fail_count : 0) + 1;
      await admin.from("push_subscriptions").update({ fail_count: next, disabled: next >= 8 }).eq("id", s.id);
      notes.push(`HTTP ${lastCode.get(s.id) ?? "network error"} after ${RETRY_DELAYS_MS.length + 1} attempts${next >= 8 ? ", endpoint disabled after 8 failures" : ""}`);
    }
  }
  const failed = permanentFailed + retryableFailed;
  const result = lookupErr
    ? `device lookup failed: ${lookupErr.message || "unknown error"}`
    : list.length === 0
      ? "no enrolled devices"
      : `${sent} delivered to the push service, ${failed} failed${notes.length ? ": " + notes.join("; ") : ""}`;
  try {
    await admin.from("push_delivery_log").insert({
      notification_id: opts.log.notificationId ?? null, user_id: opts.userId, type: opts.log.type,
      delivery: opts.log.delivery, endpoints: list.length, sent, failed, result: result.slice(0, 300),
    });
  } catch { /* the log must never block a send */ }
  return { endpoints: list.length, sent, failed, result, lookupFailed: !!lookupErr, retryableFailed, permanentFailed };
}

export async function logPushDecision(admin: SupabaseClient, row: { notificationId?: string | null; userId: string; type: string | null; delivery: string; result: string }) {
  try {
    await admin.from("push_delivery_log").insert({ notification_id: row.notificationId ?? null, user_id: row.userId, type: row.type, delivery: row.delivery, endpoints: 0, sent: 0, failed: 0, result: row.result.slice(0, 300) });
  } catch { /* never block */ }
}
