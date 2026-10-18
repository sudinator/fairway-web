// GET /api/round-emails/unsubscribe?u=<member>&t=<signed token> — the email's one-click "turn off" (209.3).
// The token is signed by the server, so a link can only turn off that member's own emails.
import { createClient } from "@supabase/supabase-js";
import { validUnsubscribe } from "@/lib/round-email-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;
const page = (msg: string) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Birdie Num Num</title><body style="margin:0;background:#0A2A20;color:#F7F3E8;font-family:-apple-system,Segoe UI,Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px"><div style="max-width:420px;text-align:center"><div style="color:#C9A227;font-weight:800;letter-spacing:2px;font-size:12px">BIRDIE NUM NUM</div><p style="font-size:17px;line-height:1.5">${msg}</p></div></body>`, { headers: { "content-type": "text/html; charset=utf-8" } });

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams, u = q.get("u") || "", t = q.get("t") || "";
  if (!UUID.test(u) || !validUnsubscribe(u, t)) return page("That link isn't valid. You can turn round summaries off in the app: Profile → Notification settings.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return page("Please try again later.");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await db.from("profiles").update({ round_emails: false }).eq("id", u);
  return page(error ? "Something went wrong — please turn round summaries off in the app: Profile → Notification settings."
    : "Round summaries are off. You can turn them back on any time in the app: Profile → Notification settings.");
}
