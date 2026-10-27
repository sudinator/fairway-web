"use client";
import { scrambleResults } from "@/lib/scramble-game";
import { sortByName, byName } from "@/lib/names";
import { scrambleTeamsOf, cupSideNames } from "@/lib/scramble-teams";
import { driveTally } from "@/lib/scramble";
import { shortNamer } from "@/lib/short-names";
import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { altShotDrivers } from "@/lib/alt-shot";
import { readAltShotSideScores } from "@/lib/alt-shot-scores";
import { canonicalAltShotGross, type AltShotScoreRow, type AltShotScoreSide } from "@/lib/alt-shot-side-scores";
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
import { pkey, chBasis, shapeOf, dotStrokes, fullStrokes, strokeSets, altShotSides, scrambleTeamHandicapFor } from "@/lib/game-shape";
import { randomTeeGroups, teamGroupSlotChoices, type GPlayer, groupShapeOk, allowsOneShortGroup } from "@/lib/grouping";
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
  strokeGlyph,
} from "@/components/ui";
import type { Game, Player } from "@/lib/game-types";
import { teamAccent, teamColour, TEAM_COLOR_BY_NAME } from "@/lib/game-colors";
import { useNowTick } from "@/lib/use-now-tick";

const supabase = createClient();

export function GroupScorecard({ readOnly = false, game, players, allPlayers, user, isMarker, markerName, onTakeOver, onRelease, onSetHole, altShotScores = [], onSetAltShotScore, onSetScrambleScore, teeMode = false, groupLabel = "", canClaim = false, onClaimGroup, onReleaseGroup, groupLocked = false, onMarkOut, courseTees = [], offline = false }: {
  readOnly?: boolean;
  game: Game; players: Player[];
  /** Every player in the game. `players` is filtered by tee group for DISPLAY; stroke bases
   *  that need the opposing side (alternate shot) must see the whole field. */
  allPlayers?: Player[];
  user: any;
  isMarker: boolean; markerName: string | null;
  onTakeOver: () => void; onRelease: () => void;
  onSetHole: (playerId: string, holeIdx: number, patch: { strokes?: number | null; putts?: number | null; fairway?: "hit" | "miss" | "left" | "right" | null; penalties?: number | null; sand?: boolean | null }) => void;
  altShotScores?: AltShotScoreRow[];
  onSetAltShotScore?: (foursomeId: string, side: AltShotScoreSide, holeIdx: number, strokes: number | null) => void;
  /** 211.1: scramble — a team's hole score and whose drive (null keeps none). */
  onSetScrambleScore?: (foursomeId: string, side: AltShotScoreSide, holeIdx: number, strokes: number | null, driveKey: string | null) => void;
  teeMode?: boolean; groupLabel?: string; canClaim?: boolean;
  onClaimGroup?: () => void; onReleaseGroup?: () => void; groupLocked?: boolean;
  onMarkOut?: (p: Player) => void;
  courseTees?: CourseTee[];
  offline?: boolean;
}) {
  // Names shortened within the GROUP shown (lib/short-names): first name unless it collides here.
  const shortOf = shortNamer(players);
  const [edit, setEdit] = useState<{ playerId: string; holeIdx: number; alt?: { foursomeId: string; side: AltShotScoreSide } } | null>(null);
  useEffect(() => { if (readOnly) setEdit(null); }, [readOnly]);
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
  // 212.1: nor does a scramble (one ball per team — only the team's strokes exist).
  const relBasis = shapeOf(game).dotBasis !== "absolute" && game.game_type !== "alt_shot" && game.game_type !== "scramble";
  const indRecvFor = (p: Player, si: number | null) => fullStrokes(game, p, si);
  // ONE source and ONE colour per stroke basis, shared with the personal card (185.0).
  const BASIS_COLOR: Record<string, string> = {
    course: C.basisCourse, opponent: C.basisOpponent, group_low: C.basisGroupLow, alt_side: C.basisOpponent, team: C.basisOpponent,
  };
  // Each basis owns a fixed vertical slot down the LEFT EDGE of the cell — top, middle, bottom —
  // rather than stacking from the top. With three bases an 8px stack bunched them in the corner and
  // the count per slot became unreadable. A fixed slot also makes POSITION a cue that does not
  // depend on hue: your single is always the top one.
  const DOT_SLOT: Record<string, React.CSSProperties> = {
    opponent: { top: 4 },
    group_low: { top: "50%", transform: "translateY(-50%)" },
    course: { bottom: 4 },
    alt_side: { top: 4 },
    team: { top: 4 },
  };
  const cellSets = (p: Player, si: number | null) =>
    // A set with only `gives` still draws — as a hollow glyph. Filtering on strokes alone meant the
    // group card never showed "you give a stroke here", which the personal card has always shown.
    strokeSets(game, p, si, strokePool).filter((r) => r.strokes > 0 || r.gives > 0);

  // Column order + colour. Stableford: alphabetical. Team match: each pairing's
  // two players adjacent, with a divider between matches. Foursome formats: Pair A
  // then Pair B. Column underline uses the real team colour when teams exist.
  type AltSideMeta = { name: string; memberIds: string[]; memberNames: string[]; sideCh: number | null; receiving: boolean; matchStrokes: number; foursomeId: string; side: AltShotScoreSide };
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
    // SCRAMBLE (211.1): one ball per TEAM — each team in this group is one row, scores from game_alt_shot_scores.
    if (gt === "scramble" && Array.isArray(game.foursomes)) {
      const allTeams = scrambleTeamsOf(game.foursomes as never, cupSideNames(game));
      const out: Col[] = [];
      for (const f of game.foursomes) {
        if (![...f.a, ...f.b].some((uid) => ps.some((p) => pkey(p) === uid))) continue;
        for (const which of ["a", "b"] as const) {
          const members = (f[which] || []).map((uid) => strokePool.find((p) => pkey(p) === uid)).filter((p): p is Player => !!p);
          if (!members.length) continue;
          const teamName = allTeams.find((t) => t.groupId === f.id && t.side === which)?.name ?? "Team";
          const gross = canonicalAltShotGross(altShotScores, f.id, which, meta.length, null);
          if (out.length) out.push({ type: "divider" });
          out.push({ type: "player", p: { ...members[0], display_name: teamName, scores: gross },
            altSide: { name: teamName, memberIds: members.map((m) => m.id), memberNames: members.map((m) => m.display_name),
              sideCh: scrambleTeamHandicapFor(game, strokePool, pkey(members[0])), receiving: false, matchStrokes: 0, foursomeId: f.id, side: which } });
        }
      }
      if (out.length) return out;
    }
    // Alternate shot is one ball per side. Canonical scores now live in game_alt_shot_scores;
    // historical duplicated partner rows are read only as a backward-compatible fallback.
    // The scorecard therefore renders exactly TWO scoring entities: the two sides.
    if (gt === "alt_shot" && Array.isArray(game.foursomes)) {
      const f = game.foursomes.find((fr) => [...fr.a, ...fr.b].some((uid) => ps.some((p) => pkey(p) === uid)));
      if (f) {
        const sideInfo = altShotSides(game, strokePool, f);
        const makeSide = (ids: string[], which: "a" | "b"): Col | null => {
          const members = ids.map((uid) => strokePool.find((p) => pkey(p) === uid)).filter((p): p is Player => !!p);
          if (!members.length) return null;
          const rep = members[0];
          const legacy = members.length >= 2 ? readAltShotSideScores(members[0].scores, members[1].scores, meta.length).gross : (rep.scores || []);
          const gross = canonicalAltShotGross(altShotScores, f.id, which, meta.length, legacy);
          const teamKey = rep.team;
          const ti = Array.isArray(game.teams) ? game.teams.findIndex((t) => t.key === teamKey) : -1;
          const teamName = ti >= 0 ? game.teams![ti].name : `Team ${which === "a" ? "A" : "B"}`;
          const sideCh = which === "a" ? sideInfo.aCh : sideInfo.bCh;
          return {
            type: "player",
            p: { ...rep, display_name: teamName, scores: gross },
            altSide: { name: teamName, memberIds: members.map((m) => m.id), memberNames: members.map((m) => m.display_name), sideCh, receiving: sideInfo.receiving === which, matchStrokes: sideInfo.receiving === which ? sideInfo.strokes : 0, foursomeId: f.id, side: which },
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
  // 212.21 (owner): a tee's yardage on a hole; null when the tee or its yardage is unknown
  const teeYds = (tee: string | null | undefined, idx: number) => (tee ? courseTees.find((x) => x.name === tee)?.yardages?.[idx] ?? null : null);
  const ydsAt = (idx: number, fallback: number | null | undefined) => (refTee ? teeYds(refTee, idx) : null) ?? fallback ?? null;
  // a group on MORE THAN ONE tee: each tee's yardage, longest first ("Blue 412 · White 388") — it used to fall back to
  // the game's one stored yardage for everyone
  const groupTees = Array.from(new Set(playerOrder.map((p) => p.tee_name).filter((t): t is string => !!t)));
  const teesAt = (idx: number) => (groupTees.length > 1
    ? groupTees.map((t) => ({ t, y: teeYds(t, idx) })).filter((x) => x.y != null).sort((a, b) => (b.y as number) - (a.y as number))
    : []);
  const colorFor = (p: Player): string => {
    if (shapeOf(game).usesTeams && Array.isArray(game.teams) && game.teams.length && p.team) {
      const ti = game.teams.findIndex((t) => t.key === p.team);
      if (ti >= 0) return teamColour(game.teams[ti], ti);
    }
    const idx = playerOrder.findIndex((x) => x.id === p.id);
    return idx % 2 === 0 ? C.overDark : "#E0C25E";
  };
  const colTmpl = `58px ${cols.map((c) => (c.type === "divider" ? "10px" : "minmax(58px, 1fr)")).join(" ")}`;
  const cell: React.CSSProperties = { position: "relative", background: C.cell, borderRadius: 6, height: 42, display: "flex", alignItems: "center", justifyContent: "center" };
  const agg: React.CSSProperties = { position: "relative", background: C.greenLight, borderRadius: 6, height: 30, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 15, fontWeight: 800 };

  const isStrokePlay = game.game_type === "stroke";   // 212.22: net score badges, not Stableford points
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


  // 212.14 (owner): a SCRAMBLE's card — one header per team (name, team handicap, every member with their course
  // handicap, the running score) and a compact table (Hole · Par · SI · one score column per team; Out / In / Total).
  // It used the per-player layout: a crunched one-line team header and a thumb-high box per hole, 18 times over.
  // Cells open the same score editor (drives, saving and permissions unchanged).
  const scrambleBody = () => {
    const teams = cols.filter((c): c is Extract<typeof c, { type: "player" }> => c.type === "player" && !!c.altSide);
    const canEdit = (c: (typeof teams)[number]) => !readOnly && (isMarker || c.altSide!.memberIds.some((id) => strokePool.find((x) => x.id === id)?.user_id === user?.id));
    const toPar = (n: number) => (n === 0 ? "E" : n > 0 ? `+${n}` : String(n));
    const tot = (c: (typeof teams)[number], from: number, to: number) => {
      let g = 0, net = 0, par = 0, thru = 0;
      for (let k = from; k <= to && k < meta.length; k++) {
        const v = c.p.scores?.[k] ?? null;
        if (v != null && v > 0) { g += v; net += v - recvFor(c.p, meta[k].si); par += meta[k].par; thru++; }
      }
      return { g, net, toPar: net - par, thru };
    };
    const driveOf = (c: (typeof teams)[number], k: number) => {
      const key = altShotScores.find((r) => r.foursome_id === c.altSide!.foursomeId && r.side === c.altSide!.side && r.hole_index === k)?.drive_key;
      const who = key ? strokePool.find((x) => pkey(x) === key) : null;
      return who ? shortOf(who.display_name) : null;
    };
    const grid = `40px 32px 32px repeat(${teams.length}, minmax(0, 1fr))`;
    const subRow = (label: string, from: number, to: number) => (
      <div key={label} style={{ display: "grid", gridTemplateColumns: grid, gap: 6, alignItems: "center", marginTop: 6, marginBottom: 6 }}>
        <span style={{ gridColumn: "span 3", color: C.gold, fontSize: 12, fontWeight: 800, letterSpacing: 1 }}>{label}</span>
        {teams.map((c) => { const t = tot(c, from, to); return (
          <div key={c.p.id} style={{ background: C.greenLight, borderRadius: 8, padding: "4px 10px", textAlign: "center" }}>
            <span style={{ color: C.cream, fontSize: 15, fontWeight: 800 }}>{t.thru ? t.g : "—"}</span>
            {t.thru ? <span style={{ color: C.sage, fontSize: 11, fontWeight: 700, marginLeft: 6 }}>net {t.net}</span> : null}
          </div>
        ); })}
      </div>
    );
    return (
      <div data-scramble-card>
        {/* one header per team */}
        <div style={{ display: "grid", gridTemplateColumns: teams.length > 1 ? "1fr 1fr" : "1fr", gap: 8, marginBottom: 10 }}>
          {teams.map((c) => {
            const t = tot(c, 0, meta.length - 1);
            return (
              <div key={c.p.id} data-scramble-team-header style={{ background: C.greenLight, borderRadius: 12, padding: "8px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ color: C.cream, fontSize: 16, fontWeight: 800 }}>{c.altSide!.name}</span>
                  <span style={{ color: C.gold, fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>{game.scramble_handicap === "gross" ? "gross" : `Team hcp ${c.altSide!.sideCh ?? "–"}`}</span>
                </div>
                {c.altSide!.memberIds.map((id, mi) => {
                  const m = strokePool.find((x) => x.id === id);
                  return (
                    <div key={id} style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 4, fontSize: 13 }}>
                      <span style={{ color: C.cream }}>{c.altSide!.memberNames[mi]}</span>
                      {m ? <span style={{ color: C.sage }}>{Number(chBasis(m, game.course_par, meta.length) ?? 0).toFixed(1)}</span> : null}
                    </div>
                  );
                })}
                <div style={{ color: C.sage, fontSize: 12, marginTop: 6, borderTop: `1px solid ${C.borderGreen}`, paddingTop: 6 }}>
                  {/* 212.16: two deliberate lines (one wrapped awkwardly at phone width) */}
                  {t.thru ? <><div>Thru {t.thru}</div><div><b style={{ color: C.cream }}>{t.g}</b> gross · <b style={{ color: C.cream }}>{t.net}</b> net ({toPar(t.toPar)})</div></> : "Not started"}
                </div>
              </div>
            );
          })}
        </div>
        {/* 212.16: team v team — the match status first (the leaderboard's own calculation) */}
        {game.scramble_mode === "match" && teams.length === 2 ? (() => {
          const m = scrambleResults(game, strokePool as never, altShotScores as never).matches.find((x) => x.groupId === teams[0].altSide!.foursomeId);
          return m ? <div data-scramble-match-status style={{ background: C.greenLight, borderRadius: 10, padding: "8px 12px", marginBottom: 10, color: C.cream, fontSize: 16, fontWeight: 800, textAlign: "center" }}>{m.line}</div> : null;
        })() : null}
        <div style={{ color: C.sage, fontSize: 11, marginBottom: 6 }}>dots = team strokes · colour = net v par{game.scramble_min_drives ? " · initials = whose drive" : ""}</div>
        {/* the table */}
        <div style={{ display: "grid", gridTemplateColumns: grid, gap: 6, color: C.sage, fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
          <span>Hole</span><span>Par</span><span>SI</span>
          {teams.map((c) => <span key={c.p.id} style={{ textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{teams.length > 1 ? c.altSide!.name : "Score"}</span>)}
        </div>
        {meta.map((m, k) => (
          <React.Fragment key={k}>
            <div id={`grphole-${k}`} style={{ display: "grid", gridTemplateColumns: grid, gap: 6, alignItems: "center", marginBottom: 6 }}>
              <span style={{ color: C.cream, fontSize: 15, fontWeight: 800 }}>{m.n}</span>
              <span style={{ color: C.cream, fontSize: 13 }}>{m.par}</span>
              <span style={{ color: C.sage, fontSize: 12 }}>{m.si ?? "–"}</span>
              {teams.map((c) => {
                const gross = c.p.scores?.[k] ?? null, recv = recvFor(c.p, m.si), drive = game.scramble_min_drives ? driveOf(c, k) : null;
                const editable = canEdit(c);
                return (
                  <div key={c.p.id} data-scramble-cell onClick={editable ? () => { setEdit({ playerId: c.p.id, holeIdx: k, alt: { foursomeId: c.altSide!.foursomeId, side: c.altSide!.side } }); } : undefined}
                    style={{ position: "relative", background: C.cell, borderRadius: 8, height: 40, display: "flex", alignItems: "center", justifyContent: "center", cursor: editable ? "pointer" : "default" }}>
                    {cellSets(c.p, m.si).map((r) => (
                      <div key={r.key} style={{ position: "absolute", left: 5, top: 4, display: "flex", gap: 2 }}>
                        {Array.from({ length: Math.min(Math.max(r.strokes, r.gives), 2) }).map((_, d) => strokeGlyph(r.key, BASIS_COLOR[r.key], r.strokes === 0 && r.gives > 0, d))}
                      </div>
                    ))}
                    <span style={{ fontSize: 20, fontWeight: 800, color: gross != null && gross > 0 ? netColor(gross, recv, m.par) : "#C7C2B0" }}>{gross != null && gross > 0 ? gross : "·"}</span>
                    {gross != null && gross > 0 ? <span style={{ position: "absolute", right: 6, bottom: 3, color: C.faint, fontSize: 11, fontWeight: 700 }}>net {gross - recv}</span> : null}
                    {drive ? <span style={{ position: "absolute", left: 6, bottom: 3, color: C.ink, fontSize: 11, fontWeight: 700 }}>{drive}</span> : null}
                  </div>
                );
              })}
            </div>
            {meta.length >= 18 && k === 8 ? subRow("OUT", 0, 8) : null}
            {meta.length >= 18 && k === 17 ? subRow("IN", 9, 17) : null}
          </React.Fragment>
        ))}
        {subRow("TOTAL", 0, meta.length - 1)}
      </div>
    );
  };

  const holeCard = (i: number) => {
    const m = meta[i];
    return (
      <div key={`hc${i}`} id={`grphole-${i}`} style={{ background: "#13352A", border: "1px solid #2E6B55", borderRadius: 10, padding: 8, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ color: C.cream, fontSize: 18, fontWeight: 800, lineHeight: 1 }}>Hole {m.n}</span>
          <span style={{ color: "#CFE3D8", fontSize: 13 }}>Par <b style={{ color: C.cream }}>{m.par}</b>{(() => {
            const multi = teesAt(i);
            if (multi.length > 1) return <span data-tee-yardages> · {multi.map((x, k) => <React.Fragment key={x.t}>{k ? " · " : ""}{x.t} <b style={{ color: C.cream }}>{x.y}</b></React.Fragment>)}</span>;
            const y = ydsAt(i, m.yards); return y ? <> · <b style={{ color: C.cream }}>{y}</b> yds</> : null;
          })()} · SI <b style={{ color: C.cream }}>{m.si ?? "–"}</b></span>
        </div>
        {game.game_type === "alt_shot" && Array.isArray(game.foursomes) ? (
          <div style={{ color: C.sage, fontSize: 11.5, marginBottom: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {(game.foursomes || []).flatMap((fr: { a?: string[]; b?: string[] }) =>
              [fr.a, fr.b].map((sideIds, si2) => {
                const first = si2 === 0 ? (fr as any).a_first : (fr as any).b_first;
                const d = altShotDrivers(sideIds, i, first);   // POSITION in the round, not the hole number
                if (!d) return null;
                const who = strokePool.find((q) => pkey(q) === d.driver);
                if (!who) return null;
                return (
                  <span key={`tee${fr ? si2 : si2}-${d.driver}`}>
                    <span style={{ color: C.gold }}>{"\u26F3"}</span>{" "}
                    <b style={{ color: C.cream, fontWeight: 700 }}>{shortOf(who)}</b> tees off
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
                  style={{ position: "relative", background: C.cell, borderRadius: 6, height: 56, display: "flex", alignItems: "center", justifyContent: "center", cursor: !readOnly && (isMarker || (c.altSide ? c.altSide.memberIds.some((id) => strokePool.find((x) => x.id === id)?.user_id === user?.id) : p.user_id === user?.id)) ? "pointer" : "default", outline: readOnly ? "none" : isMarker ? "1px solid #E6E0CC" : ((c.altSide ? c.altSide.memberIds.some((id) => strokePool.find((x) => x.id === id)?.user_id === user?.id) : p.user_id === user?.id) ? "1px dashed #C9BF9B" : "none") }}
                  onClick={!readOnly && (isMarker || (c.altSide ? c.altSide.memberIds.some((id) => strokePool.find((x) => x.id === id)?.user_id === user?.id) : p.user_id === user?.id)) ? () => { setEdit({ playerId: p.id, holeIdx: i, alt: c.altSide ? { foursomeId: c.altSide.foursomeId, side: c.altSide.side } : undefined }); } : undefined}>
                  {/* One row per stroke basis, from lib/game-shape.strokeSets — the same source and the
                      same colours as the personal card (185.0). Before this the second row used
                      C.indivDot, a colour tuned for dark grounds: 1.83:1 on these cream cells, so the
                      course-handicap dots were effectively invisible here. */}
                  {cellSets(p, m.si).map((r) => (
                    <div key={r.key} style={{ position: "absolute", left: 5, display: "flex", gap: 2, ...DOT_SLOT[r.key] }}>
                      {Array.from({ length: Math.min(Math.max(r.strokes, r.gives), 2) }).map((_, d) =>
                        strokeGlyph(r.key, BASIS_COLOR[r.key], r.strokes === 0 && r.gives > 0, d),
                      )}
                    </div>
                  ))}
                  <span style={{ fontSize: 26, fontWeight: 800, color: gross != null && gross > 0 ? netColor(gross, recv, m.par) : "#C7C2B0" }}>{gross != null && gross > 0 ? gross : m.par}</span>
                  {c.altSide && gross != null && gross > 0 && <span style={{ position: "absolute", bottom: 3, right: 4, color: C.faint, fontSize: 11, fontWeight: 800 }}>net {gross - recv}</span>}
                  {/* Stableford points are scored off the COURSE handicap. The second box here used to
                      show points computed on the MATCH basis — a number nobody scores — so it is gone (185.0). */}
                  {/* 212.22 (owner): in STROKE PLAY the same badge shows the hole's NET score — points decide nothing there */}
                  {!c.altSide && gross != null && gross > 0 && (relBasis && !isStrokePlay ? (
                    <>
                      <span style={{ position: "absolute", bottom: 3, right: 3, minWidth: 16, height: 16, padding: "0 2px", border: `1.5px solid ${C.borderCard}`, borderRadius: 6, background: C.cellChip, color: C.ink, fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{bPts ?? 0}</span>
                    </>
                  ) : (
                    <span data-net-badge={isStrokePlay ? "" : undefined} style={{ position: "absolute", bottom: 3, right: 4, background: C.green, color: "#fff", fontSize: 11, fontWeight: 800, padding: "0 6px", borderRadius: 6 }}>{isStrokePlay ? `net ${gross - recv}` : (oPts ?? 0)}</span>
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
                {/* Second Stableford box removed (185.0): it showed points computed on the MATCH
                    basis, which is not a number anyone scores. Points are off the course handicap. */}
                {!c.altSide && s.g > 0 && (relBasis && !isStrokePlay ? (
                  <>
                    <span style={{ position: "absolute", bottom: 3, right: 3, minWidth: 15, height: 15, padding: "0 2px", border: `1.5px solid ${C.sage}`, borderRadius: 6, color: C.cream, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{s.cPts}</span>
                  </>
                ) : (
                  <span style={{ position: "absolute", bottom: 3, right: 4, background: C.green, color: "#E4CF86", fontSize: 11, fontWeight: 800, padding: "0 5px", borderRadius: 6 }}>{isStrokePlay ? `net ${s.net}` : s.mPts}</span>
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
      {readOnly ? (
        <div style={{ color: C.gold, fontSize: 12, marginBottom: 8 }}>Viewing scores — scoring is available on your primary device.</div>
      ) : offline ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#3A2A12", border: `0.5px solid ${C.gold}`, borderRadius: 10, padding: "8px 12px", marginBottom: 8 }}>
          <span style={{ fontSize: 14 }}>📴</span>
          <span style={{ color: "#E4CF86", fontSize: 12, flex: 1 }}>Offline — you can’t change who’s scoring until you reconnect. The current scorer can keep entering; everything saves on this phone.</span>
        </div>
      ) : teeMode ? (
        groupLocked ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#2A2A2A", border: `0.5px solid ${C.gold}`, borderRadius: 10, padding: "8px 12px", marginBottom: 8 }}>
            <span style={{ color: C.gold, fontSize: 14 }}>🔒</span>
            <span style={{ color: "#E4CF86", fontSize: 12, flex: 1 }}>{groupLabel} · final — scores locked{game.game_type === "alt_shot" ? ". Alternate Shot does not post individual handicap rounds." : " and posted to each player’s Rounds tab."}</span>
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
      {game.game_type === "scramble" ? scrambleBody() : (<>
      <div style={{ display: "flex", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ color: "#7FD0A0", fontSize: 11 }}>● under</span>
        <span style={{ color: "#6FA8DC", fontSize: 11 }}>● par</span>
        <span style={{ color: "#E0796B", fontSize: 11 }}>● over (net)</span>
        {(() => {
          // Name every basis the cells actually draw. "match hcp" said neither WHOSE strokes nor off
          // WHOM — one label for two different rules (off your opponent vs off the foursome low), and
          // a Trifecta has both at once. This legend sits on the dark green header, so it uses the
          // *Dark* colour variants of the same three bases (185.0).
          const DARK: Record<string, string> = {
            course: C.basisCourseDark, opponent: C.basisOpponentDark, group_low: C.basisGroupLowDark, alt_side: C.basisOpponentDark,
          };
          // The legend is CARD-WIDE, so its labels must be generic. Building them from strokeSets took
          // the first player's label and printed one player's opponent as everyone's key — on a
          // four-player card that is wrong for three of them (641032 read "v Michael"). The per-player
          // header lines below name each player's own opponent; those stay specific.
          const GENERIC: Record<string, string> = {
            opponent: "v opponent", group_low: "off the low", course: "course hcp", alt_side: "your side", team: "team hcp",
          };
          const seen = new Map<string, string>();
          for (const p of players) for (const m of meta) for (const r of strokeSets(game, p, m.si, strokePool)) if (!seen.has(r.key)) seen.set(r.key, GENERIC[r.key] ?? r.label);
          if (!seen.size) return null;
          return <>
            {Array.from(seen.entries()).map(([key, label]) => (
              <span key={key} style={{ color: DARK[key], fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}>{strokeGlyph(key, DARK[key], false, key)} {label}</span>
            ))}
            <span style={{ color: C.faint, fontSize: 11 }}>dots = strokes &middot; box = {isStrokePlay ? "net score" : "net Stableford"}</span>
          </>;
        })()}
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
                    <div style={{ color: C.sage, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.altSide.memberNames.map((n) => shortOf(n)).join(" / ")}</div>
                    {game.game_type !== "scramble" ? <div style={{ color: C.sage, fontSize: 11 }}>playing hcp {c.altSide.sideCh == null ? "–" : Number(c.altSide.sideCh.toFixed(2))}</div> : null}
                    {game.game_type === "scramble"
                      ? <div style={{ color: C.gold, fontSize: 11, fontWeight: 700 }}>{game.scramble_handicap === "gross" ? "gross" : `team hcp ${c.altSide.sideCh ?? "–"}`}</div>
                      : <div style={{ color: c.altSide.receiving ? C.gold : C.sage, fontSize: 11, fontWeight: 700 }}>{c.altSide.receiving ? `gets ${c.altSide.matchStrokes}` : "plays scratch"}</div>}
                  </>
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: 3 }}><Avatar src={p.avatar_url} name={p.display_name} cssSize="min(54px, 90%)" accent={colorFor(p)} /></div>
                    <div style={{ color: C.cream, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.display_name}{p.is_guest ? " ·G" : ""}</div>
                    {(() => {
                      const matchHcp = meta.reduce((a, m) => a + recvFor(p, m.si), 0);
                      const courseHcp = meta.reduce((a, m) => a + indRecvFor(p, m.si), 0);
                      if (!relBasis) return <div style={{ color: C.sage, fontSize: 11 }}>hcp {matchHcp}</div>;
                      const line = (key: string, color: string, label: string, val: number) => (<div style={{ color: C.sage, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 3, whiteSpace: "nowrap" }}><span style={{ display: "inline-flex", flex: "none" }}>{strokeGlyph(key, color, false, key)}</span>{label} {val}</div>);
                      // Totals per basis, labelled by basis. Header sits on dark green.
                      const sets = strokeSets(game, p, null, strokePool);
                      const totalFor = (key: string) => meta.reduce((a, m) => a + (strokeSets(game, p, m.si, strokePool).find((r) => r.key === key)?.strokes || 0), 0);
                      const DARKH: Record<string, string> = {
                        course: C.basisCourseDark, opponent: C.basisOpponentDark, group_low: C.basisGroupLowDark, alt_side: C.basisOpponentDark,
                      };
                      return <>{sets.map((r) => line(r.key, DARKH[r.key], r.label, totalFor(r.key)))}</>;
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
      </>)}

      {!readOnly && edit && (() => {
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
          if (sideCol?.altSide) {
            const sideCols = cols.filter((c): c is Extract<Col, { type: "player" }> => c.type === "player" && !!c.altSide);
            const idx = sideCols.findIndex((c) => c.altSide!.foursomeId === sideCol.altSide!.foursomeId && c.altSide!.side === sideCol.altSide!.side);
            for (let k = 1; k <= sideCols.length; k++) {
              const cand = sideCols[(idx + k) % sideCols.length];
              if ((cand.p.scores?.[edit.holeIdx] ?? null) == null) {
                setEdit({ playerId: cand.p.id, holeIdx: edit.holeIdx, alt: { foursomeId: cand.altSide!.foursomeId, side: cand.altSide!.side } });
                return;
              }
            }
            setEdit(null);
            return;
          }
          const needs = (pl: Player) => !pl.no_show && pl.id !== edit.playerId && ((pl.scores?.[edit.holeIdx] ?? null) == null || (pl.scores?.[edit.holeIdx] ?? 0) <= 0);
          const idx = order.findIndex((x) => x.id === edit.playerId);
          for (let k = 1; k <= order.length; k++) {
            const cand = order[(idx + k) % order.length];
            if (needs(cand)) { setEdit({ playerId: cand.id, holeIdx: edit.holeIdx }); return; }
          }
          setEdit(null);
        };
        return (
          <HoleScoreModal
            title={`${sideCol?.altSide ? `${sideCol.altSide.name} · ${game.game_type === "scramble" ? "team" : "playing"} hcp ${sideCol.altSide.sideCh == null ? "–" : Number(sideCol.altSide.sideCh.toFixed(2))}` : p.display_name} · Hole ${m.n}`}
            par={m.par}
            si={m.si ?? null}
            yardage={teeYds(strokePool.find((x) => x.id === edit.playerId)?.tee_name, edit.holeIdx) ?? ydsAt(edit.holeIdx, m.yards)}   /* 212.21: the tapped player's tee */
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
            onPatch={(patch) => { if (sideCol?.altSide && edit.alt && game.game_type === "scramble" && onSetScrambleScore) { onSetScrambleScore(edit.alt.foursomeId, edit.alt.side, edit.holeIdx, patch.strokes ?? null, scrambleDriveAt(altShotScores, edit.alt.foursomeId, edit.alt.side, edit.holeIdx)); } else if (sideCol?.altSide && edit.alt && onSetAltShotScore) { onSetAltShotScore(edit.alt.foursomeId, edit.alt.side, edit.holeIdx, patch.strokes ?? null); } else if (scoreLocked) { const { strokes: _s, ...statsOnly } = patch; onSetHole(p.id, edit.holeIdx, statsOnly); } else { onSetHole(p.id, edit.holeIdx, patch); } }}
            onNext={scoreLocked ? () => { const ni = edit.holeIdx + 1; if (ni < meta.length) setEdit({ playerId: p.id, holeIdx: ni }); else setEdit(null); } : goNext}
            onClose={() => setEdit(null)}
            belowPicker={game.game_type === "scramble" && sideCol?.altSide && edit.alt && game.scramble_min_drives && onSetScrambleScore ? (() => {
              const team = sideCol.altSide!; const alt = edit.alt!;
              const keys = team.memberIds.map((id) => { const q = strokePool.find((x) => x.id === id); return q ? pkey(q) : id; });
              const drives = Array.from({ length: meta.length }, (_, hi) => scrambleDriveAt(altShotScores, alt.foursomeId, alt.side, hi));
              const tally = driveTally(drives, keys, game.scramble_min_drives ?? null, meta.length);
              const current = drives[edit.holeIdx];
              return (
                <div data-scramble-drives style={{ marginTop: 10 }}>
                  <div style={{ color: C.sage, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>WHOSE DRIVE?</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                    {keys.map((k, ki) => (
                      <button key={k} type="button" onClick={() => onSetScrambleScore(alt.foursomeId, alt.side, edit.holeIdx, gross ?? null, current === k ? null : k)}
                        style={{ ...btn(current === k), padding: "8px 12px", fontSize: 12 }}>{shortOf(team.memberNames[ki])} {tally.counts[k] ?? 0}{current === k ? " ✓" : ""}</button>
                    ))}
                  </div>
                  {tally.needs.length ? <div style={{ color: C.gold, fontSize: 11.5, marginTop: 6 }}>{tally.needs.map((x) => `${shortOf(team.memberNames[keys.indexOf(x.player)])} needs ${x.more} more${x.short ? " — can no longer make it" : ""}`).join(" · ")} · {tally.needs[0].holesLeft} holes left</div> : null}
                </div>
              );
            })() : <ContestHoleChip gameId={game.id} hole={m.n} players={players} userId={user.id} myName={players.find((x: Player) => x.user_id === user.id)?.display_name || "Me"} canLogOthers={!!isMarker} />}
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
/** 212.45/212.46: "Start over" for the groups — clears every group choice. In Manage Game it's allowed only before scores
 * are entered (the setup rule "clear_groups"); when blocked, tapping it explains how to redo the groups instead. */
function GroupsStartOver({ onClear, blocked, disabled }: { onClear: () => Promise<void>; blocked?: string | null; disabled?: boolean }) {
  const [why, setWhy] = React.useState<string | null>(null);
  return (
    <>
      <button data-groups-start-over disabled={disabled} onClick={() => { if (blocked) setWhy(blocked); else { setWhy(null); void onClear(); } }}
        style={{ ...btn(false), fontSize: 13, marginLeft: 8, opacity: blocked ? 0.75 : 1 }}>Start over</button>
      {why ? <div data-groups-start-over-blocked style={{ color: C.gold, fontSize: 12, lineHeight: 1.45, marginTop: 8 }}>{why}</div> : null}
    </>
  );
}

export function GroupsBuilder({ game, players, onSetTeeGroup, onSetTeamGroupSlot, onSetAltShotFirstDriver, onSetTrifectaPairing, onBalanceMatchups, onClearGroups, clearGroupsBlocked, getTeeGroupPolicy, onRandomize, canRandomize = false, randomizeReason = "", randomizing = false, overflowIds = [] }: {
  game: Game; players: Player[];
  onSetTeeGroup: (p: Player, group: number | null) => Promise<void>;
  onSetTeamGroupSlot?: (current: Player | null, next: Player | null, group: number) => Promise<void>;
  onSetAltShotFirstDriver?: (foursomeId: string, side: "a" | "b", playerKey: string) => Promise<void>;
  onSetTrifectaPairing?: (foursomeId: string, cross: boolean) => Promise<void>;
  getTeeGroupPolicy?: (p: Player, group: number | null) => { blocked: boolean; reason?: string };
  onRandomize?: () => Promise<void>;
  canRandomize?: boolean; randomizeReason?: string; randomizing?: boolean; overflowIds?: string[];
  onBalanceMatchups?: () => Promise<void>;
  /** 212.45 (owner, Oct 26): clear every group choice — "if I build balanced groups and don't like it, start over". */
  onClearGroups?: () => Promise<void>;
  /** Why Start over isn't allowed right now (scores entered) — shown when tapped. */
  clearGroupsBlocked?: string | null;
}) {
  const byKey = (k: string) => players.find((p) => pkey(p) === k) || null;
  const groupOptions = Array.from({ length: Math.max(2, Math.ceil(players.length / 2) + 1) }, (_, i) => i + 1);

  type Unit = { id: string; label: string; members: Player[] };
  const pairings = Array.isArray(game.pairings) ? game.pairings : [];
  const foursomes = Array.isArray(game.foursomes) ? game.foursomes : [];
  let units: Unit[];
  const sh = shapeOf(game);
  const teamGroupsOwnStructure = sh.usesTeams && (game.game_type === "fourball" || game.game_type === "alt_shot" || game.game_type === "trifecta" || game.game_type === "scramble");   // 212.5: + a Ryder Cup scramble
  const scoringStarted = players.some((p) => (p.scores || []).some((x) => x != null) || p.group_locked) || !!game.alt_shot_scoring_started_at;
  if (sh.usesFoursomes && foursomes.length && !teamGroupsOwnStructure) {
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
    units = sortByName(players).map((p) => ({ id: p.id, label: p.display_name, members: [p] }));   // 212.48: alphabetical
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

  if (teamGroupsOwnStructure && Array.isArray(game.teams) && game.teams.length === 2) {
    return <TeamGroupsBuilder game={game} players={players} onClearGroups={onClearGroups} clearGroupsBlocked={clearGroupsBlocked} onSetTeamGroupSlot={onSetTeamGroupSlot} onSetAltShotFirstDriver={onSetAltShotFirstDriver} onSetTrifectaPairing={onSetTrifectaPairing} onBalanceMatchups={onBalanceMatchups} onRandomize={onRandomize} canRandomize={canRandomize} randomizeReason={randomizeReason} randomizing={randomizing} />;
  }

  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 12 }}>
      <Eyebrow>GROUPS · WHO TEES OFF TOGETHER</Eyebrow>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>
        {teamGroupsOwnStructure
          ? "Assign each player to a playing group. For Four-Ball and Alternate Shot, the two teams inside that group automatically define the match — no separate Matchups step."
          : foursomes.length
          ? "Each foursome is already a group — set the group number to order who tees off first."
          : pairings.length
          ? "Put the matches that tee off together in the same group — usually two matches make a foursome."
          : "Split players into the groups that tee off together (foursomes, 3-balls, or 2-balls). One scorer per group keeps the cards, or players score themselves."}
      </div>
      {scoringStarted && (
        <div style={{ background: "rgba(201,162,39,.12)", border: `1px solid ${C.gold}`, borderRadius: 10, padding: "9px 11px", color: C.cream, fontSize: 11.5, lineHeight: 1.45, marginTop: 10 }}>
          Scoring is in progress. Players who have scored, and finished/locked groups, cannot be moved. An unscored player may join an active group with confirmation.
        </div>
      )}

      {onRandomize && (teamGroupsOwnStructure || !foursomes.length) && !pairings.length && (
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => { if (canRandomize) onRandomize(); }}
            disabled={!canRandomize || randomizing}
            style={{ ...btn(true), fontSize: 13, opacity: canRandomize && !randomizing ? 1 : 0.62, cursor: canRandomize && !randomizing ? "pointer" : "not-allowed" }}>
            {randomizing ? "Shuffling…" : "🎲 Randomize groups"}
          </button>
          {onClearGroups && players.some((p) => p.tee_group != null) ? <GroupsStartOver onClear={onClearGroups} blocked={clearGroupsBlocked} disabled={randomizing} /> : null}
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
                {game.game_type === "alt_shot" && Array.isArray(game.teams) && game.teams.length === 2 && (() => {
                  const f = foursomes.find((x) => [...x.a, ...x.b].some((k) => mem.some((p) => pkey(p) === k)));
                  if (!f) return null;
                  return <div style={{ marginTop: 9, borderTop: `1px solid ${C.borderCard}`, paddingTop: 8 }}>
                    {(["a", "b"] as const).map((side, si) => {
                      const ids = f[side] || [];
                      if (ids.length !== 2) return <div key={side} style={{ color: C.gold, fontSize: 11, marginTop: 4 }}>{game.teams![si].name}: assign exactly 2 players</div>;
                      const chosen = side === "a" ? f.a_first : f.b_first;
                      return <label key={side} style={{ display: "block", color: C.sage, fontSize: 11, marginTop: 6 }}>
                        {game.teams![si].name} · tees off first
                        <select value={chosen || ""} onChange={(e) => e.target.value && onSetAltShotFirstDriver?.(f.id, side, e.target.value)} style={{ ...inputStyle, width: "100%", marginTop: 3, padding: "8px 12px", fontSize: 12 }}>
                          <option value="">Select player…</option>
                          {[...ids].sort((x, y) => byName({ display_name: byKey(x)?.display_name }, { display_name: byKey(y)?.display_name })).map((id) => <option key={id} value={id}>{byKey(id)?.display_name || id}</option>)}
                        </select>
                      </label>;
                    })}
                  </div>;
                })()}
                <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>Scorer: chosen on the course</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TeamGroupsBuilder({ game, players, onSetTeamGroupSlot, onSetAltShotFirstDriver, onSetTrifectaPairing, onRandomize, onBalanceMatchups, onClearGroups, clearGroupsBlocked, canRandomize, randomizeReason, randomizing }: {
  game: Game;
  players: Player[];
  onSetTeamGroupSlot?: (current: Player | null, next: Player | null, group: number) => Promise<void>;
  onSetAltShotFirstDriver?: (foursomeId: string, side: "a" | "b", playerKey: string) => Promise<void>;
  onSetTrifectaPairing?: (foursomeId: string, cross: boolean) => Promise<void>;
  onRandomize?: () => Promise<void>;
  onBalanceMatchups?: () => Promise<void>;
  onClearGroups?: () => Promise<void>;
  clearGroupsBlocked?: string | null;
  canRandomize: boolean;
  randomizeReason: string;
  randomizing: boolean;
}) {
  const teams = game.teams!;
  // 212.5: players per side in each group — 2 for four-ball / alternate shot / trifecta; a Ryder Cup scramble
  // session's own size (2, 3 or 4)
  const perSide = game.game_type === "scramble" ? Number(game.scramble_team_size) || 2 : 2;
  const foursomes = Array.isArray(game.foursomes) ? game.foursomes : [];
  const byKey = (key: string) => players.find((p) => pkey(p) === key) || null;
  const ph = (p: Player) => applyAllowance(chBasis(p, game.course_par, game.holes_meta?.length), game.allowance_pct ?? 100);
  const label = (p: Player) => `${p.display_name} · PH ${ph(p)}`;
  const assignedGroups = players.map((p) => p.tee_group).filter((g): g is number => g != null);
  const maxExisting = assignedGroups.length ? Math.max(...assignedGroups) : 0;
  const groupCount = Math.max(1, maxExisting, Math.ceil(Math.max(...teams.map((t) => players.filter((p) => p.team === t.key).length)) / perSide));
  const unassigned = players.filter((p) => p.tee_group == null && !p.no_show);
  // 212.45: a group is ready at two a side — or as the one 2 v 1 group an odd four-ball / trifecta field allows (lib/grouping)
  const groupSides = (group: number) => teams.map((t) => players.filter((p) => p.tee_group === group && p.team === t.key && !p.no_show).length) as [number, number];
  const shortGroups = Array.from({ length: groupCount }, (_, i) => groupSides(i + 1)).filter(([x, y]) => (x > 0 || y > 0) && !(x === perSide && y === perSide)).length;
  const groupReady = (group: number) => { const [x, y] = groupSides(group); return groupShapeOk(game.game_type, x, y, shortGroups, perSide); };
  const readyCount = Array.from({ length: groupCount }, (_, i) => i + 1).filter(groupReady).length;
  const scoringStarted = players.some((p) => (p.scores || []).some((score) => score != null) || p.group_locked) || !!game.alt_shot_scoring_started_at;

  const selectFor = (teamKey: string, group: number, slot: number) => {
    const inGroup = players.filter((p) => p.team === teamKey && p.tee_group === group && !p.no_show);
    const current = inGroup[slot] || null;
    const choices = teamGroupSlotChoices(players, teamKey, group, current?.id || null);
    return (
      <select
        aria-label={`Group ${group} ${teams.find((t) => t.key === teamKey)?.name || "team"} player ${slot + 1}`}
        value={current?.id || ""}
        disabled={!onSetTeamGroupSlot || scoringStarted}
        onChange={(e) => {
          const next = players.find((p) => p.id === e.target.value) || null;
          void onSetTeamGroupSlot?.(current, next, group);
        }}
        style={{ ...inputStyle, width: "100%", minWidth: 0, padding: "8px 12px", fontSize: 12 }}
      >
        <option value="">{current ? "Move to unassigned" : "Select player…"}</option>
        {choices.sort(byName).map((p) => <option key={p.id} value={p.id}>{label(p)}{p.tee_group != null && p.id !== current?.id ? ` · Group ${p.tee_group}` : ""}</option>)}
      </select>
    );
  };

  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 12 }}>
      <Eyebrow>GROUPS · BUILD EACH MATCH</Eyebrow>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 8, lineHeight: 1.45 }}>
        {game.game_type === "scramble"
          ? <>Each group is one match: its {teams[0].name} players are one scramble team, its {teams[1].name} players the other — exactly {perSide} of each.</>
          : <>Each {game.game_type === "alt_shot" ? "Alternate Shot" : game.game_type === "trifecta" ? "Trifecta" : "Four-Ball"} group needs exactly two {teams[0].name} and two {teams[1].name} players{allowsOneShortGroup(game.game_type) ? <> — with an odd number, one group plays 2 v 1 ({game.game_type === "trifecta" ? "the lone player plays a single against each opponent" : "the lone player's ball against the pair's best ball"})</> : null}.</>} Team membership stays visible while you build the match.
      </div>
      {game.game_type === "trifecta" ? <div style={{ color: C.sage, fontSize: 11, marginTop: 6, lineHeight: 1.45 }}>Once four players are selected, choose the two Singles matchups inside that group.</div> : null}
      {scoringStarted ? <div style={{ background: "rgba(201,162,39,.12)", border: `1px solid ${C.gold}`, borderRadius: 10, padding: "8px 12px", color: C.cream, fontSize: 11.5, lineHeight: 1.45, marginTop: 10 }}>Groups and Trifecta Singles matchups are locked because scoring has started.</div> : null}
      {onRandomize ? <div style={{ marginTop: 12 }}>
        {onBalanceMatchups && (
          <button onClick={() => canRandomize && onBalanceMatchups()} disabled={!canRandomize || randomizing} style={{ ...btn(true), fontSize: 13, opacity: canRandomize && !randomizing ? 1 : 0.62, marginRight: 8 }}>
            {randomizing ? "Building…" : "⚖️ Build balanced matchups"}
          </button>
        )}
        <button onClick={() => canRandomize && onRandomize()} disabled={!canRandomize || randomizing} style={{ ...btn(false), fontSize: 13, opacity: canRandomize && !randomizing ? 1 : 0.62 }}>
          {randomizing ? "Building…" : "🎲 Build even groups"}
        </button>
        {onClearGroups && players.some((p) => p.tee_group != null) ? <GroupsStartOver onClear={onClearGroups} blocked={clearGroupsBlocked} disabled={randomizing} /> : null}
        <div style={{ color: C.sage, fontSize: 11, marginTop: 6, lineHeight: 1.45 }}>{canRandomize ? (game.game_type === "scramble"
          ? `Both buttons make teams of exactly ${perSide} from each side with handicaps spread evenly, one match per group. A starting point — captains can still move anyone afterwards.`
          : "Balanced matchups: like plays like — each team's strongest pair meets the other's strongest, and in a Trifecta the singles fall strong v strong, weak v weak. Even groups: spreads handicaps so every group is a similar mix. Either is a starting point — captains can still move anyone afterwards.") : randomizeReason}</div>
      </div> : null}

      <div style={{ marginTop: 12, padding: "8px 12px", borderTop: `1px solid ${C.borderGreen}`, borderBottom: `1px solid ${C.borderGreen}` }}>
        <div style={{ color: C.cream, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>UNASSIGNED PLAYERS</div>
        {teams.map((t, ti) => {
          const rows = unassigned.filter((p) => p.team === t.key);
          return <div key={t.key} style={{ marginTop: 6, color: C.sage, fontSize: 11.5, lineHeight: 1.4 }}><span style={{ color: teamColour(t, ti), fontWeight: 800 }}>{t.name}:</span> {rows.length ? rows.map(label).join(", ") : "None"}</div>;
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, color: C.sage, fontSize: 11, marginTop: 12 }}><b style={{ color: C.cream }}>{readyCount} of {groupCount} groups ready</b><span>{players.filter((p) => !p.no_show).length} players · {groupCount} matches</span></div>

      {Array.from({ length: groupCount }, (_, i) => i + 1).map((group) => {
        const sides = teams.map((t) => players.filter((p) => p.team === t.key && p.tee_group === group && !p.no_show));
        const ready = groupReady(group);   // 212.45: two a side, or the one allowed 2 v 1
        const extras = sides.flatMap((side) => side.slice(perSide));
        const f = foursomes.find((x) => [...x.a, ...x.b].some((key) => players.some((p) => p.tee_group === group && pkey(p) === key)));
        return <div key={group} style={{ background: C.greenMid, borderRadius: 12, padding: 12, marginTop: 10, border: `1px solid ${ready ? C.gold : C.borderGreen}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ color: C.cream, fontSize: 15, fontWeight: 800 }}>Group {group}</div><div style={{ marginLeft: "auto", color: ready ? "#FFE08A" : C.sage, fontSize: 11, fontWeight: 800 }}>{ready ? `✓ READY · ${sides[0].length} v ${sides[1].length}` : `NEEDS ${Math.max(0, 2 * perSide - sides.reduce((n, s) => n + Math.min(perSide, s.length), 0))} MORE`}</div></div>
          {teams.map((t, ti) => <div key={t.key} style={{ marginTop: 10, paddingTop: 9, borderTop: "1px solid rgba(178,203,189,.22)" }}>
            <div style={{ display: "flex", color: teamColour(t, ti), fontSize: 12, fontWeight: 800, marginBottom: 7 }}><span>{t.name}</span><span style={{ marginLeft: "auto", color: C.sage, fontSize: 11 }}>{sides[ti].length}/{perSide} selected</span></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 7 }}>{Array.from({ length: perSide }, (_, slot) => <React.Fragment key={slot}>{selectFor(t.key, group, slot)}</React.Fragment>)}</div>
          </div>)}
          {extras.map((p) => <button key={p.id} disabled={scoringStarted} onClick={() => void onSetTeamGroupSlot?.(p, null, group)} style={{ ...btn(false), width: "100%", marginTop: 7, color: C.overRedDark, fontSize: 11, opacity: scoringStarted ? .62 : 1 }}>Move extra player {p.display_name} to unassigned</button>)}
          {game.game_type === "alt_shot" && ready && f ? <div style={{ marginTop: 10, borderTop: `1px solid ${C.borderGreen}`, paddingTop: 9 }}>
            {(["a", "b"] as const).map((side, si) => <label key={side} style={{ display: "block", color: C.sage, fontSize: 11, marginTop: si ? 8 : 0 }}>{teams[si].name} · tees off first<select value={(side === "a" ? f.a_first : f.b_first) || ""} onChange={(e) => e.target.value && onSetAltShotFirstDriver?.(f.id, side, e.target.value)} style={{ ...inputStyle, width: "100%", marginTop: 3, padding: "8px 12px", fontSize: 12 }}><option value="">Select player…</option>{f[side].map((id) => <option key={id} value={id}>{byKey(id)?.display_name || id}</option>)}</select></label>)}
          </div> : null}
          {game.game_type === "trifecta" && ready && f ? <div style={{ marginTop: 10, borderTop: `1px solid ${C.borderGreen}`, paddingTop: 9 }}>
            <div style={{ color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>SINGLES MATCHUPS</div>
            <div style={{ color: C.sage, fontSize: 11, marginTop: 5 }}>Choose who faces whom. This does not change the Four-Ball teams.</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 7, marginTop: 8 }}>
              {([false, true] as const).map((cross) => {
                const pairs = cross
                  ? [[f.a[0], f.b[1]], [f.a[1], f.b[0]]]
                  : [[f.a[0], f.b[0]], [f.a[1], f.b[1]]];
                const selected = !!f.swap === cross;
                return <button key={String(cross)} type="button" disabled={scoringStarted || !onSetTrifectaPairing} onClick={() => void onSetTrifectaPairing?.(f.id, cross)} style={{ ...btn(selected), width: "100%", textAlign: "left", padding: "8px 12px", opacity: scoringStarted ? .62 : 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 800 }}>{selected ? "✓ " : ""}{cross ? "Cross" : "Straight"}</div>
                  {pairs.map(([a, b]) => <div key={`${a}-${b}`} style={{ fontSize: 11, fontWeight: 500, marginTop: 4, overflowWrap: "anywhere", lineHeight: 1.3 }}>{byKey(a)?.display_name || "—"} vs {byKey(b)?.display_name || "—"}</div>)}
                </button>;
              })}
            </div>
          </div> : null}
        </div>;
      })}
    </div>
  );
}

/**
 * Organizer control to publish / revoke a public live link. Used for a GAME's live scorecard and for
 * a Ryder Cup's whole-competition link (188.1) — one control, two paths, so the wording, the copy
 * affordance and the revoke button cannot drift apart between them.
 */
export function ShareControl({ game, onShare, token, path = "live", title, blurb }: {
  game?: Game;
  onShare: (on: boolean) => Promise<void>;
  /** Explicit token, for callers that are not a Game (a competition). Overrides game.share_token. */
  token?: string | null;
  /** URL segment under /: "live" for a game, "live/cup" for a competition. */
  path?: string;
  title?: string;
  blurb?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const tok = token !== undefined ? token : game?.share_token ?? null;
  const shared = !!tok;
  const link = shared && typeof window !== "undefined" ? `${window.location.origin}/${path}/${tok}` : "";
  const [failed, setFailed] = useState<string | null>(null);
  // Surface failures HERE. The Cup handler reported errors to a page-level banner far from this
  // button, so when the RPC failed the control simply did nothing and gave no reason (188.2).
  const toggle = async (on: boolean) => {
    setBusy(true); setFailed(null);
    try { await onShare(on); }
    catch (e) { setFailed(e instanceof Error ? e.message : "Couldn't update the link. Try again."); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  return (
    <div style={{ marginTop: 10, padding: "12px 14px", background: C.greenLight, borderRadius: 8 }}>
      <div style={{ color: C.cream, fontWeight: 700, fontSize: 13 }}>{title || "\u26f3 Live scorecard link"}</div>
      <div style={{ color: C.sage, fontSize: 11, marginTop: 4, lineHeight: 1.5 }}>{blurb || "Share a read-only live scorecard with anyone \u2014 no login needed. They can follow the action but can\u2019t join or change scores. Stays live for 3 days after the game ends."}</div>
      {failed && (
        <div style={{ color: C.overRedDark, fontSize: 12, marginTop: 8, fontWeight: 700 }}>{failed}</div>
      )}
      {!shared ? (
        <button disabled={busy} onClick={() => toggle(true)}
          style={{ ...btn(true), marginTop: 10, fontSize: 13, display: "block", opacity: busy ? 0.62 : 1 }}>
          {busy ? "Creating…" : "Create live link"}
        </button>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <input readOnly value={link} onFocus={(e) => e.currentTarget.select()}
              style={{ ...inputStyle, flex: 1, width: "auto", padding: "8px 12px", fontSize: 12 }} />
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

/** 211.1: whose drive a scramble team used on a hole (null when none recorded). */
function scrambleDriveAt(rows: AltShotScoreRow[], foursomeId: string, side: AltShotScoreSide, holeIdx: number): string | null {
  return rows.find((r) => r.foursome_id === foursomeId && r.side === side && r.hole_index === holeIdx)?.drive_key ?? null;
}
