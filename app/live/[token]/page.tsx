"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { Avatar } from "@/components/ui";
import {
  C, allocateStrokes, applyAllowance, stablefordPts,
  matchStatus, fourballStatus, computeTrifecta, clinchState, computeSkins, toParStr,
  type FourballMember, type SkinPlayer,
} from "@/lib/golf";

export const dynamic = "force-dynamic";
const supabase = createClient();

type LiveMeta = { n: number; par: number; si: number | null };
type LivePlayer = {
  id: string; display_name: string; avatar_url?: string | null; course_handicap: number | null; ch: number;
  team: string | null; tee_group: number | null; no_show: boolean;
  scores: (number | null)[]; putts: (number | null)[]; fairways: ("hit" | "miss" | "left" | "right" | null)[];
  penalties: (number | null)[]; sand: (boolean | null)[];
};
type LiveGame = {
  name: string; course: string; course_par: number | null;
  game_type: "stableford" | "stroke" | "match" | "fourball" | "skins" | "trifecta";
  status: "active" | "ended"; allowance_pct: number | null;
  team_score_mode: "best_ball" | "aggregate" | null;
  trifecta_scoring: "per_hole" | "match" | null;
  stroke_basis: "gross" | "net" | null;
  teams: { key: string; name: string }[];
  holes_meta: LiveMeta[]; played_at: string | null; ended_at: string | null;
};
type LiveData = {
  game: LiveGame; players: LivePlayer[];
  pairings: { a: string | null; b: string | null }[];
  foursomes: { id: string; name: string; swap: boolean; a: (string | null)[]; b: (string | null)[] }[];
};

const TEAM_COLOR: Record<string, string> = {
  red: "#E0695B", blue: "#5AA9E6", green: "#5BD08A", black: "#9AA0A6", white: "#D9D4C7",
  yellow: "#E8C84A", gold: "#D8B24A", orange: "#E0915B", purple: "#B084E0", pink: "#E08AB8",
};
const teamColor = (name: string | null | undefined, i: number) =>
  TEAM_COLOR[(name || "").trim().toLowerCase()] || (i === 0 ? "#5AA9E6" : "#E0915B");
const fmtHalf = (n: number) => { const w = Math.floor(n + 1e-9); const half = (n - w) >= 0.5 - 1e-9; if (w === 0 && half) return "\u00bd"; return `${w}${half ? "\u00bd" : ""}`; };

type PStat = {
  gross: number; net: number; thru: number; toPar: number; points: number;
  perHole: { n: number; par: number; gross: number | null; recv: number; pts: number | null }[];
  fairways: string | null; gir: string | null; putts: number | null; penalties: number | null;
};

function computePlayer(p: LivePlayer, meta: LiveMeta[], allowance: number): PStat {
  const playing = applyAllowance(p.ch, allowance);
  const alloc = allocateStrokes(meta.map((m) => ({ hole_number: m.n, stroke_index: m.si })), playing);
  let gross = 0, parPlayed = 0, thru = 0, points = 0, net = 0, putts = 0, pen = 0, fwHit = 0, fwTot = 0, fwLeft = 0, fwRight = 0, girHit = 0, girTot = 0;
  let puttsT = false, penT = false, fwT = false;
  const perHole = meta.map((m, i) => {
    const s = p.scores?.[i] ?? null; const recv = alloc[m.n] || 0;
    const pts = stablefordPts(s, m.par, recv);
    if (s != null && s > 0) {
      gross += s; parPlayed += m.par; thru++; points += pts || 0; net += s - recv;
      const pt = p.putts?.[i]; if (pt != null) { puttsT = true; putts += pt; girTot++; if ((s - pt) <= (m.par - 2)) girHit++; }
      const pe = p.penalties?.[i]; if (pe != null) { pen += pe || 0; if (pe > 0) penT = true; }
      const fw = p.fairways?.[i]; if (m.par >= 4 && fw != null) { fwT = true; fwTot++; if (fw === "hit") fwHit++; else if (fw === "left") fwLeft++; else if (fw === "right") fwRight++; }
    }
    return { n: m.n, par: m.par, gross: s, recv, pts: (s != null && s > 0) ? pts : null };
  });
  return {
    gross, net, thru, toPar: gross - parPlayed, points, perHole,
    fairways: fwT ? `${fwHit}/${fwTot}${fwLeft || fwRight ? ` · ${fwLeft}L ${fwRight}R` : ""}` : null, gir: (puttsT && girTot > 0) ? `${girHit}/${girTot}` : null,
    putts: puttsT ? putts : null, penalties: penT ? pen : null,
  };
}

function addPts(m: Record<string, number>, k: string | null | undefined, v: number) { if (k) m[k] = (m[k] || 0) + v; }

type TeamRows = { rows: { key: string; name: string; color: string; members: string[]; scoreNum: number; scoreLabel: string }[]; out: number; unclaimed: number; isSkins: boolean };

