"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
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

const supabase = createClient();

// A 6-digit numeric join code (100000–999999).
function makeCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

type Game = {
  id: string;
  group_id?: string | null;
  code: string;
  name: string;
  course: string;
  course_par: number | null;
  holes_meta: { n: number; par: number; si: number | null; yards?: number | null }[]; // par + stroke index (+ yardage) per hole
  game_type: "stableford" | "stroke" | "match" | "fourball" | "skins" | "trifecta";
  stroke_basis?: "gross" | "net" | null; // stroke play: gross or net total
  skins_mode?: "carryover" | "split" | null; // individual skins: carryover (default) or split
  allowance_pct?: number | null; // handicap allowance % applied to net scoring
  marker_user_id?: string | null; // the player currently keeping score for the group
  pairings: { a: string; b: string }[]; // for match play: pkey(player) vs pkey(player)
  status?: "active" | "ended" | null;
  teams?: { key: string; name: string }[] | null; // two named teams for team match play
  foursomes?: { id: string; name: string; a: string[]; b: string[]; swap?: boolean }[] | null; // four-ball / trifecta: pair A vs pair B (swap = cross the singles)
  team_score_mode?: "best_ball" | "aggregate" | null; // trifecta team leg: low net vs both nets added
  leg_config?: LegConfig | null; // "Group results: legs & team points" — organizer-set scheme/metric/per-leg points
  structure_stash?: { teams?: { key: string; name: string }[] | null; foursomes?: { id: string; name: string; a: string[]; b: string[]; swap?: boolean }[] | null; pairings?: { a: string; b: string }[] | null } | null; // last team structure, kept when a format switch hides it so switching back restores it
  trifecta_scoring?: "per_hole" | "match" | null; // trifecta: per-hole points vs Ryder-Cup 1pt-per-match
  share_token?: string | null; // public live-scorecard token (organizer-set); null = not shared
  ended_at?: string | null; // when the game was ended (stamped by trigger); drives the 3-day live window
  created_by: string;
  created_at: string;
};

type Player = {
  id: string;
  game_id: string;
  user_id: string | null; // null for guest players (no account)
  display_name: string;
  avatar_url?: string | null; // denormalized profile photo (co-players can't read profiles)
  handicap_index: number | null;
  rating: number | null;
  slope: number | null;
  tee_name: string | null;
  course_handicap: number | null;
  scores: (number | null)[]; // strokes per hole
  putts: (number | null)[]; // putts per hole
  fairways: ("hit" | "miss" | "left" | "right" | null)[]; // fairway result per hole (par 4/5)
  penalties?: (number | null)[]; // penalty strokes per hole
  sand?: (boolean | null)[]; // greenside bunker per hole (for sand-save %)
  team?: string | null; // team key ("A"/"B") for team match play
  no_show?: boolean | null; // organizer-flagged no-show (four-ball: scored net double bogey)
  is_guest?: boolean | null; // a guest player added for this game only
  guest_of?: string | null; // sponsoring member's user id (guests only) — keeps guests with their host when grouping
  bets?: boolean | null; // in the TGC money game (default true; guests default false)
  tee_group?: number | null; // which tee group (foursome) this player is in (1,2,3…)
  is_marker?: boolean | null; // keeps score for their tee group
  group_locked?: boolean | null; // this player's tee group has been finished/locked
  clock_start?: string | null; // when this player first entered a score (round clock)
  clock_end?: string | null; // when this player finished the last hole (round clock)
};

// Stable match identity for a player. Real players key on user_id (so nothing
// about existing matches changes); guests have no account, so they key on their
// game_players row id. Used everywhere pairings/foursomes store or look up a
// player, so guests can be assigned to teams and matches like anyone.


// The handicap basis for all stroke math: the UNROUNDED course handicap (WHS
// applies allowances to the unrounded value and rounds once at the end). Falls
// back to the stored rounded course handicap when index/tee data is missing
// (e.g. legacy guests). Display still uses the rounded course_handicap.


// Team accent colour. If the team is *named* after a colour ("Red", "Blue", …) we
// honour that name so "Red" never shows up blue; otherwise fall back to a stable
// palette keyed off the team's position (0 / 1).
const TEAM_COLOR_BY_NAME: Record<string, string> = {
  red: "#E0695B", blue: "#5AA9E6", green: "#5BD08A", black: "#9AA0A6", white: "#D9D4C7",
  yellow: "#E8C84A", gold: "#D8B24A", orange: "#E0915B", purple: "#B084E0", pink: "#E08AB8",
  silver: "#C0C4C8", maroon: "#B05B5B", navy: "#5A7BC0", teal: "#4FB8A8",
};
const teamAccent = (name: string | null | undefined, index: number): string => {
  const k = (name || "").trim().toLowerCase();
  return TEAM_COLOR_BY_NAME[k] || (index === 0 ? "#5AA9E6" : "#E0915B");
};


