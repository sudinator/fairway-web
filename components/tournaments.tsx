"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import {
  C,
  Hole,
  courseHandicap,
  strokesReceived,
  allocateStrokes,
  stablefordPts,
  stablefordBySix,
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
import { loadCoursesForGroup, courseLabel, type CourseTee } from "@/lib/courses";
import { logActivity } from "@/lib/activity";
import { saveActiveGame, loadActiveGame, clearActiveGame, saveGameScores, loadGameScores, clearAllGameScores } from "@/lib/draft";
import {
  btn,
  inputStyle,
  Eyebrow,
  NumPicker,
  ScoreEntryCard,
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
  game_type: "stableford" | "match" | "fourball" | "skins" | "trifecta";
  allowance_pct?: number | null; // handicap allowance % applied to net scoring
  marker_user_id?: string | null; // the player currently keeping score for the group
  pairings: { a: string; b: string }[]; // for match play: pkey(player) vs pkey(player)
  status?: "active" | "ended" | null;
  teams?: { key: string; name: string }[] | null; // two named teams for team match play
  foursomes?: { id: string; name: string; a: string[]; b: string[]; swap?: boolean }[] | null; // four-ball / trifecta: pair A vs pair B (swap = cross the singles)
  team_score_mode?: "best_ball" | "aggregate" | null; // trifecta team leg: low net vs both nets added
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
  fairways: ("hit" | "miss" | null)[]; // fairway result per hole (par 4/5)
  penalties?: (number | null)[]; // penalty strokes per hole
  sand?: (boolean | null)[]; // greenside bunker per hole (for sand-save %)
  team?: string | null; // team key ("A"/"B") for team match play
  no_show?: boolean | null; // organizer-flagged no-show (four-ball: scored net double bogey)
  is_guest?: boolean | null; // a guest player added for this game only
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
const pkey = (p: { user_id: string | null; id: string }) => p.user_id ?? p.id;

// The handicap basis for all stroke math: the UNROUNDED course handicap (WHS
// applies allowances to the unrounded value and rounds once at the end). Falls
// back to the stored rounded course handicap when index/tee data is missing
// (e.g. legacy guests). Display still uses the rounded course_handicap.
const chBasis = (
  p: { handicap_index?: number | null; slope?: number | null; rating?: number | null; course_handicap: number | null },
  coursePar: number | null | undefined,
): number => {
  if (p.handicap_index != null && p.slope != null && p.rating != null && coursePar != null) {
    return p.handicap_index * (p.slope / 113) + (p.rating - coursePar);
  }
  return p.course_handicap ?? 0;
};

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
}: {
  session: any;
  activeGroupId: string;
}) {
  const [view, setView] = useState<"list" | "create" | { gameId: string }>(
    "list",
  );
  // Resume the game room the user was in (survives lock/refresh) instead of
  // dropping them back at the games list.
  useEffect(() => {
    const g = loadActiveGame();
    if (g) setView({ gameId: g.gameId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const user = session.user;
  const displayName =
    user.user_metadata?.full_name || user.email?.split("@")[0] || "Golfer";

  if (view === "create")
    return (
      <CreateGame
        user={user}
        displayName={displayName}
        activeGroupId={activeGroupId}
        onCancel={() => setView("list")}
        onCreated={(gameId) => setView({ gameId })}
      />
    );
  if (typeof view === "object")
    return (
      <GameRoom
        gameId={view.gameId}
        user={user}
        displayName={displayName}
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
function CreateGame({
  user,
  displayName,
  activeGroupId,
  onCancel,
  onCreated,
}: {
  user: any;
  displayName: string;
  activeGroupId: string;
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  // Match date — defaults to today (local). Stored structured on the game so we
  // can later summarize by season/month. YYYY-MM-DD to match a Postgres `date`.
  const todayLocal = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const [matchDate, setMatchDate] = useState<string>(todayLocal());
  const [favorites, setFavorites] = useState<any[]>([]);
  const [pickedFav, setPickedFav] = useState<any | null>(null);
  const [teeIdx, setTeeIdx] = useState(0);
  const [idxStr, setIdxStr] = useState("");
  const [profileIdx, setProfileIdx] = useState<number | null>(null);
  const [gameType, setGameType] = useState<"stableford" | "match" | "fourball" | "skins" | "trifecta">(
    "stableford",
  );
  // Handicap allowance % (playing handicap = allowance% of course handicap).
  // Default 85 for four-ball, 100 otherwise. Resets to the standard when the
  // format changes; editable any time.
  const [allowancePct, setAllowancePct] = useState(100);
  useEffect(() => { setAllowancePct(gameType === "fourball" || gameType === "trifecta" ? 85 : 100); }, [gameType]);
  const [teamScoreMode, setTeamScoreMode] = useState<"best_ball" | "aggregate">("best_ball");
  const [teamMode, setTeamMode] = useState(false);
  const [skinsTeamStyle, setSkinsTeamStyle] = useState<"head_to_head" | "best_ball">("head_to_head");
  const [team1, setTeam1] = useState("Team 1");
  const [team2, setTeam2] = useState("Team 2");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [groupRoster, setGroupRoster] = useState<
    { id: string; display_name: string; handicap_index: number | null }[]
  >([]);
  const [selectedPlayers, setSelectedPlayers] = useState<
    Record<string, boolean>
  >({});
  const [guestName, setGuestName] = useState("");
  const [guestHcp, setGuestHcp] = useState("");
  const [guestPlayers, setGuestPlayers] = useState<
    { id: string; display_name: string; handicap_index: number }[]
  >([]);

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
      },
    ]);
    setGuestName("");
    setGuestHcp("");
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
      const { data: members } = await supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", activeGroupId)
        .eq("status", "active");
      const ids = (members || []).map((m: any) => m.user_id).filter(Boolean);
      const { data: profs } = ids.length
        ? await supabase
            .from("profiles")
            .select("id, display_name, handicap_index")
            .in("id", ids)
        : ({ data: [] as any[] } as any);
      const roster: { id: string; display_name: string; handicap_index: number | null }[] = (profs || [])
        .map((p: any) => ({
          id: p.id,
          display_name: p.display_name || "Player",
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
      const typeLabel = gameType === "match" ? "Match Play" : gameType === "fourball" ? "Four-Ball" : gameType === "skins" ? "Skins" : gameType === "trifecta" ? "Trifecta" : "Stableford";
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
          team_score_mode: gameType === "trifecta" ? teamScoreMode : "best_ball",
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
      const selectedIds = new Set([
        user.id,
        ...Object.keys(selectedPlayers).filter((id) => selectedPlayers[id]),
      ]);
      const selectedRoster = groupRoster.filter((p) => selectedIds.has(p.id));
      if (!selectedRoster.some((p) => p.id === user.id)) {
        selectedRoster.unshift({
          id: user.id,
          display_name: displayName,
          handicap_index: idxVal,
        });
      }
      // Seed each player's avatar from the group-readable copy (game_players can't
      // read profiles of others, so we denormalize like display_name).
      const rosterIds = selectedRoster.map((p) => p.id).filter(Boolean);
      let avatarById: Record<string, string | null> = {};
      if (rosterIds.length) {
        const { data: gmAv } = await supabase
          .from("group_members")
          .select("user_id, avatar_url")
          .eq("group_id", activeGroupId)
          .in("user_id", rosterIds);
        avatarById = Object.fromEntries((gmAv || []).map((m: any) => [m.user_id, m.avatar_url || null]));
      }
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
          display_name: p.display_name || "Player",
          avatar_url: avatarById[p.id] ?? null,
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
        display_name: p.display_name,
        handicap_index: p.handicap_index,
        rating: tee.rating,
        slope: tee.slope,
        tee_name: tee.name,
        course_handicap: coursePar != null ? courseHandicap(p.handicap_index, tee.slope, tee.rating, coursePar) : null,
        scores: Array(holesMeta.length).fill(null),
        putts: Array(holesMeta.length).fill(null),
        fairways: Array(holesMeta.length).fill(null),
      }));
      const rows = [...rosterRows, ...guestRows];
      const { error: e2 } = await supabase.from("game_players").insert(rows);
      if (e2) throw e2;
      await logActivity(supabase, { actor_id: user.id, actor_name: displayName, action: "game_created", group_id: activeGroupId, summary: `Created the game "${game.name}" at ${pickedFav.name}` });
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
      onCreated(game.id);
    } catch (e: any) {
      setErr(e.message || "Failed to create game.");
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 600 }}>
      <Eyebrow>CREATE A GAME</Eyebrow>
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
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {guestPlayers.map((g) => (
                <span key={g.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.greenMid, borderRadius: 999, padding: "4px 10px", color: C.cream, fontSize: 13 }}>
                  {g.display_name} <span style={{ color: C.sage, fontSize: 11 }}>idx {g.handicap_index}{tee && coursePar != null ? ` · ch ${courseHandicap(g.handicap_index, tee.slope, tee.rating, coursePar)}` : ""}</span>
                  <button
                    onClick={() => setGuestPlayers((prev) => prev.filter((p) => p.id !== g.id))}
                    style={{ background: "none", border: "none", color: C.birdie, cursor: "pointer", fontSize: 14, padding: 0 }}
                  >
                    ✕
                  </button>
                </span>
              ))}
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
              setTeeIdx(0);
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
            {pickedFav.tees.map((t: any, i: number) => (
              <button
                key={i}
                onClick={() => setTeeIdx(i)}
                style={{
                  ...btn(i === teeIdx),
                  padding: "8px 14px",
                  fontSize: 13,
                }}
              >
                {t.name} · {t.rating}/{t.slope}
              </button>
            ))}
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
        <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
          <button
            onClick={() => setGameType("stableford")}
            style={{ ...btn(gameType === "stableford"), flex: 1, minWidth: 120, fontSize: 13 }}
          >
            Stableford tournament
          </button>
          <button
            onClick={() => setGameType("match")}
            style={{ ...btn(gameType === "match"), flex: 1, minWidth: 120, fontSize: 13 }}
          >
            Singles match play
          </button>
          <button
            onClick={() => setGameType("fourball")}
            style={{ ...btn(gameType === "fourball"), flex: 1, minWidth: 120, fontSize: 13 }}
          >
            Four-ball (best net)
          </button>
          <button
            onClick={() => setGameType("skins")}
            style={{ ...btn(gameType === "skins"), flex: 1, minWidth: 120, fontSize: 13 }}
          >
            Skins (net)
          </button>
          <button
            onClick={() => setGameType("trifecta")}
            style={{ ...btn(gameType === "trifecta"), flex: 1, minWidth: 120, fontSize: 13 }}
          >
            Trifecta (2 v 2)
          </button>
        </div>
        <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>
          {gameType === "stableford"
            ? "Everyone competes on one net-Stableford leaderboard."
            : gameType === "fourball"
            ? "2-player teams play better-net-ball match play. Big groups split into foursomes (2 v 2) — set them up after creating. Great for 12–16 players in 3–4 foursomes."
            : gameType === "skins"
            ? "Skins follows match-play structure: singles can be 1:1, team 1:1 rolls skins into team totals, or team best-ball can be played in foursomes. Halved holes carry forward."
            : gameType === "trifecta"
            ? "Each 2-v-2 foursome plays for three points per hole: the two singles (each player vs their opposite number) plus a team point. Three points per hole riding on every group — set up the foursomes after creating."
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
          </div>
        )}
        {(gameType === "match" || gameType === "skins" || gameType === "fourball") && (
          <div style={{ background: C.greenLight, borderRadius: 12, padding: 12, marginTop: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={teamMode} onChange={(e) => setTeamMode(e.target.checked)} />
              <span style={{ color: C.cream, fontWeight: 700, fontSize: 14 }}>{gameType === "skins" ? "Team skins" : gameType === "fourball" ? "Team four-ball (Red vs Blue)" : "Team match (e.g. 4 v 4)"}</span>
            </label>
            <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>
              {gameType === "skins"
                ? "Two teams. Use 1:1 pairings to roll skins into team totals, or choose best-ball foursomes below. A halved hole carries the pot forward."
                : gameType === "fourball"
                ? "Two teams. Each 2-v-2 foursome is worth a point; the team total is the sum across foursomes (a halved foursome = ½ each), Ryder-Cup style. You'll assign players to teams after creating."
                : "Two teams. Each 1-on-1 pairing is worth a point; the team total is the sum (halved matches = ½ each). You'll assign players to teams after creating."}
            </div>
            {teamMode && (
              <>
                {gameType === "skins" && (
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <button onClick={() => setSkinsTeamStyle("head_to_head")} style={{ ...btn(skinsTeamStyle === "head_to_head"), fontSize: 12, padding: "7px 10px" }}>1:1 team skins</button>
                    <button onClick={() => setSkinsTeamStyle("best_ball")} style={{ ...btn(skinsTeamStyle === "best_ball"), fontSize: 12, padding: "7px 10px" }}>Team best-ball skins</button>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <input style={{ ...inputStyle, flex: 1, minWidth: 130 }} value={team1} onChange={(e) => setTeam1(e.target.value)} placeholder="Team 1 name" />
                  <input style={{ ...inputStyle, flex: 1, minWidth: 130 }} value={team2} onChange={(e) => setTeam2(e.target.value)} placeholder="Team 2 name" />
                </div>
              </>
            )}
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
  user,
  displayName,
  onBack,
}: {
  gameId: string;
  user: any;
  displayName: string;
  onBack: () => void;
}) {
  const [game, setGame] = useState<Game | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [me, setMe] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingHole, setSavingHole] = useState<number | null>(null);
  // join-setup if I'm in the game but haven't set my tee/handicap
  const [needsSetup, setNeedsSetup] = useState(false);
  const [copied, setCopied] = useState(false);
  // Sub-tab inside the game room: "play" (scorecard, default) vs "setup"
  // (assign teams, matchups, manage game). Restored from the saved active game.
  const [roomTab, setRoomTab] = useState<"play" | "setup">(
    () => loadActiveGame()?.tab || "play",
  );
  useEffect(() => { saveActiveGame(gameId, roomTab); }, [gameId, roomTab]);
  // Which step of the setup flow is showing: players & tees, teams, matchups, groups.
  const [setupTab, setSetupTab] = useState<"players" | "teams" | "matchups" | "groups">("players");
  const [cardView, setCardView] = useState(false); // show the whole-group vertical scorecard
  // When group scoring is switched on, bring everyone to the group card.
  useEffect(() => { if (game?.marker_user_id) setCardView(true); }, [game?.marker_user_id]);

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
  // A marker lands on the group card automatically.
  useEffect(() => { if (myRow?.is_marker) setCardView(true); }, [myRow?.is_marker]);
  const myGroupHasMarker = teeGroupsInUse && myRow?.tee_group != null && players.some((p) => p.tee_group === myRow!.tee_group && p.is_marker);
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
    setCardView(true);
    setPlayers((ps) => ps.map((p) => (p.tee_group === myRow.tee_group ? { ...p, is_marker: p.id === myRow.id } : p))); // optimistic
    lastEditRef.current = Date.now();
    await supabase.rpc("claim_group_marker", { p_game: game.id });
    load();
  };
  const releaseGroupMarker = async () => {
    if (!game || !myRow) return;
    setPlayers((ps) => ps.map((p) => (p.id === myRow.id ? { ...p, is_marker: false } : p))); // optimistic
    await supabase.rpc("release_group_marker", { p_game: game.id });
    load();
  };
  const finishMyGroup = async () => {
    if (!game || !myRow?.tee_group) return;
    if (!confirm(`Finish Group ${myRow.tee_group}'s round? Your group's scores lock and post to each player's Rounds tab. The rest of the game keeps going.`)) return;
    await supabase.rpc("finish_tee_group", { p_game: game.id });
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

  const load = useCallback(async () => {
    const { data: g } = await supabase
      .from("games")
      .select("*")
      .eq("id", gameId)
      .single();
    const { data: ps } = await supabase
      .from("game_players")
      .select("*")
      .eq("game_id", gameId);
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
    const reconciled: any[] = [];
    for (const p of (ps || [])) {
      const backup = loadGameScores(gameId, p.id);
      if (!backup) { reconciled.push(p); continue; }
      const { merged, changed } = mergeBackupRow(p, backup, n);
      let row = p;
      if (changed) {
        row = { ...p, ...merged };
        try { await supabase.from("game_players").update(merged).eq("id", p.id); } catch {}
      }
      // Keep the backup in lockstep with the reconciled truth.
      saveGameScores(gameId, p.id, merged);
      reconciled.push(row);
    }
    let mine = reconciled.find((p: any) => p.user_id === user.id) || null;
    setPlayers(reconciled);
    setMe(mine);
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
    let alive = true;
    loadCoursesForGroup(supabase, game.group_id).then((rows) => {
      if (!alive) return;
      const courses = (rows || []).map((r: any) => normalizeFavoriteCourse(r));
      const found = courses.find((c: any) => c.name === game.course || courseLabel(c) === game.course);
      setCourseTees(Array.isArray(found?.tees) ? found.tees : []);
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
  // Set true for the duration of a score reset so the background flush can't
  // re-write the old scores (a PWA confirm() can fire visibilitychange/blur,
  // which would otherwise flush the stale row right back over the reset).
  const resettingRef = React.useRef(false);
  useEffect(() => {
    const flush = () => {
      if (resettingRef.current) return;       // a reset is in progress; don't write
      if (markerOwnsMyRowRef.current) return; // marker owns my row; don't write it
      const m = meRef.current;
      if (!m) return;
      const data = { scores: m.scores || [], putts: m.putts || [], fairways: m.fairways || [] };
      if (!data.scores.some((s) => s != null)) return;
      saveGameScores(gameIdRef.current, m.id, data);              // synchronous, always lands
      supabase.from("game_players").update(data).eq("id", m.id).then(() => {}); // best-effort
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
    const onOnline = () => { load(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [load]);

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

  // Save one hole's data (strokes / putts / fairway) for me.
  const setMyHole = async (
    holeIdx: number,
    patch: {
      strokes?: number | null;
      putts?: number | null;
      fairway?: "hit" | "miss" | null;
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
    if (game) saveGameScores(game.id, me.id, { scores, putts, fairways, penalties, sand });
    setSavingHole(holeIdx);
    lastEditRef.current = Date.now();
    await supabase
      .from("game_players")
      .update({ scores, putts, fairways, penalties, sand, ...clockPatch })
      .eq("id", me.id);
    lastEditRef.current = Date.now();
    setSavingHole(null);
  };

  // Marker: write one hole for ANY player in the group. Requires marker rights,
  // enforced server-side by RLS (see migration 0006).
  const setPlayerHole = async (
    playerId: string,
    holeIdx: number,
    patch: { strokes?: number | null; putts?: number | null; fairway?: "hit" | "miss" | null; penalties?: number | null; sand?: boolean | null },
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
    if (game) saveGameScores(game.id, playerId, { scores, putts, fairways, penalties, sand });
    lastEditRef.current = Date.now();
    await supabase.from("game_players").update({ scores, putts, fairways, penalties, sand, ...clockPatch }).eq("id", playerId);
    lastEditRef.current = Date.now();
  };

  // Claim / release the group scorecard (the "marker"). Uses a SECURITY DEFINER
  // RPC so only a group member can claim, and only the marker can release.
  const takeOverScoring = async () => {
    if (!game) return;
    setGame({ ...game, marker_user_id: user.id }); // optimistic
    setCardView(true);
    await supabase.rpc("claim_marker", { p_game_id: game.id });
  };
  const releaseScoring = async () => {
    if (!game) return;
    setGame({ ...game, marker_user_id: null });
    await supabase.rpc("release_marker", { p_game_id: game.id });
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
    await supabase.rpc("set_tee_group", { p_player: p.id, p_group: group });
    await load();
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
    return { scores: Array(n).fill(null), putts: Array(n).fill(null), fairways: Array(n).fill(null) };
  };
  const addGuestToGame = async (name: string, idx: number) => {
    if (!game || !name.trim() || Number.isNaN(idx)) return;
    const t = refTee();
    const ch = (t.slope != null && t.rating != null && game.course_par != null)
      ? courseHandicap(idx, t.slope, t.rating, game.course_par) : null;
    await supabase.from("game_players").insert({
      game_id: game.id, user_id: null, is_guest: true, display_name: name.trim(),
      handicap_index: idx, rating: t.rating, slope: t.slope, tee_name: t.tee_name,
      course_handicap: ch, ...blankCard(),
    });
    await load();
  };
  const addMemberToGame = async (m: { id: string; display_name: string; handicap_index: number | null }) => {
    if (!game) return;
    const t = refTee();
    const ch = (m.handicap_index != null && t.slope != null && t.rating != null && game.course_par != null)
      ? courseHandicap(m.handicap_index, t.slope, t.rating, game.course_par) : null;
    await supabase.from("game_players").insert({
      game_id: game.id, user_id: m.id, is_guest: false, display_name: m.display_name,
      handicap_index: m.handicap_index, rating: t.rating, slope: t.slope, tee_name: t.tee_name,
      course_handicap: ch, ...blankCard(),
    });
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
  const setFormat = async (next: "stableford" | "match" | "fourball" | "skins" | "trifecta") => {
    if (!game || next === game.game_type) return;
    const suggested = next === "fourball" || next === "trifecta" ? 85 : 100;
    const patch: Record<string, unknown> = { game_type: next, allowance_pct: suggested };
    if (next === "trifecta" && !game.team_score_mode) patch.team_score_mode = "best_ball";
    await supabase.from("games").update(patch).eq("id", game.id);
    await load();
  };

  const setTeamScoreMode = async (mode: "best_ball" | "aggregate") => {
    if (!game) return;
    await supabase.from("games").update({ team_score_mode: mode }).eq("id", game.id);
    await load();
  };

  // Organizer: end the game — freezes scores and shows final results.
  const endGame = async () => {
    if (!game) return;
    if (!confirm(`End "${game.name}"? Final standings are locked in and every player's scorecard is posted to their Rounds tab.`)) return;
    await supabase.rpc("finish_game", { p_game: game.id });
    // Freeze the round clock for anyone still running (started but no end yet).
    const nowIso = new Date().toISOString();
    await Promise.all(players
      .filter((p) => p.clock_start != null && p.clock_end == null)
      .map((p) => supabase.from("game_players").update({ clock_end: nowIso }).eq("id", p.id)));
    await recordMyGameRound();
    await logActivity(supabase, { actor_id: user.id, actor_name: displayName, action: "game_ended", group_id: (game as any).group_id || null, summary: `Ended the game "${game.name}"` });
    await load();
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
        played_at: (game as any).created_at || new Date().toISOString(),
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
        yardage: m.yards ?? null,
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
      await Promise.all(players.map((p) => supabase.from("game_players").update(blank).eq("id", p.id)));
      if (game.status === "ended") await supabase.from("games").update({ status: "active" }).eq("id", game.id);
      await logActivity(supabase, { actor_id: user.id, actor_name: displayName, action: "game_reset", group_id: (game as any).group_id || null, summary: `Reset scores for "${game.name}"` });
      await load();
    } finally {
      resettingRef.current = false;
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

  const isOrganizer = game.created_by === user.id;
  const isEnded = game.status === "ended";
  const leaderboard = [...players].sort(
    (a, b) => playerPoints(b) - playerPoints(a),
  );

  // Segment winners (three sixes), by net Stableford.
  const segLabels = ["Holes 1–6", "Holes 7–12", "Holes 13–18"];
  const segTotals = players.map((p) => ({
    p,
    seg: stablefordBySix(playerHoles(p)),
  }));
  const segWinners = [0, 1, 2].map((si) => {
    let best = -1,
      who: string[] = [];
    segTotals.forEach(({ p, seg }) => {
      // only count a segment if the player has entered all 6 holes
      const played = playerHoles(p)
        .slice(si * 6, si * 6 + 6)
        .filter((h) => h.strokes).length;
      if (played < 6) return;
      if (seg[si] > best) {
        best = seg[si];
        who = [p.display_name];
      } else if (seg[si] === best) who.push(p.display_name);
    });
    return { label: segLabels[si], best, who };
  });

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
        const teamsArr = Array.isArray(game.teams) ? game.teams : [];
        const usesTeams = teamsArr.length > 0;
        const usesMatchups = game.game_type === "match" || game.game_type === "fourball" || game.game_type === "skins" || game.game_type === "trifecta";
        const usesFoursomes = Array.isArray(game.foursomes);
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
          onEnd: endGame, onReopen: reopenGame, onReset: resetScores, onShare: setShare,
          eligibleMembers, onAddMember: addMemberToGame, onAddGuest: addGuestToGame,
          onSetAllowance: setAllowance, onSetFormat: setFormat, onSetTeamScoreMode: setTeamScoreMode, anyScores,
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
        const isStableford = game.game_type === "stableford";
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
              <GroupsBuilder game={game} players={players} onSetTeeGroup={setPlayerTeeGroup} />
            )}
          </div>
        );
      })()}

      {roomTab === "play" && (
      <div style={{ marginTop: 16, background: isEnded ? "#3A3A3A" : game.game_type === "match" ? "#1E3A8A" : game.game_type === "fourball" || game.game_type === "trifecta" ? "#1E3A8A" : C.green, borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 800 }}>
          {game.game_type === "match" ? "⛳ Singles Match Play" : game.game_type === "fourball" ? "⛳ Four-Ball Match (Best Net)" : game.game_type === "trifecta" ? (game.team_score_mode === "aggregate" ? "⛳ Trifecta · Shootout" : "⛳ Trifecta") : game.game_type === "skins" ? "🪙 Skins (Net)" : "🏆 Stableford Tournament"}
        </span>
        {isEnded ? (
          <span style={{ fontSize: 12, fontWeight: 800, background: C.gold, color: "#1A1A1A", borderRadius: 20, padding: "3px 10px" }}>FINAL · GAME ENDED</span>
        ) : (
          <span style={{ color: C.cream, opacity: 0.8, fontSize: 12 }}>
            {game.game_type === "match" ? "1-on-1 pairings" : game.game_type === "fourball" ? "2 v 2 better-net-ball" : game.game_type === "trifecta" ? "2 singles + a team point · 3 pts/hole" : game.game_type === "skins" ? "net skins · carryovers" : "net Stableford leaderboard"}
          </span>
        )}
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

      {roomTab === "play" && !isEnded && (() => {
        const canFinishGroup = !!myRow?.is_marker && myRow?.tee_group != null && !myRow?.group_locked;
        if (!canFinishGroup && !isOrganizer) return null;
        return (
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            {canFinishGroup && (
              <button onClick={finishMyGroup} style={{ ...btn(true), flex: 1, minWidth: 180, fontSize: 13, padding: "10px 0" }}>
                🏁 Finish Group {myRow!.tee_group}'s round
              </button>
            )}
            {isOrganizer && (
              <button onClick={endGame} style={{ ...btn(!canFinishGroup), flex: 1, minWidth: 180, fontSize: 13, padding: "10px 0", background: canFinishGroup ? "#5A1E1E" : undefined, color: canFinishGroup ? "#fff" : undefined }}>
                🔒 End game for everyone
              </button>
            )}
          </div>
        );
      })()}

      {roomTab === "play" && (
        <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
          <button onClick={() => setCardView(false)} style={{ ...btn(!cardView), flex: 1, fontSize: 13 }}>Results</button>
          <button onClick={() => setCardView(true)} style={{ ...btn(cardView), flex: 1, fontSize: 13 }}>Group card</button>
        </div>
      )}
      {roomTab === "play" && !cardView && game.marker_user_id && !isEnded && (
        <div style={{ color: C.gold, fontSize: 12, marginTop: 8 }}>
          Group scoring is on — enter and view scores on the <strong>Group card</strong>.
        </div>
      )}
      {roomTab === "play" && cardView ? (
        <>
          {teeGroupsInUse && teeGroupList.length > 1 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
              {teeGroupList.map((g) => {
                const grpPlayers = players.filter((p) => p.tee_group === g);
                const locked = grpPlayers.some((p) => p.group_locked);
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
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={claimGroupMarker} style={{ ...btn(true), flex: 1, minWidth: 130, fontSize: 13 }}>I'll keep score</button>
                <button onClick={() => setCardView(false)} style={{ ...btn(false), flex: 1, minWidth: 130, fontSize: 13 }}>We'll each score our own</button>
              </div>
            </div>
          )}
          <GroupScorecard game={game} players={cardPlayers} user={user}
            isMarker={cardCanEdit}
            markerName={viewedMarkerPlayer?.display_name ?? null}
            onTakeOver={takeOverScoring}
            onRelease={releaseScoring}
            onSetHole={setPlayerHole}
            teeMode={teeGroupsInUse}
            groupLabel={viewGroup != null ? `Group ${viewGroup}` : ""}
            groupLocked={viewedGroupLocked}
            canClaim={canClaimViewed}
            onClaimGroup={claimGroupMarker}
            onReleaseGroup={releaseGroupMarker}
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
            <Eyebrow>LEADERBOARD · NET STABLEFORD</Eyebrow>
            {/* Column header */}
            <div style={{ display: "flex", alignItems: "center", padding: "6px 16px 4px", color: C.sage, fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase" }}>
              <div style={{ width: 30 }}>#</div>
              <div style={{ flex: 1 }}>Player</div>
              <div style={{ width: 46, textAlign: "center" }}>Gross</div>
              <div style={{ width: 40, textAlign: "center" }}>Net</div>
              <div style={{ width: 52, textAlign: "center" }}>Net±Par</div>
              <div style={{ width: 40, textAlign: "center" }}>Pts</div>
            </div>
            {leaderboard.map((p) => {
              const pts = playerPoints(p);
              const pos = leaderboard.findIndex((x) => playerPoints(x) === pts) + 1;
              const tied = leaderboard.filter((x) => playerPoints(x) === pts).length > 1;
              const thru = playerThru(p);
              return (
                <div key={p.id} style={{
                  background: p.user_id === user.id ? C.cream : C.card,
                  borderRadius: 12, padding: "10px 16px", marginTop: 8,
                  display: "flex", alignItems: "center",
                }}>
                  <div style={{ color: C.gold, fontFamily: "Georgia, serif", fontWeight: 700, width: 30, fontSize: 17 }}>
                    {tied ? "T" : ""}{pos}
                  </div>
                  <Avatar src={p.avatar_url} name={p.display_name} size={48} />
                  <div style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
                    <div style={{ color: C.ink, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.display_name}{p.user_id === user.id ? " (you)" : ""}
                    </div>
                    <div style={{ color: C.faint, fontSize: 11 }}>
                      thru {thru}{p.course_handicap != null ? ` · CH ${p.course_handicap}` : " · no hcp"}
                    </div>
                  </div>
                  <div style={{ width: 46, textAlign: "center", color: C.ink, fontWeight: 700, fontSize: 16 }}>{thru ? playerGross(p) : "–"}</div>
                  <div style={{ width: 40, textAlign: "center", color: C.ink, fontWeight: 700, fontSize: 16 }}>{thru ? playerNet(p) : "–"}</div>
                  <div style={{ width: 52, textAlign: "center", color: C.ink, fontWeight: 800, fontSize: 16, fontFamily: "Georgia, serif" }}>{thru ? relToParStr(p) : "–"}</div>
                  <div style={{ width: 40, textAlign: "center", color: C.green, fontWeight: 800, fontSize: 20, fontFamily: "Georgia, serif" }}>{pts}</div>
                </div>
              );
            })}
            <div style={{ color: C.sage, fontSize: 10, marginTop: 8 }}>
              Gross = total strokes · Net = gross minus handicap strokes · Net±Par = net score vs. par · Pts = net Stableford points.
            </div>
          </div>

          {/* Three sixes */}
          <div style={{ marginTop: 18 }}>
            <Eyebrow>SIX-HOLE SEGMENTS (NET STABLEFORD)</Eyebrow>
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
                  {s.best < 0 ? (
                    <div style={{ color: C.faint, fontSize: 13, marginTop: 6 }}>
                      Not complete yet
                    </div>
                  ) : (
                    <>
                      <div
                        style={{
                          color: C.cream,
                          fontWeight: 800,
                          marginTop: 6,
                        }}
                      >
                        {s.who.join(", ")}
                      </div>
                      <div style={{ color: C.gold, fontSize: 13 }}>
                        {s.best} pts {s.who.length > 1 ? "(tie)" : ""}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          {(game as any)?.group_id === TGC_GROUP_ID && (
            <BettingPanel
              players={players}
              playerPoints={playerPoints}
              playerHoles={playerHoles}
            />
          )}
        </>
      ) : null}

      {/* Read-only players: explain where their entry card went so a newcomer
          isn't left hunting for it. Shown only when a marker is actively scoring. */}
      {roomTab === "play" && me && !isEnded && (game.marker_user_id || myGroupHasMarker) && (() => {
        const mk = (teeGroupsInUse && myRow?.tee_group != null)
          ? players.find((p) => p.tee_group === myRow.tee_group && p.is_marker)
          : players.find((p) => p.user_id === game.marker_user_id);
        const mkName = mk?.display_name || "Someone";
        return (
          <div style={{ marginTop: 22, background: "#16302A", border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ color: C.cream, fontSize: 13, fontWeight: 700 }}>📋 {mkName} is keeping score for your group</div>
            <div style={{ color: C.sage, fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>
              Your own scorecard is hidden so two phones aren't entering at once — scroll up to the group card to follow along live. You can take over scoring from there if you'd like.
            </div>
          </div>
        );
      })()}

      {/* My score entry — hidden while a marker is keeping score for the group
          (scoring then happens only on the Group card, to avoid conflicts). */}
      {roomTab === "play" && me && !(!isEnded && (game.marker_user_id || myGroupHasMarker)) && (
        <div style={{ marginTop: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Eyebrow>{isEnded ? "YOUR FINAL SCORES" : "ENTER YOUR SCORES"}</Eyebrow>
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
                strokes: me.scores?.[i] ?? null,
                putts: me.putts?.[i] ?? null,
                fairway: me.fairways?.[i] ?? null,
                penalties: me.penalties?.[i] ?? null,
                sand: me.sand?.[i] ?? null,
                recv: matchAllow != null ? matchStrokesFor(matchAllow, m.si) : (alloc[m.n] || 0),
                // If I receive none but my opponent does, show the holes where I give a stroke.
                gives: game.game_type === "match" && (matchAllow ?? 0) === 0 && oppAllow != null
                  ? matchStrokesFor(oppAllow, m.si)
                  : 0,
              }));
            })()}
            hasHandicap={me.course_handicap != null}
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
              if ((game.game_type === "fourball" || game.game_type === "trifecta") && Array.isArray(game.foursomes)) {
                // Find my foursome and which side I'm on; compute the running team
                // best-net-ball match position from MY team's perspective.
                const f = game.foursomes.find(
                  (x: any) => (x.a || []).includes(myKey) || (x.b || []).includes(myKey),
                );
                if (!f || !f.a?.length || !f.b?.length) return undefined;
                const onA = f.a.includes(myKey);
                const myIds = onA ? f.a : f.b;
                const oppIds = onA ? f.b : f.a;
                const members = [...f.a, ...f.b].map((uid: string) => {
                  const p = players.find((pp) => pkey(pp) === uid);
                  return { id: uid, gross: p?.scores || [], ch: p ? chBasis(p, game.course_par) : null, noShow: !!p?.no_show };
                });
                // myIds as the "A" side so positive lead = my team up.
                const prog = fourballProgress(game.holes_meta, members, myIds, oppIds, game.allowance_pct ?? 100);
                return prog.map((lead) => matchLeadLabel(lead));
              }
              return undefined;
            })()}
          />
          <MyStatsLine me={me} holes={playerHoles(me)} />
        </div>
      )}
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
    </div>
  );
}

function MyStatsLine({ me, holes }: { me: Player; holes: Hole[] }) {
  const withPutts = holes.filter((h) => h.putts != null);
  const totalPutts = withPutts.reduce((s, h) => s + (h.putts || 0), 0);
  const girHit = withPutts.filter(
    (h) => h.strokes != null && h.strokes - (h.putts || 0) <= h.par - 2,
  ).length;
  const fwHoles = holes.filter(
    (h) => h.par >= 4 && (h.fairway === "hit" || h.fairway === "miss"),
  );
  const fwHit = fwHoles.filter((h) => h.fairway === "hit").length;
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
        ? `${fwHit}/${fwHoles.length} (${Math.round((100 * fwHit) / fwHoles.length)}%)`
        : "—"}
    </div>
  );
}

// ---------------- Match play view ----------------
function GroupScorecard({ game, players, user, isMarker, markerName, onTakeOver, onRelease, onSetHole, teeMode = false, groupLabel = "", canClaim = false, onClaimGroup, onReleaseGroup, groupLocked = false, onMarkOut }: {
  game: Game; players: Player[]; user: any;
  isMarker: boolean; markerName: string | null;
  onTakeOver: () => void; onRelease: () => void;
  onSetHole: (playerId: string, holeIdx: number, patch: { strokes?: number | null; putts?: number | null; fairway?: "hit" | "miss" | null; penalties?: number | null; sand?: boolean | null }) => void;
  teeMode?: boolean; groupLabel?: string; canClaim?: boolean;
  onClaimGroup?: () => void; onReleaseGroup?: () => void; groupLocked?: boolean;
  onMarkOut?: (p: Player) => void;
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
  const recvFor = (p: Player, si: number | null) => strokesReceived(si, applyAllowance(chBasis(p, game.course_par), allowance));

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
  const colorFor = (p: Player): string => {
    if (Array.isArray(game.teams) && game.teams.length && p.team) {
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
    let g = 0, pts = 0;
    for (let i = from; i <= to && i < meta.length; i++) {
      const gross = p.scores?.[i] ?? null;
      if (gross != null && gross > 0) {
        g += gross;
        pts += stablefordPts(gross, meta[i].par, recvFor(p, meta[i].si)) || 0;
      }
    }
    return { g, pts };
  };

  const holeCard = (i: number) => {
    const m = meta[i];
    return (
      <div key={`hc${i}`} style={{ background: "#13352A", border: "1px solid #2E6B55", borderRadius: 10, padding: 8, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ color: C.cream, fontSize: 18, fontWeight: 800, lineHeight: 1 }}>Hole {m.n}</span>
          <span style={{ color: "#CFE3D8", fontSize: 13 }}>Par <b style={{ color: C.cream }}>{m.par}</b>{m.yards ? <> · <b style={{ color: C.cream }}>{m.yards}</b> yds</> : null} · SI <b style={{ color: C.cream }}>{m.si ?? "–"}</b></span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {cols.map((c, ci) => {
            if (c.type === "divider") return <div key={`hd${i}-${ci}`} style={{ width: 2, alignSelf: "stretch", background: "rgba(216,178,74,0.5)", borderRadius: 2, margin: "16px 1px 0" }} />;
            const p = c.p;
            const gross = p.scores?.[i] ?? null;
            const recv = recvFor(p, m.si);
            const pts = stablefordPts(gross, m.par, recv);
            return (
              <div key={p.id + i} style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: colorFor(p), fontSize: 10, fontWeight: 700, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 3 }}>{p.display_name}</div>
                <div
                  style={{ position: "relative", background: "#FBFAF4", borderRadius: 7, height: 56, display: "flex", alignItems: "center", justifyContent: "center", cursor: isMarker ? "pointer" : "default", outline: isMarker ? "1px solid #E6E0CC" : "none" }}
                  onClick={isMarker ? () => { if (gross == null || gross <= 0) onSetHole(p.id, i, { strokes: m.par }); setEdit({ playerId: p.id, holeIdx: i }); } : undefined}>
                  {recv > 0 && (
                    <div style={{ position: "absolute", top: 4, left: 5, display: "flex", gap: 2 }}>
                      {Array.from({ length: Math.min(recv, 2) }).map((_, d) => (
                        <span key={d} style={{ width: 6, height: 6, borderRadius: 99, background: "#E8730C", display: "block" }} />
                      ))}
                    </div>
                  )}
                  <span style={{ fontSize: 26, fontWeight: 800, color: netColor(gross, recv, m.par) }}>{gross != null && gross > 0 ? gross : "·"}</span>
                  {gross != null && gross > 0 && (
                    <span style={{ position: "absolute", bottom: 3, right: 4, background: C.green, color: "#fff", fontSize: 11, fontWeight: 800, padding: "0 6px", borderRadius: 6 }}>{pts ?? 0}</span>
                  )}
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
                <span style={{ position: "absolute", bottom: 3, right: 4, background: C.green, color: "#E4CF86", fontSize: 10, fontWeight: 800, padding: "0 5px", borderRadius: 6 }}>{s.pts}</span>
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
      {teeMode ? (
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
        <span style={{ color: "#E8730C", fontSize: 10 }}>● gets a stroke · corner = Stableford</span>
      </div>
      <div style={{ position: "sticky", top: "env(safe-area-inset-top)", zIndex: 5, background: C.green, paddingTop: 8, paddingBottom: 10, marginBottom: 4, boxShadow: "0 6px 10px -8px rgba(0,0,0,0.55)" }}>
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
                <div style={{ color: C.sage, fontSize: 9 }}>hcp {meta.reduce((a, m) => a + recvFor(p, m.si), 0)}</div>
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
        const net = gross != null && gross > 0 ? gross - recv : null;
        const clampG = (v: number) => Math.max(1, Math.min(15, v));
        return (
          <div onClick={() => setEdit(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 290, maxWidth: "100%", background: C.card, borderRadius: 14, padding: 16 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <div style={{ color: C.ink, fontWeight: 800, fontSize: 15 }}>{p.display_name} · Hole {m.n}</div>
                {recv > 0 && <div style={{ color: "#E8730C", fontSize: 11, fontWeight: 700 }}>● gets a stroke</div>}
              </div>
              <div style={{ color: C.faint, fontSize: 11, marginTop: 2 }}>Par {m.par}{m.yards ? ` · ${m.yards} yds` : ""} · SI {m.si ?? "–"}</div>

              <div style={{ color: C.ink, fontSize: 13, marginTop: 14, marginBottom: 5 }}>Score (gross)</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button onClick={() => onSetHole(p.id, edit.holeIdx, { strokes: clampG((gross || m.par) - 1) })} style={{ width: 36, height: 36, borderRadius: 8, border: `0.5px solid ${C.line}`, background: C.card, color: C.ink, fontSize: 20, cursor: "pointer" }}>−</button>
                <div style={{ flex: 1, textAlign: "center" }}>
                  <span style={{ fontSize: 26, fontWeight: 800, color: net == null ? C.faint : net < m.par ? "#1B7A4B" : net === m.par ? "#1E5B8A" : "#C0392B" }}>{gross && gross > 0 ? gross : "–"}</span>
                  {net != null && <span style={{ color: C.faint, fontSize: 12 }}> · net {net}</span>}
                </div>
                <button onClick={() => onSetHole(p.id, edit.holeIdx, { strokes: clampG((gross || m.par) + 1) })} style={{ width: 36, height: 36, borderRadius: 8, border: "none", background: C.green, color: "#fff", fontSize: 20, cursor: "pointer" }}>+</button>
              </div>

              <div style={{ color: C.ink, fontSize: 13, marginTop: 14, marginBottom: 5 }}>Fairway {m.par < 4 ? <span style={{ color: C.faint }}>· n/a on a par 3</span> : ""}</div>
              <div style={{ display: "flex", gap: 6, opacity: m.par < 4 ? 0.4 : 1, pointerEvents: m.par < 4 ? "none" : "auto" }}>
                <button onClick={() => onSetHole(p.id, edit.holeIdx, { fairway: fw === "hit" ? null : "hit" })} style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: `0.5px solid ${fw === "hit" ? "#1B6E4B" : C.line}`, background: fw === "hit" ? "#E1F0E7" : C.card, color: fw === "hit" ? "#1B6E4B" : C.faint, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Hit</button>
                <button onClick={() => onSetHole(p.id, edit.holeIdx, { fairway: fw === "miss" ? null : "miss" })} style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: `0.5px solid ${fw === "miss" ? C.birdie : C.line}`, background: fw === "miss" ? "#F6DEDB" : C.card, color: fw === "miss" ? C.birdie : C.faint, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Miss</button>
              </div>

              <div style={{ color: C.ink, fontSize: 13, marginTop: 14, marginBottom: 5 }}>Putts</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={() => onSetHole(p.id, edit.holeIdx, { putts: Math.max(0, (putts || 0) - 1) })} style={{ width: 32, height: 32, borderRadius: 8, border: `0.5px solid ${C.line}`, background: C.card, color: C.ink, fontSize: 18, cursor: "pointer" }}>−</button>
                <span style={{ color: C.ink, fontSize: 18, fontWeight: 700, minWidth: 16, textAlign: "center" }}>{putts ?? "–"}</span>
                <button onClick={() => onSetHole(p.id, edit.holeIdx, { putts: Math.min(10, (putts || 0) + 1) })} style={{ width: 32, height: 32, borderRadius: 8, border: `0.5px solid ${C.line}`, background: C.card, color: C.ink, fontSize: 18, cursor: "pointer" }}>+</button>
              </div>

              <div style={{ color: C.ink, fontSize: 13, marginTop: 14, marginBottom: 5 }}>Sand / Penalty</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <button onClick={() => onSetHole(p.id, edit.holeIdx, { sand: !sandOn })}
                  style={{ border: `1px solid ${sandOn ? "#C9A227" : C.line}`, background: sandOn ? "#EFE2C0" : C.card, color: sandOn ? "#7A5A12" : C.faint, borderRadius: 8, padding: "8px 12px", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
                  {sandOn ? "S · bunker" : "S"}
                </button>
                <span style={{ color: C.line }}>|</span>
                {[0, 1, 2, 3].map((nn) => (
                  <button key={nn} onClick={() => onSetHole(p.id, edit.holeIdx, { penalties: nn })}
                    style={{ width: 34, padding: "8px 0", textAlign: "center", border: `1px solid ${penN === nn ? C.birdie : C.line}`, background: penN === nn ? "#F6DEDB" : C.card, color: penN === nn ? C.birdie : C.faint, borderRadius: 8, fontWeight: 800, fontSize: 13, cursor: "pointer" }}>{nn}</button>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button
                  onClick={() => onSetHole(p.id, edit.holeIdx, { strokes: null, putts: null, fairway: null, penalties: 0, sand: false })}
                  style={{ flex: 1, background: C.greenLight, color: C.cream, border: "none", borderRadius: 8, padding: 11, fontWeight: 800, fontSize: 14, cursor: "pointer" }}
                >Clear</button>
                <button onClick={() => setEdit(null)} style={{ flex: 1, background: C.green, color: C.cream, border: "none", borderRadius: 8, padding: 11, fontWeight: 800, fontSize: 14, cursor: "pointer" }}>Done</button>
              </div>
              <div style={{ color: C.faint, fontSize: 10, textAlign: "center", marginTop: 8 }}>Only the score is required. Players can add their own stats too.</div>
            </div>
          </div>
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

function SkinsView({ game, players, user, isCreator, mode, onChanged }: { game: Game; players: Player[]; user: any; isCreator: boolean; mode: string; onChanged: () => void }) {
  const teams = game.teams || null;
  const isTeamSkins = Array.isArray(teams) && teams.length === 2;
  const isTeamBestBallSkins = isTeamSkins && Array.isArray(game.foursomes);
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

  if (isTeamBestBallSkins) {
    const foursomes = game.foursomes || [];
    const cards = foursomes.map((f) => {
      const members: FourballMember[] = [...f.a, ...f.b].map((uid) => {
        const p = playerOf(uid);
        return { id: uid, gross: p?.scores || [], ch: p ? chBasis(p, game.course_par) : null, noShow: !!p?.no_show };
      });
      const result = computeTeamBestBallSkins(game.holes_meta, members, f.a, f.b, game.allowance_pct ?? 100);
      return { f, result };
    });
    const carrying = cards.reduce((s, c) => s + c.result.carryAtEnd, 0);
    const totalA = cards.reduce((s, c) => s + (c.result.skinsBySide.a || 0), 0);
    const totalB = cards.reduce((s, c) => s + (c.result.skinsBySide.b || 0), 0);

    return (
      <div style={{ marginTop: 18 }}>
        <Eyebrow>{`TEAM SKINS · BEST BALL${game.allowance_pct != null && game.allowance_pct !== 100 ? ` · ${game.allowance_pct}% ALLOWANCE` : ""}`}</Eyebrow>
        {carrying > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#5A3210", border: `1px solid ${ORANGE}`, borderRadius: 10, padding: "10px 12px", marginTop: 10 }}>
            <span style={{ color: ORANGE, fontSize: 18, fontWeight: 800 }}>↑</span>
            <span style={{ color: "#F2C28A", fontSize: 13 }}>{carrying} unresolved skin{carrying > 1 ? "s" : ""} carrying across team skins matches</span>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <div style={{ flex: 1, background: totalA >= totalB ? C.cream : C.card, borderRadius: 12, padding: 14, textAlign: "center" }}>
            <div style={{ color: C.ink, fontWeight: 800 }}>{teams![0].name}</div>
            <div style={{ color: C.green, fontSize: 32, fontWeight: 900, fontFamily: "Georgia, serif" }}>{totalA}</div>
          </div>
          <div style={{ flex: 1, background: totalB >= totalA ? C.cream : C.card, borderRadius: 12, padding: 14, textAlign: "center" }}>
            <div style={{ color: C.ink, fontWeight: 800 }}>{teams![1].name}</div>
            <div style={{ color: C.green, fontSize: 32, fontWeight: 900, fontFamily: "Georgia, serif" }}>{totalB}</div>
          </div>
        </div>

        {cards.length === 0 && <div style={{ background: C.greenLight, borderRadius: 12, padding: 18, marginTop: 12, color: C.sage }}>No team skins foursomes set yet. Open Game setup to build them.</div>}
        {cards.map(({ f, result }) => {
          const mine = f.a.includes(myKey) || f.b.includes(myKey);
          return (
            <div key={f.id} style={{ background: C.card, borderRadius: 12, padding: 14, marginTop: 12, border: mine ? `1px solid ${C.gold}` : "none" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <div style={{ color: C.ink, fontWeight: 800, fontSize: 15 }}>{f.name}{mine ? " · your match" : ""}</div>
                <div style={{ flex: 1 }} />
                <div style={{ color: C.green, fontWeight: 900, fontFamily: "Georgia, serif" }}>{result.skinsBySide.a || 0}–{result.skinsBySide.b || 0}</div>
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
                  const winnerLabel = h.winnerId === "a" ? "Pair 1" : h.winnerId === "b" ? "Pair 2" : "";
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
          );
        })}
      </div>
    );
  }

  if (game.pairings.length > 0) {
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
              <div style={{ color: C.green, fontSize: 32, fontWeight: 900, fontFamily: "Georgia, serif" }}>{teamTotals.A}</div>
            </div>
            <div style={{ flex: 1, background: teamTotals.B >= teamTotals.A ? C.cream : C.card, borderRadius: 12, padding: 14, textAlign: "center" }}>
              <div style={{ color: C.ink, fontWeight: 800 }}>{teams![1].name}</div>
              <div style={{ color: C.green, fontSize: 32, fontWeight: 900, fontFamily: "Georgia, serif" }}>{teamTotals.B}</div>
            </div>
          </div>
        )}
        {carrying > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#5A3210", border: `1px solid ${ORANGE}`, borderRadius: 10, padding: "10px 12px", marginTop: 10 }}>
            <span style={{ color: ORANGE, fontSize: 18, fontWeight: 800 }}>↑</span>
            <span style={{ color: "#F2C28A", fontSize: 13 }}>{carrying} unresolved skin{carrying > 1 ? "s" : ""} carrying across 1:1 skins matches</span>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {[...players].sort((a, b) => (totals[pkey(b)] || 0) - (totals[pkey(a)] || 0)).map((p) => {
            const n = totals[pkey(p)] || 0;
            return <div key={p.id} style={{ flex: 1, minWidth: 130, background: p.user_id === user.id ? C.cream : C.card, borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span style={{ color: C.ink, fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.display_name}{p.user_id === user.id ? " (you)" : ""}{isTeamSkins && p.team ? ` · ${teamName(p.team)}` : ""}</span>
              <span style={{ color: n > 0 ? C.green : C.faint, fontWeight: 800, fontSize: 20, fontFamily: "Georgia, serif", marginLeft: 8 }}>{n}</span>
            </div>;
          })}
        </div>
        {matchCards.map(({ idx, pa, pb, result }) => (
          <div key={idx} style={{ background: C.card, borderRadius: 12, padding: 14, marginTop: 12, border: pa.id === myKey || pb.id === myKey ? `1px solid ${C.gold}` : "none" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <div style={{ color: C.ink, fontWeight: 800, fontSize: 15 }}>{pa.name}{isTeamSkins ? ` (${teamName(playerOf(pa.id)?.team)})` : ""} <span style={{ color: C.faint, fontWeight: 400 }}>vs</span> {pb.name}{isTeamSkins ? ` (${teamName(playerOf(pb.id)?.team)})` : ""}</div>
              <div style={{ flex: 1 }} />
              <div style={{ color: C.green, fontWeight: 900, fontFamily: "Georgia, serif" }}>{result.skinsBySide[pa.id] || 0}–{result.skinsBySide[pb.id] || 0}</div>
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
  const result = computeSkins(game.holes_meta, skinPlayers, game.allowance_pct ?? 100);
  const firstUndecided = result.holes.find((h) => !h.decided);
  const carrying = firstUndecided ? firstUndecided.carriedIn : result.carryAtEnd;
  const intoHole = firstUndecided ? firstUndecided.hole : null;
  const totals = [...players].sort((a, b) => (result.skinsByPlayer[b.id] || 0) - (result.skinsByPlayer[a.id] || 0));

  return (
    <div style={{ marginTop: 18 }}>
      <Eyebrow>{`SKINS · INDIVIDUAL FALLBACK${game.allowance_pct != null && game.allowance_pct !== 100 ? ` · ${game.allowance_pct}% ALLOWANCE` : ""}`}</Eyebrow>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>Open Game setup to configure 1:1 pairings or team best-ball skins. Until then, this old game is shown as individual skins.</div>
      {carrying > 0 && <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#5A3210", border: `1px solid ${ORANGE}`, borderRadius: 10, padding: "10px 12px", marginTop: 10 }}><span style={{ color: ORANGE, fontSize: 18, fontWeight: 800 }}>↑</span><span style={{ color: "#F2C28A", fontSize: 13 }}>{carrying} skin{carrying > 1 ? "s" : ""} {intoHole ? `carrying into hole ${intoHole}` : "unclaimed (last hole tied)"}</span></div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        {totals.map((p) => {
          const n = result.skinsByPlayer[p.id] || 0;
          return <div key={p.id} style={{ flex: 1, minWidth: 130, background: p.user_id === user.id ? C.cream : C.card, borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}><span style={{ color: C.ink, fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.display_name}{p.user_id === user.id ? " (you)" : ""}</span><span style={{ color: n > 0 ? C.green : C.faint, fontWeight: 800, fontSize: 20, fontFamily: "Georgia, serif", marginLeft: 8 }}>{n}</span></div>;
        })}
      </div>
      <div style={{ marginTop: 16 }}>
        {result.holes.map((h) => {
          const won = h.decided && h.winnerId;
          const tiedCarry = h.decided && !h.winnerId;
          return <div key={h.hole} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 4px", borderBottom: `1px solid ${C.greenLight}` }}><span style={{ width: 26, color: h.decided ? C.cream : C.sage, fontWeight: 700, fontSize: 13 }}>{h.hole}</span><span style={{ flex: 1, color: won ? C.cream : C.sage, fontSize: 13 }}>{won ? `${nameById[h.winnerId!] || "—"} · net ${h.netById[h.winnerId!]}` : tiedCarry ? "Tied — carries" : "Not played yet"}</span>{won ? <span style={{ background: C.greenLight, color: C.gold, fontSize: 12, padding: "3px 9px", borderRadius: 999 }}>{h.value} skin{h.value > 1 ? "s" : ""}</span> : tiedCarry ? <span style={{ background: "#5A3210", color: ORANGE, fontSize: 12, padding: "3px 9px", borderRadius: 999 }}>push →</span> : <span style={{ color: C.faint, fontSize: 12 }}>{h.value} at stake</span>}</div>;
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
  const isTeam = Array.isArray(teams) && teams.length === 2;
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
    game.pairings.forEach((pr) => {
      const pa = playerOf(pr.a), pb = playerOf(pr.b);
      if (!pa || !pb) return;
      const st = matchStatus(game.holes_meta, pa.scores || [], pb.scores || [], chBasis(pa, game.course_par), chBasis(pb, game.course_par), game.allowance_pct ?? 100);
      // Determine which team each player is on.
      const ta = pa.team, tb = pb.team;
      if (!ta || !tb || ta === tb) return; // need a cross-team pairing
      const decided = !!st.result;
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
    return { pts, decidedPts };
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
                <div style={{ color: C.ink, fontWeight: 700, fontSize: 15 }}>
                  {pa.display_name}{isTeam ? <span style={{ color: C.gold, fontWeight: 400, fontSize: 12 }}> ({teamName(pa.team)})</span> : null}{" "}
                  <span style={{ color: C.faint, fontWeight: 400 }}>vs</span>{" "}
                  {pb.display_name}{isTeam ? <span style={{ color: C.gold, fontWeight: 400, fontSize: 12 }}> ({teamName(pb.team)})</span> : null}
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
  const HoleDetail = ({ rows, aLabel, bLabel, aColor, bColor }: { rows: ContestHole[]; aLabel: string; bLabel: string; aColor: string; bColor: string }) => {
    const played = rows.filter((d) => d.r != null);
    if (!played.length) return <div style={{ background: "#F1EFE6", borderRadius: 8, padding: "8px 10px", margin: "2px 0 6px", color: C.faint, fontSize: 11 }}>No holes scored yet.</div>;
    return (
      <div style={{ background: "#F1EFE6", borderRadius: 8, padding: "6px 10px", margin: "2px 0 6px" }}>
        <div style={{ display: "flex", color: C.faint, fontSize: 10, fontWeight: 800, letterSpacing: 0.5, padding: "3px 0" }}>
          <span style={{ width: 34 }}>HOLE</span><span style={{ flex: 1 }}>NET</span><span style={{ width: 60, textAlign: "center" }}>WON</span><span style={{ width: 52, textAlign: "right" }}>SCORE</span>
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
              <span style={{ width: 52, textAlign: "right", color: C.faint }}>{fmtPts(d.aRun)}–{fmtPts(d.bRun)}</span>
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
  const isTeam = Array.isArray(teams) && teams.length === 2;
  const holesCount = game.holes_meta?.length ?? 18;
  const teamStandings = (() => {
    if (!isTeam) return null;
    const pts: Record<string, number> = { A: 0, B: 0 };
    const decidedPts: Record<string, number> = { A: 0, B: 0 };
    foursomes.forEach((f) => {
      if (!f.a.length || !f.b.length) return;
      const ta = playerOf(f.a[0])?.team, tb = playerOf(f.b[0])?.team;
      if (!ta || !tb || ta === tb) return; // need a cross-team foursome
      const st = fourballStatus(game.holes_meta, members4(f), f.a, f.b, game.allowance_pct ?? 100);
      if (st.thru === 0) return;
      const decided = st.thru === holesCount || Math.abs(st.lead) > holesCount - st.thru;
      if (st.lead === 0) { pts.A += 0.5; pts.B += 0.5; if (decided) { decidedPts.A += 0.5; decidedPts.B += 0.5; } }
      else { const w = st.lead > 0 ? ta : tb; pts[w] += 1; if (decided) decidedPts[w] += 1; }
    });
    return { pts, decidedPts };
  })();
  const fmtPts = (n: number) => (n === Math.floor(n) ? String(n) : `${Math.floor(n)}½`);

  // Trifecta: each foursome contributes its singles + team points to the team totals.
  const isTrifecta = game.game_type === "trifecta";
  const teamScoreMode: "best_ball" | "aggregate" = game.team_score_mode === "aggregate" ? "aggregate" : "best_ball";
  const trifectaStandings = (() => {
    if (!isTeam || !isTrifecta) return null;
    const pts: Record<string, number> = { A: 0, B: 0 };
    foursomes.forEach((f) => {
      if (!f.a.length || !f.b.length) return;
      const ta = playerOf(f.a[0])?.team, tb = playerOf(f.b[0])?.team;
      if (!ta || !tb || ta === tb) return;
      const r = computeTrifecta(game.holes_meta, members4(f), f.a, f.b, game.allowance_pct ?? 100, teamScoreMode, !!f.swap);
      pts[ta] = (pts[ta] ?? 0) + r.aPts;
      pts[tb] = (pts[tb] ?? 0) + r.bPts;
    });
    return pts;
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
      <Eyebrow>{isTrifecta ? (teamScoreMode === "aggregate" ? "TRIFECTA · SHOOTOUT" : "TRIFECTA") : "FOUR-BALL MATCHES"}</Eyebrow>
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
        const st = full ? fourballStatus(game.holes_meta, ms, f.a, f.b, game.allowance_pct ?? 100) : null;
        const myKey = players.find((p) => p.user_id === user.id)?.user_id ?? user.id;
        const mine = f.a.includes(myKey) || f.b.includes(myKey);
        const lead = st?.lead ?? 0;
        const leadText = !st || st.thru === 0 ? "" : lead === 0 ? "All square" : `${firstName(lead > 0 ? f.a[0] : f.b[0])}'s pair ${Math.abs(lead)} UP`;
        const tri = isTrifecta && full ? computeTrifecta(game.holes_meta, ms, f.a, f.b, game.allowance_pct ?? 100, teamScoreMode, !!f.swap) : null;
        return (
          <div key={f.id} style={{ background: C.card, borderRadius: 12, padding: 14, marginTop: 12, border: mine ? `1px solid ${C.gold}` : "none" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <div style={{ color: C.ink, fontWeight: 800, fontSize: 15 }}>{f.name}{mine ? " · your match" : ""}</div>
              <div style={{ flex: 1 }} />
              <div style={{ color: C.green, fontWeight: 800, fontSize: 14, fontFamily: "Georgia, serif" }}>{isTrifecta ? (tri ? `${fmtPts(tri.aPts)}–${fmtPts(tri.bPts)}` : "—") : st ? st.result : "—"}</div>
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
                        <span style={{ color: C.gold, fontWeight: 800, fontSize: 13, fontFamily: "Georgia, serif", minWidth: 46, textAlign: "right" }}>{fmtPts(c.aPts)}–{fmtPts(c.bPts)}</span>
                      </div>
                      {isOpen && <HoleDetail rows={c.perHole} aLabel={aLabel} bLabel={bLabel} aColor={aColor} bColor={bColor} />}
                    </React.Fragment>
                  );
                })}
                {isTeam && (
                  <div style={{ color: C.faint, fontSize: 11, marginTop: 6 }}>
                    {teamName(playerOf(f.a[0])?.team)} {fmtPts(tri.aPts)} · {fmtPts(tri.bPts)} {teamName(playerOf(f.b[0])?.team)}
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

  const needsStructure = ["match", "fourball", "trifecta"].includes(game.game_type) || (game.game_type === "skins" && !!teams);
  const hasStructure = pairings.length > 0 || foursomes.length > 0;
  if (!needsStructure && !hasStructure) return null;

  const oneVone = (aId: string, bId: string, key: string) => {
    const a = byKey(aId), b = byKey(bId);
    if (!a || !b) return null;
    const allow = matchAllowance(chBasis(a, game.course_par), chBasis(b, game.course_par), allowance);
    return (
      <div key={key} style={{ borderTop: "1px solid rgba(255,255,255,0.10)", padding: "10px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1, color: C.cream, fontSize: 15, fontWeight: 600 }}>{a.display_name} <span style={{ color: C.sage, fontSize: 12, fontWeight: 400 }}>ph {phStr(a)}</span></span>
          <span style={{ color: C.faint, fontSize: 12 }}>vs</span>
          <span style={{ flex: 1, textAlign: "right", color: C.cream, fontSize: 15, fontWeight: 600 }}><span style={{ color: C.sage, fontSize: 12, fontWeight: 400 }}>ph {phStr(b)}</span> {b.display_name}</span>
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
              <div style={{ display: "flex", justifyContent: "space-between", color: C.cream, fontSize: 14 }}><span>{p.display_name}</span><span style={{ color: C.sage }}>ph {phStr(p)}</span></div>
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
  const totalUnits = pairings.length + foursomes.length;
  const myUnits = pairings.filter(pairingMine).length + foursomes.filter(foursomeMine).length;
  const canFilter = !!meKey && myUnits > 0;
  const showToggle = canFilter && totalUnits > myUnits;

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
      {showAll ? "▴ Show my group" : `▾ Show all ${totalUnits} groups`}
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
                <div style={{ color: C.gold, fontSize: 9, fontWeight: 800, letterSpacing: 1 }}>YOUR GROUP</div>
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
function GroupsBuilder({ game, players, onSetTeeGroup }: {
  game: Game; players: Player[];
  onSetTeeGroup: (p: Player, group: number | null) => Promise<void>;
}) {
  const byKey = (k: string) => players.find((p) => pkey(p) === k) || null;
  const groupOptions = Array.from({ length: Math.max(2, Math.ceil(players.length / 2) + 1) }, (_, i) => i + 1);

  type Unit = { id: string; label: string; members: Player[] };
  const pairings = Array.isArray(game.pairings) ? game.pairings : [];
  const foursomes = Array.isArray(game.foursomes) ? game.foursomes : [];
  let units: Unit[];
  if (foursomes.length) {
    units = foursomes.map((f, i) => ({
      id: f.id || `f${i}`,
      label: f.name || `Foursome ${i + 1}`,
      members: [...f.a, ...f.b].map(byKey).filter((p): p is Player => !!p),
    }));
  } else if (pairings.length) {
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
                  {mem.map((p) => <div key={p.id}>{p.display_name}</div>)}
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
  onAddGuest?: (name: string, hcp: number) => Promise<void>;
  onSetAllowance?: (pct: number) => Promise<void>;
  onSetFormat?: (f: "stableford" | "match" | "fourball" | "skins" | "trifecta") => Promise<void>;
  onSetTeamScoreMode?: (m: "best_ball" | "aggregate") => Promise<void>;
  anyScores?: boolean;
}) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [nameEdit, setNameEdit] = useState(game.name);
  const [addMemberId, setAddMemberId] = useState("");
  const [addGuestName, setAddGuestName] = useState("");
  const [addGuestHcp, setAddGuestHcp] = useState("");


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
  const canSwitchTo = (target: "stableford" | "match" | "fourball" | "skins" | "trifecta") => {
    if (target === game.game_type) return false;
    if (!anyScores) return true;
    if (target === "stableford" || target === "skins") return true;
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
                  <div style={{ color: C.sage, fontSize: 11, letterSpacing: 2, fontWeight: 700 }}>ADD FROM YOUR GROUP</div>
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
                    <button
                      disabled={!addGuestName.trim() || addGuestHcp === ""}
                      onClick={async () => {
                        if (onAddGuest) { await onAddGuest(addGuestName, parseFloat(addGuestHcp)); setAddGuestName(""); setAddGuestHcp(""); }
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
                  {([["stableford", "Stableford"], ["match", "Match"], ["fourball", "Four-ball"], ["skins", "Skins"], ["trifecta", "Trifecta"]] as const).map(([key, label]) => {
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

            {game.status !== "ended" && game.game_type === "trifecta" && onSetTeamScoreMode && (
              <div style={{ marginTop: 12 }}>
                <div style={{ color: C.sage, fontSize: 12 }}>Team point</div>
                <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  <button onClick={() => onSetTeamScoreMode("best_ball")} style={{ ...btn((game.team_score_mode ?? "best_ball") === "best_ball"), fontSize: 13, padding: "7px 12px" }}>Best ball</button>
                  <button onClick={() => onSetTeamScoreMode("aggregate")} style={{ ...btn(game.team_score_mode === "aggregate"), fontSize: 13, padding: "7px 12px" }}>Shootout</button>
                </div>
                <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>
                  {game.team_score_mode === "aggregate"
                    ? "Shootout: both partners' net scores are added for the team point — a blow-up by either player hurts."
                    : "Best ball: the team point uses the better net of the two partners."}
                </div>
              </div>
            )}
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
function BettingPanel({ players, playerPoints, playerHoles }: {
  players: Player[];
  playerPoints: (p: Player) => number;
  playerHoles: (p: Player) => Hole[];
}) {
  const [open, setOpen] = useState(false);
  const [bet, setBet] = useState(75);
  const [inIds, setInIds] = useState<string[]>(players.map((p) => p.id));
  const [split, setSplit] = useState<BetSplit>(DEFAULT_BET_SPLIT);
  const [editSplit, setEditSplit] = useState(false);

  // Keep the bettor list in sync as players join (default: everyone in).
  useEffect(() => {
    setInIds((prev) => {
      const ids = players.map((p) => p.id);
      const kept = prev.filter((id) => ids.includes(id));
      const added = ids.filter((id) => !prev.includes(id));
      // On first mount prev may be the full list already; just union new players.
      return Array.from(new Set([...kept, ...added]));
    });
  }, [players.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) =>
    setInIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

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
  const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;

  return (
    <div style={{ marginTop: 18, background: C.greenLight, borderRadius: 14, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => setOpen((v) => !v)}>
        <div style={{ color: C.gold, fontSize: 11, letterSpacing: 3, fontWeight: 800 }}>💰 BETTING (TGC)</div>
        <div style={{ flex: 1 }} />
        <span style={{ color: C.sage, fontSize: 16 }}>{open ? "▾" : "▸"}</span>
      </div>

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
            <div style={{ color: C.sage, fontSize: 12, marginBottom: 6 }}>Who's betting ({inIds.length}):</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {players.map((p) => {
                const on = inIds.includes(p.id);
                return (
                  <button key={p.id} onClick={() => toggle(p.id)}
                    style={{ ...btn(on), fontSize: 12, padding: "6px 10px", opacity: on ? 1 : 0.5 }}>
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
                Each six: {pct(split.segPct)} · 2nd: {pct(split.secondPct)} · 1st: {pct(split.firstPct)}
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
        </div>
      )}
    </div>
  );
}