function teamScores(game: LiveGame, players: LivePlayer[], pairings: LiveData["pairings"], foursomes: LiveData["foursomes"], byId: Record<string, LivePlayer>, meta: LiveMeta[], allowance: number): TeamRows | null {
  const teams = (game.teams || []).filter((t) => t && t.key);
  const anyTeamed = players.some((p) => p.team);
  if (teams.length < 2 || !anyTeamed) return null;
  const pts: Record<string, number> = {}; teams.forEach((t) => { pts[t.key] = 0; });
  let out = 0;
  let unclaimed = 0;
  const teamOf = (id: string | null | undefined) => (id ? byId[id]?.team : null);
  const mkMembers = (ids: (string | null)[]): FourballMember[] =>
    ids.filter(Boolean).map((id) => { const q = byId[id as string]; return { id: id as string, gross: q?.scores || [], ch: q?.ch ?? null, noShow: !!q?.no_show }; });

  if (game.game_type === "match") {
    pairings.forEach((pr) => {
      const a = pr.a ? byId[pr.a] : null, b = pr.b ? byId[pr.b] : null; if (!a || !b) return;
      const st = matchStatus(meta, a.scores || [], b.scores || [], a.ch, b.ch, allowance);
      if (st.result !== "") { if (st.lead === 0) { addPts(pts, a.team, .5); addPts(pts, b.team, .5); } else if (st.lead > 0) addPts(pts, a.team, 1); else addPts(pts, b.team, 1); }
      else out++;
    });
  } else if (game.game_type === "fourball") {
    foursomes.forEach((f) => {
      const aIds = (f.a || []).filter(Boolean) as string[]; const bIds = (f.b || []).filter(Boolean) as string[];
      const st = fourballStatus(meta, mkMembers([...aIds, ...bIds]), aIds, bIds, allowance);
      const remaining = meta.length - st.thru; const decided = st.thru > 0 && (remaining === 0 || Math.abs(st.lead) > remaining);
      if (decided) { if (st.lead === 0) { addPts(pts, teamOf(aIds[0]), .5); addPts(pts, teamOf(bIds[0]), .5); } else if (st.lead > 0) addPts(pts, teamOf(aIds[0]), 1); else addPts(pts, teamOf(bIds[0]), 1); }
      else out++;
    });
  } else if (game.game_type === "trifecta") {
    foursomes.forEach((f) => {
      const aIds = (f.a || []).filter(Boolean) as string[]; const bIds = (f.b || []).filter(Boolean) as string[];
      const tri = computeTrifecta(meta, mkMembers([...aIds, ...bIds]), aIds, bIds, allowance, game.team_score_mode || "best_ball", !!f.swap, game.trifecta_scoring === "match" ? "match" : "per_hole");
      addPts(pts, teamOf(aIds[0]), tri.aPts); addPts(pts, teamOf(bIds[0]), tri.bPts);
      tri.contests.forEach((c) => {
        const aLive = c.aIds.some((id) => !players.find((p) => p.id === id)?.no_show);
        const bLive = c.bIds.some((id) => !players.find((p) => p.id === id)?.no_show);
        if (aLive && bLive) unclaimed += (game.trifecta_scoring === "match") ? (c.settled ? 0 : 1) : (meta.length - c.thru);
      });
    });
  } else if (game.game_type === "skins") {
    const sp: SkinPlayer[] = players.map((p) => ({ id: p.id, name: p.display_name, gross: p.scores || [], ch: p.ch }));
    const res = computeSkins(meta, sp, allowance);
    players.forEach((p) => { if (p.team) addPts(pts, p.team, res.skinsByPlayer[p.id] || 0); });
    unclaimed = meta.length - Object.values(res.skinsByPlayer).reduce((a, n) => a + (n as number), 0);
  } else {
    players.forEach((p) => { if (p.team) addPts(pts, p.team, computePlayer(p, meta, allowance).points); });
  }
  const isSkins = game.game_type === "skins";
  const rows = teams.map((t, i) => ({
    key: t.key, name: t.name, color: teamColor(t.name, i),
    members: players.filter((p) => p.team === t.key).map((p) => p.display_name),
    scoreNum: pts[t.key] || 0, scoreLabel: isSkins ? String(pts[t.key] || 0) : fmtHalf(pts[t.key] || 0),
  })).sort((x, y) => y.scoreNum - x.scoreNum);
  return { rows, out, unclaimed, isSkins };
}

