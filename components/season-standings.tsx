"use client";
/**
 * Season standings — the club's order of merit (owner, Nov 17–18, 2026). TWO TABS: Club games (lib/season-standings — ended
 * own-ball games) and Rounds (lib/season-rounds — every round logged this year by members who share them; the switch is in
 * Profile). One table per tab, sortable by the pills; the TOP 5 shown with the viewer's row if outside; "Show all" opens
 * the rest; an unranked member's figure shows in sage (no place) so a 4-game, 4-win season is still visible; a tapped row
 * shows every number. Nothing index- or personal-round-based on the games tab; the rounds tab says who it covers.
 */
import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { fetchAll, fetchAllIn } from "@/lib/fetch-all";
import { C } from "@/lib/golf";
import { Eyebrow, Avatar, btn, Segmented } from "@/components/ui";
import { seasonStandings, rankBy, METRICS, STANDINGS_MIN_GAMES, type StandingRow, type StandingsMetric, type ContestWin } from "@/lib/season-standings";
import { roundsStandings, rankRounds, ROUNDS_METRICS, ROUNDS_MIN, type RoundsStandingRow, type RoundsMetric, type RoundRow, type HoleRow } from "@/lib/season-rounds";
import { contestLeaderboard, type Contest, type ContestEntry } from "@/lib/contests";
import type { Game, Player } from "@/lib/game-types";

type Tab = "games" | "rounds";
export type Preloaded = { games?: { rows: StandingRow[]; games: number }; rounds?: { rows: RoundsStandingRow[] } };