function normalizeFavoriteCourse(row: any) {
  const d = { ...(row?.data || row || {}) };
  if ((!d.holes || !d.holes.length) && Array.isArray(d.tees)) {
    const t = d.tees.find((x: any) => x.holes && x.holes.length);
    if (t) {
      d.holes = t.holes;
      d.tees = d.tees.map((x: any) => ({
        name: x.name,
        rating: x.rating,
        slope: x.slope,
        par: x.par,
        yardages: x.yardages,
      }));
    }
  }
  return d;
}

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
  const [view, setView] = useState<"list" | "create" | { gameId: string; tab?: "play" | "setup" }>(
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        onCreated={(gameId, tab) => setView({ gameId, tab })}
      />
    );
  if (typeof view === "object")
    return (
      <GameRoom
        gameId={view.gameId}
        initialTab={view.tab}
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
function GameList({
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
            {g.course} · code <b style={{ color: C.green }}>{g.code}</b>
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
export type GameSeed = { teeTimeId: string; course: string | null; playDate: string; memberIds: string[]; guests: { name: string; sponsorUserId: string }[] };

// Default tee selection when a course is picked. For TGC: prefer a "member" tee by
// name; else the tee whose total yardage is closest to 6400; else the first tee.
function defaultTeeIdx(tees: any[], smart: boolean): number {
  if (!Array.isArray(tees) || tees.length === 0) return 0;
  if (!smart) return 0;
  const mi = tees.findIndex((t) => /member/i.test(t?.name || ""));
  if (mi >= 0) return mi;
  let best = -1, bestDiff = Infinity;
  tees.forEach((t, i) => {
    const yds = Array.isArray(t?.yardages) ? t.yardages.reduce((s: number, v: any) => s + (Number(v) || 0), 0) : 0;
    if (yds > 0) { const d = Math.abs(yds - 6400); if (d < bestDiff) { bestDiff = d; best = i; } }
  });
  return best >= 0 ? best : 0;
}

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
  onCreated: (id: string, tab?: "play" | "setup") => void;
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
  useEffect(() => { setAllowancePct(gameType === "fourball" || gameType === "trifecta" ? 85 : 100); }, [gameType]);
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
  const [busy, setBusy] = useState(false);
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
    loadCoursesForGroup(supabase, activeGroupId).then((data) => {
      if (data)
        setFavorites(
          data.map((f: any) => normalizeFavoriteCourse(f)),
        );
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
    if (f) { setPickedFav(f); setTeeIdx(defaultTeeIdx(f.tees, activeGroupId === TGC_GROUP_ID)); }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyDraft = (d: SetupDraft) => {
    resumedRef.current = true;
    guestsSeeded.current = true; // don't re-seed tee-time guests over the restored ones
    setName(d.name); setMatchDate(d.matchDate); setTeeIdx(d.teeIdx); setIdxStr(d.idxStr);
    setGameType(d.gameType as any); setAllowancePct(d.allowancePct); setTeamScoreMode(d.teamScoreMode as any);
    setTrifectaScoring(d.trifectaScoring as any); setStrokeBasis(d.strokeBasis as any); setFmtFamily(d.fmtFamily as any);
    setMatchKind(d.matchKind as any); setTeamMode(d.teamMode); setSkinsTeamStyle(d.skinsTeamStyle as any);
    setSkinsMode(d.skinsMode as any); setTeam1(d.team1); setTeam2(d.team2);
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

  // Save the in-progress setup on every meaningful change (once we've decided
  // resume-vs-fresh, so we never overwrite an offered draft before the user chooses).
  useEffect(() => {
    if (!hydratedRef.current) return;
    const snap = {
      name, matchDate, favName: pickedFav?.name ?? null, teeIdx, idxStr, gameType, allowancePct,
      teamScoreMode, trifectaScoring, strokeBasis, fmtFamily, matchKind, teamMode, skinsTeamStyle,
      skinsMode, team1, team2, selectedPlayers, guestPlayers,
    };
    if (draftHasProgress(snap, user.id)) saveSetupDraft(activeGroupId, teeTimeId, snap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, matchDate, pickedFav, teeIdx, idxStr, gameType, allowancePct, teamScoreMode, trifectaScoring, strokeBasis, fmtFamily, matchKind, teamMode, skinsTeamStyle, skinsMode, team1, team2, selectedPlayers, guestPlayers]);

  const tee = pickedFav?.tees?.[teeIdx];
  const coursePar = pickedFav
    ? pickedFav.holes.reduce((s: number, h: any) => s + (h.par || 0), 0)
    : null;
  const idxVal = idxStr.trim() === "" ? null : parseFloat(idxStr);
  const ch =
    tee && idxVal != null && coursePar
      ? courseHandicap(idxVal, tee.slope, tee.rating, coursePar)
      : null;

  const create = async () => {
    if (!pickedFav || !tee) {
      setErr("Pick a course (from your favorites).");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const code = makeCode();
      const typeLabel = gameType === "match" ? "Match Play" : gameType === "fourball" ? "Four-Ball" : gameType === "skins" ? "Skins" : gameType === "trifecta" ? "Trifecta" : gameType === "stroke" ? "Stroke Play" : "Stableford";
      // TZ-safe date label for the auto-generated name (noon avoids offset rollover).
      const dateLabel = new Date(matchDate + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      const autoName = `${typeLabel} / ${pickedFav.name} / ${dateLabel}`;
      const holesMeta = pickedFav.holes.map((h: any, i: number) => ({
        n: h.n,
        par: h.par,
        si: h.si,
        yards: tee?.yardages?.[i] ?? null,
      }));
      const { data: game, error } = await supabase
        .from("games")
        .insert({
          code,
          group_id: activeGroupId,
          name: name.trim() || autoName,
          course: pickedFav.name,
          course_par: coursePar,
          played_at: matchDate,
          allowance_pct: allowancePct,
          holes_meta: holesMeta,
          game_type: gameType,
          pairings: [],
          teams:
            ((gameType === "match" || gameType === "skins" || gameType === "fourball") && teamMode) || gameType === "trifecta"
              ? [
                  { key: "A", name: team1.trim() || "Team 1" },
                  { key: "B", name: team2.trim() || "Team 2" },
                ]
              : null,
          foursomes: gameType === "fourball" || gameType === "trifecta" || (gameType === "skins" && teamMode && skinsTeamStyle === "best_ball") ? [] : null,
          team_score_mode: gameType === "trifecta" || gameType === "fourball" || (gameType === "skins" && teamMode && skinsTeamStyle === "best_ball") ? teamScoreMode : "best_ball",
          trifecta_scoring: gameType === "trifecta" ? trifectaScoring : null,
          stroke_basis: gameType === "stroke" ? strokeBasis : null,
          skins_mode: gameType === "skins" ? skinsMode : null,
        })
        .select()
        .single();
      if (error || !game) throw error || new Error("Could not create game");
      // Remember the creator's handicap: if they overrode the prefilled value,
      // save it back to their profile so it persists as the new default.
      if (idxVal != null && idxVal !== profileIdx) {
        try { await supabase.from("profiles").update({ handicap_index: idxVal }).eq("id", user.id); } catch {}
      }
      // Add creator plus any selected group members immediately, so group games do not require join codes.
      // Split skins stays simple only in a small field. Beyond 4, steer to teams or 1:1.
      const skinsFieldCount = groupRoster.filter((p) => selectedPlayers[p.id] || p.id === user.id).length + guestPlayers.length;
      if (gameType === "skins" && !teamMode && skinsMode === "split" && skinsFieldCount > 4) {
        setErr("Split skins is best for up to 4 players. For a bigger group, use Team skins or 1:1 matchups, or switch Skins to carryover.");
        setBusy(false);
        return;
      }
      const selectedIds = new Set([
        user.id,
        ...Object.keys(selectedPlayers).filter((id) => selectedPlayers[id]),
      ]);
      const selectedRoster = groupRoster.filter((p) => selectedIds.has(p.id));
      if (!selectedRoster.some((p) => p.id === user.id)) {
        selectedRoster.unshift({
          id: user.id,
          display_name: displayName,
          avatar_url: null,
          handicap_index: idxVal,
        });
      }
      // Each selected player already carries avatar_url from the group roster,
      // so we denormalize it straight onto the game_player row.
      const rosterRows = selectedRoster.map((p) => {
        const playerIndex = p.id === user.id ? idxVal : p.handicap_index;
        const playerCourseHandicap =
          playerIndex != null && coursePar != null
            ? courseHandicap(playerIndex, tee.slope, tee.rating, coursePar)
            : null;
        return {
          game_id: game.id,
          user_id: p.id,
          is_guest: false,
          bets: true, // members default into the TGC money game (never rely on the DB default)
          ...GP_STATE_DEFAULTS,
          display_name: p.display_name || "Player",
          avatar_url: (p as any).avatar_url ?? null,
          handicap_index: playerIndex,
          rating: tee.rating,
          slope: tee.slope,
          tee_name: tee.name,
          course_handicap: playerCourseHandicap,
          scores: Array(holesMeta.length).fill(null),
          putts: Array(holesMeta.length).fill(null),
          fairways: Array(holesMeta.length).fill(null),
        };
      });
      const guestRows = guestPlayers.map((p) => ({
        game_id: game.id,
        user_id: null,
        is_guest: true,
        guest_of: p.guest_of || null,
        bets: false,
        ...GP_STATE_DEFAULTS,
        display_name: p.display_name,
        handicap_index: p.handicap_index,
        rating: tee.rating,
        slope: tee.slope,
        tee_name: tee.name,
        course_handicap: p.handicap_index != null && coursePar != null ? courseHandicap(p.handicap_index, tee.slope, tee.rating, coursePar) : null,
        scores: Array(holesMeta.length).fill(null),
        putts: Array(holesMeta.length).fill(null),
        fairways: Array(holesMeta.length).fill(null),
      }));
      const rows = [...rosterRows, ...guestRows];
      // 4 or fewer players tee off together — default everyone to one group (organizer
      // can still split them manually). Bigger rosters start ungrouped for assignment.
      if (rows.length <= 4) rows.forEach((r) => { (r as any).tee_group = 1; });
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
      // Field games (Stableford / Stroke) are ready to play once players are in;
      // every other format still needs teams / matchups / handicaps, so open Setup.
      clearSetupDraft(activeGroupId, teeTimeId); // setup finished — drop the local draft
      onCreated(game.id, gameType === "stableford" || gameType === "stroke" ? "play" : "setup");
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
          <label style={{ color: C.sage, fontSize: 12 }}>Match date</label>
          <div><ShortDateInput value={matchDate} onChange={(v) => setMatchDate(v || todayLocal())} max={todayLocal()} /></div>
        </div>
      </div>

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
            return (
              <label
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "14px 12px",
                  cursor: isMe ? "default" : "pointer",
                  borderBottom: `1px solid ${C.greenMid}`,
                  borderRadius: 8,
                  background: checked ? "rgba(216,178,74,0.10)" : "transparent",
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={isMe}
                  onChange={(e) =>
                    setSelectedPlayers((m) => ({
                      ...m,
                      [p.id]: e.target.checked,
                    }))
                  }
                  style={{ width: 22, height: 22, flex: "0 0 auto", accentColor: "#D8B24A", cursor: isMe ? "default" : "pointer" }}
                />
                <Avatar src={p.avatar_url} name={p.display_name} size={32} />
                <span style={{ flex: 1, color: C.cream, fontWeight: 700, fontSize: 15 }}>
                  {p.display_name}
                  {isMe ? " (you)" : ""}
                </span>
                <span style={{ color: C.sage, fontSize: 12 }}>
                  {p.handicap_index != null
                    ? `HCP ${p.handicap_index}`
                    : "no handicap"}
                </span>
              </label>
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
                const ch = hasIdx && tee && coursePar != null ? courseHandicap(g.handicap_index as number, tee.slope, tee.rating, coursePar) : null;
                return (
                <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 8, background: C.greenMid, borderRadius: 10, padding: "6px 10px" }}>
                  <span style={{ color: C.cream, fontSize: 13, flex: 1, minWidth: 0 }}>
                    {g.display_name}
                    <span style={{ color: C.sage, fontSize: 11 }}> · guest of {g.guest_of === user.id ? "me" : (groupRoster.find((m) => m.id === g.guest_of)?.display_name || "member")}</span>
                    {hasIdx ? <span style={{ color: C.sage, fontSize: 11 }}> · idx {g.handicap_index}{ch != null ? ` · ch ${ch}` : ""}</span> : null}
                  </span>
                  {!hasIdx && (
                    <>
                      <span style={{ color: "#f6c66b", fontSize: 10, fontWeight: 800, letterSpacing: 0.4 }}>NEEDS HCP</span>
                      <input
                        value={guestIdxEdits[g.id] ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v !== "" && !/^-?\d*\.?\d*$/.test(v)) return;
                          setGuestIdxEdits((m) => ({ ...m, [g.id]: v }));
                          const num = v === "" ? null : parseFloat(v);
                          setGuestPlayers((prev) => prev.map((p) => (p.id === g.id ? { ...p, handicap_index: num == null || Number.isNaN(num) ? null : num } : p)));
                        }}
                        inputMode="decimal"
                        placeholder="Idx"
                        style={{ ...inputStyle, width: 60, padding: "4px 8px", fontSize: 12 }}
                      />
                    </>
                  )}
                  <button
                    onClick={() => { setGuestPlayers((prev) => prev.filter((p) => p.id !== g.id)); setGuestIdxEdits((m) => { const n = { ...m }; delete n[g.id]; return n; }); }}
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
              setTeeIdx(defaultTeeIdx(f.tees, activeGroupId === TGC_GROUP_ID));
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
          <label style={{ color: C.sage, fontSize: 12 }}>Your tee</label>
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

      <div style={{ marginTop: 14 }}>
        <label style={{ color: C.sage, fontSize: 12 }}>Format</label>
        {/* Two-family guided chooser: pick a family, then a format. */}
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <button
            onClick={() => { setFmtFamily("stroke"); if (gameType === "match" || gameType === "fourball" || gameType === "trifecta") setGameType("stableford"); else if (gameType === "skins") { setTeamMode(false); setSkinsTeamStyle("head_to_head"); } }}
            style={{ flex: 1, textAlign: "left", background: fmtFamily === "stroke" ? C.green : C.greenLight, border: `1.5px solid ${fmtFamily === "stroke" ? C.gold : "transparent"}`, borderRadius: 12, padding: 11, cursor: "pointer" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ width: 34, height: 34, borderRadius: "50%", border: `1.5px solid ${C.gold}`, background: "#fbf6e6", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M7 21V3" stroke="#0E3B2E" strokeWidth="1.6" strokeLinecap="round"/><path d="M7 4l9 2.5L7 9.5z" fill="#B83A2E"/><circle cx="7" cy="21" r="1.6" fill="#C9A227"/></svg>
              </span>
              <div>
                <div style={{ color: C.cream, fontWeight: 700, fontFamily: "Georgia, serif", fontSize: 15 }}>Stroke</div>
                <div style={{ color: C.sage, fontSize: 11 }}>The whole field</div>
              </div>
            </div>
          </button>
          <button
            onClick={() => { setFmtFamily("match"); const bb = gameType === "skins" && teamMode && skinsTeamStyle === "best_ball"; if (!bb && (gameType === "stableford" || gameType === "stroke" || gameType === "skins")) setGameType(matchKind === "team" ? "fourball" : "match"); }}
            style={{ flex: 1, textAlign: "left", background: fmtFamily === "match" ? C.green : C.greenLight, border: `1.5px solid ${fmtFamily === "match" ? C.gold : "transparent"}`, borderRadius: 12, padding: 11, cursor: "pointer" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ width: 34, height: 34, borderRadius: "50%", border: `1.5px solid ${C.gold}`, background: "#fbf6e6", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M4 6l7 6-7 6" stroke="#0E3B2E" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><path d="M20 6l-7 6 7 6" stroke="#B83A2E" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </span>
              <div>
                <div style={{ color: C.cream, fontWeight: 700, fontFamily: "Georgia, serif", fontSize: 15 }}>Match play</div>
                <div style={{ color: C.sage, fontSize: 11 }}>Head to head</div>
              </div>
            </div>
          </button>
        </div>
        {fmtFamily === "stroke" ? (
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button onClick={() => setGameType("stableford")} style={{ ...btn(gameType === "stableford"), flex: 1, minWidth: 100, fontSize: 13 }}>Stableford</button>
            <button onClick={() => setGameType("stroke")} style={{ ...btn(gameType === "stroke"), flex: 1, minWidth: 100, fontSize: 13 }}>Stroke play</button>
            <button onClick={() => { setGameType("skins"); setTeamMode(false); setSkinsTeamStyle("head_to_head"); }} style={{ ...btn(gameType === "skins" && fmtFamily === "stroke"), flex: 1, minWidth: 100, fontSize: 13 }}>Skins</button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={() => { setMatchKind("ind"); setGameType("match"); }} style={{ ...btn(matchKind === "ind"), flex: 1, fontSize: 13 }}>Individual</button>
              <button onClick={() => { setMatchKind("team"); if (gameType !== "fourball" && gameType !== "trifecta") setGameType("fourball"); }} style={{ ...btn(matchKind === "team"), flex: 1, fontSize: 13 }}>Team</button>
            </div>
            {matchKind === "ind" ? (
              <div style={{ marginTop: 8 }}>
                <button onClick={() => setGameType("match")} style={{ ...btn(gameType === "match"), width: "100%", fontSize: 13 }}>Singles match</button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button onClick={() => setGameType("fourball")} style={{ ...btn(gameType === "fourball"), flex: 1, minWidth: 104, fontSize: 13 }}>Four-ball</button>
                <button onClick={() => setGameType("trifecta")} style={{ ...btn(gameType === "trifecta"), flex: 1, minWidth: 104, fontSize: 13 }}>Trifecta</button>
                <button onClick={() => { setGameType("skins"); setTeamMode(true); setSkinsTeamStyle("best_ball"); }} style={{ ...btn(gameType === "skins"), flex: 1, minWidth: 104, fontSize: 13 }}>Skins</button>
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
              <input type="checkbox" checked={teamMode} onChange={(e) => setTeamMode(e.target.checked)} />
              <span style={{ color: C.cream, fontWeight: 700, fontSize: 14 }}>{gameType === "skins" ? "Team skins" : gameType === "fourball" ? "Team four-ball (Red vs Blue)" : "Team match (e.g. 4 v 4)"}</span>
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
              <button key={amt} onClick={() => setAllowancePct(amt)} style={{ ...btn(allowancePct === amt), fontSize: 13, padding: "8px 14px" }}>{amt}%</button>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="number"
                value={allowancePct}
                onChange={(e) => setAllowancePct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                style={{ ...inputStyle, width: 64, padding: "8px 10px", fontSize: 13, textAlign: "center" }}
              />
              <span style={{ color: C.sage, fontSize: 13 }}>%</span>
            </div>
          </div>
          <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>
            Players play off this percentage of their course handicap. 100% for singles/Stableford/Skins, 85% standard for four-ball. The lower handicap still plays off the difference in match formats.
          </div>
        </div>
      </div>

      {err && (
        <div style={{ color: "#E8A199", fontSize: 13, marginTop: 10 }}>
          {err}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button style={btn(false)} onClick={onCancel}>
          Cancel
        </button>
        <button
          style={{ ...btn(true), opacity: pickedFav && !busy ? 1 : 0.5 }}
          disabled={!pickedFav || busy}
          onClick={create}
        >
          {busy ? "Creating…" : "Create game"}
        </button>
      </div>
    </div>
  );
}

// ---------------- Game room: score entry + leaderboard ----------------
function GameRoom({
  gameId,
  initialTab,
  user,
  displayName,
  isAdmin,
  onBack,
}: {
  gameId: string;
  initialTab?: "play" | "setup";
  user: any;
  displayName: string;
  isAdmin?: boolean;
  onBack: () => void;
}) {
  const [game, setGame] = useState<Game | null>(null);
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
  const [setupTab, setSetupTab] = useState<"players" | "teams" | "matchups" | "groups">("players");
  const [cardView, setCardView] = useState(false); // show the whole-group vertical scorecard

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
    await supabase.rpc("finish_tee_group", { p_game: game.id });
    // Post a round for EVERY player in this tee group — in group scoring the keeper
    // holds everyone's scores, so finishing the group should write all of them, not
    // just the keeper's. recordMyGameRound() still runs as a guaranteed fallback for
    // my own round (in case the group RPC isn't deployed yet); both are idempotent.
    await supabase.rpc("post_group_rounds", { p_game: game.id, p_tee_group: myRow.tee_group });
    await recordMyGameRound();
    await load();
  };
  // Non-organizers only ever see the scorecard.
  useEffect(() => {
    if (roomTab === "setup" && game && game.created_by !== user.id) setRoomTab("play");
  }, [roomTab, game, user.id]);
  const [teeIdx, setTeeIdx] = useState(0);
  const [idxStr, setIdxStr] = useState("");
  const [courseTees, setCourseTees] = useState<CourseTee[]>([]);
  type FinishGap = { name: string; noScores: boolean; missScores: number[]; missPutts: number[]; missFw: number[] };
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
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const snap = loadGameSnapshot(gameId);
      setCourseTees(snap?.courseTees && snap.courseTees.length ? (snap.courseTees as any) : []);
      return;
    }
    let alive = true;
    loadCoursesForGroup(supabase, game.group_id).then((rows) => {
      if (!alive) return;
      const courses = (rows || []).map((r: any) => normalizeFavoriteCourse(r));
      const found = courses.find((c: any) => c.name === game.course || courseLabel(c) === game.course);
      const tees = Array.isArray(found?.tees) ? found.tees : [];
      if (tees.length) {
        setCourseTees(tees);
        saveGameSnapshot(gameId, { courseTees: tees });
      } else {
        // Offline / not found: keep the snapshot's tees rather than blanking yardages.
        const snap = loadGameSnapshot(gameId);
        setCourseTees(snap?.courseTees && snap.courseTees.length ? (snap.courseTees as any) : tees);
      }
    });
    return () => { alive = false; };
  }, [game?.group_id, game?.course]);

  // Once an ended game and my player row are both loaded, ensure my scorecard is
  // recorded as a round in my history. Idempotent (skips if already recorded).
  useEffect(() => {
    if ((game?.status === "ended" || myRow?.group_locked) && me && me.user_id) {
      recordMyGameRound();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.status, me?.id, myRow?.group_locked]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const playerHoles = (p: Player): Hole[] => {
    if (!game) return [];
    const alloc = allocateStrokes(
      game.holes_meta.map((m) => ({ hole_number: m.n, stroke_index: m.si })),
      applyAllowance(chBasis(p, game.course_par), game.allowance_pct ?? 100),
    );
    return game.holes_meta.map((m, i) => ({
      hole_number: m.n,
      par: m.par,
      stroke_index: m.si,
      strokes: p.scores?.[i] ?? null,
      putts: p.putts?.[i] ?? null,
      fairway: p.fairways?.[i] ?? null,
      penalties: 0,
      recv: alloc[m.n] || 0,
    }));
  };

  const playerPoints = (p: Player) =>
    playerHoles(p).reduce(
      (s, h) => s + (stablefordPts(h.strokes, h.par, h.recv || 0) || 0),
      0,
    );

  const playerThru = (p: Player) =>
    (p.scores || []).filter((s) => s != null && s > 0).length;

  // Gross = total strokes on holes played. Net = gross minus strokes received on those holes.
  const playerGross = (p: Player) =>
    playerHoles(p).reduce((s, h) => s + (h.strokes && h.strokes > 0 ? h.strokes : 0), 0);
  const playerNet = (p: Player) =>
    playerHoles(p).reduce(
      (s, h) => s + (h.strokes && h.strokes > 0 ? h.strokes - (h.recv || 0) : 0),
      0,
    );

  // Net score relative to par, derived from Stableford: par = 2 pts/hole, so rel = 2*thru − points.
  // Negative = under par. Returned as a display string like "-1", "E", "+2".
  const relToParStr = (p: Player) => {
    const rel = 2 * playerThru(p) - playerPoints(p);
    return rel === 0 ? "E" : rel > 0 ? `+${rel}` : `${rel}`;
  };
  // Par of the holes played so far (for true stroke over/under par, uncapped).
  const parThru = (p: Player) => playerHoles(p).reduce((s2, h) => s2 + (h.strokes && h.strokes > 0 ? (h.par || 0) : 0), 0);
  const leaderName = (full: string) => { const n = (full || "").trim(); if (n.length <= 15) return n; const parts = n.split(/\s+/); if (parts.length > 1) { const c = parts[0] + " " + parts[parts.length - 1][0]; return c.length <= 15 ? c : parts[0].slice(0, 15); } return n.slice(0, 15); };

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

  // Organizer: override any player's handicap index for this game (recomputes course handicap).
  const overridePlayerHandicap = async (p: Player, idxVal: number | null) => {
    if (!game) return;
    // Use the player's rating/slope, else the organizer's row.
    const ref =
      p.rating != null && p.slope != null
        ? p
        : players.find((x) => x.rating != null && x.slope != null);
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
    await supabase.from("game_players").update({ team }).eq("id", p.id);
    await load();
  };

  // Organizer: update a player's tee group from the unified setup roster.
  const setPlayerTeeGroup = async (p: Player, group: number | null) => {
    const { error } = await supabase.rpc("set_tee_group", { p_player: p.id, p_group: group });
    if (error) notifyError("Couldn't update that player's group — please try again.");
    await load();
  };

  // Organizer: shuffle the field into balanced foursomes, keeping each guest with
  // the member who sponsored them. Overflow guests (a sponsor with >3 guests) are
  // left unassigned for manual placement. Pre-round only — see canRandomize below.
  const [randomizing, setRandomizing] = useState(false);
  const [groupOverflow, setGroupOverflow] = useState<string[]>([]); // player ids left unassigned by the shuffle
  const groupsLocked = players.some((p) => p.group_locked);
  const anyScoresNow = players.some((p) => (p.scores || []).some((s) => s != null));
  const canRandomize = !gameEnded && !anyScoresNow && !groupsLocked;
  const randomizeReason = gameEnded ? "The game has ended." : anyScoresNow ? "Scores are already in — groups are set for the round." : groupsLocked ? "A group has started scoring — groups are set for the round." : "";
  const randomizeGroups = async () => {
    if (!game || !canRandomize) return;
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
  const refTee = () => {
    const ref = players.find((p) => p.rating != null && p.slope != null && p.tee_name) || players[0];
    return { rating: ref?.rating ?? null, slope: ref?.slope ?? null, tee_name: ref?.tee_name ?? null };
  };
  const blankCard = () => {
    const n = game?.holes_meta?.length ?? 18;
    return { scores: Array(n).fill(null), putts: Array(n).fill(null), fairways: Array(n).fill(null), ...GP_STATE_DEFAULTS };
  };
  const addGuestToGame = async (name: string, idx: number, sponsor: string) => {
    if (!game || !name.trim() || Number.isNaN(idx)) return;
    const t = refTee();
    const ch = (t.slope != null && t.rating != null && game.course_par != null)
      ? courseHandicap(idx, t.slope, t.rating, game.course_par) : null;
    const { error } = await supabase.from("game_players").insert({
      game_id: game.id, user_id: null, is_guest: true, guest_of: sponsor || null, bets: false, display_name: name.trim(),
      handicap_index: idx, rating: t.rating, slope: t.slope, tee_name: t.tee_name,
      course_handicap: ch, ...blankCard(),
    });
    if (error) { notifyError("Couldn't add that guest — please try again."); return; }
    // Note: game guests are intentionally NOT written to the persistent group_guests
    // list — they're temporary to this game. (The Money tab keeps its own guests.)
    await load();
  };
  const addMemberToGame = async (m: { id: string; display_name: string; handicap_index: number | null }) => {
    if (!game) return;
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
    if (!game) return;
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
    const effect =
      (game.game_type === "fourball" || game.game_type === "trifecta") ? "any holes they didn't play score net double bogey for their team"
      : game.game_type === "match" ? "the match stands on the holes already played"
      : "their unplayed holes score nothing";
    if (next && !confirm(`Mark ${p.display_name} as out? The holes they've already played still count; ${effect}.`)) return;
    await supabase.from("game_players").update({ no_show: next }).eq("id", p.id);
    await load();
  };

  const removePlayer = async (p: Player) => {
    if (!game || p.user_id === game.created_by) return;
    if (
      !confirm(
        `Remove ${p.display_name} from "${game.name}"? Their scores in this game will be deleted.`,
      )
    )
      return;
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
    if (!game || !newName.trim()) return;
    await supabase
      .from("games")
      .update({ name: newName.trim() })
      .eq("id", game.id);
    await load();
  };

  // Organizer: change the handicap allowance on a live game. Views read
  // allowance_pct live, so standings/strokes recompute on the next load.
  const setAllowance = async (pct: number) => {
    if (!game) return;
    const v = Math.max(0, Math.min(100, Math.round(pct)));
    await supabase.from("games").update({ allowance_pct: v }).eq("id", game.id);
    await load();
  };

  // Organizer: change the format on a live game. Only safe transitions are
  // offered in the UI (see formatGroup); pairings/foursomes/teams are kept in
  // place so a switch is reversible. Allowance auto-suggests the new format's
  // common-practice number but the organizer can override after.
  const anyScores = players.some((p) => (p.scores || []).some((s) => s != null));
  const changeTrifectaScoring = async (next: "per_hole" | "match") => {
    if (!game || game.status === "ended") return;
    await supabase.from("games").update({ trifecta_scoring: next }).eq("id", game.id);
    await load();
  };
  const setFormat = async (next: "stableford" | "stroke" | "match" | "fourball" | "skins" | "trifecta") => {
    if (!game || next === game.game_type) return;
    const suggested = next === "fourball" || next === "trifecta" ? 85 : 100;
    const patch: Record<string, unknown> = { game_type: next, allowance_pct: suggested };
    if (next === "trifecta" && !game.team_score_mode) patch.team_score_mode = "best_ball";
    if (next === "trifecta" && !game.trifecta_scoring) patch.trifecta_scoring = "per_hole";
    if (next === "stroke" && !game.stroke_basis) patch.stroke_basis = "net";
    // NOTE: we deliberately do NOT clear pairings/foursomes/teams when switching
    // format. A player's setup work is preserved so switching back restores it;
    // formats that don't use a given structure simply ignore it (see the
    // game_type guards in StrokesSummary and the setup tab steps).
    const { error } = await supabase.from("games").update(patch).eq("id", game.id);
    if (error) { alert("Couldn't change the format — " + error.message); return; }
    await load();
  };

  const setTeamScoreMode = async (mode: "best_ball" | "aggregate") => {
    if (!game) return;
    const { error } = await supabase.from("games").update({ team_score_mode: mode }).eq("id", game.id);
    if (error) { alert("Couldn't change the team scoring — " + error.message); return; }
    await load();
  };

  const setLegConfig = async (cfg: LegConfig) => {
    if (!game) return;
    const { error } = await supabase.from("games").update({ leg_config: cfg }).eq("id", game.id);
    if (error) { alert("Couldn't save the leg settings — " + error.message); return; }
    await load();
  };
  const updateSkinsMode = async (mode: "carryover" | "split") => {
    if (!game) return;
    const { error } = await supabase.from("games").update({ skins_mode: mode }).eq("id", game.id);
    if (error) { alert("Couldn't change the tie handling — " + error.message); return; }
    await load();
  };
  // Convert a skins game between individual / 1:1 team / 2v2 best-ball mid-round.
  // Scores are never touched — only the team structure changes, and the skins
  // recompute. Team styles leave the side assignment to the Matchups step.
  const setSkinsStyle = async (style: "individual" | "team_11" | "team_2v2") => {
    if (!game) return;
    const g = game as any;
    const liveTeams = Array.isArray(g.teams) && g.teams.length === 2 ? g.teams : null;
    const liveFour = Array.isArray(g.foursomes) ? g.foursomes : null;
    const livePair = Array.isArray(g.pairings) ? g.pairings : [];
    const prev = g.structure_stash || {};
    // Keep the latest team structure so any later switch can restore it intact.
    const stash = {
      teams: liveTeams ?? prev.teams ?? null,
      foursomes: liveFour ?? prev.foursomes ?? null,
      pairings: (livePair.length ? livePair : prev.pairings) ?? [],
    };
    if (anyScores && style === "individual" && !!liveTeams) {
      if (!confirm("Switch to individual skins? The team setup is hidden but kept — switch back and your matchups return. Every score so far stays.")) return;
    }
    const defTeams = [{ key: "A", name: "Team 1" }, { key: "B", name: "Team 2" }];
    let teams: any = null, foursomes: any = null, pairings: any = [];
    if (style === "team_11") { teams = stash.teams ?? defTeams; foursomes = null; pairings = stash.pairings ?? []; }
    else if (style === "team_2v2") { teams = stash.teams ?? defTeams; foursomes = stash.foursomes ?? []; pairings = stash.pairings ?? []; }
    const patch: Record<string, unknown> = { game_type: "skins", teams, foursomes, pairings, structure_stash: stash };
    let flippedSplit = false;
    if (style === "individual" && g.skins_mode === "split" && players.filter((p) => !p.no_show).length > 4) {
      patch.skins_mode = "carryover"; flippedSplit = true;
    }
    const { error } = await supabase.from("games").update(patch).eq("id", game.id);
    if (error) { alert("Couldn't change the skins style — " + error.message); return; }
    await load();
    if (flippedSplit) alert("Halved (split) skins is best for up to 4 players — with a bigger field, individual skins is set to carry over instead.");
  };
  // Singles match <-> team match (e.g. 4 v 4). Only flips the team structure;
  // pairings are assigned in Matchups. Scores untouched.
  const setMatchTeam = async (on: boolean) => {
    if (!game) return;
    const g = game as any;
    const liveTeams = Array.isArray(g.teams) && g.teams.length === 2 ? g.teams : null;
    const prev = g.structure_stash || {};
    const stash = { ...prev, teams: liveTeams ?? prev.teams ?? null };
    const teams = on ? (stash.teams ?? [{ key: "A", name: "Team 1" }, { key: "B", name: "Team 2" }]) : null;
    const { error } = await supabase.from("games").update({ teams, structure_stash: stash }).eq("id", game.id);
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
    const { error: finErr } = await supabase.rpc("finish_game", { p_game: game.id });
    if (finErr) { alert("Couldn't end the game — " + finErr.message); return; }
    // Post every player's scorecard to their Rounds history right now (server-side),
    // so it no longer waits for each player to reopen the ended game on their device.
    await supabase.rpc("post_game_rounds", { p_game: game.id });
    // Freeze the round clock for anyone still running (started but no end yet).
    const nowIso = new Date().toISOString();
    await Promise.all(players
      .filter((p) => p.clock_start != null && p.clock_end == null)
      .map((p) => supabase.from("game_players").update({ clock_end: nowIso }).eq("id", p.id)));
    await recordMyGameRound();
    await logActivity(supabase, { actor_id: user.id, actor_name: displayName, action: "game_ended", group_id: (game as any).group_id || null, summary: `Ended the game "${game.name}"` });
    await load();
  };

  // Pre-conclusion completeness: list what's missing for the players being locked.
  const finishListFmt = (a: number[]) => (a.length > 8 ? `${a.length} holes` : a.join(", "));
  const computeFinishGaps = (scope: Player[]): FinishGap[] => {
    const meta = game?.holes_meta || [];
    const out: FinishGap[] = [];
    for (const pl of scope) {
      if (pl.no_show) continue;
      const sc = pl.scores || []; const pu = pl.putts || []; const fw = pl.fairways || [];
      const cells = meta.map((m, i) => ({ i, par: m.par, n: m.n, s: sc[i] }));
      const entered = cells.filter((c) => c.s != null && (c.s as number) > 0);
      if (entered.length === 0) { out.push({ name: pl.display_name, noScores: true, missScores: [], missPutts: [], missFw: [] }); continue; }
      const missScores = cells.filter((c) => c.s == null || (c.s as number) <= 0).map((c) => c.n);
      const tracks = pu.some((v) => v != null) || fw.some((v) => v != null);
      const missPutts = tracks ? entered.filter((c) => pu[c.i] == null).map((c) => c.n) : [];
      const missFw = tracks ? entered.filter((c) => c.par >= 4 && fw[c.i] == null).map((c) => c.n) : [];
      if (missScores.length || missPutts.length || missFw.length) out.push({ name: pl.display_name, noScores: false, missScores, missPutts, missFw });
    }
    return out;
  };
  const requestEndGame = async () => {
    if (!game) return;
    setFinishPrompt({ kind: "game", gaps: computeFinishGaps(players) });
  };
  const requestFinishGroup = async () => {
    if (!game || myRow?.tee_group == null) return;
    const scope = players.filter((pl) => pl.tee_group === myRow.tee_group);
    setFinishPrompt({ kind: "group", teeGroup: myRow.tee_group ?? undefined, gaps: computeFinishGaps(scope) });
  };

  // When a game is ended, each player records THEIR OWN scorecard into their rounds
  // history (so it counts toward their stats/handicap/dashboard), like a solo round.
  // Done per-user (not by the organizer for everyone) so it respects row-level
  // security — every player writes only their own round. Tagged with the game id
  // so it's only ever created once, even if the game is reopened and re-ended, or
  // the player opens the ended game on multiple devices.
  const recordMyGameRound = async () => {
    if (!game || !me || !me.user_id) return;
    try {
      const scores: (number | null)[] = me.scores || [];
      const entered = scores.filter((s) => s != null && s > 0).length;
      if (entered === 0) return; // didn't play / nothing entered

      const gross = scores.reduce((s: number, v) => s + (v && v > 0 ? v : 0), 0);
      const roundFields = {
        user_id: me.user_id,
        course: game.course,
        tee_name: me.tee_name ?? null,
        rating: me.rating ?? null,
        slope: me.slope ?? null,
        course_par: game.course_par ?? null,
        handicap_index: me.handicap_index ?? null,
        course_handicap: me.course_handicap ?? null,
        group_id: (game as any).group_id || null,
        played_at: (game as any).played_at || (game as any).created_at || new Date().toISOString(),
        status: "final" as const,
        gross_score: gross,
        game_id: game.id,
      };

      // If a round was already posted for this game (e.g. the game was ended,
      // reopened, edited, and re-ended), UPDATE it in place so the corrected
      // scores flow through to the player's history, differentials, and dashboard
      // stats — rather than leaving a stale frozen round.
      const { data: existing } = await supabase
        .from("rounds").select("id").eq("game_id", game.id).eq("user_id", me.user_id).limit(1);

      let roundId: string | null = existing && existing.length ? existing[0].id : null;
      if (roundId) {
        const { error: uErr } = await supabase.from("rounds").update(roundFields).eq("id", roundId);
        if (uErr) return;
        // Replace the hole detail so edits, additions, and removals all take.
        await supabase.from("holes").delete().eq("round_id", roundId);
      } else {
        const { data: roundRow, error: rErr } = await supabase.from("rounds").insert(roundFields).select("id").single();
        if (rErr || !roundRow) return;
        roundId = roundRow.id;
      }

      const holeRows = (game.holes_meta || []).map((m, i) => ({
        round_id: roundId,
        hole_number: m.n,
        par: m.par,
        stroke_index: m.si,
        strokes: scores[i] ?? null,
        putts: me.putts?.[i] ?? null,
        fairway: me.fairways?.[i] ?? null,
        penalties: me.penalties?.[i] ?? null,
        sand: me.sand?.[i] ?? false,
        yardage: courseTees.find((t) => t.name === me.tee_name)?.yardages?.[i] ?? m.yards ?? null,
      })).filter((h) => h.strokes != null);
      if (holeRows.length) await supabase.from("holes").insert(holeRows);
    } catch {
      // Non-fatal.
    }
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
    if (!game) return;
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
    await logActivity(supabase, { actor_id: user.id, actor_name: (user.email || "Someone"), action: "game_deleted", group_id: (game as any).group_id || null, summary: `Deleted the game "${game.name}"${sameDay ? " (and its posted rounds)" : ""}` });
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
  const ouVal = (p: Player) => (playerThru(p) === 0 ? Infinity : 2 * playerThru(p) - playerPoints(p));
  const isStroke = game.game_type === "stroke";
  const strokeNet = game.stroke_basis !== "gross"; // default to net
  const strokeTot = (p: Player) => (strokeNet ? playerNet(p) : playerGross(p));
  const rankVal = (p: Player) => (isStroke ? (playerThru(p) === 0 ? Infinity : strokeTot(p)) : ouVal(p));
  const leaderboard = [...players].sort((a, b) => {
    const d = rankVal(a) - rankVal(b);
    if (d !== 0) return d;
    return isStroke ? 0 : playerPoints(b) - playerPoints(a);
  });

  // Segment winners (three sixes). While a six is IN PROGRESS the "leader" is whoever is
  // most under par for the holes they've actually played (pace) — matching the main
  // leaderboard — so a shorter-but-deeper card can lead a longer-but-flatter one, and the
  // lead legitimately flip-flops as holes come in. Once every bettor has all six holes in,
  // everyone's on the same par pace, so this collapses to simply who won the six.
  // The card still DISPLAYS raw points/net · thru the leader's holes (over/under is easy to read off that).
  const segLabels = ["Holes 1–6", "Holes 7–12", "Holes 13–18"];
  const segOf = (p: Player) => (isStroke ? netBySix(playerHoles(p)) : stablefordBySix(playerHoles(p)));
  const segTotals = players.map((p) => ({ p, seg: segOf(p) }));
  const segLeadersFrom = (rows: { p: Player; seg: [number, number, number] }[]) =>
    [0, 1, 2].map((si) => {
      let bestPace = isStroke ? Infinity : -Infinity; // stroke: fewest strokes vs par (lower=better); stableford: most pts vs par-pace (higher=better)
      let who: string[] = [];
      let leaderRaw: number | null = null; // the leader's raw points (stableford) / net strokes (stroke), for display
      let leaderPlayed = 0;               // the leader's holes played in this six, for the "thru" display
      let started = false, maxPlayed = 0, allDone = true, anyActive = false;
      rows.forEach(({ p, seg }) => {
        const hs = playerHoles(p);
        if (!hs.some((h) => h.strokes)) return;
        anyActive = true;
        const segHoles = hs.slice(si * 6, si * 6 + 6);
        const played = segHoles.filter((h) => h.strokes).length;
        if (played < 6) allDone = false;
        if (played > 0) started = true;
        maxPlayed = Math.max(maxPlayed, played);
        if (played < 1) return;
        if (isStroke) {
          const parPlayed = segHoles.reduce((s, h) => s + (h.strokes && h.strokes > 0 ? (h.par || 0) : 0), 0);
          const pace = seg[si] - parPlayed; // net strokes relative to par of holes played; lower = more under
          if (pace < bestPace) { bestPace = pace; who = [p.display_name]; leaderRaw = seg[si]; leaderPlayed = played; }
          else if (pace === bestPace) { who.push(p.display_name); leaderPlayed = Math.max(leaderPlayed, played); }
        } else {
          const pace = seg[si] - 2 * played; // stableford points relative to par pace (2/hole); higher = more under
          if (pace > bestPace) { bestPace = pace; who = [p.display_name]; leaderRaw = seg[si]; leaderPlayed = played; }
          else if (pace === bestPace) { who.push(p.display_name); leaderPlayed = Math.max(leaderPlayed, played); }
        }
      });
      const complete = anyActive && allDone && started;
      const thruHole = si * 6 + maxPlayed;       // deepest player — kept for the clean-sweep "holes remaining" math
      const leaderThru = si * 6 + leaderPlayed;  // the leader's own progress — what the card shows
      return { label: segLabels[si], complete, started, val: started ? leaderRaw : null, who, thruHole, leaderThru, maxPlayed };
    });
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
          <div style={{ color: C.sage, fontSize: 10, letterSpacing: 2 }}>
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
          <button onClick={() => setRoomTab("setup")}
            style={{ ...btn(roomTab === "setup"), flex: 1, fontSize: 14 }}>
            ⚙ Game setup
          </button>
        )}
      </div>

      {roomTab === "play" && cleanSweepDone && (game as any)?.group_id === TGC_GROUP_ID && (game.game_type === "stableford" || game.game_type === "stroke") && (
        <SweepAchievedBanner name={cleanSweepDone.name} />
      )}
      {roomTab === "play" && !cleanSweepDone && sweepWatch && (game as any)?.group_id === TGC_GROUP_ID && (game.game_type === "stableford" || game.game_type === "stroke") && (
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
          <button style={{ ...btn(true), marginTop: 12 }} onClick={() => setRoomTab("setup")}>Open setup</button>
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
        // Gate setup steps by the CURRENT format (via shapeOf). Stale teams/foursomes
        // from a previous format are ignored without being deleted — switching back
        // restores the work.
        const { usesTeams, usesMatchups, usesFoursomes } = shapeOf(game);
        const steps: { key: "players" | "teams" | "matchups" | "groups"; label: string }[] = [
          { key: "players", label: "Players" },
          ...(usesTeams ? [{ key: "teams" as const, label: "Teams" }] : []),
          ...(usesMatchups ? [{ key: "matchups" as const, label: "Matchups" }] : []),
          ...(!usesFoursomes ? [{ key: "groups" as const, label: "Groups" }] : []),
        ];
        const activeStep = steps.some((s) => s.key === setupTab) ? setupTab : "players";
        const panelProps = {
          game, players, user,
          onOverride: overridePlayerHandicap, courseTees, onSetTee: setPlayerTee,
          onRemove: removePlayer, onToggleNoShow: toggleNoShow, onSetTeam: setPlayerTeam,
          onSetTeeGroup: setPlayerTeeGroup, onRename: renameGame, onDelete: deleteGame,
          onEnd: requestEndGame, onReopen: reopenGame, onReset: resetScores, onShare: setShare,
          eligibleMembers, onAddMember: addMemberToGame, onAddGuest: addGuestToGame,
          onSetAllowance: setAllowance, onSetFormat: setFormat, onSetTeamScoreMode: setTeamScoreMode, onSetSkinsMode: updateSkinsMode, onSetSkinsStyle: setSkinsStyle, onSetMatchTeam: setMatchTeam, anyScores,
        };
        // --- per-step completion drives the stepper status + the "what's next" line ---
        const total = players.length;
        const pairings = Array.isArray(game.pairings) ? game.pairings : [];
        const foursomes = Array.isArray(game.foursomes) ? game.foursomes : [];
        const placedKeys = new Set<string>([
          ...pairings.flatMap((pr) => [pr.a, pr.b]),
          ...foursomes.flatMap((f) => [...f.a, ...f.b]),
        ]);
        const cWithHcp = players.filter((p) => p.course_handicap != null).length;
        const cWithTeam = players.filter((p) => p.team).length;
        const cPlaced = players.filter((p) => placedKeys.has(pkey(p))).length;
        const cGrouped = players.filter((p) => p.tee_group != null).length;
        const stepDone = (key: string) =>
          total > 0 && (
            key === "players" ? cWithHcp === total
            : key === "teams" ? cWithTeam === total
            : key === "matchups" ? cPlaced === total
            : key === "groups" ? cGrouped === total
            : false);
        const allDone = steps.every((s) => stepDone(s.key));
        const isStableford = game.game_type === "stableford" || game.game_type === "stroke";
        const hint = (() => {
          if (activeStep === "players")
            return isStableford
              ? "Add players, or share the code so they can join anytime — even across tee times. Stableford rolls everyone into one leaderboard."
              : "Add everyone here before matchups — players don't have to join themselves (you can still share the code so they self-score).";
          if (activeStep === "teams")
            return cWithTeam < total ? "Tap a team on each player. Both teams need players before matchups." : "Teams set — next, build the matchups.";
          if (activeStep === "matchups") {
            if (usesTeams && cWithTeam === 0) return "Assign players to teams first — open the Teams step, then come back.";
            return usesFoursomes
              ? "Build each foursome — it doubles as its own tee group, so one person can keep that foursome's card on the course."
              : "Set who plays whom, then group the matches that tee off together on the next step.";
          }
          if (usesMatchups && pairings.length === 0 && foursomes.length === 0)
            return "Build the matchups first, then group the ones that tee off together here.";
          return isStableford
            ? "Split players into the groups that tee off together so one person can keep each group's card."
            : "Group the matches that tee off together — usually two per foursome.";
        })();

        return (
          <div style={{ marginTop: 16 }}>
            {/* Stepper: navigation and progress in one control */}
            <div style={{ display: "flex", alignItems: "center" }}>
              {steps.map((s, i) => {
                const done = stepDone(s.key);
                const active = activeStep === s.key;
                return (
                  <div key={s.key} style={{ flex: 1, display: "flex", alignItems: "center" }}>
                    {i > 0 && <div style={{ flex: "0 0 12px", height: 1, background: "rgba(255,255,255,0.18)" }} />}
                    <button onClick={() => setSetupTab(s.key)} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "center" }}>
                      <div style={{
                        width: active ? 30 : 26, height: active ? 30 : 26, lineHeight: active ? "30px" : "26px",
                        margin: "0 auto", borderRadius: 999, fontWeight: 800, fontSize: 13,
                        background: done ? "#5BD08A" : active ? C.gold : "transparent",
                        color: done ? "#0E241B" : active ? "#23303A" : C.sage,
                        border: done || active ? "none" : "1px solid rgba(255,255,255,0.25)",
                        boxShadow: active ? "0 0 0 3px rgba(216,178,74,0.25)" : "none",
                      }}>{done ? "✓" : i + 1}</div>
                      <div style={{ color: active ? C.cream : C.sage, fontSize: 10, marginTop: 3, fontWeight: active ? 700 : 400 }}>{s.label}</div>
                    </button>
                  </div>
                );
              })}
            </div>
            <div style={{ background: allDone ? C.green : "#16302A", borderRadius: 8, padding: "9px 11px", marginTop: 12, color: allDone ? C.cream : C.gold, fontSize: 12, lineHeight: 1.45 }}>
              {allDone ? "✓ Everyone's set — switch to Scorecard to start the round." : hint}
            </div>

            {activeStep === "players" && <OrganizerPanel section="players" {...panelProps} />}
            {activeStep === "teams" && <OrganizerPanel section="teams" {...panelProps} />}
            {activeStep === "groups" && (
              <GroupsBuilder game={game} players={players} onSetTeeGroup={setPlayerTeeGroup}
                onRandomize={randomizeGroups} canRandomize={canRandomize} randomizeReason={randomizeReason}
                randomizing={randomizing} overflowIds={groupOverflow} />
            )}
          </div>
        );
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

      {roomTab === "setup" && isOrganizer && !isEnded && (game.game_type === "match" || game.game_type === "fourball" || game.game_type === "trifecta") && (
        <LegConfigEditor game={game} onSave={setLegConfig} />
      )}

      {roomTab === "setup" && isOrganizer && game.game_type === "trifecta" && !isEnded && (
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
        const endMs = allEnded ? Math.max(...ends.map((s) => new Date(s).getTime())) : Date.now();
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
                    <span style={{ width: 7, height: 7, borderRadius: 99, background: "#5BD08A", display: "block" }} />On pace
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
            <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, color: C.ink, borderRadius: 16, padding: 20, maxWidth: 460, width: "100%", maxHeight: "85vh", overflowY: "auto" }}>
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
              <button onClick={requestEndGame} style={{ ...btn(!canFinishGroup), flex: 1, minWidth: 180, fontSize: 13, padding: "10px 0", background: canFinishGroup ? "#5A1E1E" : undefined, color: canFinishGroup ? "#fff" : undefined }}>
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
            {leaderboard.map((p) => {
              const pts = playerPoints(p);
              const thru = playerThru(p);
              const mineOu = rankVal(p);
              const pos = leaderboard.filter((x) => rankVal(x) < mineOu).length + 1;
              const tied = leaderboard.filter((x) => rankVal(x) === mineOu).length > 1;
              return (
                <div key={p.id} style={{
                  background: p.user_id === user.id ? C.cream : C.card,
                  borderRadius: 12, padding: "10px 16px", marginTop: 8,
                  display: "flex", alignItems: "center",
                }}>
                  <div style={{ color: C.gold, fontFamily: "Georgia, serif", fontWeight: 700, width: 20, fontSize: 15 }}>
                    {tied ? "T" : ""}{pos}
                  </div>
                  <Avatar src={p.avatar_url} name={p.display_name} size={32} />
                  <div style={{ flex: 1, minWidth: 0, marginLeft: 8 }}>
                    <div style={{ color: C.ink, fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {leaderName(p.display_name)}{p.user_id === user.id ? " (you)" : ""}
                    </div>
                    <div style={{ color: C.faint, fontSize: 11 }}>
                      {p.course_handicap != null ? `CH ${p.course_handicap}` : "no hcp"}
                      {p.bets === false ? <span style={{ color: C.gold, fontWeight: 800 }}> · no bet</span> : ""}
                    </div>
                  </div>
                  {isStroke ? (() => {
                    const relV = (strokeNet ? playerNet(p) : playerGross(p)) - parThru(p);
                    const relS = !thru ? "–" : relV === 0 ? "E" : relV > 0 ? `+${relV}` : `${relV}`;
                    const relCol = !thru ? C.faint : relV < 0 ? "#1F8F54" : relV > 0 ? C.birdie : "#6B6857";
                    return (<>
                      <div style={{ width: 40, textAlign: "center", color: C.ink, fontWeight: 700, fontSize: 15 }}>{thru || "–"}</div>
                      <div style={{ width: 48, textAlign: "center", color: C.ink, fontWeight: strokeNet ? 700 : 800, fontSize: strokeNet ? 15 : 18, fontFamily: strokeNet ? undefined : "Georgia, serif" }}>{thru ? playerGross(p) : "–"}</div>
                      <div style={{ width: 48, textAlign: "center", color: relCol, fontWeight: 800, fontSize: 16, fontFamily: "Georgia, serif" }}>{relS}</div>
                      <div style={{ width: 50, textAlign: "center", color: strokeNet ? C.green : C.ink, fontWeight: strokeNet ? 800 : 700, fontSize: strokeNet ? 19 : 15, fontFamily: strokeNet ? "Georgia, serif" : undefined }}>{thru ? playerNet(p) : "–"}</div>
                    </>);
                  })() : (<>
                    <div style={{ width: 44, textAlign: "center", color: C.ink, fontWeight: 700, fontSize: 15 }}>{thru || "–"}</div>
                    <div style={{ width: 48, textAlign: "center", color: C.ink, fontWeight: 700, fontSize: 15 }}>{thru ? playerGross(p) : "–"}</div>
                    {(() => {
                      if (!thru) return <div style={{ width: 44, textAlign: "center", color: C.faint, fontWeight: 700, fontSize: 16, fontFamily: "Georgia, serif" }}>–</div>;
                      const rel = 2 * thru - pts;
                      const col = rel < 0 ? "#1F8F54" : rel > 0 ? C.birdie : "#6B6857";
                      return <div style={{ width: 44, textAlign: "center", color: col, fontWeight: 800, fontSize: 16, fontFamily: "Georgia, serif" }}>{relToParStr(p)}</div>;
                    })()}
                    <div style={{ width: 40, textAlign: "center", color: C.green, fontWeight: 800, fontSize: 19, fontFamily: "Georgia, serif" }}>{pts}</div>
                  </>)}
                </div>
              );
            })}
            <div style={{ color: C.sage, fontSize: 10, marginTop: 8 }}>
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
                    <div style={{ color: C.faint, fontSize: 13, marginTop: 6 }}>
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
                        <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: C.green, background: C.sage, borderRadius: 5, padding: "1px 6px", verticalAlign: "middle" }}>
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

          {(game as any)?.group_id === TGC_GROUP_ID && (
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
            showSixes={(game as any).group_id === TGC_GROUP_ID}
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
  const totalPutts = withPutts.reduce((s, h) => s + (h.putts || 0), 0);
  const girHit = withPutts.filter(
    (h) => h.strokes != null && h.strokes - (h.putts || 0) <= h.par - 2,
  ).length;
  const fwHoles = holes.filter((h) => h.par >= 4 && h.fairway != null);
  const fwHit = fwHoles.filter((h) => h.fairway === "hit").length;
  const fwLeft = fwHoles.filter((h) => h.fairway === "left").length;
  const fwRight = fwHoles.filter((h) => h.fairway === "right").length;
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
function GroupScorecard({ game, players, user, isMarker, markerName, onTakeOver, onRelease, onSetHole, teeMode = false, groupLabel = "", canClaim = false, onClaimGroup, onReleaseGroup, groupLocked = false, onMarkOut, courseTees = [], offline = false }: {
  game: Game; players: Player[]; user: any;
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
  const allowance = game.allowance_pct ?? 100;
  const meta = game.holes_meta;
  const GREEN = "#1B7A4B", BLUE = "#1E5B8A", RED = "#C0392B";
  // Net-vs-par color: under green, level blue, over red.
  const netColor = (gross: number | null, recv: number, par: number) => {
    if (gross == null || gross <= 0) return "#8B8775";
    const net = gross - recv;
    return net < par ? GREEN : net === par ? BLUE : RED;
  };
  const recvFor = (p: Player, si: number | null) => dotStrokes(game, p, si, players);
  // Individual (full playing handicap) strokes for the low-net / Stableford side game.
  // Only meaningful when the game uses a relative basis (match/four-ball/trifecta) — on
  // stableford/stroke the orange dots already ARE the full-handicap strokes, so we don't
  // draw a duplicate blue set.
  const relBasis = shapeOf(game).dotBasis !== "absolute";
  const indRecvFor = (p: Player, si: number | null) => fullStrokes(game, p, si);

  // Column order + colour. Stableford: alphabetical. Team match: each pairing's
  // two players adjacent, with a divider between matches. Foursome formats: Pair A
  // then Pair B. Column underline uses the real team colour when teams exist.
  type Col = { type: "player"; p: Player } | { type: "divider" };
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
    return idx % 2 === 0 ? "#5B8DEF" : "#C9A227";
  };
  const colTmpl = `58px ${cols.map((c) => (c.type === "divider" ? "10px" : "minmax(58px, 1fr)")).join(" ")}`;
  const cell: React.CSSProperties = { position: "relative", background: "#FBFAF4", borderRadius: 5, height: 42, display: "flex", alignItems: "center", justifyContent: "center" };
  const agg: React.CSSProperties = { position: "relative", background: C.greenLight, borderRadius: 5, height: 30, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 15, fontWeight: 800 };

  const sums = (p: Player, from: number, to: number) => {
    let g = 0, mPts = 0, cPts = 0;
    for (let i = from; i <= to && i < meta.length; i++) {
      const gross = p.scores?.[i] ?? null;
      if (gross != null && gross > 0) {
        g += gross;
        mPts += stablefordPts(gross, meta[i].par, recvFor(p, meta[i].si)) || 0;          // match handicap
        cPts += relBasis ? (stablefordPts(gross, meta[i].par, indRecvFor(p, meta[i].si)) || 0) : 0; // course handicap
      }
    }
    return { g, mPts, cPts };
  };

  const holeCard = (i: number) => {
    const m = meta[i];
    return (
      <div key={`hc${i}`} style={{ background: "#13352A", border: "1px solid #2E6B55", borderRadius: 10, padding: 8, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ color: C.cream, fontSize: 18, fontWeight: 800, lineHeight: 1 }}>Hole {m.n}</span>
          <span style={{ color: "#CFE3D8", fontSize: 13 }}>Par <b style={{ color: C.cream }}>{m.par}</b>{(() => { const y = ydsAt(i, m.yards); return y ? <> · <b style={{ color: C.cream }}>{y}</b> yds</> : null; })()} · SI <b style={{ color: C.cream }}>{m.si ?? "–"}</b></span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {cols.map((c, ci) => {
            if (c.type === "divider") return <div key={`hd${i}-${ci}`} style={{ width: 2, alignSelf: "stretch", background: "rgba(216,178,74,0.5)", borderRadius: 2, margin: "16px 1px 0" }} />;
            const p = c.p;
            const gross = p.scores?.[i] ?? null;
            const recv = recvFor(p, m.si);
            const indRecv = relBasis ? indRecvFor(p, m.si) : 0;
            const oPts = stablefordPts(gross, m.par, recv);                    // orange = match handicap
            const bPts = relBasis ? stablefordPts(gross, m.par, indRecv) : null; // blue = course handicap
            return (
              <div key={p.id + i} style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: colorFor(p), fontSize: 10, fontWeight: 700, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 3 }}>{p.display_name}</div>
                <div
                  style={{ position: "relative", background: "#FBFAF4", borderRadius: 7, height: 56, display: "flex", alignItems: "center", justifyContent: "center", cursor: (isMarker || p.user_id === user?.id) ? "pointer" : "default", outline: isMarker ? "1px solid #E6E0CC" : (p.user_id === user?.id ? "1px dashed #C9BF9B" : "none") }}
                  onClick={(isMarker || p.user_id === user?.id) ? () => { if (isMarker && (gross == null || gross <= 0)) onSetHole(p.id, i, { strokes: m.par }); setEdit({ playerId: p.id, holeIdx: i }); } : undefined}>
                  {recv > 0 && (
                    <div style={{ position: "absolute", top: 4, left: 5, display: "flex", gap: 2 }}>
                      {Array.from({ length: Math.min(recv, 2) }).map((_, d) => (
                        <span key={d} style={{ width: 6, height: 6, borderRadius: 99, background: "#E8730C", display: "block" }} />
                      ))}
                    </div>
                  )}
                  {indRecv > 0 && (
                    <div style={{ position: "absolute", bottom: 4, left: 5, display: "flex", gap: 2 }}>
                      {Array.from({ length: Math.min(indRecv, 2) }).map((_, d) => (
                        <span key={d} style={{ width: 6, height: 6, borderRadius: 99, background: C.indivDot, display: "block" }} />
                      ))}
                    </div>
                  )}
                  <span style={{ fontSize: 26, fontWeight: 800, color: netColor(gross, recv, m.par) }}>{gross != null && gross > 0 ? gross : "·"}</span>
                  {gross != null && gross > 0 && (relBasis ? (
                    <>
                      <span style={{ position: "absolute", top: 3, right: 3, minWidth: 16, height: 16, padding: "0 2px", border: "1.5px solid #E8730C", borderRadius: 5, background: "#FBEEE2", color: "#E8730C", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{oPts ?? 0}</span>
                      <span style={{ position: "absolute", bottom: 3, right: 3, minWidth: 16, height: 16, padding: "0 2px", border: `1.5px solid ${C.indivDot}`, borderRadius: 5, background: "#EAF3FB", color: "#1E5B8A", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{bPts ?? 0}</span>
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
          if (c.type === "divider") return <div key={`sd${label}-${ci}`} style={{ width: 2, alignSelf: "stretch", background: "rgba(216,178,74,0.5)", borderRadius: 2, margin: "0 1px" }} />;
          const p = c.p;
          const s = sums(p, from, to);
          return (
            <div key={p.id + label} style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
              <div style={{ position: "relative", background: C.greenLight, borderRadius: 7, height: 44, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
                <span style={{ fontSize: 20, fontWeight: 800 }}>{s.g || "–"}</span>
                {s.g > 0 && (relBasis ? (
                  <>
                    <span style={{ position: "absolute", top: 3, right: 3, minWidth: 15, height: 15, padding: "0 2px", border: "1.5px solid #E8730C", borderRadius: 5, color: "#F0A45E", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{s.mPts}</span>
                    <span style={{ position: "absolute", bottom: 3, right: 3, minWidth: 15, height: 15, padding: "0 2px", border: `1.5px solid ${C.indivDot}`, borderRadius: 5, color: C.indivDot, fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{s.cPts}</span>
                  </>
                ) : (
                  <span style={{ position: "absolute", bottom: 3, right: 4, background: C.green, color: "#E4CF86", fontSize: 10, fontWeight: 800, padding: "0 5px", borderRadius: 6 }}>{s.mPts}</span>
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
            <span style={{ width: 9, height: 9, borderRadius: 99, background: "#5BD08A", boxShadow: "0 0 0 3px rgba(91,208,138,0.25)" }} />
            <span style={{ color: "#CFE3D8", fontSize: 12, flex: 1 }}>{groupLabel} · <strong style={{ color: C.cream }}>{markerName}</strong> is keeping score</span>
            {canClaim && onClaimGroup && <button onClick={() => { if (confirm(`Take over scoring for ${groupLabel} from ${markerName}?`)) onClaimGroup(); }} style={{ ...btn(false), fontSize: 11, padding: "5px 10px" }}>Take over</button>}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#13352A", border: "0.5px solid #2E6B55", borderRadius: 10, padding: "8px 12px", marginBottom: 8 }}>
            <span style={{ color: C.sage, fontSize: 12, flex: 1 }}>No one is keeping score for {groupLabel} yet.</span>
            {canClaim && onClaimGroup
              ? <button onClick={onClaimGroup} style={{ ...btn(true), fontSize: 11, padding: "5px 10px" }}>Keep score for this group</button>
              : <span style={{ color: C.faint, fontSize: 11 }}>view only</span>}
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
          <span style={{ width: 9, height: 9, borderRadius: 99, background: "#5BD08A", boxShadow: "0 0 0 3px rgba(91,208,138,0.25)" }} />
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
        <span style={{ color: "#7FD0A0", fontSize: 10 }}>● under</span>
        <span style={{ color: "#6FA8DC", fontSize: 10 }}>● par</span>
        <span style={{ color: "#E0796B", fontSize: 10 }}>● over (net)</span>
        {relBasis
          ? <>
              <span style={{ color: "#E8730C", fontSize: 10 }}>● ▢ match hcp</span>
              <span style={{ color: C.indivDot, fontSize: 10 }}>● ▢ course hcp</span>
              <span style={{ color: C.faint, fontSize: 10 }}>dots = strokes · box = net Stableford</span>
            </>
          : <span style={{ color: "#E8730C", fontSize: 10 }}>● gets a stroke · corner = Stableford</span>}
      </div>
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: C.green, paddingTop: 8, paddingBottom: 10, marginBottom: 4, boxShadow: "0 6px 10px -8px rgba(0,0,0,0.55)" }}>
        {(() => {
          const starts = players.map((p) => p.clock_start).filter(Boolean) as string[];
          if (!starts.length) return null;
          const startMs = Math.min(...starts.map((s) => new Date(s).getTime()));
          const ends = players.map((p) => p.clock_end).filter(Boolean) as string[];
          const allEnded = players.length > 0 && ends.length === players.length;
          const endMs = allEnded ? Math.max(...ends.map((s) => new Date(s).getTime())) : Date.now();
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
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(91,208,138,0.15)", color: "#7FD0A0", border: "1px solid rgba(91,208,138,0.4)", borderRadius: 999, padding: "2px 9px", fontSize: 10, fontWeight: 700 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 99, background: "#5BD08A", display: "block" }} />On pace
                </span>
              ) : (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(216,178,74,0.16)", color: "#E4CF86", border: "1px solid rgba(216,178,74,0.5)", borderRadius: 999, padding: "2px 9px", fontSize: 10, fontWeight: 700 }}>
                  ⚑ ~{behind} min behind
                </span>
              ))}
            </div>
          );
        })()}
        <div style={{ display: "flex", gap: 6 }}>
          {cols.map((c, ci) => {
            if (c.type === "divider") return <div key={`lg${ci}`} style={{ width: 2, alignSelf: "stretch", background: "rgba(216,178,74,0.5)", borderRadius: 2, margin: "0 1px" }} />;
            const p = c.p;
            return (
              <div key={p.id} style={{ flex: 1, minWidth: 0, textAlign: "center", padding: "4px 2px", borderBottom: `2px solid ${colorFor(p)}` }}>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 3 }}>
                  <Avatar src={p.avatar_url} name={p.display_name} cssSize="min(54px, 90%)" accent={colorFor(p)} />
                </div>
                <div style={{ color: C.cream, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {p.display_name}{p.is_guest ? " ·G" : ""}
                </div>
                {(() => {
                  const matchHcp = meta.reduce((a, m) => a + recvFor(p, m.si), 0);
                  const courseHcp = meta.reduce((a, m) => a + indRecvFor(p, m.si), 0);
                  if (!relBasis) return <div style={{ color: C.sage, fontSize: 10 }}>hcp {matchHcp}</div>;
                  const line = (color: string, label: string, val: number) => (
                    <div style={{ color: C.sage, fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 3, whiteSpace: "nowrap" }}>
                      <span style={{ width: 5, height: 5, borderRadius: 99, background: color, display: "inline-block", flex: "none" }} />{label} {val}
                    </div>
                  );
                  return <>{line("#E8730C", "match hcp", matchHcp)}{line(C.indivDot, "course hcp", courseHcp)}</>;
                })()}
                {p.tee_name && <div style={{ color: C.sage, fontSize: 10, opacity: 0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.tee_name}</div>}
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
        const gross = p.scores?.[edit.holeIdx] ?? null;
        const putts = p.putts?.[edit.holeIdx] ?? null;
        const fw = p.fairways?.[edit.holeIdx] ?? null;
        const penN = p.penalties?.[edit.holeIdx] || 0;
        const sandOn = !!p.sand?.[edit.holeIdx];
        const recv = recvFor(p, m.si);
        const order = playerOrder;
        const scoreLocked = !isMarker && !!p.user_id && p.user_id === user?.id; // non-marker editing my own row → stats only
        const goNext = () => {
          // Save the player we're leaving (default to par if untouched).
          const curG = p.scores?.[edit.holeIdx] ?? null;
          if (curG == null || curG <= 0) onSetHole(p.id, edit.holeIdx, { strokes: m.par });
          // Move to the next player on THIS hole who still needs a score (wrap around the
          // row, skip no-shows). When everyone on the hole is scored, the card closes.
          const needs = (pl: Player) => !pl.no_show && pl.id !== edit.playerId && ((pl.scores?.[edit.holeIdx] ?? null) == null || (pl.scores?.[edit.holeIdx] ?? 0) <= 0);
          const idx = order.findIndex((x) => x.id === edit.playerId);
          for (let k = 1; k <= order.length; k++) {
            const cand = order[(idx + k) % order.length];
            if (needs(cand)) {
              onSetHole(cand.id, edit.holeIdx, { strokes: m.par });
              setEdit({ playerId: cand.id, holeIdx: edit.holeIdx });
              return;
            }
          }
          setEdit(null); // whole row scored — card disappears
        };
        return (
          <HoleScoreModal
            title={`${p.display_name} · Hole ${m.n}`}
            par={m.par}
            si={m.si ?? null}
            yardage={ydsAt(edit.holeIdx, m.yards)}
            strokes={gross}
            putts={putts}
            fairway={fw}
            penalties={penN}
            sand={sandOn}
            recv={recv}
            showFairway
            showPutts
            showPenalties
            scoreLocked={scoreLocked}
            lockedByName={markerName}
            onPatch={(patch) => { if (scoreLocked) { const { strokes: _s, ...statsOnly } = patch; onSetHole(p.id, edit.holeIdx, statsOnly); } else { onSetHole(p.id, edit.holeIdx, patch); } }}
            onNext={scoreLocked ? () => { const ni = edit.holeIdx + 1; if (ni < meta.length) setEdit({ playerId: p.id, holeIdx: ni }); else setEdit(null); } : goNext}
            onClose={() => setEdit(null)}
          />
        );
      })()}
      {isMarker && onMarkOut && !groupLocked && (
        <div style={{ marginTop: 14, borderTop: `0.5px solid ${C.line}`, paddingTop: 12 }}>
          <div style={{ color: C.sage, fontSize: 11, marginBottom: 7 }}>Someone leave early? Tap to mark them out. The holes they've played still count; {(game.game_type === "fourball" || game.game_type === "trifecta") ? "the holes they didn't play score net double bogey for their team" : game.game_type === "match" ? "the match stands on the holes already played" : "their unplayed holes score nothing"}.</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {players.map((p) => (
              <button key={p.id} onClick={() => onMarkOut(p)}
                style={{ border: `1px solid ${p.no_show ? "#E08A5B" : C.line}`, background: p.no_show ? "#5A2E22" : "transparent", color: p.no_show ? "#F2B894" : C.sage, borderRadius: 999, padding: "6px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
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
function ScoreHistory({ gameId }: { gameId: string }) {
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
            <div style={{ color: C.faint, fontSize: 13, lineHeight: 1.5 }}>No changes recorded yet. Edits are logged from when migration 0042 is applied onward.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
              {rows.map((r) => (
                <div key={r.id} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12.5, color: C.cream, borderBottom: `1px solid ${C.green}`, paddingBottom: 4 }}>
                  <span style={{ color: C.gold, fontWeight: 700, minWidth: 64, whiteSpace: "nowrap" }}>H{r.hole_index + 1} {fieldLabel[r.field] || r.field}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>{r.player_name}: <b>{fmtVal(r.old_value)} → {fmtVal(r.new_value)}</b></span>
                  <span style={{ color: C.faint, fontSize: 11, whiteSpace: "nowrap" }}>{r.changed_by_name} · {fmtWhen(r.changed_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SkinsView({ game, players, user, isCreator, mode, onChanged }: { game: Game; players: Player[]; user: any; isCreator: boolean; mode: string; onChanged: () => void }) {
  const teams = game.teams || null;
  const shape = shapeOf(game);
  const isTeamSkins = shape.skinsStyle === "team_11" || shape.skinsStyle === "team_2v2";
  const isTeamBestBallSkins = shape.skinsStyle === "team_2v2";
  const playerOf = (uid: string) => players.find((p) => pkey(p) === uid) || null;
  const firstName = (uid: string) => (playerOf(uid)?.display_name || "—").split(" ")[0];
  const teamName = (key: string | null | undefined) => teams?.find((t) => t.key === key)?.name || "—";
  const skinPlayerOf = (uid: string): SkinPlayer | null => {
    const p = playerOf(uid);
    return p ? { id: pkey(p), name: p.display_name, gross: p.scores || [], ch: chBasis(p, game.course_par), noShow: !!p.no_show } : null;
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
        return { id: uid, gross: p?.scores || [], ch: p ? chBasis(p, game.course_par) : null, noShow: !!p?.no_show };
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
          <div style={{ flex: 1, background: totalA >= totalB ? C.cream : C.card, borderRadius: 12, padding: 14, textAlign: "center" }}>
            <div style={{ color: C.ink, fontWeight: 800 }}>{teams![0].name}</div>
            <div style={{ color: C.green, fontSize: 32, fontWeight: 900, fontFamily: "Georgia, serif" }}>{fmtSkins(totalA)}</div>
          </div>
          <div style={{ flex: 1, background: totalB >= totalA ? C.cream : C.card, borderRadius: 12, padding: 14, textAlign: "center" }}>
            <div style={{ color: C.ink, fontWeight: 800 }}>{teams![1].name}</div>
            <div style={{ color: C.green, fontSize: 32, fontWeight: 900, fontFamily: "Georgia, serif" }}>{fmtSkins(totalB)}</div>
          </div>
        </div>

        {cards.length === 0 && <div style={{ background: C.greenLight, borderRadius: 12, padding: 18, marginTop: 12, color: C.sage }}>No team skins foursomes set yet. Open Game setup to build them.</div>}
        {cards.map(({ f, result }) => {
          const mine = f.a.includes(myKey) || f.b.includes(myKey);
          const aNames = f.a.map(firstName).join(" & ") || "Pair 1";
          const bNames = f.b.map(firstName).join(" & ") || "Pair 2";
          const halved = game.skins_mode === "split";
          return (
            <div key={f.id} style={{ background: C.card, borderRadius: 12, padding: 14, marginTop: 12, border: mine ? `1px solid ${C.gold}` : "none" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <div style={{ color: C.ink, fontWeight: 800, fontSize: 15 }}>{f.name}{mine ? " · your match" : ""}</div>
                <div style={{ flex: 1 }} />
                <div style={{ color: C.green, fontWeight: 900, fontFamily: "Georgia, serif" }}>{fmtSkins(result.skinsBySide.a || 0)}–{fmtSkins(result.skinsBySide.b || 0)}</div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <div style={{ flex: 1, background: C.greenLight, borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ color: C.gold, fontSize: 10, fontWeight: 800 }}>PAIR 1</div>
                  <div style={{ color: C.cream, fontSize: 13 }}>{f.a.map(firstName).join(" & ") || "—"}</div>
                </div>
                <div style={{ flex: 1, background: C.greenLight, borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ color: C.gold, fontSize: 10, fontWeight: 800 }}>PAIR 2</div>
                  <div style={{ color: C.cream, fontSize: 13 }}>{f.b.map(firstName).join(" & ") || "—"}</div>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                {result.holes.map((h) => {
                  const tiedCarry = h.decided && !h.winnerId;
                  const won = h.decided && h.winnerId;
                  const winnerLabel = h.winnerId === "a" ? aNames : h.winnerId === "b" ? bNames : "";
                  return (
                    <div key={h.hole} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: `1px solid ${C.line}` }}>
                      <span style={{ width: 24, color: C.faint, fontWeight: 800, fontSize: 12 }}>{h.hole}</span>
                      <span style={{ flex: 1, color: C.ink, fontSize: 12 }}>{won ? `${winnerLabel} wins` : tiedCarry ? (halved ? "Halved · ½ each" : "Halved — carries") : "Not played yet"}</span>
                      {won ? <span style={{ background: C.greenLight, color: C.gold, fontSize: 11, padding: "3px 8px", borderRadius: 999 }}>{h.value} skin{h.value > 1 ? "s" : ""}</span> : tiedCarry ? <span style={{ background: "#5A3210", color: ORANGE, fontSize: 11, padding: "3px 8px", borderRadius: 999 }}>{halved ? "½ each" : "push →"}</span> : <span style={{ color: C.faint, fontSize: 11 }}>{h.value} at stake</span>}
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
            <div style={{ flex: 1, background: teamTotals.A >= teamTotals.B ? C.cream : C.card, borderRadius: 12, padding: 14, textAlign: "center" }}>
              <div style={{ color: C.ink, fontWeight: 800 }}>{teams![0].name}</div>
              <div style={{ color: C.green, fontSize: 32, fontWeight: 900, fontFamily: "Georgia, serif" }}>{fmtSkins(teamTotals.A)}</div>
            </div>
            <div style={{ flex: 1, background: teamTotals.B >= teamTotals.A ? C.cream : C.card, borderRadius: 12, padding: 14, textAlign: "center" }}>
              <div style={{ color: C.ink, fontWeight: 800 }}>{teams![1].name}</div>
              <div style={{ color: C.green, fontSize: 32, fontWeight: 900, fontFamily: "Georgia, serif" }}>{fmtSkins(teamTotals.B)}</div>
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
            return <div key={p.id} style={{ flex: 1, minWidth: 130, background: p.user_id === user.id ? C.cream : C.card, borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <Avatar src={p.avatar_url} name={p.display_name} size={26} />
                <span style={{ color: C.ink, fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.display_name}{p.user_id === user.id ? " (you)" : ""}{isTeamSkins && p.team ? ` · ${teamName(p.team)}` : ""}</span>
              </span>
              <span style={{ color: n > 0 ? C.green : C.faint, fontWeight: 800, fontSize: 20, fontFamily: "Georgia, serif", marginLeft: 8 }}>{fmtSkins(n)}</span>
            </div>;
          })}
        </div>
        {matchCards.map(({ idx, pa, pb, result }) => (
          <div key={idx} style={{ background: C.card, borderRadius: 12, padding: 14, marginTop: 12, border: pa.id === myKey || pb.id === myKey ? `1px solid ${C.gold}` : "none" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <div style={{ color: C.ink, fontWeight: 800, fontSize: 15 }}>{pa.name}{isTeamSkins ? ` (${teamName(playerOf(pa.id)?.team)})` : ""} <span style={{ color: C.faint, fontWeight: 400 }}>vs</span> {pb.name}{isTeamSkins ? ` (${teamName(playerOf(pb.id)?.team)})` : ""}</div>
              <div style={{ flex: 1 }} />
              <div style={{ color: C.green, fontWeight: 900, fontFamily: "Georgia, serif" }}>{fmtSkins(result.skinsBySide[pa.id] || 0)}–{fmtSkins(result.skinsBySide[pb.id] || 0)}</div>
            </div>
            <div style={{ marginTop: 10 }}>
              {result.holes.map((h) => {
                const tiedCarry = h.decided && !h.winnerId;
                const won = h.decided && h.winnerId;
                const winnerLabel = h.winnerId === pa.id ? pa.name : h.winnerId === pb.id ? pb.name : "";
                return (
                  <div key={h.hole} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: `1px solid ${C.line}` }}>
                    <span style={{ width: 24, color: C.faint, fontWeight: 800, fontSize: 12 }}>{h.hole}</span>
                    <span style={{ flex: 1, color: C.ink, fontSize: 12 }}>{won ? `${winnerLabel} wins` : tiedCarry ? "Halved — carries" : "Not played yet"}</span>
                    {won ? <span style={{ background: C.greenLight, color: C.gold, fontSize: 11, padding: "3px 8px", borderRadius: 999 }}>{h.value} skin{h.value > 1 ? "s" : ""}</span> : tiedCarry ? <span style={{ background: "#5A3210", color: ORANGE, fontSize: 11, padding: "3px 8px", borderRadius: 999 }}>push →</span> : <span style={{ color: C.faint, fontSize: 11 }}>{h.value} at stake</span>}
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
  const skinPlayers: SkinPlayer[] = players.map((p) => ({ id: p.id, name: p.display_name, gross: p.scores || [], ch: chBasis(p, game.course_par) }));
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
          return <div key={p.id} style={{ flex: 1, minWidth: 130, background: p.user_id === user.id ? C.cream : C.card, borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}><span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}><Avatar src={p.avatar_url} name={p.display_name} size={26} /><span style={{ color: C.ink, fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.display_name}{p.user_id === user.id ? " (you)" : ""}</span></span><span style={{ color: n > 0 ? C.green : C.faint, fontWeight: 800, fontSize: 20, fontFamily: "Georgia, serif", marginLeft: 8 }}>{fmtSkins(n)}</span></div>;
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


function MatchView({
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

  const addPairing = async () => {
    if (!aSel || !bSel || aSel === bSel) return;
    const dup = game.pairings.some((pr) => (pr.a === aSel && pr.b === bSel) || (pr.a === bSel && pr.b === aSel));
    if (dup) return; // that exact match already exists
    setBusy(true);
    const pairings = [...game.pairings, { a: aSel, b: bSel }];
    await supabase.from("games").update({ pairings }).eq("id", game.id);
    setASel("");
    setBSel("");
    setBusy(false);
    onChanged();
  };
  const removePairing = async (idx: number) => {
    const pairings = game.pairings.filter((_, i) => i !== idx);
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
      const st = matchStatus(game.holes_meta, pa.scores || [], pb.scores || [], chBasis(pa, game.course_par), chBasis(pb, game.course_par), game.allowance_pct ?? 100);
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
          <div style={{ color: C.cream, fontSize: 10, letterSpacing: 2, fontWeight: 800, opacity: 0.8 }}>TEAM MATCH · RUNNING SCORE</div>
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
            style={{ ...btn(false), fontSize: 12 }}
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Done" : "✎ Add / edit"}
          </button>
        )}
      </div>

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
              onChange={(e) => setASel(e.target.value)}
              style={{ ...inputStyle, width: "auto", minWidth: 130 }}
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
              onChange={(e) => setBSel(e.target.value)}
              style={{ ...inputStyle, width: "auto", minWidth: 130 }}
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
              disabled={!aSel || !bSel || aSel === bSel || busy}
              onClick={addPairing}
            >
              Add
            </button>
          </div>
          <div style={{ color: C.faint, fontSize: 11, marginTop: 8 }}>
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
          pa.course_handicap,
          pb.course_handicap,
          game.allowance_pct ?? 100,
        );
        const allow = matchAllowance(chBasis(pa, game.course_par), chBasis(pb, game.course_par), game.allowance_pct ?? 100);
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
              background: C.card,
              borderRadius: 12,
              padding: 14,
              marginTop: 10,
              border: iAmIn ? `1px solid ${C.gold}` : "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", color: C.ink, fontWeight: 700, fontSize: 15 }}>
                  <Avatar src={pa.avatar_url} name={pa.display_name} size={24} />
                  <span>{pa.display_name}{isTeam ? <span style={{ color: C.gold, fontWeight: 400, fontSize: 12 }}> ({teamName(pa.team)})</span> : null}</span>
                  <span style={{ color: C.faint, fontWeight: 400 }}>vs</span>
                  <Avatar src={pb.avatar_url} name={pb.display_name} size={24} />
                  <span>{pb.display_name}{isTeam ? <span style={{ color: C.gold, fontWeight: 400, fontSize: 12 }}> ({teamName(pb.team)})</span> : null}</span>
                </div>
                <div style={{ color: C.faint, fontSize: 12, marginTop: 2 }}>
                  thru {st.thru} · {pa.display_name}{" "}
                  {allow.a === 0 ? "scratch" : `+${allow.a}`}, {pb.display_name}{" "}
                  {allow.b === 0 ? "scratch" : `+${allow.b}`}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    color: st.result ? C.birdie : C.green,
                    fontWeight: 800,
                    fontSize: 16,
                    fontFamily: "Georgia, serif",
                  }}
                >
                  {statusText}
                </div>
                <div style={{ color: C.faint, fontSize: 11 }}>
                  {pa.display_name} {st.aWins}–{st.bWins} {pb.display_name}
                  {st.halves ? ` · ${st.halves} halved` : ""}
                </div>
              </div>
              {isCreator && editing && (
                <button
                  onClick={() => removePairing(idx)}
                  style={{
                    background: "none",
                    border: "none",
                    color: C.birdie,
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
function SweepBroom({ side }: { side: "left" | "right" }) {
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
function CleanSweepBanner({ name, val, thru, unit }: { name: string; val: number; thru: number; unit: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, borderRadius: 13, padding: "10px 14px", margin: "12px 0", background: "linear-gradient(180deg,#D9B23A,#C9A227)", border: "1px solid #E0C043", boxShadow: "0 6px 18px -8px rgba(0,0,0,0.6)" }}>
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
function SweepTrophy() {
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
function SweepAchievedBanner({ name, potNote }: { name: string; potNote?: string }) {
  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 15, padding: "16px 14px", margin: "12px 0", textAlign: "center", background: "radial-gradient(120% 120% at 50% 0%, #F0CF6A 0%, #D9B23A 45%, #C9A227 100%)", border: "1px solid #EBD37E", boxShadow: "0 10px 26px -10px rgba(0,0,0,0.7)" }}>
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

function TeamClinchLine({ aPts, bPts, unclaimed, aName, bName, metric, showBanner = true }: {
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
      <div style={{ borderTop: `1px solid ${C.greenMid}`, marginTop: 10, paddingTop: 8, textAlign: "center", color: C.sage, fontSize: 12 }}>
        {unclaimed > 0 ? <><b style={{ color: C.cream }}>{unclaimed}</b> {noun(unclaimed)} {tail}</> : (metric === "skins" ? "All skins decided" : metric === "matches" ? "All matches in" : "All points played")}
      </div>
      {showBanner && (cs.clinched || cs.canTie || cs.decided) && (
        <div style={{ marginTop: 8, background: cs.canTie ? "#3A3414" : (cs.decided && !cs.leader) ? "#2A2A22" : "#1f7a52", border: `1px solid ${cs.canTie ? C.gold : (cs.decided && !cs.leader) ? C.line : "#3FBF82"}`, borderRadius: 10, padding: "8px 12px", textAlign: "center" }}>
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

function FourballView({
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

  // Which contest line is expanded (one at a time): key is `${foursomeId}-${ci}`.
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Hole-by-hole detail panel for an expanded contest line.
  const HoleDetail = ({ rows, aLabel, bLabel, aColor, bColor, runningMatch = false }: { rows: ContestHole[]; aLabel: string; bLabel: string; aColor: string; bColor: string; runningMatch?: boolean }) => {
    const played = rows.filter((d) => d.r != null);
    if (!played.length) return <div style={{ background: "#F1EFE6", borderRadius: 8, padding: "8px 10px", margin: "2px 0 6px", color: C.faint, fontSize: 11 }}>No holes scored yet.</div>;
    return (
      <div style={{ background: "#F1EFE6", borderRadius: 8, padding: "6px 10px", margin: "2px 0 6px" }}>
        <div style={{ display: "flex", color: C.faint, fontSize: 10, fontWeight: 800, letterSpacing: 0.5, padding: "3px 0" }}>
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
        <div style={{ color: C.faint, fontSize: 10, paddingTop: 5 }}>Net scores. Bold = the lower net that won the hole.</div>
      </div>
    );
  };

  const saveFoursomes = async (next: typeof foursomes) => {
    await supabase.from("games").update({ foursomes: next }).eq("id", game.id);
    // Each foursome is also its tee group (1-based), so group scoring/markers line up
    // with the foursomes and there's no separate "Groups" step for four-ball.
    const groupOf: Record<string, number> = {};
    next.forEach((f, i) => { [...f.a, ...f.b].forEach((uid) => { groupOf[uid] = i + 1; }); });
    await Promise.all(players.map((p) => {
      const g = groupOf[pkey(p)] ?? null;
      return (p.tee_group ?? null) !== g
        ? supabase.from("game_players").update({ tee_group: g }).eq("id", p.id)
        : Promise.resolve();
    }));
    onChanged();
  };

  const addFoursome = () => {
    const next = [...foursomes, { id: Math.random().toString(36).slice(2, 8), name: `Foursome ${foursomes.length + 1}`, a: [], b: [] }];
    saveFoursomes(next);
  };
  const removeFoursome = (id: string) => {
    if (!confirm("Remove this foursome?")) return;
    saveFoursomes(foursomes.filter((f) => f.id !== id));
  };
  const renameFoursome = (id: string, name: string) => {
    saveFoursomes(foursomes.map((f) => (f.id === id ? { ...f, name } : f)));
  };
  // Assign a player to a slot (team "a" or "b") in a foursome, removing them from any other slot/foursome first.
  const assign = (fId: string, team: "a" | "b", uid: string) => {
    const cleared = foursomes.map((f) => ({ ...f, a: f.a.filter((x) => x !== uid), b: f.b.filter((x) => x !== uid) }));
    const next = cleared.map((f) => {
      if (f.id !== fId) return f;
      const side = f[team];
      if (side.length >= 2) return f; // pair is full
      return { ...f, [team]: [...side, uid] };
    });
    saveFoursomes(next);
  };
  const unassign = (fId: string, team: "a" | "b", uid: string) => {
    saveFoursomes(foursomes.map((f) => (f.id === fId ? { ...f, [team]: f[team].filter((x) => x !== uid) } : f)));
  };

  // Players not yet placed in any foursome.
  const placed = new Set(foursomes.flatMap((f) => [...f.a, ...f.b]));
  const unplaced = players.filter((p) => !placed.has(pkey(p)));

  const members4 = (f: { a: string[]; b: string[] }): FourballMember[] =>
    [...f.a, ...f.b].map((uid) => {
      const p = playerOf(uid);
      return { id: uid, gross: p?.scores || [], ch: p ? chBasis(p, game.course_par) : null, noShow: !!(p as any)?.no_show };
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
          {isCreator && <button style={{ ...btn(true), fontSize: 12 }} onClick={addFoursome}>+ Add foursome</button>}
        </div>
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
              <input value={f.name} onChange={(e) => renameFoursome(f.id, e.target.value)} disabled={!isCreator}
                style={{ ...inputStyle, flex: 1, fontWeight: 700 }} />
              {isCreator && <button style={{ ...btn(false), fontSize: 11, color: C.birdie }} onClick={() => removeFoursome(f.id)}>Remove</button>}
            </div>
            {(["a", "b"] as const).map((team) => (
              <div key={team} style={{ marginTop: 10 }}>
                <div style={{ color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>{isTeam ? (team === "a" ? teams![0].name : teams![1].name).toUpperCase() : (team === "a" ? "PAIR 1" : "PAIR 2")}</div>
                {f[team].map((uid) => (
                  <div key={uid} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
                    <span style={{ flex: 1, color: C.cream, fontSize: 14 }}>{nameOf(uid)}</span>
                    {isCreator && <button style={{ ...btn(false), fontSize: 11, padding: "3px 8px" }} onClick={() => unassign(f.id, team, uid)}>Remove</button>}
                  </div>
                ))}
                {isCreator && f[team].length < 2 && (
                  <select defaultValue="" onChange={(e) => { if (e.target.value) { assign(f.id, team, e.target.value); e.target.value = ""; } }}
                    style={{ ...inputStyle, padding: "6px 8px", fontSize: 12, marginTop: 4 }}>
                    <option value="">+ Add player…</option>
                    {unplaced.filter((p) => !isTeam || p.team === (team === "a" ? teams![0].key : teams![1].key)).map((p) => <option key={p.id} value={pkey(p)}>{p.display_name}</option>)}
                  </select>
                )}
              </div>
            ))}
            {isTrifecta && f.a.length === 2 && f.b.length === 2 && (
              <div style={{ marginTop: 10, borderTop: `1px solid ${C.greenMid}`, paddingTop: 8 }}>
                <div style={{ color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>SINGLES MATCHUPS</div>
                <div style={{ color: C.cream, fontSize: 13, marginTop: 4 }}>
                  {!f.swap
                    ? `${firstName(f.a[0])} v ${firstName(f.b[0])} · ${firstName(f.a[1])} v ${firstName(f.b[1])}`
                    : `${firstName(f.a[0])} v ${firstName(f.b[1])} · ${firstName(f.a[1])} v ${firstName(f.b[0])}`}
                </div>
                {isCreator && (
                  <button style={{ ...btn(false), fontSize: 12, marginTop: 6 }} onClick={() => setSwap(f.id, !f.swap)}>Swap who plays whom</button>
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
          <div key={f.id} style={{ background: C.card, borderRadius: 12, padding: 14, marginTop: 12, border: mine ? `1px solid ${C.gold}` : "none" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <div style={{ color: C.ink, fontWeight: 800, fontSize: 15 }}>{f.name}{mine ? " · your match" : ""}</div>
              <div style={{ flex: 1 }} />
              <div style={{ color: C.green, fontWeight: 800, fontSize: 14, fontFamily: "Georgia, serif" }}>{isTrifecta ? (tri ? `${fmtPts(triTally ? triTally.a : tri.aPts)}–${fmtPts(triTally ? triTally.b : tri.bPts)}` : "—") : st ? st.result : "—"}</div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <div style={{ flex: 1, background: C.greenLight, borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ color: C.gold, fontSize: 10, fontWeight: 800 }}>{isTeam ? teamName(playerOf(f.a[0])?.team).toUpperCase() : "PAIR 1"}</div>
                <div style={{ color: C.cream, fontSize: 13 }}>{f.a.map(firstName).join(" & ") || "—"}</div>
              </div>
              <div style={{ flex: 1, background: C.greenLight, borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ color: C.gold, fontSize: 10, fontWeight: 800 }}>{isTeam ? teamName(playerOf(f.b[0])?.team).toUpperCase() : "PAIR 2"}</div>
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
                      <div onClick={() => setOpenKey(isOpen ? null : key)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: `1px solid ${C.line}`, cursor: "pointer" }}>
                        <span style={{ color: C.faint, fontSize: 11, width: 12 }}>{isOpen ? "▾" : "▸"}</span>
                        <span style={{ flex: 1, color: C.ink, fontSize: 13 }}>{label}</span>
                        <span style={{ color: C.faint, fontSize: 11 }}>{c.thru ? `thru ${c.thru}` : "—"}</span>
                        <span style={{ color: C.gold, fontWeight: 800, fontSize: 13, fontFamily: "Georgia, serif", minWidth: 46, textAlign: "right" }}>{triScoring === "match" ? (c.thru ? matchLeadLabel(c.lead) : "—") : `${fmtPts(c.aPts)}–${fmtPts(c.bPts)}`}</span>
                      </div>
                      {isOpen && <HoleDetail rows={c.perHole} aLabel={aLabel} bLabel={bLabel} aColor={aColor} bColor={bColor} runningMatch={triScoring === "match"} />}
                    </React.Fragment>
                  );
                })}
                {isTeam && (
                  <div style={{ color: C.faint, fontSize: 11, marginTop: 6 }}>
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
                  <div onClick={() => setOpenKey(isOpen ? null : key)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: `1px solid ${C.line}`, cursor: "pointer" }}>
                    <span style={{ color: C.faint, fontSize: 11, width: 12 }}>{isOpen ? "▾" : "▸"}</span>
                    <span style={{ flex: 1, color: C.ink, fontSize: 12 }}>{leadText}</span>
                    <span style={{ color: C.faint, fontSize: 11 }}>thru {st.thru}</span>
                  </div>
                  {isOpen && <HoleDetail rows={detail} aLabel={firstName(f.a[0]) + "'s"} bLabel={firstName(f.b[0]) + "'s"} aColor={C.birdie} bColor={C.bogey} />}
                </div>
              );
            })()}
            {!full && <div style={{ color: C.faint, fontSize: 11, marginTop: 6 }}>Needs players in both pairs.</div>}
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
function StrokesSummary({ game, players, collapsible = false, meKey }: { game: Game; players: Player[]; collapsible?: boolean; meKey?: string }) {
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

  const phStr = (pp: Player) => (pp.course_handicap == null && pp.handicap_index == null ? "\u2014" : String(applyAllowance(chBasis(pp, game.course_par), allowance)));
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
    (game.game_type === "skins" && hasStructure);
  if (!usesStructure) return null;

  const oneVone = (aId: string, bId: string, key: string) => {
    const a = byKey(aId), b = byKey(bId);
    if (!a || !b) return null;
    const allow = matchAllowance(chBasis(a, game.course_par), chBasis(b, game.course_par), allowance);
    return (
      <div key={key} style={{ borderTop: "1px solid rgba(255,255,255,0.10)", padding: "10px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 7, minWidth: 0, color: C.cream, fontSize: 15, fontWeight: 600 }}><Avatar src={a.avatar_url} name={a.display_name} size={24} /><span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.display_name}</span> <span style={{ color: C.sage, fontSize: 12, fontWeight: 400 }}>ph {phStr(a)}</span></span>
          <span style={{ color: C.faint, fontSize: 12 }}>vs</span>
          <span style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 7, minWidth: 0, color: C.cream, fontSize: 15, fontWeight: 600 }}><span style={{ color: C.sage, fontSize: 12, fontWeight: 400 }}>ph {phStr(b)}</span> <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.display_name}</span><Avatar src={b.avatar_url} name={b.display_name} size={24} /></span>
        </div>
        <div style={{ color: "#CFE3D8", fontSize: 12, marginTop: 6 }}>
          {allow.a === 0 && allow.b === 0
            ? "Even match — no strokes."
            : allow.a === 0
              ? <><span style={{ color: C.sage }}>{a.display_name} plays off scratch.</span> {b.display_name} — <span style={{ color: "#E4CF86", fontWeight: 600 }}>{strokeText(allow.b)}</span></>
              : <><span style={{ color: C.sage }}>{b.display_name} plays off scratch.</span> {a.display_name} — <span style={{ color: "#E4CF86", fontWeight: 600 }}>{strokeText(allow.a)}</span></>}
        </div>
      </div>
    );
  };

  const teamStrip = (f: { a: string[]; b: string[] }, key: string) => {
    const members = [...f.a, ...f.b].map(byKey).filter((p): p is Player => !!p);
    if (members.length < 2) return null;
    const low = Math.min(...members.map((m) => applyAllowance(chBasis(m, game.course_par), allowance)));
    const col = (side: string[], teamKey: string | null) => (
      <div style={{ flex: 1, borderTop: `2px solid ${teamColOf(teamKey)}`, paddingTop: 8 }}>
        {teams && teamKey && <div style={{ color: teamColOf(teamKey), fontSize: 11, fontWeight: 600, marginBottom: 6 }}>{teams.find((t) => t.key === teamKey)?.name?.toUpperCase()}</div>}
        {side.map(byKey).filter((p): p is Player => !!p).map((p) => {
          const recv = applyAllowance(chBasis(p, game.course_par), allowance) - low;
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
        {isTrifecta && singles.length > 0 && (
          <>
            <div style={{ color: C.sage, fontSize: 10, letterSpacing: 1, marginTop: 6 }}>TWO SINGLES</div>
            {singles.map(([aId, bId], si) => oneVone(aId, bId, `${f.id}-s${si}`))}
            <div style={{ color: C.sage, fontSize: 10, letterSpacing: 1, marginTop: 10 }}>TEAM POINT · {game.team_score_mode === "aggregate" ? "SHOOTOUT" : "BEST BALL"}</div>
          </>
        )}
        {teamStrip(f, `${f.id}-t`)}
      </div>
    );
  };

  const toggleBtn = showToggle ? (
    <button
      onClick={(e) => { e.stopPropagation(); setShowAll((sa) => !sa); }}
      style={{ background: "none", border: "none", color: C.gold, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", padding: "4px 2px", flexShrink: 0 }}
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
                <div style={{ color: C.gold, fontSize: 10, fontWeight: 800, letterSpacing: 1 }}>YOUR GROUP</div>
                {soleFoursome && <div style={{ color: C.sage, fontSize: 11, letterSpacing: 1, fontWeight: 800, marginTop: 2 }}>{(soleFoursome.f.name || `Foursome ${soleFoursome.i + 1}`).toUpperCase()}</div>}
              </div>
              {toggleBtn}
            </div>
            {minePairings.map(({ pr, i }) => oneVone(pr.a, pr.b, `p${i}`))}
            {mineFoursomes.map(({ f, i }) => foursomeBlock(f, i, { label: !soleFoursome }))}
          </div>

          {showAll && (otherPairings.length > 0 || otherFoursomes.length > 0) && (
            <>
              <div style={{ color: C.faint, fontSize: 10, letterSpacing: 1.5, fontWeight: 700, marginTop: 14 }}>OTHER GROUPS</div>
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
    <div style={{ background: "#16302A", border: `1px solid ${C.greenMid}`, borderRadius: 12, padding: 14, marginTop: 12 }}>
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
function GroupsBuilder({ game, players, onSetTeeGroup, onRandomize, canRandomize = false, randomizeReason = "", randomizing = false, overflowIds = [] }: {
  game: Game; players: Player[];
  onSetTeeGroup: (p: Player, group: number | null) => Promise<void>;
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

      {onRandomize && !foursomes.length && !pairings.length && (
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => { if (canRandomize) onRandomize(); }}
            disabled={!canRandomize || randomizing}
            style={{ ...btn(true), fontSize: 13, opacity: canRandomize && !randomizing ? 1 : 0.5, cursor: canRandomize && !randomizing ? "pointer" : "not-allowed" }}>
            {randomizing ? "Shuffling…" : "🎲 Randomize groups"}
          </button>
          <div style={{ color: C.sage, fontSize: 11, marginTop: 6, lineHeight: 1.45 }}>
            {canRandomize
              ? "Shuffles everyone into balanced foursomes. Guests stay in their sponsor's group. You can still fine-tune below."
              : randomizeReason}
          </div>
          {overflowIds.length > 0 && (
            <div style={{ marginTop: 8, background: "#fff6e6", border: `1px solid ${C.gold}`, borderRadius: 8, padding: "9px 11px", color: "#8a5a12", fontSize: 12, lineHeight: 1.45 }}>
              {overflowIds.length} guest{overflowIds.length === 1 ? "" : "s"} couldn&apos;t be auto-placed (a member brought more than three): {overflowIds.map((id) => players.find((p) => p.id === id)?.display_name || "guest").join(", ")}. Assign {overflowIds.length === 1 ? "them" : "each"} to a group below.
            </div>
          )}
        </div>
      )}

      {units.map((u) => {
        const g = unitGroup(u);
        return (
          <div key={u.id} style={{ background: C.card, borderRadius: 10, padding: 12, marginTop: 10, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: C.ink, fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis" }}>{u.label}</div>
              <div style={{ color: C.faint, fontSize: 11 }}>{u.members.length} player{u.members.length === 1 ? "" : "s"}</div>
            </div>
            <select value={g ?? ""} onChange={(e) => assign(u, e.target.value ? parseInt(e.target.value, 10) : null)}
              style={{ ...inputStyle, padding: "6px 8px", minWidth: 110 }}>
              <option value="">No group</option>
              {groupOptions.map((n) => <option key={n} value={n}>Group {n}</option>)}
            </select>
          </div>
        );
      })}

      {teeGroups.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 14 }}>
          {teeGroups.map((gn) => {
            const mem = players.filter((p) => p.tee_group === gn);
            return (
              <div key={gn} style={{ background: C.card, borderRadius: 10, padding: 12, border: `1px solid ${C.gold}` }}>
                <div style={{ color: C.gold, fontWeight: 800, fontSize: 13 }}>Group {gn}{gn === firstGroup ? " · off first" : ""}</div>
                <div style={{ color: C.faint, fontSize: 11, marginTop: 2 }}>{mem.length} player{mem.length === 1 ? "" : "s"}</div>
                <div style={{ marginTop: 8, color: C.ink, fontSize: 13, lineHeight: 1.7 }}>
                  {mem.map((p) => {
                    const sponsor = p.is_guest && p.guest_of ? (players.find((m) => m.user_id === p.guest_of)?.display_name || null) : null;
                    return <div key={p.id}>{p.display_name}{sponsor ? <span style={{ color: C.faint, fontSize: 11 }}> · guest of {sponsor}</span> : null}</div>;
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
function ShareControl({ game, onShare }: { game: Game; onShare: (on: boolean) => Promise<void> }) {
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
          style={{ ...btn(true), marginTop: 10, fontSize: 13, display: "block", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Creating…" : "Create live link"}
        </button>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <input readOnly value={link} onFocus={(e) => e.currentTarget.select()}
              style={{ flex: 1, background: C.green, color: C.cream, border: `1px solid ${C.greenMid}`, borderRadius: 6, padding: "8px 10px", fontSize: 12 }} />
            <button onClick={copy} style={{ ...btn(true), fontSize: 12, padding: "8px 12px" }}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <button disabled={busy} onClick={() => toggle(false)}
            style={{ background: "transparent", color: "#E8A199", border: `0.5px solid #7A3A34`, borderRadius: 8, padding: "7px 12px", fontWeight: 700, cursor: "pointer", marginTop: 8, fontSize: 12, display: "block", opacity: busy ? 0.6 : 1 }}>
            {busy ? "…" : "Stop sharing (revoke link)"}
          </button>
        </div>
      )}
    </div>
  );
}

function OrganizerPanel({
  game,
  players,
  user,
  onOverride,
  courseTees,
  onSetTee,
  onRemove,
  onToggleNoShow,
  onSetTeam,
  onSetTeeGroup,
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
}: {
  game: Game;
  players: Player[];
  user: any;
  onOverride: (p: Player, idx: number | null) => Promise<void>;
  courseTees: CourseTee[];
  onSetTee: (p: Player, teeName: string) => Promise<void>;
  onRemove: (p: Player) => Promise<void>;
  onToggleNoShow: (p: Player) => Promise<void>;
  onSetTeam: (p: Player, team: string | null) => Promise<void>;
  onSetTeeGroup: (p: Player, group: number | null) => Promise<void>;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onEnd: () => Promise<void>;
  onReopen: () => Promise<void>;
  onReset: () => Promise<void>;
  onShare: (on: boolean) => Promise<void>;
  section?: "players" | "teams";
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
}) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [nameEdit, setNameEdit] = useState(game.name);
  const [addMemberId, setAddMemberId] = useState("");
  const [addGuestName, setAddGuestName] = useState("");
  const [addGuestHcp, setAddGuestHcp] = useState("");
  const [addGuestSponsor, setAddGuestSponsor] = useState(""); // sponsor user id; "" -> current user
  // Members already in this game can sponsor a walk-up guest (keeps them together when grouping).
  const gameMembers = players.filter((p) => !p.is_guest && p.user_id).map((p) => ({ id: p.user_id as string, name: p.display_name }));


  const withHcp = players.filter((p) => p.course_handicap != null).length;
  const allSet = players.length > 0 && withHcp === players.length;

  const teams = Array.isArray(game.teams) ? game.teams : [];
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
          <div style={{ marginTop: 12 }}>
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
                      <label style={{ color: C.sage, fontSize: 10 }}>Handicap</label>
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
                    <label style={{ color: C.sage, fontSize: 10 }}>Tee</label>
                    {courseTees.length ? (
                      <select
                        value={p.tee_name || ""}
                        onChange={(e) => onSetTee(p, e.target.value)}
                        style={{ ...inputStyle, padding: "6px 8px", marginTop: 2, width: "100%" }}
                      >
                        <option value="" disabled>Select tee</option>
                        {courseTees.map((t) => (
                          <option key={`${t.name}-${t.rating}-${t.slope}`} value={t.name}>
                            {t.name} · {t.rating}/{t.slope}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div style={{ color: C.ink, fontWeight: 700, fontSize: 13, marginTop: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {p.tee_name || "—"}
                      </div>
                    )}
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
                      {mem.length ? mem.map((p) => <div key={p.id}>{p.display_name} <span style={{ color: C.faint }}>CH {p.course_handicap ?? "—"}</span></div>) : <span style={{ color: C.faint }}>No players assigned</span>}
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
          {section === "players" && (
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
function BettingPanel({ players, playerPoints, playerHoles, ended, game, user, canPost, onBetStale, onToggleBets }: {
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
  async function findOrCreateGuestId(name: string): Promise<string | null> {
    const { data: existing } = await supabase.from("group_guests").select("id").eq("group_id", game.group_id).eq("name", name).eq("source_game_id", game.id).limit(1);
    if (existing && existing.length) return (existing[0] as any).id;
    const { data, error } = await supabase.from("group_guests").insert({ group_id: game.group_id, name, sponsor_user_id: null, archived: false, source_game_id: game.id, created_by: user.id }).select("id").single();
    return error || !data ? null : (data as any).id;
  }
  // Build the nets for posting, materializing a guest record + sponsor for each guest bettor.
  async function buildPostNets(): Promise<BetNet[] | null> {
    const out: BetNet[] = [];
    for (const pp of result.perPlayer) {
      const uid = idToUser[pp.id];
      if (uid) { out.push({ user_id: uid, name: pp.name, net: pp.net }); continue; }
      const sponsor = idToGuestOf[pp.id];
      if (!sponsor) return null; // guest with no sponsor — blocked upstream, guard anyway
      const gid = await findOrCreateGuestId(pp.name);
      if (!gid) return null;
      out.push({ user_id: null, guest_id: gid, sponsor_user_id: sponsor, name: pp.name, net: pp.net });
    }
    return out;
  }
  const payerRows = (post: BetPost, expId: string) => post.payers.map((py) => ({ expense_id: expId, user_id: py.user_id, guest_id: py.guest_id, sponsor_user_id: py.sponsor_user_id, paid_cents: py.paid_cents }));
  const shareRows = (post: BetPost, expId: string) => post.shares.map((sh) => ({ expense_id: expId, user_id: sh.user_id, guest_id: sh.guest_id, sponsor_user_id: sh.sponsor_user_id, share_cents: sh.share_cents }));
  const primaryPayer = (post: BetPost) => post.payers.map((p) => p.user_id || p.sponsor_user_id).find(Boolean) || null;

  async function doPost() {
    setBusy(true); setPostMsg(null);
    try {
      const nets = await buildPostNets();
      if (!nets) { setPostMsg("Assign a sponsor for each guest first."); setBusy(false); return; }
      const post = betResultToPost(nets);
      if (!post.ok) { setPostMsg(post.reason || "Couldn't balance the bet."); setBusy(false); return; }
      const pp = primaryPayer(post);
      if (!pp) { setPostMsg("Couldn't post — no member to record as payer."); setBusy(false); return; }
      const desc = `TGC bet — ${game.name || game.course || "game"}`;
      const { data: exp, error: e1 } = await supabase.from("expenses").insert({
        group_id: game.group_id, created_by: user.id,
        payer_user_id: pp,
        amount_cents: post.amount_cents, description: desc, category: "bet", split_type: "custom",
        source_game_id: game.id, source_kind: "tgc_bet",
      }).select("id, created_at").single();
      if (e1 || !exp) { setPostMsg("Couldn't post — please try again."); setBusy(false); return; }
      const { error: e2 } = await supabase.from("expense_payers").insert(payerRows(post, exp.id));
      const { error: e3 } = await supabase.from("expense_shares").insert(shareRows(post, exp.id));
      if (e2 || e3) { console.error("[bet post] split insert failed", { payers: e2, shares: e3 }); await supabase.from("expenses").delete().eq("id", exp.id); setPostMsg(("Couldn't post the splits — rolled back. " + ((e2 || e3)?.message || "")).trim()); setBusy(false); return; }
      await supabase.from("group_activity").insert({ group_id: game.group_id, actor_user_id: user.id, action: "bet_posted", summary: `posted bet winnings — pot $${(post.amount_cents / 100).toFixed(0)}`, meta: { game_id: game.id, expense_id: exp.id, amount_cents: post.amount_cents } });
      setPostedExpense({ id: exp.id, created_at: exp.created_at }); setConfirming(false);
      setPostMsg("Posted to Money.");
    } catch { setPostMsg("Something went wrong posting to Money."); }
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
      const { error } = await supabase.from("expenses").delete().eq("id", postedExpense.id);
      if (error) { setPostMsg("Couldn't un-post — please try again."); setBusy(false); return; }
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
  useEffect(() => { onBetStale?.(needsUpdate); }, [needsUpdate]); // eslint-disable-line react-hooks/exhaustive-deps
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
      const nets = await buildPostNets();
      if (!nets) { setPostMsg("Assign a sponsor for each guest first."); setBusy(false); return; }
      const post = betResultToPost(nets);
      if (!post.ok) { setPostMsg(post.reason || "Couldn't balance the corrected bet."); setBusy(false); return; }
      const pp = primaryPayer(post);
      if (!pp) { setPostMsg("Couldn't re-post — no member to record as payer."); setBusy(false); return; }
      const oldSnapshot = postedNets;
      // Delete the old linked expense (cascades its payers/shares). Settlements are
      // group-level and untouched, so net balances reconcile automatically — anyone
      // who overpaid the old amount now shows as "owed back" in the Money tab.
      const { error: ed } = await supabase.from("expenses").delete().eq("id", postedExpense.id);
      if (ed) { setPostMsg("Couldn't update — please try again."); setBusy(false); return; }
      const desc = `TGC bet — ${game.name || game.course || "game"}`;
      const { data: exp, error: e1 } = await supabase.from("expenses").insert({
        group_id: game.group_id, created_by: user.id, payer_user_id: pp,
        amount_cents: post.amount_cents, description: desc, category: "bet", split_type: "custom",
        source_game_id: game.id, source_kind: "tgc_bet",
      }).select("id, created_at").single();
      if (e1 || !exp) { setPostedExpense(null); setPostedNets(null); setPostMsg("Removed the old winnings but couldn't re-post — tap Post winnings again."); setBusy(false); return; }
      const { error: e2 } = await supabase.from("expense_payers").insert(payerRows(post, exp.id));
      const { error: e3 } = await supabase.from("expense_shares").insert(shareRows(post, exp.id));
      if (e2 || e3) {
        // Roll back so we never leave a bet expense with missing/partial splits
        // (which would compute wrong balances). End up cleanly un-posted instead.
        console.error("[bet re-post] split insert failed", { payers: e2, shares: e3 });
        await supabase.from("expenses").delete().eq("id", exp.id);
        setPostedExpense(null); setPostedNets(null);
        setPostMsg(("Couldn't save the corrected splits — the bet is now un-posted. Tap Post winnings to try again. " + ((e2 || e3)?.message || "")).trim());
        setBusy(false); return;
      }
      await supabase.from("group_activity").insert({
        group_id: game.group_id, actor_user_id: user.id, action: "bet_reposted",
        summary: `re-posted corrected bet winnings — pot $${(post.amount_cents / 100).toFixed(0)}. Recorded payments stay in place; anyone who overpaid now shows as owed back in Money.`,
        meta: { game_id: game.id, expense_id: exp.id, old_nets: oldSnapshot, new_amount_cents: post.amount_cents },
      });
      setPostedExpense({ id: exp.id, created_at: exp.created_at });
      setPostedNets(liveNetsCents);
      setConfirming(false);
      setPostMsg("Winnings corrected in Money.");
    } catch { setPostMsg("Something went wrong re-posting."); }
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
                  <div style={{ flex: 1, color: C.ink, fontWeight: 800 }}>{p.name}</div>
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
                      <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13 }}>
                        <span style={{ color: C.ink }}>{p.name}{idToIsGuest[p.id] ? <span style={{ color: C.faint, fontSize: 11, fontWeight: 700 }}> · guest of {nameOfUid(idToGuestOf[p.id] || "")}</span> : ""}</span>
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
function LegConfigEditor({ game, onSave }: { game: Game; onSave: (cfg: LegConfig) => void }) {
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
  const lbl: React.CSSProperties = { color: C.sage, fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", margin: "12px 0 6px" };
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
function SegmentBoard({
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
          <div style={{ display: "flex", alignItems: "center", padding: "6px 6px", color: C.sage, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4, borderBottom: "1px solid #2c5a48" }}>
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

function GroupSegmentSummary({ game, players }: { game: Game; players: Player[] }) {
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
  const th: React.CSSProperties = { textAlign: "center", color: C.faint, fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", padding: "6px 3px", borderBottom: `1px solid ${C.line}` };
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
      <div style={{ display: "inline-block", color: C.green, background: C.gold, borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 8 }}>Side game</div>
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
          <div style={{ color: C.sage, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", margin: "14px 0 4px" }}>Leg points</div>
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
                        <span key={tk} style={{ display: "inline-block", background: teamColor(tk), color: C.ink, borderRadius: 6, padding: "1px 7px", fontSize: 11, fontWeight: 800, marginLeft: 5 }}>{teamName(tk)} wins {fmtPt(li.pts)}</span>
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
          <div style={{ color: C.sage, fontSize: 10, marginTop: 10, opacity: 0.85, lineHeight: 1.4 }}>
            Each leg's best individual result scores for their team. Separate from the trifecta - it doesn't change that result. Points are awarded once a leg is complete; the leader is shown until then. Ties: opposite teams both score, same team scores once.
          </div>
        </>
      ) : (
        <div style={{ color: C.sage, fontSize: 10, marginTop: 8, opacity: 0.85, lineHeight: 1.4 }}>
          {hasTeams ? "Leaders per leg (highlighted); leader is by pace, so Thru matters. Assign leg points in setup to play for team points." : "Each player's Stableford points (or net vs par) per leg. Fills in live as holes are entered."}
        </div>
      )}
    </div>
  );
}