function summaryText(game: LiveGame, teamRows?: TeamRows["rows"]): string {
  const a = game.allowance_pct ?? 100;
  const allow = a !== 100 ? ` Handicaps play at ${a}%.` : "";
  const named = teamRows && teamRows.length >= 2 ? `${teamRows.map((r) => r.name).join(" vs ")}` : null;
  switch (game.game_type) {
    case "stableford": return `Stableford — each hole scores points by net result vs par (par = 2 points, birdie = 3, bogey = 1, and so on). Most points wins.${allow}`;
    case "match": return named
      ? `Team match play — ${named}. Each pairing is its own match; winning earns a point for your team and a halved match is \u00bd each. Most team points wins.${allow}`
      : `Singles match play — win more holes than your opponent on net score. Each player's match status is shown below.${allow}`;
    case "fourball": return named
      ? `Four-ball — ${named}. Each foursome (2 v 2) is a match worth a point for the winning team, \u00bd for a halved match — Ryder-Cup style.${allow}`
      : `Four-ball match play — each 2-player side counts its better net ball on every hole; win more holes to win the match.${allow}`;
    case "trifecta": return `Trifecta${named ? ` — ${named}` : ""} — every 2-v-2 foursome plays three points a hole: two singles (each player vs an opponent) plus a team point (${game.team_score_mode === "aggregate" ? "both partners' nets added" : "the side's better net ball"}). Points roll up to the team total.${allow}`;
    case "stroke": return `Stroke play — lowest ${game.stroke_basis === "gross" ? "gross" : "net"} total over the round wins.${allow}`;
    case "skins": return `Skins — the lowest net score on a hole wins the skin; a tied hole carries the pot forward to the next.${allow}`;
    default: return "";
  }
}

function statusFor(p: LivePlayer, game: LiveGame, pairings: LiveData["pairings"], foursomes: LiveData["foursomes"], byId: Record<string, LivePlayer>, meta: LiveMeta[], allowance: number): string {
  if (game.game_type === "match") {
    const pr = pairings.find((x) => x.a === p.id || x.b === p.id); if (!pr) return "";
    const a = pr.a ? byId[pr.a] : null, b = pr.b ? byId[pr.b] : null; if (!a || !b) return "";
    const st = matchStatus(meta, a.scores || [], b.scores || [], a.ch, b.ch, allowance);
    if (st.thru === 0) return "not started";
    const lead = pr.a === p.id ? st.lead : -st.lead;
    if (st.result !== "") { if (st.lead === 0) return "halved"; return lead > 0 ? `won ${st.result}` : `lost ${st.result}`; }
    return lead > 0 ? `${lead} up` : lead < 0 ? `${-lead} dn` : "all square";
  }
  if (game.game_type === "fourball" || game.game_type === "trifecta") {
    const f = foursomes.find((x) => (x.a || []).includes(p.id) || (x.b || []).includes(p.id)); if (!f) return "";
    const aIds = (f.a || []).filter(Boolean) as string[]; const bIds = (f.b || []).filter(Boolean) as string[];
    const members = [...aIds, ...bIds].map((id) => { const q = byId[id]; return { id, gross: q?.scores || [], ch: q?.ch ?? null, noShow: !!q?.no_show }; });
    const st = fourballStatus(meta, members, aIds, bIds, allowance);
    if (st.thru === 0) return "not started";
    const lead = aIds.includes(p.id) ? st.lead : -st.lead;
    if (lead === 0) return "all square";
    return lead > 0 ? `team ${lead} up` : `team ${-lead} dn`;
  }
  return "";
}

