// Web Push sender. Fired by a Supabase Database Webhook on INSERT into `notifications`.
// It looks up the recipient's push subscriptions + per-type preference and, if that type
// is set to "push", sends a Web Push to each of their devices. In-app-only and off types
// simply don't push (the row already exists for the in-app bell). Protected by a shared
// secret header so only the webhook can call it.
import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
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
};

function titleFor(type: string | null): string {
  switch (type) {
    case "money_owed": return "You owe money";
    case "money_paid": return "You got paid";
    case "game_added": return "New game";
    case "tee_reminder":
    case "tee_new": return "Tee time";
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
    return NextResponse.json({ error: "push not configured" }, { status: 200 });
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
    return NextResponse.json({ ok: true, delivery }, { status: 200 });   // in-app only / off
  }

  // 4) Fetch the recipient's active subscriptions.
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, fail_count")
    .eq("user_id", rec.user_id)
    .eq("disabled", false);
  if (!subs || subs.length === 0) return NextResponse.json({ ok: true, sent: 0 }, { status: 200 });

  webpush.setVapidDetails("mailto:support@birdienumnum.app", vapidPub, vapidPriv);
  const payload = JSON.stringify({
    title: titleFor(type),
    body: rec.message || "",
    link: rec.link || "/",
    tag: type || undefined,
  });

  let sent = 0;
  await Promise.all(subs.map(async (s: any) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      );
      sent++;
    } catch (err: any) {
      const code = err?.statusCode;
      if (code === 404 || code === 410) {
        // Subscription is dead — remove it.
        await admin.from("push_subscriptions").delete().eq("id", s.id);
      } else {
        // Transient/other — count the failure and disable after repeated trouble.
        const next = (typeof s.fail_count === "number" ? s.fail_count : 0) + 1;
        await admin.from("push_subscriptions")
          .update({ fail_count: next, disabled: next >= 8 })
          .eq("id", s.id);
      }
    }
  }));

  return NextResponse.json({ ok: true, sent }, { status: 200 });
}
