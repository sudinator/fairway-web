// Send a test push to the caller's own enrolled devices. Proves the whole pipeline — VAPID keys,
// the subscription rows, the push service — from the device in the person's hand, without
// waiting for a real event. Authenticated; sends only to the caller; rate-limited to one a minute.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createRouteClient } from "@/lib/supabase-route";
import { sendPushToUser } from "@/lib/push-send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const lastTest = new Map<string, number>();

export async function POST() {
  const supabase = await createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const now = Date.now();
  if ((lastTest.get(user.id) ?? 0) > now - 60_000) return NextResponse.json({ error: "One test a minute — try again shortly." }, { status: 429 });
  lastTest.set(user.id, now);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPriv = process.env.VAPID_PRIVATE_KEY;
  if (!url || !serviceKey || !vapidPub || !vapidPriv) return NextResponse.json({ error: "Push is not configured on the server (VAPID keys or service role missing)." }, { status: 503 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const out = await sendPushToUser(admin, {
    userId: user.id,
    payload: { title: "Birdie Num Num test", body: `Test push sent ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}. If you can read this, push works on this device.`, link: "/?tab=notifications", tag: "test" },
    vapidPub, vapidPriv,
    log: { type: "test", delivery: "test" },
  });
  return NextResponse.json({ ok: true, ...out });
}
