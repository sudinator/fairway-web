"use client";
// Season Wrapped in the app (205.0). Computed on open from the rounds the Dashboard already loaded
// (prepared, cancelled excluded) plus the golfer's ended games and the club aggregates — one
// definition, so the summary can never disagree with the Dashboard. Entry points: a Dashboard card
// (Dec 31 – Jan 31, until the account opens it), a row per finished season in Rounds, the Dec 31 notification (/?wrapped=YYYY),
// and on staging a permanent preview.
import { loadReportNames, reportPlayerNames } from "@/lib/report-names";
import { loadTeamRounds } from "@/lib/team-rounds";
import { fetchAllIn } from "@/lib/fetch-all";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { C, type Round } from "@/lib/golf";
import { btn, BottomSheet } from "@/components/ui";
import { createClient } from "@/lib/supabase";
import { buildSeasonSummary, type SeasonSummary } from "@/lib/season-summary";
import { fetchTestClubIds, withoutTestClubs } from "@/lib/test-clubs";
import { seasonMatches, wrappedYearOn, lookbackYears, type SeasonGame } from "@/lib/season-matches";
import { SeasonStory } from "@/components/season-story";
import { SeasonShareCard } from "@/components/season-share-card";
import { useCardExport } from "@/components/share-card";
import { isStagingClient } from "@/lib/auto-score";

/** Mark a season's summary opened for the signed-in account (0181). Awaited by callers. */
export async function markSeasonSeen(year: number): Promise<{ error: unknown }> {
  try { const { error } = await createClient().rpc("mark_season_wrapped_seen", { p_year: year }); return { error }; }
  catch (error) { return { error }; }
}

async function loadSeason(year: number, rounds: Round[], userId: string, name: string): Promise<SeasonSummary> {
  const supabase = createClient();
  const keptGameIds = new Set(rounds.filter((r) => (r.played_at || "").startsWith(String(year)) && (r as any).game_id).map((r) => (r as any).game_id as string));
  let games: SeasonGame[] = [];
  if (keptGameIds.size) {
    const ids = Array.from(keptGameIds);
    // 210.4: every row, paged and in id batches — a season's games and players outgrow one request.
    let gs: any[] = [], gp: any[] = [];
    try {
      const gamesRead = fetchAllIn<any>(supabase, "games", "id", ids), playersRead = fetchAllIn<any>(supabase, "game_players", "game_id", ids);
      gs = await gamesRead; gp = await playersRead;
    } catch { gs = []; gp = []; }
    const testClubs = await fetchTestClubIds(supabase);   // 212.70: test clubs' games don't exist for stats
    games = withoutTestClubs(gs.filter((g: any) => g.status === "ended"), testClubs).map((g: any) => ({ ...g, players: gp.filter((p: any) => p.game_id === g.id) }));
  }
  const names = await loadReportNames(supabase, [userId, ...games.flatMap((g) => g.players.flatMap((p) => p.user_id ? [p.user_id] : []))]);
  games = games.map((g) => ({ ...g, players: reportPlayerNames(g.players, names) }));
  const { matches, playedWith } = seasonMatches(games, userId);
  let clubs: { name: string; totalRounds: number; members: number; myRounds: number; myRank: number | null }[] = [];
  try {
    const { data } = await supabase.rpc("season_club_stats", { p_year: year });
    clubs = ((data || []) as any[]).map((c) => {
      const list = (c.rounds_by_member || []) as { user_id: string; rounds: number }[];
      const mine = list.find((m) => m.user_id === userId)?.rounds ?? 0;
      return { name: c.name, totalRounds: c.total_rounds, members: c.members, myRounds: mine, myRank: mine > 0 ? 1 + list.filter((m) => m.rounds > mine).length : null };
    });
  } catch { /* the club card is optional */ }
  const playedWithMost = playedWith[0] ? { name: playedWith[0].name, rounds: playedWith[0].games } : null;
  // 212.7: scramble / alternate-shot rounds count as played (lib/team-rounds)
  let teamRounds: { date: string; course: string; holes: number }[] = [];
  try { teamRounds = await loadTeamRounds(supabase, userId); } catch { /* optional — the season still builds */ }
  return buildSeasonSummary({ year, name: names[userId] ?? name, rounds, matches, clubs, playedWithMost, teamRounds });
}

