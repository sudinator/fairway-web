// POST /api/my-data — "Email me my data" (212.133, owner). The signed-in member asks; the server builds their rounds,
// holes and games as CSV files (lib/my-data-export) and emails them to the ADDRESS ON THEIR ACCOUNT — never one they
// type — from the app's Gmail sender (the round-email account). Once a day per member (my_data_exports, 0241).
// GET returns when the member may next ask, for the Profile card.
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { createRouteClient } from "@/lib/supabase-route";
import { loadMyData, nextExportAllowedAt, exportSubject, exportEmailText, EXPORT_INTERVAL_HOURS } from "@/lib/my-data-export-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

async function caller() {
  const session = await createRouteClient();
  const { data: { user } } = await session.auth.getUser();
  return user;
}
/** The canonical rule for a service-role route (SECURITY_CHECKLIST): an active, unbanned account — never pending, suspended or banned. */
async function activeAccount(db: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await db.from("profiles").select("account_status, banned, deactivated").eq("id", userId).maybeSingle();
  const p = (data ?? null) as { account_status?: string | null; banned?: boolean | null; deactivated?: boolean | null } | null;
  return (p?.account_status ?? "") === "active" && !p?.banned && !p?.deactivated;
}
function service() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET() {
  const user = await caller();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401, headers });
  const db = service();
  if (!db) return NextResponse.json({ error: "Not configured on this server." }, { status: 503, headers });
  if (!(await activeAccount(db, user.id))) return NextResponse.json({ error: "Your account isn't active." }, { status: 403, headers });
  try {
    const next = await nextExportAllowedAt(db, user.id);
    const { data: last } = await db.from("my_data_exports").select("requested_at, sent_to, rounds, games").eq("user_id", user.id).eq("status", "sent").order("requested_at", { ascending: false }).limit(1).maybeSingle();
    return NextResponse.json({ email: user.email ?? null, nextAllowedAt: next.toISOString(), canRequest: next.getTime() <= Date.now(), last: last ?? null, configured: !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) }, { headers });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't check." }, { status: 502, headers }); }
}

export async function POST() {
  const user = await caller();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401, headers });
  if (!user.email) return NextResponse.json({ error: "Your account has no email address to send to." }, { status: 400, headers });
  const db = service();
  if (!db) return NextResponse.json({ error: "Not configured on this server." }, { status: 503, headers });
  const gmailUser = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !pass) return NextResponse.json({ error: "Email isn't configured on this server (staging sends no email)." }, { status: 503, headers });
  if (!(await activeAccount(db, user.id))) return NextResponse.json({ error: "Your account isn't active." }, { status: 403, headers });
  let ledgerId: string | null = null;
  try {
    const next = await nextExportAllowedAt(db, user.id);
    if (next.getTime() > Date.now()) return NextResponse.json({ error: `You can ask for your data once every ${EXPORT_INTERVAL_HOURS} hours.`, nextAllowedAt: next.toISOString() }, { status: 429, headers });
    // the ledger row is written FIRST ('sending' holds the day), so two taps at once cannot both send
    const { data: row, error: ledgerError } = await db.from("my_data_exports").insert({ user_id: user.id, sent_to: user.email, status: "sending" }).select("id").single();
    if (ledgerError || !row) throw new Error(`ledger: ${ledgerError?.message ?? "no row"}`);
    ledgerId = row.id as string;
    const { data: profile } = await db.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
    const data = await loadMyData(db, user.id);
    const mail = nodemailer.createTransport({ service: "gmail", auth: { user: gmailUser, pass: pass.replace(/\s+/g, "") } });
    const firstName = (profile?.display_name || "").split(" ")[0] || null;
    await mail.sendMail({
      from: `Birdie Num Num <${gmailUser}>`, to: user.email, subject: exportSubject(data.counts), text: exportEmailText(firstName, data.counts),
      attachments: data.files.map((f) => ({ filename: f.filename, content: f.content, contentType: "text/csv; charset=utf-8" })),
    });
    await db.from("my_data_exports").update({ status: "sent", rounds: data.counts.rounds, holes: data.counts.holes, games: data.counts.games }).eq("id", ledgerId);
    return NextResponse.json({ ok: true, sentTo: user.email, counts: data.counts }, { headers });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // a failed attempt holds 15 minutes (0241), never the day
    try { if (ledgerId) await db.from("my_data_exports").update({ status: "failed", error: message.slice(0, 500) }).eq("id", ledgerId); } catch { /* the ledger is best-effort on failure */ }
    return NextResponse.json({ error: "Couldn't send your data right now. Please try again later." }, { status: 502, headers });
  }
}
