// POST /api/admin/merge-accounts — merge a duplicate account into the member's main account (208.0).
//
// The merge runs on the SERVER: it moves rounds, and the primary-scoring-device guard (0162) rightly refuses
// round changes from an end user whose scoring device isn't primary — a merge isn't scoring. The database
// function (merge_accounts_as, service role only) re-checks that the acting person is an active system admin
// and refuses anything that would corrupt data (same game, same expense, a settlement between the two).
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createRouteClient } from "@/lib/supabase-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(req: Request) {
  const supabase = await createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  let body: { keep?: string; remove?: string; reason?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }
  if (!body.keep || !body.remove || !UUID.test(body.keep) || !UUID.test(body.remove) || body.keep === body.remove) {
    return NextResponse.json({ error: "Choose the account to keep and the duplicate." }, { status: 400 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "Server isn't configured for merges." }, { status: 503 });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // The database is the authority on who may merge: it refuses unless the actor is an active system admin.
  const { data, error } = await admin.rpc("merge_accounts_as", {
    p_actor: user.id, p_keep: body.keep, p_remove: body.remove, p_reason: (body.reason || "").slice(0, 200) || null,
  });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "55000" ? 409 : 502;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ ok: true, result: data });
}
