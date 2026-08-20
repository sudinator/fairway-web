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
import { decideSetupChange, type SetupAction, type SetupDecision } from "@/lib/game-setup-policy";
import { randomTeeGroups, type GPlayer } from "@/lib/grouping";
import { notifyError } from "@/components/toast";
import { buildLegs, legResult, teamTally, fmtPt, legPoints, DEFAULT_LEG_CONFIG } from "@/lib/legs";
import type { LegConfig, Leg } from "@/lib/legs";
import { loadCoursesForGroup, courseLabel, type Course, type CourseTee } from "@/lib/courses";
import { loadSetupDraft, saveSetupDraft, clearSetupDraft, draftHasProgress, draftAgeLabel, type SetupDraft } from "@/lib/setup-draft";
import { buildGameSetupDraft, toLegacySetupData } from "@/lib/game-setup-draft";
import { autoSplitFlights, flightForIndex, flightRangeLabel, flightTagColor, type FlightBand } from "@/lib/flights";

// Every game_players INSERT must set these NOT-NULL columns explicitly rather than
// leaning on the DB default. A drifted default (0059's `if not exists` skipped it)
// once caused a NOT-NULL violation on `bets`; these columns carry the same risk.
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

const supabase = createClient();

// A 6-digit numeric join code (100000–999999).
import type { Game, Player, GameSeed } from "@/lib/game-types";
export type { GameSeed } from "@/lib/game-types";
import { teamAccent, TEAM_COLOR_BY_NAME } from "@/lib/game-colors";
import { useNowTick } from "@/lib/use-now-tick";
import { ScoreHistory, SkinsView, MatchView, FourballView, StrokesSummary, SweepBroom, CleanSweepBanner, SweepTrophy, SweepAchievedBanner, TeamClinchLine } from "@/components/game/scoring-views";
import { LegConfigEditor, SegmentBoard, GroupSegmentSummary } from "@/components/game/segment-views";
import { GameList } from "@/components/game/game-list";
import * as PS from "@/lib/player-scoring";
import * as FG from "@/lib/finish-gaps";
import * as SEG from "@/lib/segments";
import { LeaderRow } from "@/components/game/leader-row";
import { roundStats } from "@/lib/round-stats";
import * as GU from "@/lib/game-utils";
import { makeCode, defaultTeeIdx, todayLocalStr, normalizeFavoriteCourse, GP_STATE_DEFAULTS } from "@/lib/game-utils";
import * as GC from "@/lib/game-create";
import type { FinishGap } from "@/lib/finish-gaps";
import { GroupScorecard } from "@/components/game/scorecard-views";
import { BettingPanel, type OrganizerPanelProps } from "@/components/game/organizer-panel";
import { GameSetupWorkspace, type SetupTab } from "@/components/game/setup/game-setup-workspace";
import { CreateGameWorkspace, type CreateGameSection } from "@/components/game/setup/create-game-workspace";
import { buildFormatPatch, buildSkinsStylePatch, buildMatchTeamPatch } from "@/lib/game-structure";
import { resolveCreateGameTee, teeSourceLabel } from "@/lib/game-tee-assignment";
import { formatReviewLabel, selectGuidedFamily, selectGuidedMatchKind, selectGuidedStrokeFormat, selectGuidedTeamFormat, setGuidedTeamMode, type CreateFormatPatch, type GuidedFormatState } from "@/lib/create-game-format";
import { commitAllowance, editAllowance } from "@/lib/handicap-allowance";
import { FormatFamilySelector } from "@/components/game/setup/format-family-selector";

// Stable match identity for a player. Real players key on user_id (so nothing
// about existing matches changes); guests have no account, so they key on their
// game_players row id. Used everywhere pairings/foursomes store or look up a
// player, so guests can be assigned to teams and matches like anyone.


// The handicap basis for all stroke math: the UNROUNDED course handicap (WHS
// applies allowances to the unrounded value and rounds once at the end). Falls
// back to the stored rounded course handicap when index/tee data is missing
// (e.g. legacy guests). Display still uses the rounded course_handicap.


// Team accent colour + TEAM_COLOR_BY_NAME now live in lib/game-colors.ts (imported above).


// ---------------- Root tournament tab ----------------
export default function Tournaments({
  session,
  activeGroupId,
  isAdmin,
  seed,
  openGameId,
}: {
  session: any;
  activeGroupId: string;
  isAdmin?: boolean;
  seed?: GameSeed | null;
  openGameId?: string | null;
}) {
  const [view, setView] = useState<"list" | "create" | { gameId: string; tab?: "play" | "setup"; setupTab?: SetupTab }>(
    seed ? "create" : openGameId ? { gameId: openGameId } : "list",
  );
  // Resume the game room the user was in (survives lock/refresh) — but ONLY if it
  // belongs to the active group, so switching groups never drops you into (or
  // shows players from) a game in a different group.
  useEffect(() => {
    if (seed || openGameId) return; // a tee-time handoff wins over resume
    const g = loadActiveGame();
    if (!g) return;
    let cancelled = false;
    (async () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        // Offline: resume from the snapshot's group without a network round-trip.
        const snap = loadGameSnapshot(g.gameId);
        if (snap?.game?.group_id === activeGroupId) setView({ gameId: g.gameId });
        return;
      }
      const { data } = await supabase.from("games").select("group_id").eq("id", g.gameId).single();
      if (cancelled) return;
      if (data) {
        if (data.group_id === activeGroupId) setView({ gameId: g.gameId });
        else clearActiveGame(); // game is in another group (or gone) — show this group's list
      } else {
        // Offline / fetch failed: resume from the local snapshot's group instead of
        // clearing the pointer (a transient offline state must not drop the resume).
        const snap = loadGameSnapshot(g.gameId);
        if (snap?.game?.group_id === activeGroupId) setView({ gameId: g.gameId });
      }
    })();
    return () => { cancelled = true; };
  }, []);
  // Switching the active group while this tab stays mounted: drop any open game or
  // create view back to the (group-filtered) list.
  const prevGroupRef = React.useRef(activeGroupId);
  useEffect(() => {
    if (prevGroupRef.current === activeGroupId) return;
    prevGroupRef.current = activeGroupId;
    clearActiveGame();
    setView("list");
  }, [activeGroupId]);
  const user = session.user;
  const displayName =
    user.user_metadata?.full_name || user.email?.split("@")[0] || "Golfer";

  if (view === "create")
    return (
      <CreateGame
        user={user}
        displayName={displayName}
        activeGroupId={activeGroupId}
        seed={seed}
        onCancel={() => setView("list")}
        onCreated={(gameId, tab, setupTab) => setView({ gameId, tab, setupTab })}
      />
    );
  if (typeof view === "object")
    return (
      <GameRoom
        gameId={view.gameId}
        initialTab={view.tab}
        initialSetupTab={view.setupTab}
        user={user}
        displayName={displayName}
        isAdmin={!!isAdmin}
        onBack={() => { clearActiveGame(); setView("list"); }}
      />
    );
  return (
    <GameList
      displayName={displayName}
      activeGroupId={activeGroupId}
      onOpen={(gameId) => setView({ gameId })}
      onCreate={() => setView("create")}
    />
  );
}

