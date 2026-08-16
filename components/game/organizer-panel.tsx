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
import { ShareControl } from "@/components/game/scorecard-views";

const supabase = createClient();

export type OrganizerPanelProps = {
  game: Game;
  players: Player[];
  user: any;
  onOverride: (p: Player, idx: number | null) => Promise<void>;
  courseTees: CourseTee[];
  onSetTee: (p: Player, teeName: string) => Promise<void>;
  onRemove: (p: Player) => Promise<void>;
  onToggleNoShow: (p: Player) => Promise<void>;
  onSetTeam: (p: Player, team: string | null) => Promise<void>;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onEnd: () => Promise<void>;
  onReopen: () => Promise<void>;
  onReset: () => Promise<void>;
  onShare: (on: boolean) => Promise<void>;
  section?: "players" | "teams" | "format";
  eligibleMembers?: { id: string; display_name: string; handicap_index: number | null }[];
  onAddMember?: (m: { id: string; display_name: string; handicap_index: number | null }) => Promise<void>;
  onAddGuest?: (name: string, hcp: number, sponsor: string) => Promise<void>;
  onSetAllowance?: (pct: number) => Promise<void>;
  onSetFormat?: (f: "stableford" | "stroke" | "match" | "fourball" | "skins" | "trifecta") => Promise<void>;
  onSetTeamScoreMode?: (m: "best_ball" | "aggregate") => Promise<void>;
  onSetSkinsMode?: (m: "carryover" | "split") => Promise<void>;
  onSetSkinsStyle?: (s: "individual" | "team_11" | "team_2v2") => Promise<void>;
  onSetMatchTeam?: (on: boolean) => Promise<void>;
  anyScores?: boolean;
};