export default function LiveScorecardPage({ params }: { params: { token: string } }) {
  const token = String(params.token || "");
  const [data, setData] = useState<LiveData | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");

  const load = useCallback(async () => {
    try {
      const { data: res, error } = await supabase.rpc("get_live_scorecard", { p_token: token });
      if (error) { setState("error"); return; }
      if (!res) { setState("missing"); return; }
      setData(res as LiveData); setState("ok");
    } catch { setState("error"); }
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(load, 25000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  return (
    <div style={{ minHeight: "100vh", background: C.green, color: C.cream, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "20px 14px 60px" }}>
        <div style={{ textAlign: "center", paddingTop: 8 }}>
          <span style={{ fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 800, color: C.cream }}>Birdie</span>
          <span style={{ fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 800, color: C.gold }}> Num Num</span>
        </div>
        {state === "loading" && <Centered text="Loading the live scorecard…" />}
        {state === "missing" && <Centered text="This live scorecard isn't available. The link may have been turned off, or the game ended more than 3 days ago." />}
        {state === "error" && <Centered text="Couldn't load this scorecard. Please try again in a moment." />}
        {state === "ok" && data && <Scorecard data={data} />}
        <div style={{ textAlign: "center", color: C.sage, fontSize: 11, marginTop: 28, opacity: 0.7 }}>Read-only live view · refreshes automatically</div>
      </div>
    </div>
  );
}

function Centered({ text }: { text: string }) {
  return <div style={{ background: C.greenLight, borderRadius: 16, padding: 28, marginTop: 40, textAlign: "center", color: C.sage, fontSize: 15, lineHeight: 1.5 }}>{text}</div>;
}
function SectionTitle({ children }: { children: string }) {
  return <div style={{ color: C.gold, fontSize: 11, letterSpacing: 2, fontWeight: 800, margin: "24px 4px 10px" }}>{children.toUpperCase()}</div>;
}

function Scorecard({ data }: { data: LiveData }) {
  const { game, players, pairings, foursomes } = data;
  const meta = game.holes_meta || [];
  const allowance = game.allowance_pct ?? 100;
  const byId = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p])), [players]);
  const ended = game.status === "ended";
  const ts = useMemo(() => teamScores(game, players, pairings, foursomes, byId, meta, allowance), [game, players, pairings, foursomes, byId, meta, allowance]);
  const stats = useMemo(() => { const m: Record<string, PStat> = {}; players.forEach((p) => { m[p.id] = computePlayer(p, meta, allowance); }); return m; }, [players, meta, allowance]);

  const isStab = game.game_type === "stableford";
  const isSkins = game.game_type === "skins";
  const isStroke = game.game_type === "stroke";
  const strokeNet = isStroke && game.stroke_basis !== "gross"; // null/"net" => net
  const skinsByPlayer = useMemo(() => {
    if (!isSkins) return {} as Record<string, number>;
    const sp = players.map((p) => ({ id: p.id, name: p.display_name, gross: p.scores || [], ch: p.ch }));
    return computeSkins(meta, sp, allowance).skinsByPlayer || {};
  }, [isSkins, players, meta, allowance]);

  const metricOf = (p: LivePlayer) => isStab ? stats[p.id].points : isSkins ? (skinsByPlayer[p.id] || 0) : isStroke ? -(strokeNet ? stats[p.id].net : stats[p.id].gross) : -stats[p.id].toPar;
  const sortPlayers = (arr: LivePlayer[]) => [...arr].sort((a, b) => {
    const at = stats[a.id].thru, bt = stats[b.id].thru;
    if ((at > 0) !== (bt > 0)) return at > 0 ? -1 : 1;
    if (at === 0 && bt === 0) return a.display_name.localeCompare(b.display_name);
    const d = metricOf(b) - metricOf(a); if (d !== 0) return d;
    return a.display_name.localeCompare(b.display_name);
  });

  const fmtLabel: Record<string, string> = { stableford: "Stableford", stroke: "Stroke play", match: "Singles match play", fourball: "Four-ball match play", skins: "Skins", trifecta: "Trifecta" };
  const teamFmt: Record<string, string> = { match: "Team match play", fourball: "Four-ball", trifecta: "Trifecta", skins: "Team skins", stableford: "Team Stableford", stroke: "Stroke play" };
  const label = ts ? teamFmt[game.game_type] : fmtLabel[game.game_type];

  const groups = ts
    ? ts.rows.map((r) => ({ title: r.name, color: r.color, players: sortPlayers(players.filter((p) => p.team === r.key)) }))
    : [{ title: null as string | null, color: null as string | null, players: sortPlayers(players) }];

  const rightOf = (p: LivePlayer) => isStab ? `${stats[p.id].points} pts` : isSkins ? `${skinsByPlayer[p.id] || 0} skins` : isStroke ? (stats[p.id].thru ? String(Math.round(strokeNet ? stats[p.id].net : stats[p.id].gross)) : "—") : (stats[p.id].thru ? toParStr(stats[p.id].toPar) : "—");

  return (
    <div>
      <div style={{ background: C.greenLight, borderRadius: 16, padding: "18px 18px 16px", marginTop: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, padding: "3px 8px", borderRadius: 999, background: ended ? "#3F3414" : "#1f7a52", color: ended ? "#E4CF86" : "#CFF5E2" }}>{ended ? "FINAL" : "\u25cf LIVE"}</span>
          <span style={{ color: C.gold, fontSize: 11, letterSpacing: 1.5, fontWeight: 700 }}>{(label || game.game_type).toUpperCase()}</span>
        </div>
        <div style={{ fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 800, color: C.cream, marginTop: 10 }}>{game.name}</div>
        <div style={{ color: C.sage, fontSize: 13, marginTop: 4 }}>{game.course}{game.played_at ? ` · ${game.played_at}` : ""}</div>
      </div>

      <SectionTitle>How it works</SectionTitle>
      <div style={{ background: "rgba(201,162,39,0.10)", border: "1px solid rgba(201,162,39,0.45)", borderRadius: 12, padding: "12px 14px", color: "#EFE6CD", fontSize: 13, lineHeight: 1.55 }}>
        {summaryText(game, ts?.rows)}
      </div>

      {ts && (
        <>
          <SectionTitle>Team scores</SectionTitle>
          <div style={{ background: C.card, borderRadius: 14, color: C.ink, padding: 14 }}>
            {ts.rows.map((r, i) => (
              <div key={r.key}>
                {i > 0 && <div style={{ height: 1, background: "#E8E2CE", margin: "12px 0" }} />}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 800, fontSize: 15 }}>
                      <span style={{ width: 11, height: 11, borderRadius: 3, background: r.color, display: "inline-block" }} />{r.name}
                    </div>
                    <div style={{ color: C.faint, fontSize: 12, marginTop: 3 }}>{r.members.join(" · ")}</div>
                  </div>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 28, fontWeight: 800, color: i === 0 ? C.green : C.faint }}>{r.scoreLabel}</div>
                </div>
              </div>
            ))}
            {(() => {
              const gt = game.game_type;
              if ((gt === "trifecta" || gt === "match" || gt === "fourball") && ts.rows.length >= 2) {
                const top = ts.rows[0], bot = ts.rows[1];
                const unclaimed = gt === "trifecta" ? ts.unclaimed : ts.out;
                const triMatch = gt === "trifecta" && game.trifecta_scoring === "match";
                const cs = clinchState(top.scoreNum, bot.scoreNum, unclaimed);
                const usePoints = gt === "trifecta" && !triMatch;
                const noun = (n: number) => usePoints ? `point${n === 1 ? "" : "s"}` : `match${n === 1 ? "" : "es"}`;
                const tail = usePoints ? "unclaimed" : "still out";
                return (
                  <>
                    <div style={{ borderTop: "1px solid #E8E2CE", marginTop: 12, paddingTop: 10, textAlign: "center", color: C.faint, fontSize: 12 }}>
                      {unclaimed > 0 ? <><b style={{ color: C.ink }}>{unclaimed}</b> {noun(unclaimed)} {tail}</> : (usePoints ? "All points played" : "All matches in")}
                    </div>
                    {(cs.clinched || cs.canTie || cs.decided) && (
                      <div style={{ marginTop: 10, background: cs.canTie ? "#FBF1D2" : cs.decided && !cs.leader ? "#F1EFE6" : "#E2F3E8", border: `1px solid ${cs.canTie ? C.gold : cs.decided && !cs.leader ? C.line : "#5BB98A"}`, borderRadius: 10, padding: "9px 12px", textAlign: "center" }}>
                        <div style={{ fontWeight: 800, fontSize: 14, color: cs.canTie ? "#7A5A12" : cs.decided && !cs.leader ? C.ink : "#1A7A3C" }}>
                          {cs.decided ? (cs.leader ? `${top.name} wins, ${fmtHalf(top.scoreNum)}–${fmtHalf(bot.scoreNum)}` : "Match tied") : cs.canTie ? `${top.name} can’t be caught` : `${top.name} has won`}
                        </div>
                        {cs.clinched && !cs.decided && <div style={{ color: C.faint, fontSize: 11, marginTop: 2 }}>{fmtHalf(cs.lead)} ahead with {unclaimed} {tail} — unbeatable</div>}
                      </div>
                    )}
                    {!cs.clinched && !cs.canTie && !cs.decided && (
                      <div style={{ color: "#8A6D12", fontSize: 12, fontWeight: 700, textAlign: "center", marginTop: 8 }}>{top.name} wins it with {cs.needToClinch} more {noun(cs.needToClinch)}</div>
                    )}
                  </>
                );
              }
              if (gt === "skins") {
                return ts.unclaimed > 0
                  ? <div style={{ borderTop: "1px solid #E8E2CE", marginTop: 12, paddingTop: 10, textAlign: "center", color: C.faint, fontSize: 12 }}>{ts.unclaimed} skin{ts.unclaimed === 1 ? "" : "s"} still in play</div>
                  : null;
              }
              return (!ts.isSkins && ts.out > 0) ? <div style={{ textAlign: "center", color: C.faint, fontSize: 12, marginTop: 10 }}>{ts.out} match{ts.out === 1 ? "" : "es"} still out</div> : null;
            })()}
          </div>
        </>
      )}

      <MatchupsBlock game={game} byId={byId} pairings={pairings} foursomes={foursomes} meta={meta} allowance={allowance} />
      <SkinsCarry game={game} players={players} meta={meta} allowance={allowance} />

      <SectionTitle>Scorecards</SectionTitle>
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.title && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "14px 2px 4px" }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, background: g.color || C.sage, display: "inline-block" }} />
              <span style={{ color: C.cream, fontSize: 13, fontWeight: 800, letterSpacing: 1 }}>{g.title.toUpperCase()}</span>
            </div>
          )}
          {g.players.map((p, idx) => (
            <PlayerRow key={p.id} p={p} pos={idx + 1} stat={stats[p.id]} meta={meta} right={rightOf(p)} status={statusFor(p, game, pairings, foursomes, byId, meta, allowance)} gameType={game.game_type} strokeNet={strokeNet} />
          ))}
        </div>
      ))}
    </div>
  );
}