export function SeasonStandings({ groupId, userId, year = new Date().getFullYear(), preloaded }: { groupId: string; userId: string; year?: number; preloaded?: Preloaded }) {
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<Tab>("games");
  const [games, setGames] = useState<{ rows: StandingRow[]; games: number } | null>(preloaded?.games ?? null);
  const [rounds, setRounds] = useState<{ rows: RoundsStandingRow[] } | null>(preloaded?.rounds ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [gMetric, setGMetric] = useState<StandingsMetric>("wins");
  const [rMetric, setRMetric] = useState<RoundsMetric>("avgNet");
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    if (preloaded?.games) return;
    let live = true;
    (async () => {
      try {
        const gs = await fetchAll<Game>((from, to) => supabase.from("games").select("*").eq("group_id", groupId).eq("status", "ended")
          .gte("played_at", `${year}-01-01`).lte("played_at", `${year}-12-31`).order("played_at", { ascending: false }).range(from, to));
        const ids = gs.map((g) => g.id);
        const players = ids.length ? await fetchAllIn<Player>(supabase, "game_players", "game_id", ids) : [];
        const byGame: Record<string, Player[]> = {}; players.forEach((p) => { (byGame[p.game_id] ||= []).push(p); });
        const contests = ids.length ? await fetchAllIn<Contest>(supabase, "game_contests", "game_id", ids) : [];
        const entries = contests.length ? await fetchAllIn<ContestEntry>(supabase, "game_contest_entries", "contest_id", contests.map((c) => c.id)) : [];
        const wins: ContestWin[] = [];
        contests.forEach((c) => contestLeaderboard(c, entries.filter((e) => e.contest_id === c.id && !e.voided)).forEach((w) => { if (w.best) wins.push({ gameId: c.game_id, userId: w.best.player_id, name: w.best.player_name }); }));
        if (live) setGames({ rows: seasonStandings(gs, byGame, wins), games: gs.filter((g) => ["stableford", "stroke", "fourball", "trifecta"].includes(g.game_type)).length });
      } catch (e) { if (live) setErr(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { live = false; };
  }, [groupId, year, preloaded, supabase]);
  useEffect(() => {
    if (tab !== "rounds" || rounds || preloaded?.rounds) return;
    let live = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("club_round_standings_data", { p_group: groupId, p_year: year });
        if (error) throw error;
        const d = (data ?? { rounds: [], holes: [] }) as { rounds: RoundRow[]; holes: HoleRow[] };
        if (live) setRounds({ rows: roundsStandings(d.rounds ?? [], d.holes ?? []) });
      } catch (e) { if (live) setErr(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { live = false; };
  }, [tab, rounds, preloaded, groupId, year, supabase]);

  // 212.119: the CLUB TAB's compact idiom (components/club-engagement), not the leaderboard's — 13px rows, sans 14px/700
  // numerals with 11px captions, Eyebrow headings. The owner saw the two tables side by side: "completely lost the consistency".
  const tabStyle = (on: boolean): React.CSSProperties => ({ background: "none", border: "none", borderBottom: `2px solid ${on ? C.gold : "transparent"}`, color: on ? C.gold : C.sage, padding: "4px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", marginBottom: -1 });

  // one shape for both tabs
  type Line = { id: string; name: string; avatarUrl: string | null; count: number; value: string; place: number | null; detail: [string, string][] };
  const lines: Line[] = tab === "games"
    ? (games ? rankBy(games.rows, gMetric).map(({ row: r, place }) => ({ id: r.userId, name: r.name, avatarUrl: r.avatarUrl, count: r.games, value: METRICS.find((m) => m.key === gMetric)!.show(r), place,
        detail: [...METRICS.map((m) => [m.label, m.show(r)] as [string, string]), ["Best net", r.bestNet == null ? "—" : String(r.bestNet)], ["Net eagles", String(r.eagles)], ["Standout rounds", String(r.standouts)]] })) : [])
    : (rounds ? rankRounds(rounds.rows, rMetric).map(({ row: r, place }) => ({ id: r.userId, name: r.name, avatarUrl: r.avatarUrl, count: r.rounds, value: ROUNDS_METRICS.find((m) => m.key === rMetric)!.show(r), place,
        detail: [...ROUNDS_METRICS.map((m) => [m.label, m.show(r)] as [string, string]), ["Net eagles", String(r.eagles)]] })) : []);
  const unit = tab === "games" ? "game" : "round";
  const ranked = lines.filter((l) => l.place != null), rest = lines.filter((l) => l.place == null);
  const top = ranked.slice(0, 5);
  const shown = showAll ? lines : top.concat(top.some((l) => l.id === userId) ? [] : lines.filter((l) => l.id === userId));
  const hiddenCount = lines.length - shown.length;
  const loading = tab === "games" ? !games : !rounds;
  const metrics = tab === "games" ? METRICS.map((m) => ({ key: m.key as string, label: m.label })) : ROUNDS_METRICS.map((m) => ({ key: m.key as string, label: m.label }));
  const metric = tab === "games" ? gMetric : rMetric;
  const setMetric = (k: string) => { if (tab === "games") setGMetric(k as StandingsMetric); else setRMetric(k as RoundsMetric); };

  return (
    <div data-season-standings style={{ background: C.greenLight, borderRadius: 14, padding: 18, marginTop: 14, color: C.cream }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <Eyebrow style={{ marginTop: 0 }}>SEASON STANDINGS · {year}</Eyebrow>
        <span style={{ color: C.sage, fontSize: 11, whiteSpace: "nowrap" }}>{tab === "games" ? (games ? `${games.games} game${games.games === 1 ? "" : "s"}` : "") : "members who share their rounds"}</span>
      </div>
      <div role="tablist" aria-label="Standings" style={{ display: "flex", marginTop: 12, borderBottom: `1px solid ${C.borderGreen}` }}>
        {(["games", "rounds"] as Tab[]).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} data-standings-tab={t} onClick={() => { setTab(t); setOpen(null); setShowAll(false); }} style={tabStyle(tab === t)}>{t === "games" ? "Club games" : "Rounds"}</button>)}
      </div>
      {err ? <div style={{ color: C.gold, fontSize: 12, marginTop: 8 }}>Couldn’t load the standings: {err}</div> : loading ? <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>Loading…</div> : !lines.length ? (
        <div style={{ color: C.sage, fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>{tab === "games" ? "No ended Stableford, stroke play, best-ball or trifecta games this year yet." : "No 18-hole rounds logged this year by members who share them."}</div>
      ) : (
        <>
          <div style={{ marginTop: 10 }}>
            <Segmented ariaLabel="Sort standings" onCard attr="data-standings-sort" value={metric} onChange={setMetric} options={metrics.map((x) => ({ key: x.key, label: x.label }))} />
          </div>
          <div style={{ marginTop: 10 }}>
            {shown.map((l) => {
              const you = l.id === userId, isOpen = open === l.id;
              return (
                <div key={l.id} data-standings-row={l.id} data-place={l.place ?? ""}>
                  <button type="button" onClick={() => setOpen(isOpen ? null : l.id)} aria-expanded={isOpen}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", paddingTop: 8, paddingBottom: 8, background: you ? "rgba(201,162,39,0.08)" : "none", border: "none", borderTop: `1px solid ${C.green}`, borderRadius: 6, color: C.cream, textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>
                    <span style={{ color: l.place ? C.gold : C.sage, fontWeight: 700, width: 18, fontSize: 13, flexShrink: 0 }}>{l.place ?? "·"}</span>
                    <Avatar src={l.avatarUrl} name={l.name} size={28} enlargeable={false} />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: you ? 800 : 700 }}>{l.name}{you ? " (you)" : ""}</span>
                    <span style={{ color: C.sage, fontSize: 11, width: 52, textAlign: "right", flexShrink: 0 }}>{l.count} {unit}{l.count === 1 ? "" : "s"}</span>
                    <span data-standings-value style={{ fontWeight: 700, fontSize: 14, color: l.place ? C.cream : C.sage, minWidth: 40, textAlign: "right", flexShrink: 0 }}>{l.value}</span>
                  </button>
                  {isOpen ? (
                    <div data-standings-detail style={{ background: C.greenMid, borderRadius: 10, padding: "8px 12px", marginBottom: 6, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                      {l.detail.map(([k, v]) => <div key={k}><div style={{ color: C.sage, fontSize: 11 }}>{k}</div><div style={{ fontWeight: 700, fontSize: 14 }}>{v}</div></div>)}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {hiddenCount > 0 || showAll ? (
            <button type="button" data-standings-more onClick={() => setShowAll((v) => !v)} style={{ ...btn(false), width: "100%", marginTop: 8, fontSize: 12 }}>
              {showAll ? "Show the top 5 only" : `Show all ${lines.length} (${rest.length} with fewer than ${tab === "games" ? STANDINGS_MIN_GAMES : ROUNDS_MIN} ${unit}s)`}
            </button>
          ) : null}
          <div style={{ color: C.sage, fontSize: 11, lineHeight: 1.5, marginTop: 10 }}>
            {tab === "games"
              ? `Ended club games this year — Stableford, stroke play, best ball and trifecta. A win is a first place or a won match. At least ${STANDINGS_MIN_GAMES} games to be ranked; ties share the place. Tap a name for every number.`
              : `Every 18-hole round logged in BNN this year by members who share them (change in Profile). Scoring averages are to par. At least ${ROUNDS_MIN} rounds to be ranked; ties share the place. Members log unevenly — the count is on every row.`}
          </div>
        </>
      )}
    </div>
  );
}
