"use client";
import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase";
import { gameRowSummary, type GameRowSummary } from "@/lib/game-list-summary";
import { loadTeamRounds } from "@/lib/team-rounds";
import { prepareRound } from "@/lib/round-prep";
import { dedupeHoles, type Round } from "@/lib/golf";
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
import { isDraftGame, visibleGames } from "@/lib/one-step-create";
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
    // 212.41 (owner, Oct 25): a saved DRAFT shows only to its organizer and club admins until it is sent to players.
    const me = (await supabase.auth.getUser()).data.user?.id ?? null;
    const anyDraft = (data || []).some((g: any) => isDraftGame(g) && g.created_by !== me);
    const { data: adm } = anyDraft && me
      ? await supabase.from("group_members").select("role").eq("group_id", activeGroupId).eq("user_id", me).eq("status", "active").maybeSingle()
      : { data: null as { role?: string } | null };
    setGames(visibleGames((data || []) as Game[], me, (adm as { role?: string } | null)?.role === "admin"));
  }, [activeGroupId]);
  useEffect(() => {
    load();
  }, [load]);

  // 212.126: the richer row — players, and for a FINAL game your result and your line (lib/game-list-summary). A
  // failure here leaves the plain row; it never blocks the list.
  const [summary, setSummary] = useState<Record<string, GameRowSummary>>({});
  useEffect(() => {
    if (!games?.length) return;
    let live = true;
    (async () => {
      try {
        const me = (await supabase.auth.getUser()).data.user?.id;
        if (!me) return;
        const { fetchAllIn } = await import("@/lib/fetch-all");
        const ids = games.map((g) => g.id);
        const players = await fetchAllIn<Player>(supabase, "game_players", "game_id", ids);
        const ended = games.filter((g) => g.status === "ended");
        let mine: Round[] = [];
        if (ended.length) {
          const { data: rs } = await supabase.from("rounds").select("*").eq("user_id", me).in("game_id", ended.map((g) => g.id)).is("deleted_at", null);   // bounded: the viewer's own posted round, at most one per game shown
          const rows = (rs || []) as any[];
          const hs = rows.length ? await fetchAllIn<any>(supabase, "holes", "round_id", rows.map((r) => r.id)) : [];
          mine = rows.map((r) => prepareRound({ ...r, holes: dedupeHoles(hs.filter((h) => h.round_id === r.id)) }) as Round);
        }
        const team = ended.some((g) => g.game_type === "scramble" || g.game_type === "alt_shot") ? await loadTeamRounds(supabase, me) : [];
        const out: Record<string, GameRowSummary> = {};
        for (const g of games) {
          out[g.id] = gameRowSummary(g, players.filter((p) => p.game_id === g.id), me, mine.find((r) => (r as { game_id?: string }).game_id === g.id) ?? null, team.find((t) => t.gameId === g.id) ?? null);
        }
        if (live) setSummary(out);
      } catch { /* the plain row stands */ }
    })();
    return () => { live = false; };
  }, [games]);

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
      // 212.41: a draft isn't open to anyone but its organizer until it is sent to the players
      if (isDraftGame(game) && game.created_by !== (await supabase.auth.getUser()).data.user?.id) throw new Error("No game found with that code.");
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
              style={{ ...btn(false), whiteSpace: "nowrap", opacity: code.trim() ? 1 : 0.62 }}
              disabled={!code.trim() || joining}
              onClick={join}
            >
              {joining ? "Joining…" : "Join"}
            </button>
          </div>
          {joinErr && (
            <div style={{ color: C.overRedDark, fontSize: 13, marginTop: 8 }}>
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
      {games?.map((g) => <GameRow key={g.id} g={g} summary={summary[g.id]} onOpen={onOpen} />)}
    </div>
  );
}

/** One game in the list (212.126). Also rendered by the design gallery; `legacy` reproduces the pre-212.126 row for
 *  the before/after only. */
export function GameRow({ g, summary, onOpen, legacy = false }: { g: Game; summary?: GameRowSummary; onOpen: (id: string) => void; legacy?: boolean }) {
  const s = legacy ? undefined : summary;
  const metaText = legacy ? g.course : s ? s.meta : g.course;
  const title = (
    <div style={{ color: C.cream, fontWeight: 700, fontSize: 15 }}>
      {g.name}{isDraftGame(g) ? <span data-draft-badge style={{ marginLeft: 8, color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 0.5 }}>DRAFT</span> : null}
      {g.status === "ended" ? <span style={{ color: C.cream, background: C.gold, borderRadius: 14, padding: "2px 8px", fontSize: 11, fontWeight: 800, marginLeft: 8 }}>FINAL</span> : null}
    </div>
  );
  const meta = (
    <div data-game-meta style={{ color: C.sage, fontSize: 12, marginTop: 2 }}>
      {metaText}{metaText ? " · " : ""}code <b style={{ color: C.cream }}>{g.code}</b>
    </div>
  );
  // 212.128 (owner: "results shown for complete games on the right with a dedicated margin"): a finished game is a
  // two-column grid — description on the left, a fixed RESULTS column on the right; the headline sits at the top and
  // each match's own result sits level with its line.
  const hasResults = !!s && g.status === "ended" && (!!s.result || s.lines.some((l) => l.value));
  return (
    <div onClick={() => onOpen(g.id)} data-game-row={g.id}
      style={{ background: C.greenLight, borderRadius: 12, padding: "13px 16px", marginTop: 10, cursor: "pointer" }}>
      {hasResults ? (
        <div data-game-grid style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 96px", columnGap: 12, rowGap: 2, alignItems: "baseline" }}>
          <div>{title}{meta}</div>
          <div data-game-result style={{ textAlign: "right", alignSelf: "start" }}>
            {s!.caption ? <div data-game-result-caption style={{ color: C.sage, fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>{s!.caption}</div> : null}
            {s!.result ? <div style={{ color: C.cream, fontSize: 14, fontWeight: 700 }}>{s!.result}</div> : null}
          </div>
          {s!.lines.map((l, i) => l.value ? (
            <React.Fragment key={i}>
              <div data-game-line style={{ color: C.sage, fontSize: 12 }}>{l.text}</div>
              <div data-game-line-value style={{ color: C.cream, fontSize: 12, fontWeight: 700, textAlign: "right" }}>{l.value}</div>
            </React.Fragment>
          ) : (
            // a line with no result of its own (your gross line, the opponents) runs the full width
            <div key={i} data-game-line style={{ gridColumn: "1 / -1", color: C.sage, fontSize: 12 }}>{l.text}</div>
          ))}
        </div>
      ) : (
        <>
          {title}{meta}
          {s?.lines.map((l, i) => <div key={i} data-game-line style={{ color: C.sage, fontSize: 12, marginTop: 2 }}>{l.text}{l.value ? ` — ${l.value}` : ""}</div>)}
        </>
      )}
    </div>
  );
}

// ---------------- Create a game ----------------
// Seed passed from a Tee Time to prefill Create Game (P4 handoff): course + date
// + the IN-list members to preselect + the IN-list guests to carry forward (by
// name; their handicap is entered/confirmed in review). Tee groups are set in setup.

// Default tee selection when a course is picked. For TGC: prefer a "member" tee by
// name; else the tee whose total yardage is closest to 6400; else the first tee.