function PlayerRow({ p, pos, stat, meta, right, status, gameType, strokeNet }: { p: LivePlayer; pos: number; stat: PStat; meta: LiveMeta[]; right: string; status: string; gameType: string; strokeNet: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div onClick={() => setOpen((o) => !o)} style={{ background: C.card, borderRadius: 14, color: C.ink, padding: "12px 14px", marginTop: 8, cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 16, color: C.faint, fontWeight: 700 }}>{pos}</span>
        <Avatar src={p.avatar_url} name={p.display_name} size={28} />
        <span style={{ flex: 1, fontWeight: 800, fontSize: 15 }}>{p.display_name}{p.no_show ? " (out)" : ""}</span>
        <span style={{ fontWeight: 800, color: C.green, marginRight: 8 }}>{right}</span>
        <span style={{ color: C.faint }}>{open ? "\u25b4" : "\u25be"}</span>
      </div>
      <div style={{ color: C.faint, fontSize: 11, marginTop: 4, marginLeft: 26 }}>
        {stat.thru ? `thru ${stat.thru} · gross ${stat.gross}` : "not started"}{status ? ` · ${status}` : ""}
      </div>
      {open && <PlayerDetail stat={stat} meta={meta} gameType={gameType} strokeNet={strokeNet} />}
    </div>
  );
}

