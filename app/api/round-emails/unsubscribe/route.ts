// /api/round-emails/unsubscribe?u=<member>&t=<signed token>[&k=club] — the email's "turn off" link (209.3; 210.1 club kind).
// The token is signed by the server, so a link can only turn off that member's own emails.
// 212.131: OPENING the link no longer changes anything. Mail scanners and link previews fetch URLs in incoming mail, and
// a GET that wrote the preference meant a member on a work address could be opted out without ever tapping. GET now
// shows a confirmation page with one button; the change is made by POST — either that button, or a mail client's
// RFC 8058 one-click unsubscribe (List-Unsubscribe-Post: List-Unsubscribe=One-Click, body List-Unsubscribe=One-Click),
// which posts to the same URL. ci/test-unsubscribe-route.cjs executes both methods against a modelled database.
import { createClient } from "@supabase/supabase-js";
import { validUnsubscribe } from "@/lib/round-email-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f-]{36}$/i;
const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const shell = (body: string) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Birdie Num Num</title><body style="margin:0;background:#0A2A20;color:#F7F3E8;font-family:-apple-system,Segoe UI,Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px"><div style="max-width:420px;text-align:center"><div style="color:#C9A227;font-weight:800;letter-spacing:2px;font-size:12px">BIRDIE NUM NUM</div>${body}</div></body>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
const page = (msg: string) => shell(`<p style="font-size:17px;line-height:1.5">${msg}</p>`);

type Link = { u: string; t: string; kind: "club" | "round"; what: string };
function linkFrom(params: URLSearchParams): Link {
  const u = params.get("u") || "", t = params.get("t") || "";
  const kind = params.get("k") === "club" ? "club" : "round";
  return { u, t, kind, what: kind === "club" ? "club report emails" : "round summaries" };
}
const invalid = (what: string) => page(`That link isn't valid. You can turn ${what} off in the app: Profile → Notification settings.`);

/** Opening the link: a page that asks, and changes nothing. */
export async function GET(req: Request) {
  const link = linkFrom(new URL(req.url).searchParams);
  if (!UUID.test(link.u) || !validUnsubscribe(link.u, link.t, link.kind)) return invalid(link.what);
  return shell(`<p style="font-size:17px;line-height:1.5">Turn off ${link.what} from Birdie Num Num?</p>
<form method="post"><input type="hidden" name="u" value="${esc(link.u)}"><input type="hidden" name="t" value="${esc(link.t)}"><input type="hidden" name="k" value="${link.kind}">
<button type="submit" style="background:#C9A227;color:#0A2A20;border:0;border-radius:6px;padding:12px 22px;font-size:15px;font-weight:700;cursor:pointer">Turn off ${esc(link.what)}</button></form>
<p style="color:#A8B5A0;font-size:13px;line-height:1.5;margin-top:18px">Nothing changes until you tap the button. You can turn them back on any time in the app: Profile → Notification settings.</p>`);
}

/** The button, or a mail client's one-click unsubscribe: this is the only thing that changes the preference. */
export async function POST(req: Request) {
  // The link's own query carries u/t/k (one-click posts to the URL as sent); the page's form carries the same fields.
  const query = new URL(req.url).searchParams;
  let params = query;
  if (!query.get("u")) {
    try {
      const type = req.headers.get("content-type") || "";
      if (type.includes("application/x-www-form-urlencoded")) params = new URLSearchParams(await req.text());
    } catch { /* an unreadable body is an invalid request */ }
  }
  const link = linkFrom(params);
  if (!UUID.test(link.u) || !validUnsubscribe(link.u, link.t, link.kind)) return invalid(link.what);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return page("Please try again later.");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await db.from("profiles").update(link.kind === "club" ? { club_report_emails: false } : { round_emails: false }).eq("id", link.u);
  const What = link.what.charAt(0).toUpperCase() + link.what.slice(1);
  return page(error ? `Something went wrong — please turn ${link.what} off in the app: Profile → Notification settings.`
    : `${What} are off. You can turn them back on any time in the app: Profile → Notification settings.`);
}
