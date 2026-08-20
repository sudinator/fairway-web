"use client";
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase";
import { ContestsSection, ContestHoleChip } from "@/components/contests-view";
import { betResultToPost } from "@/lib/money";
import type { BetNet, BetPost } from "@/lib/money";
import { ShareScorecardModal, ShareGameModal } from "@/components/share-card";
import {
  C,
  Hole,
  courseHandicap,
  strokesReceived,
  allocateStrokes,
  stablefordPts,
  stablefordBySix,
  netBySix,
  matchStatus,
  matchStrokesFor,
  matchProgress,
  matchLeadLabel,
  matchAllowance,
  applyAllowance,
  fourballStatus,
  fourballProgress,
  fourballHoleDetail,
  type ContestHole,
  computeTrifecta,
  clinchState,
  trifectaSingles,
  type FourballMember,
  computeSkins,
  computeHeadToHeadSkins,
  computeTeamBestBallSkins,
  type SkinPlayer,
  computeBetting,
  DEFAULT_BET_SPLIT,
  TGC_GROUP_ID,
  effectiveGroupId,
  type BetPlayer,
  type BetSplit,
  markerOwnsMyRow,
  mergeBackupRow,
} from "@/lib/golf";
import { pkey, chBasis, shapeOf, dotStrokes, fullStrokes } from "@/lib/game-shape";
import { randomTeeGroups, type GPlayer } from "@/lib/grouping";
import { notifyError } from "@/components/toast";
import { buildLegs, legResult, teamTally, fmtPt, legPoints, DEFAULT_LEG_CONFIG } from "@/lib/legs";
import type { LegConfig, Leg } from "@/lib/legs";
import { loadCoursesForGroup, courseLabel, type CourseTee } from "@/lib/courses";
import { loadSetupDraft, saveSetupDraft, clearSetupDraft, draftHasProgress, draftAgeLabel, type SetupDraft } from "@/lib/setup-draft";
import { autoSplitFlights, flightForIndex, flightRangeLabel, type FlightBand } from "@/lib/flights";

// Every game_players INSERT must set these NOT-NULL columns explicitly rather than
// leaning on the DB default. A drifted default (0059's `if not exists` skipped it)
// once caused a NOT-NULL violation on `bets`; these columns carry the same risk.
const GP_STATE_DEFAULTS = { penalties: [] as unknown[], sand: [] as unknown[], is_marker: false, group_locked: false };
import { logActivity } from "@/lib/activity";
import { saveActiveGame, loadActiveGame, clearActiveGame, saveGameScores, loadGameScores, clearGameScores, clearAllGameScores, saveGameSnapshot, loadGameSnapshot, saveSyncedWatermark, loadSyncedWatermark, clearSyncedWatermark, rowPendingHoles } from "@/lib/draft";
import { changedCols, pickCols } from "@/lib/sync-cols";
import {
  btn,
  inputStyle,
  Eyebrow,
  NumPicker,
  ScoreEntryCard,
  HoleScoreModal,
  ShortDateInput,
  Avatar,
} from "@/components/ui";
import type { Game, Player } from "@/lib/game-types";
import { teamAccent, TEAM_COLOR_BY_NAME } from "@/lib/game-colors";

const supabase = createClient();

