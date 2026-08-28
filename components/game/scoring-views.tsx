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
import { pkey, chBasis, shapeOf, dotStrokes, fullStrokes, altShotSides } from "@/lib/game-shape";
import { decideSetupChange, type SetupAction } from "@/lib/game-setup-policy";
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
import { addPairing as nextPairingAdd, removePairing as nextPairingRemove, addFoursome as nextFoursomeAdd, removeFoursome as nextFoursomeRemove, renameFoursome as nextFoursomeRename, assignFoursomePlayer, unassignFoursomePlayer, deriveTeeGroupsFromFoursomes } from "@/lib/game-structure";

const supabase = createClient();

export function ScoreHistory({ gameId }: { gameId: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const toggle = async () => {
    const next = !open; setOpen(next);
    if (next && rows === null) {
      setLoading(true);
      const { data } = await supabase.rpc("admin_score_audit", { p_game: gameId });
      setRows(Array.isArray(data) ? data : []);
      setLoading(false);
    }
  };
  const fmtVal = (v: number | null) => (v == null ? "—" : String(v));
  const fmtWhen = (iso: string) => { try { const d = new Date(iso); return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); } catch { return iso; } };
  const fieldLabel: Record<string, string> = { score: "score", putts: "putts", penalties: "pen" };
  return (
    <div style={{ marginTop: 12 }}>
      <button onClick={toggle} style={{ ...btn(false), fontSize: 12, padding: "8px 12px", width: "100%" }}>
        {open ? "▴" : "▾"} Score history
      </button>
      {open && (
        <div style={{ background: C.greenLight, borderRadius: 12, padding: 12, marginTop: 8 }}>
          {loading ? (
            <div style={{ color: C.sage, fontSize: 13 }}>Loading…</div>
          ) : !rows || rows.length === 0 ? (
            <div style={{ color: C.sage, fontSize: 13, lineHeight: 1.5 }}>No changes recorded yet. Edits are logged from when migration 0042 is applied onward.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
              {rows.map((r) => (
                <div key={r.id} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12.5, color: C.cream, borderBottom: `1px solid ${C.green}`, paddingBottom: 4 }}>
                  <span style={{ color: C.gold, fontWeight: 700, minWidth: 64, whiteSpace: "nowrap" }}>H{r.hole_index + 1} {fieldLabel[r.field] || r.field}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>{r.player_name}: <b>{fmtVal(r.old_value)} → {fmtVal(r.new_value)}</b></span>
                  <span style={{ color: C.sage, fontSize: 11, whiteSpace: "nowrap" }}>{r.changed_by_name} · {fmtWhen(r.changed_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SkinsView({ game, players, user, isCreator, mode, onChanged }: { game: Game; players: Player[]; user: any; isCreator: boolean; mode: string; onChanged: () => void }) {
  const teams = game.teams || null;
  const shape = shapeOf(game);
  const isTeamSkins = shape.skinsStyle === "team_11" || shape.skinsStyle === "team_2v2";
  const isTeamBestBallSkins = shape.skinsStyle === "team_2v2";
  const playerOf = (uid: string) => players.find((p) => pkey(p) === uid) || null;
  const firstName = (uid: string) => (playerOf(uid)?.display_name || "—").split(" ")[0];
  const teamName = (key: string | null | undefined) => teams?.find((t) => t.key === key)?.name || "—";
  const skinPlayerOf = (uid: string): SkinPlayer | null => {
    const p = playerOf(uid);
    return p ? { id: pkey(p), name: p.display_name, gross: p.scores || [], ch: chBasis(p, game.course_par, game.holes_meta?.length), noShow: !!p.no_show } : null;
  };
  const ORANGE = "#E8730C";

  if (mode === "setup") {
    if (isTeamBestBallSkins) {
      return (
        <div style={{ marginTop: 18 }}>
          <Eyebrow>TEAM SKINS · SETUP</Eyebrow>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 8, marginBottom: 8 }}>
            Build team skins as best-ball foursomes. Each side's lowest net ball wins the hole; a halved hole carries the pot forward.
          </div>
          <FourballView game={game} players={players} user={user} isCreator={isCreator} mode="setup" onChanged={onChanged} />
        </div>
      );
    }
    return (
      <div style={{ marginTop: 18 }}>
        <Eyebrow>1:1 SKINS · SETUP</Eyebrow>
        <div style={{ color: C.sage, fontSize: 12, marginTop: 8, marginBottom: 8 }}>
          {isTeamSkins
            ? "Assign two teams, then pair players 1:1 across teams. Each matchup plays skins; won skins contribute to the player's team total. A halved hole carries to the next hole."
            : "Pair players just like singles match play. Each matchup has its own skin pot; a halved hole carries to the next hole."}
        </div>
        <MatchView game={game} players={players} user={user} isCreator={isCreator} mode="setup" onChanged={onChanged} />
      </div>
    );
  }

  const myKey = players.find((p) => p.user_id === user.id)?.user_id ?? user.id;
  // Skins counts can carry a half (split / halved ties) — render "3½", "½", "4".
  const fmtSkins = (n: number): string => { const whole = Math.floor(n); return n - whole >= 0.5 ? (whole === 0 ? "½" : `${whole}½`) : String(whole); };

  if (isTeamBestBallSkins) {
    const foursomes = game.foursomes || [];
    const cards = foursomes.map((f) => {
      const members: FourballMember[] = [...f.a, ...f.b].map((uid) => {
        const p = playerOf(uid);
        return { id: uid, gross: p?.scores || [], ch: p ? chBasis(p, game.course_par, game.holes_meta?.length) : null, noShow: !!p?.no_show };
      });
      const result = computeTeamBestBallSkins(game.holes_meta, members, f.a, f.b, game.allowance_pct ?? 100, game.team_score_mode === "aggregate" ? "aggregate" : "best_ball", game.skins_mode === "split" ? "halved" : "carryover");
      return { f, result };
    });
    const carrying = cards.reduce((s, c) => s + c.result.carryAtEnd, 0);
    const totalA = cards.reduce((s, c) => s + (c.result.skinsBySide.a || 0), 0);
    const totalB = cards.reduce((s, c) => s + (c.result.skinsBySide.b || 0), 0);

    return (
      <div style={{ marginTop: 18 }}>
        <Eyebrow>{`TEAM SKINS · ${game.team_score_mode === "aggregate" ? "AGGREGATE" : "BEST BALL"}${game.allowance_pct != null && game.allowance_pct !== 100 ? ` · ${game.allowance_pct}% ALLOWANCE` : ""}`}</Eyebrow>
        {carrying > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#5A3210", border: `1px solid ${ORANGE}`, borderRadius: 10, padding: "10px 12px", marginTop: 10 }}>
            <span style={{ color: ORANGE, fontSize: 18, fontWeight: 800 }}>↑</span>
            <span style={{ color: "#F2C28A", fontSize: 13 }}>{carrying} unresolved skin{carrying > 1 ? "s" : ""} carrying across team skins matches</span>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <div style={{ flex: 1, background: totalA >= totalB ? C.greenMid : C.greenLight, borderRadius: 12, padding: 14, textAlign: "center" }}>
            <div style={{ color: C.cream, fontWeight: 800 }}>{teams![0].name}</div>
            <div style={{ color: C.cream, fontSize: 32, fontWeight: 800, fontFamily: "Georgia, serif" }}>{fmtSkins(totalA)}</div>
          </div>
          <div style={{ flex: 1, background: totalB >= totalA ? C.greenMid : C.greenLight, borderRadius: 12, padding: 14, textAlign: "center" }}>
            <div style={{ color: C.cream, fontWeight: 800 }}>{teams![1].name}</div>
            <div style={{ color: C.cream, fontSize: 32, fontWeight: 800, fontFamily: "Georgia, serif" }}>{fmtSkins(totalB)}</div>
          </div>
        </div>

        {cards.length === 0 && <div style={{ background: C.greenLight, borderRadius: 12, padding: 18, marginTop: 12, color: C.sage }}>No team skins foursomes set yet. Open Game setup to build them.</div>}
        {cards.map(({ f, result }) => {
          const mine = f.a.includes(myKey) || f.b.includes(myKey);
          const aNames = f.a.map(firstName).join(" & ") || "Pair 1";
          const bNames = f.b.map(firstName).join(" & ") || "Pair 2";
          const halved = game.skins_mode === "split";
          return (
            <div key={f.id} style={{ background: C.greenLight, borderRadius: 12, padding: 14, marginTop: 12, border: mine ? `1px solid ${C.gold}` : "none" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <div style={{ color: C.cream, fontWeight: 800, fontSize: 15 }}>{f.name}{mine ? " · your match" : ""}</div>
                <div style={{ flex: 1 }} />
                <div style={{ color: C.cream, fontWeight: 800, fontFamily: "Georgia, serif" }}>{fmtSkins(result.skinsBySide.a || 0)}–{fmtSkins(result.skinsBySide.b || 0)}</div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <div style={{ flex: 1, background: C.greenLight, borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ color: C.gold, fontSize: 11, fontWeight: 800 }}>PAIR 1</div>
                  <div style={{ color: C.cream, fontSize: 13 }}>{f.a.map(firstName).join(" & ") || "—"}</div>
                </div>
                <div style={{ flex: 1, background: C.greenLight, borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ color: C.gold, fontSize: 11, fontWeight: 800 }}>PAIR 2</div>
                  <div style={{ color: C.cream, fontSize: 13 }}>{f.b.map(firstName).join(" & ") || "—"}</div>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                {result.holes.map((h) => {
                  const tiedCarry = h.decided && !h.winnerId;
                  const won = h.decided && h.winnerId;
                  const winnerLabel = h.winnerId === "a" ? aNames : h.winnerId === "b" ? bNames : "";
                  return (
                    <div key={h.hole} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: `1px solid ${C.borderCard}` }}>
                      <span style={{ width: 24, color: C.sage, fontWeight: 800, fontSize: 12 }}>{h.hole}</span>
                      <span style={{ flex: 1, color: C.cream, fontSize: 12 }}>{won ? `${winnerLabel} wins` : tiedCarry ? (halved ? "Halved · ½ each" : "Halved — carries") : "Not played yet"}</span>
                      {won ? <span style={{ background: C.greenLight, color: C.gold, fontSize: 11, padding: "3px 8px", borderRadius: 999 }}>{h.value} skin{h.value > 1 ? "s" : ""}</span> : tiedCarry ? <span style={{ background: "#5A3210", color: ORANGE, fontSize: 11, padding: "3px 8px", borderRadius: 999 }}>{halved ? "½ each" : "push →"}</span> : <span style={{ color: C.sage, fontSize: 11 }}>{h.value} at stake</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Only the 1:1 matchup view for TEAM 1:1 skins. Individual skins always uses the
  // per-player view, even if stray/stashed pairings linger on the row.
  if (isTeamSkins && game.pairings.length > 0) {
    const matchCards = game.pairings.map((pr, idx) => {
      const pa = skinPlayerOf(pr.a), pb = skinPlayerOf(pr.b);
      if (!pa || !pb) return null;
      return { idx, pr, pa, pb, result: computeHeadToHeadSkins(game.holes_meta, pa, pb, game.allowance_pct ?? 100) };
    }).filter(Boolean) as { idx: number; pr: { a: string; b: string }; pa: SkinPlayer; pb: SkinPlayer; result: ReturnType<typeof computeHeadToHeadSkins> }[];
    const totals: Record<string, number> = {};
    matchCards.forEach(({ result }) => Object.entries(result.skinsBySide).forEach(([id, n]) => { totals[id] = (totals[id] || 0) + n; }));
    const teamTotals: Record<string, number> = { A: 0, B: 0 };
    if (isTeamSkins) {
      players.forEach((p) => {
        if (p.team === "A" || p.team === "B") teamTotals[p.team] += totals[pkey(p)] || 0;
      });
    }
    const carrying = matchCards.reduce((s, c) => s + c.result.carryAtEnd, 0);

    return (
      <div style={{ marginTop: 18 }}>
        <Eyebrow>{`${isTeamSkins ? "TEAM " : ""}1:1 SKINS · MATCH PLAY${game.allowance_pct != null && game.allowance_pct !== 100 ? ` · ${game.allowance_pct}% ALLOWANCE` : ""}`}</Eyebrow>
        {isTeamSkins && (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <div style={{ flex: 1, background: teamTotals.A >= teamTotals.B ? C.greenMid : C.greenLight, borderRadius: 12, padding: 14, textAlign: "center" }}>
              <div style={{ color: C.cream, fontWeight: 800 }}>{teams![0].name}</div>
              <div style={{ color: C.cream, fontSize: 32, fontWeight: 800, fontFamily: "Georgia, serif" }}>{fmtSkins(teamTotals.A)}</div>
            </div>
            <div style={{ flex: 1, background: teamTotals.B >= teamTotals.A ? C.greenMid : C.greenLight, borderRadius: 12, padding: 14, textAlign: "center" }}>
              <div style={{ color: C.cream, fontWeight: 800 }}>{teams![1].name}</div>
              <div style={{ color: C.cream, fontSize: 32, fontWeight: 800, fontFamily: "Georgia, serif" }}>{fmtSkins(teamTotals.B)}</div>
            </div>
          </div>
        )}
        {isTeamSkins && (() => {
          const rem = game.holes_meta.length - (teamTotals.A + teamTotals.B);
          return <div style={{ textAlign: "center", color: C.faint, fontSize: 12, marginTop: 8 }}>{rem > 0 ? `${fmtSkins(rem)} skin${rem === 1 ? "" : "s"} still in play` : "All skins decided"}</div>;
        })()}
        {carrying > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#5A3210", border: `1px solid ${ORANGE}`, borderRadius: 10, padding: "10px 12px", marginTop: 10 }}>
            <span style={{ color: ORANGE, fontSize: 18, fontWeight: 800 }}>↑</span>
            <span style={{ color: "#F2C28A", fontSize: 13 }}>{carrying} unresolved skin{carrying > 1 ? "s" : ""} carrying across 1:1 skins matches</span>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {[...players].sort((a, b) => (totals[pkey(b)] || 0) - (totals[pkey(a)] || 0)).map((p) => {
            const n = totals[pkey(p)] || 0;
            return <div key={p.id} style={{ flex: 1, minWidth: 130, background: p.user_id === user.id ? C.greenMid : C.greenLight, borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <Avatar src={p.avatar_url} name={p.display_name} size={26} />
                <span style={{ color: C.cream, fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.display_name}{p.user_id === user.id ? " (you)" : ""}{isTeamSkins && p.team ? ` · ${teamName(p.team)}` : ""}</span>
              </span>
              <span style={{ color: n > 0 ? C.sage : C.cream, fontWeight: 800, fontSize: 20, fontFamily: "Georgia, serif", marginLeft: 8 }}>{fmtSkins(n)}</span>
            </div>;
          })}
        </div>
        {matchCards.map(({ idx, pa, pb, result }) => (
          <div key={idx} style={{ background: C.greenLight, borderRadius: 12, padding: 14, marginTop: 12, border: pa.id === myKey || pb.id === myKey ? `1px solid ${C.gold}` : "none" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <div style={{ color: C.cream, fontWeight: 800, fontSize: 15 }}>{pa.name}{isTeamSkins ? ` (${teamName(playerOf(pa.id)?.team)})` : ""} <span style={{ color: C.sage, fontWeight: 500 }}>vs</span> {pb.name}{isTeamSkins ? ` (${teamName(playerOf(pb.id)?.team)})` : ""}</div>
              <div style={{ flex: 1 }} />
              <div style={{ color: C.cream, fontWeight: 800, fontFamily: "Georgia, serif" }}>{fmtSkins(result.skinsBySide[pa.id] || 0)}–{fmtSkins(result.skinsBySide[pb.id] || 0)}</div>
            </div>
            <div style={{ marginTop: 10 }}>
              {result.holes.map((h) => {
                const tiedCarry = h.decided && !h.winnerId;
                const won = h.decided && h.winnerId;
                const winnerLabel = h.winnerId === pa.id ? pa.name : h.winnerId === pb.id ? pb.name : "";
                return (
                  <div key={h.hole} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: `1px solid ${C.borderCard}` }}>
                    <span style={{ width: 24, color: C.sage, fontWeight: 800, fontSize: 12 }}>{h.hole}</span>
                    <span style={{ flex: 1, color: C.cream, fontSize: 12 }}>{won ? `${winnerLabel} wins` : tiedCarry ? "Halved — carries" : "Not played yet"}</span>
                    {won ? <span style={{ background: C.greenLight, color: C.gold, fontSize: 11, padding: "3px 8px", borderRadius: 999 }}>{h.value} skin{h.value > 1 ? "s" : ""}</span> : tiedCarry ? <span style={{ background: "#5A3210", color: ORANGE, fontSize: 11, padding: "3px 8px", borderRadius: 999 }}>push →</span> : <span style={{ color: C.sage, fontSize: 11 }}>{h.value} at stake</span>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Fallback for old skins games that have not yet been configured with pairings.
  const nameById: Record<string, string> = {};
  players.forEach((p) => (nameById[p.id] = p.display_name));
  const skinPlayers: SkinPlayer[] = players.map((p) => ({ id: p.id, name: p.display_name, gross: p.scores || [], ch: chBasis(p, game.course_par, game.holes_meta?.length) }));
  const isSplit = game.skins_mode === "split";
  const result = computeSkins(game.holes_meta, skinPlayers, game.allowance_pct ?? 100, isSplit ? "split" : "carryover");
  const firstUndecided = result.holes.find((h) => !h.decided);
  const carrying = firstUndecided ? firstUndecided.carriedIn : result.carryAtEnd;
  const intoHole = firstUndecided ? firstUndecided.hole : null;
  const totals = [...players].sort((a, b) => (result.skinsByPlayer[b.id] || 0) - (result.skinsByPlayer[a.id] || 0));

  return (
    <div style={{ marginTop: 18 }}>
      <Eyebrow>{`SKINS · ${isSplit ? "SPLIT" : "INDIVIDUAL"}${game.allowance_pct != null && game.allowance_pct !== 100 ? ` · ${game.allowance_pct}% ALLOWANCE` : ""}`}</Eyebrow>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>{isSplit ? "Split skins — each hole is its own prize; a tie shares it evenly between the tied players, with no carryovers." : "Open Game setup to configure 1:1 pairings or team best-ball skins. Until then, this old game is shown as individual skins."}</div>
      {!isSplit && carrying > 0 && <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#5A3210", border: `1px solid ${ORANGE}`, borderRadius: 10, padding: "10px 12px", marginTop: 10 }}><span style={{ color: ORANGE, fontSize: 18, fontWeight: 800 }}>↑</span><span style={{ color: "#F2C28A", fontSize: 13 }}>{carrying} skin{carrying > 1 ? "s" : ""} {intoHole ? `carrying into hole ${intoHole}` : "unclaimed (last hole tied)"}</span></div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        {totals.map((p) => {
          const n = result.skinsByPlayer[p.id] || 0;
          return <div key={p.id} style={{ flex: 1, minWidth: 130, background: p.user_id === user.id ? C.greenMid : C.greenLight, borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}><span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}><Avatar src={p.avatar_url} name={p.display_name} size={26} /><span style={{ color: C.sage, fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.display_name}{p.user_id === user.id ? " (you)" : ""}</span></span><span style={{ color: n > 0 ? C.sage : C.cream, fontWeight: 800, fontSize: 20, fontFamily: "Georgia, serif", marginLeft: 8 }}>{fmtSkins(n)}</span></div>;
        })}
      </div>
      <div style={{ marginTop: 16 }}>
        {result.holes.map((h) => {
          const won = h.decided && h.winnerId;
          const tiedCarry = h.decided && !h.winnerId;
          return <div key={h.hole} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 4px", borderBottom: `1px solid ${C.greenLight}` }}><span style={{ width: 26, color: h.decided ? C.cream : C.sage, fontWeight: 700, fontSize: 13 }}>{h.hole}</span><span style={{ flex: 1, color: won ? C.cream : C.sage, fontSize: 13 }}>{won ? `${nameById[h.winnerId!] || "—"} · net ${h.netById[h.winnerId!]}` : tiedCarry ? (isSplit ? `Split · ${(h.splitIds || []).map((id) => nameById[id] || "—").join(", ")}` : "Tied — carries") : "Not played yet"}</span>{won ? <span style={{ background: C.greenLight, color: C.gold, fontSize: 12, padding: "3px 9px", borderRadius: 999 }}>{h.value} skin{h.value > 1 ? "s" : ""}</span> : tiedCarry ? (isSplit ? <span style={{ background: C.greenLight, color: C.sage, fontSize: 12, padding: "3px 9px", borderRadius: 999 }}>split</span> : <span style={{ background: "#5A3210", color: ORANGE, fontSize: 12, padding: "3px 9px", borderRadius: 999 }}>push →</span>) : <span style={{ color: C.faint, fontSize: 12 }}>{h.value} at stake</span>}</div>;
        })}
      </div>
    </div>
  );
}


export function MatchView({
  game,
  players,
  user,
  isCreator,
  mode = "play",
  onChanged,
}: {
  game: Game;
  players: Player[];
  user: any;
  isCreator: boolean;
  mode?: "play" | "setup";
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [aSel, setASel] = useState("");
  const [bSel, setBSel] = useState("");
  const [busy, setBusy] = useState(false);

  const nameOf = (uid: string) =>
    players.find((p) => pkey(p) === uid)?.display_name || "—";
  const playerOf = (uid: string) =>
    players.find((p) => pkey(p) === uid) || null;
  const paired = new Set(game.pairings.flatMap((pr) => [pr.a, pr.b]));
  const unpaired = players.filter((p) => !paired.has(pkey(p)));
  const inMatchCount = (uid: string) => game.pairings.filter((pr) => pr.a === uid || pr.b === uid).length;
  const setupPolicy = (action: SetupAction) => decideSetupChange({ game, players, action });
  const matchupDecision = setupPolicy({ type: "set_pairings" });
  const matchupsBlocked = matchupDecision.decision === "block";
  const allowSetupMutation = (action: SetupAction) => {
    const decision = setupPolicy(action);
    if (decision.decision === "block") { alert(decision.reason); return false; }
    if (decision.decision === "confirm") return confirm(`${decision.title}\n\n${decision.message}`);
    return true;
  };

  const addPairing = async () => {
    if (!allowSetupMutation({ type: "set_pairings" })) return;
    if (!aSel || !bSel || aSel === bSel) return;
    const pairings = nextPairingAdd(game.pairings, aSel, bSel);
    if (pairings === game.pairings) return; // invalid or exact match already exists
    setBusy(true);
    await supabase.from("games").update({ pairings }).eq("id", game.id);
    setASel("");
    setBSel("");
    setBusy(false);
    onChanged();
  };
  const removePairing = async (idx: number) => {
    if (!allowSetupMutation({ type: "set_pairings" })) return;
    const pairings = nextPairingRemove(game.pairings, idx);
    await supabase.from("games").update({ pairings }).eq("id", game.id);
    onChanged();
  };

  // ---- Team match play ----
  const teams = game.teams || null;
  const isTeam = shapeOf(game).usesTeams;
  const teamName = (key: string | null | undefined) => teams?.find((t) => t.key === key)?.name || "—";
  const teamA = teams && teams[0] ? teams[0] : null;
  const teamB = teams && teams[1] ? teams[1] : null;
  const useTeamPick = !!(teamA && teamB);

  const assignTeam = async (p: Player, key: string | null) => {
    if (!allowSetupMutation({ type: "set_team", player: p, team: key })) return;
    await supabase.from("game_players").update({ team: key }).eq("id", p.id);
    onChanged();
  };

  // Running team points: each decided/leading pairing contributes to a team. Halved = ½ each.
  const teamStandings = (() => {
    if (!isTeam) return null;
    const pts: Record<string, number> = { A: 0, B: 0 };
    let decidedPts: Record<string, number> = { A: 0, B: 0 };
    let valid = 0, dec = 0;
    game.pairings.forEach((pr) => {
      const pa = playerOf(pr.a), pb = playerOf(pr.b);
      if (!pa || !pb) return;
      const st = matchStatus(game.holes_meta, pa.scores || [], pb.scores || [], chBasis(pa, game.course_par, game.holes_meta?.length), chBasis(pb, game.course_par, game.holes_meta?.length), game.allowance_pct ?? 100);
      // Determine which team each player is on.
      const ta = pa.team, tb = pb.team;
      if (!ta || !tb || ta === tb) return; // need a cross-team pairing
      valid++;
      const decided = !!st.result;
      if (decided) dec++;
      const award = (winnerTeam: string, half: boolean) => {
        if (half) { pts.A += 0.5; pts.B += 0.5; if (decided) { decidedPts.A += 0.5; decidedPts.B += 0.5; } }
        else { pts[winnerTeam] += 1; if (decided) decidedPts[winnerTeam] += 1; }
      };
      if (st.thru === 0) return; // not started
      if (st.lead === 0) award("", true);
      else {
        const leadTeam = st.lead > 0 ? ta : tb;
        award(leadTeam, false);
      }
    });
    return { pts, decidedPts, out: valid - dec };
  })();

  const fmtPts = (n: number) => (n === Math.floor(n) ? String(n) : `${Math.floor(n)}½`);

  return (
    <div style={{ marginTop: 18 }}>
      {mode === "play" && isTeam && teamStandings && (
        <div style={{ background: C.green, borderRadius: 14, padding: 16, marginBottom: 16 }}>
          <div style={{ color: C.cream, fontSize: 11, letterSpacing: 2, fontWeight: 800, opacity: 0.8 }}>TEAM MATCH · RUNNING SCORE</div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 10 }}>
            <div style={{ flex: 1, textAlign: "center" }}>
              <div style={{ color: teamAccent(teams![0].name, 0), fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 700 }}>{teams![0].name}</div>
              <div style={{ color: teamStandings.pts.A >= teamStandings.pts.B ? "#FFE08A" : C.cream, fontSize: 40, fontWeight: 800, fontFamily: "Georgia, serif", lineHeight: 1 }}>{fmtPts(teamStandings.pts.A)}</div>
            </div>
            <div style={{ color: C.cream, fontSize: 18, opacity: 0.7, padding: "0 8px" }}>–</div>
            <div style={{ flex: 1, textAlign: "center" }}>
              <div style={{ color: teamAccent(teams![1].name, 1), fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 700 }}>{teams![1].name}</div>
              <div style={{ color: teamStandings.pts.B >= teamStandings.pts.A ? "#FFE08A" : C.cream, fontSize: 40, fontWeight: 800, fontFamily: "Georgia, serif", lineHeight: 1 }}>{fmtPts(teamStandings.pts.B)}</div>
            </div>
          </div>
          <div style={{ color: C.cream, opacity: 0.7, fontSize: 11, textAlign: "center", marginTop: 8 }}>
            Projected from current match states · {fmtPts(teamStandings.decidedPts.A)}–{fmtPts(teamStandings.decidedPts.B)} decided
          </div>
          {teams && teamStandings && (
            <TeamClinchLine aPts={teamStandings.decidedPts.A} bPts={teamStandings.decidedPts.B} unclaimed={teamStandings.out} aName={teams[0].name} bName={teams[1].name} metric="matches" />
          )}
        </div>
      )}

      {/* Team assignments now live in Organizer · Manage Game so each player is configured once. */}
      <div style={{ display: "flex", alignItems: "center" }}>
        <Eyebrow>{mode === "setup" ? "SET MATCHUPS" : "MATCHES"}</Eyebrow>
        <div style={{ flex: 1 }} />
        {mode === "setup" && isCreator && (
          <button
            style={{ ...btn(false), fontSize: 12, opacity: matchupsBlocked ? 0.55 : 1 }}
            disabled={matchupsBlocked}
            title={matchupsBlocked && matchupDecision.decision === "block" ? matchupDecision.reason : undefined}
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Done" : "✎ Add / edit"}
          </button>
        )}
      </div>

      {mode === "setup" && isCreator && matchupsBlocked && matchupDecision.decision === "block" && (
        <div style={{ background: "#4a1d16", border: `1px solid ${C.birdie}`, borderRadius: 10, padding: "9px 11px", color: "#f0c5bd", fontSize: 11.5, lineHeight: 1.45, marginTop: 10 }}>
          {matchupDecision.reason}
        </div>
      )}

      {mode === "setup" && editing && isCreator && (
        <div
          style={{
            background: C.greenLight,
            borderRadius: 12,
            padding: 14,
            marginTop: 10,
          }}
        >
          <div style={{ color: C.sage, fontSize: 12, marginBottom: 8 }}>
            Pair two players who have joined:
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <select
              value={aSel}
              disabled={matchupsBlocked}
              onChange={(e) => setASel(e.target.value)}
              style={{ ...inputStyle, width: "auto", minWidth: 130, opacity: matchupsBlocked ? 0.55 : 1 }}
            >
              <option value="">{useTeamPick ? `${teamA!.name}…` : "Player A…"}</option>
              {(useTeamPick ? players.filter((p) => p.team === teamA!.key) : players).map((p) => (
                <option key={pkey(p)} value={pkey(p)}>
                  {p.display_name}{inMatchCount(pkey(p)) > 0 ? " · in a match" : ""}
                </option>
              ))}
            </select>
            <span style={{ color: C.sage }}>vs</span>
            <select
              value={bSel}
              disabled={matchupsBlocked}
              onChange={(e) => setBSel(e.target.value)}
              style={{ ...inputStyle, width: "auto", minWidth: 130, opacity: matchupsBlocked ? 0.55 : 1 }}
            >
              <option value="">{useTeamPick ? `${teamB!.name}…` : "Player B…"}</option>
              {(useTeamPick ? players.filter((p) => p.team === teamB!.key) : players.filter((p) => pkey(p) !== aSel)).map((p) => (
                <option key={pkey(p)} value={pkey(p)}>
                  {p.display_name}{inMatchCount(pkey(p)) > 0 ? " · in a match" : ""}
                </option>
              ))}
            </select>
            <button
              style={{
                ...btn(true),
                opacity: aSel && bSel && aSel !== bSel ? 1 : 0.5,
              }}
              disabled={matchupsBlocked || !aSel || !bSel || aSel === bSel || busy}
              onClick={addPairing}
            >
              Add
            </button>
          </div>
          <div style={{ color: C.sage, fontSize: 11, marginTop: 8 }}>
            {unpaired.length > 0
              ? `Not yet paired: ${unpaired.map((p) => p.display_name).join(", ")}`
              : "Everyone's in a match."}
            {" "}Odd number? You can pick a player who's already in a match to give them a second opponent, so no one sits out.
          </div>
        </div>
      )}


      {game.pairings.length === 0 && (
        <div
          style={{
            background: C.greenLight,
            borderRadius: 12,
            padding: 20,
            marginTop: 10,
            color: C.sage,
            textAlign: "center",
          }}
        >
          No matchups set yet.{" "}
          {isCreator
            ? "Tap “Set matchups” to pair players once they've joined."
            : "Waiting for the organizer to set the matchups."}
        </div>
      )}

      {game.pairings.map((pr, idx) => {
        const pa = playerOf(pr.a),
          pb = playerOf(pr.b);
        if (!pa || !pb) return null;
        const st = matchStatus(
          game.holes_meta,
          pa.scores || [],
          pb.scores || [],
          chBasis(pa, game.course_par, game.holes_meta?.length),
          chBasis(pb, game.course_par, game.holes_meta?.length),
          game.allowance_pct ?? 100,
        );
        const allow = matchAllowance(chBasis(pa, game.course_par, game.holes_meta?.length), chBasis(pb, game.course_par, game.holes_meta?.length), game.allowance_pct ?? 100);
        const leader =
          st.lead > 0 ? pa.display_name : st.lead < 0 ? pb.display_name : null;
        const statusText = st.result
          ? `${leader} wins ${st.result}`
          : st.lead === 0
            ? "All square"
            : `${leader} ${Math.abs(st.lead)} UP`;
        const myKey = players.find((p) => p.user_id === user.id)?.user_id ?? user.id;
        const iAmIn = pr.a === myKey || pr.b === myKey;
        return (
          <div
            key={idx}
            style={{
              background: C.greenLight,
              borderRadius: 12,
              padding: 14,
              marginTop: 10,
              border: iAmIn ? `1px solid ${C.gold}` : "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", color: C.cream, fontWeight: 700, fontSize: 15 }}>
                  <Avatar src={pa.avatar_url} name={pa.display_name} size={24} />
                  <span>{pa.display_name}{isTeam ? <span style={{ color: C.gold, fontWeight: 500, fontSize: 12 }}> ({teamName(pa.team)})</span> : null}</span>
                  <span style={{ color: C.sage, fontWeight: 500 }}>vs</span>
                  <Avatar src={pb.avatar_url} name={pb.display_name} size={24} />
                  <span>{pb.display_name}{isTeam ? <span style={{ color: C.gold, fontWeight: 500, fontSize: 12 }}> ({teamName(pb.team)})</span> : null}</span>
                </div>
                <div style={{ color: C.sage, fontSize: 12, marginTop: 2 }}>
                  thru {st.thru} · {pa.display_name}{" "}
                  {allow.a === 0 ? "scratch" : `+${allow.a}`}, {pb.display_name}{" "}
                  {allow.b === 0 ? "scratch" : `+${allow.b}`}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    color: st.result ? C.overRedDark : C.cream,
                    fontWeight: 800,
                    fontSize: 16,
                    fontFamily: "Georgia, serif",
                  }}
                >
                  {statusText}
                </div>
                <div style={{ color: C.sage, fontSize: 11 }}>
                  {pa.display_name} {st.aWins}–{st.bWins} {pb.display_name}
                  {st.halves ? ` · ${st.halves} halved` : ""}
                </div>
              </div>
              {isCreator && editing && (
                <button
                  disabled={matchupsBlocked}
                  title={matchupsBlocked && matchupDecision.decision === "block" ? matchupDecision.reason : undefined}
                  onClick={() => removePairing(idx)}
                  style={{
                    background: "none",
                    border: "none",
                    color: C.overRedDark,
                    cursor: "pointer",
                    marginLeft: 10,
                    fontWeight: 800,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}


// ---------------- Four-ball (best net ball) view ----------------
// Setup mode: organizer builds foursomes (2 v 2). Play mode: each foursome shows
// its running better-net-ball match status; the viewer's own foursome is highlighted.
// Shared "team score" tail: shows what's still up for grabs and, for fixed-pool
// formats, whether a team has mathematically clinched. Rendered INSIDE the
// existing team-score card (no new box). metric controls the wording only.
// A hand-drawn broom (the emoji can't be recolored). Sweeps inward: left tilts right, right tilts left.
export function SweepBroom({ side }: { side: "left" | "right" }) {
  return (
    <svg viewBox="0 0 32 32" width={46} height={46} aria-hidden="true" style={{ flex: "none" }}>
      <g transform={`rotate(${side === "left" ? -32 : 32} 16 16)`}>
        <rect x="14.7" y="3" width="2.7" height="13" rx="1.35" fill="#1a1206" />
        <rect x="10.8" y="14.8" width="10.4" height="3.1" rx="1.5" fill="#1a1206" />
        <path d="M12.1 18 L19.9 18 L23.6 26.4 Q16 29.2 8.4 26.4 Z" fill="#1a1206" />
        <g stroke="#E3B93E" strokeWidth="0.9" strokeLinecap="round">
          <path d="M11.6 25.8 L12.7 18.9" /><path d="M14.4 26.6 L14.8 18.7" />
          <path d="M17.6 26.6 L17.2 18.7" /><path d="M20.4 25.8 L19.3 18.9" />
        </g>
      </g>
    </svg>
  );
}

// Gold "Clean Sweep watch" banner — one player has won the first two sixes and is closing
// in on the third. Two rows: title, then the live leader line. Big brooms sweep inward.
export function CleanSweepBanner({ name, val, thru, unit }: { name: string; val: number; thru: number; unit: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, borderRadius: 12, padding: "10px 14px", margin: "12px 0", background: "linear-gradient(180deg,#D9B23A,#C9A227)", border: "1px solid #E0C043", boxShadow: "0 6px 18px -8px rgba(0,0,0,0.6)" }}>
      <SweepBroom side="left" />
      <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
        <div style={{ fontFamily: "Georgia, serif", fontWeight: 800, fontSize: 15, letterSpacing: 0.4, textTransform: "uppercase", color: "#1c1706", whiteSpace: "nowrap" }}>Clean Sweep Watch</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#3A3208", marginTop: 3 }}>
          <b style={{ color: "#000" }}>{name}</b> is <b style={{ color: "#000" }}>{val} {unit}</b> thru hole {thru}
        </div>
      </div>
      <SweepBroom side="right" />
    </div>
  );
}

// Trophy for the completed clean sweep.
export function SweepTrophy() {
  return (
    <svg viewBox="0 0 32 32" width={26} height={26} aria-hidden="true" style={{ flex: "none" }}>
      <path d="M10 5 h12 v4 a6 6 0 0 1 -12 0 Z" fill="#1a1206" />
      <path d="M10 6 H6 a3 3 0 0 0 3 4 M22 6 h4 a3 3 0 0 1 -3 4" stroke="#1a1206" strokeWidth="1.6" fill="none" />
      <rect x="14.7" y="14" width="2.6" height="5" fill="#1a1206" />
      <rect x="11" y="19" width="10" height="2.6" rx="1" fill="#1a1206" />
      <rect x="9.5" y="21.4" width="13" height="2.8" rx="1.2" fill="#1a1206" />
    </svg>
  );
}

// Celebration banner shown when a clean sweep is CONFIRMED (game final): richer than
// the watch banner, with brooms flanking a trophy and a congratulatory message.
export function SweepAchievedBanner({ name, potNote }: { name: string; potNote?: string }) {
  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 14, padding: "16px 14px", margin: "12px 0", textAlign: "center", background: "radial-gradient(120% 120% at 50% 0%, #F0CF6A 0%, #D9B23A 45%, #C9A227 100%)", border: "1px solid #EBD37E", boxShadow: "0 10px 26px -10px rgba(0,0,0,0.7)" }}>
      <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", gap: 8, marginBottom: 4 }}>
        <SweepBroom side="left" />
        <SweepTrophy />
        <SweepBroom side="right" />
      </div>
      <div style={{ fontFamily: "Georgia, serif", fontWeight: 800, fontSize: 19, letterSpacing: 0.5, color: "#1c1706", textTransform: "uppercase" }}>Clean Sweep!</div>
      <div style={{ fontFamily: "Georgia, serif", fontWeight: 800, fontSize: 16, color: "#000", marginTop: 3 }}>{name}</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#3A3208", marginTop: 4 }}>Won all three sixes outright — and 1st overall</div>
      {potNote ? (
        <div style={{ display: "inline-block", marginTop: 9, background: "#1a1206", color: C.gold, fontWeight: 800, fontSize: 13, padding: "5px 12px", borderRadius: 999 }}>{potNote}</div>
      ) : null}
    </div>
  );
}

export function TeamClinchLine({ aPts, bPts, unclaimed, aName, bName, metric, showBanner = true }: {
  aPts: number; bPts: number; unclaimed: number; aName: string; bName: string;
  metric: "points" | "matches" | "skins"; showBanner?: boolean;
}) {
  const cs = clinchState(aPts, bPts, unclaimed);
  const leadName = cs.leader === "A" ? aName : cs.leader === "B" ? bName : null;
  const hi = Math.max(aPts, bPts), lo = Math.min(aPts, bPts);
  const f = (n: number) => (n === Math.floor(n) ? String(n) : `${Math.floor(n)}½`);
  const noun = (n: number) => metric === "matches" ? `match${n === 1 ? "" : "es"}` : metric === "skins" ? `skin${n === 1 ? "" : "s"}` : `point${n === 1 ? "" : "s"}`;
  const tail = metric === "matches" ? "still out" : metric === "skins" ? "still in play" : "unclaimed";
  return (
    <>
      <div style={{ borderTop: `1px solid ${C.borderGreen}`, marginTop: 10, paddingTop: 8, textAlign: "center", color: C.sage, fontSize: 12 }}>
        {unclaimed > 0 ? <><b style={{ color: C.cream }}>{unclaimed}</b> {noun(unclaimed)} {tail}</> : (metric === "skins" ? "All skins decided" : metric === "matches" ? "All matches in" : "All points played")}
      </div>
      {showBanner && (cs.clinched || cs.canTie || cs.decided) && (
        <div style={{ marginTop: 8, background: cs.canTie ? "#3A3414" : (cs.decided && !cs.leader) ? "#2A2A22" : "#1f7a52", border: `1px solid ${cs.canTie ? C.gold : (cs.decided && !cs.leader) ? C.borderCard : "#3FBF82"}`, borderRadius: 10, padding: "8px 12px", textAlign: "center" }}>
          <div style={{ color: cs.canTie ? "#E4CF86" : "#CFF5E2", fontWeight: 800, fontSize: 14 }}>
            {cs.decided ? (cs.leader ? `${leadName} wins, ${f(hi)}–${f(lo)}` : "Match tied") : cs.canTie ? `${leadName} can’t be caught` : `${leadName} has won`}
          </div>
          {cs.clinched && !cs.decided && <div style={{ color: C.sage, fontSize: 11, marginTop: 2 }}>{f(cs.lead)} ahead with {unclaimed} {tail} — unbeatable</div>}
        </div>
      )}
      {showBanner && !cs.clinched && !cs.canTie && !cs.decided && leadName && (
        <div style={{ color: C.gold, fontSize: 12, fontWeight: 700, textAlign: "center", marginTop: 6 }}>{leadName} wins it with {cs.needToClinch} more {noun(cs.needToClinch)}</div>
      )}
    </>
  );
}

export function FourballView({
  game,
  players,
  user,
  isCreator,
  mode = "play",
  onChanged,
}: {
  game: Game;
  players: Player[];
  user: any;
  isCreator: boolean;
  mode?: "play" | "setup";
  onChanged: () => void;
}) {
  const foursomes = game.foursomes || [];
  const teams = game.teams || null;
  const playerOf = (uid: string) => players.find((p) => pkey(p) === uid) || null;
  const nameOf = (uid: string) => playerOf(uid)?.display_name || "—";
  const firstName = (uid: string) => (playerOf(uid)?.display_name || "—").split(" ")[0];
  const teamName = (key: string | null | undefined) => teams?.find((t) => t.key === key)?.name || "—";
  const setupPolicy = (action: SetupAction) => decideSetupChange({ game, players, action });
  const foursomeDecision = setupPolicy({ type: "set_foursomes" });
  const foursomesBlocked = foursomeDecision.decision === "block";
  const allowFoursomeMutation = () => {
    const decision = setupPolicy({ type: "set_foursomes" });
    if (decision.decision === "block") { alert(decision.reason); return false; }
    if (decision.decision === "confirm") return confirm(`${decision.title}\n\n${decision.message}`);
    return true;
  };

  // Which contest line is expanded (one at a time): key is `${foursomeId}-${ci}`.
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Hole-by-hole detail panel for an expanded contest line.
  const HoleDetail = ({ rows, aLabel, bLabel, aColor, bColor, runningMatch = false }: { rows: ContestHole[]; aLabel: string; bLabel: string; aColor: string; bColor: string; runningMatch?: boolean }) => {
    const played = rows.filter((d) => d.r != null);
    if (!played.length) return <div style={{ background: "#F1EFE6", borderRadius: 8, padding: "8px 10px", margin: "2px 0 6px", color: C.faint, fontSize: 11 }}>No holes scored yet.</div>;
    return (
      <div style={{ background: "#F1EFE6", borderRadius: 8, padding: "6px 10px", margin: "2px 0 6px" }}>
        <div style={{ display: "flex", color: C.faint, fontSize: 11, fontWeight: 800, letterSpacing: 0.5, padding: "3px 0" }}>
          <span style={{ width: 34 }}>HOLE</span><span style={{ flex: 1 }}>NET</span><span style={{ width: 60, textAlign: "center" }}>WON</span><span style={{ width: 52, textAlign: "right" }}>{runningMatch ? "MATCH" : "SCORE"}</span>
        </div>
        {played.map((d) => {
          const aWon = d.r === 1, bWon = d.r === -1;
          const wonLabel = aWon ? aLabel : bWon ? bLabel : "halve";
          const wonColor = aWon ? aColor : bWon ? bColor : C.faint;
          return (
            <div key={d.hole} style={{ display: "flex", alignItems: "center", color: C.ink, fontSize: 12, padding: "4px 0", borderTop: "1px solid #E4DFCE" }}>
              <span style={{ width: 34, color: C.faint }}>{d.hole}</span>
              <span style={{ flex: 1 }}>
                <span style={{ color: aWon ? "#1A7A3C" : C.ink, fontWeight: aWon ? 700 : 400 }}>{d.aNet}</span>
                <span style={{ color: C.faint }}> · </span>
                <span style={{ color: bWon ? "#1A7A3C" : C.ink, fontWeight: bWon ? 700 : 400 }}>{d.bNet}</span>
              </span>
              <span style={{ width: 60, textAlign: "center", color: wonColor, fontWeight: aWon || bWon ? 700 : 400, fontSize: 11 }}>{wonLabel}</span>
              <span style={{ width: 52, textAlign: "right", color: C.faint }}>{runningMatch ? matchLeadLabel(d.aRun - d.bRun) : `${fmtPts(d.aRun)}–${fmtPts(d.bRun)}`}</span>
            </div>
          );
        })}
        <div style={{ color: C.faint, fontSize: 11, paddingTop: 5 }}>Net scores. Bold = the lower net that won the hole.</div>
      </div>
    );
  };

  const saveFoursomes = async (next: typeof foursomes) => {
    if (!allowFoursomeMutation()) return;
    await supabase.from("games").update({ foursomes: next }).eq("id", game.id);
    // Each foursome is also its tee group (1-based), so group scoring/markers line up
    // with the foursomes and there's no separate "Groups" step for four-ball.
    const groupOf = deriveTeeGroupsFromFoursomes(next);
    await Promise.all(players.map((p) => {
      const g = groupOf[pkey(p)] ?? null;
      return (p.tee_group ?? null) !== g
        ? supabase.from("game_players").update({ tee_group: g }).eq("id", p.id)
        : Promise.resolve();
    }));
    onChanged();
  };

  const addFoursome = () => {
    const next = nextFoursomeAdd(foursomes, Math.random().toString(36).slice(2, 8));
    saveFoursomes(next);
  };
  const removeFoursome = (id: string) => {
    if (!confirm("Remove this foursome?")) return;
    saveFoursomes(nextFoursomeRemove(foursomes, id));
  };
  const renameFoursome = (id: string, name: string) => {
    saveFoursomes(nextFoursomeRename(foursomes, id, name));
  };
  // Assign a player to a slot (team "a" or "b") in a foursome, removing them from any other slot/foursome first.
  const assign = (fId: string, team: "a" | "b", uid: string) => {
    saveFoursomes(assignFoursomePlayer(foursomes, fId, team, uid));
  };
  const unassign = (fId: string, team: "a" | "b", uid: string) => {
    saveFoursomes(unassignFoursomePlayer(foursomes, fId, team, uid));
  };

  // Players not yet placed in any foursome.
  const placed = new Set(foursomes.flatMap((f) => [...f.a, ...f.b]));
  const unplaced = players.filter((p) => !placed.has(pkey(p)));

  const members4 = (f: { a: string[]; b: string[] }): FourballMember[] =>
    [...f.a, ...f.b].map((uid) => {
      const p = playerOf(uid);
      return { id: uid, gross: p?.scores || [], ch: p ? chBasis(p, game.course_par, game.holes_meta?.length) : null, noShow: !!(p as any)?.no_show };
    });

  // Ryder-Cup team rollup: each 2-v-2 foursome is worth a point to the winning
  // side's team; a halved foursome is ½ each. Sides must be cross-team.
  const isTeam = shapeOf(game).usesTeams;
  const holesCount = game.holes_meta?.length ?? 18;
  const teamStandings = (() => {
    if (!isTeam) return null;
    const pts: Record<string, number> = { A: 0, B: 0 };
    const decidedPts: Record<string, number> = { A: 0, B: 0 };
    let valid = 0, dec = 0;
    foursomes.forEach((f) => {
      if (!f.a.length || !f.b.length) return;
      const ta = playerOf(f.a[0])?.team, tb = playerOf(f.b[0])?.team;
      if (!ta || !tb || ta === tb) return; // need a cross-team foursome
      valid++;
      const st = fourballStatus(game.holes_meta, members4(f), f.a, f.b, game.allowance_pct ?? 100, game.team_score_mode === "aggregate" ? "aggregate" : "best_ball");
      if (st.thru === 0) return;
      const decided = st.thru === holesCount || Math.abs(st.lead) > holesCount - st.thru;
      if (decided) dec++;
      if (st.lead === 0) { pts.A += 0.5; pts.B += 0.5; if (decided) { decidedPts.A += 0.5; decidedPts.B += 0.5; } }
      else { const w = st.lead > 0 ? ta : tb; pts[w] += 1; if (decided) decidedPts[w] += 1; }
    });
    return { pts, decidedPts, out: valid - dec };
  })();
  const fmtPts = (n: number) => (n === Math.floor(n) ? String(n) : `${Math.floor(n)}½`);

  // Trifecta: each foursome contributes its singles + team points to the team totals.
  const isTrifecta = game.game_type === "trifecta";
  const teamScoreMode: "best_ball" | "aggregate" = game.team_score_mode === "aggregate" ? "aggregate" : "best_ball";
  const triScoring: "per_hole" | "match" = game.trifecta_scoring === "match" ? "match" : "per_hole";
  const trifectaStandings = (() => {
    if (!isTeam || !isTrifecta) return null;
    const pts: Record<string, number> = { A: 0, B: 0 };
    foursomes.forEach((f) => {
      if (!f.a.length || !f.b.length) return;
      const ta = playerOf(f.a[0])?.team, tb = playerOf(f.b[0])?.team;
      if (!ta || !tb || ta === tb) return;
      const r = computeTrifecta(game.holes_meta, members4(f), f.a, f.b, game.allowance_pct ?? 100, teamScoreMode, !!f.swap, triScoring);
      pts[ta] = (pts[ta] ?? 0) + r.aPts;
      pts[tb] = (pts[tb] ?? 0) + r.bPts;
    });
    return pts;
  })();
  // Points still up for grabs across all trifecta foursomes. A contest's
  // remaining holes only count while BOTH sides still have a live (non-no-show)
  // player — a side that can never post can't yield points, so excluding it lets
  // the lead actually clinch.
  const trifectaUnclaimed = (() => {
    if (!isTeam || !isTrifecta) return null;
    let rem = 0;
    foursomes.forEach((f) => {
      if (!f.a.length || !f.b.length) return;
      const ta = playerOf(f.a[0])?.team, tb = playerOf(f.b[0])?.team;
      if (!ta || !tb || ta === tb) return;
      const r = computeTrifecta(game.holes_meta, members4(f), f.a, f.b, game.allowance_pct ?? 100, teamScoreMode, !!f.swap, triScoring);
      r.contests.forEach((c) => {
        const aLive = c.aIds.some((id) => !playerOf(id)?.no_show);
        const bLive = c.bIds.some((id) => !playerOf(id)?.no_show);
        if (!aLive || !bLive) return;
        rem += triScoring === "match" ? (c.settled ? 0 : 1) : game.holes_meta.length - c.thru;
      });
    });
    return rem;
  })();
  const setSwap = (fId: string, swap: boolean) => saveFoursomes(foursomes.map((f) => (f.id === fId ? { ...f, swap } : f)));

  if (mode === "setup") {
    return (
      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <Eyebrow>FOURSOMES (2 v 2)</Eyebrow>
          <div style={{ flex: 1 }} />
          {isCreator && <button style={{ ...btn(true), fontSize: 12, opacity: foursomesBlocked ? 0.55 : 1 }} disabled={foursomesBlocked} title={foursomesBlocked && foursomeDecision.decision === "block" ? foursomeDecision.reason : undefined} onClick={addFoursome}>+ Add foursome</button>}
        </div>
        {isCreator && foursomesBlocked && foursomeDecision.decision === "block" && (
          <div style={{ background: "#4a1d16", border: `1px solid ${C.birdie}`, borderRadius: 10, padding: "9px 11px", color: "#f0c5bd", fontSize: 11.5, lineHeight: 1.45, marginTop: 10 }}>
            {foursomeDecision.reason}
          </div>
        )}
        <div style={{ color: C.sage, fontSize: 12, marginTop: 6 }}>
          {isTeam
            ? `Each foursome is ${teams![0].name} vs ${teams![1].name} (2-v-2 better-net-ball). Each side only lists its own team's players, so the team total stays correct.`
            : "Each foursome is a 2-v-2 better-net-ball match. Put 2 players in each pair. Big groups: add a foursome per group of four."}
        </div>

        {foursomes.length === 0 && (
          <div style={{ background: C.greenLight, borderRadius: 12, padding: 18, marginTop: 12, color: C.sage }}>
            No foursomes yet. Tap “+ Add foursome”, then assign four players (two per pair).
          </div>
        )}

        {foursomes.map((f) => (
          <div key={f.id} style={{ background: C.greenLight, borderRadius: 12, padding: 14, marginTop: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input value={f.name} onChange={(e) => renameFoursome(f.id, e.target.value)} disabled={!isCreator || foursomesBlocked}
                style={{ ...inputStyle, flex: 1, fontWeight: 700 }} />
              {isCreator && <button style={{ ...btn(false), fontSize: 11, color: C.overRedDark, opacity: foursomesBlocked ? 0.55 : 1 }} disabled={foursomesBlocked} onClick={() => removeFoursome(f.id)}>Remove</button>}
            </div>
            {(["a", "b"] as const).map((team) => (
              <div key={team} style={{ marginTop: 10 }}>
                <div style={{ color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>{isTeam ? (team === "a" ? teams![0].name : teams![1].name).toUpperCase() : (team === "a" ? "PAIR 1" : "PAIR 2")}</div>
                {f[team].map((uid) => (
                  <div key={uid} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
                    <span style={{ flex: 1, color: C.cream, fontSize: 14 }}>{nameOf(uid)}</span>
                    {isCreator && <button style={{ ...btn(false), fontSize: 11, padding: "9px 8px", opacity: foursomesBlocked ? 0.55 : 1 }} disabled={foursomesBlocked} onClick={() => unassign(f.id, team, uid)}>Remove</button>}
                  </div>
                ))}
                {isCreator && f[team].length < 2 && (
                  <select defaultValue="" disabled={foursomesBlocked} onChange={(e) => { if (e.target.value) { assign(f.id, team, e.target.value); e.target.value = ""; } }}
                    style={{ ...inputStyle, padding: "6px 8px", fontSize: 12, marginTop: 4, opacity: foursomesBlocked ? 0.55 : 1 }}>
                    <option value="">+ Add player…</option>
                    {unplaced.filter((p) => !isTeam || p.team === (team === "a" ? teams![0].key : teams![1].key)).map((p) => <option key={p.id} value={pkey(p)}>{p.display_name}</option>)}
                  </select>
                )}
              </div>
            ))}
            {isTrifecta && f.a.length === 2 && f.b.length === 2 && (
              <div style={{ marginTop: 10, borderTop: `1px solid ${C.borderGreen}`, paddingTop: 8 }}>
                <div style={{ color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>SINGLES MATCHUPS</div>
                <div style={{ color: C.cream, fontSize: 13, marginTop: 4 }}>
                  {!f.swap
                    ? `${firstName(f.a[0])} v ${firstName(f.b[0])} · ${firstName(f.a[1])} v ${firstName(f.b[1])}`
                    : `${firstName(f.a[0])} v ${firstName(f.b[1])} · ${firstName(f.a[1])} v ${firstName(f.b[0])}`}
                </div>
                {isCreator && (
                  <button style={{ ...btn(false), fontSize: 12, marginTop: 6, opacity: foursomesBlocked ? 0.55 : 1 }} disabled={foursomesBlocked} onClick={() => setSwap(f.id, !f.swap)}>Swap who plays whom</button>
                )}
              </div>
            )}
          </div>
        ))}

        {unplaced.length > 0 && (
          <div style={{ color: C.sage, fontSize: 11, marginTop: 10 }}>
            Unassigned: {unplaced.map((p) => p.display_name).join(", ")}
          </div>
        )}
      </div>
    );
  }

  // Play mode: foursome match cards.
  const standPts = isTrifecta ? trifectaStandings : teamStandings ? teamStandings.pts : null;
  return (
    <div style={{ marginTop: 16 }}>
      <Eyebrow>{isTrifecta ? (teamScoreMode === "aggregate" ? "TRIFECTA · SHOOTOUT" : "TRIFECTA") : (teamScoreMode === "aggregate" ? "FOUR-BALL · SHOOTOUT" : "FOUR-BALL MATCHES")}</Eyebrow>
      {isTeam && standPts && (
        <div style={{ background: C.green, borderRadius: 12, padding: 14, marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ flex: 1, textAlign: "center" }}>
              <div style={{ color: teamAccent(teams![0].name, 0), fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 700 }}>{teams![0].name}</div>
              <div style={{ color: standPts.A >= standPts.B ? "#FFE08A" : C.cream, fontSize: 40, fontWeight: 800, fontFamily: "Georgia, serif", lineHeight: 1 }}>{fmtPts(standPts.A)}</div>
            </div>
            <div style={{ color: C.sage, fontWeight: 800 }}>–</div>
            <div style={{ flex: 1, textAlign: "center" }}>
              <div style={{ color: teamAccent(teams![1].name, 1), fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 700 }}>{teams![1].name}</div>
              <div style={{ color: standPts.B >= standPts.A ? "#FFE08A" : C.cream, fontSize: 40, fontWeight: 800, fontFamily: "Georgia, serif", lineHeight: 1 }}>{fmtPts(standPts.B)}</div>
            </div>
          </div>
          <div style={{ color: C.sage, fontSize: 11, textAlign: "center", marginTop: 6 }}>
            {isTrifecta
              ? `Three points per hole · ${teamScoreMode === "aggregate" ? "team point on aggregate net (both balls)" : "team point on best net ball"}`
              : `Projected from current foursomes · ${fmtPts(teamStandings!.decidedPts.A)}–${fmtPts(teamStandings!.decidedPts.B)} decided`}
          </div>
          {isTeam && standPts && teams && (
            isTrifecta
              ? <TeamClinchLine aPts={standPts.A} bPts={standPts.B} unclaimed={trifectaUnclaimed ?? 0} aName={teams[0].name} bName={teams[1].name} metric={triScoring === "match" ? "matches" : "points"} />
              : teamStandings ? <TeamClinchLine aPts={teamStandings.decidedPts.A} bPts={teamStandings.decidedPts.B} unclaimed={teamStandings.out} aName={teams[0].name} bName={teams[1].name} metric="matches" /> : null
          )}
        </div>
      )}
      {foursomes.length === 0 && (
        <div style={{ background: C.greenLight, borderRadius: 12, padding: 18, marginTop: 12, color: C.sage }}>
          No foursomes set yet. {isCreator ? "Open Game setup to build them." : "Waiting for the organizer to set up the foursomes."}
        </div>
      )}
      {foursomes.map((f) => {
        const ms = members4(f);
        const full = f.a.length && f.b.length;
        const st = full ? fourballStatus(game.holes_meta, ms, f.a, f.b, game.allowance_pct ?? 100, game.team_score_mode === "aggregate" ? "aggregate" : "best_ball") : null;
        const myKey = players.find((p) => p.user_id === user.id)?.user_id ?? user.id;
        const mine = f.a.includes(myKey) || f.b.includes(myKey);
        const lead = st?.lead ?? 0;
        const leadText = !st || st.thru === 0 ? "" : lead === 0 ? "All square" : `${firstName(lead > 0 ? f.a[0] : f.b[0])}'s pair ${Math.abs(lead)} UP`;
        const tri = isTrifecta && full ? computeTrifecta(game.holes_meta, ms, f.a, f.b, game.allowance_pct ?? 100, teamScoreMode, !!f.swap, triScoring) : null;
        // Match scoring (Ryder Cup): show the LIVE provisional match tally (who currently
        // leads each contest) rather than 0–0 until matches settle.
        const triTally = tri && triScoring === "match"
          ? tri.contests.reduce((acc: { a: number; b: number }, c) => { if (c.thru) { if (c.lead > 0) acc.a += 1; else if (c.lead < 0) acc.b += 1; else { acc.a += 0.5; acc.b += 0.5; } } return acc; }, { a: 0, b: 0 })
          : null;
        return (
          <div key={f.id} style={{ background: C.greenLight, borderRadius: 12, padding: 14, marginTop: 12, border: mine ? `1px solid ${C.gold}` : "none" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <div style={{ color: C.cream, fontWeight: 800, fontSize: 15 }}>{f.name}{mine ? " · your match" : ""}</div>
              <div style={{ flex: 1 }} />
              <div style={{ color: C.cream, fontWeight: 800, fontSize: 14, fontFamily: "Georgia, serif" }}>{isTrifecta ? (tri ? `${fmtPts(triTally ? triTally.a : tri.aPts)}–${fmtPts(triTally ? triTally.b : tri.bPts)}` : "—") : st ? st.result : "—"}</div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <div style={{ flex: 1, background: C.greenLight, borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ color: C.gold, fontSize: 11, fontWeight: 800 }}>{isTeam ? teamName(playerOf(f.a[0])?.team).toUpperCase() : "PAIR 1"}</div>
                <div style={{ color: C.cream, fontSize: 13 }}>{f.a.map(firstName).join(" & ") || "—"}</div>
              </div>
              <div style={{ flex: 1, background: C.greenLight, borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ color: C.gold, fontSize: 11, fontWeight: 800 }}>{isTeam ? teamName(playerOf(f.b[0])?.team).toUpperCase() : "PAIR 2"}</div>
                <div style={{ color: C.cream, fontSize: 13 }}>{f.b.map(firstName).join(" & ") || "—"}</div>
              </div>
            </div>
            {tri && (
              <div style={{ marginTop: 8 }}>
                {tri.contests.map((c, ci) => {
                  const aNames = c.aIds.map(firstName).join(" & ");
                  const bNames = c.bIds.map(firstName).join(" & ");
                  const label = c.kind === "team" ? `Team · ${aNames} v ${bNames}` : `${aNames} v ${bNames}`;
                  const key = `${f.id}-${ci}`;
                  const isOpen = openKey === key;
                  const aColor = isTeam ? teamAccent(teams![0].name, 0) : C.birdie;
                  const bColor = isTeam ? teamAccent(teams![1].name, 1) : C.bogey;
                  const aLabel = c.kind === "team" ? (isTeam ? teamName(playerOf(c.aIds[0])?.team) : "Pair 1") : firstName(c.aIds[0]);
                  const bLabel = c.kind === "team" ? (isTeam ? teamName(playerOf(c.bIds[0])?.team) : "Pair 2") : firstName(c.bIds[0]);
                  return (
                    <React.Fragment key={ci}>
                      <div onClick={() => setOpenKey(isOpen ? null : key)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: `1px solid ${C.borderCard}`, cursor: "pointer" }}>
                        <span style={{ color: C.sage, fontSize: 11, width: 12 }}>{isOpen ? "▾" : "▸"}</span>
                        <span style={{ flex: 1, color: C.cream, fontSize: 13 }}>{label}</span>
                        <span style={{ color: C.sage, fontSize: 11 }}>{c.thru ? `thru ${c.thru}` : "—"}</span>
                        <span style={{ color: C.gold, fontWeight: 800, fontSize: 13, fontFamily: "Georgia, serif", minWidth: 46, textAlign: "right" }}>{triScoring === "match" ? (c.thru ? matchLeadLabel(c.lead) : "—") : `${fmtPts(c.aPts)}–${fmtPts(c.bPts)}`}</span>
                      </div>
                      {isOpen && <HoleDetail rows={c.perHole} aLabel={aLabel} bLabel={bLabel} aColor={aColor} bColor={bColor} runningMatch={triScoring === "match"} />}
                    </React.Fragment>
                  );
                })}
                {isTeam && (
                  <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>
                    {teamName(playerOf(f.a[0])?.team)} {fmtPts(triTally ? triTally.a : tri.aPts)} · {fmtPts(triTally ? triTally.b : tri.bPts)} {teamName(playerOf(f.b[0])?.team)}
                    {(f.a.length === 1 || f.b.length === 1) ? " · 2 v 1 — team point on best ball" : ""}
                  </div>
                )}
              </div>
            )}
            {!isTrifecta && st && st.thru > 0 && (() => {
              const key = `${f.id}-fb`;
              const isOpen = openKey === key;
              const detail = fourballHoleDetail(game.holes_meta, ms, f.a, f.b, game.allowance_pct ?? 100);
              return (
                <div style={{ marginTop: 6 }}>
                  <div onClick={() => setOpenKey(isOpen ? null : key)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: `1px solid ${C.borderCard}`, cursor: "pointer" }}>
                    <span style={{ color: C.sage, fontSize: 11, width: 12 }}>{isOpen ? "▾" : "▸"}</span>
                    <span style={{ flex: 1, color: C.cream, fontSize: 12 }}>{leadText}</span>
                    <span style={{ color: C.sage, fontSize: 11 }}>thru {st.thru}</span>
                  </div>
                  {isOpen && <HoleDetail rows={detail} aLabel={firstName(f.a[0]) + "'s"} bLabel={firstName(f.b[0]) + "'s"} aColor={C.birdie} bColor={C.bogey} />}
                </div>
              );
            })()}
            {!full && <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>Needs players in both pairs.</div>}
          </div>
        );
      })}
    </div>
  );
}


// ---------------- Organizer panel (game creator) ----------------
// Lets the game's creator manage the roster, handicaps, and the game itself.
// ---------------- Strokes summary (who gives/gets, by hole) ----------------
// Read-only panel for the whole field: for any 1-v-1 element (singles match,
// the singles inside Trifecta) it shows who plays off scratch and which holes
// the other player gets a stroke on; for team-only legs (four-ball, the Trifecta
// team point) it lists each player's course handicap and the strokes they get
// off the foursome's low. Hole numbers come from the same allocateStrokes the
// scorecard dots use, so the panel and the card never disagree.
export function StrokesSummary({ game, players, collapsible = false, meKey }: { game: Game; players: Player[]; collapsible?: boolean; meKey?: string }) {
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const allowance = game.allowance_pct ?? 100;
  const meta = game.holes_meta || [];
  const total = meta.length;
  const byKey = (k: string) => players.find((p) => pkey(p) === k) || null;
  const first = (uid: string) => (byKey(uid)?.display_name || "—");
  const teams = Array.isArray(game.teams) ? game.teams : null;
  const pairings = Array.isArray(game.pairings) ? game.pairings : [];
  const foursomes = Array.isArray(game.foursomes) ? game.foursomes : [];
  const isTrifecta = game.game_type === "trifecta";
  const teamColOf = (key: string | null | undefined) => {
    if (!teams || !key) return C.gold;
    const ti = teams.findIndex((t) => t.key === key);
    return ti >= 0 ? teamAccent(teams[ti].name, ti) : C.gold;
  };

  const phStr = (pp: Player) => (pp.course_handicap == null && pp.handicap_index == null ? "\u2014" : String(applyAllowance(chBasis(pp, game.course_par, game.holes_meta?.length), allowance)));
  // phStr uses the unrounded course handicap (WHS: allowance applied to unrounded, rounded once).

  const strokeText = (n: number): string => {
    if (n <= 0) return "scratch";
    const alloc = allocateStrokes(meta.map((m) => ({ hole_number: m.n, stroke_index: m.si })), n);
    const ones = meta.filter((m) => (alloc[m.n] || 0) >= 1).map((m) => m.n);
    const twos = meta.filter((m) => (alloc[m.n] || 0) >= 2).map((m) => m.n);
    if (ones.length >= total && twos.length) return `a stroke on every hole, + 2nd on ${twos.join(", ")}`;
    if (ones.length >= total) return "a stroke on every hole";
    if (ones.length === 1) return `stroke on ${ones[0]}`;
    return `strokes on ${ones.join(", ")}`;
  };

  const hasStructure = shapeOf(game).usesMatchups;
  // Only show the strokes/matchups panel for formats that actually use 1:1
  // pairings or team foursomes. Stableford never does — and must ignore any stale
  // pairings left over from a format the game was previously set to.
  const usesStructure =
    game.game_type === "match" ||
    game.game_type === "fourball" ||
    game.game_type === "trifecta" ||
    game.game_type === "alt_shot" ||
    (game.game_type === "skins" && hasStructure);
  if (!usesStructure) return null;


  /**
   * Alternate shot: one ball per side, so the SIDE has one handicap and strokes are the difference
   * between sides. Every step is shown — a wrong allocation ran for a whole round because this
   * panel returned null for the format and there was no way to check the arithmetic.
   */
  const altShotSide = (fr: { id: string; name?: string; a?: string[]; b?: string[] }) => {
    const rowsFor = (ids: string[] | undefined) =>
      (ids || []).map((k) => byKey(k)).filter((p): p is Player => !!p);
    const aRows = rowsFor(fr.a);
    const bRows = rowsFor(fr.b);
    if (aRows.length !== 2 || bRows.length !== 2) return null;
    // ONE source: this panel had its own inline side calculation while the scorecard dots used
    // dotStrokes — the fifth two-implementations bug in a week, and the reason the panel could be
    // right while the card was blank. Both now read altShotSides, so they cannot disagree.
    const sides = altShotSides(game as never, players as never, fr as never);
    const aCh = sides.aCh ?? 0, bCh = sides.bCh ?? 0;
    const diff = aCh - bCh;
    const strokes = sides.strokes;
    const recvRows = sides.receiving === "a" ? aRows : bRows;
    // Per-player display figures only — the SIDE numbers above are the ones that decide strokes.
    const chOf = (p: Player) => chBasis(p, game.course_par, game.holes_meta?.length) * (allowance / 100);
    const alloc = allocateStrokes(
      meta.map((m) => ({ hole_number: m.n, stroke_index: m.si })),
      strokes,
    );
    const holesWith = meta.filter((m) => (alloc[m.n] ?? 0) > 0).map((m) => m.n);
    const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

    const sideLine = (label: string, rows: Player[], ch: number) => (
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "3px 0" }}>
        <span style={{ color: C.sage, fontSize: 11, width: 44, flex: "none" }}>{label}</span>
        <span style={{ flex: 1, color: C.cream, fontSize: 13, minWidth: 0 }}>
          {rows.map((p) => `${p.display_name.split(" ")[0]} ${num(chOf(p))}`).join("  +  ")}
        </span>
        <span style={{ color: C.gold, fontSize: 14, fontWeight: 800, fontFamily: "Georgia, serif" }}>{num(ch)}</span>
      </div>
    );

    return (
      <div key={fr.id} style={{ borderTop: "1px solid rgba(255,255,255,0.10)", padding: "10px 0" }}>
        {fr.name ? <div style={{ color: C.sage, fontSize: 11, letterSpacing: 1.2, marginBottom: 4 }}>{fr.name.toUpperCase()}</div> : null}
        {sideLine("Side 1", aRows, aCh)}
        {sideLine("Side 2", bRows, bCh)}
        <div style={{ color: C.sage, fontSize: 11.5, marginTop: 6, lineHeight: 1.5 }}>
          {allowance !== 100 ? <>Each handicap at <b style={{ color: C.cream }}>{allowance}%</b>, then added for the side. </> : null}
          Difference <b style={{ color: C.cream }}>{num(Math.abs(diff))}</b>
          {strokes > 0 ? (
            <>
              {" \u2192 "}
              <span style={{ color: C.gold, fontWeight: 700 }}>
                {recvRows.map((p) => p.display_name.split(" ")[0]).join(" & ")} receive {strokes} stroke{strokes === 1 ? "" : "s"}
              </span>
              {holesWith.length ? <>, on holes <b style={{ color: C.cream }}>{holesWith.join(", ")}</b></> : null}
              . The other side plays off scratch.
            </>
          ) : (
            <> {"\u2192"} both sides play off scratch.</>
          )}
        </div>
      </div>
    );
  };

  const oneVone = (aId: string, bId: string, key: string) => {
    const a = byKey(aId), b = byKey(bId);
    if (!a || !b) return null;
    const allow = matchAllowance(chBasis(a, game.course_par, game.holes_meta?.length), chBasis(b, game.course_par, game.holes_meta?.length), allowance);
    return (
      <div key={key} style={{ borderTop: "1px solid rgba(255,255,255,0.10)", padding: "10px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 7, minWidth: 0, color: C.cream, fontSize: 15, fontWeight: 500 }}><Avatar src={a.avatar_url} name={a.display_name} size={24} /><span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.display_name}</span> <span style={{ color: C.sage, fontSize: 12, fontWeight: 500 }}>ph {phStr(a)}</span></span>
          <span style={{ color: C.faint, fontSize: 12 }}>vs</span>
          <span style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 7, minWidth: 0, color: C.cream, fontSize: 15, fontWeight: 500 }}><span style={{ color: C.sage, fontSize: 12, fontWeight: 500 }}>ph {phStr(b)}</span> <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.display_name}</span><Avatar src={b.avatar_url} name={b.display_name} size={24} /></span>
        </div>
        <div style={{ color: "#CFE3D8", fontSize: 12, marginTop: 6 }}>
          {allow.a === 0 && allow.b === 0
            ? "Even match — no strokes."
            : allow.a === 0
              ? <><span style={{ color: C.sage }}>{a.display_name} plays off scratch.</span> {b.display_name} — <span style={{ color: "#E4CF86", fontWeight: 500 }}>{strokeText(allow.b)}</span></>
              : <><span style={{ color: C.sage }}>{b.display_name} plays off scratch.</span> {a.display_name} — <span style={{ color: "#E4CF86", fontWeight: 500 }}>{strokeText(allow.a)}</span></>}
        </div>
      </div>
    );
  };

  const teamStrip = (f: { a: string[]; b: string[] }, key: string) => {
    const members = [...f.a, ...f.b].map(byKey).filter((p): p is Player => !!p);
    if (members.length < 2) return null;
    const low = Math.min(...members.map((m) => applyAllowance(chBasis(m, game.course_par, game.holes_meta?.length), allowance)));
    const col = (side: string[], teamKey: string | null) => (
      <div style={{ flex: 1, borderTop: `2px solid ${teamColOf(teamKey)}`, paddingTop: 8 }}>
        {teams && teamKey && <div style={{ color: teamColOf(teamKey), fontSize: 11, fontWeight: 500, marginBottom: 6 }}>{teams.find((t) => t.key === teamKey)?.name?.toUpperCase()}</div>}
        {side.map(byKey).filter((p): p is Player => !!p).map((p) => {
          const recv = applyAllowance(chBasis(p, game.course_par, game.holes_meta?.length), allowance) - low;
          return (
            <div key={p.id} style={{ padding: "4px 0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: C.cream, fontSize: 14 }}><span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}><Avatar src={p.avatar_url} name={p.display_name} size={24} /><span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.display_name}</span></span><span style={{ color: C.sage }}>ph {phStr(p)}</span></div>
              <div style={{ color: recv > 0 ? "#E4CF86" : C.sage, fontSize: 11, marginTop: 1 }}>{strokeText(recv)}</div>
            </div>
          );
        })}
      </div>
    );
    return (
      <div key={key} style={{ display: "flex", gap: 12, marginTop: 8 }}>
        {col(f.a, byKey(f.a[0])?.team ?? null)}
        {col(f.b, byKey(f.b[0])?.team ?? null)}
      </div>
    );
  };

  // Default to just the current player's group (their tee group if tee groups are
  // set, else the single pairing/foursome they're in). A toggle expands to the
  // whole field, so a 10-foursome game isn't a wall of strokes by default.
  const meRow = meKey ? players.find((p) => pkey(p) === meKey) || null : null;
  const myTeeGroup = meRow?.tee_group ?? null;
  const teeGroupsInUse = players.some((p) => p.tee_group != null);
  const pairingMine = (pr: { a: string; b: string }) => {
    if (teeGroupsInUse && myTeeGroup != null) {
      const a = byKey(pr.a), b = byKey(pr.b);
      return a?.tee_group === myTeeGroup || b?.tee_group === myTeeGroup;
    }
    return !!meKey && (pr.a === meKey || pr.b === meKey);
  };
  const foursomeMine = (f: { a: string[]; b: string[] }) => {
    if (teeGroupsInUse && myTeeGroup != null) {
      return [...f.a, ...f.b].map(byKey).some((m) => m?.tee_group === myTeeGroup);
    }
    return !!meKey && [...f.a, ...f.b].includes(meKey);
  };
  const totalUnits = shapeOf(game).usesFoursomes ? foursomes.length : pairings.length;
  const myUnits = (shapeOf(game).usesFoursomes ? foursomes.filter(foursomeMine) : pairings.filter(pairingMine)).length;
  const canFilter = !!meKey && myUnits > 0;
  const showToggle = canFilter && totalUnits > myUnits;
  // The filter works BY TEE GROUP when tee groups are in use, so the "show all"
  // label counts tee groups (what the user sees as "groups"), not matchups.
  const teeGroupCount = teeGroupsInUse ? new Set(players.filter((p) => p.tee_group != null).map((p) => p.tee_group)).size : 0;
  const allGroupsCount = teeGroupCount > 0 ? teeGroupCount : totalUnits;

  // Render one foursome's strokes (label + trifecta singles + team strip).
  const foursomeBlock = (
    f: { id?: string; name?: string; a: string[]; b: string[]; swap?: boolean },
    i: number,
    opts?: { label?: boolean; dim?: boolean },
  ) => {
    const singles = isTrifecta ? trifectaSingles(f.a, f.b, !!f.swap) : [];
    return (
      <div key={f.id || i} style={opts?.dim
        ? { border: "1px solid rgba(255,255,255,0.30)", borderRadius: 8, padding: 10, marginTop: 10, opacity: 0.62 }
        : { borderTop: "1px solid rgba(255,255,255,0.10)", paddingTop: 10, marginTop: 6 }}>
        {opts?.label !== false && <div style={{ color: C.sage, fontSize: 11, letterSpacing: 1, fontWeight: 800 }}>{(f.name || `Foursome ${i + 1}`).toUpperCase()}</div>}
        {/* Alternate shot replaces the four-ball body: one ball per side, so there are no
            individual matchups to list — only the side handicaps and the strokes given. */}
        {game.game_type === "alt_shot" ? altShotSide(f as never) : null}
        {game.game_type !== "alt_shot" && isTrifecta && singles.length > 0 && (
          <>
            <div style={{ color: C.sage, fontSize: 11, letterSpacing: 1, marginTop: 6 }}>TWO SINGLES</div>
            {singles.map(([aId, bId], si) => oneVone(aId, bId, `${f.id}-s${si}`))}
            <div style={{ color: C.sage, fontSize: 11, letterSpacing: 1, marginTop: 10 }}>TEAM POINT · {game.team_score_mode === "aggregate" ? "SHOOTOUT" : "BEST BALL"}</div>
          </>
        )}
        {/* Four-ball's per-player strip: each player against the foursome low. With one ball
            per side that is meaningless, and showing it next to the side figures is the
            two-disagreeing-numbers problem that produced the hole 15 error. */}
        {game.game_type !== "alt_shot" ? teamStrip(f, `${f.id}-t`) : null}
      </div>
    );
  };

  const toggleBtn = showToggle ? (
    <button
      onClick={(e) => { e.stopPropagation(); setShowAll((sa) => !sa); }}
      style={{ background: "none", border: "none", color: C.gold, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", padding: "9px 2px", flexShrink: 0 }}
    >
      {showAll ? "▴ Show my group" : `▾ Show all ${allGroupsCount} groups`}
    </button>
  ) : null;

  const mineFoursomes = foursomes.map((f, i) => ({ f, i })).filter(({ f }) => foursomeMine(f));
  const minePairings = pairings.map((pr, i) => ({ pr, i })).filter(({ pr }) => pairingMine(pr));
  const otherFoursomes = foursomes.map((f, i) => ({ f, i })).filter(({ f }) => !foursomeMine(f));
  const otherPairings = pairings.map((pr, i) => ({ pr, i })).filter(({ pr }) => !pairingMine(pr));
  // When the player's group is a single foursome, its name rides on the header row.
  const soleFoursome = canFilter && minePairings.length === 0 && mineFoursomes.length === 1 ? mineFoursomes[0] : null;

  const body = (
    <>
      {!hasStructure && (
        <div style={{ color: C.sage, fontSize: 12, padding: "8px 0" }}>Set the matchups to see strokes.</div>
      )}

      {!canFilter && hasStructure && (
        <>
          {pairings.map((pr, i) => oneVone(pr.a, pr.b, `p${i}`))}
          {foursomes.map((f, i) => foursomeBlock(f, i))}
        </>
      )}

      {canFilter && (
        <>
          {/* YOUR GROUP — always shown; the toggle rides its header row */}
          <div style={{ boxShadow: `0 0 0 1px ${C.gold} inset`, borderRadius: 8, padding: "8px 8px 6px", marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div>
                <div style={{ color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>YOUR GROUP</div>
                {soleFoursome && <div style={{ color: C.sage, fontSize: 11, letterSpacing: 1, fontWeight: 800, marginTop: 2 }}>{(soleFoursome.f.name || `Foursome ${soleFoursome.i + 1}`).toUpperCase()}</div>}
              </div>
              {toggleBtn}
            </div>
            {minePairings.map(({ pr, i }) => oneVone(pr.a, pr.b, `p${i}`))}
            {mineFoursomes.map(({ f, i }) => foursomeBlock(f, i, { label: !soleFoursome }))}
          </div>

          {showAll && (otherPairings.length > 0 || otherFoursomes.length > 0) && (
            <>
              <div style={{ color: C.faint, fontSize: 11, letterSpacing: 1.5, fontWeight: 700, marginTop: 14 }}>OTHER GROUPS</div>
              {otherPairings.map(({ pr, i }) => <div key={`op${i}`} style={{ opacity: 0.62 }}>{oneVone(pr.a, pr.b, `p${i}`)}</div>)}
              {otherFoursomes.map(({ f, i }) => foursomeBlock(f, i, { dim: true }))}
            </>
          )}
        </>
      )}

      {hasStructure && (
        <div style={{ color: C.faint, fontSize: 11, marginTop: 10 }}>ph — playing handicap{allowance !== 100 ? `, after the ${allowance}% allowance` : ""}.</div>
      )}
    </>
  );

  return (
    <div style={{ background: "#16302A", border: `1px solid ${C.borderGreen}`, borderRadius: 12, padding: 14, marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: collapsible ? "pointer" : "default" }} onClick={collapsible ? () => setOpen((o) => !o) : undefined}>
        <span style={{ color: C.gold, fontSize: 11, letterSpacing: 1.5, fontWeight: 700, flex: 1 }}>STROKES{allowance !== 100 ? ` · ${allowance}% ALLOWANCE` : ""}</span>
        {collapsible && <span style={{ color: C.sage, fontSize: 14 }}>{open ? "▴" : "▾"}</span>}
      </div>
      {(open || !collapsible) && body}
    </div>
  );
}

// ---------------- Groups builder (who tees off together) ----------------
// Builds tee groups out of the matchups (matches/foursomes) or, for individual
// formats like Stableford, straight out of players. Assigning a unit to a group
// sets tee_group for every player in that unit, which drives group scoring.