function PlayerDetail({ stat, meta, gameType, strokeNet }: { stat: PStat; meta: LiveMeta[]; gameType: string; strokeNet: boolean }) {
  const lblCell: React.CSSProperties = { textAlign: "left", padding: "3px 6px", fontWeight: 700 };
  const cCell: React.CSSProperties = { textAlign: "center", padding: "3px 4px" };
  const totCell: React.CSSProperties = { textAlign: "center", padding: "3px 6px", fontWeight: 800, color: C.green };
  const half = Math.ceil(meta.length / 2);

  const grid = (from: number, to: number, label: string) => {
    const hs = stat.perHole.slice(from, to);
    const parSum = hs.reduce((a, h) => a + h.par, 0);
    const grossSum = hs.reduce((a, h) => a + (h.gross && h.gross > 0 ? h.gross : 0), 0);
    const ptsSum = hs.reduce((a, h) => a + (h.pts || 0), 0);
    return (
      <div style={{ overflowX: "auto", marginTop: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12, minWidth: hs.length * 30 + 72 }}>
          <tbody>
            <tr style={{ color: C.faint }}><td style={lblCell}>Hole</td>{hs.map((h) => <td key={h.n} style={cCell}>{h.n}</td>)}<td style={totCell}>{label}</td></tr>
            <tr style={{ color: C.faint }}><td style={lblCell}>Par</td>{hs.map((h) => <td key={h.n} style={cCell}>{h.par}</td>)}<td style={cCell}>{parSum}</td></tr>
            <tr><td style={lblCell}>Score</td>{hs.map((h) => {
              const c = h.gross == null ? C.faint : h.gross < h.par ? "#1B7A4B" : h.gross === h.par ? "#1E5B8A" : "#C0392B";
              return (
                <td key={h.n} style={{ padding: "2px 3px" }}>
                  <div style={{ height: 8, lineHeight: 0 }}>{h.recv > 0 && Array.from({ length: Math.min(h.recv, 2) }).map((_, d) => <span key={d} style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#E8730C", margin: "0 1px" }} />)}</div>
                  <div style={{ fontWeight: 800, fontSize: 14, color: c }}>{h.gross && h.gross > 0 ? h.gross : "\u00b7"}</div>
                </td>
              );
            })}<td style={totCell}>{grossSum || "\u00b7"}</td></tr>
            {gameType !== "stroke" && (
            <tr style={{ background: "#F4F0E1" }}><td style={{ ...lblCell, background: "transparent" }}>Points</td>{hs.map((h) => <td key={h.n} style={{ ...cCell, color: C.green, fontWeight: 700 }}>{h.gross && h.gross > 0 ? (h.pts ?? 0) : "\u00b7"}</td>)}<td style={{ ...cCell, color: C.green, fontWeight: 800 }}>{ptsSum}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  const chips: [string, string][] = [];
  if (stat.fairways != null) chips.push(["Fairways", stat.fairways]);
  if (stat.gir != null) chips.push(["GIR", stat.gir]);
  if (stat.putts != null) chips.push(["Putts", String(stat.putts)]);
  if (stat.penalties != null) chips.push(["Penalties", String(stat.penalties)]);

  return (
    <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 10, borderTop: `1px solid ${C.line}`, paddingTop: 6 }}>
      {grid(0, half, "OUT")}
      {meta.length > half && grid(half, meta.length, "IN")}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 13 }}>
        <span style={{ color: C.faint }}>Gross <b style={{ color: C.ink }}>{stat.gross || "\u00b7"}</b>{stat.thru ? <> · Net <b style={{ color: C.ink }}>{Math.round(stat.net)}</b></> : null}</span>
        {gameType === "stroke"
          ? <span style={{ color: C.faint }}>Counts <b style={{ color: C.green }}>{strokeNet ? "net" : "gross"}</b></span>
          : <span style={{ color: C.faint }}>Stableford <b style={{ color: C.green }}>{stat.points} pts</b></span>}
      </div>
      {chips.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>{chips.map(([k, v]) => <div key={k} style={{ background: "#F2EEDF", borderRadius: 8, padding: "7px 11px", fontSize: 12 }}>{k} <b style={{ color: C.green }}>{v}</b></div>)}</div>}
      <div style={{ color: C.faint, fontSize: 10, marginTop: 10, lineHeight: 1.5 }}><span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#E8730C", verticalAlign: "middle" }} /> gets a stroke (two = two strokes). Score color: under / par / over. Stats shown only if the player tracked them.</div>
    </div>
  );
}


function matchLabel(st: { thru: number; lead: number; result: string }): { text: string; color: string } {
  const WIN = "#1B7A4B", LOSE = "#C0392B", TIE = "#1E5B8A", NEU = "#8B8775";
  if (st.thru === 0) return { text: "not started", color: NEU };
  if (st.result !== "") {
    if (st.lead === 0 || st.result === "AS") return { text: "halved", color: TIE };
    return st.lead > 0 ? { text: `won ${st.result}`, color: WIN } : { text: `lost ${st.result}`, color: LOSE };
  }
  if (st.lead === 0) return { text: "all square", color: TIE };
  return st.lead > 0 ? { text: `${st.lead} up`, color: WIN } : { text: `${-st.lead} dn`, color: LOSE };
}

function teamLegLabel(lead: number, thru: number, _holes: number, result: string, teamA: string, teamB: string): { text: string; color: string } {
  const WIN = "#1B7A4B", TIE = "#1E5B8A", NEU = "#8B8775";
  if (thru === 0 || result === "Not started") return { text: "not started", color: NEU };
  if (result === "Halved") return { text: "halved", color: TIE };
  if (result && result !== "") return { text: `${(lead > 0 ? teamA : teamB) || "Team"} won ${result}`, color: WIN };
  if (lead === 0) return { text: "all square", color: TIE };
  return { text: `${(lead > 0 ? teamA : teamB) || "Team"} ${Math.abs(lead)} up`, color: WIN };
}

function MatchupsBlock({ game, byId, pairings, foursomes, meta, allowance }: {
  game: LiveGame; byId: Record<string, LivePlayer>;
  pairings: LiveData["pairings"]; foursomes: LiveData["foursomes"];
  meta: LiveMeta[]; allowance: number;
}) {
  const gt = game.game_type;
  if (gt !== "match" && gt !== "fourball" && gt !== "trifecta") return null;
  const teams = game.teams || [];
  const tColor: Record<string, string> = {}; const tName: Record<string, string> = {};
  teams.forEach((t, i) => { tColor[t.key] = teamColor(t.name, i); tName[t.key] = t.name; });
  const colorOf = (id?: string | null) => { const k = id ? byId[id]?.team : null; return k ? tColor[k] : null; };
  const teamNameOf = (id?: string | null) => { const k = id ? byId[id]?.team : null; return k ? (tName[k] || k) : ""; };
  const mem = (ids: (string | null)[]): FourballMember[] => ids.filter(Boolean).map((id) => { const q = byId[id as string]; return { id: id as string, gross: q?.scores || [], ch: q?.ch ?? null, noShow: !!q?.no_show }; });
  const nm = (id?: string | null) => (id ? (byId[id]?.display_name || "\u2014") : "\u2014");
  const sq = (color: string | null) => color ? <span style={{ width: 9, height: 9, borderRadius: 3, background: color, display: "inline-block", flex: "none" }} /> : null;
  const nameStyle: React.CSSProperties = { fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
  const cardStyle: React.CSSProperties = { background: C.card, borderRadius: 14, color: C.ink, padding: "12px 14px", marginTop: 8 };

  const Leg = (key: string, first: boolean, leftIds: string[], rightIds: string[], label: { text: string; color: string }, tag?: string) => (
    <div key={key} style={{ display: "flex", alignItems: "center", padding: "8px 0", borderTop: first ? "none" : `1px solid ${C.line}` }}>
      {tag && <span style={{ color: C.faint, fontSize: 10, fontWeight: 700, width: 48, flex: "none" }}>{tag}</span>}
      <span style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>{sq(colorOf(leftIds[0]))}<span style={nameStyle}>{leftIds.map(nm).join(" & ")}</span></span>
      <span style={{ color: "#B8B19A", fontSize: 11, fontWeight: 700, padding: "0 6px", flex: "none" }}>vs</span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0, justifyContent: "flex-end" }}><span style={{ ...nameStyle, textAlign: "right" }}>{rightIds.map(nm).join(" & ")}</span>{sq(colorOf(rightIds[0]))}</span>
      <span style={{ fontWeight: 800, fontSize: 13, minWidth: 64, textAlign: "right", flex: "none", color: label.color }}>{label.text}</span>
    </div>
  );

  let body: React.ReactNode = null;

  if (gt === "match") {
    const prs = pairings.filter((pr) => pr.a && pr.b);
    if (!prs.length) return null;
    body = (
      <div style={cardStyle}>
        {prs.map((pr, i) => {
          const a = byId[pr.a as string], b = byId[pr.b as string];
          const st = matchStatus(meta, a?.scores || [], b?.scores || [], a?.ch ?? null, b?.ch ?? null, allowance);
          return Leg(`m${i}`, i === 0, [pr.a as string], [pr.b as string], matchLabel(st));
        })}
      </div>
    );
  } else if (gt === "fourball") {
    if (!foursomes.length) return null;
    body = <>{foursomes.map((f, i) => {
      const aIds = (f.a || []).filter(Boolean) as string[]; const bIds = (f.b || []).filter(Boolean) as string[];
      if (!aIds.length || !bIds.length) return null;
      const st = fourballStatus(meta, mem([...aIds, ...bIds]), aIds, bIds, allowance);
      const lbl = teamLegLabel(st.lead, st.thru, meta.length, st.result, teamNameOf(aIds[0]), teamNameOf(bIds[0]));
      return (
        <div key={`f${i}`} style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontWeight: 800, fontSize: 14 }}><span>{f.name || `Foursome ${i + 1}`}</span><span style={{ color: C.faint, fontSize: 11, fontWeight: 600 }}>{st.thru ? `thru ${st.thru}` : "not started"}</span></div>
          {Leg(`f${i}r`, true, aIds, bIds, lbl)}
        </div>
      );
    })}</>;
  } else {
    if (!foursomes.length) return null;
    const mode = game.team_score_mode || "best_ball";
    body = <>{foursomes.map((f, i) => {
      const aIds = (f.a || []).filter(Boolean) as string[]; const bIds = (f.b || []).filter(Boolean) as string[];
      if (!aIds.length || !bIds.length) return null;
      const tri = computeTrifecta(meta, mem([...aIds, ...bIds]), aIds, bIds, allowance, mode, !!f.swap, game.trifecta_scoring === "match" ? "match" : "per_hole");
      const singles = tri.contests.filter((c) => c.kind === "single");
      const team = tri.contests.find((c) => c.kind === "team");
      return (
        <div key={`t${i}`} style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontWeight: 800, fontSize: 14 }}><span>{f.name || `Foursome ${i + 1}`}</span><span style={{ color: C.faint, fontSize: 11, fontWeight: 600 }}>{tri.thru ? `thru ${tri.thru}` : "not started"}</span></div>
          {singles.map((c, si) => {
            const aId = c.aIds[0], bId = c.bIds[0];
            const a = byId[aId], b = byId[bId];
            const st = matchStatus(meta, a?.scores || [], b?.scores || [], a?.ch ?? null, b?.ch ?? null, allowance);
            return Leg(`t${i}s${si}`, si === 0, [aId], [bId], matchLabel(st), "Single");
          })}
          {team && (() => {
            const lbl = teamLegLabel(team.lead, team.thru, meta.length, "", teamNameOf(aIds[0]), teamNameOf(bIds[0]));
            return (
              <div style={{ background: "#F4F0E1", borderRadius: 8, padding: "8px 10px", marginTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>Team point <span style={{ color: C.faint, fontWeight: 600 }}>({mode === "aggregate" ? "aggregate" : "better ball"})</span></span>
                <span style={{ fontWeight: 800, fontSize: 13, color: lbl.color }}>{lbl.text}</span>
              </div>
            );
          })()}
        </div>
      );
    })}</>;
  }

  return (<><SectionTitle>Matchups</SectionTitle>{body}</>);
}

