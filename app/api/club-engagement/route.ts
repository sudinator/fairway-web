import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createRouteClient } from "@/lib/supabase-route";
import { getClubEngagement, ClubEngagementDenied } from "@/lib/club-engagement-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  const session = await createRouteClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const groupId = params.get("group_id") || "";
  const range = params.get("period") || "30";
  if (range !== "30" && range !== "90" && range !== "year") return NextResponse.json({ error: "Choose 30 days, 90 days or year to date." }, { status: 400, headers });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(groupId)) return NextResponse.json({ error: "Choose a valid club." }, { status: 400, headers });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Club engagement isn't configured on the server." }, { status: 503, headers });
  try {
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return NextResponse.json(await getClubEngagement(db, user.id, groupId, Date.now(), range), { headers });
  } catch (e) {
    return NextResponse.json({ error: e instanceof ClubEngagementDenied ? "You must be an active member of this club." : "Couldn't load club engagement. Please retry." }, { status: e instanceof ClubEngagementDenied ? 403 : 503, headers });
  }
}