// ---------------- List + join ----------------
function CreateGame({
  user,
  displayName,
  activeGroupId,
  seed,
  onCancel,
  onCreated,
}: {
  user: any;
  displayName: string;
  activeGroupId: string;
  seed?: GameSeed | null;
  onCancel: () => void;
  onCreated: (id: string, tab?: "play" | "setup", setupTab?: SetupTab) => void;
}) {
  const [name, setName] = useState("");
  // Match date — defaults to today (local). Stored structured on the game so we
  // can later summarize by season/month. YYYY-MM-DD to match a Postgres `date`.
  const todayLocal = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const [matchDate, setMatchDate] = useState<string>(seed?.playDate || todayLocal());
  const [favorites, setFavorites] = useState<any[]>([]);
  const [pickedFav, setPickedFav] = useState<any | null>(null);
  const [teeIdx, setTeeIdx] = useState(0);
  const [idxStr, setIdxStr] = useState("");
  const [profileIdx, setProfileIdx] = useState<number | null>(null);
  const [gameType, setGameType] = useState<"stableford" | "stroke" | "match" | "fourball" | "skins" | "trifecta">(
    "stableford",
  );
  // Handicap allowance % (playing handicap = allowance% of course handicap).
  // Default 85 for four-ball, 100 otherwise. Resets to the standard when the
  // format changes; editable any time.
  const [allowancePct, setAllowancePct] = useState(100);
  // Keep the custom allowance editor as text while the user is typing so deleting
  // the value can leave a genuinely blank field. Blank means no custom override
  // and resolves to the default 100% domain value.
  const [allowanceInput, setAllowanceInput] = useState("100");
  // Flights (Stage 1: one-off per-event). "off" | "oneoff". Season "league" is Stage 2.
  const [flightMode, setFlightMode] = useState<"off" | "oneoff">("off");
  const [flightCount, setFlightCount] = useState(3);
  // Handicaps the organizer fills in during a flighted setup for members missing one.
  // Saved to their profile on create (Amit's call), so it becomes their handicap going forward.
  const [hcpOverrides, setHcpOverrides] = useState<Record<string, number>>({});
  // In-progress text for each missing-handicap field, so a row stays put while typing and
  // only commits (leaving the "needs" list) when the organizer taps Set.
  const [flightHcpDraft, setFlightHcpDraft] = useState<Record<string, string>>({});
  const selectGameType = (nextType: "stableford" | "stroke" | "match" | "fourball" | "skins" | "trifecta") => {
    setGameType(nextType);
    const nextAllowance = nextType === "fourball" || nextType === "trifecta" ? 85 : 100;
    setAllowancePct(nextAllowance);
    setAllowanceInput(String(nextAllowance));
  };
  const [teamScoreMode, setTeamScoreMode] = useState<"best_ball" | "aggregate">("best_ball");
  const [trifectaScoring, setTrifectaScoring] = useState<"per_hole" | "match">("per_hole");
  const [strokeBasis, setStrokeBasis] = useState<"gross" | "net">("net");
  const [fmtFamily, setFmtFamily] = useState<"stroke" | "match">("stroke");
  const [matchKind, setMatchKind] = useState<"ind" | "team">("ind");
  const [teamMode, setTeamMode] = useState(false);
  const [skinsTeamStyle, setSkinsTeamStyle] = useState<"head_to_head" | "best_ball">("head_to_head");
  const [skinsMode, setSkinsMode] = useState<"carryover" | "split">("carryover");
  const [team1, setTeam1] = useState("Team 1");
  const [team2, setTeam2] = useState("Team 2");

  const guidedFormatState = (): GuidedFormatState => ({
    gameType, teamMode, skinsTeamStyle, teamScoreMode, trifectaScoring, strokeBasis, skinsMode, fmtFamily, matchKind,
  });
  const applyGuidedFormatPatch = (patch: CreateFormatPatch) => {
    // Calling selectGameType whenever the helper returns gameType deliberately preserves
    // the existing click behavior, including format-default allowance reset on reselect.
    if (patch.gameType) selectGameType(patch.gameType);
    if (patch.fmtFamily) setFmtFamily(patch.fmtFamily);
    if (patch.matchKind) setMatchKind(patch.matchKind);
    if (patch.teamMode !== undefined) setTeamMode(patch.teamMode);
    if (patch.skinsTeamStyle) setSkinsTeamStyle(patch.skinsTeamStyle);
    if (patch.teamScoreMode) setTeamScoreMode(patch.teamScoreMode);
    if (patch.trifectaScoring) setTrifectaScoring(patch.trifectaScoring);
    if (patch.strokeBasis) setStrokeBasis(patch.strokeBasis);
    if (patch.skinsMode) setSkinsMode(patch.skinsMode);
  };

  // Draft-time tee inheritance only: player override > flight tee > game default.
  // Creation resolves inheritance into explicit game_players tee/rating/slope snapshots.
  const [teeAssignments, setTeeAssignments] = useState<{ player: Record<string, number>; flight: Record<string, number> }>({ player: {}, flight: {} });
  const [busy, setBusy] = useState(false);
  const [createSection, setCreateSection] = useState<CreateGameSection>("game");
  const [err, setErr] = useState<string | null>(null);
  const [groupRoster, setGroupRoster] = useState<
    { id: string; display_name: string; avatar_url: string | null; handicap_index: number | null }[]
  >([]);
  const [selectedPlayers, setSelectedPlayers] = useState<
    Record<string, boolean>
  >({});
  const [guestName, setGuestName] = useState("");
  const [guestHcp, setGuestHcp] = useState("");
  const [guestSponsor, setGuestSponsor] = useState<string>(""); // sponsor user id; "" resolves to current user
  const [guestPlayers, setGuestPlayers] = useState<
    { id: string; display_name: string; handicap_index: number | null; guest_of: string }[]
  >([]);
  // Raw text for inline handicap entry on guests that came in without one.
  const [guestIdxEdits, setGuestIdxEdits] = useState<Record<string, string>>({});

  // ---- Resume an interrupted setup (device-local draft) ----
  const teeTimeId = seed?.teeTimeId ?? null;
  const [draftAvailable, setDraftAvailable] = useState<SetupDraft | null>(null); // an unfinished draft offered on the banner
  const [draftDismissed, setDraftDismissed] = useState(false);
  const [pendingFavName, setPendingFavName] = useState<string | null>(null); // restore the course once favorites load
  const hydratedRef = React.useRef(false); // gates saving until we've decided resume-vs-fresh (don't clobber the draft first)
  const resumedRef = React.useRef(false);  // when true, skip the tee-time seed prefill (the draft already captured it)

  const addGuestPlayer = () => {
    const guestIndex = parseFloat(guestHcp);
    if (!guestName.trim() || Number.isNaN(guestIndex)) {
      setErr("Enter a guest name and handicap index.");
      return;
    }
    setGuestPlayers((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        display_name: guestName.trim(),
        handicap_index: guestIndex,
        guest_of: guestSponsor || user.id, // default: the person adding sponsors the guest
      },
    ]);
    setGuestName("");
    setGuestHcp("");
    setGuestSponsor("");
    setErr(null);
  };

  useEffect(() => {
    loadCoursesForGroup(supabase, (effectiveGroupId(activeGroupId) as string)).then((data) => {
      setFavorites(data.map((f: any) => normalizeFavoriteCourse(f)));
    }).catch(() => {
      // Keep the last good library rather than turning a refresh failure into an empty picker.
    });

    (async () => {
      // Read the roster via a SECURITY DEFINER function so ANY member (not just
      // admins) can see every member's name, avatar and handicap. RLS otherwise
      // hides other members' profiles rows from non-admins, collapsing the picker
      // to just yourself. Fall back to direct reads if the migration isn't applied.
      let rosterRows: any[] = [];
      const rpc = await supabase.rpc("group_roster", { p_group: activeGroupId });
      if (!rpc.error && Array.isArray(rpc.data)) {
        rosterRows = rpc.data;
      } else {
        const { data: members } = await supabase
          .from("group_members")
          .select("user_id, avatar_url")
          .eq("group_id", activeGroupId)
          .eq("status", "active");
        const ids = (members || []).map((m: any) => m.user_id).filter(Boolean);
        const avById: Record<string, string | null> = Object.fromEntries(
          (members || []).map((m: any) => [m.user_id, m.avatar_url ?? null]),
        );
        const { data: profs } = ids.length
          ? await supabase
              .from("profiles")
              .select("id, display_name, handicap_index")
              .in("id", ids)
          : ({ data: [] as any[] } as any);
        rosterRows = (profs || []).map((p: any) => ({
          id: p.id,
          display_name: p.display_name,
          avatar_url: avById[p.id] ?? null,
          handicap_index: p.handicap_index,
        }));
      }
      const roster: { id: string; display_name: string; avatar_url: string | null; handicap_index: number | null }[] = (rosterRows || [])
        .map((p: any) => ({
          id: p.id,
          display_name: p.display_name || "Player",
          avatar_url: p.avatar_url ?? null,
          handicap_index: p.handicap_index ?? null,
        }))
        .sort((a: any, b: any) =>
          a.display_name.localeCompare(b.display_name, undefined, {
            sensitivity: "base",
          }),
        );
      setGroupRoster(roster);
      const mine = roster.find((p) => p.id === user.id);
      if (mine && mine.handicap_index != null) {
        setProfileIdx(mine.handicap_index);
        setIdxStr((cur) => (cur.trim() === "" ? String(mine.handicap_index) : cur));
      }
      setSelectedPlayers((prev) => {
        const next: Record<string, boolean> = { ...prev };
        roster.forEach((p) => {
          if (p.id === user.id) next[p.id] = true;
        });
        return next;
      });
    })();
  }, [activeGroupId, user.id]);

  // P4 handoff: once favorites/roster have loaded, prefill the course (with the
  // default tee) and preselect the tee time's IN-list members. Runs once.
  useEffect(() => {
    if (resumedRef.current) return;
    if (!seed?.course || pickedFav || favorites.length === 0) return;
    const f = favorites.find((x) => x.name === seed.course);
    if (f) { setPickedFav(f); setTeeIdx(defaultTeeIdx(f.tees, effectiveGroupId(activeGroupId) === TGC_GROUP_ID)); }
  }, [seed, favorites, pickedFav, activeGroupId]);
  useEffect(() => {
    if (resumedRef.current) return;
    if (!seed || groupRoster.length === 0) return;
    setSelectedPlayers((prev) => {
      const next = { ...prev };
      seed.memberIds.forEach((id) => { if (groupRoster.some((p) => p.id === id)) next[id] = true; });
      return next;
    });
  }, [seed, groupRoster]);
  // Carry the tee time's guests into the field with a blank handicap for the
  // organizer to fill in during review (flagged in the guest list). Runs once.
  const guestsSeeded = React.useRef(false);
  useEffect(() => {
    if (resumedRef.current) return;
    if (!seed?.guests?.length || guestsSeeded.current) return;
    guestsSeeded.current = true;
    setGuestPlayers((prev) => [
      ...prev,
      ...seed.guests.map((g) => ({ id: `seed-${Date.now()}-${Math.random().toString(36).slice(2)}`, display_name: g.name, handicap_index: null as number | null, guest_of: g.sponsorUserId })),
    ]);
  }, [seed]);

  // On open, look for an unfinished draft for this group + tee time. If one with
  // real progress exists, offer to resume it; otherwise allow saving right away.
  useEffect(() => {
    const d = loadSetupDraft(activeGroupId, teeTimeId);
    if (d && draftHasProgress(d, user.id)) setDraftAvailable(d);
    else hydratedRef.current = true;
  }, []);

  const applyDraft = (d: SetupDraft) => {
    resumedRef.current = true;
    guestsSeeded.current = true; // don't re-seed tee-time guests over the restored ones
    setName(d.name); setMatchDate(d.matchDate); setTeeIdx(d.teeIdx); setIdxStr(d.idxStr);
    setGameType(d.gameType as any); setAllowancePct(d.allowancePct); setAllowanceInput(String(d.allowancePct ?? 100)); setTeamScoreMode(d.teamScoreMode as any);
    setTrifectaScoring(d.trifectaScoring as any); setStrokeBasis(d.strokeBasis as any); setFmtFamily(d.fmtFamily as any);
    setMatchKind(d.matchKind as any); setTeamMode(d.teamMode); setSkinsTeamStyle(d.skinsTeamStyle as any);
    setSkinsMode(d.skinsMode as any); setTeam1(d.team1); setTeam2(d.team2);
    setFlightMode((d.flightMode as any) === "oneoff" ? "oneoff" : "off");
    setFlightCount(d.flightCount && d.flightCount >= 2 && d.flightCount <= 4 ? d.flightCount : 3);
    setTeeAssignments({ player: d.playerTeeOverrides || {}, flight: d.flightTeeIdx || {} });
    setHcpOverrides(d.hcpOverrides || {});
    if (d.createSection === "structure") setCreateSection("review");
    else if (d.createSection && ["game", "players", "format", "review"].includes(d.createSection)) setCreateSection(d.createSection as CreateGameSection);
    setSelectedPlayers(d.selectedPlayers || {}); setGuestPlayers(d.guestPlayers || []);
    setPendingFavName(d.favName);
    setDraftAvailable(null); setDraftDismissed(true); hydratedRef.current = true;
  };
  const startFresh = () => {
    clearSetupDraft(activeGroupId, teeTimeId);
    setDraftAvailable(null); setDraftDismissed(true); hydratedRef.current = true;
  };

  // Restore the course once favorites have loaded (kept by name).
  useEffect(() => {
    if (!pendingFavName || favorites.length === 0) return;
    const f = favorites.find((x) => x.name === pendingFavName);
    if (f) setPickedFav(f);
    setPendingFavName(null);
  }, [pendingFavName, favorites]);

  // Canonical snapshot for autosave and for the synchronous exit checkpoint below.
  // The explicit pagehide/visibility save restores the pre-workspace guarantee that
  // leaving/killing the app mid-setup cannot lose the latest rendered setup state.
  const draftSnapshot = useMemo(() => ({
    ...toLegacySetupData(buildGameSetupDraft({
      name, matchDate, favName: pickedFav?.name ?? null, teeIdx, idxStr, gameType, allowancePct,
      teamScoreMode, trifectaScoring, strokeBasis, fmtFamily, matchKind, teamMode, skinsTeamStyle,
      skinsMode, team1, team2, selectedPlayers, guestPlayers, hcpOverrides, flightMode, flightCount,
      flightTeeIdx: teeAssignments.flight, playerTeeOverrides: teeAssignments.player,
    })),
    createSection,
  }), [name, matchDate, pickedFav, teeIdx, idxStr, gameType, allowancePct, teamScoreMode, trifectaScoring, strokeBasis, fmtFamily, matchKind, teamMode, skinsTeamStyle, skinsMode, team1, team2, selectedPlayers, guestPlayers, hcpOverrides, flightMode, flightCount, teeAssignments, createSection]);
  const latestDraftRef = React.useRef(draftSnapshot);
  latestDraftRef.current = draftSnapshot;

  // Save the in-progress setup on every meaningful change (once we've decided
  // resume-vs-fresh, so we never overwrite an offered draft before the user chooses).
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (draftHasProgress(draftSnapshot, user.id)) saveSetupDraft(activeGroupId, teeTimeId, draftSnapshot);
  }, [draftSnapshot, activeGroupId, teeTimeId, user.id]);

  useEffect(() => {
    const checkpoint = () => {
      if (!hydratedRef.current) return;
      const snap = latestDraftRef.current;
      if (draftHasProgress(snap, user.id)) saveSetupDraft(activeGroupId, teeTimeId, snap);
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") checkpoint(); };
    window.addEventListener("pagehide", checkpoint);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      checkpoint();
      window.removeEventListener("pagehide", checkpoint);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [activeGroupId, teeTimeId, user.id]);

  const tee = pickedFav?.tees?.[teeIdx];
  const coursePar = pickedFav
    ? pickedFav.holes.reduce((s: number, h: any) => s + (h.par || 0), 0)
    : null;
  const idxVal = idxStr.trim() === "" ? null : parseFloat(idxStr);
  // The field's handicap indexes (creator + selected members + guests), for flight auto-split.
  const fieldIndexes = useMemo<(number | null)[]>(() => {
    const arr: (number | null)[] = [idxVal];
    groupRoster.forEach((p) => { if (selectedPlayers[p.id] && p.id !== user.id) arr.push(hcpOverrides[p.id] ?? p.handicap_index); });
    guestPlayers.forEach((g) => arr.push(g.handicap_index));
    return arr;
  }, [idxVal, groupRoster, selectedPlayers, guestPlayers, user.id, hcpOverrides]);
  const flightsSupported = gameType === "stroke" || gameType === "stableford";
  const flightBands = useMemo<FlightBand[] | null>(
    () => (flightMode === "oneoff" && flightsSupported ? autoSplitFlights(fieldIndexes, flightCount) : null),
    [flightMode, flightCount, fieldIndexes, flightsSupported]);
  // Flighted events need every player's index. Guests always have one; the only gap is
  // selected members whose profile handicap is blank (and the creator's own, entered above).
  const flightNeedsHcp = useMemo(
    () => (flightMode === "oneoff" && flightsSupported
      ? groupRoster.filter((p) => selectedPlayers[p.id] && p.id !== user.id && (hcpOverrides[p.id] ?? p.handicap_index) == null)
      : []),
    [flightMode, flightsSupported, groupRoster, selectedPlayers, hcpOverrides, user.id]);
  const flightBlocked = flightMode === "oneoff" && flightsSupported && (idxVal == null || flightNeedsHcp.length > 0);
  const resolveDraftTee = useCallback((participantKey: string, handicapIndex: number | null) => {
    if (!pickedFav?.tees?.length) return null;
    return resolveCreateGameTee({
      participantKey, handicapIndex, tees: pickedFav.tees, defaultTeeIdx: teeIdx,
      playerTeeOverrides: teeAssignments.player, flightMode, flightBands, flightTeeIdx: teeAssignments.flight,
    });
  }, [pickedFav, teeIdx, teeAssignments, flightMode, flightBands]);
  const creatorResolvedTee = resolveDraftTee(user.id, idxVal);
  const ch =
    creatorResolvedTee?.tee && idxVal != null && coursePar
      ? courseHandicap(idxVal, creatorResolvedTee.tee.slope, creatorResolvedTee.tee.rating, coursePar)
      : null;

  const create = async () => {
    if (!pickedFav || !tee) {
      setErr("Pick a course (from your favorites).");
      return;
    }
    if (flightBlocked) {
      setErr(idxVal == null
        ? "Enter your own handicap index before flighting this event."
        : `${flightNeedsHcp.length} player${flightNeedsHcp.length === 1 ? "" : "s"} need a handicap index before this event can be flighted — set them under Flights, or turn flights off.`);
      return;
    }
    // Validate the full setup before the first database write. A rejected setup must never
    // leave an orphan games row behind.
    const skinsFieldCount = groupRoster.filter((p) => selectedPlayers[p.id] || p.id === user.id).length + guestPlayers.length;
    if (GC.splitSkinsTooBig(gameType, teamMode, skinsMode, skinsFieldCount)) {
      setErr("Split skins is best for up to 4 players. For a bigger group, use Team skins or 1:1 matchups, or switch Skins to carryover.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const payload = GC.buildGamePayload({
        code: makeCode(), activeGroupId, name, courseName: pickedFav.name, courseHoles: pickedFav.holes,
        teeYardages: tee?.yardages, coursePar, matchDate, allowancePct, gameType, teamMode, team1, team2,
        skinsTeamStyle, teamScoreMode, trifectaScoring, strokeBasis, skinsMode, flightsSupported, flightMode, flightBands,
      });
      const holesMeta = payload.holes_meta;
      const { data: game, error } = await supabase
        .from("games")
        .insert(payload)
        .select()
        .single();
      if (error || !game) throw error || new Error("Could not create game");
      // Remember the creator's handicap: if they overrode the prefilled value,
      // save it back to their profile so it persists as the new default.
      if (idxVal != null && idxVal !== profileIdx) {
        try { await supabase.from("profiles").update({ handicap_index: idxVal }).eq("id", user.id); } catch {}
      }
      // Persist any handicaps the organizer entered for flighted members (Amit's call: it
      // becomes their handicap going forward, not just this event).
      for (const [uid, hi] of Object.entries(hcpOverrides)) {
        if (uid !== user.id && hi != null) {
          try { await supabase.from("profiles").update({ handicap_index: hi }).eq("id", uid); } catch {}
        }
      }
      // Add creator plus any selected group members immediately, so group games do not require join codes.
      const rows = GC.buildPlayerRows({
        gameId: game.id, userId: user.id, displayName, idxVal, selectedPlayers, groupRoster, guestPlayers,
        hcpOverrides, tee, tees: pickedFav.tees, defaultTeeIdx: teeIdx, playerTeeOverrides: teeAssignments.player,
        flightTeeIdx: teeAssignments.flight, coursePar, holesCount: holesMeta.length, flightsSupported, flightMode, flightBands,
        tgcBettingEnabled: effectiveGroupId(activeGroupId) === TGC_GROUP_ID,
      });
      const { error: e2 } = await supabase.from("game_players").insert(rows);
      if (e2) throw e2;
      await logActivity(supabase, { actor_id: user.id, actor_name: displayName, action: "game_created", group_id: activeGroupId, summary: `Created the game "${game.name}" at ${pickedFav.name}` });
      // P4 handoff: link this game back to the originating tee time and record it
      // in the tee-time activity trail (tt_ actions are kept out of the Money log).
      if (seed?.teeTimeId) {
        try {
          await supabase.rpc("link_tee_time_game", { p_tee_time_id: seed.teeTimeId, p_game_id: game.id });
          await supabase.from("group_activity").insert({ group_id: activeGroupId, actor_user_id: user.id, action: "tt_game_linked", summary: `created a game from this tee time ("${game.name}")`, meta: { tee_time_id: seed.teeTimeId, game_id: game.id } });
        } catch { /* linking never blocks game creation */ }
      }
      for (const row of rows) {
        if (row.user_id && row.user_id !== user.id) {
          try {
            await supabase.rpc("create_notification", {
              p_recipient: row.user_id,
              p_message: `You've been added to the game "${game.name}". Open the Games tab to enter your scores (code ${game.code}).`,
              p_group_id: activeGroupId,
            });
          } catch {}
        }
      }
      // Lean Create owns the core game only. Persisted structure stays authoritative in
      // Manage Game, so formats that need teams/matchups/foursomes hand off there.
      const destination = GC.postCreateDestination(gameType, teamMode);
      clearSetupDraft(activeGroupId, teeTimeId); // setup finished — drop the local draft
      onCreated(game.id, destination.roomTab, destination.setupTab as SetupTab | undefined);
    } catch (e: any) {
      setErr(e.message || "Failed to create game.");
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 600 }}>
      <Eyebrow>CREATE A GAME</Eyebrow>
      {draftAvailable && !draftDismissed && (
        <div style={{ marginTop: 12, background: "#faf6ea", border: `1px solid ${C.gold}`, borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ color: C.ink, fontSize: 13, fontWeight: 700 }}>Resume your setup?</div>
          <div style={{ color: C.faint, fontSize: 12, marginTop: 3, lineHeight: 1.45 }}>
            You left a game setup unfinished {draftAgeLabel(draftAvailable.savedAt)}. Pick up where you left off, or start fresh.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={() => applyDraft(draftAvailable)} style={{ ...btn(true), fontSize: 13 }}>Resume</button>
            <button onClick={startFresh} style={{ ...btn(false), fontSize: 13 }}>Start fresh</button>
          </div>
        </div>
      )}
      <CreateGameWorkspace
        activeSection={createSection}
        onSectionChange={setCreateSection}
        sections={[
          { key: "game", label: "Game", done: !!pickedFav && !!tee },
          { key: "players", label: "Players", done: (groupRoster.filter((p) => selectedPlayers[p.id] || p.id === user.id).length + guestPlayers.length) > 0 },
          { key: "format", label: "Format", done: !!gameType },
          { key: "review", label: "Review", done: !!pickedFav && !!tee && !flightBlocked },
        ]}
      >
        {createSection === "game" && (
          <div>
      <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 190 }}>
          <label style={{ color: C.sage, fontSize: 12 }}>Game name</label>
          <input
            style={{ ...inputStyle, marginTop: 6 }}
            value={name}
            placeholder="Leave blank to auto-name"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label style={{ color: C.sage, fontSize: 12 }}>Play date</label>
          <div><ShortDateInput value={matchDate} onChange={(v) => setMatchDate(v || todayLocal())} /></div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={{ color: C.sage, fontSize: 12 }}>
          Course (from your favorites — so par &amp; stroke index are correct)
        </label>
        {favorites.length === 0 && (
          <div
            style={{
              color: C.sage,
              fontSize: 13,
              marginTop: 8,
              background: C.greenLight,
              borderRadius: 10,
              padding: 12,
            }}
          >
            You have no favorite courses yet. Go to a New round, pick a course,
            fix its data, and save it as a favorite first — then it'll appear
            here.
          </div>
        )}
        {favorites.map((f, i) => {
          const selected = pickedFav?.id != null ? pickedFav.id === f.id : pickedFav?.name === f.name;
          return (
          <button
            key={i}
            onClick={() => {
              setPickedFav(f);
              setTeeIdx(defaultTeeIdx(f.tees, effectiveGroupId(activeGroupId) === TGC_GROUP_ID));
              setTeeAssignments({ player: {}, flight: {} });
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              textAlign: "left",
              marginTop: 8,
              cursor: "pointer",
              background: selected ? C.cream : C.card,
              border: `${selected ? 2 : 1}px solid ${selected ? C.gold : C.line}`,
              borderRadius: 10,
              padding: "10px 14px",
            }}
          >
            <span style={{ width: 20, height: 20, borderRadius: 999, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: selected ? C.green : "transparent", border: selected ? "none" : `1.5px solid ${C.line}`, color: C.cream, fontSize: 12, fontWeight: 800 }}>{selected ? "✓" : ""}</span>
            <span style={{ flex: 1 }}>
              <span style={{ color: C.ink, fontWeight: 700 }}>{f.name}</span>
              {f.location ? (
                <span style={{ color: C.faint, fontSize: 13 }}>{" "}· {f.location}</span>
              ) : null}
            </span>
            {selected && <span style={{ color: C.green, fontSize: 11, fontWeight: 800, letterSpacing: 0.5 }}>SELECTED</span>}
          </button>
          );
        })}
      </div>

      {pickedFav && (
        <div
          style={{
            background: C.greenLight,
            borderRadius: 14,
            padding: 16,
            marginTop: 14,
          }}
        >
          <label style={{ color: C.sage, fontSize: 12 }}>Default tee for the field</label>
          <div
            style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}
          >
            {pickedFav.tees.map((t: any, i: number) => {
              const yd = (t.yardages || []).reduce((s: number, v: any) => s + (v || 0), 0);
              return (
              <button
                key={i}
                onClick={() => setTeeIdx(i)}
                style={{ ...btn(i === teeIdx), padding: "8px 12px", fontSize: 13, textAlign: "left", lineHeight: 1.25 }}
              >
                <div style={{ fontWeight: 800 }}>{t.name}</div>
                <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{yd > 0 ? `${yd.toLocaleString()} yds · ` : ""}CR {t.rating} / SL {t.slope}</div>
              </button>
              );
            })}
          </div>
          <div style={{ color: C.sage, fontSize: 11, marginTop: 8 }}>Applied to everyone unless a flight or individual player has a different tee.</div>
          <div style={{ marginTop: 12 }}>
            <label style={{ color: C.sage, fontSize: 12 }}>
              Your handicap index
            </label>
            <input
              style={{ ...inputStyle, marginTop: 6, maxWidth: 140 }}
              inputMode="decimal"
              placeholder="14.2"
              value={idxStr}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "" || /^\d*\.?\d*$/.test(v)) setIdxStr(v);
              }}
            />
          </div>
          {ch != null && (
            <div style={{ color: C.gold, fontWeight: 800, marginTop: 10 }}>
              Your course handicap: {ch}
            </div>
          )}
        </div>
      )}

          </div>
        )}

        {createSection === "players" && (
          <div>
      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ color: C.sage, fontSize: 12, flex: 1 }}>
            Players from this group
          </label>
          {(() => {
            const n = groupRoster.filter((p) => selectedPlayers[p.id] || p.id === user.id).length + guestPlayers.length;
            return <span style={{ color: C.gold, fontSize: 12, fontWeight: 800 }}>{n} player{n === 1 ? "" : "s"} selected</span>;
          })()}
        </div>
        <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>
          Add players now so they see the game automatically. You can still
          share the code later, and add or remove players after the game starts.
        </div>
        <div
          style={{
            background: C.greenLight,
            borderRadius: 12,
            padding: 10,
            marginTop: 8,
          }}
        >
          {groupRoster.length === 0 && (
            <div style={{ color: C.sage, fontSize: 13 }}>
              No active group members found yet.
            </div>
          )}
          {groupRoster.map((p) => {
            const isMe = p.id === user.id;
            const checked = !!selectedPlayers[p.id] || isMe;
            const playerIndex = isMe ? idxVal : (hcpOverrides[p.id] ?? p.handicap_index);
            const resolved = checked ? resolveDraftTee(p.id, playerIndex) : null;
            const overrideIdx = teeAssignments.player[p.id];
            return (
              <div
                key={p.id}
                style={{
                  padding: "12px",
                  borderBottom: `1px solid ${C.greenMid}`,
                  borderRadius: 8,
                  background: checked ? "rgba(216,178,74,0.10)" : "transparent",
                }}
              >
                <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: isMe ? "default" : "pointer" }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isMe}
                    onChange={(e) =>
                      setSelectedPlayers((m) => ({ ...m, [p.id]: e.target.checked }))
                    }
                    style={{ width: 22, height: 22, flex: "0 0 auto", accentColor: "#D8B24A", cursor: isMe ? "default" : "pointer" }}
                  />
                  <Avatar src={p.avatar_url} name={p.display_name} size={32} />
                  <span style={{ flex: 1, minWidth: 0, color: C.cream, fontWeight: 700, fontSize: 15 }}>
                    {p.display_name}{isMe ? " (you)" : ""}
                    {checked && resolved ? (
                      <span style={{ display: "block", color: C.sage, fontSize: 11, fontWeight: 400, marginTop: 2 }}>
                        {resolved.tee.name} · {teeSourceLabel(resolved.source, resolved.flight)}
                      </span>
                    ) : null}
                  </span>
                  <span style={{ color: C.sage, fontSize: 12 }}>
                    {playerIndex != null ? `HCP ${playerIndex}` : "no handicap"}
                  </span>
                </label>
                {checked && pickedFav?.tees?.length ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, marginLeft: 66 }}>
                    <label style={{ color: C.sage, fontSize: 11, whiteSpace: "nowrap" }}>Tee</label>
                    <select
                      value={overrideIdx != null ? String(overrideIdx) : "inherit"}
                      onChange={(e) => {
                        const value = e.target.value;
                        setTeeAssignments((cur) => {
                          const player = { ...cur.player };
                          if (value === "inherit") delete player[p.id];
                          else player[p.id] = Number(value);
                          return { ...cur, player };
                        });
                      }}
                      style={{ ...inputStyle, flex: 1, minWidth: 0, padding: "6px 8px", fontSize: 12 }}
                    >
                      <option value="inherit">Use {resolved?.source === "flight" && resolved.flight ? `Flight ${resolved.flight}` : "default"} tee</option>
                      {pickedFav.tees.map((t: any, i: number) => <option key={`${t.name}-${i}`} value={String(i)}>{t.name} · {t.rating}/{t.slope}</option>)}
                    </select>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={{ color: C.sage, fontSize: 12 }}>Guest players</label>
        <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>
          Add guests before creating the game so skins, teams, tee groups, and scoring all start with the correct field. Enter the guest's handicap index — it converts to a course handicap for the selected tee.
        </div>
        <div style={{ background: C.greenLight, borderRadius: 12, padding: 10, marginTop: 8 }}>
          {guestPlayers.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
              {guestPlayers.map((g) => {
                const hasIdx = g.handicap_index != null && !Number.isNaN(g.handicap_index as number);
                const resolved = resolveDraftTee(g.id, hasIdx ? g.handicap_index as number : null);
                const ch = hasIdx && resolved?.tee && coursePar != null ? courseHandicap(g.handicap_index as number, resolved.tee.slope, resolved.tee.rating, coursePar) : null;
                const overrideIdx = teeAssignments.player[g.id];
                return (
                <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 8, background: C.greenMid, borderRadius: 10, padding: "6px 10px" }}>
                  <Avatar src={(g as any).avatar_url ?? null} name={g.display_name} size={22} enlargeable={false} />
                  <span style={{ color: C.cream, fontSize: 13, flex: 1, minWidth: 0 }}>
                    {g.display_name}
                    <span style={{ color: C.sage, fontSize: 11 }}> · guest of {g.guest_of === user.id ? "me" : (groupRoster.find((m) => m.id === g.guest_of)?.display_name || "member")}</span>
                    {resolved ? <span style={{ display: "block", color: C.sage, fontSize: 11 }}>{resolved.tee.name} · {teeSourceLabel(resolved.source, resolved.flight)}</span> : null}
                    {hasIdx ? <span style={{ color: C.sage, fontSize: 11 }}> · idx {g.handicap_index}{ch != null ? ` · ch ${ch}` : ""} <button onClick={() => { setGuestIdxEdits((m) => ({ ...m, [g.id]: String(g.handicap_index) })); setGuestPlayers((prev) => prev.map((p) => (p.id === g.id ? { ...p, handicap_index: null } : p))); }} style={{ background: "none", border: "none", color: "#f6c66b", cursor: "pointer", fontSize: 11, padding: 0, textDecoration: "underline" }}>edit</button></span> : null}
                  </span>
                  {!hasIdx && (
                    <>
                      <span style={{ color: "#f6c66b", fontSize: 11, fontWeight: 800, letterSpacing: 0.4 }}>NEEDS HCP</span>
                      <input
                        value={guestIdxEdits[g.id] ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v !== "" && !/^-?\d*\.?\d*$/.test(v)) return;
                          setGuestIdxEdits((m) => ({ ...m, [g.id]: v }));
                        }}
                        inputMode="decimal"
                        placeholder="Idx"
                        style={{ ...inputStyle, width: 54, padding: "4px 8px", fontSize: 12 }}
                      />
                      <button
                        onClick={() => { const raw = (guestIdxEdits[g.id] ?? "").trim(); const num = parseFloat(raw); if (raw === "" || Number.isNaN(num)) return; setGuestPlayers((prev) => prev.map((p) => (p.id === g.id ? { ...p, handicap_index: num } : p))); }}
                        style={{ background: "#7fd6a3", color: C.green, border: "none", borderRadius: 8, padding: "5px 10px", fontSize: 12, fontWeight: 800, cursor: "pointer" }}
                      >✓</button>
                    </>
                  )}
                  {pickedFav?.tees?.length ? (
                    <select
                      value={overrideIdx != null ? String(overrideIdx) : "inherit"}
                      onChange={(e) => {
                        const value = e.target.value;
                        setTeeAssignments((cur) => {
                          const player = { ...cur.player };
                          if (value === "inherit") delete player[g.id];
                          else player[g.id] = Number(value);
                          return { ...cur, player };
                        });
                      }}
                      title="Guest tee"
                      style={{ ...inputStyle, width: 110, minWidth: 0, padding: "5px 6px", fontSize: 11 }}
                    >
                      <option value="inherit">Inherited tee</option>
                      {pickedFav.tees.map((t: any, i: number) => <option key={`${t.name}-${i}`} value={String(i)}>{t.name}</option>)}
                    </select>
                  ) : null}
                  <button
                    onClick={() => { setGuestPlayers((prev) => prev.filter((p) => p.id !== g.id)); setGuestIdxEdits((m) => { const n = { ...m }; delete n[g.id]; return n; }); setTeeAssignments((cur) => { const player = { ...cur.player }; delete player[g.id]; return { ...cur, player }; }); }}
                    style={{ background: "none", border: "none", color: C.birdie, cursor: "pointer", fontSize: 14, padding: 0 }}
                  >
                    ✕
                  </button>
                </div>
                );
              })}
              {guestPlayers.some((g) => g.handicap_index == null) && (
                <div style={{ color: "#f6c66b", fontSize: 11, lineHeight: 1.4 }}>Guests without a handicap will be created and play off scratch — add an index above if you have one.</div>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Guest name"
              style={{ ...inputStyle, width: "auto", minWidth: 150, flex: 1 }}
            />
            <input
              value={guestHcp}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "" || /^-?\d*\.?\d*$/.test(v)) setGuestHcp(v);
              }}
              inputMode="decimal"
              placeholder="Handicap index"
              style={{ ...inputStyle, width: 130 }}
            />
            <select
              value={guestSponsor || user.id}
              onChange={(e) => setGuestSponsor(e.target.value)}
              title="Which member is this guest playing with? They'll share a group."
              style={{ ...inputStyle, padding: "8px 10px", minWidth: 150 }}
            >
              {groupRoster.map((m) => (
                <option key={m.id} value={m.id}>Guest of {m.id === user.id ? "me" : m.display_name}</option>
              ))}
            </select>
            <button onClick={addGuestPlayer} style={{ ...btn(false), fontSize: 12 }}>+ Add guest</button>
          </div>
        </div>
      </div>

            {pickedFav && tee ? (
              <div style={{ color: C.sage, fontSize: 11, marginTop: 10 }}>Field default: <b style={{ color: C.cream }}>{tee.name}</b>. Flight tees and individual overrides take priority when configured.</div>
            ) : null}
          </div>
        )}

        {createSection === "format" && (
          <div>
      <div style={{ marginTop: 14 }}>
        <label style={{ color: C.sage, fontSize: 12 }}>Format</label>
        {/* Two-family guided chooser: shared with Manage Game so both flows use the same visual language. */}
        <FormatFamilySelector
          value={fmtFamily}
          onChange={(family) => applyGuidedFormatPatch(selectGuidedFamily(guidedFormatState(), family))}
        />
        {fmtFamily === "stroke" ? (
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button onClick={() => applyGuidedFormatPatch(selectGuidedStrokeFormat("stableford"))} style={{ ...btn(gameType === "stableford"), flex: 1, minWidth: 100, fontSize: 13 }}>Stableford</button>
            <button onClick={() => applyGuidedFormatPatch(selectGuidedStrokeFormat("stroke"))} style={{ ...btn(gameType === "stroke"), flex: 1, minWidth: 100, fontSize: 13 }}>Stroke play</button>
            <button onClick={() => applyGuidedFormatPatch(selectGuidedStrokeFormat("skins"))} style={{ ...btn(gameType === "skins" && fmtFamily === "stroke"), flex: 1, minWidth: 100, fontSize: 13 }}>Skins</button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={() => applyGuidedFormatPatch(selectGuidedMatchKind(guidedFormatState(), "ind"))} style={{ ...btn(matchKind === "ind"), flex: 1, fontSize: 13 }}>Individual</button>
              <button onClick={() => applyGuidedFormatPatch(selectGuidedMatchKind(guidedFormatState(), "team"))} style={{ ...btn(matchKind === "team"), flex: 1, fontSize: 13 }}>Team</button>
            </div>
            {matchKind === "ind" ? (
              <div style={{ marginTop: 8 }}>
                <button onClick={() => applyGuidedFormatPatch(selectGuidedMatchKind(guidedFormatState(), "ind"))} style={{ ...btn(gameType === "match"), width: "100%", fontSize: 13 }}>Singles match</button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button onClick={() => applyGuidedFormatPatch(selectGuidedTeamFormat("fourball"))} style={{ ...btn(gameType === "fourball"), flex: 1, minWidth: 104, fontSize: 13 }}>Four-ball</button>
                <button onClick={() => applyGuidedFormatPatch(selectGuidedTeamFormat("trifecta"))} style={{ ...btn(gameType === "trifecta"), flex: 1, minWidth: 104, fontSize: 13 }}>Trifecta</button>
                <button onClick={() => applyGuidedFormatPatch(selectGuidedTeamFormat("skins"))} style={{ ...btn(gameType === "skins"), flex: 1, minWidth: 104, fontSize: 13 }}>Skins</button>
              </div>
            )}
          </>
        )}
        <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>
          {gameType === "stableford"
            ? "Everyone competes on one net-Stableford leaderboard."
            : gameType === "fourball"
            ? "2-player teams play better-net-ball match play. Big groups split into foursomes (2 v 2) — set them up after creating. Great for 12–16 players in 3–4 foursomes."
            : gameType === "skins"
            ? "Skins follows match-play structure: singles can be 1:1, team 1:1 rolls skins into team totals, or team best-ball can be played in foursomes. Halved holes carry forward."
            : gameType === "trifecta"
            ? "Each 2-v-2 foursome plays for three points per hole: the two singles (each player vs their opposite number) plus a team point. Three points per hole riding on every group — set up the foursomes after creating."
            : gameType === "stroke"
            ? "Everyone plays their own ball; lowest total wins. Pick gross or net below — every stroke counts, with no Stableford safety net."
            : "Players are paired 1-on-1. After friends join, you'll set the matchups. Lower handicap plays off scratch; opponent gets the difference."}
        </div>
        {gameType === "trifecta" && (
          <div style={{ background: C.greenLight, borderRadius: 12, padding: 12, marginTop: 10 }}>
            <div style={{ color: C.cream, fontWeight: 700, fontSize: 14 }}>Two teams</div>
            <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>Name the two sides, then build the 2-v-2 foursomes after creating. Each foursome plays for three points a hole.</div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <input style={{ ...inputStyle, flex: 1, minWidth: 130 }} value={team1} onChange={(e) => setTeam1(e.target.value)} placeholder="Team 1 name" />
              <input style={{ ...inputStyle, flex: 1, minWidth: 130 }} value={team2} onChange={(e) => setTeam2(e.target.value)} placeholder="Team 2 name" />
            </div>
            <div style={{ color: C.cream, fontWeight: 700, fontSize: 13, marginTop: 12 }}>Team point</div>
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <button onClick={() => setTeamScoreMode("best_ball")} style={{ ...btn(teamScoreMode === "best_ball"), fontSize: 12, padding: "7px 10px" }}>Best ball</button>
              <button onClick={() => setTeamScoreMode("aggregate")} style={{ ...btn(teamScoreMode === "aggregate"), fontSize: 12, padding: "7px 10px" }}>Shootout (aggregate)</button>
            </div>
            <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>
              {teamScoreMode === "aggregate"
                ? "Shootout — both partners' net scores count. The team's hole score is the two nets added together, not just the better one, so a blow-up by either player hurts."
                : "Best ball — the team's hole score is the better net of the two partners."}
            </div>
            <div style={{ color: C.cream, fontWeight: 700, fontSize: 13, marginTop: 12 }}>Scoring</div>
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <button onClick={() => setTrifectaScoring("per_hole")} style={{ ...btn(trifectaScoring === "per_hole"), fontSize: 12, padding: "7px 10px" }}>1 hole = 1 pt</button>
              <button onClick={() => setTrifectaScoring("match")} style={{ ...btn(trifectaScoring === "match"), fontSize: 12, padding: "7px 10px" }}>1 match = 1 pt (Ryder Cup)</button>
            </div>
            <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>
              {trifectaScoring === "match"
                ? "Ryder Cup — each foursome's 2 singles + 1 team match are worth 1 point each over 18 (½ each if halved). 3 points per foursome."
                : "Per-hole — every hole of all three matches scores. 3 points on every hole."}
            </div>
          </div>
        )}
        {gameType === "stroke" && (
          <div style={{ background: C.greenLight, borderRadius: 12, padding: 12, marginTop: 10 }}>
            <div style={{ color: C.cream, fontWeight: 700, fontSize: 13 }}>Scored by</div>
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <button onClick={() => setStrokeBasis("net")} style={{ ...btn(strokeBasis === "net"), fontSize: 12, padding: "7px 10px" }}>Net</button>
              <button onClick={() => setStrokeBasis("gross")} style={{ ...btn(strokeBasis === "gross"), fontSize: 12, padding: "7px 10px" }}>Gross</button>
            </div>
            <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>
              {strokeBasis === "gross"
                ? "Gross — raw strokes, no handicap. Lowest total wins."
                : "Net — total strokes minus each player's handicap. Lowest net total wins."}
            </div>
          </div>
        )}
        {gameType === "fourball" && (
          <div style={{ background: C.greenLight, borderRadius: 12, padding: 12, marginTop: 10 }}>
            <div style={{ color: C.cream, fontWeight: 700, fontSize: 13 }}>Team score</div>
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <button onClick={() => setTeamScoreMode("best_ball")} style={{ ...btn(teamScoreMode === "best_ball"), fontSize: 12, padding: "7px 10px" }}>Best ball</button>
              <button onClick={() => setTeamScoreMode("aggregate")} style={{ ...btn(teamScoreMode === "aggregate"), fontSize: 12, padding: "7px 10px" }}>Shootout (aggregate)</button>
            </div>
            <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>
              {teamScoreMode === "aggregate"
                ? "Shootout — both partners' net scores are added for the team's hole score, so a blow-up by either hurts."
                : "Best ball — the team's hole score is the better net of the two partners."}
            </div>
          </div>
        )}
        {fmtFamily === "stroke" && gameType === "skins" && !teamMode && (() => {
          const fieldCount = groupRoster.filter((p) => selectedPlayers[p.id] || p.id === user.id).length + guestPlayers.length;
          const tooMany = skinsMode === "split" && fieldCount > 4;
          return (
            <div style={{ background: C.greenLight, borderRadius: 12, padding: 12, marginTop: 10 }}>
              <div style={{ color: C.cream, fontWeight: 700, fontSize: 13 }}>When a hole ties</div>
              <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                <button onClick={() => setSkinsMode("carryover")} style={{ ...btn(skinsMode === "carryover"), fontSize: 12, padding: "7px 10px" }}>Carry over</button>
                <button onClick={() => setSkinsMode("split")} style={{ ...btn(skinsMode === "split"), fontSize: 12, padding: "7px 10px" }}>Split</button>
              </div>
              <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>
                {skinsMode === "split"
                  ? "Split \u2014 each hole is its own prize and a tie shares it evenly. Stays lively, best for up to 4 players."
                  : "Carry over \u2014 a tied hole pushes its skin to the next, building the pot. Scales to any field."}
              </div>
              {tooMany && (
                <div style={{ background: "#4a1d16", border: `1px solid ${C.birdie}`, borderRadius: 9, padding: "8px 10px", marginTop: 8, color: "#f0c5bd", fontSize: 11.5, lineHeight: 1.45 }}>
                  {fieldCount} players is too many for split skins. Use <b>Team skins</b> or <b>1:1 matchups</b>, or switch to <b>Carry over</b>.
                </div>
              )}
            </div>
          );
        })()}
        {((gameType === "match" || gameType === "fourball") || (fmtFamily === "stroke" && gameType === "skins")) && (
          <div style={{ background: C.greenLight, borderRadius: 12, padding: 12, marginTop: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={teamMode} onChange={(e) => applyGuidedFormatPatch(setGuidedTeamMode(e.target.checked))} />
              <span style={{ color: C.cream, fontWeight: 700, fontSize: 14 }}>{gameType === "skins" ? "Team skins" : gameType === "fourball" ? "Create Team Names (Red vs Blue)" : "Team match (e.g. 4 v 4)"}</span>
            </label>
            <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>
              {gameType === "skins"
                ? "Two teams, 1:1 pairings \u2014 skins roll into each team's total. A halved hole carries the pot forward. (For 2-v-2 better-ball, use Match \u00b7 Team \u00b7 Best-ball skins.)"
                : gameType === "fourball"
                ? "Two teams. Each 2-v-2 foursome is worth a point; the team total is the sum across foursomes (a halved foursome = ½ each), Ryder-Cup style. You'll assign players to teams after creating."
                : "Two teams. Each 1-on-1 pairing is worth a point; the team total is the sum (halved matches = ½ each). You'll assign players to teams after creating."}
            </div>
            {teamMode && (
              <>
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <input style={{ ...inputStyle, flex: 1, minWidth: 130 }} value={team1} onChange={(e) => setTeam1(e.target.value)} placeholder="Team 1 name" />
                  <input style={{ ...inputStyle, flex: 1, minWidth: 130 }} value={team2} onChange={(e) => setTeam2(e.target.value)} placeholder="Team 2 name" />
                </div>
              </>
            )}
          </div>
        )}

        {gameType === "skins" && fmtFamily === "match" && (
          <div style={{ background: C.greenLight, borderRadius: 12, padding: 12, marginTop: 10 }}>
            <div style={{ color: C.cream, fontWeight: 700, fontSize: 14 }}>Two teams · skins</div>
            <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>Each hole is a skin between the two sides. Name the sides, then build the 2-v-2 foursomes after creating.</div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <input style={{ ...inputStyle, flex: 1, minWidth: 130 }} value={team1} onChange={(e) => setTeam1(e.target.value)} placeholder="Team 1 name" />
              <input style={{ ...inputStyle, flex: 1, minWidth: 130 }} value={team2} onChange={(e) => setTeam2(e.target.value)} placeholder="Team 2 name" />
            </div>
            <div style={{ color: C.cream, fontWeight: 700, fontSize: 13, marginTop: 12 }}>Team score</div>
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <button onClick={() => setTeamScoreMode("best_ball")} style={{ ...btn(teamScoreMode === "best_ball"), fontSize: 12, padding: "7px 10px" }}>Best ball</button>
              <button onClick={() => setTeamScoreMode("aggregate")} style={{ ...btn(teamScoreMode === "aggregate"), fontSize: 12, padding: "7px 10px" }}>Aggregate</button>
            </div>
            <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>
              {teamScoreMode === "aggregate"
                ? "Aggregate — both partners' net scores are added for the side's hole score."
                : "Best ball — the side's hole score is the better net of the two partners."}
            </div>
            <div style={{ color: C.cream, fontWeight: 700, fontSize: 13, marginTop: 12 }}>When a hole ties</div>
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <button onClick={() => setSkinsMode("carryover")} style={{ ...btn(skinsMode === "carryover"), fontSize: 12, padding: "7px 10px" }}>Carry over</button>
              <button onClick={() => setSkinsMode("split")} style={{ ...btn(skinsMode === "split"), fontSize: 12, padding: "7px 10px" }}>Halved</button>
            </div>
            <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>
              {skinsMode === "split"
                ? "Halved — a tied hole is split, half a skin to each side, with no carryover."
                : "Carry over — a tied hole pushes its skin to the next, building the pot."}
            </div>
          </div>
        )}
        <div style={{ marginTop: 14 }}>
          <label style={{ color: C.sage, fontSize: 12 }}>Handicap allowance</label>
          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
            {[100, 90, 85].map((amt) => (
              <button key={amt} onClick={() => { setAllowancePct(amt); setAllowanceInput(String(amt)); }} style={{ ...btn(allowancePct === amt), fontSize: 13, padding: "8px 14px" }}>{amt}%</button>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="number"
                value={allowanceInput}
                onChange={(e) => {
                  const next = editAllowance(e.target.value);
                  setAllowanceInput(next.text);
                  setAllowancePct(next.pct);
                }}
                onBlur={() => {
                  const next = commitAllowance(allowanceInput);
                  setAllowanceInput(next.text);
                  setAllowancePct(next.pct);
                }}
                style={{ ...inputStyle, width: 64, padding: "8px 10px", fontSize: 13, textAlign: "center" }}
              />
              <span style={{ color: C.sage, fontSize: 13 }}>%</span>
            </div>
          </div>
          <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>
            Players play off this percentage of their course handicap. 100% for singles/Stableford/Skins, 85% standard for four-ball. The lower handicap still plays off the difference in match formats.
          </div>
        </div>
        {flightsSupported && (
          <div style={{ marginTop: 14 }}>
            <label style={{ color: C.sage, fontSize: 12 }}>Flights</label>
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <button onClick={() => setFlightMode("off")} style={{ ...btn(flightMode === "off"), fontSize: 13, padding: "8px 14px" }}>Off</button>
              <button onClick={() => setFlightMode("oneoff")} style={{ ...btn(flightMode === "oneoff"), fontSize: 13, padding: "8px 14px" }}>One-off flights</button>
              <button disabled title="Define season flights under Club settings (coming soon)"
                style={{ ...btn(false), fontSize: 13, padding: "8px 14px", opacity: 0.4, cursor: "not-allowed" }}>Season league</button>
            </div>
            {flightMode === "oneoff" && flightBands ? (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  {[2, 3, 4].map((n) => (
                    <button key={n} onClick={() => setFlightCount(n)} style={{ ...btn(flightCount === n), fontSize: 13, padding: "7px 0", flex: 1 }}>{n}</button>
                  ))}
                </div>
                {(idxVal == null || flightNeedsHcp.length > 0) ? (
                  <div style={{ background: "rgba(184,58,46,.12)", border: "1px solid rgba(184,58,46,.4)", borderRadius: 11, padding: "10px 12px", marginBottom: 10 }}>
                    <div style={{ color: C.cream, fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Handicaps needed to flight this event</div>
                    {idxVal == null ? <div style={{ color: C.sage, fontSize: 11, marginBottom: 6 }}>Enter your own index in the field above.</div> : null}
                    {flightNeedsHcp.map((p) => {
                      const draft = flightHcpDraft[p.id] ?? "";
                      const val = parseFloat(draft);
                      const valid = !Number.isNaN(val) && val >= 0 && val <= 54;
                      const setIt = () => {
                        if (!valid) return;
                        setHcpOverrides((m) => ({ ...m, [p.id]: val }));
                        setFlightHcpDraft((d) => { const nx = { ...d }; delete nx[p.id]; return nx; });
                      };
                      return (
                        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 7, minWidth: 0, fontSize: 13, color: C.cream }}><Avatar src={p.avatar_url} name={p.display_name} size={22} enlargeable={false} /><span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.display_name}</span></span>
                          <input type="number" step="0.1" inputMode="decimal" placeholder="index"
                            value={draft}
                            onChange={(e) => setFlightHcpDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setIt(); } }}
                            style={{ ...inputStyle, width: 72, padding: "6px 9px", fontSize: 13, textAlign: "center" }} />
                          <button onClick={setIt} disabled={!valid}
                            style={{ ...btn(valid), fontSize: 12, padding: "6px 12px", opacity: valid ? 1 : 0.4, cursor: valid ? "pointer" : "not-allowed" }}>Set</button>
                        </div>
                      );
                    })}
                    <div style={{ color: C.sage, fontSize: 11, marginTop: 2 }}>Saved to each player's profile as their handicap going forward.</div>
                  </div>
                ) : null}
                {flightBands.map((b, i) => {
                  const cnt = fieldIndexes.filter((x) => x != null && flightForIndex(x, flightBands) === b.key).length;
                  return (
                    <div key={b.key} style={{ background: C.greenLight, borderRadius: 10, padding: "9px 11px", marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 800, fontSize: 13 }}>{b.name}</span>
                        <span style={{ color: C.sage, fontSize: 11 }}>index {flightRangeLabel(flightBands, i)}</span>
                        <span style={{ marginLeft: "auto", fontFamily: "Georgia, serif", fontWeight: 800, fontSize: 15, color: C.gold }}>{cnt}</span>
                      </div>
                      {pickedFav?.tees?.length ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
                          <label style={{ color: C.sage, fontSize: 11, whiteSpace: "nowrap" }}>Flight tee</label>
                          <select
                            value={teeAssignments.flight[b.key] != null ? String(teeAssignments.flight[b.key]) : "inherit"}
                            onChange={(e) => {
                              const value = e.target.value;
                              setTeeAssignments((cur) => {
                                const flight = { ...cur.flight };
                                if (value === "inherit") delete flight[b.key];
                                else flight[b.key] = Number(value);
                                return { ...cur, flight };
                              });
                            }}
                            style={{ ...inputStyle, flex: 1, minWidth: 0, padding: "6px 8px", fontSize: 12 }}
                          >
                            <option value="inherit">Use game default ({tee?.name || "tee"})</option>
                            {pickedFav.tees.map((t: any, ti: number) => <option key={`${t.name}-${ti}`} value={String(ti)}>{t.name} · {t.rating}/{t.slope}</option>)}
                          </select>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                <div style={{ color: C.sage, fontSize: 11, marginTop: 8 }}>
                  Even split by handicap index into {flightCount} bands, each with its own net winner. A flight can inherit the game default tee or use its own tee. Individual player overrides still take priority. Every player needs an index. Applies to this event only.
                </div>
              </div>
            ) : flightMode === "off" ? (
              <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>Everyone competes on one leaderboard.</div>
            ) : null}
          </div>
        )}
      </div>

          </div>
        )}

        {createSection === "review" && (
          <div>
            <div style={{ background: C.greenLight, borderRadius: 12, padding: 14, border: `1px solid ${C.greenMid}` }}>
              {[
                [!!pickedFav, "Course", pickedFav?.name || "Select a course"],
                [!!tee, "Default tee", tee?.name || "Select a tee"],
                [(groupRoster.filter((p) => selectedPlayers[p.id] || p.id === user.id).length + guestPlayers.length) > 0, "Players", `${groupRoster.filter((p) => selectedPlayers[p.id] || p.id === user.id).length + guestPlayers.length} selected`],
                [!!gameType, "Format", formatReviewLabel({ gameType, teamMode, skinsTeamStyle, teamScoreMode, trifectaScoring, strokeBasis, skinsMode })],
                [!flightBlocked, "Flights", flightMode === "oneoff" ? `${flightCount} flights ready` : "Off"],
              ].map(([ok, label, value], i) => (
                <div key={String(label)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 0", borderBottom: i < 4 ? "1px solid rgba(255,255,255,.08)" : "none" }}>
                  <span style={{ color: ok ? "#5BD08A" : C.gold, fontWeight: 900 }}>{ok ? "✓" : "!"}</span>
                  <span style={{ color: C.sage, fontSize: 12, minWidth: 76 }}>{label}</span>
                  <span style={{ color: C.cream, fontSize: 12.5, fontWeight: 700, marginLeft: "auto", textAlign: "right" }}>{value}</span>
                </div>
              ))}
            </div>
            <div style={{ color: C.sage, fontSize: 11.5, lineHeight: 1.45, marginTop: 9 }}>
              Next: <b style={{ color: C.cream }}>{GC.postCreateDestinationLabel(GC.postCreateDestination(gameType, teamMode))}</b>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button style={btn(false)} onClick={onCancel}>Cancel</button>
              <button
                style={{ ...btn(true), opacity: pickedFav && tee && !busy && !flightBlocked ? 1 : 0.5 }}
                disabled={!pickedFav || !tee || busy || flightBlocked}
                onClick={create}
              >
                {busy ? "Creating…" : "Create game"}
              </button>
            </div>
          </div>
        )}

        {createSection !== "review" && (
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            {createSection !== "game" ? <button style={btn(false)} onClick={() => setCreateSection(createSection === "players" ? "game" : "players")}>Back</button> : <button style={btn(false)} onClick={onCancel}>Cancel</button>}
            <button style={{ ...btn(true), marginLeft: "auto" }} onClick={() => setCreateSection(createSection === "game" ? "players" : createSection === "players" ? "format" : "review")}>Continue</button>
          </div>
        )}
      </CreateGameWorkspace>
      {err && (
        <div style={{ color: "#E8A199", fontSize: 13, marginTop: 10 }}>
          {err}
        </div>
      )}
    </div>
  );

}

// ---------------- Game room: score entry + leaderboard ----------------

// ---------------- Game room: score entry + leaderboard ----------------

function GameRoom({
  gameId,
  initialTab,
  initialSetupTab,
  user,
  displayName,
  isAdmin,
  onBack,
}: {
  gameId: string;
  initialTab?: "play" | "setup";
  initialSetupTab?: SetupTab;
  user: any;
  displayName: string;
  isAdmin?: boolean;
  onBack: () => void;
}) {
  const [game, setGame] = useState<Game | null>(null);
  const paceNow = useNowTick();
  const [players, setPlayers] = useState<Player[]>([]);
  const [me, setMe] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingHole, setSavingHole] = useState<number | null>(null);
  const [syncState, setSyncState] = useState<"idle" | "saving" | "retry" | "synced" | "error">("idle");
  // Connectivity flag. Ownership changes (marker takeover / hand-off / switching to
  // self-scoring) and finishing are FROZEN while offline: they can't be coordinated
  // across devices without the server, and allowing them would break the single-
  // writer-per-row invariant the group model depends on.
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const upd = () => setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    upd();
    window.addEventListener("online", upd);
    window.addEventListener("offline", upd);
    return () => { window.removeEventListener("online", upd); window.removeEventListener("offline", upd); };
  }, []);
  const requireOnline = (msg?: string): boolean => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      alert(msg || "You're offline. This needs a connection — reconnect at the clubhouse first. Keep playing; scores are saved on this phone.");
      return false;
    }
    return true;
  };
  // join-setup if I'm in the game but haven't set my tee/handicap
  const [needsSetup, setNeedsSetup] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reassignTo, setReassignTo] = useState("");
  // Sub-tab inside the game room: "play" (scorecard, default) vs "setup"
  // (assign teams, matchups, manage game). Restored from the saved active game.
  const [roomTab, setRoomTab] = useState<"play" | "setup">(
    () => initialTab || loadActiveGame()?.tab || "play",
  );
  useEffect(() => { saveActiveGame(gameId, roomTab); }, [gameId, roomTab]);
  // Desktop-only affordance: surface the organizer-console link on wide viewports.
  const [orgWide, setOrgWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const on = () => setOrgWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  // Phase 2: the Betting panel signals when posted winnings no longer match the
  // current scores. Show a room-level banner (visible right after an edit) and
  // notify the organizer once per session.
  const [betStale, setBetStale] = useState(false);
  const betStaleNotified = React.useRef(false);
  // #7: once the winnings are corrected (no longer stale), allow a fresh notification
  // for any future staleness episode — while still never spamming within one episode.
  useEffect(() => { if (!betStale) betStaleNotified.current = false; }, [betStale]);
  // #5: flip a player's betting flag. Optimistically update local players (drives
  // BOTH the payout panel and the clean-sweep banners from one source), then persist.
  const toggleBets = async (playerId: string, on: boolean) => {
    setPlayers((prev) => prev.map((p) => (p.id === playerId ? { ...p, bets: on } : p)));
    try { const { error } = await supabase.rpc("set_player_bets", { p_player: playerId, p_bets: on }); if (error) throw error; }
    catch { notifyError("Couldn't update who's betting — it'll re-sync when the game refreshes."); }
  };
  useEffect(() => {
    if (!betStale || betStaleNotified.current || !game?.group_id) return;
    betStaleNotified.current = true;
    const organizerId = game.created_by;
    const editorName = players.find((p) => p.user_id === user.id)?.display_name || "Someone";
    (async () => {
      try {
        await supabase.from("group_activity").insert({ group_id: game.group_id, actor_user_id: user.id, action: "bet_stale", summary: `a score change means the posted bet winnings for "${game.name || game.course || "the game"}" need re-posting`, meta: { game_id: game.id } });
      } catch { /* log is best-effort */ }
      if (organizerId && organizerId !== user.id) {
        try { await supabase.rpc("create_notification", { p_recipient: organizerId, p_message: `${editorName} changed a score in "${game.name || game.course || "a game"}" — the posted bet winnings need re-posting.`, p_group_id: game.group_id }); } catch { /* best-effort */ }
      }
    })();
  }, [betStale, game, players, user.id]);
  // Which step of the setup flow is showing: players & tees, teams, matchups, groups.
  const [setupTab, setSetupTab] = useState<SetupTab>(() => initialSetupTab || "overview");
  const [cardView, setCardView] = useState(false); // show the whole-group vertical scorecard
  const [flightView, setFlightView] = useState<"flight" | "overall">("flight"); // flighted standings: segmented vs one list

  // ---- Tee groups (foursomes that play together, each with its own marker) ----
  const myRow = players.find((p) => p.user_id === user.id) || null;
  const myKey = myRow ? pkey(myRow) : user.id;
  const teeGroupsInUse = players.some((p) => p.tee_group != null);
  const teeGroupList = Array.from(new Set(players.map((p) => p.tee_group).filter((g): g is number => g != null))).sort((a, b) => a - b);
  const [viewGroup, setViewGroup] = useState<number | null>(null);
  useEffect(() => {
    if (!teeGroupsInUse) return;
    setViewGroup((cur) => (cur != null && teeGroupList.includes(cur)) ? cur : (myRow?.tee_group ?? teeGroupList[0] ?? null));
  }, [teeGroupsInUse, myRow?.tee_group, teeGroupList.join(",")]);
  const myGroupHasMarker = teeGroupsInUse && myRow?.tee_group != null && players.some((p) => p.tee_group === myRow!.tee_group && p.is_marker);
  // Roll everyone up to the group card when group scoring turns ON, and drop
  // everyone back to their own scorecard when it turns OFF (disband). Only fires
  // on the transition, so a steady state never fights a manual tab tap. Together
  // with the "individual card hidden while a marker exists" gate, this keeps
  // exactly one writer on any row at a time — no duplicate DB writes.
  const prevGroupScoring = React.useRef(false);
  useEffect(() => {
    const on = !!game?.marker_user_id || !!myGroupHasMarker;
    // Don't auto-snap to the group card once the game is over — an ended game
    // should open on Results, not the scorecard.
    if (game?.status !== "ended" && on !== prevGroupScoring.current) setCardView(on);
    prevGroupScoring.current = on;
  }, [game?.marker_user_id, myGroupHasMarker]);
  const cardPlayers = teeGroupsInUse ? players.filter((p) => p.tee_group === viewGroup) : players;
  const gameEnded = game?.status === "ended";
  const viewedGroupLocked = teeGroupsInUse && cardPlayers.length > 0 && cardPlayers.some((p) => p.group_locked);
  const myGroupLocked = !!myRow?.group_locked;
  const iAmViewedMarker = !!myRow?.is_marker && myRow?.tee_group != null && myRow?.tee_group === viewGroup;
  const cardCanEdit = gameEnded ? false : (teeGroupsInUse ? (iAmViewedMarker && !viewedGroupLocked) : (game?.marker_user_id === user.id));
  const viewedMarkerPlayer = teeGroupsInUse
    ? (players.find((p) => p.tee_group === viewGroup && p.is_marker) || null)
    : (game?.marker_user_id ? (players.find((p) => p.user_id === game.marker_user_id) || null) : null);
  const canClaimViewed = !gameEnded && !viewedGroupLocked && !!myRow && !myRow.is_guest && !!myRow.user_id && myRow.tee_group != null && myRow.tee_group === viewGroup;
  const claimGroupMarker = async () => {
    if (!game || !myRow) return;
    if (!requireOnline("You're offline. Changing who keeps score needs a connection — reconnect at the clubhouse first. Keep playing; scores are saved on this phone.")) return;
    setCardView(true);
    setPlayers((ps) => ps.map((p) => (p.tee_group === myRow.tee_group ? { ...p, is_marker: p.id === myRow.id } : p))); // optimistic
    lastEditRef.current = Date.now();
    await supabase.rpc("claim_group_marker", { p_game: game.id });
    load();
  };
  const releaseGroupMarker = async () => {
    if (!game || !myRow) return;
    if (!requireOnline("You're offline. Changing who keeps score needs a connection — reconnect at the clubhouse first. Keep playing; scores are saved on this phone.")) return;
    setPlayers((ps) => ps.map((p) => (p.id === myRow.id ? { ...p, is_marker: false } : p))); // optimistic
    await supabase.rpc("release_group_marker", { p_game: game.id });
    load();
  };
  const finishMyGroup = async () => {
    if (!game || !myRow?.tee_group) return;
    if (!requireOnline("You're offline. Finishing needs a connection — do it back at the clubhouse. Keep playing; scores are saved on this phone.")) return;
    // Push everything entered offline BEFORE recording the round, so the round is
    // never written from pre-sync server state (which would drop the last holes).
    await drainOutbox();
    const left = countPending();
    if (left > 0) { recomputePending(); alert(left + (left === 1 ? " hole hasn't" : " holes haven't") + " uploaded yet. Tap \"Sync now\", wait until it reaches 0, then finish so the recorded round is complete."); return; }
    const { error } = await supabase.rpc("finish_tee_group_and_post", { p_game: game.id });
    if (error) { alert("Couldn't finish this group — " + error.message); return; }
    await load();
  };
  // Non-organizers only ever see the scorecard.
  useEffect(() => {
    if (roomTab === "setup" && game && game.created_by !== user.id) setRoomTab("play");
  }, [roomTab, game, user.id]);
  const [teeIdx, setTeeIdx] = useState(0);
  const [idxStr, setIdxStr] = useState("");
  const [courseTees, setCourseTees] = useState<CourseTee[]>([]);
  const [courseOptions, setCourseOptions] = useState<Course[]>([]);
  const [finishPrompt, setFinishPrompt] = useState<{ kind: "group" | "game"; teeGroup?: number; gaps: FinishGap[] } | null>(null);
  const [shareCard, setShareCard] = useState(false);
  const [shareGame, setShareGame] = useState(false);

  const load = useCallback(async () => {
    // Boot the room from the local snapshot (merged with this device's per-hole
    // backups). Used for an offline cold launch, and as a fallback if a live fetch fails.
    const bootFromSnapshot = (): boolean => {
      const snap = loadGameSnapshot(gameId);
      if (!snap?.game) return false;
      const n0 = snap.game?.holes_meta?.length || 18;
      const mergedPlayers = (snap.players || []).map((p: any) => {
        const backup = loadGameScores(gameId, p.id);
        if (!backup) return p;
        const { merged } = mergeBackupRow(p, backup, n0);
        saveGameScores(gameId, p.id, merged);
        return { ...p, ...merged };
      });
      setGame(snap.game as any);
      setPlayers(mergedPlayers);
      const mineOff = mergedPlayers.find((p: any) => p.user_id === user.id) || null;
      setMe(mineOff);
      if (snap.courseTees) setCourseTees(snap.courseTees as any);
      if (mineOff && mineOff.course_handicap == null && n0) setNeedsSetup(true);
      setLoading(false);
      return true;
    };
    // Offline: don't await fetches that will just hang for seconds — boot from the
    // snapshot straight away.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      if (bootFromSnapshot()) return;
      setLoading(false);
      return;
    }
    const { data: g } = await supabase
      .from("games")
      .select("*")
      .eq("id", gameId)
      .single();
    const { data: ps } = await supabase
      .from("game_players")
      .select("*")
      .eq("game_id", gameId);
    if (!g) { if (bootFromSnapshot()) return; }
    // Defensively normalize: a freshly created or legacy game may have null
    // pairings/teams/holes_meta, which would crash the match views downstream.
    const safeGame = g
      ? {
          ...g,
          pairings: Array.isArray((g as any).pairings) ? (g as any).pairings : [],
          teams: Array.isArray((g as any).teams) ? (g as any).teams : null,
          foursomes: Array.isArray((g as any).foursomes) ? (g as any).foursomes : null,
          holes_meta: Array.isArray((g as any).holes_meta) ? (g as any).holes_meta : [],
        }
      : g;
    setGame(safeGame as any);
    // Reconcile against the local backups. A score lost to a screen lock or no
    // signal lives in this device's backup; merge it into any hole the DB is
    // missing and push the result back. We reconcile EVERY row this device has a
    // backup for — so in group scoring, the marker recovers the OTHER players'
    // offline-entered scores too, not just their own. A backup only ever fills
    // gaps; it never removes data. (Pushing another player's row needs marker
    // rights server-side; a failed push is swallowed and the backup is kept.)
    const n = (safeGame as any)?.holes_meta?.length || 18;
    const resetAt = (safeGame as any)?.scores_reset_at ? new Date((safeGame as any).scores_reset_at).getTime() : 0;
    const reconciled: any[] = [];
    for (const p of (ps || [])) {
      const backup = loadGameScores(gameId, p.id);
      if (!backup) { reconciled.push(p); continue; }
      // A backup saved before the organizer's last reset is stale — discard it
      // so a reset can't be undone by this device's pre-reset memory.
      if (resetAt && (backup.at ?? 0) < resetAt) { clearGameScores(gameId, p.id); clearSyncedWatermark(gameId, p.id); reconciled.push(p); continue; }
      const { merged, changed } = mergeBackupRow(p, backup, n);
      let row = p;
      if (changed) {
        row = { ...p, ...merged };
        try { await supabase.from("game_players").update(merged).eq("id", p.id); } catch {}
      }
      // Keep the backup in lockstep with the reconciled truth, and mark it synced.
      saveGameScores(gameId, p.id, merged);
      saveSyncedWatermark(gameId, p.id, merged as any);
      reconciled.push(row);
    }
    let mine = reconciled.find((p: any) => p.user_id === user.id) || null;
    setPlayers(reconciled);
    setMe(mine);
    if (safeGame) saveGameSnapshot(gameId, { game: safeGame, players: reconciled });
    if (mine && mine.course_handicap == null && (safeGame as any)?.holes_meta?.length)
      setNeedsSetup(true);
    setLoading(false);
  }, [gameId, user.id]);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!game?.group_id || !game?.course) {
      setCourseTees([]);
      setCourseOptions([]);
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const snap = loadGameSnapshot(gameId);
      setCourseTees(snap?.courseTees && snap.courseTees.length ? (snap.courseTees as any) : []);
      return;
    }
    // Capture the already-validated identifiers before entering the async closure.
    // React state may change while the request is in flight, and TypeScript correctly
    // does not preserve property narrowing across that boundary.
    const groupId = game.group_id;
    const courseName = game.course;
    let alive = true;
    (async () => {
      try {
        const rows = await loadCoursesForGroup(supabase, groupId);
        if (!alive) return;
        const courses = rows.map((r: any) => ({ ...normalizeFavoriteCourse(r), id: r.id } as Course));
        setCourseOptions(courses);
        let found = courses.find((c: any) => c.name === courseName || courseLabel(c) === courseName);

        // A stale/missing group_courses link must not hide player-level tee choice.
        // Games store the course name, so fall back to the global course library by
        // exact name. Yardages may be absent; rating/slope are enough for handicap math.
        if (!found) {
          const { data: globalRows, error: globalError } = await supabase
            .from("favorite_courses")
            .select("*")
            .eq("deleted", false)
            .eq("name", courseName)
            .limit(10);
          if (!globalError) {
            const globalCourses = (globalRows || []).map((r: any) => normalizeFavoriteCourse(r));
            found = globalCourses.find((c: any) => c.name === courseName || courseLabel(c) === courseName);
          }
        }

        const tees = Array.isArray(found?.tees) ? found.tees : [];
        if (tees.length) {
          setCourseTees(tees);
          saveGameSnapshot(gameId, { courseTees: tees });
          return;
        }

        // Keep saved tee snapshots rather than blanking the selector when course data
        // is temporarily unavailable. The OrganizerPanel also merges game-player tee
        // snapshots so existing player-level tee choices remain usable.
        const snap = loadGameSnapshot(gameId);
        setCourseTees(snap?.courseTees && snap.courseTees.length ? (snap.courseTees as any) : []);
      } catch {
        if (!alive) return;
        const snap = loadGameSnapshot(gameId);
        if (snap?.courseTees?.length) setCourseTees(snap.courseTees as any);
      }
    })();
    return () => { alive = false; };
  }, [game?.group_id, game?.course]);

  // Auto-refresh every minute so players see each other's scores without manual refresh.
  // Pauses while actively entering a score (a save in the last 25s, or one in progress).
  const lastEditRef = React.useRef(0);
  useEffect(() => {
    const t = setInterval(() => {
      if (savingHole != null) return;
      if (Date.now() - (lastEditRef.current || 0) < 25000) return;
      load();
    }, 60000);
    return () => clearInterval(t);
  }, [load, savingHole, game?.status]);

  // Real-time: refresh within ~1s when anyone's scores or the marker change,
  // so read-only viewers see the marker's entries land live. Guarded by
  // lastEditRef so it never clobbers an edit this device just made.
  useEffect(() => {
    if (!gameId) return;
    const refresh = () => {
      if (Date.now() - (lastEditRef.current || 0) < 1500) return;
      load();
    };
    const ch = supabase
      .channel(`game-${gameId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_players", filter: `game_id=eq.${gameId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `id=eq.${gameId}` }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [gameId]);

  // Lock-time safety: when the page hides (screen lock / app background), force the
  // latest scores into the local backup AND re-attempt the DB write, so a hole
  // entered an instant before locking can't be lost to a frozen network request.
  const meRef = React.useRef<Player | null>(me);
  meRef.current = me;
  const gameIdRef = React.useRef(gameId);
  gameIdRef.current = gameId;
  const playersRef = React.useRef<Player[]>(players);
  playersRef.current = players;
  // Pending = holes saved on this phone but not yet confirmed on the server.
  const [pendingHoles, setPendingHoles] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const countPending = React.useCallback(() => {
    let total = 0;
    for (const pl of playersRef.current) {
      const b = loadGameScores(gameIdRef.current, pl.id);
      if (!b) continue;
      total += rowPendingHoles(b as any, loadSyncedWatermark(gameIdRef.current, pl.id));
    }
    return total;
  }, []);
  const recomputePending = React.useCallback(() => { setPendingHoles(countPending()); }, [countPending]);
  // Durable outbox drain: push every row whose local backup differs from its synced
  // watermark (full last-write-wins per row — safe under the single-writer model),
  // then mark it synced. Triggered on reconnect, foreground, a slow poll, and manual
  // Sync now — so recovery never depends on the browser’s online event firing.
  const drainingRef = React.useRef(false);
  // Set after pushRowCols is defined below; lets this memoized drain always use the latest.
  const pushRowColsRef = React.useRef<(rowId: string, bundle: any, clock?: Record<string, unknown>) => Promise<boolean>>(async () => true);
  const drainOutbox = React.useCallback(async (): Promise<number> => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;
    if (drainingRef.current) return 0;
    drainingRef.current = true;
    let pushed = 0;
    try {
      for (const pl of playersRef.current) {
        const b = loadGameScores(gameIdRef.current, pl.id);
        if (!b) continue;
        if (rowPendingHoles(b as any, loadSyncedWatermark(gameIdRef.current, pl.id)) === 0) continue;
        const bundle = { scores: b.scores, putts: b.putts, fairways: b.fairways, penalties: b.penalties, sand: b.sand };
        // Column-scoped + role-aware: marker/self direct-writes changed columns; a
        // non-marker's own row goes stats-only through the chokepoint. LWW per column.
        const okd = await pushRowColsRef.current(pl.id, bundle);
        if (okd) pushed++;
      }
    } finally {
      drainingRef.current = false;
      recomputePending();
    }
    return pushed;
  }, [recomputePending]);
  const syncNow = async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      alert("You\u2019re offline. Your scores are saved on this phone and will sync automatically when you\u2019re back in range.");
      return;
    }
    setSyncing(true);
    try { await drainOutbox(); await load(); } finally { setSyncing(false); }
  };
  // True when someone ELSE is the marker for my group — then the marker owns my
  // row and this device must never write it (a stale background flush would
  // otherwise clobber the marker's latest entry).
  const markerOwnsMyRowRef = React.useRef(false);
  markerOwnsMyRowRef.current = markerOwnsMyRow({
    teeGroupsInUse,
    myUserId: user.id,
    myTeeGroup: myRow?.tee_group ?? null,
    myIsMarker: myRow?.is_marker ?? false,
    gameMarkerUserId: game?.marker_user_id ?? null,
    players,
  });
  // True when the gross score for a given row is owned by SOMEONE ELSE (a group/tee-group
  // marker, or the whole-game marker) — i.e. this device may write that row's peripheral
  // stats but never its score. Individual scoring returns false (you own your own row).
  const scoreLockedForRow = React.useCallback((rowId: string): boolean => {
    const row = playersRef.current.find((p) => p.id === rowId);
    if (!row) return false;
    if (teeGroupsInUse && row.tee_group != null) {
      const mk = playersRef.current.find((p) => p.tee_group === row.tee_group && p.is_marker);
      return !!mk && mk.user_id !== user.id;
    }
    if (game?.marker_user_id) return game.marker_user_id !== user.id;
    return false;
  }, [teeGroupsInUse, game?.marker_user_id, user.id]);
  // Advance the synced watermark for exactly the columns we just pushed (merge, don't
  // replace) so untouched columns don't later look dirty and get needlessly rewritten.
  const advanceWatermark = (gid: string, rowId: string, bundle: any, cols: string[]) => {
    const prev = loadSyncedWatermark(gid, rowId) || { scores: [], putts: [], fairways: [], penalties: [], sand: [] };
    saveSyncedWatermark(gid, rowId, { ...prev, ...pickCols(bundle, cols as any) } as any);
  };
  // Push a row's changes column-scoped + role-aware. Marker/self → direct update of the
  // changed columns. Non-marker on their own row → stats-only via the save_hole_stats
  // chokepoint (server refuses to write the score). Returns true if something was written
  // (or nothing needed writing). LWW per column.
  const pushRowCols = async (rowId: string, bundle: any, clock?: Record<string, unknown>): Promise<boolean> => {
    const gid = gameIdRef.current;
    const locked = scoreLockedForRow(rowId);
    let cols = changedCols(bundle, loadSyncedWatermark(gid, rowId));
    if (locked) cols = cols.filter((c) => c !== "scores");
    if (!cols.length) return true;
    if (locked) {
      const { error } = await supabase.rpc("save_hole_stats", {
        p_player: rowId,
        p_putts: cols.includes("putts") ? bundle.putts : null,
        p_fairways: cols.includes("fairways") ? bundle.fairways : null,
        p_penalties: cols.includes("penalties") ? bundle.penalties : null,
        p_sand: cols.includes("sand") ? bundle.sand : null,
      });
      if (error) return false;
    } else {
      const body = { ...pickCols(bundle, cols), ...(clock || {}) };
      const { error } = await supabase.from("game_players").update(body).eq("id", rowId);
      if (error) return false;
    }
    advanceWatermark(gid, rowId, bundle, cols);
    return true;
  };
  pushRowColsRef.current = pushRowCols;
  // Set true for the duration of a score reset so the background flush can't
  // re-write the old scores (a PWA confirm() can fire visibilitychange/blur,
  // which would otherwise flush the stale row right back over the reset).
  const resettingRef = React.useRef(false);
  useEffect(() => {
    const flush = () => {
      if (resettingRef.current) return;       // a reset is in progress; don't write
      const m = meRef.current;
      if (!m) return;
      const gid = gameIdRef.current;
      const bundle = { scores: m.scores || [], putts: m.putts || [], fairways: m.fairways || [], penalties: m.penalties || [], sand: m.sand || [] };
      saveGameScores(gid, m.id, bundle);              // synchronous local backup, always lands
      // Best-effort network flush of only my changed columns; if a marker owns my score
      // it goes stats-only through the chokepoint (pushRowCols handles the routing).
      void pushRowCols(m.id, bundle);
    };
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("freeze", flush);
    window.addEventListener("pagehide", flush);
    window.addEventListener("blur", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("freeze", flush);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("blur", flush);
    };
  }, []);

  // When the device comes back online, reload — which reconciles every backed-up
  // row and pushes any holes the DB is missing (offline entries) back up. This
  // syncs without needing to reopen the game.
  useEffect(() => {
    // Reconnect: push my dirty rows FIRST (authoritative), then reload to pull others'.
    const onOnline = () => { drainOutbox().then(() => load()); };
    // Foreground / focus: covers cases where the 'online' event never fires.
    const onVis = () => { if (document.visibilityState === "visible") drainOutbox(); };
    const onFocus = () => { drainOutbox(); };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    // Slow poll: drainOutbox is a cheap local check when nothing's dirty / offline.
    const iv = window.setInterval(() => { drainOutbox(); }, 20000);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(iv);
    };
  }, [drainOutbox, load]);
  // Recompute the pending count whenever the players (and thus their scores) change.
  useEffect(() => { recomputePending(); }, [players, recomputePending]);

  // Build a player's per-hole Hole[] (with strokes received) for scoring math.
  const playerHoles = (p: Player): Hole[] => PS.playerHoles(p, game);
  const playerPoints = (p: Player) => PS.playerPoints(p, game);
  const playerThru = (p: Player) => PS.playerThru(p);
  // Gross = total strokes on holes played. Net = gross minus strokes received on those holes.
  const playerGross = (p: Player) => PS.playerGross(p, game);
  const playerNet = (p: Player) => PS.playerNet(p, game);
  // Net score relative to par, derived from Stableford: par = 2 pts/hole, so rel = 2*thru − points.
  const relToParStr = (p: Player) => PS.relToParStr(p, game);
  // Par of the holes played so far (for true stroke over/under par, uncapped).
  const parThru = (p: Player) => PS.parThru(p, game);
  const leaderName = (full: string) => PS.leaderName(full);

  // Save one hole's data (strokes / putts / fairway) for me.
  // Push a score row to the server with visible status + safe retries. The local backup
  // (saveGameScores) is always written BEFORE this runs, so data is never lost; this just
  // surfaces sync state and retries. Retries re-read the freshest local backup for the row,
  // so a slow retry can never revert a hole entered in the meantime.
  const pushScores = async (rowId: string, firstBody: Record<string, unknown>) => {
    const gid = gameIdRef.current;
    const clock: Record<string, unknown> = {};
    if ("clock_start" in firstBody) clock.clock_start = (firstBody as any).clock_start;
    if ("clock_end" in firstBody) clock.clock_end = (firstBody as any).clock_end;
    const bundleOf = (src: Record<string, unknown>) => ({
      scores: (src as any).scores, putts: (src as any).putts, fairways: (src as any).fairways,
      penalties: (src as any).penalties, sand: (src as any).sand,
    });
    const freshest = () => {
      const b = loadGameScores(gid, rowId);
      return b ? bundleOf(b as any) : bundleOf(firstBody);
    };
    for (let n = 0; n < 4; n++) {
      setSyncState(n === 0 ? "saving" : "retry");
      const okd = await pushRowCols(rowId, n === 0 ? bundleOf(firstBody) : freshest(), n === 0 ? clock : undefined);
      if (okd) {
        setSyncState("synced");
        recomputePending();
        window.setTimeout(() => setSyncState((cur) => (cur === "synced" ? "idle" : cur)), 1600);
        return;
      }
      if (n < 3) await new Promise((r) => setTimeout(r, 1500 * (n + 1)));
    }
    setSyncState("error"); // saved on this device; reconciles on next open
  };

  const setMyHole = async (
    holeIdx: number,
    patch: {
      strokes?: number | null;
      putts?: number | null;
      fairway?: "hit" | "miss" | "left" | "right" | null;
      penalties?: number | null;
      sand?: boolean | null;
    },
  ) => {
    if (!me) return;
    const n = game?.holes_meta.length || 18;
    const scores = [...(me.scores || Array(n).fill(null))];
    const putts = [...(me.putts || Array(n).fill(null))];
    const fairways = [...(me.fairways || Array(n).fill(null))];
    const penalties = [...(me.penalties || Array(n).fill(null))];
    const sand = [...(me.sand || Array(n).fill(null))];
    if ("strokes" in patch) scores[holeIdx] = patch.strokes ?? null;
    if ("putts" in patch) putts[holeIdx] = patch.putts ?? null;
    if ("fairway" in patch) fairways[holeIdx] = patch.fairway ?? null;
    if ("penalties" in patch) penalties[holeIdx] = patch.penalties ?? 0;
    if ("sand" in patch) sand[holeIdx] = patch.sand ?? false;
    const clockPatch: { clock_start?: string; clock_end?: string } = {};
    const nowIso = new Date().toISOString();
    if (me.clock_start == null) clockPatch.clock_start = nowIso;
    if (scores[n - 1] != null && me.clock_end == null) clockPatch.clock_end = nowIso;
    const updated = { ...me, scores, putts, fairways, penalties, sand, ...clockPatch };
    setMe(updated);
    setPlayers((ps) => ps.map((p) => (p.id === me.id ? updated : p)));
    // Synchronous local backup FIRST — survives an immediate lock even if the
    // network write below gets frozen. Reconciled to the DB on next load.
    if (game) saveGameScores(game.id, me.id, { scores, putts, fairways, penalties, sand }, true);
    setSavingHole(holeIdx);
    lastEditRef.current = Date.now();
    await pushScores(me.id, { scores, putts, fairways, penalties, sand, ...clockPatch });
    lastEditRef.current = Date.now();
    setSavingHole(null);
  };

  // Marker: write one hole for ANY player in the group. Requires marker rights,
  // enforced server-side by RLS (see migration 0006).
  const setPlayerHole = async (
    playerId: string,
    holeIdx: number,
    patch: { strokes?: number | null; putts?: number | null; fairway?: "hit" | "miss" | "left" | "right" | null; penalties?: number | null; sand?: boolean | null },
  ) => {
    const target = players.find((p) => p.id === playerId);
    if (!game || !target) return;
    const n = game.holes_meta.length || 18;
    const scores = [...(target.scores || Array(n).fill(null))];
    const putts = [...(target.putts || Array(n).fill(null))];
    const fairways = [...(target.fairways || Array(n).fill(null))];
    const penalties = [...(target.penalties || Array(n).fill(null))];
    const sand = [...(target.sand || Array(n).fill(null))];
    if ("strokes" in patch) scores[holeIdx] = patch.strokes ?? null;
    if ("putts" in patch) putts[holeIdx] = patch.putts ?? null;
    if ("fairway" in patch) fairways[holeIdx] = patch.fairway ?? null;
    if ("penalties" in patch) penalties[holeIdx] = patch.penalties ?? 0;
    if ("sand" in patch) sand[holeIdx] = patch.sand ?? false;
    const clockPatch: { clock_start?: string; clock_end?: string } = {};
    const nowIso = new Date().toISOString();
    if (target.clock_start == null) clockPatch.clock_start = nowIso;
    if (scores[n - 1] != null && target.clock_end == null) clockPatch.clock_end = nowIso;
    const updated = { ...target, scores, putts, fairways, penalties, sand, ...clockPatch };
    setPlayers((ps) => ps.map((p) => (p.id === playerId ? updated : p)));
    if (target.id === me?.id) setMe(updated);
    // Group scoring: the marker holds everyone's scores, so back up EVERY row this
    // device writes (not just the marker's own) — with penalties/sand — so an
    // offline/lock entry for any player is recoverable. Synced back on reopen /
    // reconnect (see load()).
    if (game) saveGameScores(game.id, playerId, { scores, putts, fairways, penalties, sand }, true);
    lastEditRef.current = Date.now();
    await pushScores(playerId, { scores, putts, fairways, penalties, sand, ...clockPatch });
    lastEditRef.current = Date.now();
  };

  // Claim / release the group scorecard (the "marker"). Uses a SECURITY DEFINER
  // RPC so only a group member can claim, and only the marker can release.
  const takeOverScoring = async () => {
    if (!game) return;
    if (!requireOnline("You're offline. Changing who keeps score needs a connection — reconnect at the clubhouse first. Keep playing; scores are saved on this phone.")) return;
    setGame({ ...game, marker_user_id: user.id }); // optimistic
    setCardView(true);
    await supabase.rpc("claim_marker", { p_game_id: game.id });
  };
  const releaseScoring = async () => {
    if (!game) return;
    if (!requireOnline("You're offline. Changing who keeps score needs a connection — reconnect at the clubhouse first. Keep playing; scores are saved on this phone.")) return;
    setGame({ ...game, marker_user_id: null });
    await supabase.rpc("release_marker", { p_game_id: game.id });
  };

  // "Everyone scores their own" — disband group scoring so every player gets their
  // own card back. ANY member can do this, not just the current marker: releasing
  // the marker to "nobody" is holder-only, but anyone may take it over first
  // (claim_marker / claim_group_marker overwrite the current holder). So when we
  // don't already hold it, we claim-then-release. A marker exists continuously
  // until that final release, so individual cards stay hidden the whole time and
  // no two devices ever write the same row (the no-dupe-write invariant).
  const everyoneScoresOwn = async () => {
    if (!game) { setCardView(false); return; }
    if (!requireOnline("You're offline. Changing who keeps score needs a connection — reconnect at the clubhouse first. Keep playing; scores are saved on this phone.")) return;
    // Disband group scoring: clear BOTH marker mechanisms (a game can carry a
    // simple games.marker_user_id AND tee groups), so each player gets their own
    // card back. Any member can do this — releasing to "nobody" is holder-only,
    // but anyone may take the marker over first, so we claim-then-release when we
    // don't already hold it. A marker exists continuously until the final release,
    // so individual cards stay hidden the whole time and no two devices ever write
    // the same row.
    if (game.marker_user_id) {
      if (game.marker_user_id !== user.id) await supabase.rpc("claim_marker", { p_game_id: game.id });
      await supabase.rpc("release_marker", { p_game_id: game.id });
      setGame({ ...game, marker_user_id: null }); // optimistic
    }
    const grpMarker = players.find((p) => p.tee_group != null && p.tee_group === myRow?.tee_group && p.is_marker);
    if (grpMarker) {
      if (grpMarker.id !== myRow?.id) await supabase.rpc("claim_group_marker", { p_game: game.id });
      await supabase.rpc("release_group_marker", { p_game: game.id });
      setPlayers((ps) => ps.map((p) => (p.tee_group === myRow?.tee_group ? { ...p, is_marker: false } : p))); // optimistic
    }
    setCardView(false);
    load();
  };
  const completeSetup = async () => {
    if (!game || !me) return;
    const idxVal = idxStr.trim() === "" ? null : parseFloat(idxStr);
    // Use this player's own rating/slope if set, else borrow from another player who has them.
    const ref =
      me.rating != null && me.slope != null
        ? me
        : players.find((p) => p.rating != null && p.slope != null);
    const rating = ref?.rating ?? null,
      slope = ref?.slope ?? null;
    const ch =
      idxVal != null &&
      rating != null &&
      slope != null &&
      game.course_par != null
        ? courseHandicap(idxVal, slope, rating, game.course_par)
        : null;
    await supabase
      .from("game_players")
      .update({
        handicap_index: idxVal,
        rating,
        slope,
        tee_name: ref?.tee_name ?? me.tee_name ?? null,
        course_handicap: ch,
      })
      .eq("id", me.id);
    setNeedsSetup(false);
    await load();
  };

  const setupDecision = (action: SetupAction): SetupDecision => {
    if (!game) return { decision: "block", reason: "Game is not loaded." };
    return decideSetupChange({ game, players, action });
  };
  const allowSetupChange = (action: SetupAction): boolean => {
    const d = setupDecision(action);
    if (d.decision === "block") { alert(d.reason); return false; }
    if (d.decision === "confirm") return confirm(`${d.title}\n\n${d.message}`);
    return true;
  };

  // Organizer: override any player's handicap index for this game (recomputes course handicap).
  const overridePlayerHandicap = async (p: Player, idxVal: number | null) => {
    if (!game || !allowSetupChange({ type: "set_handicap", player: p })) return;
    // Handicap overrides must use THIS player's selected tee snapshot. Never borrow
    // another player's rating/slope: that can produce a valid-looking but wrong CH.
    const rating = p.rating ?? null;
    const slope = p.slope ?? null;
    const ch =
      idxVal != null &&
      rating != null &&
      slope != null &&
      game.course_par != null
        ? courseHandicap(idxVal, slope, rating, game.course_par)
        : null;
    await supabase
      .from("game_players")
      .update({
        handicap_index: idxVal,
        course_handicap: ch,
      })
      .eq("id", p.id);
    // Notify the player their game handicap was set by the organizer (if it's not the organizer themselves).
    if (p.user_id && p.user_id !== user.id) {
      try {
        await supabase.rpc("create_notification", {
          p_recipient: p.user_id,
          p_message: `Your handicap for "${game.name}" was set to ${idxVal ?? "—"} (course handicap ${ch ?? "—"}) by the organizer.`,
        });
      } catch {}
    }
    await load();
  };

  // Organizer: update a player's team assignment from the unified setup roster.
  const setPlayerTeam = async (p: Player, team: string | null) => {
    if (!allowSetupChange({ type: "set_team", player: p, team })) return;
    await supabase.from("game_players").update({ team }).eq("id", p.id);
    await load();
  };

  // Organizer: update a player's tee group from the unified setup roster.
  const setPlayerTeeGroup = async (p: Player, group: number | null) => {
    if (!allowSetupChange({ type: "set_tee_group", player: p, group })) return;
    const { error } = await supabase.rpc("set_tee_group", { p_player: p.id, p_group: group });
    if (error) notifyError("Couldn't update that player's group — please try again.");
    await load();
  };

  // Organizer: shuffle the field into balanced foursomes, keeping each guest with
  // the member who sponsored them. Overflow guests (a sponsor with >3 guests) are
  // left unassigned for manual placement. Pre-round only — see canRandomize below.
  const [randomizing, setRandomizing] = useState(false);
  const [groupOverflow, setGroupOverflow] = useState<string[]>([]); // player ids left unassigned by the shuffle
  const randomizeDecision = game ? setupDecision({ type: "randomize_groups" }) : { decision: "block", reason: "Game is not loaded." } as SetupDecision;
  const canRandomize = randomizeDecision.decision !== "block";
  const randomizeReason = randomizeDecision.decision === "block" ? randomizeDecision.reason : "";
  const randomizeGroups = async () => {
    if (!game || !canRandomize || !allowSetupChange({ type: "randomize_groups" })) return;
    const field: GPlayer[] = players
      .filter((p) => !p.no_show)
      .map((p) => ({ id: p.id, userId: p.user_id ?? null, isGuest: !!p.is_guest, guestOf: p.guest_of ?? null }));
    const { assignments, overflowGuestIds } = randomTeeGroups(field, 4);
    const byId = new Map(assignments.map((a) => [a.playerId, a.group]));
    setPlayers((prev) => prev.map((p) => (p.no_show ? p : ({ ...p, tee_group: overflowGuestIds.includes(p.id) ? null : (byId.get(p.id) ?? null) })))); // optimistic
    setGroupOverflow(overflowGuestIds);
    setRandomizing(true);
    try {
      const payload = [
        ...assignments.map((a) => ({ player: a.playerId, group: a.group })),
        ...overflowGuestIds.map((id) => ({ player: id, group: null })),
      ];
      const { error } = await supabase.rpc("set_tee_groups", { p_game: game.id, p_assignments: payload });
      if (error) throw error;
    } catch {
      notifyError("Couldn't save the shuffled groups — please try again."); // reload below reconciles from the DB
    } finally {
      setRandomizing(false);
      await load();
    }
  };

  // --- Add players / guests after the game has started (forgot someone, a walk-up, etc.) ---
  // Group members in this game's group who aren't in the field yet.
  const [eligibleMembers, setEligibleMembers] = useState<{ id: string; display_name: string; handicap_index: number | null }[]>([]);
  useEffect(() => {
    const gid = game?.group_id;
    if (!gid) { setEligibleMembers([]); return; }
    let cancelled = false;
    (async () => {
      const { data: mem } = await supabase.from("group_members").select("user_id").eq("group_id", gid).eq("status", "active");
      const ids = (mem || []).map((r: any) => r.user_id).filter(Boolean);
      if (!ids.length) { if (!cancelled) setEligibleMembers([]); return; }
      const { data: profs } = await supabase.from("profiles").select("id, display_name, handicap_index").in("id", ids);
      const inGame = new Set(players.map((p) => p.user_id).filter(Boolean) as string[]);
      if (!cancelled) setEligibleMembers((profs || [])
        .filter((p: any) => !inGame.has(p.id))
        .map((p: any) => ({ id: p.id, display_name: p.display_name || "Player", handicap_index: p.handicap_index ?? null })));
    })();
    return () => { cancelled = true; };
  }, [game?.group_id, players]);

  // New players inherit the tee already in use (mirrors how a code-join borrows the tee).
  const refTee = () => GU.refTee(players);
  const blankCard = () => GU.blankCard(game);
  const addGuestToGame = async (name: string, idx: number, sponsor: string) => {
    if (!game || !name.trim() || Number.isNaN(idx) || !allowSetupChange({ type: "add_player", guest: true })) return;
    const t = refTee();
    const ch = (t.slope != null && t.rating != null && game.course_par != null)
      ? courseHandicap(idx, t.slope, t.rating, game.course_par) : null;
    const { error } = await supabase.from("game_players").insert({
      game_id: game.id, user_id: null, is_guest: true, guest_of: sponsor || null, bets: effectiveGroupId(game.group_id) === TGC_GROUP_ID ? false : true, display_name: name.trim(),
      handicap_index: idx, rating: t.rating, slope: t.slope, tee_name: t.tee_name,
      course_handicap: ch, ...blankCard(),
    });
    if (error) { notifyError("Couldn't add that guest — please try again."); return; }
    // Note: game guests are intentionally NOT written to the persistent group_guests
    // list — they're temporary to this game. (The Money tab keeps its own guests.)
    await load();
  };
  const addMemberToGame = async (m: { id: string; display_name: string; handicap_index: number | null }) => {
    if (!game || !allowSetupChange({ type: "add_player" })) return;
    const t = refTee();
    const ch = (m.handicap_index != null && t.slope != null && t.rating != null && game.course_par != null)
      ? courseHandicap(m.handicap_index, t.slope, t.rating, game.course_par) : null;
    const { error } = await supabase.from("game_players").insert({
      game_id: game.id, user_id: m.id, is_guest: false, bets: true, display_name: m.display_name,
      handicap_index: m.handicap_index, rating: t.rating, slope: t.slope, tee_name: t.tee_name,
      course_handicap: ch, ...blankCard(),
    });
    if (error) { notifyError("Couldn't add that player — please try again."); return; }
    await load();
  };

  // Organizer: update a player's tee from the unified setup roster. This recalculates
  // course handicap from that player's handicap index using the selected tee rating/slope.
  const setPlayerTee = async (p: Player, teeName: string) => {
    if (!game || !allowSetupChange({ type: "set_tee", player: p, teeName })) return;
    const tee = courseTees.find((t) => t.name === teeName);
    if (!tee) return;
    const ch =
      p.handicap_index != null &&
      tee.rating != null &&
      tee.slope != null &&
      game.course_par != null
        ? courseHandicap(p.handicap_index, tee.slope, tee.rating, game.course_par)
        : null;
    await supabase
      .from("game_players")
      .update({
        rating: tee.rating,
        slope: tee.slope,
        tee_name: tee.name,
        course_handicap: ch,
      })
      .eq("id", p.id);
    await load();
  };

  // Organizer: mark/unmark a player as a no-show for formats that support it.
  // ──────────────────────────────────────────────────────────────────────────
  // DORMANT / DEFERRED FEATURE — "segmented match re-pair" (NOT built; revisit later)
  //
  // Scenario: a player leaves mid-match, stranding their opponent. Today we mark
  // the leaver "out" (below) — the holes they played still count, and in match
  // play the match simply stands on those holes. We deliberately do NOT yet
  // re-pair the stranded opponent against someone still on the course.
  //
  // The fuller design we discussed (left dormant on purpose — judged too complex
  // for the value, as it's a rare edge case):
  //   • No hard deletion — holes already played are real and stay on the card.
  //   • The leaver's match closes at the walk-off hole (e.g. B v A settles over
  //     holes 1–N where N is where A left).
  //   • The stranded opponent (B) may be re-paired with someone still playing (C);
  //     that new B v C match starts ALL SQUARE from the next hole (a reset at the
  //     switch) and is scored only over the remaining holes.
  //   • C can be in two matches at once (uses the existing multi-match support).
  //   • Fallback: if no one to re-pair with, B plays out solo — match voided,
  //     card kept. No blank-card substitution for the player who left.
  //   • Storage: a "switched at hole N" marker in the pairings JSON — no new
  //     column expected. Extends this no-show / left-mid-round flow.
  //
  // REMINDER (team): revisit this if mid-round departures in competitive matches
  // become common enough to warrant the complexity. Until then it stays dormant.
  // ──────────────────────────────────────────────────────────────────────────
  const toggleNoShow = async (p: Player) => {
    if (!game) return;
    const next = !p.no_show;
    if (!allowSetupChange({ type: "toggle_no_show", player: p, next })) return;
    await supabase.from("game_players").update({ no_show: next }).eq("id", p.id);
    await load();
  };

  const removePlayer = async (p: Player) => {
    if (!game || p.user_id === game.created_by || !allowSetupChange({ type: "remove_player", player: p })) return;
    const removedKey = pkey(p);
    const updates: Partial<Game> = {};
    const nextPairings = (game.pairings || []).filter((pr) => pr.a !== removedKey && pr.b !== removedKey);
    if (nextPairings.length !== (game.pairings || []).length) updates.pairings = nextPairings;
    if (Array.isArray(game.foursomes)) {
      updates.foursomes = game.foursomes.map((f) => ({
        ...f,
        a: (f.a || []).filter((uid) => uid !== removedKey),
        b: (f.b || []).filter((uid) => uid !== removedKey),
      }));
    }
    if (Object.keys(updates).length) await supabase.from("games").update(updates).eq("id", game.id);
    // Notify BEFORE removing the row, so the organizer<->player relationship the
    // create_notification check relies on still exists at insert time.
    if (p.user_id && p.user_id !== user.id) {
      try {
        await supabase.rpc("create_notification", {
          p_recipient: p.user_id,
          p_message: `You were removed from the game "${game.name}" by the organizer.`,
        });
      } catch {}
    }
    await supabase.from("game_players").delete().eq("id", p.id);
    await load();
  };

  // Organizer: rename the game.
  const renameGame = async (newName: string) => {
    if (!game || !newName.trim() || !allowSetupChange({ type: "rename_game" })) return;
    await supabase
      .from("games")
      .update({ name: newName.trim() })
      .eq("id", game.id);
    await load();
  };

  // Organizer corrects a whole game's date; all players' rounds move together (server RPC).
  const changeGameCourse = async (course: Course) => {
    if (!game || !course?.name || !Array.isArray(course.holes) || !course.holes.length) return;
    if (!allowSetupChange({ type: "change_course" })) return;
    const par = course.holes.reduce((sum, h) => sum + Number(h.par || 0), 0);
    const holesMeta = course.holes.map((h) => ({ n: h.n, par: h.par, si: h.si ?? null }));
    const ok = confirm(`Change this game's course to "${courseLabel(course)}"?\n\nPlayer tee selections will be cleared because tees, ratings and slopes belong to the previous course. No scores have been entered, so no played golf will be changed.`);
    if (!ok) return;
    const { error } = await supabase.rpc("change_game_course_before_scoring", {
      p_game: game.id, p_course: course.name, p_course_par: par, p_holes_meta: holesMeta,
    });
    if (error) { alert("Couldn't change the course: " + error.message); return; }
    clearAllGameScores(game.id);
    setCourseTees(Array.isArray(course.tees) ? course.tees : []);
    await load();
    setSetupTab("players");
  };

  const setGameDate = async (newDate: string) => {
    if (!game || !newDate || !allowSetupChange({ type: "set_game_date" })) return;
    const today = todayLocalStr();
    if (newDate < today) {
      const days = Math.round((+new Date(today + "T00:00:00") - +new Date(newDate + "T00:00:00")) / 86400000);
      if (!confirm(`This game is dated ${newDate} — ${days} day${days === 1 ? "" : "s"} in the past. Move all players' rounds to that date?`)) return;
    }
    const { error } = await supabase.rpc("set_game_played_date", { p_game: game.id, p_date: newDate });
    if (error) { alert("Couldn't change the date: " + error.message); return; }
    await load();
  };

  // Organizer: change the handicap allowance on a live game. Views read
  // allowance_pct live, so standings/strokes recompute on the next load.
  const setAllowance = async (pct: number) => {
    if (!game) return;
    const v = Math.max(0, Math.min(100, Math.round(pct)));
    if ((game.allowance_pct ?? 100) === v || !allowSetupChange({ type: "set_allowance", pct: v })) return;
    await supabase.from("games").update({ allowance_pct: v }).eq("id", game.id);
    await load();
  };

  // Organizer: change the format on a live game. Only safe transitions are
  // offered in the UI (see formatGroup); pairings/foursomes/teams are kept in
  // place so a switch is reversible. Allowance auto-suggests the new format's
  // common-practice number but the organizer can override after.
  const anyScores = players.some((p) => (p.scores || []).some((s) => s != null));
  const changeTrifectaScoring = async (next: "per_hole" | "match") => {
    if (!game || (game.trifecta_scoring ?? "per_hole") === next || !allowSetupChange({ type: "set_trifecta_scoring", mode: next })) return;
    await supabase.from("games").update({ trifecta_scoring: next }).eq("id", game.id);
    await load();
  };
  const setFormat = async (next: "stableford" | "stroke" | "match" | "fourball" | "skins" | "trifecta") => {
    if (!game || next === game.game_type || !allowSetupChange({ type: "set_format", target: next })) return;
    const patch = buildFormatPatch(game, next);
    // NOTE: we deliberately do NOT clear pairings/foursomes/teams when switching
    // format. A player's setup work is preserved so switching back restores it;
    // formats that don't use a given structure simply ignore it (see the
    // game_type guards in StrokesSummary and the setup tab steps).
    const { error } = await supabase.from("games").update(patch).eq("id", game.id);
    if (error) { alert("Couldn't change the format — " + error.message); return; }
    await load();
  };

  const setTeamScoreMode = async (mode: "best_ball" | "aggregate") => {
    if (!game || (game.team_score_mode ?? "best_ball") === mode || !allowSetupChange({ type: "set_team_score_mode", mode })) return;
    const { error } = await supabase.from("games").update({ team_score_mode: mode }).eq("id", game.id);
    if (error) { alert("Couldn't change the team scoring — " + error.message); return; }
    await load();
  };

  const setLegConfig = async (cfg: LegConfig) => {
    if (!game || !allowSetupChange({ type: "set_leg_config" })) return;
    const { error } = await supabase.from("games").update({ leg_config: cfg }).eq("id", game.id);
    if (error) { alert("Couldn't save the leg settings — " + error.message); return; }
    await load();
  };
  const updateSkinsMode = async (mode: "carryover" | "split") => {
    if (!game || (game.skins_mode ?? "carryover") === mode || !allowSetupChange({ type: "set_skins_mode", mode })) return;
    const { error } = await supabase.from("games").update({ skins_mode: mode }).eq("id", game.id);
    if (error) { alert("Couldn't change the tie handling — " + error.message); return; }
    await load();
  };
  // Convert a skins game between individual / 1:1 team / 2v2 best-ball mid-round.
  // Scores are never touched — only the team structure changes, and the skins
  // recompute. Team styles leave the side assignment to the Matchups step.
  const setSkinsStyle = async (style: "individual" | "team_11" | "team_2v2") => {
    if (!game || (shapeOf(game).skinsStyle ?? "individual") === style || !allowSetupChange({ type: "set_skins_style", style })) return;
    const { patch, flippedSplit } = buildSkinsStylePatch(
      game,
      players.filter((p) => !p.no_show).length,
      style,
    );
    const { error } = await supabase.from("games").update(patch).eq("id", game.id);
    if (error) { alert("Couldn't change the skins style — " + error.message); return; }
    await load();
    if (flippedSplit) alert("Halved (split) skins is best for up to 4 players — with a bigger field, individual skins is set to carry over instead.");
  };
  // Singles match <-> team match (e.g. 4 v 4). Only flips the team structure;
  // pairings are assigned in Matchups. Scores untouched.
  const setMatchTeam = async (on: boolean) => {
    if (!game || shapeOf(game).usesTeams === on || !allowSetupChange({ type: "set_match_team", on })) return;
    const patch = buildMatchTeamPatch(game, on);
    const { error } = await supabase.from("games").update(patch).eq("id", game.id);
    if (error) { alert("Couldn't change the match type — " + error.message); return; }
    await load();
  };

  // Organizer: end the game — freezes scores and shows final results.
  const endGame = async () => {
    if (!game) return;
    if (!requireOnline("You're offline. Finishing needs a connection — do it back at the clubhouse. Keep playing; scores are saved on this phone.")) return;
    // Drain offline holes before ending, so every player's recorded round is complete.
    await drainOutbox();
    const left = countPending();
    if (left > 0) { recomputePending(); alert(left + (left === 1 ? " hole hasn't" : " holes haven't") + " uploaded yet. Tap \"Sync now\", wait until it reaches 0, then end the game so every recorded round is complete."); return; }
    // One database transaction: end the game, post every player's round, and freeze running clocks.
    // If round posting fails, the game remains active rather than entering a split-brain "ended but not posted" state.
    const { error: finErr } = await supabase.rpc("finish_game_and_post_rounds", { p_game: game.id });
    if (finErr) { alert("Couldn't end the game — " + finErr.message); return; }
    await logActivity(supabase, { actor_id: user.id, actor_name: displayName, action: "game_ended", group_id: (game as any).group_id || null, summary: `Ended the game "${game.name}"` });
    await load();
  };

  // Pre-conclusion completeness: list what's missing for the players being locked.
  const finishListFmt = (a: number[]) => FG.finishListFmt(a);
  const computeFinishGaps = (scope: Player[]): FinishGap[] => FG.computeFinishGaps(scope, game?.holes_meta || []);
  const requestEndGame = async () => {
    if (!game) return;
    setFinishPrompt({ kind: "game", gaps: computeFinishGaps(players) });
  };
  const requestFinishGroup = async () => {
    if (!game || myRow?.tee_group == null) return;
    const scope = players.filter((pl) => pl.tee_group === myRow.tee_group);
    setFinishPrompt({ kind: "group", teeGroup: myRow.tee_group ?? undefined, gaps: computeFinishGaps(scope) });
  };


  // Organizer: reopen an ended game if it was ended by mistake.
  const reopenGame = async () => {
    if (!game) return;
    await supabase.from("games").update({ status: "active" }).eq("id", game.id);
    await load();
  };

  // Organizer: turn the public live-scorecard link on (mint a token) or off
  // (revoke it). Goes through an organizer-gated SECURITY DEFINER function so the
  // games table itself stays private.
  const setShare = async (on: boolean) => {
    if (!game || !allowSetupChange({ type: "share_live" })) return;
    const { data, error } = await supabase.rpc("set_game_share", { p_game: game.id, p_on: on });
    if (!error) setGame({ ...game, share_token: (data as string | null) ?? null });
  };

  // Organizer: wipe all entered scores and the round clock so the game is fresh
  // again — useful after entering dummy scores to test the setup. Keeps the
  // field, teams, and matchups; reopens the game if it had been ended. Does NOT
  // touch any rounds already posted to players' history (if the game was ended
  // and scores recorded, remove those from each player's Rounds tab separately).
  const resetScores = async () => {
    if (!game) return;
    // Suppress the background flush BEFORE confirm() — in a standalone PWA the
    // confirm dialog can fire visibilitychange/blur, which would otherwise flush
    // the old scores right back over the reset.
    resettingRef.current = true;
    const ok = confirm(`Reset "${game.name}"? This clears every player's scores, putts, fairways, penalties/sand and the round clock, and reopens the game if it was ended. Players, teams, and matchups are kept. Use this to wipe test scores.`);
    if (!ok) { resettingRef.current = false; return; }
    const n = game.holes_meta?.length ?? 18;
    const blank = {
      scores: Array(n).fill(null),
      putts: Array(n).fill(null),
      fairways: Array(n).fill(null),
      penalties: Array(n).fill(null),
      sand: Array(n).fill(null),
      clock_start: null,
      clock_end: null,
      group_locked: false,
      no_show: false,
    };
    // Optimistically clear local state so meRef goes blank immediately (so even a
    // stray flush would only ever write blanks) and the UI updates without a wait.
    setPlayers((ps) => ps.map((p) => ({ ...p, ...blank })));
    setMe((m) => (m ? { ...m, ...blank } : m));
    // Clear EVERY local score backup for this game on this device — including any
    // rows a marker backed up for other players — so a pre-game test wipe leaves
    // nothing to resurface. (Only this device; other devices keep theirs, which
    // protects any real scores they hold.)
    clearAllGameScores(game.id);
    try {
      // Server-side reset: a SECURITY DEFINER RPC clears EVERY player's scores,
      // putts, fairways, penalties/sand and round clock in one statement. The old
      // client loop could only clear rows the organizer had RLS rights to, so
      // other foursomes kept their scores. The RPC also stamps scores_reset_at so
      // every other device drops its pre-reset local backups on next load.
      const { error } = await supabase.rpc("reset_game_scores", { p_game: game.id });
      if (error) throw error;
      await logActivity(supabase, { actor_id: user.id, actor_name: displayName, action: "game_reset", group_id: (game as any).group_id || null, summary: `Reset scores for "${game.name}"` });
    } catch (e) {
      alert("Couldn't reset the game — make sure you're the organizer. If this keeps happening, the reset_game_scores database function may not be installed yet.");
    } finally {
      resettingRef.current = false;
      // Re-sync to DB truth whether the reset succeeded OR failed — the UI was
      // optimistically blanked before the RPC, so on failure this restores the
      // real (un-wiped) scores rather than leaving a misleading empty card.
      await load();
    }
  };

  // Organizer: delete the entire game and all its player rows.
  const deleteGame = async () => {
    if (!game) return;
    const created = game.created_at ? new Date(game.created_at) : null;
    const now = new Date();
    const sameDay = !!created
      && created.getFullYear() === now.getFullYear()
      && created.getMonth() === now.getMonth()
      && created.getDate() === now.getDate();
    const msg = sameDay
      ? `Delete "${game.name}"? It was created today, so any scorecards already posted to players' Rounds tabs will ALSO be deleted. This can't be undone.`
      : `Delete "${game.name}"? It's removed for everyone, but each player's posted round stays in their own Rounds history. This can't be undone.`;
    if (!confirm(msg)) return;
    await supabase.rpc("delete_game", { p_game: game.id, p_delete_rounds: sameDay });
    await logActivity(supabase, { actor_id: user.id, actor_name: displayName, action: "game_deleted", group_id: (game as any).group_id || null, summary: `Deleted the game "${game.name}"${sameDay ? " (and its posted rounds)" : ""}` });
    // Coherent local wipe so a deleted game leaves no snapshot, backups, watermarks,
    // or active-game pointer that could resurface or boot straight back into it.
    clearAllGameScores(game.id);
    clearActiveGame();
    onBack();
  };

  if (loading)
    return <div style={{ color: C.sage, padding: 20 }}>Loading game…</div>;
  if (!game)
    return (
      <div style={{ color: C.sage, padding: 20 }}>
        Game not found.{" "}
        <button style={btn(false)} onClick={onBack}>
          Back
        </button>
      </div>
    );

  // ---- Master-admin game repair (is_admin only; works on any game) ----
  const adminLog = async (summary: string) =>
    logActivity(supabase, { actor_id: user.id, actor_name: displayName, action: "admin_game_repair", group_id: (game as any)?.group_id || null, summary });
  const adminEndGame = async () => {
    if (!game || !confirm(`Force-end "${game.name}" as admin?`)) return;
    const { error } = await supabase.rpc("admin_end_game", { p_game: game.id });
    if (error) { alert("Couldn't end — " + error.message); return; }
    await adminLog(`Admin force-ended game "${game.name}"`); await load();
  };
  const adminReopenGame = async () => {
    if (!game || !confirm(`Reopen "${game.name}" as admin?`)) return;
    const { error } = await supabase.rpc("admin_reopen_game", { p_game: game.id });
    if (error) { alert("Couldn't reopen — " + error.message); return; }
    await adminLog(`Admin reopened game "${game.name}"`); await load();
  };
  const adminResetGame = async () => {
    if (!game || !confirm(`Reset ALL scores in "${game.name}" as admin? This can't be undone.`)) return;
    const { error } = await supabase.rpc("admin_reset_game", { p_game: game.id });
    if (error) { alert("Couldn't reset — " + error.message); return; }
    await adminLog(`Admin reset scores in game "${game.name}"`); await load();
  };
  const adminDeleteGame = async () => {
    if (!game || !confirm(`Delete "${game.name}" as admin? Rounds already posted to players' history are kept. This can't be undone.`)) return;
    const { error } = await supabase.rpc("admin_delete_game", { p_game: game.id });
    if (error) { alert("Couldn't delete — " + error.message); return; }
    await adminLog(`Admin deleted game "${game.name}"`); onBack();
  };
  const adminReassignOrganizer = async () => {
    if (!game || !reassignTo) return;
    const who = players.find((p) => p.user_id === reassignTo);
    if (!confirm(`Make ${who?.display_name || "this player"} the organizer of "${game.name}"?`)) return;
    const { error } = await supabase.rpc("admin_reassign_organizer", { p_game: game.id, p_user: reassignTo });
    if (error) { alert("Couldn't reassign — " + error.message); return; }
    await adminLog(`Admin made ${who?.display_name || "a player"} organizer of "${game.name}"`);
    setReassignTo(""); await load();
  };

  const isOrganizer = game.created_by === user.id;
  const isEnded = game.status === "ended";
  // What still needs setting for this game to score cleanly. Informational only —
  // scoring is never blocked. A missing handicap just means that player plays off scratch (0).
  const setupMissing: string[] = (() => {
    if (isEnded) return [];
    const total = players.length;
    if (total === 0) return [];
    const gt = game.game_type;
    const out: string[] = [];
    const noHcp = players.filter((p) => p.course_handicap == null).length;
    if (noHcp > 0) out.push(`${noHcp} player${noHcp > 1 ? "s" : ""} without a handicap — scored off scratch (0) until you set it in the Players tab`);
    const { usesTeams, usesMatchups } = shapeOf(game);
    if (usesTeams) { const n = players.filter((p) => !p.team).length; if (n > 0) out.push(`${n} player${n > 1 ? "s" : ""} not assigned to a team`); }
    if (usesMatchups) {
      const pairings = Array.isArray(game.pairings) ? game.pairings : [];
      const foursomes = Array.isArray(game.foursomes) ? game.foursomes : [];
      const placedKeys = new Set<string>([...pairings.flatMap((pr) => [pr.a, pr.b]), ...foursomes.flatMap((f) => [...f.a, ...f.b])]);
      const n = players.filter((p) => !placedKeys.has(pkey(p))).length;
      if (n > 0) out.push(`${n} player${n > 1 ? "s" : ""} not yet in a matchup or foursome`);
    }
    return out;
  })();
  // Rank by over/under (net Stableford vs par pace): most under (lowest 2*thru-pts)
  // leads, so a hot start can top a longer-but-flatter round. Not-yet-started
  // players sort to the bottom; ties broken by more points.
  const ouVal = (p: Player) => PS.ouVal(p, game);
  const isStroke = game.game_type === "stroke";
  const strokeNet = game.stroke_basis !== "gross"; // default to net
  const strokeTot = (p: Player) => PS.strokeTotal(p, game);
  const rankVal = (p: Player) => PS.rankVal(p, game);
  const leaderboard = PS.sortLeaderboard(players, game);
  // Flights: one-off handicap-band divisions (stroke/Stableford only). When active, the
  // standings can be viewed segmented by band (each with its own winner) or as one list.
  const flightDefs: { key: string; name: string; hi: number | null }[] = Array.isArray((game as any).flights) ? ((game as any).flights as any[]) : [];
  const hasFlights = (game as any).flight_mode === "oneoff" && flightDefs.length > 0 && (isStroke || game.game_type === "stableford");
  const posWithin = (p: Player, pool: Player[]) => PS.posWithin(p, pool, game);
  const tiedWithin = (p: Player, pool: Player[]) => PS.tiedWithin(p, pool, game);
  const renderLeaderRow = (p: Player, pos: number, tied: boolean, showTag: boolean) => (
    <LeaderRow key={p.id} p={p} pos={pos} tied={tied} showTag={showTag} showBetStatus={effectiveGroupId((game as any)?.group_id) === TGC_GROUP_ID}
      user={user} isStroke={isStroke} strokeNet={strokeNet}
      playerPoints={playerPoints} playerThru={playerThru} playerNet={playerNet}
      playerGross={playerGross} parThru={parThru} relToParStr={relToParStr} leaderName={leaderName} />
  );

  // Segment winners (three sixes). While a six is IN PROGRESS the "leader" is whoever is
  // most under par for the holes they've actually played (pace) — matching the main
  // leaderboard — so a shorter-but-deeper card can lead a longer-but-flatter one, and the
  // lead legitimately flip-flops as holes come in. Once every bettor has all six holes in,
  // everyone's on the same par pace, so this collapses to simply who won the six.
  // The card still DISPLAYS raw points/net · thru the leader's holes (over/under is easy to read off that).
  const segOf = (p: Player) => SEG.segOf(p, game);
  const segTotals = players.map((p) => ({ p, seg: segOf(p) }));
  const segLeadersFrom = (rows: { p: Player; seg: [number, number, number] }[]) => SEG.segLeadersFrom(rows, game);
  const segWinners = segLeadersFrom(segTotals);

  // Bettor-only segment leaders for the money banners (clean-sweep watch/achieved):
  // non-betting players (e.g. guests) still appear in the standings above, but the
  // sweep/segment money is decided among bettors only ("follow the money").
  const segTotalsBet = segTotals.filter(({ p }) => p.bets !== false);
  const segWinnersBet = segLeadersFrom(segTotalsBet);

  // Clean Sweep watch: one player won the first two sixes outright AND is leading the last
  // six alone with fewer than 4 holes left to play (i.e., 3-5 of holes 13-18 done).
  const sweepWatch = (() => {
    const [s0, s1, s2] = segWinnersBet;
    if (!s0.complete || !s1.complete) return null;
    if (s0.who.length !== 1 || s1.who.length !== 1) return null;
    const champ = s0.who[0];
    if (s1.who[0] !== champ) return null;
    if (!s2.started || s2.complete) return null;
    if (s2.maxPlayed < 3) return null;                 // fewer than 4 holes remaining
    if (s2.who.length !== 1 || s2.who[0] !== champ) return null; // leading the last six alone
    return { name: champ, val: s2.val ?? 0, thru: s2.thruHole, unit: isStroke ? "net" : "pts" };
  })();

  // Clean Sweep achieved: all three sixes are complete and won outright by the same player,
  // and that player is also the sole overall leader (18-hole total).
  const cleanSweepDone = (() => {
    const [s0, s1, s2] = segWinnersBet;
    if (![s0, s1, s2].every((s) => s.complete && s.who.length === 1)) return null;
    const champ = s0.who[0];
    if (s1.who[0] !== champ || s2.who[0] !== champ) return null;
    const totals = segTotalsBet.map(({ p, seg }) => ({ name: p.display_name, total: seg.reduce((a: number, b: number) => a + b, 0) }));
    const best = isStroke ? Math.min(...totals.map((t) => t.total)) : Math.max(...totals.map((t) => t.total));
    const leaders = totals.filter((t) => t.total === best);
    if (leaders.length !== 1 || leaders[0].name !== champ) return null;
    return { name: champ };
  })();

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <button style={btn(false)} onClick={onBack}>
          ‹ Games
        </button>
        <div>
          <div
            style={{
              color: C.cream,
              fontFamily: "Georgia, serif",
              fontSize: 22,
              fontWeight: 700,
            }}
          >
            {game.name}
          </div>
          <div style={{ color: C.sage, fontSize: 13 }}>{game.course}</div>
        </div>
        <div style={{ flex: 1 }} />
        {roomTab === "setup" && (
        <button
          onClick={() => {
            const shareText = `Join my golf game "${game.name}" on Birdie Num Num — enter code ${game.code}.`;
            if (typeof navigator !== "undefined" && (navigator as any).share) {
              (navigator as any).share({ title: "Birdie Num Num", text: shareText }).catch(() => {});
            } else {
              navigator.clipboard
                ?.writeText(game.code)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
                .catch(() => {});
            }
          }}
          title="Share or copy the join code"
          style={{
            background: C.greenLight,
            border: "none",
            borderRadius: 10,
            padding: "8px 14px",
            textAlign: "center",
            cursor: "pointer",
          }}
        >
          <div style={{ color: C.sage, fontSize: 11, letterSpacing: 2 }}>
            {copied ? "COPIED ✓" : "SHARE CODE · TAP TO SHARE"}
          </div>
          <div
            style={{
              color: C.gold,
              fontWeight: 800,
              fontSize: 20,
              letterSpacing: 3,
            }}
          >
            {game.code}
          </div>
        </button>
        )}
      </div>

      {/* Sub-tabs: Scorecard (play) vs Setup (organizer/teams/matchups) */}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button onClick={() => setRoomTab("play")}
          style={{ ...btn(roomTab === "play"), flex: 1, fontSize: 14 }}>
          ⛳ Scorecard
        </button>
        {isOrganizer && (
          <button onClick={() => { setSetupTab("overview"); setRoomTab("setup"); }}
            style={{ ...btn(roomTab === "setup"), flex: 1, fontSize: 14 }}>
            ⚙ Manage game
          </button>
        )}
      </div>
      {isOrganizer && orgWide && (
        <a href={`/organize/${game.id}`} style={{ display: "block", marginTop: 10, textAlign: "center", color: C.gold, fontSize: 13, fontWeight: 700, textDecoration: "none", border: `1px solid ${C.gold}`, borderRadius: 9, padding: "9px 0" }}>
          Set up flights &amp; matchups in the desktop organizer →
        </a>
      )}

      {roomTab === "play" && cleanSweepDone && effectiveGroupId((game as any)?.group_id) === TGC_GROUP_ID && (game.game_type === "stableford" || game.game_type === "stroke") && (
        <SweepAchievedBanner name={cleanSweepDone.name} />
      )}
      {roomTab === "play" && !cleanSweepDone && sweepWatch && effectiveGroupId((game as any)?.group_id) === TGC_GROUP_ID && (game.game_type === "stableford" || game.game_type === "stroke") && (
        <CleanSweepBanner name={sweepWatch.name} val={sweepWatch.val} thru={sweepWatch.thru} unit={sweepWatch.unit} />
      )}

      {isAdmin && !isOrganizer && (
        <div style={{ background: C.greenMid, border: `1px solid ${C.gold}`, borderRadius: 12, padding: 12, marginTop: 12 }}>
          <div style={{ color: C.gold, fontWeight: 800, fontSize: 13, marginBottom: 8 }}>⚠ Admin repair · you are not the organizer</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {game.status === "ended"
              ? <button onClick={adminReopenGame} style={{ background: "transparent", color: C.cream, border: `1px solid ${C.sage}`, borderRadius: 8, fontSize: 12, fontWeight: 700, padding: "6px 12px", cursor: "pointer" }}>Reopen</button>
              : <button onClick={adminEndGame} style={{ background: "transparent", color: C.cream, border: `1px solid ${C.sage}`, borderRadius: 8, fontSize: 12, fontWeight: 700, padding: "6px 12px", cursor: "pointer" }}>Force end</button>}
            <button onClick={adminResetGame} style={{ background: "transparent", color: C.cream, border: `1px solid ${C.sage}`, borderRadius: 8, fontSize: 12, fontWeight: 700, padding: "6px 12px", cursor: "pointer" }}>Reset scores</button>
            <button onClick={adminDeleteGame} style={{ background: "transparent", color: C.birdie, border: `1px solid ${C.birdie}`, borderRadius: 8, fontSize: 12, fontWeight: 700, padding: "6px 12px", cursor: "pointer" }}>Delete game</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: C.sage, fontSize: 12 }}>Reassign organizer:</span>
            <select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}
              style={{ background: C.card, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12, padding: "5px 8px" }}>
              <option value="">Select player…</option>
              {players.filter((p) => p.user_id).map((p) => (
                <option key={p.user_id} value={p.user_id as string}>{p.display_name}</option>
              ))}
            </select>
            <button disabled={!reassignTo} onClick={adminReassignOrganizer}
              style={{ background: C.gold, color: C.green, border: "none", borderRadius: 8, fontSize: 12, fontWeight: 800, padding: "6px 12px", cursor: "pointer", opacity: reassignTo ? 1 : 0.4 }}>Assign</button>
          </div>
        </div>
      )}

      {(syncState !== "idle" || pendingHoles > 0) && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 18, display: "flex", justifyContent: "center", zIndex: 60, padding: "0 12px", pointerEvents: "none" }}>
          <div style={{
            background: (syncState === "error" || pendingHoles > 0) ? "#3A2A12" : syncState === "synced" ? "#13412c" : "#15302a",
            color: C.cream,
            border: `1px solid ${(syncState === "error" || pendingHoles > 0) ? C.gold : syncState === "synced" ? "#1f8f54" : C.line}`,
            borderRadius: 999, padding: "8px 14px", fontSize: 12.5, fontWeight: 700,
            boxShadow: "0 8px 22px rgba(0,0,0,.35)", display: "flex", alignItems: "center", gap: 10, maxWidth: "100%", pointerEvents: "auto",
          }}>
            <span>
              {syncState === "saving" ? "Saving…"
                : syncState === "retry" ? "Couldn’t sync — trying again…"
                : pendingHoles > 0
                  ? (offline
                      ? `${pendingHoles} ${pendingHoles === 1 ? "hole" : "holes"} saved on this phone · will sync when you reconnect`
                      : `${pendingHoles} ${pendingHoles === 1 ? "hole" : "holes"} not synced yet`)
                  : syncState === "error" ? "Couldn’t sync — saved on this phone, will retry"
                  : "✓ Synced"}
            </span>
            {pendingHoles > 0 && !offline && (
              <button onClick={syncNow} disabled={syncing}
                style={{ background: C.gold, color: "#3B2A00", border: "none", borderRadius: 999, padding: "5px 12px", fontSize: 12, fontWeight: 800, cursor: "pointer", opacity: syncing ? 0.6 : 1, whiteSpace: "nowrap" }}>
                {syncing ? "Syncing…" : "Sync now"}
              </button>
            )}
          </div>
        </div>
      )}

      {roomTab === "play" && betStale && (
        <div style={{ background: "#5a3a10", border: `1px solid ${C.gold}`, borderRadius: 14, padding: 14, marginTop: 16 }}>
          <div style={{ color: "#f6d98a", fontWeight: 800, fontSize: 14 }}>⚠️ Posted bet winnings are out of date</div>
          <div style={{ color: C.cream, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
            A score changed since the winnings were posted to Money. {isOrganizer ? "Open the betting section below and tap “Review & re-post” to correct the amounts — recorded payments stay in place." : "The organizer needs to re-post to correct the amounts."}
          </div>
        </div>
      )}

      {roomTab === "play" && isOrganizer && setupMissing.length > 0 && !isEnded && (
        <div style={{ background: "#16302A", border: `1px solid ${C.gold}`, borderRadius: 14, padding: 16, marginTop: 16 }}>
          <Eyebrow>A FEW THINGS AREN'T SET</Eyebrow>
          <div style={{ color: C.cream, fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>
            You can start scoring right away — this is just a heads-up:
          </div>
          <ul style={{ color: C.sage, fontSize: 12.5, margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.5 }}>
            {setupMissing.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
          <button style={{ ...btn(true), marginTop: 12 }} onClick={() => { setSetupTab("overview"); setRoomTab("setup"); }}>Open setup</button>
        </div>
      )}

      {roomTab === "play" && needsSetup && me && (
        <div
          style={{
            background: C.greenLight,
            borderRadius: 14,
            padding: 16,
            marginTop: 16,
          }}
        >
          <Eyebrow>SET YOUR HANDICAP</Eyebrow>
          <div style={{ color: C.sage, fontSize: 13, marginTop: 8 }}>
            Enter your handicap index so your net Stableford is scored
            correctly. You can still enter scores below without it — it only
            affects net scoring.
          </div>
          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 12,
              alignItems: "flex-end",
              flexWrap: "wrap",
            }}
          >
            <div>
              <label style={{ color: C.sage, fontSize: 12 }}>
                Handicap index
              </label>
              <input
                style={{ ...inputStyle, marginTop: 6, maxWidth: 140 }}
                inputMode="decimal"
                placeholder="14.2"
                value={idxStr}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "" || /^\d*\.?\d*$/.test(v)) setIdxStr(v);
                }}
              />
            </div>
            <button style={btn(true)} onClick={completeSetup}>
              Save
            </button>
            <button style={btn(false)} onClick={() => setNeedsSetup(false)}>
              Skip for now
            </button>
          </div>
        </div>
      )}

      {roomTab === "setup" && isOrganizer && (() => {
        const panelProps = {
          game, players, user,
          onOverride: overridePlayerHandicap, courseTees, onSetTee: setPlayerTee,
          onRemove: removePlayer, onToggleNoShow: toggleNoShow, onSetTeam: setPlayerTeam,
          onRename: renameGame, onDelete: deleteGame,
          onEnd: requestEndGame, onReopen: reopenGame, onReset: resetScores, onShare: setShare,
          eligibleMembers, onAddMember: addMemberToGame, onAddGuest: addGuestToGame,
          onSetAllowance: setAllowance, onSetFormat: setFormat, onSetTeamScoreMode: setTeamScoreMode, onSetSkinsMode: updateSkinsMode, onSetSkinsStyle: setSkinsStyle, onSetMatchTeam: setMatchTeam, anyScores,
        } satisfies OrganizerPanelProps;
        const workspaceProps = {
          game, players, setupTab, onSetupTabChange: setSetupTab, organizerPanelProps: panelProps, onSetGameDate: setGameDate, courseOptions, onChangeCourse: changeGameCourse,
          onSetTeeGroup: setPlayerTeeGroup, getTeeGroupPolicy: (p: Player, group: number | null) => { const d = setupDecision({ type: "set_tee_group", player: p, group }); return { blocked: d.decision === "block", reason: d.decision === "block" ? d.reason : undefined }; }, onRandomizeGroups: randomizeGroups, canRandomize, randomizeReason,
          randomizing, groupOverflow,
        } satisfies React.ComponentProps<typeof GameSetupWorkspace>;
        return <GameSetupWorkspace {...workspaceProps} />;
      })()}

      {roomTab === "play" && (
      <div style={{ marginTop: 16, background: isEnded ? "#3A3A3A" : game.game_type === "match" ? "#1E3A8A" : game.game_type === "fourball" || game.game_type === "trifecta" ? "#1E3A8A" : C.green, borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 800 }}>
          {game.game_type === "match" ? "⛳ Singles Match Play" : game.game_type === "fourball" ? (game.team_score_mode === "aggregate" ? "⛳ Four-Ball · Shootout" : "⛳ Four-Ball Match (Best Net)") : game.game_type === "trifecta" ? (game.team_score_mode === "aggregate" ? "⛳ Trifecta · Shootout" : "⛳ Trifecta") : game.game_type === "skins" ? "🪙 Skins (Net)" : game.game_type === "stroke" ? (game.stroke_basis === "gross" ? "⛳ Stroke Play (Gross)" : "⛳ Stroke Play (Net)") : "🏆 Stableford Tournament"}
        </span>
        {isEnded ? (
          <span style={{ fontSize: 12, fontWeight: 800, background: C.gold, color: "#1A1A1A", borderRadius: 20, padding: "3px 10px" }}>FINAL · GAME ENDED</span>
        ) : (
          <span style={{ color: C.cream, opacity: 0.8, fontSize: 12 }}>
            {game.game_type === "match" ? "1-on-1 pairings" : game.game_type === "fourball" ? (game.team_score_mode === "aggregate" ? "2 v 2 · aggregate net (both balls)" : "2 v 2 better-net-ball") : game.game_type === "trifecta" ? (game.trifecta_scoring === "match" ? "2 singles + a team match · 3 pts/foursome" : "2 singles + a team point · 3 pts/hole") : game.game_type === "skins" ? "net skins · carryovers" : game.game_type === "stroke" ? "lowest total wins" : "net Stableford leaderboard"}
          </span>
        )}
      </div>
      )}

      {roomTab === "setup" && setupTab === "format" && isOrganizer && !isEnded && (game.game_type === "match" || game.game_type === "fourball" || game.game_type === "trifecta") && (
        <LegConfigEditor game={game} onSave={setLegConfig} />
      )}

      {roomTab === "setup" && setupTab === "format" && isOrganizer && game.game_type === "trifecta" && !isEnded && (
        <div style={{ marginTop: 12, background: C.greenLight, borderRadius: 12, padding: 14 }}>
          <div style={{ color: C.sage, fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase" }}>Trifecta scoring</div>
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            {(["per_hole", "match"] as const).map((val) => {
              const on = (game.trifecta_scoring === "match" ? "match" : "per_hole") === val;
              return (
                <button key={val} onClick={() => changeTrifectaScoring(val)} style={{ flex: 1, border: `1px solid ${on ? C.gold : C.greenMid}`, background: on ? C.gold : "transparent", borderRadius: 10, padding: "9px 8px", cursor: "pointer", textAlign: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: on ? "#1c1606" : C.cream }}>{val === "match" ? "1 match = 1 pt" : "1 hole = 1 pt"}</div>
                  <div style={{ fontSize: 11, marginTop: 2, color: on ? "#3c3208" : C.sage }}>{val === "match" ? "Ryder Cup · 3 pts/foursome" : "Per-hole · 3 pts/hole"}</div>
                </button>
              );
            })}
          </div>
          <div style={{ color: C.sage, fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
            {game.trifecta_scoring === "match"
              ? "Each foursome's 2 singles + 1 team match are worth 1 point each over 18 (½ each if halved)."
              : "Every hole of all three matches scores — 3 points on every hole."}
          </div>
        </div>
      )}

      {roomTab === "play" && !cardView && (() => {
        const subset = (teeGroupsInUse && myRow?.tee_group != null)
          ? players.filter((p) => p.tee_group === myRow.tee_group)
          : players;
        const starts = subset.map((p) => p.clock_start).filter(Boolean) as string[];
        if (!starts.length) return null;
        const startMs = Math.min(...starts.map((s) => new Date(s).getTime()));
        const ends = subset.map((p) => p.clock_end).filter(Boolean) as string[];
        const allEnded = subset.length > 0 && ends.length === subset.length;
        const endMs = allEnded ? Math.max(...ends.map((s) => new Date(s).getTime())) : paceNow;
        const mins = Math.max(0, Math.round((endMs - startMs) / 60000));
        const label = teeGroupsInUse && myRow?.tee_group != null ? ` · Group ${myRow.tee_group}` : "";
        // Pace: target minutes/hole scales with the group's size (6 + 2*players,
        // so a 2-ball = 10, 3-ball = 12, 4-ball = 14). "Holes done" is the group's
        // leading edge — the most holes any player in the group has scored. We nudge
        // (amber) once the group is more than 10 minutes past the expected time.
        const groupSize = Math.max(1, subset.length);
        const targetPerHole = 6 + 2 * groupSize;
        const holesDone = Math.max(0, ...subset.map((p) => (p.scores || []).filter((s) => s != null && (s as number) > 0).length));
        const expected = holesDone * targetPerHole;
        const behind = mins - expected;
        const showPace = !allEnded && holesDone >= 1;
        const onPace = behind <= 10;
        return (
          <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15 }}>⏱</span>
            <span style={{ color: C.cream, fontWeight: 700, fontFamily: "Georgia, serif", fontSize: 17 }}>{Math.floor(mins / 60)}:{String(mins % 60).padStart(2, "0")}</span>
            <span style={{ color: C.sage, fontSize: 12 }}>{allEnded ? "round time" : "elapsed"}{label}{holesDone >= 1 ? ` · thru ${holesDone}` : ""}</span>
            {showPace && (
              <>
                <span style={{ flex: 1 }} />
                {onPace ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(91,208,138,0.15)", color: "#7FD0A0", border: "1px solid rgba(91,208,138,0.4)", borderRadius: 999, padding: "3px 10px", fontSize: 11, fontWeight: 700 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: "#5BD08A", display: "block" }} />On pace
                  </span>
                ) : (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(216,178,74,0.16)", color: "#E4CF86", border: `1px solid rgba(216,178,74,0.5)`, borderRadius: 999, padding: "3px 10px", fontSize: 11, fontWeight: 700 }}>
                    ⚑ ~{behind} min behind
                  </span>
                )}
              </>
            )}
          </div>
          {showPace && !onPace && (
            <div style={{ color: "#C9A66A", fontSize: 11, marginTop: 6 }}>
              Keep it moving — you're behind the group's pace (about {targetPerHole} min a hole for {groupSize} player{groupSize === 1 ? "" : "s"}).
            </div>
          )}
          </>
        );
      })()}

      {((roomTab === "play") || (roomTab === "setup" && setupTab === "matchups")) && (
        <StrokesSummary game={game} players={players} collapsible={roomTab === "play"} meKey={myRow ? pkey(myRow) : undefined} />
      )}

      {roomTab === "play" && (
        <ContestsSection
          gameId={game.id}
          holesMeta={(game.holes_meta || []).map((h: any) => ({ n: h.n, par: h.par }))}
          players={players}
          userId={user.id}
          myName={myRow?.display_name || "Me"}
          isOrganizer={isOrganizer}
          isEnded={isEnded}
        />
      )}

      {roomTab === "play" && (game.game_type === "match" || game.game_type === "fourball" || game.game_type === "trifecta") && (
        <GroupSegmentSummary game={game} players={players} />
      )}

      {finishPrompt && (() => {
        const fp = finishPrompt;
        const lockMsg = fp.kind === "group"
          ? "Your group's scores lock and post to each player's Rounds tab; the rest of the game keeps going."
          : "Final standings lock in and every player's scorecard posts to their Rounds tab.";
        const complete = fp.gaps.length === 0;
        return (
          <div onClick={() => setFinishPrompt(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18, zIndex: 1000 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, color: C.ink, borderRadius: 16, padding: 20, maxWidth: 460, width: "100%", maxHeight: "calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 32px)", overflowY: "auto" }}>
              <div style={{ fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 800, color: C.green }}>
                {fp.kind === "group" ? `Finish Group ${fp.teeGroup}'s round?` : "End the game for everyone?"}
              </div>
              {complete ? (
                <div style={{ color: C.faint, fontSize: 14, marginTop: 10, lineHeight: 1.5 }}>Everything's entered. {lockMsg}</div>
              ) : (
                <>
                  <div style={{ color: C.ink, fontSize: 14, marginTop: 10, lineHeight: 1.5 }}>Some things aren't filled in yet:</div>
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                    {fp.gaps.map((g) => (
                      <div key={g.name} style={{ background: "#F4F0E1", borderRadius: 10, padding: "9px 12px", fontSize: 13, lineHeight: 1.45 }}>
                        <b>{g.name}</b>{" \u2014 "}
                        {g.noScores ? <span style={{ color: C.birdie }}>no scores entered</span> : (
                          <span style={{ color: C.faint }}>
                            {[
                              g.missScores.length ? `scores on ${finishListFmt(g.missScores)}` : null,
                              g.missPutts.length ? `putts on ${finishListFmt(g.missPutts)}` : null,
                              g.missFw.length ? `fairways on ${finishListFmt(g.missFw)}` : null,
                            ].filter(Boolean).join(" \u00b7 ")}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div style={{ color: C.faint, fontSize: 12.5, marginTop: 12, lineHeight: 1.5 }}>{lockMsg} You can finish anyway — missing scores just won't count.</div>
                </>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
                <button onClick={() => setFinishPrompt(null)} style={{ ...btn(false), padding: "9px 16px" }}>{complete ? "Cancel" : "Go back"}</button>
                <button onClick={async () => { const run = fp.kind === "group" ? finishMyGroup : endGame; setFinishPrompt(null); await run(); }} style={{ ...btn(true), padding: "9px 16px", background: "#5A1E1E", color: "#fff" }}>
                  {complete ? (fp.kind === "group" ? "Finish group" : "End game") : "Finish anyway"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {roomTab === "play" && !isEnded && (() => {
        const canFinishGroup = !!myRow?.is_marker && myRow?.tee_group != null && !myRow?.group_locked;
        if (!canFinishGroup && !isOrganizer) return null;
        return (
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            {canFinishGroup && (
              <button onClick={requestFinishGroup} style={{ ...btn(true), flex: 1, minWidth: 180, fontSize: 13, padding: "10px 0" }}>
                🏁 Finish Group {myRow!.tee_group}'s round
              </button>
            )}
            {isOrganizer && (
              <button onClick={requestEndGame} style={{ ...btn(!canFinishGroup), flex: 1, minWidth: 180, fontSize: 13, padding: "10px 0", ...(canFinishGroup ? { background: "#5A1E1E", color: "#fff" } : {}) }}>
                🔒 End game for everyone
              </button>
            )}
          </div>
        );
      })()}

      {roomTab === "play" && (
        <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
          <button onClick={() => setCardView(false)} style={{ ...btn(!cardView), flex: 1, fontSize: 13 }}>Results</button>
          <button onClick={() => setCardView(true)} style={{ ...btn(cardView), flex: 1, fontSize: 13 }}>Group Card</button>
        </div>
      )}
      {roomTab === "setup" && (isOrganizer || isAdmin) && <ScoreHistory gameId={gameId} />}
      {roomTab === "play" && cardView && (game.marker_user_id || myGroupHasMarker) && !isEnded && (
        <div style={{ background: "#16302A", border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", marginTop: 10 }}>
          <div style={{ color: C.cream, fontSize: 13, fontWeight: 700 }}>Group scoring is on</div>
          <div style={{ color: C.sage, fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>
            One person is keeping the whole group's card. Anyone can switch the group back to scoring their own cards.
          </div>
          {offline
            ? <div style={{ color: C.gold, fontSize: 11.5, marginTop: 10 }}>Offline — you can switch back to self-scoring once you reconnect.</div>
            : <button onClick={everyoneScoresOwn} style={{ ...btn(false), fontSize: 12, padding: "7px 12px", marginTop: 10 }}>Everyone scores their own</button>}
        </div>
      )}
      {roomTab === "play" && cardView ? (
        <>
          {teeGroupsInUse && teeGroupList.length > 1 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
              {teeGroupList.map((g) => {
                const grpPlayers = players.filter((p) => p.tee_group === g);
                const locked = gameEnded || grpPlayers.some((p) => p.group_locked);
                const hasMarker = grpPlayers.some((p) => p.is_marker);
                return (
                  <button key={g} onClick={() => setViewGroup(g)} style={{ ...btn(viewGroup === g), fontSize: 12, padding: "5px 12px" }}>
                    Group {g}{locked ? " 🔒" : hasMarker ? " ✓" : " · needs scorer"}
                  </button>
                );
              })}
            </div>
          )}
          {canClaimViewed && !viewedMarkerPlayer && (
            <div style={{ background: "#16302A", border: `1px solid ${C.gold}`, borderRadius: 12, padding: 14, marginTop: 12 }}>
              <div style={{ color: C.cream, fontSize: 15, fontWeight: 700, marginBottom: 6 }}>📋 Who's keeping {viewGroup != null ? `Group ${viewGroup}` : "this group"}'s card?</div>
              <div style={{ color: C.sage, fontSize: 12, lineHeight: 1.5, marginBottom: 12 }}>
                One person enters everyone's scores for the group — usually quicker than four phones, and everyone still sees it update live. Or skip it and each player scores their own.
              </div>
              {offline ? (
                <div style={{ color: C.gold, fontSize: 12 }}>Offline — pick a scorer once you’re back in range. For now, keep entering on whatever card you already have.</div>
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={claimGroupMarker} style={{ ...btn(true), flex: 1, minWidth: 130, fontSize: 13 }}>I'll keep score</button>
                  <button onClick={everyoneScoresOwn} style={{ ...btn(false), flex: 1, minWidth: 130, fontSize: 13 }}>We'll each score our own</button>
                </div>
              )}
            </div>
          )}
          <GroupScorecard game={game} players={cardPlayers} user={user} courseTees={courseTees}
            isMarker={cardCanEdit}
            markerName={viewedMarkerPlayer?.display_name ?? null}
            onTakeOver={takeOverScoring}
            onRelease={releaseScoring}
            onSetHole={setPlayerHole}
            teeMode={teeGroupsInUse}
            groupLabel={viewGroup != null ? `Group ${viewGroup}` : ""}
            groupLocked={viewedGroupLocked || gameEnded}
            canClaim={canClaimViewed}
            onClaimGroup={claimGroupMarker}
            onReleaseGroup={releaseGroupMarker}
            offline={offline}
            onMarkOut={toggleNoShow}
          />
        </>
      ) : (game.game_type === "fourball" || game.game_type === "trifecta") && (roomTab === "play" || (roomTab === "setup" && setupTab === "matchups")) ? (
        <FourballView
          game={game}
          players={players}
          user={user}
          isCreator={game.created_by === user.id}
          mode={roomTab}
          onChanged={load}
        />
      ) : game.game_type === "match" && (roomTab === "play" || (roomTab === "setup" && setupTab === "matchups")) ? (
        <MatchView
          game={game}
          players={players}
          user={user}
          isCreator={game.created_by === user.id}
          mode={roomTab}
          onChanged={load}
        />
      ) : game.game_type === "skins" && (roomTab === "play" || (roomTab === "setup" && setupTab === "matchups")) ? (
        <SkinsView game={game} players={players} user={user}
          isCreator={game.created_by === user.id} mode={roomTab} onChanged={load} />
      ) : roomTab === "play" ? (
        <>
          {/* Leaderboard */}
          <div style={{ marginTop: 18 }}>
            <Eyebrow>{isStroke ? `STROKE PLAY · ${strokeNet ? "NET" : "GROSS"}` : "LEADERBOARD · NET STABLEFORD"}</Eyebrow>
            {hasFlights ? (
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                {(["flight", "overall"] as const).map((v) => (
                  <button key={v} onClick={() => setFlightView(v)} style={{
                    flex: 1, padding: "7px 0", borderRadius: 9,
                    border: `1px solid ${flightView === v ? C.gold : "rgba(255,255,255,0.25)"}`,
                    background: flightView === v ? C.gold : "transparent",
                    color: flightView === v ? "#06251A" : C.cream, fontWeight: 800, fontSize: 12, cursor: "pointer",
                  }}>{v === "flight" ? "By flight" : "Overall"}</button>
                ))}
              </div>
            ) : null}
            {/* Column header */}
            <div style={{ display: "flex", alignItems: "center", padding: "9px 16px", marginTop: 4, color: C.cream, fontSize: 12, fontWeight: 800, letterSpacing: 0.3, background: C.greenMid, borderRadius: 10 }}>
              <div style={{ width: 20 }}>#</div>
              <div style={{ width: 40 }} />
              <div style={{ flex: 1 }}>Player</div>
              {isStroke ? (<>
                <div style={{ width: 40, textAlign: "center" }}>Thru</div>
                <div style={{ width: 48, textAlign: "center" }}>Gross</div>
                <div style={{ width: 48, textAlign: "center" }}>Par</div>
                <div style={{ width: 50, textAlign: "center" }}>Net</div>
              </>) : (<>
                <div style={{ width: 44, textAlign: "center" }}>Thru</div>
                <div style={{ width: 48, textAlign: "center" }}>Gross</div>
                <div style={{ width: 44, textAlign: "center" }}>O/U</div>
                <div style={{ width: 40, textAlign: "center" }}>Pts</div>
              </>)}
            </div>
            {hasFlights && flightView === "flight" ? (
              <>
                {flightDefs.map((b, bi) => {
                  const inFlight = leaderboard.filter((p) => (p as any).flight === b.key);
                  if (!inFlight.length) return null;
                  return (
                    <div key={b.key} style={{ marginTop: 12 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "8px 4px 0" }}>
                        <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, background: flightTagColor(b.key) }} />
                        <span style={{ fontFamily: "Georgia, serif", fontSize: 15, fontWeight: 700, color: C.cream }}>{b.name}</span>
                        <span style={{ color: C.sage, fontSize: 11 }}>index {flightRangeLabel(flightDefs, bi)} · {inFlight.length} player{inFlight.length === 1 ? "" : "s"}</span>
                      </div>
                      {inFlight.map((p) => renderLeaderRow(p, posWithin(p, inFlight), tiedWithin(p, inFlight), false))}
                    </div>
                  );
                })}
                {(() => {
                  const un = leaderboard.filter((p) => !(p as any).flight);
                  if (!un.length) return null;
                  return (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "8px 4px 0" }}>
                        <span style={{ fontFamily: "Georgia, serif", fontSize: 15, fontWeight: 700, color: C.cream }}>Unassigned</span>
                        <span style={{ color: C.sage, fontSize: 11 }}>no flight · {un.length}</span>
                      </div>
                      {un.map((p) => renderLeaderRow(p, posWithin(p, un), tiedWithin(p, un), false))}
                    </div>
                  );
                })()}
              </>
            ) : (
              leaderboard.map((p) => renderLeaderRow(p, posWithin(p, leaderboard), tiedWithin(p, leaderboard), hasFlights))
            )}
            <div style={{ color: C.sage, fontSize: 11, marginTop: 8 }}>
              {isStroke ? `Thru = holes played · Gross = total strokes · Par = ${strokeNet ? "net" : "gross"} vs par · Net = net total. Lowest ${strokeNet ? "net" : "gross"} wins.` : "Gross = total strokes · Thru = holes played · O/U = net Stableford vs par pace (under = green) · Pts = net Stableford points. Ranked by O/U."}
            </div>
          </div>

          {/* Three sixes */}
          <div style={{ marginTop: 18 }}>
            <Eyebrow>{isStroke ? "SIX-HOLE SEGMENTS (NET SCORE)" : "SIX-HOLE SEGMENTS (NET STABLEFORD)"}</Eyebrow>
            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                marginTop: 8,
              }}
            >
              {segWinners.map((s, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    minWidth: 150,
                    background: C.greenLight,
                    borderRadius: 12,
                    padding: 14,
                  }}
                >
                  <div style={{ color: C.sage, fontSize: 12 }}>{s.label}</div>
                  {!s.started ? (
                    <div style={{ color: C.sage, fontSize: 13, marginTop: 6 }}>
                      Not started
                    </div>
                  ) : s.complete ? (
                    <>
                      <div style={{ color: C.cream, fontWeight: 800, marginTop: 6 }}>
                        {s.who.join(", ")}
                      </div>
                      <div style={{ color: C.gold, fontSize: 13 }}>
                        {isStroke ? `${s.val} net` : `${s.val} pts`} {s.who.length > 1 ? "(tie)" : ""}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ color: C.cream, fontWeight: 800, marginTop: 6 }}>
                        {s.who.join(" & ")}
                        <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: C.green, background: C.sage, borderRadius: 5, padding: "1px 6px", verticalAlign: "middle" }}>
                          {s.who.length > 1 ? "tied" : "leading"}
                        </span>
                      </div>
                      <div style={{ color: C.gold, fontSize: 13 }}>
                        {isStroke ? `${s.val} net` : `${s.val} pts`} · thru hole {s.leaderThru}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
            <SegmentBoard
              isStroke={isStroke}
              rows={leaderboard.map((p) => {
                const s = segOf(p);
                return {
                  name: p.display_name,
                  thru: playerThru(p),
                  segs: s,
                  total: s.reduce((a: number, b: number) => a + b, 0),
                  isMe: p.user_id === user.id,
                };
              })}
            />
          </div>

          {effectiveGroupId((game as any)?.group_id) === TGC_GROUP_ID && (
            <BettingPanel
              players={players}
              playerPoints={playerPoints}
              playerHoles={playerHoles}
              ended={isEnded}
              game={game}
              user={user}
              canPost={game.created_by === user.id || !!isAdmin}
              onBetStale={setBetStale}
              onToggleBets={toggleBets}
            />
          )}
        </>
      ) : null}

      {/* My card. In group scoring EVERYONE sees their own card here; when someone else
          keeps my gross score it's shown view-only ("kept by X") while my putts / fairways
          / sand / penalties stay editable (they save through the stats chokepoint). The
          group scorer and self-scorers get a fully-editable card. */}
      {roomTab === "play" && me && (() => {
        const myScoreLocked = !isEnded && markerOwnsMyRowRef.current;
        const mk = myScoreLocked
          ? ((teeGroupsInUse && myRow?.tee_group != null)
              ? players.find((p) => p.tee_group === myRow.tee_group && p.is_marker)
              : players.find((p) => p.user_id === game.marker_user_id))
          : null;
        const mkName = mk?.display_name || "the scorer";
        return (
        <div style={{ marginTop: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Eyebrow>{isEnded ? "YOUR FINAL SCORES" : myScoreLocked ? "YOUR CARD" : "ENTER YOUR SCORES"}</Eyebrow>
            <div style={{ flex: 1 }} />
            {!isEnded && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: C.sage, fontSize: 11 }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: "#5BD08A", display: "inline-block" }} />
                Live
              </span>
            )}
            <button style={{ ...btn(false), fontSize: 12, padding: "6px 12px" }} onClick={load}>⟳ Refresh</button>
          </div>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 4 }}>
            {isEnded
              ? "This game has ended — scores are locked in."
              : myScoreLocked
                ? `${mkName} keeps the group's score, so your gross is view-only (🔒). Tap any hole to add your own putts, fairways, sand and penalties — they save instantly.`
                : "Tap a hole and pick your strokes — it saves instantly. Others' scores update automatically; ⟳ Refresh forces it."}
          </div>
          <ScoreEntryCard
            holes={(() => {
              // In match play, dots reflect the RELATIVE allowance (strokes given/received
              // vs. the opponent), not full course handicap. Stroke-play uses full allocation.
              let matchAllow: number | null = null;
              let oppAllow: number | null = null; // opponent's allowance — used to show holes I GIVE
              if (game.game_type === "match") {
                const pr = game.pairings.find((p) => p.a === myKey || p.b === myKey);
                if (pr) {
                  const oppId = pr.a === myKey ? pr.b : pr.a;
                  const oppP = players.find((p) => pkey(p) === oppId);
                  const allowPair = matchAllowance(chBasis(me, game.course_par), oppP ? chBasis(oppP, game.course_par) : null, game.allowance_pct ?? 100);
                  matchAllow = allowPair.a;
                  oppAllow = allowPair.b;
                }
              }
              const alloc = allocateStrokes(
                game.holes_meta.map((m) => ({
                  hole_number: m.n,
                  stroke_index: m.si,
                })),
                applyAllowance(chBasis(me, game.course_par), game.allowance_pct ?? 100),
              );
              return game.holes_meta.map((m, i) => ({
                n: m.n,
                par: m.par,
                si: m.si,
                yards: courseTees.find((t) => t.name === me.tee_name)?.yardages?.[i] ?? m.yards ?? null,
                strokes: me.scores?.[i] ?? null,
                putts: me.putts?.[i] ?? null,
                fairway: me.fairways?.[i] ?? null,
                penalties: me.penalties?.[i] ?? null,
                sand: me.sand?.[i] ?? null,
                recv: dotStrokes(game, me, m.si, players),
                // Individual (full playing handicap) strokes — the low-net / Stableford side game.
                indRecv: fullStrokes(game, me, m.si),
                // If I receive none but my opponent does, show the holes where I give a stroke.
                gives: game.game_type === "match" && (matchAllow ?? 0) === 0 && oppAllow != null
                  ? matchStrokesFor(oppAllow, m.si)
                  : 0,
              }));
            })()}
            hasHandicap={me.course_handicap != null}
            showIndivDots={shapeOf(game).dotBasis !== "absolute"}
            matchMode={game.game_type === "match"}
            uncap={game.game_type === "stroke"}
            showSixes={effectiveGroupId((game as any).group_id) === TGC_GROUP_ID}
            strokeSixes={game.game_type === "stroke"}
            scoreLocked={myScoreLocked}
            lockedByName={mkName}
            onSet={(i, patch) => { if (!isEnded) setMyHole(i, patch); }}
            savingHole={savingHole}
            showPenalties={true}
            opp={(() => {
              if (game.game_type !== "match") return undefined;
              const pr = game.pairings.find((p) => p.a === myKey || p.b === myKey);
              if (!pr) return undefined;
              const oppId = pr.a === myKey ? pr.b : pr.a;
              const oppP = players.find((p) => pkey(p) === oppId);
              return oppP?.scores || undefined;
            })()}
            oppLabel={(() => {
              if (game.game_type !== "match") return undefined;
              const pr = game.pairings.find((p) => p.a === myKey || p.b === myKey);
              if (!pr) return undefined;
              const oppId = pr.a === myKey ? pr.b : pr.a;
              const oppP = players.find((p) => pkey(p) === oppId);
              return oppP?.display_name?.split(" ")[0] || "Opp";
            })()}
            matchRun={(() => {
              if (game.game_type === "match") {
                const pr = game.pairings.find((p) => p.a === myKey || p.b === myKey);
                if (!pr) return undefined;
                const oppId = pr.a === myKey ? pr.b : pr.a;
                const oppP = players.find((p) => pkey(p) === oppId);
                if (!oppP) return undefined;
                // Compute from MY perspective: me = A.
                const prog = matchProgress(
                  game.holes_meta,
                  me.scores || [],
                  oppP.scores || [],
                  me.course_handicap,
                  oppP.course_handicap,
                  game.allowance_pct ?? 100,
                );
                return prog.map((lead) => matchLeadLabel(lead));
              }
              if (game.game_type === "fourball" && Array.isArray(game.foursomes)) {
                // Four-ball has no singles: the player's match IS the team best-ball,
                // from MY team's perspective.
                const f = game.foursomes.find((x: any) => (x.a || []).includes(myKey) || (x.b || []).includes(myKey));
                if (!f || !f.a?.length || !f.b?.length) return undefined;
                const onA = f.a.includes(myKey);
                const myIds = onA ? f.a : f.b;
                const oppIds = onA ? f.b : f.a;
                const members = [...f.a, ...f.b].map((uid: string) => {
                  const p = players.find((pp) => pkey(pp) === uid);
                  return { id: uid, gross: p?.scores || [], ch: p ? chBasis(p, game.course_par) : null, noShow: !!p?.no_show };
                });
                const prog = fourballProgress(game.holes_meta, members, myIds, oppIds, game.allowance_pct ?? 100, game.team_score_mode === "aggregate" ? "aggregate" : "best_ball");
                return prog.map((lead) => matchLeadLabel(lead));
              }
              if (game.game_type === "trifecta" && Array.isArray(game.foursomes)) {
                // Trifecta: the card tracks the player's OWN singles match vs their
                // direct opponent, using the same foursome group-low nets that
                // computeTrifecta (the Results page) uses — so the running number
                // matches exactly, instead of showing the team best-ball position.
                const f = game.foursomes.find((x: any) => (x.a || []).includes(myKey) || (x.b || []).includes(myKey));
                if (!f || !f.a?.length || !f.b?.length) return undefined;
                const members = [...f.a, ...f.b].map((uid: string) => {
                  const p = players.find((pp) => pkey(pp) === uid);
                  return { id: uid, gross: p?.scores || [], ch: p ? chBasis(p, game.course_par) : null, noShow: !!p?.no_show };
                });
                const res = computeTrifecta(game.holes_meta, members, f.a, f.b, game.allowance_pct ?? 100, game.team_score_mode === "aggregate" ? "aggregate" : "best_ball", !!(f as any).swap);
                const mine = res.contests.find((c) => c.kind === "single" && (c.aIds[0] === myKey || c.bIds[0] === myKey));
                if (!mine) return undefined;
                const iAmA = mine.aIds[0] === myKey;
                return mine.perHole.map((h) => {
                  if (h.aNet == null || h.bNet == null) return matchLeadLabel(null);
                  return matchLeadLabel(iAmA ? h.aRun - h.bRun : h.bRun - h.aRun);
                });
              }
              return undefined;
            })()}
          />
          <MyStatsLine me={me} holes={playerHoles(me)} />
        </div>
        );
      })()}
      {!me && (
        <div
          style={{
            background: C.greenLight,
            borderRadius: 12,
            padding: 18,
            marginTop: 18,
            color: C.sage,
          }}
        >
          You're viewing this game but haven't joined it as a player yet.
          Re-open it from the Games list with the share code to join and enter
          scores.
        </div>
      )}
      {roomTab === "play" && me && (me.scores || []).some((s: any) => s != null && s > 0) && (
        <button onClick={() => setShareCard(true)} style={{ ...btn(false), width: "100%", marginTop: 18, fontSize: 13, padding: "10px 0" }}>📤 Share my scorecard</button>
      )}
      {roomTab === "play" && players.some((p: any) => (p.scores || []).some((s: any) => s != null && s > 0)) && (
        <button onClick={() => setShareGame(true)} style={{ ...btn(false), width: "100%", marginTop: 10, fontSize: 13, padding: "10px 0" }}>📋 Share group card to chat</button>
      )}
      {shareCard && me && <ShareScorecardModal game={game} player={me} onClose={() => setShareCard(false)} />}
      {shareGame && <ShareGameModal game={game} players={players} courseTees={courseTees} onClose={() => setShareGame(false)} />}
    </div>
  );
}

function MyStatsLine({ me, holes }: { me: Player; holes: Hole[] }) {
  const withPutts = holes.filter((h) => h.putts != null);
  const fwHoles = holes.filter((h) => h.par >= 4 && h.fairway != null);
  const { totalPutts, girHit, fwHit, fwLeft, fwRight } = roundStats(holes);
  return (
    <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>
      Your round: {totalPutts} putts
      {withPutts.length
        ? ` (${(totalPutts / withPutts.length).toFixed(1)}/hole)`
        : ""}
      {" · "}GIR{" "}
      {withPutts.length
        ? `${girHit}/${withPutts.length} (${Math.round((100 * girHit) / withPutts.length)}%)`
        : "—"}
      {" · "}Fairways{" "}
      {fwHoles.length
        ? `${fwHit}/${fwHoles.length} (${Math.round((100 * fwHit) / fwHoles.length)}%)${fwLeft || fwRight ? ` · ${fwLeft}L ${fwRight}R` : ""}`
        : "—"}
    </div>
  );
}

// ---------------- Match play view ----------------
