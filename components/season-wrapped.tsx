"use client";
// Season Wrapped in the app (205.0). Computed on open from the rounds the Dashboard already loaded
// (prepared, cancelled excluded) plus the golfer's ended games and the club aggregates — one
// definition, so the summary can never disagree with the Dashboard. Entry points: a Dashboard card
// (Dec 31 – Jan 31), a row per finished season in Rounds, the Dec 31 notification (/?wrapped=YYYY),
// and on staging a permanent preview.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { C, type Round } from "@/lib/golf";
import { btn, BottomSheet } from "@/components/ui";
import { createClient } from "@/lib/supabase";
import { buildSeasonSummary, type SeasonSummary } from "@/lib/season-summary";
import { seasonMatches, wrappedYearOn, lookbackYears, type SeasonGame } from "@/lib/season-matches";
import { SeasonStory } from "@/components/season-story";
import { SeasonShareCard } from "@/components/season-share-card";
import { useCardExport } from "@/components/share-card";
import { isStagingClient } from "@/lib/auto-score";

async function loadSeason(year: number, rounds: Round[], userId: string, name: string): Promise<SeasonSummary> {
  const supabase = createClient();
  const keptGameIds = new Set(rounds.filter((r) => (r.played_at || "").startsWith(String(year)) && (r as any).game_id).map((r) => (r as any).game_id as string));
  let games: SeasonGame[] = [];
  if (keptGameIds.size) {
    const ids = Array.from(keptGameIds);
    const { data: gs } = await supabase.from("games").select("id, game_type, played_at, allowance_pct, course_par, team_score_mode, holes_meta, pairings, foursomes, status").in("id", ids).eq("status", "ended");
    const { data: gp } = await supabase.from("game_players").select("game_id, user_id, display_name, scores, course_handicap, handicap_index, slope, rating, course_handicap_source").in("game_id", ids);
    games = (gs || []).map((g: any) => ({ ...g, players: (gp || []).filter((p: any) => p.game_id === g.id) }));
  }
  const { matches, playedWith } = seasonMatches(games, userId);
  let club: any = null;
  try {
    const { data } = await supabase.rpc("season_club_stats", { p_year: year });
    const clubs = (data || []) as any[];
    // The club the golfer played most rounds in counts as "your club".
    const mine = clubs.map((c) => ({ c, mineN: (c.rounds_by_member || []).find((m: any) => m.user_id === userId)?.rounds ?? 0 })).sort((a, b) => b.mineN - a.mineN || b.c.total_rounds - a.c.total_rounds)[0];
    if (mine && mine.c.total_rounds > 0) {
      const list = (mine.c.rounds_by_member || []) as { user_id: string; rounds: number }[];
      const rank = 1 + list.filter((m) => m.rounds > mine.mineN).length;
      club = { name: mine.c.name, totalRounds: mine.c.total_rounds, members: mine.c.members,
        myRank: mine.mineN > 0 ? [{ metric: "rounds played", rank, of: mine.c.members }] : [],
        playedWithMost: playedWith[0] ? { name: playedWith[0].name, rounds: playedWith[0].games } : null };
    }
  } catch { /* club card is optional */ }
  return buildSeasonSummary({ year, name, rounds, matches, club });
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
export function SeasonWrappedEntry({ rounds, userId, name, variant, openYear, onOpened }: {
  rounds: Round[]; userId: string; name: string; variant: "dashboard" | "rounds"; openYear?: number | null; onOpened?: () => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
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
    return (
      <>
        <button type="button" data-season-entry onClick={() => setOpen(y)} style={{ ...btn(true), width: "100%", marginTop: 12, padding: "13px 16px", fontSize: 15, textAlign: "left", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>🏌️</span>
          <span style={{ flex: 1 }}>Your {y} season is ready{previewYear != null ? " (staging preview)" : ""}</span>
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
            <span style={{ flex: 1 }}>⛳ {y} season{y === previewYear ? " (staging preview)" : ""}</span><span style={{ color: C.sage }}>▶</span>
          </button>
        ))}
      </div>
      {modal}
    </>
  );
}