export function LegConfigEditor({ game, onSave }: { game: Game; onSave: (cfg: LegConfig) => void }) {
  const init: LegConfig = (game.leg_config as LegConfig) || { ...DEFAULT_LEG_CONFIG, points: {} };
  const [cfg, setCfg] = React.useState<LegConfig>({ scheme: init.scheme || "sixes", metric: init.metric === "net" ? "net" : "pts", points: { ...(init.points || {}) } });
  const n = (game.holes_meta || []).length || 18;
  const legs = buildLegs(cfg.scheme, n);

  const push = (next: LegConfig) => { setCfg(next); onSave(next); };
  const setScheme = (scheme: string) => push({ ...cfg, scheme });
  const setMet = (metric: "pts" | "net") => push({ ...cfg, metric });
  const bump = (k: string, d: number) => {
    const cur = cfg.points[k] != null ? cfg.points[k] : 0;
    const v = Math.max(0, Math.min(5, Math.round((cur + d) * 2) / 2));
    push({ ...cfg, points: { ...cfg.points, [k]: v } });
  };

  const schemes = [
    { k: "sixes", label: "Three sixes + Total" },
    { k: "nines", label: "Front 9 / Back 9 / Total" },
    { k: "sixesNoTot", label: "Three sixes only" },
    { k: "total", label: "Total only" },
  ];
  const chip = (on: boolean): React.CSSProperties => ({ border: `1px solid ${on ? C.gold : C.greenMid}`, background: on ? C.gold : "transparent", color: on ? "#1c1606" : C.cream, borderRadius: 999, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" });
  const stepBtn: React.CSSProperties = { width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.greenMid}`, background: "transparent", color: C.cream, fontSize: 16, fontWeight: 800, cursor: "pointer", lineHeight: 1 };
  const lbl: React.CSSProperties = { color: C.sage, fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", margin: "12px 0 6px" };
  const fmtName = game.game_type === "trifecta" ? "trifecta" : game.game_type === "fourball" ? "four-ball" : "match";

  return (
    <div style={{ marginTop: 12, background: C.greenLight, borderRadius: 12, padding: 14 }}>
      <div style={{ color: C.sage, fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase" }}>Group results: legs</div>
      <div style={{ color: C.sage, fontSize: 11.5, marginTop: 4, lineHeight: 1.5 }}>An extra team game alongside the {fmtName}: pick which legs count and what each is worth. Winning team of each leg takes its points; ties across teams both score, ties within a team score once. Set every leg to 0 to just show a live leaderboard.</div>

      <div style={lbl}>What counts?</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {schemes.map((sc) => <button key={sc.k} onClick={() => setScheme(sc.k)} style={chip(cfg.scheme === sc.k)}>{sc.label}</button>)}
      </div>

      <div style={lbl}>Decide each leg by</div>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => setMet("pts")} style={chip(cfg.metric === "pts")}>Stableford points</button>
        <button onClick={() => setMet("net")} style={chip(cfg.metric === "net")}>Low net</button>
      </div>

      <div style={lbl}>Points per leg</div>
      <div style={{ color: C.sage, fontSize: 11, margin: "-2px 0 4px" }}>e.g. half a point per six, 1 point for the total.</div>
      {legs.map((lg) => {
        const v = cfg.points[lg.k] != null ? cfg.points[lg.k] : 0;
        return (
          <div key={lg.k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
            <span style={{ flex: 1, color: C.cream, fontSize: 13.5, fontWeight: 700 }}>{lg.k}</span>
            <button onClick={() => bump(lg.k, -0.5)} style={stepBtn}>-</button>
            <span style={{ fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 800, color: v ? C.gold : C.faint, minWidth: 26, textAlign: "center" }}>{fmtPt(v)}</span>
            <button onClick={() => bump(lg.k, 0.5)} style={stepBtn}>+</button>
            <span style={{ color: C.sage, fontSize: 11, width: 16 }}>pt</span>
          </div>
        );
      })}
    </div>
  );
}

// Expandable per-player six-hole segment leaderboard, in the Group Results grid
// format (Name · Thru · 1–6 · 7–12 · 13–18 · Total). Reuses the segment data
// already computed in the room; collapsed by default.
export function SegmentBoard({
  rows,
  isStroke,
}: {
  rows: { name: string; thru: number; segs: number[]; total: number; isMe: boolean }[];
  isStroke: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  if (rows.length < 1) return null;
  const sorted = rows.slice().sort((a, b) => (isStroke ? a.total - b.total : b.total - a.total));
  const segLeader = [0, 1, 2].map((i) => {
    const vals = rows.map((r) => r.segs[i]);
    if (!vals.length) return null;
    return isStroke ? Math.min(...vals) : Math.max(...vals);
  });
  const cols = ["1\u20136", "7\u201312", "13\u201318"];
  return (
    <div style={{ marginTop: 10, background: C.greenLight, borderRadius: 12, overflow: "hidden" }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px", cursor: "pointer" }}
      >
        <span style={{ fontWeight: 800, color: C.cream, fontSize: 13 }}>Full segment breakdown</span>
        <span style={{ color: C.sage, fontSize: 16, display: "inline-block", transform: open ? "rotate(180deg)" : "none" }}>{"\u25BE"}</span>
      </div>
      {open && (
        <div style={{ padding: "0 10px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "6px 6px", color: C.sage, fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid #2c5a48" }}>
            <div style={{ flex: 1 }}>Player</div>
            <div style={{ width: 34, textAlign: "center" }}>Thru</div>
            {cols.map((c, i) => (
              <div key={i} style={{ width: i === 2 ? 44 : 40, textAlign: "center" }}>{c}</div>
            ))}
            <div style={{ width: 42, textAlign: "center" }}>Total</div>
          </div>
          {sorted.map((r, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "center", padding: "7px 6px", background: r.isMe ? "#123528" : "none", borderRadius: 8 }}>
              <div style={{ flex: 1, minWidth: 0, color: C.cream, fontWeight: 700, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.name}{r.isMe ? " (you)" : ""}
              </div>
              <div style={{ width: 34, textAlign: "center", color: C.sage, fontSize: 12 }}>{r.thru || "\u2013"}</div>
              {[0, 1, 2].map((i) => {
                const isLead = segLeader[i] != null && r.segs[i] === segLeader[i];
                return (
                  <div key={i} style={{ width: i === 2 ? 44 : 40, textAlign: "center", fontSize: 12, fontWeight: isLead ? 800 : 600, color: isLead ? "#8FE0B0" : C.cream }}>
                    {r.segs[i]}
                  </div>
                );
              })}
              <div style={{ width: 42, textAlign: "center", color: C.gold, fontWeight: 800, fontSize: 13 }}>{r.total}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function GroupSegmentSummary({ game, players }: { game: Game; players: Player[] }) {
  const cfg: LegConfig = (game.leg_config as LegConfig) || DEFAULT_LEG_CONFIG;
  const [metric, setMetric] = React.useState<"net" | "pts">(cfg.metric === "net" ? "net" : "pts");
  const meta = (game.holes_meta || []) as { n: number; par: number; si: number | null }[];
  const n = meta.length;
  const ps = players.filter((p) => !p.no_show).slice().sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""));
  const anyScore = ps.some((p) => (p.scores || []).some((x: any) => x != null && x > 0));
  if (n === 0 || ps.length === 0 || !anyScore) return null;

  const teams = Array.isArray(game.teams) ? game.teams : [];
  const hasTeams = teams.length >= 2;
  const teamKey = (p: Player) => p.team || pkey(p);
  const teamName = (k: string) => teams.find((t) => t.key === k)?.name || k;
  const teamColor = (k: string) => { const i = teams.findIndex((t) => t.key === k); return teamAccent(teams[i]?.name, i < 0 ? 0 : i); };

  const legs: Leg[] = buildLegs(cfg.scheme, n);

  const rows = ps.map((p) => {
    const cells = legs.map((lg) => {
      let nSum = 0, pSum = 0, parSum = 0, holes = 0;
      for (let i = lg.from; i < lg.to; i++) {
        const g = p.scores?.[i];
        if (g == null || g <= 0) continue;
        holes++;
        const recv = fullStrokes(game, p, meta[i].si); // individual side game: full playing handicap, not the match-relative basis
        nSum += g - recv;
        pSum += stablefordPts(g, meta[i].par, recv) || 0;
        parSum += meta[i].par;
      }
      return { holes, net: nSum, pts: pSum, par: parSum };
    });
    let thru = 0; for (let i = 0; i < n; i++) { const g = p.scores?.[i]; if (g != null && g > 0) thru++; }
    return { pid: pkey(p), name: p.display_name, avatar_url: p.avatar_url, team: teamKey(p), cells, thru };
  });
  // Leader is picked dynamically by pace vs par (fair across holes played). Display differs by metric:
  // points shows the raw Stableford total; net shows over/under par. The Thru column gives the context.
  const toParOf = (cl: { holes: number; net: number; pts: number; par: number }, met: "net" | "pts") =>
    cl.holes === 0 ? null : (met === "pts" ? (2 * cl.holes - cl.pts) : (cl.net - cl.par));
  const fmtToPar = (v: number) => (v === 0 ? "E" : v < 0 ? String(v) : "+" + v);
  const cellDisplay = (cl: { holes: number; net: number; pts: number; par: number }, met: "net" | "pts") =>
    cl.holes === 0 ? "-" : (met === "pts" ? String(cl.pts) : fmtToPar(cl.net - cl.par));

  const legComplete = (lg: Leg) => {
    for (let i = lg.from; i < lg.to; i++) for (const p of ps) { const g = p.scores?.[i]; if (g == null || g <= 0) return false; }
    return true;
  };
  const legHolesPlayed = (lg: Leg) => { let h = 0; for (let i = lg.from; i < lg.to; i++) if (ps.some((p) => { const g = p.scores?.[i]; return g != null && g > 0; })) h++; return h; };
  const legInfo = legs.map((lg, c) => {
    const scores = rows.map((r) => ({ pid: r.pid, team: r.team, val: toParOf(r.cells[c], metric) }));
    const res = legResult(scores, "net"); // lower to-par wins (dynamic vs par, fair across holes played)
    return { res, pts: legPoints(cfg, lg), winPids: new Set(res.winnerPids), complete: legComplete(lg), holes: legHolesPlayed(lg) };
  });

  const allZero = legInfo.every((li) => li.pts === 0);
  const pointsMode = hasTeams && !allZero;
  const tally = teamTally(legInfo.filter((li) => li.complete).map((li) => ({ teams: li.res.winnerTeams, points: li.pts })));
  const tA = teams[0] ? (tally[teams[0].key] || 0) : 0;
  const tB = teams[1] ? (tally[teams[1].key] || 0) : 0;

  const hdrBg = (lg: Leg) => (lg.tot ? "#E7F0E9" : "#EEF4EF");
  const th: React.CSSProperties = { textAlign: "center", color: C.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", padding: "6px 3px", borderBottom: `1px solid ${C.line}` };
  const nmH: React.CSSProperties = { ...th, textAlign: "left", width: 100 };
  const thruH: React.CSSProperties = { ...th, width: 38 };
  const nmCell: React.CSSProperties = { textAlign: "left", width: 100, color: C.ink, fontWeight: 800, fontSize: 12.5, padding: "6px 3px" };
  const cell: React.CSSProperties = { textAlign: "center", fontSize: 12.5, padding: "6px 3px", color: "#4b4838", fontWeight: 600 };
  const chip = (on: boolean): React.CSSProperties => ({ border: `1px solid ${on ? C.gold : "#2c5142"}`, background: on ? C.gold : "#173a2c", color: on ? "#2a2410" : C.cream, borderRadius: 999, padding: "3px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" });
  const nameOf = (pid: string) => rows.find((r) => r.pid === pid)?.name || "?";
  const scoringText = () => {
    const metricPhrase = (metric === "net" ? "Lowest net to par" : "Most Stableford points") + " wins each leg";
    const segLegs = legs.filter((l) => !l.tot && legPoints(cfg, l) > 0);
    const totLeg = legs.find((l) => l.tot && legPoints(cfg, l) > 0);
    if (!segLegs.length && !totLeg) return "Leaderboard only, no team points. " + metricPhrase + ".";
    const unit = cfg.scheme === "nines" ? "each 9" : "each six";
    const parts: string[] = [];
    if (segLegs.length) {
      const p0 = legPoints(cfg, segLegs[0]);
      const same = segLegs.every((l) => legPoints(cfg, l) === p0);
      parts.push(same ? (fmtPt(p0) + " pt " + unit) : segLegs.map((l) => l.k + " " + fmtPt(legPoints(cfg, l))).join(", "));
    }
    if (totLeg) parts.push(fmtPt(legPoints(cfg, totLeg)) + " pt for the total");
    return parts.join(", ") + ". " + metricPhrase + ".";
  };

  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: "15px 13px 14px", marginTop: 12 }}>
      <div style={{ display: "inline-block", color: C.green, background: C.gold, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 8 }}>Side game</div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 800 }}>Group results</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setMetric("net")} style={chip(metric === "net")}>Low net</button>
          <button onClick={() => setMetric("pts")} style={chip(metric === "pts")}>Points</button>
        </div>
      </div>
      <div style={{ color: C.sage, fontSize: 11.5, marginTop: 2, lineHeight: 1.4 }}>{scoringText()}</div>

      <div style={{ background: C.card, borderRadius: 12, padding: "8px 8px 6px", marginTop: 12, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
          <thead><tr>
            <th style={nmH}></th>
            <th style={thruH}>Thru</th>
            {legs.map((lg) => <th key={lg.k} style={{ ...th, background: hdrBg(lg) }}>{lg.k}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r.pid} style={{ borderTop: ri === 0 ? "none" : "1px solid #F0EBDA" }}>
                <td style={nmCell}><span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                  <span style={{ flexShrink: 0, display: "flex" }}><Avatar src={r.avatar_url} name={r.name} size={20} /></span>
                  {hasTeams && <span style={{ width: 6, height: 6, borderRadius: 3, background: teamColor(r.team), flexShrink: 0 }} />}
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
                </span></td>
                <td style={{ ...cell, color: C.faint, fontWeight: 700 }}>{r.thru}</td>
                {legs.map((lg, c) => {
                  const win = legInfo[c].winPids.has(r.pid);
                  return <td key={lg.k} style={{ ...cell, ...(win ? { background: "#F6E7C4", color: C.green, fontWeight: 800, borderRadius: 6 } : {}) }}>{cellDisplay(r.cells[c], metric)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pointsMode ? (
        <>
          <div style={{ color: C.sage, fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", margin: "14px 0 4px" }}>Leg points</div>
          {legs.map((lg, c) => {
            const li = legInfo[c];
            if (li.pts === 0 || li.res.winnerTeams.length === 0) return null;
            const names = li.res.winnerPids.map(nameOf).join(" & ");
            const wonNote = li.res.winnerPids.length === 1 ? (names + " won") : (li.res.winnerTeams.length === 1 ? (names + " tied, same team, counts once") : (names + " tied across teams, both score"));
            const leadNote = names + " leading, thru " + li.holes + " hole" + (li.holes === 1 ? "" : "s");
            return (
              <div key={lg.k} style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "7px 2px", borderBottom: `1px solid ${C.greenMid}` }}>
                <div style={{ width: 58, flexShrink: 0, color: C.cream, fontWeight: 800, fontSize: 12.5 }}>{lg.k}</div>
                <div style={{ flex: 1, color: li.complete ? C.sage : C.faint, fontSize: 12, lineHeight: 1.4 }}>
                  {li.complete ? wonNote : leadNote}
                  {li.complete
                    ? li.res.winnerTeams.map((tk) => (
                        <span key={tk} style={{ display: "inline-block", background: teamColor(tk), color: C.cream, borderRadius: 6, padding: "1px 7px", fontSize: 11, fontWeight: 800, marginLeft: 5 }}>{teamName(tk)} wins {fmtPt(li.pts)}</span>
                      ))
                    : li.res.winnerTeams.map((tk) => (
                        <span key={tk} style={{ display: "inline-block", border: `1px solid ${teamColor(tk)}`, color: teamColor(tk), borderRadius: 6, padding: "1px 7px", fontSize: 11, fontWeight: 800, marginLeft: 5 }}>{teamName(tk)} +{fmtPt(li.pts)}</span>
                      ))}
                </div>
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            {teams.slice(0, 2).map((t, i) => (
              <div key={t.key} style={{ flex: 1, background: "#123528", borderRadius: 12, padding: "12px", textAlign: "center" }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: teamColor(t.key) }}>{t.name}</div>
                <div style={{ fontFamily: "Georgia, serif", fontSize: 28, fontWeight: 800, color: C.cream, marginTop: 2 }}>{fmtPt(i === 0 ? tA : tB)}</div>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: 10, fontFamily: "Georgia, serif", fontWeight: 800, color: tA === tB ? C.gold : C.cream }}>
            {tA === tB ? ("All square " + fmtPt(tA) + "-" + fmtPt(tB)) : (teamName(tA > tB ? teams[0].key : teams[1].key) + " leads " + fmtPt(Math.max(tA, tB)) + "-" + fmtPt(Math.min(tA, tB)))}
          </div>
          <div style={{ color: C.sage, fontSize: 11, marginTop: 10, opacity: 0.85, lineHeight: 1.4 }}>
            Each leg's best individual result scores for their team. Separate from the trifecta - it doesn't change that result. Points are awarded once a leg is complete; the leader is shown until then. Ties: opposite teams both score, same team scores once.
          </div>
        </>
      ) : (
        <div style={{ color: C.sage, fontSize: 11, marginTop: 8, opacity: 0.85, lineHeight: 1.4 }}>
          {hasTeams ? "Leaders per leg (highlighted); leader is by pace, so Thru matters. Assign leg points in setup to play for team points." : "Each player's Stableford points (or net vs par) per leg. Fills in live as holes are entered."}
        </div>
      )}
    </div>
  );
}