export function SeasonWrappedModal({ year, rounds, userId, name, onClose }: { year: number; rounds: Round[]; userId: string; name: string; onClose: () => void }) {
  const [summary, setSummary] = useState<SeasonSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"story" | "all">("story");
  const shareRef = useRef<HTMLDivElement>(null);
  useEffect(() => { let live = true; loadSeason(year, rounds, userId, name).then((s) => live && setSummary(s), (e) => live && setErr(e?.message || "Couldn't load your season.")); return () => { live = false; }; }, [year, rounds, userId, name]);
  const { busy, msg, shareImage } = useCardExport(shareRef, `season-${year}`, `${name} — ${year} season`, () => "");
  const actions = (
    <div style={{ display: "flex", gap: 8, padding: 12, background: C.green, flexShrink: 0 }}>
      <button style={{ ...btn(true), flex: 1, fontSize: 13 }} disabled={busy || !summary} onClick={shareImage}>{busy ? "Preparing…" : "📤 Share my season"}</button>
      <button style={{ ...btn(false), flex: 1, fontSize: 13 }} disabled={!summary} onClick={() => setMode(mode === "story" ? "all" : "story")}>{mode === "story" ? "See it all" : "Play it again"}</button>
    </div>
  );
  // Shared overlay (DISPLAY_RULES Part 9): BottomSheet owns the safe-area perimeter, the corner close
  // and the backdrop policy. margin 0 makes it the full screen above the nav bar.
  return (
    <BottomSheet onClose={onClose} margin={0} maxWidth={560} dismissOnBackdrop={false}
      panelStyle={{ background: C.green, flex: "1 1 auto", height: "100%" }}
      bodyStyle={{ padding: 0, display: "flex", flexDirection: "column", overflowY: mode === "all" ? "auto" : "hidden" }}>
      <div data-season-wrapped style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {!summary && !err && <div style={{ color: C.sage, textAlign: "center", marginTop: "30vh" }}>Putting your season together…</div>}
        {err && <div style={{ color: C.gold, textAlign: "center", marginTop: "30vh", padding: 16 }}>{err}</div>}
        {summary && mode === "story" && <div style={{ flex: 1, minHeight: 0 }}><SeasonStory summary={summary} /></div>}
        {summary && mode === "all" && <div style={{ padding: 16, paddingTop: 44 }}><SeasonStory summary={summary} autoplay={false} /></div>}
        {msg && <div style={{ textAlign: "center", color: C.sage, fontSize: 12, padding: 4 }}>{msg}</div>}
        {summary && actions}
      </div>
      {/* The share card, rendered off to the side and exported as the image. */}
      {summary && <div aria-hidden style={{ position: "absolute", left: -10000, top: 0, width: 402 }}><div ref={shareRef}><SeasonShareCard summary={summary} /></div></div>}
    </BottomSheet>
  );
}

/** Dashboard card (Dec 31 – Jan 31; always on staging) and Rounds rows (every finished season). */
export function SeasonWrappedEntry({ rounds, userId, name, variant, openYear, onOpened, seenYears = [] }: {
  rounds: Round[]; userId: string; name: string; variant: "dashboard" | "rounds"; openYear?: number | null; onOpened?: () => void;
  /** Years whose summary this ACCOUNT has opened (profiles.season_wrapped_seen): the banner hides. */
  seenYears?: number[];
}) {
  const [open, setOpenRaw] = useState<number | null>(null);
  const [seenNow, setSeenNow] = useState<number[]>([]);
  // Opening a summary marks it seen for the account (every device); it then lives under Rounds.
  const setOpen = (y: number | null) => {
    setOpenRaw(y);
    if (y != null && !seenYears.includes(y) && !seenNow.includes(y)) void markSeen(y);
  };
  // A Supabase request builder is LAZY: it only runs when awaited. The 205.2 code discarded it with
  // `void`, so no request was ever sent and the banner came back (review finding 7, 205.4). Await it,
  // and record "seen" locally only once the server has it, so another device agrees.
  const markSeen = async (y: number) => {
    const { error } = await markSeasonSeen(y);
    if (!error) setSeenNow((s) => (s.includes(y) ? s : [...s, y]));
  };
  useEffect(() => { if (openYear) { setOpen(openYear); onOpened?.(); } }, [openYear, onOpened]);
  const now = useMemo(() => new Date(), []);
  const staging = isStagingClient();
  const live = wrappedYearOn(now);
  const years = lookbackYears(rounds.map((r) => r.played_at), now);
  const previewYear = staging && live == null ? now.getFullYear() : null;
  const modal = open != null ? <SeasonWrappedModal year={open} rounds={rounds} userId={userId} name={name} onClose={() => setOpen(null)} /> : null;
  if (variant === "dashboard") {
    const y = live ?? previewYear;
    if (y == null || !rounds.some((r) => (r.played_at || "").startsWith(String(y)))) return modal;
    if (previewYear == null && (seenYears.includes(y) || seenNow.includes(y))) return modal; // opened: lives under Rounds
    return (
      <>
        <button type="button" data-season-entry onClick={() => setOpen(y)} style={{ ...btn(true), width: "100%", marginTop: 12, padding: "13px 16px", fontSize: 15, textAlign: "left", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>🏌️</span>
          <span style={{ flex: 1 }}>Your {y} season summary is ready{previewYear != null ? " (staging preview)" : ""}</span>
          <span>▶</span>
        </button>
        {modal}
      </>
    );
  }
  const list = previewYear != null && !years.includes(previewYear) ? [previewYear, ...years] : years;
  if (!list.length) return modal;
  return (
    <>
      <div style={{ marginTop: 12 }}>
        {list.map((y) => (
          <button key={y} type="button" data-season-row={y} onClick={() => setOpen(y)} style={{ ...btn(false), width: "100%", marginBottom: 8, padding: "11px 20px", fontSize: 14, textAlign: "left", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ flex: 1 }}>⛳ {y} season summary{y === previewYear ? " (staging preview)" : ""}</span><span style={{ color: C.sage }}>▶</span>
          </button>
        ))}
      </div>
      {modal}
    </>
  );
}
