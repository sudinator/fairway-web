"use client";
import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { altShotDrivers } from "@/lib/alt-shot";
import { readAltShotSideScores } from "@/lib/alt-shot-scores";
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
import { pkey, chBasis, shapeOf, dotStrokes, fullStrokes, altShotSides } from "@/lib/game-shape";
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
import { saveActiveGame, loadActiveGame, saveActiveHole, clearActiveGame, saveGameScores, loadGameScores, clearGameScores, clearAllGameScores, saveGameSnapshot, loadGameSnapshot, saveSyncedWatermark, loadSyncedWatermark, clearSyncedWatermark, rowPendingHoles } from "@/lib/draft";
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
import { useNowTick } from "@/lib/use-now-tick";

const supabase = createClient();

export function GroupScorecard({ game, players, allPlayers, user, isMarker, markerName, onTakeOver, onRelease, onSetHole, teeMode = false, groupLabel = "", canClaim = false, onClaimGroup, onReleaseGroup, groupLocked = false, onMarkOut, courseTees = [], offline = false }: {
  game: Game; players: Player[];
  /** Every player in the game. `players` is filtered by tee group for DISPLAY; stroke bases
   *  that need the opposing side (alternate shot) must see the whole field. */
  allPlayers?: Player[];
  user: any;
  isMarker: boolean; markerName: string | null;
  onTakeOver: () => void; onRelease: () => void;
  onSetHole: (playerId: string, holeIdx: number, patch: { strokes?: number | null; putts?: number | null; fairway?: "hit" | "miss" | "left" | "right" | null; penalties?: number | null; sand?: boolean | null }) => void;
  teeMode?: boolean; groupLabel?: string; canClaim?: boolean;
  onClaimGroup?: () => void; onReleaseGroup?: () => void; groupLocked?: boolean;
  onMarkOut?: (p: Player) => void;
  courseTees?: CourseTee[];
  offline?: boolean;
}) {
  const [edit, setEdit] = useState<{ playerId: string; holeIdx: number } | null>(null);
  const paceNow = useNowTick();
  const allowance = game.allowance_pct ?? 100;
  const meta = game.holes_meta;
  const GREEN = "#1B7A4B", BLUE = "#1E5B8A", RED = "#C0392B";
  // Net-vs-par color: under green, level blue, over red.
  const netColor = (gross: number | null, recv: number, par: number) => {
    if (gross == null || gross <= 0) return "#8B8775";
    const net = gross - recv;
    return net < par ? GREEN : net === par ? BLUE : RED;
  };
  // ALL players, not the visible subset. `players` here is filtered by tee group for display,
  // and a stroke basis that needs the opposing side — alternate shot — returns 0 when that
  // side is filtered out, so the card showed no dots at all.
  const strokePool = allPlayers && allPlayers.length ? allPlayers : players;
  const recvFor = (p: Player, si: number | null) => dotStrokes(game, p, si, strokePool);
  // Individual (full playing handicap) strokes for the low-net / Stableford side game.
  // Only meaningful when the game uses a relative basis (match/four-ball/trifecta) — on
  // stableford/stroke the orange dots already ARE the full-handicap strokes, so we don't
  // draw a duplicate blue set.
  // Drives the blue course-handicap dots and the per-player course-Stableford column. Alternate
  // shot records no individual score, so both describe something that never happened.
  const relBasis = shapeOf(game).dotBasis !== "absolute" && game.game_type !== "alt_shot";
  const indRecvFor = (p: Player, si: number | null) => fullStrokes(game, p, si);

  // Column order + colour. Stableford: alphabetical. Team match: each pairing's
  // two players adjacent, with a divider between matches. Foursome formats: Pair A
  // then Pair B. Column underline uses the real team colour when teams exist.
  type AltSideMeta = { name: string; memberIds: string[]; memberNames: string[]; sideCh: number | null; receiving: boolean; matchStrokes: number };
  type Col = { type: "player"; p: Player; altSide?: AltSideMeta } | { type: "divider" };
  const cols: Col[] = (() => {
    const ps = players;
    const gt = game.game_type;
    if (gt === "stableford") {
      return [...ps].sort((a, b) => a.display_name.localeCompare(b.display_name)).map((p) => ({ type: "player" as const, p }));
    }
    if (gt === "match" && Array.isArray(game.pairings) && game.pairings.length) {
      const byKey = (k: string) => ps.find((p) => pkey(p) === k);
      const used = new Set<string>();
      const out: Col[] = [];
      game.pairings.forEach((pr) => {
        const pair = [byKey(pr.a), byKey(pr.b)].filter((p): p is Player => !!p);
        if (!pair.length) return;
        if (out.length) out.push({ type: "divider" });
        pair.forEach((p) => { out.push({ type: "player", p }); used.add(p.id); });
      });
      const rest = ps.filter((p) => !used.has(p.id)).sort((a, b) => a.display_name.localeCompare(b.display_name));
      if (rest.length && out.length) out.push({ type: "divider" });
      rest.forEach((p) => out.push({ type: "player", p }));
      return out.length ? out : ps.map((p) => ({ type: "player" as const, p }));
    }
    // Alternate shot is one ball per side. The database deliberately duplicates that one score
    // onto both partner rows for sync safety, but the scorecard must never present those as two
    // individual scores. Collapse each foursome to exactly TWO scoring entities: the two sides.
    if (gt === "alt_shot" && Array.isArray(game.foursomes)) {
      const f = game.foursomes.find((fr) => [...fr.a, ...fr.b].some((uid) => ps.some((p) => pkey(p) === uid)));
      if (f) {
        const sideInfo = altShotSides(game, strokePool, f);
        const makeSide = (ids: string[], which: "a" | "b"): Col | null => {
          const members = ids.map((uid) => strokePool.find((p) => pkey(p) === uid)).filter((p): p is Player => !!p);
          if (!members.length) return null;
          const rep = members[0];
          const read = members.length >= 2 ? readAltShotSideScores(members[0].scores, members[1].scores, meta.length) : { gross: rep.scores || [], conflictHoles: [] };
          const teamKey = rep.team;
          const ti = Array.isArray(game.teams) ? game.teams.findIndex((t) => t.key === teamKey) : -1;
          const teamName = ti >= 0 ? game.teams![ti].name : `Team ${which === "a" ? "A" : "B"}`;
          const sideCh = which === "a" ? sideInfo.aCh : sideInfo.bCh;
          return {
            type: "player",
            p: { ...rep, display_name: teamName, scores: read.gross },
            altSide: { name: teamName, memberIds: members.map((m) => m.id), memberNames: members.map((m) => m.display_name), sideCh, receiving: sideInfo.receiving === which, matchStrokes: sideInfo.receiving === which ? sideInfo.strokes : 0 },
          };
        };
        const a = makeSide(f.a || [], "a");
        const b = makeSide(f.b || [], "b");
        const out: Col[] = [];
        if (a) out.push(a);
        if (a && b) out.push({ type: "divider" });
        if (b) out.push(b);
        if (out.length) return out;
      }
    }
    if ((gt === "fourball" || gt === "trifecta") && Array.isArray(game.foursomes)) {
      const f = game.foursomes.find((fr) => [...fr.a, ...fr.b].some((uid) => ps.some((p) => pkey(p) === uid)));
      if (f) {
        const aSide = ps.filter((p) => f.a.includes(pkey(p)));
        const bSide = ps.filter((p) => f.b.includes(pkey(p)));
        const others = ps.filter((p) => !f.a.includes(pkey(p)) && !f.b.includes(pkey(p)));
        const out: Col[] = [];
        aSide.forEach((p) => out.push({ type: "player", p }));
        if (aSide.length && bSide.length) out.push({ type: "divider" });
        bSide.forEach((p) => out.push({ type: "player", p }));
        others.forEach((p) => out.push({ type: "player", p }));
        return out.length ? out : ps.map((p) => ({ type: "player" as const, p }));
      }
    }
    return ps.map((p) => ({ type: "player" as const, p }));
  })();
  const playerOrder = cols.filter((c): c is { type: "player"; p: Player } => c.type === "player").map((c) => c.p);
  // Yardage for the hole header: if every shown player is on the same tee, use that
  // tee's yardages (resolves even for older games whose holes_meta had none);
  // otherwise fall back to the game's stored yardage.
  const refTee = playerOrder.length && playerOrder.every((p) => p.tee_name === playerOrder[0].tee_name) ? playerOrder[0].tee_name : null;
  const ydsAt = (idx: number, fallback: number | null | undefined) => {
    const t = refTee ? courseTees.find((x) => x.name === refTee) : null;
    return (t?.yardages?.[idx] ?? fallback ?? null);
  };
  const colorFor = (p: Player): string => {
    if (shapeOf(game).usesTeams && Array.isArray(game.teams) && game.teams.length && p.team) {
      const ti = game.teams.findIndex((t) => t.key === p.team);
      if (ti >= 0) return teamAccent(game.teams[ti].name, ti);
    }
    const idx = playerOrder.findIndex((x) => x.id === p.id);
    return idx % 2 === 0 ? C.overDark : "#E0C25E";
  };
  const colTmpl = `58px ${cols.map((c) => (c.type === "divider" ? "10px" : "minmax(58px, 1fr)")).join(" ")}`;
  const cell: React.CSSProperties = { position: "relative", background: C.cell, borderRadius: 6, height: 42, display: "flex", alignItems: "center", justifyContent: "center" };
  const agg: React.CSSProperties = { position: "relative", background: C.greenLight, borderRadius: 6, height: 30, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 15, fontWeight: 800 };

  const sums = (p: Player, from: number, to: number) => {
    let g = 0, net = 0, mPts = 0, cPts = 0;
    for (let i = from; i <= to && i < meta.length; i++) {
      const gross = p.scores?.[i] ?? null;
      if (gross != null && gross > 0) {
        g += gross;
        net += gross - recvFor(p, meta[i].si);
        mPts += stablefordPts(gross, meta[i].par, recvFor(p, meta[i].si)) || 0;          // match handicap
        cPts += relBasis ? (stablefordPts(gross, meta[i].par, indRecvFor(p, meta[i].si)) || 0) : 0; // course handicap
      }
    }
    return { g, net, mPts, cPts };
  };

  // --- Resume where the user was scoring (survives a phone lock / app refresh) ---
  // Persist the hole whenever a cell is opened or advanced to.
  useEffect(() => {
    if (edit) saveActiveHole(game.id, edit.holeIdx);
  }, [edit?.holeIdx]);

  // On first mount with players loaded, scroll to the LAST hole that has any score — the hole
  // the scorer was working on. This shows their most recent entries (so an incomplete hole is
  // visible, not skipped) with the next holes just below. Offset by the sticky header's height
  // so the hole number stays visible instead of hiding behind it.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !playerOrder.length) return;
    restoredRef.current = true;
    let target = -1;
    for (let i = meta.length - 1; i >= 0; i--) {
      if (playerOrder.some((p) => (p.scores?.[i] ?? 0) > 0)) { target = i; break; }
    }
    if (target > 0) {
      requestAnimationFrame(() => setTimeout(() => {
        const el = document.getElementById(`grphole-${target}`);
        if (!el) return;
        const hdr = document.getElementById("scorecard-sticky");
        el.style.scrollMarginTop = `${(hdr?.offsetHeight ?? 90) + 10}px`;
        el.scrollIntoView({ block: "start", behavior: "auto" });
      }, 60));
    }
  }, [playerOrder.length]);

  const holeCard = (i: number) => {
    const m = meta[i];
    return (
      <div key={`hc${i}`} id={`grphole-${i}`} style={{ background: "#13352A", border: "1px solid #2E6B55", borderRadius: 10, padding: 8, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ color: C.cream, fontSize: 18, fontWeight: 800, lineHeight: 1 }}>Hole {m.n}</span>
          <span style={{ color: "#CFE3D8", fontSize: 13 }}>Par <b style={{ color: C.cream }}>{m.par}</b>{(() => { const y = ydsAt(i, m.yards); return y ? <> · <b style={{ color: C.cream }}>{y}</b> yds</> : null; })()} · SI <b style={{ color: C.cream }}>{m.si ?? "–"}</b></span>
        </div>
        {game.game_type === "alt_shot" && Array.isArray(game.foursomes) ? (
          <div style={{ color: C.sage, fontSize: 11.5, marginBottom: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {(game.foursomes || []).flatMap((fr: { a?: string[]; b?: string[] }) =>
              [fr.a, fr.b].map((sideIds, si2) => {
                const d = altShotDrivers(sideIds, i);   // POSITION in the round, not the hole number
                if (!d) return null;
                const who = strokePool.find((q) => pkey(q) === d.driver);
                if (!who) return null;
                return (
                  <span key={`tee${fr ? si2 : si2}-${d.driver}`}>
                    <span style={{ color: C.gold }}>{"\u26F3"}</span>{" "}
                    <b style={{ color: C.cream, fontWeight: 700 }}>{who.display_name.split(" ")[0]}</b> tees off
                  </span>
                );
              }),
            )}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 6 }}>
          {cols.map((c, ci) => {
            if (c.type === "divider") return <div key={`hd${i}-${ci}`} style={{ width: 2, alignSelf: "stretch", background: "rgba(216,178,74,0.5)", borderRadius: 6, margin: "16px 1px 0" }} />;
            const p = c.p;
            const gross = p.scores?.[i] ?? null;
            const recv = recvFor(p, m.si);
            const indRecv = relBasis ? indRecvFor(p, m.si) : 0;
            const oPts = stablefordPts(gross, m.par, recv);                    // orange = match handicap
            const bPts = relBasis ? stablefordPts(gross, m.par, indRecv) : null; // blue = course handicap
            return (
              <div key={p.id + i} style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: colorFor(p), fontSize: 11, fontWeight: 700, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 3 }}>{p.display_name}</div>
                <div
                  style={{ position: "relative", background: C.cell, borderRadius: 6, height: 56, display: "flex", alignItems: "center", justifyContent: "center", cursor: (isMarker || (c.altSide ? c.altSide.memberIds.some((id) => strokePool.find((x) => x.id === id)?.user_id === user?.id) : p.user_id === user?.id)) ? "pointer" : "default", outline: isMarker ? "1px solid #E6E0CC" : ((c.altSide ? c.altSide.memberIds.some((id) => strokePool.find((x) => x.id === id)?.user_id === user?.id) : p.user_id === user?.id) ? "1px dashed #C9BF9B" : "none") }}
                  onClick={(isMarker || (c.altSide ? c.altSide.memberIds.some((id) => strokePool.find((x) => x.id === id)?.user_id === user?.id) : p.user_id === user?.id)) ? () => { setEdit({ playerId: p.id, holeIdx: i }); } : undefined}>
                  {recv > 0 && (
                    <div style={{ position: "absolute", top: 4, left: 5, display: "flex", gap: 2 }}>
                      {Array.from({ length: Math.min(recv, 2) }).map((_, d) => (
                        <span key={d} style={{ width: 6, height: 6, borderRadius: 999, background: "#E8730C", display: "block" }} />
                      ))}
                    </div>
                  )}
                  {indRecv > 0 && (
                    <div style={{ position: "absolute", bottom: 4, left: 5, display: "flex", gap: 2 }}>
                      {Array.from({ length: Math.min(indRecv, 2) }).map((_, d) => (
                        <span key={d} style={{ width: 6, height: 6, borderRadius: 999, background: C.indivDot, display: "block" }} />
                      ))}
                    </div>
                  )}
                  <span style={{ fontSize: 26, fontWeight: 800, color: gross != null && gross > 0 ? netColor(gross, recv, m.par) : "#C7C2B0" }}>{gross != null && gross > 0 ? gross : m.par}</span>
                  {c.altSide && gross != null && gross > 0 && <span style={{ position: "absolute", bottom: 3, right: 4, color: C.faint, fontSize: 11, fontWeight: 800 }}>net {gross - recv}</span>}
                  {!c.altSide && gross != null && gross > 0 && (relBasis ? (
                    <>
                      <span style={{ position: "absolute", top: 3, right: 3, minWidth: 16, height: 16, padding: "0 2px", border: "1.5px solid #E8730C", borderRadius: 6, background: "#FBEEE2", color: "#9A4A08", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{oPts ?? 0}</span>
                      <span style={{ position: "absolute", bottom: 3, right: 3, minWidth: 16, height: 16, padding: "0 2px", border: `1.5px solid ${C.indivDot}`, borderRadius: 6, background: "#EAF3FB", color: "#1E5B8A", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{bPts ?? 0}</span>
                    </>
                  ) : (
                    <span style={{ position: "absolute", bottom: 3, right: 4, background: C.green, color: "#fff", fontSize: 11, fontWeight: 800, padding: "0 6px", borderRadius: 6 }}>{oPts ?? 0}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const summaryCard = (label: string, from: number, to: number) => (
    <div key={`sum${label}`} style={{ background: "#0A241C", border: "1px solid #2E6B55", borderRadius: 10, padding: 8, marginTop: 2, marginBottom: 8 }}>
      <div style={{ color: "#CFE3D8", fontSize: 11, fontWeight: 800, letterSpacing: 1.5, marginBottom: 8 }}>{label}</div>
      <div style={{ display: "flex", gap: 6 }}>
        {cols.map((c, ci) => {
          if (c.type === "divider") return <div key={`sd${label}-${ci}`} style={{ width: 2, alignSelf: "stretch", background: "rgba(216,178,74,0.5)", borderRadius: 6, margin: "0 1px" }} />;
          const p = c.p;
          const s = sums(p, from, to);
          return (
            <div key={p.id + label} style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
              <div style={{ position: "relative", background: C.greenLight, borderRadius: 6, height: 44, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
                <span style={{ fontSize: 20, fontWeight: 800 }}>{s.g || "–"}</span>
                {c.altSide && s.g > 0 && <span style={{ position: "absolute", bottom: 2, right: 4, color: C.sage, fontSize: 11, fontWeight: 800 }}>net {s.net}</span>}
                {!c.altSide && s.g > 0 && (relBasis ? (
                  <>
                    <span style={{ position: "absolute", top: 3, right: 3, minWidth: 15, height: 15, padding: "0 2px", border: "1.5px solid #E8730C", borderRadius: 6, color: C.dot, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{s.mPts}</span>
                    <span style={{ position: "absolute", bottom: 3, right: 3, minWidth: 15, height: 15, padding: "0 2px", border: `1.5px solid ${C.indivDot}`, borderRadius: 6, color: C.indivDot, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{s.cPts}</span>
                  </>
                ) : (
                  <span style={{ position: "absolute", bottom: 3, right: 4, background: C.green, color: "#E4CF86", fontSize: 11, fontWeight: 800, padding: "0 5px", borderRadius: 6 }}>{s.mPts}</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const half = meta.length >= 18 ? 9 : Math.ceil(meta.length / 2);

  return (
    <div style={{ marginTop: 16 }}>
      {offline ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#3A2A12", border: `0.5px solid ${C.gold}`, borderRadius: 10, padding: "8px 12px", marginBottom: 8 }}>
          <span style={{ fontSize: 14 }}>📴</span>
          <span style={{ color: "#E4CF86", fontSize: 12, flex: 1 }}>Offline — you can’t change who’s scoring until you reconnect. The current scorer can keep entering; everything saves on this phone.</span>
        </div>
      ) : teeMode ? (
        groupLocked ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#2A2A2A", border: `0.5px solid ${C.gold}`, borderRadius: 10, padding: "8px 12px", marginBottom: 8 }}>
            <span style={{ color: C.gold, fontSize: 14 }}>🔒</span>
            <span style={{ color: "#E4CF86", fontSize: 12, flex: 1 }}>{groupLabel} · final — scores locked and posted to each player's Rounds tab.</span>
          </div>
        ) : isMarker ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#3F3414", border: `0.5px solid ${C.gold}`, borderRadius: 10, padding: "8px 12px", marginBottom: 8 }}>
            <span style={{ color: C.gold, fontSize: 15 }}>✎</span>
            <span style={{ color: "#E4CF86", fontSize: 12, flex: 1 }}>You're scoring {groupLabel} — tap a cell to edit</span>
            {onReleaseGroup && <button onClick={onReleaseGroup} style={{ ...btn(false), fontSize: 11, padding: "5px 10px" }}>Hand off</button>}
          </div>
        ) : markerName ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#13352A", border: "0.5px solid #2E6B55", borderRadius: 10, padding: "8px 12px", marginBottom: 8 }}>
            <span style={{ width: 9, height: 9, borderRadius: 999, background: "#5BD08A", boxShadow: "0 0 0 3px rgba(91,208,138,0.25)" }} />
            <span style={{ color: "#CFE3D8", fontSize: 12, flex: 1 }}>{groupLabel} · <strong style={{ color: C.cream }}>{markerName}</strong> is keeping score</span>
            {canClaim && onClaimGroup && <button onClick={() => { if (confirm(`Take over scoring for ${groupLabel} from ${markerName}?`)) onClaimGroup(); }} style={{ ...btn(false), fontSize: 11, padding: "5px 10px" }}>Take over</button>}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#13352A", border: "0.5px solid #2E6B55", borderRadius: 10, padding: "8px 12px", marginBottom: 8 }}>
            <span style={{ color: C.sage, fontSize: 12, flex: 1 }}>No one is keeping score for {groupLabel} yet.</span>
            {canClaim && onClaimGroup
              ? <button onClick={onClaimGroup} style={{ ...btn(true), fontSize: 11, padding: "5px 10px" }}>Keep score for this group</button>
              : <span style={{ color: C.sage, fontSize: 11 }}>view only</span>}
          </div>
        )
      ) : isMarker ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#3F3414", border: `0.5px solid ${C.gold}`, borderRadius: 10, padding: "8px 12px", marginBottom: 8 }}>
          <span style={{ color: C.gold, fontSize: 15 }}>✎</span>
          <span style={{ color: "#E4CF86", fontSize: 12, flex: 1 }}>You're keeping score — tap a cell to edit</span>
          <button onClick={onRelease} style={{ ...btn(false), fontSize: 11, padding: "5px 10px" }}>Hand off</button>
        </div>
      ) : markerName ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#13352A", border: "0.5px solid #2E6B55", borderRadius: 10, padding: "8px 12px", marginBottom: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: 999, background: "#5BD08A", boxShadow: "0 0 0 3px rgba(91,208,138,0.25)" }} />
          <span style={{ color: "#CFE3D8", fontSize: 12, flex: 1 }}>Live · <strong style={{ color: C.cream }}>{markerName}</strong> is keeping score</span>
          <button onClick={() => { if (confirm(`Take over scoring from ${markerName}?`)) onTakeOver(); }} style={{ ...btn(false), fontSize: 11, padding: "5px 10px" }}>Take over</button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#13352A", border: "0.5px solid #2E6B55", borderRadius: 10, padding: "8px 12px", marginBottom: 8 }}>
          <span style={{ color: C.sage, fontSize: 12, flex: 1 }}>No one is keeping score for the group yet.</span>
          <button onClick={onTakeOver} style={{ ...btn(true), fontSize: 11, padding: "5px 10px" }}>Keep score</button>
        </div>
      )}
      <div style={{ display: "flex", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ color: "#7FD0A0", fontSize: 11 }}>● under</span>
        <span style={{ color: "#6FA8DC", fontSize: 11 }}>● par</span>
        <span style={{ color: "#E0796B", fontSize: 11 }}>● over (net)</span>
        {relBasis
          ? <>
              <span style={{ color: "#9A4A08", fontSize: 11 }}>● ▢ match hcp</span>
              <span style={{ color: C.indivDot, fontSize: 11 }}>● ▢ course hcp</span>
              <span style={{ color: C.faint, fontSize: 11 }}>dots = strokes · box = net Stableford</span>
            </>
          : <span style={{ color: "#9A4A08", fontSize: 11 }}>● gets a stroke · corner = Stableford</span>}
      </div>
      <div id="scorecard-sticky" style={{ position: "sticky", top: 0, zIndex: 5, background: C.green, paddingTop: 8, paddingBottom: 10, marginBottom: 4, boxShadow: "0 6px 10px -8px rgba(0,0,0,0.55)" }}>
        {(() => {
          const starts = players.map((p) => p.clock_start).filter(Boolean) as string[];
          if (!starts.length) return null;
          const startMs = Math.min(...starts.map((s) => new Date(s).getTime()));
          const ends = players.map((p) => p.clock_end).filter(Boolean) as string[];
          const allEnded = players.length > 0 && ends.length === players.length;
          const endMs = allEnded ? Math.max(...ends.map((s) => new Date(s).getTime())) : paceNow;
          const mins = Math.max(0, Math.round((endMs - startMs) / 60000));
          const groupSize = Math.max(1, players.length);
          const targetPerHole = 6 + 2 * groupSize;
          const holesDone = Math.max(0, ...players.map((p) => (p.scores || []).filter((s) => s != null && (s as number) > 0).length));
          const behind = mins - holesDone * targetPerHole;
          const showPace = !allEnded && holesDone >= 1;
          const onPace = behind <= 10;
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 14 }}>⏱</span>
              <span style={{ color: C.cream, fontWeight: 700, fontFamily: "Georgia, serif", fontSize: 16 }}>{Math.floor(mins / 60)}:{String(mins % 60).padStart(2, "0")}</span>
              <span style={{ color: C.sage, fontSize: 11 }}>{allEnded ? "round time" : "elapsed"}{holesDone >= 1 ? ` · thru ${holesDone}` : ""}</span>
              {showPace && <span style={{ flex: 1 }} />}
              {showPace && (onPace ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(91,208,138,0.15)", color: "#7FD0A0", border: "1px solid rgba(91,208,138,0.4)", borderRadius: 999, padding: "2px 9px", fontSize: 11, fontWeight: 700 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: "#5BD08A", display: "block" }} />On pace
                </span>
              ) : (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(216,178,74,0.16)", color: "#E4CF86", border: "1px solid rgba(216,178,74,0.5)", borderRadius: 999, padding: "2px 9px", fontSize: 11, fontWeight: 700 }}>
                  ⚑ ~{behind} min behind
                </span>
              ))}
            </div>
          );
        })()}
        <div style={{ display: "flex", gap: 6 }}>
          {cols.map((c, ci) => {
            if (c.type === "divider") return <div key={`lg${ci}`} style={{ width: 2, alignSelf: "stretch", background: "rgba(216,178,74,0.5)", borderRadius: 6, margin: "0 1px" }} />;
            const p = c.p;
            return (
              <div key={p.id} style={{ flex: 1, minWidth: 0, textAlign: "center", padding: "4px 2px", borderBottom: `2px solid ${colorFor(p)}` }}>
                {c.altSide ? (
                  <>
                    <div style={{ color: C.cream, fontSize: 13, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.altSide.name}</div>
                    <div style={{ color: C.sage, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.altSide.memberNames.map((n) => n.split(" ")[0]).join(" / ")}</div>
                    <div style={{ color: C.sage, fontSize: 11 }}>playing hcp {c.altSide.sideCh == null ? "–" : Number(c.altSide.sideCh.toFixed(2))}</div>
                    <div style={{ color: c.altSide.receiving ? C.gold : C.sage, fontSize: 11, fontWeight: 700 }}>{c.altSide.receiving ? `gets ${c.altSide.matchStrokes}` : "plays scratch"}</div>
                  </>
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: 3 }}><Avatar src={p.avatar_url} name={p.display_name} cssSize="min(54px, 90%)" accent={colorFor(p)} /></div>
                    <div style={{ color: C.cream, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.display_name}{p.is_guest ? " ·G" : ""}</div>
                    {(() => {
                      const matchHcp = meta.reduce((a, m) => a + recvFor(p, m.si), 0);
                      const courseHcp = meta.reduce((a, m) => a + indRecvFor(p, m.si), 0);
                      if (!relBasis) return <div style={{ color: C.sage, fontSize: 11 }}>hcp {matchHcp}</div>;
                      const line = (color: string, label: string, val: number) => (<div style={{ color: C.sage, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 3, whiteSpace: "nowrap" }}><span style={{ width: 5, height: 5, borderRadius: 999, background: color, display: "inline-block", flex: "none" }} />{label} {val}</div>);
                      return <>{line("#E8730C", "match hcp", matchHcp)}{line(C.indivDot, "course hcp", courseHcp)}</>;
                    })()}
                    {p.tee_name && <div style={{ color: C.sage, fontSize: 11, opacity: 0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.tee_name}</div>}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {(() => {
        const nodes: React.ReactNode[] = [];
        meta.forEach((_, i) => {
          nodes.push(holeCard(i));
          if (meta.length >= 18 && i === 8) nodes.push(summaryCard("OUT", 0, 8));
          if (meta.length >= 18 && i === 17) nodes.push(summaryCard("IN", 9, 17));
        });
        nodes.push(summaryCard("TOT", 0, meta.length - 1));
        return nodes;
      })()}

      {edit && (() => {
        const p = players.find((x) => x.id === edit.playerId);
        const m = meta[edit.holeIdx];
        if (!p || !m) return null;
        const sideCol = cols.find((c): c is Extract<Col, { type: "player" }> => c.type === "player" && !!c.altSide && c.p.id === edit.playerId);
        const displayP = sideCol?.p || p;
        const gross = displayP.scores?.[edit.holeIdx] ?? null;
        const putts = p.putts?.[edit.holeIdx] ?? null;
        const fw = p.fairways?.[edit.holeIdx] ?? null;
        const penN = p.penalties?.[edit.holeIdx] || 0;
        const sandOn = !!p.sand?.[edit.holeIdx];
        const recv = recvFor(p, m.si);
        const order = playerOrder;
        const scoreLocked = sideCol?.altSide ? false : (!isMarker && !!p.user_id && p.user_id === user?.id); // alternate shot edits the SIDE; ordinary non-marker self-row stays stats-only
        const goNext = () => {
          // Move to the next player on THIS hole who still needs a score (wrap around the
          // row, skip no-shows). Nothing is auto-scored — a score is only recorded when the
          // scorer taps a selection, so untouched players stay a grey par placeholder.
          const needs = (pl: Player) => !pl.no_show && pl.id !== edit.playerId && ((pl.scores?.[edit.holeIdx] ?? null) == null || (pl.scores?.[edit.holeIdx] ?? 0) <= 0);
          const idx = order.findIndex((x) => x.id === edit.playerId);
          for (let k = 1; k <= order.length; k++) {
            const cand = order[(idx + k) % order.length];
            if (needs(cand)) {
              setEdit({ playerId: cand.id, holeIdx: edit.holeIdx });
              return;
            }
          }
          setEdit(null); // whole row scored — card disappears
        };
        return (
          <HoleScoreModal
            title={`${sideCol?.altSide ? `${sideCol.altSide.name} · playing hcp ${sideCol.altSide.sideCh == null ? "–" : Number(sideCol.altSide.sideCh.toFixed(2))}` : p.display_name} · Hole ${m.n}`}
            par={m.par}
            si={m.si ?? null}
            yardage={ydsAt(edit.holeIdx, m.yards)}
            strokes={gross}
            putts={putts}
            fairway={fw}
            penalties={penN}
            sand={sandOn}
            recv={recv}
            showFairway={!sideCol?.altSide}
            showPutts={!sideCol?.altSide}
            showPenalties={!sideCol?.altSide}
            scoreLocked={scoreLocked}
            lockedByName={markerName}
            onPatch={(patch) => { if (sideCol?.altSide) { onSetHole(p.id, edit.holeIdx, { strokes: patch.strokes }); } else if (scoreLocked) { const { strokes: _s, ...statsOnly } = patch; onSetHole(p.id, edit.holeIdx, statsOnly); } else { onSetHole(p.id, edit.holeIdx, patch); } }}
            onNext={scoreLocked ? () => { const ni = edit.holeIdx + 1; if (ni < meta.length) setEdit({ playerId: p.id, holeIdx: ni }); else setEdit(null); } : goNext}
            onClose={() => setEdit(null)}
            belowPicker={<ContestHoleChip gameId={game.id} hole={m.n} players={players} userId={user.id} myName={players.find((x: Player) => x.user_id === user.id)?.display_name || "Me"} canLogOthers={!!isMarker} />}
          />
        );
      })()}
      {isMarker && onMarkOut && !groupLocked && (
        <div style={{ marginTop: 14, borderTop: `0.5px solid ${C.borderCard}`, paddingTop: 12 }}>
          <div style={{ color: C.sage, fontSize: 11, marginBottom: 7 }}>Someone leave early? Tap to mark them out. The holes they've played still count; {(game.game_type === "fourball" || game.game_type === "trifecta") ? "the holes they didn't play score net double bogey for their team" : game.game_type === "match" ? "the match stands on the holes already played" : "their unplayed holes score nothing"}.</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {players.map((p) => (
              <button key={p.id} onClick={() => onMarkOut(p)}
                style={{ border: `1px solid ${p.no_show ? "#E08A5B" : C.borderCard}`, background: p.no_show ? "#5A2E22" : "transparent", color: p.no_show ? "#F2B894" : C.sage, borderRadius: 999, padding: "6px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                {p.no_show ? `${p.display_name} · out ✓` : p.display_name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Organizer/admin score-change history for a game (reads migration 0042's audit log).
export function GroupsBuilder({ game, players, onSetTeeGroup, getTeeGroupPolicy, onRandomize, canRandomize = false, randomizeReason = "", randomizing = false, overflowIds = [] }: {
  game: Game; players: Player[];
  onSetTeeGroup: (p: Player, group: number | null) => Promise<void>;
  getTeeGroupPolicy?: (p: Player, group: number | null) => { blocked: boolean; reason?: string };
  onRandomize?: () => Promise<void>;
  canRandomize?: boolean; randomizeReason?: string; randomizing?: boolean; overflowIds?: string[];
}) {
  const byKey = (k: string) => players.find((p) => pkey(p) === k) || null;
  const groupOptions = Array.from({ length: Math.max(2, Math.ceil(players.length / 2) + 1) }, (_, i) => i + 1);

  type Unit = { id: string; label: string; members: Player[] };
  const pairings = Array.isArray(game.pairings) ? game.pairings : [];
  const foursomes = Array.isArray(game.foursomes) ? game.foursomes : [];
  let units: Unit[];
  const sh = shapeOf(game);
  if (sh.usesFoursomes && foursomes.length) {
    units = foursomes.map((f, i) => ({
      id: f.id || `f${i}`,
      label: f.name || `Foursome ${i + 1}`,
      members: [...f.a, ...f.b].map(byKey).filter((p): p is Player => !!p),
    }));
  } else if (sh.usesMatchups && !sh.usesFoursomes && pairings.length) {
    units = pairings.map((pr, i) => {
      const members = [byKey(pr.a), byKey(pr.b)].filter((p): p is Player => !!p);
      return { id: `m${i}`, label: members.map((m) => m.display_name).join(" v ") || `Match ${i + 1}`, members };
    });
  } else {
    units = players.map((p) => ({ id: p.id, label: p.display_name, members: [p] }));
  }

  const unitGroup = (u: Unit): number | null => {
    const gs = Array.from(new Set(u.members.map((m) => m.tee_group ?? null)));
    return gs.length === 1 ? gs[0] : null;
  };
  const assign = async (u: Unit, g: number | null) => {
    for (const m of u.members) await onSetTeeGroup(m, g);
  };
  const teeGroups = Array.from(new Set(players.map((p) => p.tee_group).filter((g): g is number => g != null))).sort((a, b) => a - b);
  const firstGroup = teeGroups.length ? Math.min(...teeGroups) : null;

  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 12 }}>
      <Eyebrow>GROUPS · WHO TEES OFF TOGETHER</Eyebrow>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>
        {foursomes.length
          ? "Each foursome is already a group — set the group number to order who tees off first."
          : pairings.length
          ? "Put the matches that tee off together in the same group — usually two matches make a foursome."
          : "Split players into the groups that tee off together (foursomes, 3-balls, or 2-balls). One scorer per group keeps the cards, or players score themselves."}
      </div>
      {players.some((p) => (p.scores || []).some((x) => x != null) || p.group_locked) && (
        <div style={{ background: "rgba(201,162,39,.12)", border: `1px solid ${C.gold}`, borderRadius: 10, padding: "9px 11px", color: C.cream, fontSize: 11.5, lineHeight: 1.45, marginTop: 10 }}>
          Scoring is in progress. Players who have scored, and finished/locked groups, cannot be moved. An unscored player may join an active group with confirmation.
        </div>
      )}

      {onRandomize && !foursomes.length && !pairings.length && (
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => { if (canRandomize) onRandomize(); }}
            disabled={!canRandomize || randomizing}
            style={{ ...btn(true), fontSize: 13, opacity: canRandomize && !randomizing ? 1 : 0.62, cursor: canRandomize && !randomizing ? "pointer" : "not-allowed" }}>
            {randomizing ? "Shuffling…" : "🎲 Randomize groups"}
          </button>
          <div style={{ color: C.sage, fontSize: 11, marginTop: 6, lineHeight: 1.45 }}>
            {canRandomize
              ? "Shuffles everyone into balanced foursomes. Guests stay in their sponsor's group. You can still fine-tune below."
              : randomizeReason}
          </div>
          {overflowIds.length > 0 && (
            <div style={{ marginTop: 8, background: C.greenLight, border: `1px solid ${C.gold}`, borderRadius: 8, padding: "9px 11px", color: C.gold, fontSize: 12, lineHeight: 1.45 }}>
              {overflowIds.length} guest{overflowIds.length === 1 ? "" : "s"} couldn&apos;t be auto-placed (a member brought more than three): {overflowIds.map((id) => players.find((p) => p.id === id)?.display_name || "guest").join(", ")}. Assign {overflowIds.length === 1 ? "them" : "each"} to a group below.
            </div>
          )}
        </div>
      )}

      {units.map((u) => {
        const g = unitGroup(u);
        return (
          <div key={u.id} style={{ background: C.greenLight, borderRadius: 10, padding: 12, marginTop: 10, border: `1px solid ${C.borderCard}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: C.cream, fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis" }}>{u.label}</div>
              <div style={{ color: C.sage, fontSize: 11 }}>{u.members.length} player{u.members.length === 1 ? "" : "s"}</div>
            </div>
            {(() => {
              const unitBlocked = u.members.some((m) => getTeeGroupPolicy?.(m, g).blocked);
              const unitReason = u.members.map((m) => getTeeGroupPolicy?.(m, g).reason).find(Boolean);
              return <select value={g ?? ""} onChange={(e) => assign(u, e.target.value ? parseInt(e.target.value, 10) : null)}
                disabled={unitBlocked} title={unitReason}
                style={{ ...inputStyle, padding: "6px 8px", minWidth: 110, opacity: unitBlocked ? 0.62 : 1 }}>
              <option value="">No group</option>
              {groupOptions.map((n) => <option key={n} value={n}>Group {n}</option>)}
            </select>;
            })()}
          </div>
        );
      })}

      {teeGroups.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 14 }}>
          {teeGroups.map((gn) => {
            const mem = players.filter((p) => p.tee_group === gn);
            return (
              <div key={gn} style={{ background: C.greenLight, borderRadius: 10, padding: 12, border: `1px solid ${C.gold}` }}>
                <div style={{ color: C.gold, fontWeight: 800, fontSize: 13 }}>Group {gn}{gn === firstGroup ? " · off first" : ""}</div>
                <div style={{ color: C.sage, fontSize: 11, marginTop: 2 }}>{mem.length} player{mem.length === 1 ? "" : "s"}</div>
                <div style={{ marginTop: 8, color: C.cream, fontSize: 13, lineHeight: 1.7 }}>
                  {mem.map((p) => {
                    const sponsor = p.is_guest && p.guest_of ? (players.find((m) => m.user_id === p.guest_of)?.display_name || null) : null;
                    return <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 7 }}><Avatar src={p.avatar_url} name={p.display_name} size={20} enlargeable={false} /><span>{p.display_name}{sponsor ? <span style={{ color: C.sage, fontSize: 11 }}> · guest of {sponsor}</span> : null}</span></div>;
                  })}
                </div>
                <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>Scorer: chosen on the course</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Organizer control to publish / revoke the public live-scorecard link.
export function ShareControl({ game, onShare }: { game: Game; onShare: (on: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const shared = !!game.share_token;
  const link = shared && typeof window !== "undefined" ? `${window.location.origin}/live/${game.share_token}` : "";
  const toggle = async (on: boolean) => { setBusy(true); try { await onShare(on); } finally { setBusy(false); } };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  return (
    <div style={{ marginTop: 10, padding: "12px 14px", background: C.greenLight, borderRadius: 8 }}>
      <div style={{ color: C.cream, fontWeight: 700, fontSize: 13 }}>📡 Live scorecard link</div>
      <div style={{ color: C.sage, fontSize: 11, marginTop: 4, lineHeight: 1.5 }}>
        Share a read-only live scorecard with anyone — no login needed. They can follow the action but can&apos;t join or change scores. Stays live for 3 days after the game ends.
      </div>
      {!shared ? (
        <button disabled={busy} onClick={() => toggle(true)}
          style={{ ...btn(true), marginTop: 10, fontSize: 13, display: "block", opacity: busy ? 0.62 : 1 }}>
          {busy ? "Creating…" : "Create live link"}
        </button>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <input readOnly value={link} onFocus={(e) => e.currentTarget.select()}
              style={{ flex: 1, background: C.green, color: C.cream, border: `1px solid ${C.borderGreen}`, borderRadius: 6, padding: "8px 10px", fontSize: 12 }} />
            <button onClick={copy} style={{ ...btn(true), fontSize: 12, padding: "8px 12px" }}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <button disabled={busy} onClick={() => toggle(false)}
            style={{ background: "transparent", color: C.overRedDark, border: `0.5px solid #7A3A34`, borderRadius: 8, padding: "7px 12px", fontWeight: 700, cursor: "pointer", marginTop: 8, fontSize: 12, display: "block", opacity: busy ? 0.62 : 1 }}>
            {busy ? "…" : "Stop sharing (revoke link)"}
          </button>
        </div>
      )}
    </div>
  );
}