export function OrganizerPanel({
  game,
  players,
  user,
  onOverride,
  courseTees,
  onSetTee,
  onRemove,
  onToggleNoShow,
  onSetTeam,
  onRename,
  onDelete,
  onEnd,
  onReopen,
  onReset,
  onShare,
  section = "players",
  eligibleMembers = [],
  onAddMember,
  onAddGuest,
  onSetAllowance,
  onSetFormat,
  onSetTeamScoreMode,
  onSetSkinsMode,
  onSetSkinsStyle,
  onSetMatchTeam,
  anyScores = false,
}: OrganizerPanelProps) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [nameEdit, setNameEdit] = useState(game.name);
  const [addGuestName, setAddGuestName] = useState("");
  const [addGuestHcp, setAddGuestHcp] = useState("");
  const [addGuestSponsor, setAddGuestSponsor] = useState(""); // sponsor user id; "" -> current user
  // Members already in this game can sponsor a walk-up guest (keeps them together when grouping).
  const gameMembers = players.filter((p) => !p.is_guest && p.user_id).map((p) => ({ id: p.user_id as string, name: p.display_name }));


  const withHcp = players.filter((p) => p.course_handicap != null).length;
  const allSet = players.length > 0 && withHcp === players.length;

  const teams = Array.isArray(game.teams) ? game.teams : [];
  // Tee choice is a player-level setting and must not depend on yardage availability.
  // Merge the course library tees with tee snapshots already stored on game_players so
  // the organizer keeps a usable selector even if the course link/library lookup is stale.
  const teeOptions = useMemo(() => {
    const byName = new Map<string, CourseTee>();
    for (const t of courseTees || []) {
      if (!t?.name) continue;
      byName.set(t.name, t);
    }
    for (const p of players) {
      if (!p.tee_name || p.rating == null || p.slope == null || byName.has(p.tee_name)) continue;
      byName.set(p.tee_name, {
        name: p.tee_name,
        rating: p.rating,
        slope: p.slope,
        par: game.course_par ?? 0,
      });
    }
    return Array.from(byName.values());
  }, [courseTees, players, game.course_par]);
  const groupOptions = Array.from({ length: Math.max(1, Math.ceil(players.length / 4) + 1) }, (_, i) => i + 1);
  const teeGroups = Array.from(new Set(players.map((p) => p.tee_group).filter((g): g is number => g != null))).sort((a, b) => a - b);
  const teamLabel = (key: string | null | undefined) => teams.find((t) => t.key === key)?.name || "No team";

  // Which formats can this game switch to right now. Once scores exist, only
  // moves that don't need new matchups are allowed: Stableford/Skins are always
  // safe (no structure), Match needs pairings already in place, Four-ball needs
  // foursomes. Before any score, anything is allowed (still setup).
  const hasPairings = Array.isArray(game.pairings) && game.pairings.length > 0;
  const hasFoursomes = Array.isArray(game.foursomes) && game.foursomes.length > 0;
  const canSwitchTo = (target: "stableford" | "stroke" | "match" | "fourball" | "skins" | "trifecta") => {
    if (target === game.game_type) return false;
    if (!anyScores) return true;
    if (target === "stableford" || target === "skins" || target === "stroke") return true;
    if (target === "match") return hasPairings;
    if (target === "fourball") return hasFoursomes;
    if (target === "trifecta") return hasFoursomes;
    return false;
  };

  const save = async (p: Player) => {
    const raw = edits[p.id];
    if (raw === undefined) return;
    const idx = raw.trim() === "" ? null : parseFloat(raw);
    setSavingId(p.id);
    await onOverride(p, idx);
    setSavingId(null);
  };

  return (
    <div
      style={{
        background: C.greenLight,
        borderRadius: 14,
        padding: 16,
        marginTop: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <Eyebrow>★ ORGANIZER · MANAGE GAME</Eyebrow>
        <div style={{ flex: 1 }} />
        <button
          style={{ ...btn(false), fontSize: 12 }}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>
      <div
        style={{
          color: allSet ? C.cream : C.gold,
          fontSize: 13,
          marginTop: 8,
          fontWeight: 700,
        }}
      >
        {players.length} player{players.length === 1 ? "" : "s"} in game ·{" "}
        {withHcp}/{players.length} have a handicap set
        {allSet ? " ✓ everyone's ready" : ""}
      </div>

      {open && (
        <div style={{ marginTop: 10 }}>
          {/* Unified player setup */}
          <div style={{ marginTop: 12, display: section === "format" ? "none" : undefined }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Eyebrow>{section === "teams" ? "ASSIGN TEAMS" : "PLAYERS · HANDICAPS · TEES"}</Eyebrow>
              <div style={{ flex: 1 }} />
              <span style={{ color: C.sage, fontSize: 11 }}>
                {section === "teams" ? "Tap a team to assign each player." : "Set each player's handicap and tee."}
              </span>
            </div>
            {players.map((p) => {
              const raw = edits[p.id] ?? (p.handicap_index != null ? String(p.handicap_index) : "");
              return (
                <div
                  key={p.id}
                  style={{
                    background: C.card,
                    borderRadius: 12,
                    padding: 12,
                    marginTop: 10,
                    border: `1px solid ${C.line}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar src={p.avatar_url} name={p.display_name} size={48} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                      <div style={{ color: C.ink, fontWeight: 800, fontSize: 15, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.display_name}
                      {p.user_id === game.created_by ? " (organizer)" : ""}
                      </div>
                      {p.is_guest ? <span style={{ color: C.gold, fontSize: 11, fontWeight: 800 }}>guest</span> : null}
                    </div>
                    <div style={{ color: C.faint, fontSize: 12 }}>
                      {p.course_handicap != null
                        ? `course handicap ${p.course_handicap} · plays ${applyAllowance(chBasis(p, game.course_par), game.allowance_pct ?? 100)}${(game.allowance_pct ?? 100) !== 100 ? ` (${game.allowance_pct}%)` : ""}`
                        : "no handicap yet"}
                      {p.tee_name ? ` · ${p.tee_name}` : ""}
                    </div>
                  </div>
                  </div>

                  {section === "players" ? (
                  <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))", gap: 10, marginTop: 12 }}>
                    <div>
                      <label style={{ color: C.sage, fontSize: 11 }}>Handicap</label>
                    <div style={{ display: "flex", gap: 5, marginTop: 2 }}>
                      <input
                        inputMode="decimal"
                        value={raw}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "" || /^-?\d*\.?\d*$/.test(v)) setEdits((m) => ({ ...m, [p.id]: v }));
                        }}
                        style={{ ...inputStyle, padding: "6px 8px", width: 58, textAlign: "center" }}
                      />
                      <button
                        style={{ ...btn(true), padding: "6px 8px", fontSize: 11, opacity: savingId === p.id ? 0.5 : 1 }}
                        disabled={savingId === p.id}
                        onClick={() => save(p)}
                      >
                        Set
                      </button>
                    </div>
                  </div>

                  <div>
                    <label style={{ color: C.sage, fontSize: 11 }}>Tee</label>
                    <select
                      value={p.tee_name || ""}
                      onChange={(e) => onSetTee(p, e.target.value)}
                      disabled={teeOptions.length === 0}
                      style={{ ...inputStyle, padding: "6px 8px", marginTop: 2, width: "100%", opacity: teeOptions.length ? 1 : 0.65 }}
                    >
                      <option value="" disabled>{teeOptions.length ? "Select tee" : "No tee data available"}</option>
                      {teeOptions.map((t) => (
                        <option key={`${t.name}-${t.rating}-${t.slope}`} value={t.name}>
                          {t.name} · {t.rating != null && t.slope != null ? `${t.rating}/${t.slope}` : "rating/slope missing"}
                        </option>
                      ))}
                    </select>
                    {teeOptions.length === 0 ? (
                      <div style={{ color: C.gold, fontSize: 11, marginTop: 4 }}>
                        Tee choices are unavailable for this course. Yardage is optional; rating and slope are required to calculate a course handicap.
                      </div>
                    ) : null}
                  </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 12 }}>
                    {(
                      <button
                        title="Mark out / no-show"
                        style={{
                          background: p.no_show ? C.gold : "none",
                          border: `1px solid ${p.no_show ? C.gold : C.line}`,
                          borderRadius: 6,
                          color: p.no_show ? C.green : C.sage,
                          fontWeight: 800,
                          cursor: "pointer",
                          padding: "6px 8px",
                          fontSize: 12,
                        }}
                        onClick={() => onToggleNoShow(p)}
                      >
                        {p.no_show ? "No-show ✓" : "No-show"}
                      </button>
                    )}
                    {p.user_id !== game.created_by && (
                      <button
                        title="Remove player"
                        style={{ background: "none", border: `1px solid ${C.line}`, borderRadius: 6, color: C.birdie, fontWeight: 800, cursor: "pointer", padding: "6px 8px", fontSize: 12 }}
                        onClick={() => {
                          const holesPlayed = (p.scores || []).filter((s) => s != null).length;
                          if (holesPlayed > 0 && !confirm(`${p.display_name} has scores on ${holesPlayed} hole${holesPlayed === 1 ? "" : "s"}. Removing them deletes that scorecard from this game. Remove anyway?\n\nIf they started but had to leave, use "No-show" instead to keep their played holes.`)) return;
                          onRemove(p);
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  </>
                  ) : (
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                    {teams.map((t, ti) => {
                      const on = p.team === t.key;
                      const col = teamAccent(t.name, ti);
                      return (
                        <button key={t.key} onClick={() => onSetTeam(p, on ? null : t.key)}
                          style={{ borderRadius: 999, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", background: on ? col : "transparent", border: `1.5px solid ${on ? col : C.line}`, color: on ? "#0E241B" : C.sage }}>
                          {t.name}
                        </button>
                      );
                    })}
                    {p.team ? <span style={{ color: C.faint, fontSize: 11 }}>tap again to clear</span> : <span style={{ color: C.faint, fontSize: 11 }}>no team yet</span>}
                  </div>
                  )}
                </div>
              );
            })}
          </div>

          {section === "teams" && teams.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 12 }}>
              {teams.map((t, ti) => {
                const mem = players.filter((p) => p.team === t.key);
                const accent = teamAccent(t.name, ti);
                return (
                  <div key={t.key} style={{ background: C.card, borderRadius: 10, padding: 12, border: `1px solid ${accent}` }}>
                    <div style={{ color: accent, fontWeight: 800, fontSize: 13 }}>{t.name}</div>
                    <div style={{ color: C.faint, fontSize: 11, marginTop: 2 }}>{mem.length} player{mem.length === 1 ? "" : "s"}</div>
                    <div style={{ marginTop: 8, color: C.ink, fontSize: 13, lineHeight: 1.8 }}>
                      {mem.length ? mem.map((p) => <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 7 }}><Avatar src={p.avatar_url} name={p.display_name} size={20} enlargeable={false} /><span>{p.display_name} <span style={{ color: C.faint }}>CH {p.course_handicap ?? "—"}</span></span></div>) : <span style={{ color: C.faint }}>No players assigned</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {section === "players" && (onAddMember || onAddGuest) && (
            <div style={{ marginTop: 14, borderTop: `1px solid ${C.greenMid}`, paddingTop: 12 }}>
              {onAddMember && eligibleMembers.length > 0 && (
                <>
                  <div style={{ color: C.sage, fontSize: 11, letterSpacing: 2, fontWeight: 700 }}>ADD FROM YOUR CLUB</div>
                  <div style={{ marginTop: 8 }}>
                    {eligibleMembers.map((m) => (
                      <div key={m.id} onClick={() => onAddMember(m)}
                        style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 8px", cursor: "pointer", borderBottom: `1px solid ${C.greenMid}`, borderRadius: 8 }}>
                        <span style={{ width: 22, height: 22, borderRadius: 5, border: `1.5px solid ${C.sage}`, flex: "0 0 auto" }} />
                        <span style={{ flex: 1, color: C.cream, fontWeight: 700, fontSize: 15 }}>{m.display_name}</span>
                        <span style={{ color: C.sage, fontSize: 12 }}>{m.handicap_index != null ? `HCP ${m.handicap_index}` : "no handicap"}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>Tap a name to add them to the field.</div>
                </>
              )}
              {onAddGuest && (
                <>
                  <div style={{ color: C.sage, fontSize: 11, letterSpacing: 2, fontWeight: 700, marginTop: eligibleMembers.length > 0 ? 14 : 0 }}>ADD A GUEST</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <input value={addGuestName} onChange={(e) => setAddGuestName(e.target.value)} placeholder="Guest name" style={{ ...inputStyle, padding: "8px 10px", flex: 1, minWidth: 140 }} />
                    <input value={addGuestHcp} onChange={(e) => { const v = e.target.value; if (v === "" || /^-?\d*\.?\d*$/.test(v)) setAddGuestHcp(v); }} inputMode="decimal" placeholder="Handicap index" style={{ ...inputStyle, padding: "8px 10px", width: 120 }} />
                    {gameMembers.length > 0 && (
                      <select value={addGuestSponsor || user.id} onChange={(e) => setAddGuestSponsor(e.target.value)}
                        title="Which member is this guest playing with? They'll share a group." style={{ ...inputStyle, padding: "8px 10px", minWidth: 140 }}>
                        {gameMembers.map((m) => <option key={m.id} value={m.id}>Guest of {m.id === user.id ? "me" : m.name}</option>)}
                      </select>
                    )}
                    <button
                      disabled={!addGuestName.trim() || addGuestHcp === ""}
                      onClick={async () => {
                        if (onAddGuest) { await onAddGuest(addGuestName, parseFloat(addGuestHcp), addGuestSponsor || user.id); setAddGuestName(""); setAddGuestHcp(""); setAddGuestSponsor(""); }
                      }}
                      style={{ ...btn(false), fontSize: 13, padding: "8px 14px", opacity: addGuestName.trim() && addGuestHcp !== "" ? 1 : 0.5 }}
                    >+ Add guest</button>
                  </div>
                </>
              )}
            </div>
          )}

          {section === "players" && (
          <div style={{ color: C.sage, fontSize: 11, marginTop: 8 }}>
            Tees default to the course tee. Set teams and groups on the next steps.
          </div>
          )}
          {section === "format" && (
          <div
            style={{
              borderTop: `1px solid ${C.greenMid}`,
              marginTop: 14,
              paddingTop: 14,
            }}
          >
            <div
              style={{
                color: C.sage,
                fontSize: 11,
                letterSpacing: 2,
                fontWeight: 700,
              }}
            >
              GAME SETTINGS
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <input
                value={nameEdit}
                onChange={(e) => setNameEdit(e.target.value)}
                style={{
                  ...inputStyle,
                  padding: "8px 10px",
                  flex: 1,
                  minWidth: 160,
                }}
                placeholder="Game name"
              />
              <button
                style={{
                  ...btn(false),
                  fontSize: 13,
                  opacity: nameEdit.trim() && nameEdit !== game.name ? 1 : 0.5,
                }}
                disabled={!nameEdit.trim() || nameEdit === game.name}
                onClick={() => onRename(nameEdit)}
              >
                Rename
              </button>
            </div>

            {game.status !== "ended" && onSetAllowance && (
              <div style={{ marginTop: 12 }}>
                <div style={{ color: C.sage, fontSize: 12 }}>Handicap allowance</div>
                <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {[100, 90, 85].map((amt) => (
                    <button key={amt} onClick={() => onSetAllowance(amt)} style={{ ...btn((game.allowance_pct ?? 100) === amt), fontSize: 13, padding: "7px 12px" }}>{amt}%</button>
                  ))}
                  <span style={{ color: C.sage, fontSize: 12 }}>now {game.allowance_pct ?? 100}%</span>
                </div>
                <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>In match formats the lower handicap plays off the difference; standings update live.</div>
              </div>
            )}

            {game.status !== "ended" && onSetFormat && (
              <div style={{ marginTop: 12 }}>
                <div style={{ color: C.sage, fontSize: 12 }}>Format</div>
                <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  {([["stableford", "Stableford"], ["stroke", "Stroke play"], ["match", "Match"], ["fourball", "Four-ball"], ["skins", "Skins"], ["trifecta", "Trifecta"]] as const).map(([key, label]) => {
                    const isCur = game.game_type === key;
                    const allowed = isCur || canSwitchTo(key);
                    return (
                      <button key={key} disabled={!allowed}
                        onClick={() => { if (!isCur && allowed && confirm(`Switch to ${label}? Every scorecard is kept and standings recompute. Allowance moves to the ${label} default — adjust it above if you need to.`)) onSetFormat(key); }}
                        style={{ ...btn(isCur), fontSize: 13, padding: "7px 12px", opacity: allowed ? 1 : 0.4, cursor: allowed ? "pointer" : "not-allowed" }}>{label}</button>
                    );
                  })}
                </div>
                {anyScores && <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>Scores are in — you can switch to Stableford or Skins anytime. Match needs pairings already set, Four-ball needs foursomes.</div>}
              </div>
            )}

            {game.status !== "ended" && game.game_type === "skins" && onSetSkinsStyle && (() => {
              const style = shapeOf(game).skinsStyle ?? "individual";
              return (
                <div style={{ marginTop: 12 }}>
                  <div style={{ color: C.sage, fontSize: 12 }}>Skins style</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                    <button onClick={() => onSetSkinsStyle("individual")} style={{ ...btn(style === "individual"), fontSize: 13, padding: "7px 12px" }}>Individual</button>
                    <button onClick={() => onSetSkinsStyle("team_11")} style={{ ...btn(style === "team_11"), fontSize: 13, padding: "7px 12px" }}>1:1 Teams</button>
                    <button onClick={() => onSetSkinsStyle("team_2v2")} style={{ ...btn(style === "team_2v2"), fontSize: 13, padding: "7px 12px" }}>2v2 Best-ball</button>
                  </div>
                  <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>
                    {style === "individual"
                      ? "Individual — everyone for themselves; one skin per hole."
                      : style === "team_11"
                      ? "1:1 Teams — pair players across two teams in Matchups; won skins roll into each team's total."
                      : "2v2 Best-ball — build foursomes in Matchups; each side's better net ball contests the hole."}
                    {anyScores ? " Scores are kept when you switch." : ""}
                  </div>
                </div>
              );
            })()}
            {game.status !== "ended" && game.game_type === "match" && onSetMatchTeam && (() => {
              const isTeam = shapeOf(game).usesTeams;
              return (
                <div style={{ marginTop: 12 }}>
                  <div style={{ color: C.sage, fontSize: 12 }}>Players</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                    <button onClick={() => onSetMatchTeam(false)} style={{ ...btn(!isTeam), fontSize: 13, padding: "7px 12px" }}>Individual</button>
                    <button onClick={() => onSetMatchTeam(true)} style={{ ...btn(isTeam), fontSize: 13, padding: "7px 12px" }}>Team (e.g. 4 v 4)</button>
                  </div>
                  <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>
                    {isTeam ? "Team match — assign two teams, then pair players 1:1 across them in Matchups." : "Individual — 1:1 pairings, each match stands alone."}
                  </div>
                </div>
              );
            })()}
            {game.status !== "ended" && (game.game_type === "trifecta" || game.game_type === "fourball" || (game.game_type === "skins" && (game.foursomes?.length ?? 0) > 0)) && onSetTeamScoreMode && (
              <div style={{ marginTop: 12 }}>
                <div style={{ color: C.sage, fontSize: 12 }}>{game.game_type === "skins" ? "Team score" : "Team point"}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  <button onClick={() => onSetTeamScoreMode("best_ball")} style={{ ...btn((game.team_score_mode ?? "best_ball") === "best_ball"), fontSize: 13, padding: "7px 12px" }}>Best ball</button>
                  <button onClick={() => onSetTeamScoreMode("aggregate")} style={{ ...btn(game.team_score_mode === "aggregate"), fontSize: 13, padding: "7px 12px" }}>{game.game_type === "skins" ? "Aggregate" : "Shootout"}</button>
                </div>
                <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>
                  {game.team_score_mode === "aggregate"
                    ? "Shootout: both partners' net scores are added for the team point — a blow-up by either player hurts."
                    : "Best ball: the team point uses the better net of the two partners."}
                </div>
              </div>
            )}
            {game.status !== "ended" && game.game_type === "skins" && onSetSkinsMode && (() => {
              const indiv = shapeOf(game).skinsStyle === "individual";
              const splitBlocked = indiv && players.filter((p) => !p.no_show).length > 4;
              return (
                <div style={{ marginTop: 12 }}>
                  <div style={{ color: C.sage, fontSize: 12 }}>When a hole ties</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                    <button onClick={() => onSetSkinsMode("carryover")} style={{ ...btn((game.skins_mode ?? "carryover") === "carryover"), fontSize: 13, padding: "7px 12px" }}>Carry over</button>
                    <button onClick={() => { if (splitBlocked) return; onSetSkinsMode("split"); }} style={{ ...btn(game.skins_mode === "split"), fontSize: 13, padding: "7px 12px", opacity: splitBlocked ? 0.4 : 1 }}>Halved</button>
                  </div>
                  <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>
                    {splitBlocked
                      ? "Halved (split) skins is best for up to 4 players — unavailable with a bigger field."
                      : game.skins_mode === "split"
                      ? "Halved: a tied hole is split — half a skin to each side, no carryover."
                      : "Carry over: a tied hole pushes its skin to the next, building the pot."}
                  </div>
                </div>
              );
            })()}
            {game.status === "ended" ? (
              <button
                style={{ ...btn(false), marginTop: 10, fontSize: 13 }}
                onClick={onReopen}
              >
                ↺ Reopen game
              </button>
            ) : (
              <button
                style={{ ...btn(true), marginTop: 10, fontSize: 13, display: "block" }}
                onClick={onEnd}
              >
                🏁 End game (lock final results)
              </button>
            )}
            <ShareControl game={game} onShare={onShare} />
            <button
              style={{ background: "#3F3414", color: "#E4CF86", border: `0.5px solid ${C.gold}`, borderRadius: 8, padding: "9px 14px", fontWeight: 700, cursor: "pointer", marginTop: 10, fontSize: 13, display: "block" }}
              onClick={onReset}
            >
              ↺ Reset scores (clears scores &amp; clock — keeps players, teams, matchups)
            </button>
            <button
              style={{
                background: "#5A1E1E",
                color: "#F6DEDB",
                border: "none",
                borderRadius: 8,
                padding: "9px 14px",
                fontWeight: 700,
                cursor: "pointer",
                marginTop: 10,
                fontSize: 13,
                display: "block",
              }}
              onClick={onDelete}
            >
              Delete this game
            </button>
          </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------- Betting (TGC group, Stableford) ----------------
// Configurable Stableford betting calculator. Bet amount per person, who's in,
// and the split percentages (default: 3 six-hole segments at 10/75 each, 2nd at
// 15/75, 1st at 30/75). Computes payouts including ties, all-tied-first, and the
// clean-sweep double. See computeBetting() in lib/golf.ts for the full rules.
export function BettingPanel({ players, playerPoints, playerHoles, ended, game, user, canPost, onBetStale, onToggleBets }: {
  players: Player[];
  playerPoints: (p: Player) => number;
  playerHoles: (p: Player) => Hole[];
  ended: boolean;
  game: Game;
  user: { id: string };
  canPost: boolean;
  onBetStale?: (stale: boolean) => void;
  onToggleBets?: (playerId: string, on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [bet, setBet] = useState(75);
  // Who's betting is derived from the persisted `bets` flag — the SAME source the
  // clean-sweep banners use — so the two can never disagree. Toggling flips the
  // flag on the player (optimistic in the parent + persisted), which re-renders
  // both surfaces together.
  const inIds = players.filter((p) => p.bets !== false).map((p) => p.id);
  const [split, setSplit] = useState<BetSplit>(DEFAULT_BET_SPLIT);
  const [editSplit, setEditSplit] = useState(false);

  const toggle = (id: string) => {
    if (!canPost) return;
    onToggleBets?.(id, !inIds.includes(id)); // optimistic update + persist happens in the parent
  };

  // Betting -> Money posting (TGC phase 1).
  const [memberIds, setMemberIds] = useState<Set<string> | null>(null);
  const [postedExpense, setPostedExpense] = useState<{ id: string; created_at: string } | null>(null);
  const [postedNets, setPostedNets] = useState<Record<string, number> | null>(null); // user_id -> cents (+win/-loss) as posted
  const [confirming, setConfirming] = useState(false);
  const [reposting, setReposting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [postMsg, setPostMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!ended || !game.group_id) return;
    let alive = true;
    (async () => {
      // Member-safe roster (SECURITY DEFINER) first, mirroring the Money tab; fall
      // back to a direct read only if the RPC returns nothing.
      const rpc = await supabase.rpc("group_pay_roster", { p_group: game.group_id });
      let ids: string[] = ((rpc.data as any[]) || []).map((r) => r.id).filter(Boolean);
      if (!ids.length) {
        const { data: mem } = await supabase.from("group_members").select("user_id").eq("group_id", game.group_id).eq("status", "active");
        ids = (mem || []).map((m: any) => m.user_id).filter(Boolean);
      }
      if (alive) setMemberIds(new Set(ids));
      const { data: exp } = await supabase
        .from("expenses").select("id, created_at")
        .eq("source_game_id", game.id).eq("source_kind", "tgc_bet").maybeSingle();
      if (alive && exp) {
        setPostedExpense({ id: exp.id, created_at: exp.created_at });
        const [{ data: pys }, { data: shs }] = await Promise.all([
          supabase.from("expense_payers").select("user_id, guest_id, sponsor_user_id, paid_cents").eq("expense_id", exp.id),
          supabase.from("expense_shares").select("user_id, guest_id, sponsor_user_id, share_cents").eq("expense_id", exp.id),
        ]);
        const nets: Record<string, number> = {};
        (pys || []).forEach((p: any) => { const mid = p.user_id || p.sponsor_user_id; if (mid) nets[mid] = (nets[mid] || 0) + p.paid_cents; });
        (shs || []).forEach((s: any) => { const mid = s.user_id || s.sponsor_user_id; if (mid) nets[mid] = (nets[mid] || 0) - s.share_cents; });
        if (alive) setPostedNets(nets);
      }
    })();
    return () => { alive = false; };
  }, [ended, game.group_id, game.id]);

  const betPlayers: BetPlayer[] = players
    .filter((p) => inIds.includes(p.id))
    .map((p) => {
      const hs = playerHoles(p);
      const seg: [number, number, number] = [0, 1, 2].map((si) =>
        hs.slice(si * 6, si * 6 + 6).reduce((s, h) => s + (stablefordPts(h.strokes, h.par, h.recv || 0) || 0), 0),
      ) as [number, number, number];
      const segPlayed: [boolean, boolean, boolean] = [0, 1, 2].map((si) =>
        hs.slice(si * 6, si * 6 + 6).filter((h) => h.strokes != null).length === 6,
      ) as [boolean, boolean, boolean];
      return { id: p.id, name: p.display_name, total: playerPoints(p), seg, segPlayed };
    });

  const result = computeBetting(betPlayers, bet, split);

  const idToUser: Record<string, string | null> = {};
  const idToGuestOf: Record<string, string | null> = {};
  const idToIsGuest: Record<string, boolean> = {};
  players.forEach((p) => { idToUser[p.id] = p.user_id; idToGuestOf[p.id] = p.guest_of || null; idToIsGuest[p.id] = !!p.is_guest; });
  // The member responsible for a bettor: the member themselves, or a guest's sponsor.
  const memberOf = (id: string): string | null => idToUser[id] || idToGuestOf[id] || null;
  const bettorIds = betPlayers.map((b) => b.id);
  // Can't post if a bettor has no member to attribute to: a real non-member account,
  // or a guest with no sponsor. A guest sponsored by a member is fine — it folds to them.
  const nonMembers = memberIds
    ? bettorIds
        .filter((id) => {
          const uid = idToUser[id];
          if (uid) return !memberIds.has(uid);          // a real account, not in the group
          const sp = idToGuestOf[id];                    // a guest — needs a member sponsor
          return !(sp && memberIds.has(sp));
        })
        .map((id) => players.find((p) => p.id === id)?.display_name || "?")
    : [];
  const netSum = result.perPlayer.reduce((s, p) => s + p.net, 0);
  const balanced = Math.abs(netSum) < 0.5;

  // Find-or-create a Money guest record for this GAME (keyed by group + name + game), so
  // a betting guest can be booked as their own ledger line. Tagged with source_game_id so
  // it's a per-appearance throwaway (hidden from the deliberate add-a-guest picker / Retire
  // list) and re-posting the same game reuses it rather than duplicating.
  async function findOrCreateGuestId(name: string, sponsor: string): Promise<string | null> {
    const { data: existing } = await supabase.from("group_guests").select("id").eq("group_id", game.group_id).eq("name", name).eq("source_game_id", game.id).limit(1);
    if (existing && existing.length) return (existing[0] as any).id;
    // Persist the guest WITH the sponsoring member it already carries from the tee time / game roster
    // (game_players.guest_of). A game guest always belongs to a member — this is what betting requires,
    // and what the money_guests_insert RLS policy enforces.
    const { data, error } = await supabase.from("group_guests").insert({ group_id: game.group_id, name, sponsor_user_id: sponsor, archived: false, source_game_id: game.id, created_by: user.id }).select("id").single();
    if (!error && data) return (data as any).id;
    // Insert failed — most often a uniqueness collision because a guest with this name already
    // exists in the group (e.g. carried in from the tee time). Reuse that record so posting still
    // succeeds rather than blocking with a misleading "assign a sponsor" message.
    const { data: byName } = await supabase.from("group_guests").select("id").eq("group_id", game.group_id).eq("name", name).limit(1);
    if (byName && byName.length) return (byName[0] as any).id;
    if (error) console.error("findOrCreateGuestId failed", error);
    return null;
  }
  // Build the nets for posting, materializing a guest record + sponsor for each guest bettor.
  async function buildPostNets(): Promise<{ ok: true; nets: BetNet[] } | { ok: false; reason: string }> {
    const out: BetNet[] = [];
    for (const pp of result.perPlayer) {
      const uid = idToUser[pp.id];
      if (uid) { out.push({ user_id: uid, name: pp.name, net: pp.net }); continue; }
      const sponsor = idToGuestOf[pp.id];
      if (!sponsor) return { ok: false, reason: `Assign a sponsor for ${pp.name} first.` };
      const gid = await findOrCreateGuestId(pp.name, sponsor);
      if (!gid) return { ok: false, reason: `Couldn't create a guest record for ${pp.name} — please try again.` };
      out.push({ user_id: null, guest_id: gid, sponsor_user_id: sponsor, name: pp.name, net: pp.net });
    }
    return { ok: true, nets: out };
  }
  const payerRows = (post: BetPost, expId: string) => post.payers.map((py) => ({ expense_id: expId, user_id: py.user_id, guest_id: py.guest_id, sponsor_user_id: py.sponsor_user_id, paid_cents: py.paid_cents }));
  const shareRows = (post: BetPost, expId: string) => post.shares.map((sh) => ({ expense_id: expId, user_id: sh.user_id, guest_id: sh.guest_id, sponsor_user_id: sh.sponsor_user_id, share_cents: sh.share_cents }));
  const primaryPayer = (post: BetPost) => post.payers.map((p) => p.user_id || p.sponsor_user_id).find(Boolean) || null;
  const rpcBetRows = (post: BetPost) => ({
    p_payers: post.payers.map((py) => ({ user_id: py.user_id ?? null, guest_id: py.guest_id ?? null, sponsor_user_id: py.sponsor_user_id ?? null, paid_cents: py.paid_cents })),
    p_shares: post.shares.map((sh) => ({ user_id: sh.user_id ?? null, guest_id: sh.guest_id ?? null, sponsor_user_id: sh.sponsor_user_id ?? null, share_cents: sh.share_cents })),
  });

  async function doPost() {
    setBusy(true); setPostMsg(null);
    try {
      const built = await buildPostNets();
      if (!built.ok) { setPostMsg(built.reason); setBusy(false); return; }
      const post = betResultToPost(built.nets);
      if (!post.ok) { setPostMsg(post.reason || "Couldn't balance the bet."); setBusy(false); return; }
      if (!primaryPayer(post)) { setPostMsg("Couldn't post — no member to record as payer."); setBusy(false); return; }
      const desc = `TGC bet — ${game.name || game.course || "game"}`;
      const { data: betEventId, error: eventErr } = await supabase.rpc("ensure_game_event", { p_game: game.id });
      if (eventErr) { setPostMsg("Couldn't create the Money event — please try again."); setBusy(false); return; }
      const rows = rpcBetRows(post);
      const { data, error } = await supabase.rpc("save_bet_expense_atomic", {
        p_replace_expense: null, p_group: game.group_id, p_game: game.id, p_event: betEventId ?? null,
        p_description: desc, p_amount_cents: post.amount_cents, ...rows,
      });
      const exp = Array.isArray(data) ? data[0] : data;
      if (error || !exp?.id) { console.error("[bet post] atomic save failed", error); setPostMsg("Couldn't post — nothing was changed. Please try again."); setBusy(false); return; }
      await supabase.from("group_activity").insert({ group_id: game.group_id, actor_user_id: user.id, action: "bet_posted", summary: `posted bet winnings — pot $${(post.amount_cents / 100).toFixed(0)}`, meta: { game_id: game.id, expense_id: exp.id, amount_cents: post.amount_cents } });
      setPostedExpense({ id: exp.id, created_at: exp.created_at }); setConfirming(false);
      setPostMsg("Posted to Money.");
    } catch { setPostMsg("Something went wrong posting to Money — nothing was partially saved."); }
    setBusy(false);
  }

  async function doUnpost() {
    if (!postedExpense) return;
    setBusy(true); setPostMsg(null);
    try {
      const uids = bettorIds.map((id) => idToUser[id]).filter(Boolean) as string[];
      const { data: setl } = await supabase.from("settlements").select("from_user_id, to_user_id, amount_cents, method, created_at").eq("group_id", game.group_id).gte("created_at", postedExpense.created_at);
      const relevant = (setl || []).filter((s: any) => uids.includes(s.from_user_id) || uids.includes(s.to_user_id));
      const nameOf = (uid: string) => players.find((p) => p.user_id === uid)?.display_name || "someone";
      const reversals = relevant.map((s: any) => `${nameOf(s.from_user_id)} → ${nameOf(s.to_user_id)} $${(s.amount_cents / 100).toFixed(0)}${s.method ? ` (${s.method})` : ""}`);
      await supabase.from("group_activity").insert({
        group_id: game.group_id, actor_user_id: user.id, action: "bet_unposted",
        summary: relevant.length ? `un-posted bet — reverse these recorded payments: ${reversals.join("; ")}` : "un-posted bet winnings",
        meta: { game_id: game.id, expense_id: postedExpense.id, reversals },
      });
      const { error } = await supabase.rpc("delete_bet_expense_atomic", { p_expense: postedExpense.id, p_game: game.id });
      if (error) { setPostMsg("Couldn't un-post — nothing was changed. Please try again."); setBusy(false); return; }
      setPostedExpense(null); setConfirming(false);
      setPostMsg(relevant.length ? `Un-posted. ${relevant.length} recorded payment(s) logged in group activity for reversal.` : "Un-posted from Money.");
    } catch { setPostMsg("Something went wrong un-posting."); }
    setBusy(false);
  }
  const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
  const centsNet = (c: number) => `${c >= 0 ? "+" : "\u2212"}$${Math.abs(c / 100).toFixed(0)}`;

  // Raw per-bettor nets, tagging guests with their sponsor (guest_id filled in only at
  // post time). Members carry user_id; guests carry sponsor_user_id = their guest_of.
  const rawNets = (): BetNet[] => result.perPlayer.map((pp) => {
    const uid = idToUser[pp.id];
    return uid
      ? { user_id: uid, name: pp.name, net: pp.net }
      : { user_id: null, guest_id: null, sponsor_user_id: idToGuestOf[pp.id] || null, name: pp.name, net: pp.net };
  });

  // ---- Phase 2: detect that scores changed after posting, and re-post to correct.
  // Live nets in cents at MEMBER level (guests fold to their sponsor), same shape as postedNets.
  const liveNetsCents: Record<string, number> = (() => {
    const post = betResultToPost(rawNets());
    const m: Record<string, number> = {};
    if (post.ok) {
      post.payers.forEach((p) => { const mid = p.user_id || p.sponsor_user_id; if (mid) m[mid] = (m[mid] || 0) + p.paid_cents; });
      post.shares.forEach((s) => { const mid = s.user_id || s.sponsor_user_id; if (mid) m[mid] = (m[mid] || 0) - s.share_cents; });
    }
    return m;
  })();
  const needsUpdate = (() => {
    if (!postedExpense || !postedNets || Object.keys(liveNetsCents).length === 0) return false;
    const keys = new Set([...Object.keys(postedNets), ...Object.keys(liveNetsCents)]);
    for (const k of keys) { if ((postedNets[k] || 0) !== (liveNetsCents[k] || 0)) return true; }
    return false;
  })();
  useEffect(() => { onBetStale?.(needsUpdate); }, [needsUpdate]);
  const nameOfUid = (uid: string) => players.find((p) => p.user_id === uid)?.display_name || "someone";
  // Per-bettor old -> new change, for the re-post preview.
  const repostDeltas = (() => {
    if (!postedNets) return [] as { uid: string; name: string; oldC: number; newC: number }[];
    const keys = new Set([...Object.keys(postedNets), ...Object.keys(liveNetsCents)]);
    return Array.from(keys).map((uid) => ({ uid, name: nameOfUid(uid), oldC: postedNets[uid] || 0, newC: liveNetsCents[uid] || 0 }))
      .filter((r) => r.oldC !== r.newC)
      .sort((a, b) => b.newC - a.newC);
  })();

  async function doRepost() {
    if (!postedExpense) return;
    setBusy(true); setPostMsg(null);
    try {
      const built = await buildPostNets();
      if (!built.ok) { setPostMsg(built.reason); setBusy(false); return; }
      const post = betResultToPost(built.nets);
      if (!post.ok) { setPostMsg(post.reason || "Couldn't balance the corrected bet."); setBusy(false); return; }
      if (!primaryPayer(post)) { setPostMsg("Couldn't re-post — no member to record as payer."); setBusy(false); return; }
      const oldSnapshot = postedNets;
      const desc = `TGC bet — ${game.name || game.course || "game"}`;
      const { data: betEventId2, error: eventErr } = await supabase.rpc("ensure_game_event", { p_game: game.id });
      if (eventErr) { setPostMsg("Couldn't create the Money event — nothing was changed."); setBusy(false); return; }
      const rows = rpcBetRows(post);
      const { data, error } = await supabase.rpc("save_bet_expense_atomic", {
        p_replace_expense: postedExpense.id, p_group: game.group_id, p_game: game.id, p_event: betEventId2 ?? null,
        p_description: desc, p_amount_cents: post.amount_cents, ...rows,
      });
      const exp = Array.isArray(data) ? data[0] : data;
      if (error || !exp?.id) { console.error("[bet re-post] atomic save failed", error); setPostMsg("Couldn't update the winnings — the original posting is unchanged."); setBusy(false); return; }
      await supabase.from("group_activity").insert({
        group_id: game.group_id, actor_user_id: user.id, action: "bet_reposted",
        summary: `re-posted corrected bet winnings — pot $${(post.amount_cents / 100).toFixed(0)}. Recorded payments stay in place; anyone who overpaid now shows as owed back in Money.`,
        meta: { game_id: game.id, expense_id: exp.id, old_nets: oldSnapshot, new_amount_cents: post.amount_cents },
      });
      setPostedExpense({ id: exp.id, created_at: exp.created_at });
      setPostedNets(liveNetsCents);
      setConfirming(false);
      setPostMsg("Winnings corrected in Money.");
    } catch { setPostMsg("Something went wrong re-posting — the original posting is unchanged."); }
    setBusy(false);
  }


  // One-tap shareable recap of the finished round.
  const [copied, setCopied] = useState(false);
  const buildSummary = (): string => {
    const courseName = game?.course || "Round";
    const dateStr = new Date(game?.ended_at || game?.created_at || Date.now()).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const shortName = (n: string) => { const parts = (n || "").trim().split(/\s+/); return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}` : (parts[0] || ""); };
    const grossOf = (p: Player) => playerHoles(p).reduce((sum, h) => sum + (h.strokes && h.strokes > 0 ? h.strokes : 0), 0);
    const rows = players
      .map((p) => ({ name: p.display_name, total: playerPoints(p), gross: grossOf(p), seg: stablefordBySix(playerHoles(p)) }))
      .sort((a, b) => b.total - a.total);
    const segNames = ["Front 6", "Middle 6", "Last 6"];
    const segLines = [0, 1, 2].map((si) => {
      const elig = players.filter((p) => playerHoles(p).slice(si * 6, si * 6 + 6).filter((h) => h.strokes != null && h.strokes > 0).length === 6);
      if (!elig.length) return `${segNames[si]}: \u2014`;
      const best = Math.max(...elig.map((p) => stablefordBySix(playerHoles(p))[si]));
      const w = elig.filter((p) => stablefordBySix(playerHoles(p))[si] === best).map((p) => shortName(p.display_name));
      return `${segNames[si]}: ${w.join(" & ")} (${best}${w.length > 1 ? ", tie" : ""})`;
    });
    const overall: string[] = [];
    const allScoresIn = betPlayers.every((bp) => bp.segPlayed.every(Boolean));
    if (!allScoresIn) {
      overall.push("Not all scores in — no payout yet.");
    } else if (rows.length) {
      const maxTotal = rows[0].total;
      const firsts = rows.filter((r) => r.total === maxTotal);
      if (firsts.length > 1) {
        overall.push(`\ud83e\udd47 1st (tie): ${firsts.map((r) => shortName(r.name)).join(" & ")} (${maxTotal})`);
        overall.push("\u2014 no 2nd \u2014");
      } else {
        overall.push(`\ud83e\udd47 1st: ${shortName(firsts[0].name)} (${maxTotal})`);
        const rest = rows.filter((r) => r.total < maxTotal);
        if (rest.length) {
          const secondVal = rest[0].total;
          const seconds = rest.filter((r) => r.total === secondVal);
          overall.push(`\ud83e\udd48 2nd: ${seconds.map((r) => shortName(r.name)).join(" & ")} (${secondVal})${seconds.length > 1 ? " (tie)" : ""}`);
        }
      }
    }
    const money = (v: number) => `$${Math.round(v)}`;
    const netStr = (v: number) => (v > 0 ? `+${money(v)}` : v < 0 ? `-${money(Math.abs(v))}` : "$0");
    const moneyLines = result.perPlayer.map((pp) => `${shortName(pp.name)}: won ${money(pp.won)}, net ${netStr(pp.net)}`);
    return [
      `\ud83c\udfcc\ufe0f TGC Stableford \u2014 ${courseName} \u00b7 ${dateStr}`,
      ``,
      `STANDINGS (net stableford)`,
      ...rows.map((r) => `${shortName(r.name)} - ${r.seg[0]}/${r.seg[1]}/${r.seg[2]} ${r.total} . Gross ${r.gross}`),
      ``,
      `SIXES`,
      ...segLines,
      ``,
      `OVERALL`,
      ...overall,
      ``,
      `MONEY \u2014 pot ${money(result.pot)}`,
      ...moneyLines,
    ].join("\n");
  };
  const copySummary = async () => {
    try { await navigator.clipboard.writeText(buildSummary()); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard unavailable */ }
  };

  return (
    <div style={{ marginTop: 18, background: C.greenLight, borderRadius: 14, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => setOpen((v) => !v)}>
        <div style={{ color: C.gold, fontSize: 11, letterSpacing: 3, fontWeight: 800 }}>💰 BETTING (TGC)</div>
        <div style={{ flex: 1 }} />
        <span style={{ color: C.sage, fontSize: 16 }}>{open ? "▾" : "▸"}</span>
      </div>

      {ended && (
        <button onClick={copySummary} style={{ ...btn(true), width: "100%", marginTop: 12, fontSize: 14, padding: "11px 0", background: copied ? "#1F8F54" : undefined, color: copied ? "#fff" : undefined }}>
          {copied ? "\u2713 Copied \u2014 paste into your chat" : "\u29c9 Copy round summary"}
        </button>
      )}

      {!open && (
        <div style={{ color: C.sage, fontSize: 12, marginTop: 4 }}>
          Pot ${(bet * inIds.length).toFixed(0)} · {inIds.length} in at ${bet} — tap to see payouts
        </div>
      )}

      {open && (
        <div style={{ marginTop: 12 }}>
          {/* Bet amount */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ color: C.sage, fontSize: 13 }}>Bet per person:</span>
            {[75, 150].map((amt) => (
              <button key={amt} onClick={() => setBet(amt)} style={{ ...btn(bet === amt), fontSize: 13, padding: "6px 12px" }}>${amt}</button>
            ))}
            <input type="number" value={bet} onChange={(e) => setBet(Math.max(0, Number(e.target.value) || 0))}
              style={{ ...inputStyle, width: 90, padding: "6px 10px", fontSize: 13 }} />
          </div>

          {/* Who's in */}
          <div style={{ marginTop: 12 }}>
            <div style={{ color: C.sage, fontSize: 12, marginBottom: 6 }}>Who's betting ({inIds.length}){canPost ? "" : " — organizer sets this"}:</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {players.map((p) => {
                const on = inIds.includes(p.id);
                return (
                  <button key={p.id} onClick={() => canPost && toggle(p.id)} disabled={!canPost}
                    style={{ ...btn(on), fontSize: 12, padding: "6px 10px", opacity: on ? 1 : 0.5, cursor: canPost ? "pointer" : "default" }}>
                    {on ? "✓ " : ""}{p.display_name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Pot + split */}
          <div style={{ marginTop: 14, background: C.card, borderRadius: 10, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ color: C.ink, fontWeight: 800, fontSize: 15 }}>Pot: ${result.pot.toFixed(0)}</div>
              <div style={{ flex: 1 }} />
              <button onClick={() => setEditSplit((v) => !v)} style={{ ...btn(false), fontSize: 11, padding: "5px 9px" }}>
                {editSplit ? "Done" : "Edit split"}
              </button>
            </div>
            {editSplit ? (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                {([["segPct", "Each six-hole segment (×3)"], ["secondPct", "2nd overall"], ["firstPct", "1st overall"]] as [keyof BetSplit, string][]).map(([k, label]) => (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: C.faint, fontSize: 12, flex: 1 }}>{label}</span>
                    <input type="number" value={Math.round(split[k] * 1000) / 10}
                      onChange={(e) => setSplit((s) => ({ ...s, [k]: (Number(e.target.value) || 0) / 100 }))}
                      style={{ ...inputStyle, width: 70, padding: "5px 8px", fontSize: 12 }} />
                    <span style={{ color: C.faint, fontSize: 12 }}>%</span>
                  </div>
                ))}
                <div style={{ color: C.faint, fontSize: 11 }}>
                  3 segments + 2nd + 1st = {pct(split.segPct * 3 + split.secondPct + split.firstPct)} of pot.
                  {Math.abs(split.segPct * 3 + split.secondPct + split.firstPct - 1) > 0.001 && " ⚠ Should total 100%."}
                </div>
                <button onClick={() => setSplit(DEFAULT_BET_SPLIT)} style={{ ...btn(false), fontSize: 11, padding: "5px 9px", alignSelf: "flex-start" }}>Reset to default</button>
              </div>
            ) : (
              <div style={{ color: C.faint, fontSize: 11, marginTop: 4 }}>
                {result.pot > 0
                  ? `Each six: $${Math.round(result.pot * split.segPct)} · 2nd: $${Math.round(result.pot * split.secondPct)} · 1st: $${Math.round(result.pot * split.firstPct)}`
                  : `Each six: ${pct(split.segPct)} · 2nd: ${pct(split.secondPct)} · 1st: ${pct(split.firstPct)}`}
              </div>
            )}
          </div>

          {/* Result lines */}
          <div style={{ marginTop: 14 }}>
            <div style={{ color: C.sage, fontSize: 11, letterSpacing: 1, fontWeight: 800 }}>PAYOUTS</div>
            {result.cleanSweep && (
              <div style={{ background: "#5A4500", borderRadius: 8, padding: "8px 10px", marginTop: 6, color: C.gold, fontSize: 13, fontWeight: 800 }}>
                🧹 CLEAN SWEEP — bets doubled!
              </div>
            )}
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
              {result.lines.map((l, i) => (
                <div key={i} style={{ color: C.cream, fontSize: 13, lineHeight: 1.5 }}>{l}</div>
              ))}
            </div>
          </div>

          {/* Net per player */}
          <div style={{ marginTop: 14 }}>
            <div style={{ color: C.sage, fontSize: 11, letterSpacing: 1, fontWeight: 800 }}>NET RESULT</div>
            <div style={{ marginTop: 6 }}>
              {result.perPlayer.slice().sort((a, b) => b.net - a.net).map((p) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, background: C.card, borderRadius: 10, padding: "9px 12px", marginTop: 6 }}>
                  <div style={{ flex: 1, minWidth: 0, color: C.ink, fontWeight: 800 }}>
                    {p.name}
                    {idToIsGuest[p.id] && (() => { const sp = nameOfUid(idToGuestOf[p.id] || ""); return <div style={{ color: C.faint, fontSize: 11, fontWeight: 700 }}>guest of {sp} · {sp} {p.net >= 0 ? "is paid this" : "pays this"}</div>; })()}
                  </div>
                  <div style={{ color: C.faint, fontSize: 12 }}>won ${p.won.toFixed(2)}</div>
                  <div style={{ width: 80, textAlign: "right", fontWeight: 800, fontFamily: "Georgia, serif", fontSize: 15, color: p.net >= 0 ? C.green : C.birdie }}>
                    {p.net >= 0 ? "+" : "−"}${Math.abs(p.net).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ color: C.faint, fontSize: 11, marginTop: 12 }}>
            Net = winnings minus your ${bet} ante. Payouts update live as scores come in; segments only pay once all 6 holes are entered.
          </div>

          {ended && canPost && result.pot > 0 && (
            <div style={{ marginTop: 14, borderTop: `1px solid ${C.greenMid}`, paddingTop: 14 }}>
              {postedExpense ? (
                <div>
                  <div style={{ color: C.sage, fontSize: 13, fontWeight: 800 }}>Posted to Money ✓</div>
                  <div style={{ color: C.faint, fontSize: 11, marginTop: 2 }}>Losers owe winners in the Money tab. Un-posting removes that expense.</div>
                  {needsUpdate ? (
                    <div style={{ marginTop: 10, background: "#5a3a10", color: "#f6d98a", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontWeight: 800, fontSize: 13 }}>⚠️ Scores changed since posting</div>
                      <div style={{ fontSize: 12, marginTop: 3, lineHeight: 1.4 }}>The posted winnings are out of date. Re-posting corrects the amounts; recorded payments stay in place, so anyone who overpaid shows as owed back in the Money tab.</div>
                      {!reposting ? (
                        <button onClick={() => { setReposting(true); setPostMsg(null); }} disabled={busy} style={{ ...btn(true), fontSize: 12, marginTop: 8 }}>Review &amp; re-post</button>
                      ) : (
                        <div style={{ background: C.card, borderRadius: 10, padding: 12, marginTop: 8 }}>
                          <div style={{ color: C.ink, fontWeight: 800, fontSize: 13 }}>Corrected winnings</div>
                          <div style={{ marginTop: 8 }}>
                            {repostDeltas.map((r) => (
                              <div key={r.uid} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12.5 }}>
                                <span style={{ color: C.ink }}>{r.name}</span>
                                <span style={{ fontFamily: "Georgia, serif" }}>
                                  <span style={{ color: C.faint, textDecoration: "line-through" }}>{centsNet(r.oldC)}</span>{"  "}
                                  <span style={{ fontWeight: 800, color: r.newC >= 0 ? C.green : C.birdie }}>{centsNet(r.newC)}</span>
                                </span>
                              </div>
                            ))}
                          </div>
                          {postMsg && <div style={{ color: C.birdie, fontSize: 12, marginTop: 6 }}>{postMsg}</div>}
                          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                            <button onClick={() => { setReposting(false); setPostMsg(null); }} disabled={busy} style={{ ...btn(false), flex: 1, fontSize: 13 }}>Cancel</button>
                            <button onClick={doRepost} disabled={busy} style={{ ...btn(true), flex: 1, fontSize: 13 }}>{busy ? "Updating…" : "Confirm & re-post"}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <button onClick={doUnpost} disabled={busy} style={{ ...btn(false), fontSize: 12, marginTop: 8 }}>{busy ? "Working…" : "Un-post"}</button>
                  )}
                </div>
              ) : nonMembers.length ? (
                <div style={{ color: C.birdie, fontSize: 12 }}>
                  Can't post to Money — these bettors aren't in the group: {nonMembers.join(", ")}. Add them to the group first.
                </div>
              ) : !confirming ? (
                <button onClick={() => { setConfirming(true); setPostMsg(null); }} style={{ ...btn(true), width: "100%", fontSize: 14, padding: "11px 0" }}>Post winnings to Money</button>
              ) : (
                <div style={{ background: C.card, borderRadius: 12, padding: 14 }}>
                  <div style={{ color: C.ink, fontWeight: 800, fontSize: 14 }}>Confirm bet winnings</div>
                  <div style={{ color: C.faint, fontSize: 12, marginTop: 2 }}>Posts one “Bet” expense so losers owe winners in the Money tab.</div>
                  <div style={{ marginTop: 10 }}>
                    {result.perPlayer.slice().sort((a, b) => b.net - a.net).map((p) => (
                      <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, padding: "5px 0", fontSize: 13 }}>
                        <div style={{ minWidth: 0 }}>
                          <span style={{ color: C.ink }}>{p.name}</span>
                          {idToIsGuest[p.id] && (() => { const sp = nameOfUid(idToGuestOf[p.id] || ""); return <div style={{ color: C.faint, fontSize: 11, fontWeight: 700 }}>guest of {sp} · {sp} {p.net >= 0 ? "is paid this" : "pays this"}</div>; })()}
                        </div>
                        <span style={{ fontWeight: 800, fontFamily: "Georgia, serif", color: p.net >= 0 ? C.green : C.birdie }}>{p.net >= 0 ? "+" : "−"}${Math.abs(p.net).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  {result.cleanSweep && <div style={{ color: C.gold, fontSize: 12, fontWeight: 800, marginTop: 6 }}>{"\uD83E\uDDF9"} Clean sweep — pot doubled.</div>}
                  <div style={{ fontSize: 12, marginTop: 8, fontWeight: 700, color: balanced ? C.green : C.birdie }}>{balanced ? "Balances to zero ✓" : `Off by $${netSum.toFixed(2)} — not balanced`}</div>
                  {postMsg && <div style={{ color: C.birdie, fontSize: 12, marginTop: 6 }}>{postMsg}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button onClick={() => { setConfirming(false); setPostMsg(null); }} disabled={busy} style={{ ...btn(false), flex: 1, fontSize: 13 }}>Cancel</button>
                    <button onClick={doPost} disabled={busy || !balanced} style={{ ...btn(true), flex: 1, fontSize: 13 }}>{busy ? "Posting…" : "Confirm & post"}</button>
                  </div>
                </div>
              )}
              {postMsg && !confirming && <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>{postMsg}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Group results for matchup formats: each player's low NET (or Stableford POINTS via
// the toggle) across the three sixes, both nines, and the full round. Net and points
// are computed independently and the leader is highlighted per column in whichever
// metric is shown (they usually agree, but a blow-up hole — floored at 0 in Stableford
// — can split them).
