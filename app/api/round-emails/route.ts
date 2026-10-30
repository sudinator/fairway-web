// POST /api/round-emails — called every 10 minutes by a Supabase Database Webhook on email_ticks (209.3).
// Sends the round-summary email for rounds that are due (due_round_emails: an hour after the round, within a
// week, members who receive them — the owner only until opened to everyone). Unchanged rounds are never sent
// twice; a changed one goes out as "Updated:". Every attempt is logged. Without the Gmail keys (e.g. staging)
// it does nothing.
import { fetchAll } from "@/lib/fetch-all";
import { teamRoundEmail } from "@/lib/team-round-email";
import { buildRecap } from "@/lib/game-recap";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import crypto from "node:crypto";
import { buildRoundEmail } from "@/lib/round-email";
import { loadContestLines } from "@/lib/contests";
import { newBestsForGame } from "@/lib/personal-bests-load";
import { gameContextFor, unsubscribeToken } from "@/lib/round-email-server";
import { loadCupForGame } from "@/lib/cup-load";
import { buildClubReport, type ClubReport } from "@/lib/club-report";
import { loadClubGames } from "@/lib/club-report-load";
import { clubReportEmail } from "@/lib/club-report-email";
import { cupStandingAfter } from "@/lib/cup-standing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const secret = process.env.PUSH_WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-webhook-secret") !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: true, skipped: "server not configured here" });
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const appUrl = new URL(req.url).origin;

  // 210.1: club reports are BUILT and published (club page + push) whether or not email is configured here.
  const reports = await publishClubReports(db);
  if (!user || !pass) return NextResponse.json({ ok: true, reports, skipped: "email not configured here" });
  const mail = nodemailer.createTransport({ service: "gmail", auth: { user, pass: pass.replace(/\s+/g, "") } });
  const clubEmails = await sendClubReportEmails(db, mail, user, appUrl);
  // 212.7: team rounds (scramble / alternate shot) — the game's recap, since no personal round exists
  const teamEmails = await sendTeamRoundEmails(db, mail, user, appUrl);

  // bounded: function returns at most p_limit (20)
  const { data: due, error } = await db.rpc("due_round_emails", { p_limit: 20 });
  if (error) return NextResponse.json({ error: error.message, reports, clubEmails, teamEmails }, { status: 502 });
  if (!due?.length) return NextResponse.json({ ok: true, sent: 0, reports, clubEmails, teamEmails });
  let sent = 0, unchanged = 0, failed = 0;

  for (const d of due as { round_id: string; user_id: string; email: string; display_name: string | null; game_id: string | null; last_fingerprint: string | null; ever_sent: boolean }[]) {
    try {
      const [{ data: round, error: rErr }, { data: holes, error: hErr }] = await Promise.all([
        db.from("rounds").select("*").eq("id", d.round_id).maybeSingle(),
        // bounded: one round's holes (18 at most)
        db.from("holes").select("*").eq("round_id", d.round_id).order("hole_number"),
      ]);
      // 210.7 (review point 5): nothing disappears silently. A failed read is a FAILURE (retried later); a round
      // that can't be summarised is SKIPPED with its reason and never picked again.
      if (rErr || hErr) throw new Error(`couldn't read the round: ${(rErr || hErr)!.message}`);
      if (!round || !holes?.length) {
        await db.rpc("record_round_email", { p_round: d.round_id, p_user: d.user_id, p_fingerprint: null, p_kind: d.ever_sent ? "update" : "summary",
          p_status: "skipped", p_error: !round ? "the round no longer exists" : "no hole-by-hole scores to summarise" });
        continue;
      }
      let ctx = null as ReturnType<typeof gameContextFor>;
      let gameCode: string | null = null;
      if (d.game_id) {
        const [{ data: game }, { data: players }] = await Promise.all([
          db.from("games").select("*").eq("id", d.game_id).maybeSingle(),
          // bounded: one game's players
          db.from("game_players").select("*").eq("game_id", d.game_id),
        ]);
        // 209.5: a Cup session's email carries the Cup's standing (shared loader + lib/cup-standing).
        const cupData = game ? await loadCupForGame(db, d.game_id) : null;
        const cup = cupData ? cupStandingAfter(cupData.competition, cupData.sessions, d.game_id) : null;
        const contests = game ? await loadContestLines(db, d.game_id) : [];   // 212.71: the side contests join the email
        const newBests = game ? await newBestsForGame(db, d.user_id, d.game_id).catch(() => []) : [];   // the recipient's own new personal bests
        const ppm = cupData?.sessions.find((x) => x.game_id === d.game_id)?.points_per_match;   // 212.76: the session's points per match
        if (game && players) ctx = gameContextFor(game as any, players as any, d.user_id, cup, contests, newBests, ppm != null ? Number(ppm) || 1 : undefined);
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
  return NextResponse.json({ ok: true, sent, unchanged, failed, reports, clubEmails, teamEmails });
}

/** Build and publish queued club reports (snapshot = the report as published; members are notified once). */
async function publishClubReports(db: SupabaseClient): Promise<number> {
  const { data: pending } = await db.from("club_reports").select("id, group_id, period_key, period_label, period_from, period_to").is("snapshot", null).limit(5);
  let n = 0;
  for (const r of (pending || []) as { id: string; group_id: string; period_key: string; period_label: string; period_from: string; period_to: string }[]) {
    try {
      const { data: g } = await db.from("groups").select("name").eq("id", r.group_id).maybeSingle();
      const period = { key: r.period_key, label: r.period_label, from: r.period_from, to: r.period_to };
      const report = buildClubReport(g?.name || "Your club", period, await loadClubGames(db, r.group_id, period));
      const { error } = await db.rpc("save_club_report", { p_report: r.id, p_snapshot: report });
      if (!error) n++;
    } catch { /* retried on the next tick */ }
  }
  return n;
}

/** Email published club reports to whoever receives them (the owner only while it's honed). */
async function sendClubReportEmails(db: SupabaseClient, mail: ReturnType<typeof nodemailer.createTransport>, from: string, appUrl: string): Promise<{ sent: number; failed: number }> {
  // bounded: function returns at most p_limit (20)
  const { data: due } = await db.rpc("due_club_report_emails", { p_limit: 20 });
  let sent = 0, failed = 0;
  for (const d of (due || []) as { report_id: string; user_id: string; email: string }[]) {
    try {
      const { data: r } = await db.from("club_reports").select("snapshot").eq("id", d.report_id).maybeSingle();
      if (!r?.snapshot) continue;
      const unsubscribeUrl = `${appUrl}/api/round-emails/unsubscribe?k=club&u=${d.user_id}&t=${unsubscribeToken(d.user_id, "club")}`;
      const e = clubReportEmail(r.snapshot as ClubReport, { appUrl: `${appUrl}/`, unsubscribeUrl });
      await mail.sendMail({ from: `Birdie Num Num <${from}>`, to: d.email, subject: e.subject, html: e.html, text: e.text, headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` } });
      await db.rpc("record_club_report_email", { p_report: d.report_id, p_user: d.user_id, p_status: "sent" });
      sent++;
    } catch (err) {
      failed++;
      await db.rpc("record_club_report_email", { p_report: d.report_id, p_user: d.user_id, p_status: "failed", p_error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { sent, failed };
}

/** 212.7: the recap email for team rounds that are due (due_team_round_emails — the round email's rules). */
async function sendTeamRoundEmails(db: SupabaseClient, mail: ReturnType<typeof nodemailer.createTransport>, from: string, appUrl: string): Promise<{ sent: number; skipped: number; failed: number }> {
  let sent = 0, skipped = 0, failed = 0;
  // bounded: function returns at most p_limit (20)
  const { data: due } = await db.rpc("due_team_round_emails", { p_limit: 20 });
  for (const d of (due || []) as { game_id: string; user_id: string; email: string; display_name: string | null }[]) {
    try {
      const [{ data: game }, players, rows] = await Promise.all([
        db.from("games").select("*").eq("id", d.game_id).maybeSingle(),
        fetchAll<any>((f, t) => db.from("game_players").select("*").eq("game_id", d.game_id).order("id").range(f, t)),
        fetchAll<any>((f, t) => db.from("game_alt_shot_scores").select("*").eq("game_id", d.game_id).order("hole_index").range(f, t)),
      ]);
      if (!game) { skipped++; await db.rpc("record_team_round_email", { p_game: d.game_id, p_user: d.user_id, p_status: "skipped", p_error: "game not found" }); continue; }
      const recap = buildRecap(game as any, players as any, rows as any);
      const me = (players as any[]).find((p) => p.user_id === d.user_id);
      const unsubscribeUrl = `${appUrl}/api/round-emails/unsubscribe?u=${d.user_id}&t=${unsubscribeToken(d.user_id)}`;
      const e = teamRoundEmail({ format: (game as any).game_type, course: (game as any).course || "", recap, personalLine: me ? recap.personal[me.user_id ?? me.id] ?? null : null,
        firstName: (d.display_name || "").split(" ")[0] || null, gameUrl: `${appUrl}/?tab=games&game=${(game as any).code}`, unsubscribeUrl });   // the game's 6-digit code (lib/app-links)
      await mail.sendMail({ from: `Birdie Num Num <${from}>`, to: d.email, subject: e.subject, html: e.html, text: e.text, headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` } });
      await db.rpc("record_team_round_email", { p_game: d.game_id, p_user: d.user_id, p_status: "sent" });
      sent++;
    } catch (err) {
      failed++;
      await db.rpc("record_team_round_email", { p_game: d.game_id, p_user: d.user_id, p_status: "failed", p_error: String((err as Error)?.message || err).slice(0, 300) });
    }
  }
  return { sent, skipped, failed };
}