function SkinsCarry({ game, players, meta, allowance }: { game: LiveGame; players: LivePlayer[]; meta: LiveMeta[]; allowance: number }) {
  if (game.game_type !== "skins") return null;
  const sp: SkinPlayer[] = players.map((p) => ({ id: p.id, name: p.display_name, gross: p.scores || [], ch: p.ch }));
  const res = computeSkins(meta, sp, allowance);
  const carried = res.holes.filter((h) => h.decided && h.winnerId === null).map((h) => h.hole);
  const bigWins = res.holes.filter((h) => h.decided && h.winnerId && h.value > 1).map((h) => ({ hole: h.hole, value: h.value, who: players.find((p) => p.id === h.winnerId)?.display_name || "" }));
  if (!carried.length && !bigWins.length && res.carryAtEnd <= 0) return null;
  return (
    <>
      <SectionTitle>Carryovers</SectionTitle>
      <div style={{ background: C.card, borderRadius: 14, color: C.ink, padding: "12px 14px", fontSize: 13, lineHeight: 1.5 }}>
        {carried.length > 0 && <div>Holes tied and carried: <b>{carried.join(", ")}</b>.</div>}
        {bigWins.map((b) => <div key={b.hole} style={{ marginTop: 4 }}>{b.who} took a <b>{b.value}-skin</b> pot on hole {b.hole}.</div>)}
        {res.carryAtEnd > 0 && <div style={{ marginTop: 4, color: C.faint }}>{res.carryAtEnd} skin{res.carryAtEnd === 1 ? "" : "s"} still in the pot.</div>}
      </div>
    </>
  );
}
