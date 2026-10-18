// POST /api/round-emails — called every 10 minutes by a Supabase Database Webhook on email_ticks (209.3).
// Sends the round-summary email for rounds that are due (due_round_emails: an hour after the round, within a
// week, members who receive them — the owner only until opened to everyone). Unchanged rounds are never sent
// twice; a changed one goes out as "Updated:". Every attempt is logged. Without the Gmail keys (e.g. staging)
// it does nothing.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import crypto from "node:crypto";
import { buildRoundEmail } from "@/lib/round-email";
import { gameContextFor, unsubscribeToken } from "@/lib/round-email-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const secret = process.env.PUSH_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-webhook-secret") !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!user || !pass || !url || !serviceKey) return NextResponse.json({ ok: true, skipped: "email not configured here" });
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const appUrl = new URL(req.url).origin;

  const { data: due, error } = await db.rpc("due_round_emails", { p_limit: 20 });
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  if (!due?.length) return NextResponse.json({ ok: true, sent: 0 });
  const mail = nodemailer.createTransport({ service: "gmail", auth: { user, pass: pass.replace(/\s+/g, "") } });
  let sent = 0, unchanged = 0, failed = 0;

  for (const d of due as { round_id: string; user_id: string; email: string; display_name: string | null; game_id: string | null; last_fingerprint: string | null; ever_sent: boolean }[]) {
    try {
      const [{ data: round }, { data: holes }] = await Promise.all([
        db.from("rounds").select("*").eq("id", d.round_id).maybeSingle(),
        db.from("holes").select("*").eq("round_id", d.round_id).order("hole_number"),
      ]);
      if (!round || !holes?.length) continue;
      let ctx = null as ReturnType<typeof gameContextFor>;
      let gameCode: string | null = null;
      if (d.game_id) {
        const [{ data: game }, { data: players }] = await Promise.all([
          db.from("games").select("*").eq("id", d.game_id).maybeSingle(),
          db.from("game_players").select("*").eq("game_id", d.game_id),
        ]);
        if (game && players) ctx = gameContextFor(game as any, players as any, d.user_id);
        gameCode = (game as any)?.code ?? null;
      }
      // The app opens a game by its 6-digit code (201.1 deep link); a solo round has no direct link — open the app.
      const recapUrl = gameCode && /^\d{6}$/.test(gameCode) ? `${appUrl}/?game=${gameCode}` : `${appUrl}/`;
      const unsubscribeUrl = `${appUrl}/api/round-emails/unsubscribe?u=${d.user_id}&t=${unsubscribeToken(d.user_id)}`;
      const e = buildRoundEmail({ round: round as any, holes: holes as any, firstName: (d.display_name || "").split(" ")[0] || null,
        game: ctx?.context ?? null, groupHtml: ctx?.groupHtml ?? null, appUrl, recapUrl, unsubscribeUrl, isUpdate: d.ever_sent });
      const fp = crypto.createHash("sha256").update(e.fingerprint).digest("hex");
      if (d.ever_sent && fp === d.last_fingerprint) { unchanged++; await db.rpc("record_round_email", { p_round: d.round_id, p_user: d.user_id, p_fingerprint: fp, p_kind: "update", p_status: "sent", p_error: "unchanged — not resent" }); continue; }
      await mail.sendMail({ from: `Birdie Num Num <${user}>`, to: d.email, subject: e.subject, html: e.html, text: e.text,
        headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` } });
      await db.rpc("record_round_email", { p_round: d.round_id, p_user: d.user_id, p_fingerprint: fp, p_kind: d.ever_sent ? "update" : "summary", p_status: "sent" });
      sent++;
    } catch (err) {
      failed++;
      await db.rpc("record_round_email", { p_round: d.round_id, p_user: d.user_id, p_fingerprint: null, p_kind: d.ever_sent ? "update" : "summary", p_status: "failed", p_error: err instanceof Error ? err.message : String(err) });
    }
  }
  return NextResponse.json({ ok: true, sent, unchanged, failed });
}
