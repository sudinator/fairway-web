// Web Push sender. Fired by a Supabase Database Webhook on INSERT into `notifications`.
// It looks up the recipient's push subscriptions + per-type preference and, if that type
// is set to "push", sends a Web Push to each of their devices. In-app-only and off types
// simply don't push (the row already exists for the in-app bell). Protected by a shared
// secret header so only the webhook can call it.
import { NextRequest, NextResponse } from "next/server";
import { sendPushToUser, logPushDecision } from "@/lib/push-send";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";        // web-push needs Node crypto, not the edge runtime
export const dynamic = "force-dynamic";

// Default delivery per notification type when the user hasn't set a preference.
// Must match the client's list in components/manage.tsx.
const DEFAULT_DELIVERY: Record<string, "push" | "inapp" | "off"> = {
  game_added: "push",
  money_owed: "push",
  money_paid: "push",
  tee_reminder: "push",
  tee_new: "inapp",
  bet_posted: "inapp",
  game_finished: "inapp",
  group_member: "inapp",
  course_change: "inapp",
  season_wrapped: "push", // Dec 31 Season Wrapped (205.0) // club admins only; they can raise it to push in Notification settings (198.2)
  friction: "push",   // admin-only integrity alert; always push
  signup_pending: "push",   // 208.0 — admins: a new sign-up is waiting for approval
  signup_reminder: "push",  // 208.0 — admins: someone has waited 7 days
  signup_admitted: "push",  // 208.0 — the new member: you're in
  club_report: "push",      // 210.1 — your club's report (July 1 / October 1)
  club_decision: "push",    // 210.8 — your club request was approved / declined
  support_visit: "push",    // 210.9 — a BNN admin looked in on your club (club admins)
};

function titleFor(type: string | null): string {
  switch (type) {
    case "season_wrapped": return "Your season summary is ready";
    case "signup_pending": return "New sign-up waiting";
    case "signup_reminder": return "Sign-up still waiting";
    case "signup_admitted": return "You're in";
    case "club_report": return "Your club report is ready";
    case "club_decision": return "Your club request";
    case "support_visit": return "A BNN admin looked in";
    case "course_change": return "Course data changed";
    case "money_owed": return "You owe money";
    case "money_paid": return "You got paid";
    case "game_added": return "New game";
    case "tee_reminder":
    case "tee_new": return "Tee time";
    case "friction": return "Data integrity flag";
    default: return "Birdie Num Num";
  }
}

export async function POST(req: NextRequest) {
  // 1) Authenticate the webhook.
  const secret = process.env.PUSH_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-webhook-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2) Must be configured to send.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPriv = process.env.VAPID_PRIVATE_KEY;
  if (!url || !serviceKey || !vapidPub || !vapidPriv) {
    // Misconfiguration must be LOUD (5xx) so webhook senders retry/alert instead of
    // treating a silently dropped notification as delivered. (Security review, Aug 2026.)
    return NextResponse.json({ error: "push not configured" }, { status: 503 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const rec = body?.record;
  if (body?.type !== "INSERT" || body?.table !== "notifications" || !rec?.user_id) {
    return NextResponse.json({ ok: true, skipped: "not a notification insert" }, { status: 200 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // 3) Resolve this recipient's delivery preference for this type.
  const type: string | null = rec.type ?? null;
  const { data: prof } = await admin.from("profiles").select("push_prefs").eq("id", rec.user_id).maybeSingle();
  const prefs = (prof?.push_prefs as Record<string, string>) || {};
  const delivery = prefs[type ?? ""] ?? (type ? DEFAULT_DELIVERY[type] : undefined) ?? "inapp";
  if (delivery !== "push") {
    // In-app only / off: no send, but the decision is logged so the recipient can see why.
    await logPushDecision(admin, { notificationId: rec.id ?? null, userId: rec.user_id, type, delivery, result: `not pushed: this type is set to ${delivery}` });
    return NextResponse.json({ ok: true, delivery }, { status: 200 });
  }

  // 4) Send to every enrolled device through the shared sender, which also logs the attempt.
  const out = await sendPushToUser(admin, {
    userId: rec.user_id,
    payload: { title: titleFor(type), body: rec.message || "", link: rec.link || "/", tag: type || undefined },
    vapidPub, vapidPriv,
    log: { notificationId: rec.id ?? null, type, delivery: "push" },
  });
  // 206.1 (review finding 10): the status says what happened. 200 = every device reached the push
  // service, or the outcome is final (no devices, a removed subscription, a rejected key). 503 = the
  // device lookup failed. 502 = a device still failed after the sender's own retries. The database
  // webhook does not retry, so these show in its response log for diagnosis; the push_delivery_log
  // row says the same in words.
  if (out.lookupFailed) return NextResponse.json({ ok: false, error: out.result }, { status: 503 });
  if (out.retryableFailed > 0) return NextResponse.json({ ok: false, sent: out.sent, failed: out.failed, retryable: out.retryableFailed, result: out.result }, { status: 502 });
  return NextResponse.json({ ok: true, sent: out.sent, failed: out.failed, result: out.result }, { status: 200 });
}
