"use client";
import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
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

const supabase = createClient();

export function GameList({
  displayName,
  activeGroupId,
  onOpen,
  onCreate,
}: {
  displayName: string;
  activeGroupId: string;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const [games, setGames] = useState<Game[] | null>(null);
  const [code, setCode] = useState("");
  const [joinErr, setJoinErr] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const load = useCallback(async () => {
    // Games I'm a player in (RLS lets me see games I've joined).
    const { data: mine } = await supabase
      .from("game_players")
      .select("game_id");
    const ids = (mine || []).map((m: any) => m.game_id);
    if (!ids.length) {
      setGames([]);
      return;
    }
    const { data } = await supabase
      .from("games")
      .select("*")
      .in("id", ids)
      .eq("group_id", activeGroupId)
      .order("created_at", { ascending: false });
    setGames(data || []);
  }, [activeGroupId]);
  useEffect(() => {
    load();
  }, [load]);

  const join = async () => {
    const c = code.trim();
    if (!c) return;
    setJoining(true);
    setJoinErr(null);
    try {
      const { data: game, error } = await supabase
        .from("games")
        .select("*")
        .eq("code", c)
        .eq("group_id", activeGroupId)
        .single();
      if (error || !game) throw new Error("No game found with that code.");
      const uid = (await supabase.auth.getUser()).data.user!.id;
      // Add me as a player if not already in.
      const { data: existing } = await supabase
        .from("game_players")
        .select("id")
        .eq("game_id", game.id)
        .eq("user_id", uid);
      if (!existing || !existing.length) {
        // Borrow course rating/slope/tee from the ORGANIZER's row — they set the
        // course and tee when creating the game, so their row always has these.
        // Fall back to any player with a rating if the organizer row is missing.
        const { data: orgRow } = await supabase
          .from("game_players")
          .select("rating,slope,tee_name")
          .eq("game_id", game.id)
          .eq("user_id", game.created_by)
          .limit(1);
        let ref: any = orgRow && orgRow[0] ? orgRow[0] : null;
        if (!ref || ref.rating == null) {
          const { data: others } = await supabase
            .from("game_players")
            .select("rating,slope,tee_name")
            .eq("game_id", game.id)
            .not("rating", "is", null)
            .limit(1);
          ref = others && others[0] ? others[0] : (ref || {});
        }
        const n = game.holes_meta.length;
        let myAvatar: string | null = null;
        try {
          const { data: meAv } = await supabase.from("profiles").select("avatar_url").eq("id", uid).single();
          myAvatar = (meAv as any)?.avatar_url || null;
        } catch {}
        const { error: e2 } = await supabase.from("game_players").insert({
          game_id: game.id,
          user_id: uid,
          is_guest: false,
          bets: true, // member default: in the money game
          ...GP_STATE_DEFAULTS,
          display_name: displayName,
          avatar_url: myAvatar,
          rating: (ref as any).rating ?? null,
          slope: (ref as any).slope ?? null,
          tee_name: (ref as any).tee_name ?? null,
          scores: Array(n).fill(null),
          putts: Array(n).fill(null),
          fairways: Array(n).fill(null),
        });
        if (e2) throw e2;
      }
      onOpen(game.id);
    } catch (e: any) {
      setJoinErr(e.message || "Couldn't join.");
    } finally {
      setJoining(false);
    }
  };

  return (
    <div>
      {/* Two clear paths: start a game (you organize) vs join one (someone shared a code). */}
      <Eyebrow>GAMES</Eyebrow>
      <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px", background: C.greenLight, borderRadius: 14, padding: 18, display: "flex", flexDirection: "column" }}>
          <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 700 }}>Start a game</div>
          <div style={{ color: C.sage, fontSize: 13, marginTop: 6, lineHeight: 1.5, flex: 1 }}>
            Set up a Stableford, singles match, or four-ball. You'll get a 6-digit code to share so others can join.
          </div>
          <button style={{ ...btn(true), marginTop: 12 }} onClick={onCreate}>＋ Start a game</button>
        </div>
        <div style={{ flex: "1 1 240px", background: C.greenLight, borderRadius: 14, padding: 18, display: "flex", flexDirection: "column" }}>
          <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 700 }}>Join with a code</div>
          <div style={{ color: C.sage, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
            Enter the 6-digit code a friend shared with you.
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <input
              style={{ ...inputStyle, letterSpacing: 3, fontWeight: 700 }}
              value={code}
              placeholder="123456"
              maxLength={6}
              inputMode="numeric"
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && join()}
            />
            <button
              style={{ ...btn(false), whiteSpace: "nowrap", opacity: code.trim() ? 1 : 0.5 }}
              disabled={!code.trim() || joining}
              onClick={join}
            >
              {joining ? "Joining…" : "Join"}
            </button>
          </div>
          {joinErr && (
            <div style={{ color: "#E8A199", fontSize: 13, marginTop: 8 }}>
              {joinErr}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", marginTop: 22 }}>
        <Eyebrow>YOUR GAMES</Eyebrow>
      </div>

      {games === null && (
        <div style={{ color: C.sage, marginTop: 12 }}>Loading…</div>
      )}
      {games?.length === 0 && (
        <div
          style={{
            background: C.greenLight,
            borderRadius: 14,
            padding: 24,
            marginTop: 12,
            color: C.sage,
            textAlign: "center",
          }}
        >
          No games yet. Use <b style={{ color: C.cream }}>Start a game</b> above to create one, or <b style={{ color: C.cream }}>Join with a code</b> if a friend shared one.
        </div>
      )}
      {games?.map((g) => (
        <div
          key={g.id}
          onClick={() => onOpen(g.id)}
          style={{
            background: C.card,
            borderRadius: 12,
            padding: "14px 16px",
            marginTop: 10,
            cursor: "pointer",
          }}
        >
          <div style={{ color: C.ink, fontWeight: 700, fontSize: 15 }}>
            {g.name}
            {g.status === "ended" ? <span style={{ color: "#1A1A1A", background: C.gold, borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 800, marginLeft: 8 }}>FINAL</span> : null}
          </div>
          <div style={{ color: C.faint, fontSize: 12, marginTop: 2 }}>
            {/* APP_RULES #25: C.green is cream-surface text only. Its job here was being the DARKEST
                thing in a light subtitle; on a green row the equivalent is the BRIGHTEST thing
                in a sage subtitle. C.green on C.greenLight is 1.54:1. */}
            {g.course} · code <b style={{ color: C.cream }}>{g.code}</b>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------- Create a game ----------------
// Seed passed from a Tee Time to prefill Create Game (P4 handoff): course + date
// + the IN-list members to preselect + the IN-list guests to carry forward (by
// name; their handicap is entered/confirmed in review). Tee groups are set in setup.

// Default tee selection when a course is picked. For TGC: prefer a "member" tee by
// name; else the tee whose total yardage is closest to 6400; else the first tee.
