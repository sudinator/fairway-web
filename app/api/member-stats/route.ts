// POST /api/member-stats — refresh the signed-in member's badges and player card (211.6).
// The phone sends NO numbers: the server confirms who is asking, reads their rounds from the database and computes
// both with the same code the app uses (lib/member-stats-server). Only for the caller's own account.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createRouteClient } from "@/lib/supabase-route";
import { refreshMemberStats } from "@/lib/member-stats-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "Server isn't configured." }, { status: 503 });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // Only active (approved) accounts earn badges — the same rule as every other change (0197).
  const { data: prof } = await admin.from("profiles").select("account_status").eq("id", user.id).maybeSingle();
  if ((prof?.account_status ?? "active") !== "active") return NextResponse.json({ badgesChanged: 0, badgesRemoved: 0, cardChanged: false });
  try {
    return NextResponse.json(await refreshMemberStats(admin, user.id));
  } catch {
    return NextResponse.json({ error: "Couldn't refresh your stats." }, { status: 500 });
  }
}
