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
  type FourballMember,
  computeSkins,
  type SkinPlayer,
  computeBetting,
  DEFAULT_BET_SPLIT,
  TGC_GROUP_ID,
  type BetPlayer,
  type BetSplit,
} from "@/lib/golf";
import { loadCoursesForGroup } from "@/lib/courses";
import { logActivity } from "@/lib/activity";
import { saveActiveGame, loadActiveGame, clearActiveGame, saveGameScores, loadGameScores } from "@/lib/draft";
import {
  btn,
  inputStyle,
  Eyebrow,
  NumPicker,
  ScoreEntryCard,
  ShortDateInput,
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
  game_type: "stableford" | "match" | "fourball" | "skins";
  allowance_pct?: number | null; // handicap allowance % applied to net scoring
  marker_user_id?: string | null; // the player currently keeping score for the group
  pairings: { a: string; b: string }[]; // for match play: user_id vs user_id
  status?: "active" | "ended" | null;
  teams?: { key: string; name: string }[] | null; // two named teams for team match play
  foursomes?: { id: string; name: string; a: string[]; b: string[] }[] | null; // four-ball: pair A vs pair B
  created_by: string;
  created_at: string;
};

type Player = {
  id: string;
  game_id: string;
  user_id: string | null; // null for guest players (no account)
  display_name: string;
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
};

// Stable match identity for a player. Real players key on user_id (so nothing
// about existing matches changes); guests have no account, so they key on their
// game_players row id. Used everywhere pairings/foursomes store or look up a
// player, so guests can be assigned to teams and matches like anyone.
const pkey = (p: { user_id: string | null; id: string }) => p.user_id ?? p.id;

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
        // Borrow course rating/slope/tee from an existing player so handicaps can compute.
        const { data: others } = await supabase
          .from("game_players")
          .select("rating,slope,tee_name")
          .eq("game_id", game.id)
          .not("rating", "is", null)
          .limit(1);
        const ref = others && others[0] ? others[0] : {};
        const n = game.holes_meta.length;
        const { error: e2 } = await supabase.from("game_players").insert({
          game_id: game.id,
          user_id: uid,
          display_name: displayName,
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
  const [gameType, setGameType] = useState<"stableford" | "match" | "fourball" | "skins">(
    "stableford",
  );
  // Handicap allowance % (playing handicap = allowance% of course handicap).
  // Default 85 for four-ball, 100 otherwise. Resets to the standard when the
  // format changes; editable any time.
  const [allowancePct, setAllowancePct] = useState(100);
  useEffect(() => { setAllowancePct(gameType === "fourball" ? 85 : 100); }, [gameType]);
  const [teamMode, setTeamMode] = useState(false);
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

  useEffect(() => {
    loadCoursesForGroup(supabase, activeGroupId).then((data) => {
      if (data)
        setFavorites(
          data.map((f: any) => {
            const d = f.data || {};
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
          }),
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
      const typeLabel = gameType === "match" ? "Match Play" : gameType === "fourball" ? "Four-Ball" : gameType === "skins" ? "Skins" : "Stableford";
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
            gameType === "match" && teamMode
              ? [
                  { key: "A", name: team1.trim() || "Team 1" },
                  { key: "B", name: team2.trim() || "Team 2" },
                ]
              : null,
          foursomes: gameType === "fourball" ? [] : null,
        })
        .select()
        .single();
      if (error || !game) throw error || new Error("Could not create game");
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
      const rows = selectedRoster.map((p) => {
        const playerIndex = p.id === user.id ? idxVal : p.handicap_index;
        const playerCourseHandicap =
          playerIndex != null && coursePar != null
            ? courseHandicap(playerIndex, tee.slope, tee.rating, coursePar)
            : null;
        return {
          game_id: game.id,
          user_id: p.id,
          display_name: p.display_name || "Player",
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
      const { error: e2 } = await supabase.from("game_players").insert(rows);
      if (e2) throw e2;
      await logActivity(supabase, { actor_id: user.id, actor_name: displayName, action: "game_created", group_id: activeGroupId, summary: `Created the game "${game.name}" at ${pickedFav.name}` });
      for (const row of rows) {
        if (row.user_id !== user.id) {
          try {
            await supabase
              .from("notifications")
              .insert({
                user_id: row.user_id,
                group_id: activeGroupId,
                message: `You've been added to the game "${game.name}". Open the Games tab to enter your scores (code ${game.code}).`,
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
        <label style={{ color: C.sage, fontSize: 12 }}>
          Players from this group
        </label>
        <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>
          Add players now so they see the game automatically. You can still
          share the code later if needed.
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
                  gap: 10,
                  padding: "8px 4px",
                  cursor: isMe ? "default" : "pointer",
                  borderBottom: `1px solid ${C.greenMid}`,
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
                />
                <span style={{ flex: 1, color: C.cream, fontWeight: 700 }}>
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
            onClick={() => { setGameType("fourball"); setTeamMode(false); }}
            style={{ ...btn(gameType === "fourball"), flex: 1, minWidth: 120, fontSize: 13 }}
          >
            Four-ball (best net)
          </button>
          <button
            onClick={() => { setGameType("skins"); setTeamMode(false); }}
            style={{ ...btn(gameType === "skins"), flex: 1, minWidth: 120, fontSize: 13 }}
          >
            Skins (net)
          </button>
        </div>
        <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>
          {gameType === "stableford"
            ? "Everyone competes on one net-Stableford leaderboard."
            : gameType === "fourball"
            ? "2-player teams play better-net-ball match play. Big groups split into foursomes (2 v 2) — set them up after creating. Great for 12–16 players in 3–4 foursomes."
            : gameType === "skins"
            ? "Lowest net score on a hole wins the skin. A tie carries the skin to the next hole, so the pot builds until someone wins outright."
            : "Players are paired 1-on-1. After friends join, you'll set the matchups. Lower handicap plays off scratch; opponent gets the difference."}
        </div>
        {gameType === "match" && (
          <div style={{ background: C.greenLight, borderRadius: 12, padding: 12, marginTop: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={teamMode} onChange={(e) => setTeamMode(e.target.checked)} />
              <span style={{ color: C.cream, fontWeight: 700, fontSize: 14 }}>Team match (e.g. 4 v 4)</span>
            </label>
            <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>
              Two teams. Each 1-on-1 pairing is worth a point; the team total is the sum (halved matches = ½ each). You'll assign players to teams after creating.
            </div>
            {teamMode && (
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <input style={{ ...inputStyle, flex: 1, minWidth: 130 }} value={team1} onChange={(e) => setTeam1(e.target.value)} placeholder="Team 1 name" />
                <input style={{ ...inputStyle, flex: 1, minWidth: 130 }} value={team2} onChange={(e) => setTeam2(e.target.value)} placeholder="Team 2 name" />
              </div>
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
  const [cardView, setCardView] = useState(false); // show the whole-group vertical scorecard
  // When group scoring is switched on, bring everyone to the group card.
  useEffect(() => { if (game?.marker_user_id && game?.game_type !== "stableford") setCardView(true); }, [game?.marker_user_id, game?.game_type]);

  // ---- Tee groups (foursomes that play together, each with its own marker) ----
  const myRow = players.find((p) => p.user_id === user.id) || null;
  const teeGroupsInUse = players.some((p) => p.tee_group != null);
  const teeGroupList = Array.from(new Set(players.map((p) => p.tee_group).filter((g): g is number => g != null))).sort((a, b) => a - b);
  const [viewGroup, setViewGroup] = useState<number | null>(null);
  useEffect(() => {
    if (!teeGroupsInUse) return;
    setViewGroup((cur) => (cur != null && teeGroupList.includes(cur)) ? cur : (myRow?.tee_group ?? teeGroupList[0] ?? null));
  }, [teeGroupsInUse, myRow?.tee_group, teeGroupList.join(",")]);
  // A marker lands on the group card automatically.
  useEffect(() => { if (myRow?.is_marker && game?.game_type !== "stableford") setCardView(true); }, [myRow?.is_marker, game?.game_type]);
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
    let mine = (ps || []).find((p: any) => p.user_id === user.id) || null;
    // Reconcile against the local backup: if a score write was lost to a screen
    // lock, the device's backup may hold holes the DB row is missing. Merge those
    // in (local fills holes the DB left blank) and push the result back to the DB.
    if (mine) {
      const backup = loadGameScores(gameId, mine.id);
      if (backup) {
        const n = (safeGame as any)?.holes_meta?.length || 18;
        const mergeArr = (dbArr: any[], locArr: any[]) =>
          Array.from({ length: n }, (_, i) => {
            const d = dbArr?.[i] ?? null;
            return d != null ? d : (locArr?.[i] ?? null);
          });
        const merged = {
          scores: mergeArr(mine.scores || [], backup.scores || []),
          putts: mergeArr(mine.putts || [], backup.putts || []),
          fairways: mergeArr(mine.fairways || [], backup.fairways || []),
        };
        const dbCount = (mine.scores || []).filter((s: any) => s != null).length;
        const mergedCount = merged.scores.filter((s: any) => s != null).length;
        if (mergedCount > dbCount) {
          mine = { ...mine, ...merged };
          await supabase.from("game_players").update(merged).eq("id", mine.id);
        }
        saveGameScores(gameId, mine.id, { scores: mine.scores || [], putts: mine.putts || [], fairways: mine.fairways || [] });
      }
    }
    setPlayers((ps || []).map((p: any) => (mine && p.id === mine.id ? mine : p)));
    setMe(mine);
    if (mine && mine.course_handicap == null && (safeGame as any)?.holes_meta?.length)
      setNeedsSetup(true);
    setLoading(false);
  }, [gameId, user.id]);
  useEffect(() => {
    load();
  }, [load]);

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
  useEffect(() => {
    const flush = () => {
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

  // Build a player's per-hole Hole[] (with strokes received) for scoring math.
  const playerHoles = (p: Player): Hole[] => {
    if (!game) return [];
    const alloc = allocateStrokes(
      game.holes_meta.map((m) => ({ hole_number: m.n, stroke_index: m.si })),
      applyAllowance(p.course_handicap, game.allowance_pct ?? 100),
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
    const updated = { ...me, scores, putts, fairways, penalties, sand };
    setMe(updated);
    setPlayers((ps) => ps.map((p) => (p.id === me.id ? updated : p)));
    // Synchronous local backup FIRST — survives an immediate lock even if the
    // network write below gets frozen. Reconciled to the DB on next load.
    if (game) saveGameScores(game.id, me.id, { scores, putts, fairways });
    setSavingHole(holeIdx);
    lastEditRef.current = Date.now();
    await supabase
      .from("game_players")
      .update({ scores, putts, fairways, penalties, sand })
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
    const updated = { ...target, scores, putts, fairways, penalties, sand };
    setPlayers((ps) => ps.map((p) => (p.id === playerId ? updated : p)));
    if (target.id === me?.id) setMe(updated);
    lastEditRef.current = Date.now();
    await supabase.from("game_players").update({ scores, putts, fairways, penalties, sand }).eq("id", playerId);
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
    if (p.user_id !== user.id) {
      try {
        await supabase
          .from("notifications")
          .insert({
            user_id: p.user_id,
            message: `Your handicap for "${game.name}" was set to ${idxVal ?? "—"} (course handicap ${ch ?? "—"}) by the organizer.`,
          });
      } catch {}
    }
    await load();
  };

  // Organizer: add a registered player straight into the game (auto-joined), seeded with their handicap.
  const addRegisteredPlayer = async (prof: {
    id: string;
    display_name: string;
    handicap_index: number | null;
  }) => {
    if (!game) return;
    if (players.some((p) => p.user_id === prof.id)) return; // already in
    const ref = players.find((x) => x.rating != null && x.slope != null);
    const rating = ref?.rating ?? null,
      slope = ref?.slope ?? null;
    const ch =
      prof.handicap_index != null &&
      rating != null &&
      slope != null &&
      game.course_par != null
        ? courseHandicap(prof.handicap_index, slope, rating, game.course_par)
        : null;
    const n = game.holes_meta.length;
    await supabase.from("game_players").insert({
      game_id: game.id,
      user_id: prof.id,
      display_name: prof.display_name || "Player",
      handicap_index: prof.handicap_index ?? null,
      rating,
      slope,
      tee_name: ref?.tee_name ?? null,
      course_handicap: ch,
      scores: Array(n).fill(null),
      putts: Array(n).fill(null),
      fairways: Array(n).fill(null),
    });
    try {
      await supabase
        .from("notifications")
        .insert({
          user_id: prof.id,
          message: `You've been added to the game "${game.name}". Open the Games tab to enter your scores (code ${game.code}).`,
        });
    } catch {}
    await load();
  };

  // Organizer: remove a player from the game (not the organizer).
  const toggleNoShow = async (p: Player) => {
    if (!game) return;
    const next = !p.no_show;
    if (next && !confirm(`Mark ${p.display_name} as a no-show? In four-ball they'll be scored net double bogey every hole (their ball won't count for the team).`)) return;
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
    await supabase.from("game_players").delete().eq("id", p.id);
    if (p.user_id !== user.id) {
      try {
        await supabase
          .from("notifications")
          .insert({
            user_id: p.user_id,
            message: `You were removed from the game "${game.name}" by the organizer.`,
          });
      } catch {}
    }
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

  // Organizer: end the game — freezes scores and shows final results.
  const endGame = async () => {
    if (!game) return;
    if (!confirm(`End "${game.name}"? Final standings are locked in and every player's scorecard is posted to their Rounds tab.`)) return;
    await supabase.rpc("finish_game", { p_game: game.id });
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

      // Duplicate guard: already have a round for this game?
      const { data: existing } = await supabase
        .from("rounds").select("id").eq("game_id", game.id).eq("user_id", me.user_id).limit(1);
      if (existing && existing.length) return;

      const gross = scores.reduce((s: number, v) => s + (v && v > 0 ? v : 0), 0);
      const { data: roundRow, error: rErr } = await supabase.from("rounds").insert({
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
        status: "final",
        gross_score: gross,
        game_id: game.id,
      }).select("id").single();
      if (rErr || !roundRow) return;

      const holeRows = (game.holes_meta || []).map((m, i) => ({
        round_id: roundRow.id,
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
            navigator.clipboard
              ?.writeText(game.code)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
              .catch(() => {});
          }}
          title="Tap to copy"
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
            {copied ? "COPIED ✓" : "SHARE CODE · TAP TO COPY"}
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

      {roomTab === "setup" && isOrganizer && (
        <OrganizerPanel
          game={game}
          players={players}
          user={user}
          onOverride={overridePlayerHandicap}
          onAdd={addRegisteredPlayer}
          onRemove={removePlayer}
          onToggleNoShow={toggleNoShow}
          onRename={renameGame}
          onDelete={deleteGame}
          onEnd={endGame}
          onReopen={reopenGame}
        />
      )}

      {roomTab === "play" && (
      <div style={{ marginTop: 16, background: isEnded ? "#3A3A3A" : game.game_type === "match" ? "#1E3A8A" : game.game_type === "fourball" ? "#1E3A8A" : C.green, borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 800 }}>
          {game.game_type === "match" ? "⛳ Singles Match Play" : game.game_type === "fourball" ? "⛳ Four-Ball Match (Best Net)" : game.game_type === "skins" ? "🪙 Skins (Net)" : "🏆 Stableford Tournament"}
        </span>
        {isEnded ? (
          <span style={{ fontSize: 12, fontWeight: 800, background: C.gold, color: "#1A1A1A", borderRadius: 20, padding: "3px 10px" }}>FINAL · GAME ENDED</span>
        ) : (
          <span style={{ color: C.cream, opacity: 0.8, fontSize: 12 }}>
            {game.game_type === "match" ? "1-on-1 pairings" : game.game_type === "fourball" ? "2 v 2 better-net-ball" : game.game_type === "skins" ? "net skins · carryovers" : "net Stableford leaderboard"}
          </span>
        )}
      </div>
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

      {roomTab === "play" && game.game_type !== "stableford" && (
        <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
          <button onClick={() => setCardView(false)} style={{ ...btn(!cardView), flex: 1, fontSize: 13 }}>Results</button>
          <button onClick={() => setCardView(true)} style={{ ...btn(cardView), flex: 1, fontSize: 13 }}>Group card</button>
        </div>
      )}
      {roomTab === "play" && game.game_type !== "stableford" && !cardView && game.marker_user_id && !isEnded && (
        <div style={{ color: C.gold, fontSize: 12, marginTop: 8 }}>
          Group scoring is on — enter and view scores on the <strong>Group card</strong>.
        </div>
      )}
      {roomTab === "setup" && isOrganizer && game.game_type !== "stableford" && (
        <TeeGroups game={game} players={players} onChanged={load} />
      )}
      {roomTab === "play" && cardView && game.game_type !== "stableford" ? (
        <>
          {teeGroupsInUse && teeGroupList.length > 1 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
              {teeGroupList.map((g) => {
                const grpPlayers = players.filter((p) => p.tee_group === g);
                const locked = grpPlayers.some((p) => p.group_locked);
                const hasMarker = grpPlayers.some((p) => p.is_marker);
                return (
                  <button key={g} onClick={() => setViewGroup(g)} style={{ ...btn(viewGroup === g), fontSize: 12, padding: "5px 12px" }}>
                    Group {g}{locked ? " 🔒" : !hasMarker ? " ·!" : ""}
                  </button>
                );
              })}
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
          />
        </>
      ) : game.game_type === "fourball" ? (
        <FourballView
          game={game}
          players={players}
          user={user}
          isCreator={game.created_by === user.id}
          mode={roomTab}
          onChanged={load}
        />
      ) : (roomTab === "play" || roomTab === "setup") && game.game_type === "match" ? (
        <MatchView
          game={game}
          players={players}
          user={user}
          isCreator={game.created_by === user.id}
          mode={roomTab}
          onChanged={load}
        />
      ) : (roomTab === "play" || roomTab === "setup") && game.game_type === "skins" ? (
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
                  <div style={{ flex: 1, minWidth: 0 }}>
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

      {/* My score entry — hidden while a marker is keeping score for the group
          (scoring then happens only on the Group card, to avoid conflicts). */}
      {roomTab === "play" && me && !(game.game_type !== "stableford" && !isEnded && (game.marker_user_id || myGroupHasMarker)) && (
        <div style={{ marginTop: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Eyebrow>{isEnded ? "YOUR FINAL SCORES" : "ENTER YOUR SCORES"}</Eyebrow>
            <div style={{ flex: 1 }} />
            <button style={{ ...btn(false), fontSize: 12, padding: "6px 12px" }} onClick={load}>⟳ Refresh</button>
          </div>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 4 }}>
            {isEnded
              ? "This game has ended — scores are locked in."
              : "Tap a hole and pick your strokes — it saves and updates the leaderboard. Tap ⟳ Refresh to see others' latest."}
          </div>
          <ScoreEntryCard
            holes={(() => {
              // In match play, dots reflect the RELATIVE allowance (strokes given/received
              // vs. the opponent), not full course handicap. Stroke-play uses full allocation.
              let matchAllow: number | null = null;
              let oppAllow: number | null = null; // opponent's allowance — used to show holes I GIVE
              if (game.game_type === "match") {
                const pr = game.pairings.find((p) => p.a === user.id || p.b === user.id);
                if (pr) {
                  const oppId = pr.a === user.id ? pr.b : pr.a;
                  const oppP = players.find((p) => pkey(p) === oppId);
                  const allowPair = matchAllowance(me.course_handicap, oppP?.course_handicap ?? null, game.allowance_pct ?? 100);
                  matchAllow = allowPair.a;
                  oppAllow = allowPair.b;
                }
              }
              const alloc = allocateStrokes(
                game.holes_meta.map((m) => ({
                  hole_number: m.n,
                  stroke_index: m.si,
                })),
                applyAllowance(me.course_handicap, game.allowance_pct ?? 100),
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
              const pr = game.pairings.find((p) => p.a === user.id || p.b === user.id);
              if (!pr) return undefined;
              const oppId = pr.a === user.id ? pr.b : pr.a;
              const oppP = players.find((p) => pkey(p) === oppId);
              return oppP?.scores || undefined;
            })()}
            oppLabel={(() => {
              if (game.game_type !== "match") return undefined;
              const pr = game.pairings.find((p) => p.a === user.id || p.b === user.id);
              if (!pr) return undefined;
              const oppId = pr.a === user.id ? pr.b : pr.a;
              const oppP = players.find((p) => pkey(p) === oppId);
              return oppP?.display_name?.split(" ")[0] || "Opp";
            })()}
            matchRun={(() => {
              if (game.game_type === "match") {
                const pr = game.pairings.find((p) => p.a === user.id || p.b === user.id);
                if (!pr) return undefined;
                const oppId = pr.a === user.id ? pr.b : pr.a;
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
                // Find my foursome and which side I'm on; compute the running team
                // best-net-ball match position from MY team's perspective.
                const f = game.foursomes.find(
                  (x: any) => (x.a || []).includes(user.id) || (x.b || []).includes(user.id),
                );
                if (!f || !f.a?.length || !f.b?.length) return undefined;
                const onA = f.a.includes(user.id);
                const myIds = onA ? f.a : f.b;
                const oppIds = onA ? f.b : f.a;
                const members = [...f.a, ...f.b].map((uid: string) => {
                  const p = players.find((pp) => pkey(pp) === uid);
                  return { id: uid, gross: p?.scores || [], ch: p?.course_handicap ?? null, noShow: !!p?.no_show };
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
function GuestManager({ game, players, onChanged }: { game: Game; players: Player[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [hcp, setHcp] = useState("");
  const [busy, setBusy] = useState(false);
  const guests = players.filter((p) => p.is_guest);
  const n = game.holes_meta.length || 18;

  const add = async () => {
    const h = parseInt(hcp, 10);
    if (!name.trim() || isNaN(h)) return;
    setBusy(true);
    await supabase.from("game_players").insert({
      game_id: game.id, user_id: null, is_guest: true,
      display_name: name.trim(), course_handicap: h,
      scores: Array(n).fill(null), putts: Array(n).fill(null), fairways: Array(n).fill(null),
    });
    setName(""); setHcp(""); setBusy(false); setOpen(false); onChanged();
  };
  const remove = async (id: string) => {
    if (!confirm("Remove this guest from the game?")) return;
    await supabase.from("game_players").delete().eq("id", id);
    onChanged();
  };

  return (
    <div style={{ marginTop: 12, borderTop: `0.5px solid ${C.line}`, paddingTop: 12 }}>
      <div style={{ color: C.sage, fontSize: 12, marginBottom: 6 }}>Guest players <span style={{ color: C.faint }}>(no app account — scored on this game only)</span></div>
      {guests.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {guests.map((g) => (
            <span key={g.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.greenLight, borderRadius: 999, padding: "4px 10px", color: C.cream, fontSize: 13 }}>
              {g.display_name} <span style={{ color: C.sage, fontSize: 11 }}>hcp {g.course_handicap}</span>
              <button onClick={() => remove(g.id)} style={{ background: "none", border: "none", color: C.birdie, cursor: "pointer", fontSize: 14, padding: 0 }}>✕</button>
            </span>
          ))}
        </div>
      )}
      {open ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Guest name" style={{ ...inputStyle, width: "auto", minWidth: 130 }} />
          <input value={hcp} onChange={(e) => setHcp(e.target.value)} inputMode="numeric" placeholder="Course hcp" style={{ ...inputStyle, width: 100 }} />
          <button onClick={add} disabled={busy} style={{ ...btn(true), fontSize: 12 }}>{busy ? "Adding…" : "Add"}</button>
          <button onClick={() => { setOpen(false); setName(""); setHcp(""); }} style={{ ...btn(false), fontSize: 12 }}>Cancel</button>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} style={{ ...btn(false), fontSize: 12 }}>+ Add guest player</button>
      )}
    </div>
  );
}

function TeeGroups({ game, players, onChanged }: { game: Game; players: Player[]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const used = Array.from(new Set(players.map((p) => p.tee_group).filter((g): g is number => g != null))).sort((a, b) => a - b);
  const usedMax = used.length ? used[used.length - 1] : 0;
  // Enough group options to cover the field as foursomes, plus one spare so you
  // can always split off another group. No artificial ceiling; also never hide a
  // group that's already in use.
  const maxGroups = Math.max(2, Math.ceil(players.length / 4) + 1, usedMax);
  const groupNums = Array.from({ length: maxGroups }, (_, i) => i + 1);

  const setGroup = async (pid: string, n: number | null) => {
    setBusy(true);
    await supabase.rpc("set_tee_group", { p_player: pid, p_group: n });
    setBusy(false);
    onChanged();
  };

  return (
    <div style={{ marginTop: 14, background: C.greenLight, borderRadius: 12, padding: 14 }}>
      <Eyebrow>TEE GROUPS</Eyebrow>
      <div style={{ color: C.sage, fontSize: 12, margin: "6px 0 10px" }}>
        Split players into the groups that tee off together. On the course, anyone in a group can tap “Keep score for this group” on the Group card — no need to assign a marker here.
      </div>
      {players.map((p) => {
        const pill = (active: boolean): React.CSSProperties => ({
          minWidth: 34, padding: "7px 11px", borderRadius: 8, textAlign: "center",
          border: `1px solid ${active ? C.gold : C.line}`, background: active ? "#3A3413" : "transparent",
          color: active ? C.gold : C.sage, fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer",
        });
        return (
          <div key={p.id} style={{ padding: "9px 0", borderTop: `0.5px solid ${C.line}` }}>
            <div style={{ color: C.cream, fontSize: 14, marginBottom: 7 }}>
              {p.display_name}{p.is_guest ? " ·G" : ""}{p.is_marker ? <span style={{ color: C.gold, fontSize: 11 }}> ★ marker</span> : null}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ color: C.faint, fontSize: 11, marginRight: 2 }}>Group:</span>
              <button onClick={() => !busy && setGroup(p.id, null)} style={{ ...pill(p.tee_group == null), minWidth: 0, padding: "7px 12px" }}>None</button>
              {groupNums.map((n) => (
                <button key={n} onClick={() => !busy && setGroup(p.id, n)} style={pill(p.tee_group === n)}>{n}</button>
              ))}
            </div>
          </div>
        );
      })}
      {used.length > 0 && (
        <div style={{ marginTop: 10, color: C.sage, fontSize: 11 }}>
          {used.map((g) => {
            const mem = players.filter((p) => p.tee_group === g);
            const marker = mem.find((p) => p.is_marker);
            return (
              <div key={g} style={{ marginTop: 4 }}>
                <strong style={{ color: C.cream }}>Group {g}:</strong> {mem.map((p) => p.display_name).join(", ")}
                {" · "}{marker ? <span style={{ color: C.gold }}>marker: {marker.display_name}</span> : <span style={{ color: C.sage }}>marker chosen on the course</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GroupScorecard({ game, players, user, isMarker, markerName, onTakeOver, onRelease, onSetHole, teeMode = false, groupLabel = "", canClaim = false, onClaimGroup, onReleaseGroup, groupLocked = false }: {
  game: Game; players: Player[]; user: any;
  isMarker: boolean; markerName: string | null;
  onTakeOver: () => void; onRelease: () => void;
  onSetHole: (playerId: string, holeIdx: number, patch: { strokes?: number | null; putts?: number | null; fairway?: "hit" | "miss" | null; penalties?: number | null; sand?: boolean | null }) => void;
  teeMode?: boolean; groupLabel?: string; canClaim?: boolean;
  onClaimGroup?: () => void; onReleaseGroup?: () => void; groupLocked?: boolean;
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
  const recvFor = (p: Player, si: number | null) => strokesReceived(si, applyAllowance(p.course_handicap, allowance));

  const teamColor = (i: number) => (i % 2 === 0 ? "#5B8DEF" : "#C9A227");
  const colTmpl = `58px repeat(${players.length}, minmax(58px, 1fr))`;
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

  const holeRow = (i: number) => {
    const m = meta[i];
    return (
      <React.Fragment key={`h${i}`}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#102E25", borderRadius: 5, padding: "4px 0" }}>
          <b style={{ color: C.cream, fontSize: 17, fontWeight: 800, lineHeight: 1 }}>{m.n}</b>
          <span style={{ color: "#8FB0A0", fontSize: 8, lineHeight: 1.25 }}>Par {m.par}</span>
          <span style={{ color: "#8FB0A0", fontSize: 8, lineHeight: 1.25 }}>{m.yards ? `${m.yards}y · ` : ""}SI {m.si ?? "–"}</span>
        </div>
        {players.map((p) => {
          const gross = p.scores?.[i] ?? null;
          const recv = recvFor(p, m.si);
          const pts = stablefordPts(gross, m.par, recv);
          return (
            <div key={p.id + i} style={{ ...cell, cursor: isMarker ? "pointer" : "default", outline: isMarker ? "1px solid #E6E0CC" : "none" }}
              onClick={isMarker ? () => { if (gross == null || gross <= 0) onSetHole(p.id, i, { strokes: m.par }); setEdit({ playerId: p.id, holeIdx: i }); } : undefined}>
              {recv > 0 && (
                <div style={{ position: "absolute", top: 3, left: 4, display: "flex", gap: 2 }}>
                  {Array.from({ length: Math.min(recv, 2) }).map((_, d) => (
                    <span key={d} style={{ width: 5, height: 5, borderRadius: 99, background: "#E8730C", display: "block" }} />
                  ))}
                </div>
              )}
              <span style={{ fontSize: 19, fontWeight: 800, color: netColor(gross, recv, m.par) }}>{gross != null && gross > 0 ? gross : "·"}</span>
              {gross != null && gross > 0 && (
                <span style={{ position: "absolute", bottom: 2, right: 3, background: C.green, color: "#fff", fontSize: 10, fontWeight: 800, padding: "0 5px", borderRadius: 6 }}>{pts ?? 0}</span>
              )}
            </div>
          );
        })}
      </React.Fragment>
    );
  };

  const aggRow = (label: string, from: number, to: number) => (
    <React.Fragment key={label}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "#0A241C", borderRadius: 5, color: "#CFE3D8", fontSize: 10, fontWeight: 800, letterSpacing: 1 }}>{label}</div>
      {players.map((p) => {
        const s = sums(p, from, to);
        return (
          <div key={p.id + label} style={agg}>
            <span>{s.g || "–"}</span>
            <span style={{ position: "absolute", bottom: 2, right: 3, background: C.green, color: "#E4CF86", fontSize: 10, fontWeight: 800, padding: "0 5px", borderRadius: 6 }}>{s.pts}</span>
          </div>
        );
      })}
    </React.Fragment>
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
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: colTmpl, gap: 3, minWidth: 300 }}>
          <div />
          {players.map((p, i) => (
            <div key={p.id} style={{ textAlign: "center", padding: "4px 2px", borderBottom: `2px solid ${teamColor(i)}` }}>
              <div style={{ color: C.cream, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {p.display_name}{p.is_guest ? " ·G" : ""}
              </div>
              <div style={{ color: C.sage, fontSize: 9 }}>hcp {p.course_handicap}</div>
            </div>
          ))}
          {meta.slice(0, half).map((_, i) => holeRow(i))}
          {meta.length > half && meta.slice(half).map((_, i) => holeRow(i + half))}
          {meta.length >= 18 && aggRow("IN", 9, 17)}
          {meta.length >= 18 && aggRow("OUT", 0, 8)}
          {aggRow("TOT", 0, meta.length - 1)}
        </div>
      </div>

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

              <button onClick={() => setEdit(null)} style={{ width: "100%", marginTop: 16, background: C.green, color: C.cream, border: "none", borderRadius: 8, padding: 11, fontWeight: 800, fontSize: 14, cursor: "pointer" }}>Done</button>
              <div style={{ color: C.faint, fontSize: 10, textAlign: "center", marginTop: 8 }}>Only the score is required. Players can add their own stats too.</div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function SkinsView({ game, players, user, isCreator, mode, onChanged }: { game: Game; players: Player[]; user: any; isCreator: boolean; mode: string; onChanged: () => void }) {
  if (mode === "setup") {
    return (
      <div style={{ marginTop: 18 }}>
        <Eyebrow>SKINS · SETUP</Eyebrow>
        <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>
          Skins is scored as individual net skins — lowest net on a hole wins, ties carry. Add any guests who'll be playing; the marker enters everyone's scores on the Group card.
        </div>
        {isCreator
          ? <GuestManager game={game} players={players} onChanged={onChanged} />
          : <div style={{ color: C.faint, fontSize: 12, marginTop: 10 }}>Only the organizer can add guests.</div>}
      </div>
    );
  }

  const nameById: Record<string, string> = {};
  players.forEach((p) => (nameById[p.id] = p.display_name));
  const skinPlayers: SkinPlayer[] = players.map((p) => ({
    id: p.id, name: p.display_name, gross: p.scores || [], ch: p.course_handicap,
  }));
  const result = computeSkins(game.holes_meta, skinPlayers, game.allowance_pct ?? 100);

  const firstUndecided = result.holes.find((h) => !h.decided);
  const carrying = firstUndecided ? firstUndecided.carriedIn : result.carryAtEnd;
  const intoHole = firstUndecided ? firstUndecided.hole : null;
  const totals = [...players].sort((a, b) => (result.skinsByPlayer[b.id] || 0) - (result.skinsByPlayer[a.id] || 0));
  const ORANGE = "#E8730C";

  return (
    <div style={{ marginTop: 18 }}>
      <Eyebrow>{`SKINS · NET${game.allowance_pct != null && game.allowance_pct !== 100 ? ` · ${game.allowance_pct}% ALLOWANCE` : ""}`}</Eyebrow>

      {carrying > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#5A3210", border: `1px solid ${ORANGE}`, borderRadius: 10, padding: "10px 12px", marginTop: 10 }}>
          <span style={{ color: ORANGE, fontSize: 18, fontWeight: 800 }}>↑</span>
          <span style={{ color: "#F2C28A", fontSize: 13 }}>
            {carrying} skin{carrying > 1 ? "s" : ""} {intoHole ? `carrying into hole ${intoHole}` : "unclaimed (last hole tied)"}
          </span>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        {totals.map((p) => {
          const n = result.skinsByPlayer[p.id] || 0;
          return (
            <div key={p.id} style={{ flex: 1, minWidth: 130, background: p.user_id === user.id ? C.cream : C.card, borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span style={{ color: C.ink, fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.display_name}{p.user_id === user.id ? " (you)" : ""}</span>
              <span style={{ color: n > 0 ? C.green : C.faint, fontWeight: 800, fontSize: 20, fontFamily: "Georgia, serif", marginLeft: 8 }}>{n}</span>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ color: C.sage, fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", padding: "0 4px 6px" }}>Hole by hole</div>
        {result.holes.map((h) => {
          const won = h.decided && h.winnerId;
          const tiedCarry = h.decided && !h.winnerId;
          return (
            <div key={h.hole} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 4px", borderBottom: `1px solid ${C.greenLight}` }}>
              <span style={{ width: 26, color: h.decided ? C.cream : C.sage, fontWeight: 700, fontSize: 13 }}>{h.hole}</span>
              <span style={{ flex: 1, color: won ? C.cream : C.sage, fontSize: 13 }}>
                {won ? `${nameById[h.winnerId!] || "—"} · net ${h.netById[h.winnerId!]}` : tiedCarry ? "Tied — carries" : "Not played yet"}
              </span>
              {won ? (
                <span style={{ background: C.greenLight, color: C.gold, fontSize: 12, padding: "3px 9px", borderRadius: 999 }}>{h.value} skin{h.value > 1 ? "s" : ""}</span>
              ) : tiedCarry ? (
                <span style={{ background: "#5A3210", color: ORANGE, fontSize: 12, padding: "3px 9px", borderRadius: 999 }}>push →</span>
              ) : (
                <span style={{ color: C.faint, fontSize: 12 }}>{h.value} at stake</span>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ color: C.sage, fontSize: 10, marginTop: 8 }}>
        Lowest net on a hole wins the skin; ties carry it to the next hole. Enter your scores below.
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

  const addPairing = async () => {
    if (!aSel || !bSel || aSel === bSel) return;
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
      const st = matchStatus(game.holes_meta, pa.scores || [], pb.scores || [], pa.course_handicap, pb.course_handicap, game.allowance_pct ?? 100);
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
              <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 700 }}>{teams![0].name}</div>
              <div style={{ color: teamStandings.pts.A >= teamStandings.pts.B ? "#FFE08A" : C.cream, fontSize: 40, fontWeight: 800, fontFamily: "Georgia, serif", lineHeight: 1 }}>{fmtPts(teamStandings.pts.A)}</div>
            </div>
            <div style={{ color: C.cream, fontSize: 18, opacity: 0.7, padding: "0 8px" }}>–</div>
            <div style={{ flex: 1, textAlign: "center" }}>
              <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 700 }}>{teams![1].name}</div>
              <div style={{ color: teamStandings.pts.B >= teamStandings.pts.A ? "#FFE08A" : C.cream, fontSize: 40, fontWeight: 800, fontFamily: "Georgia, serif", lineHeight: 1 }}>{fmtPts(teamStandings.pts.B)}</div>
            </div>
          </div>
          <div style={{ color: C.cream, opacity: 0.7, fontSize: 11, textAlign: "center", marginTop: 8 }}>
            Projected from current match states · {fmtPts(teamStandings.decidedPts.A)}–{fmtPts(teamStandings.decidedPts.B)} decided
          </div>
        </div>
      )}

      {/* Organizer: assign players to teams */}
      {mode === "setup" && isTeam && isCreator && (
        <div style={{ background: C.greenLight, borderRadius: 12, padding: 14, marginBottom: 16 }}>
          <Eyebrow>ASSIGN TEAMS</Eyebrow>
          {players.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: `1px solid ${C.greenMid}` }}>
              <div style={{ flex: 1, color: C.cream, fontWeight: 700, fontSize: 14 }}>{p.display_name}</div>
              {teams!.map((t) => (
                <button key={t.key} onClick={() => assignTeam(p, t.key)}
                  style={{ ...btn(p.team === t.key), fontSize: 11, padding: "5px 10px" }}>{t.name}</button>
              ))}
            </div>
          ))}
          <div style={{ color: C.sage, fontSize: 11, marginTop: 8 }}>Assign each player to a team, then set the 1-on-1 matchups below (pair players from opposite teams).</div>
        </div>
      )}

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
              <option value="">Player A…</option>
              {unpaired.map((p) => (
                <option key={pkey(p)} value={pkey(p)}>
                  {p.display_name}
                </option>
              ))}
            </select>
            <span style={{ color: C.sage }}>vs</span>
            <select
              value={bSel}
              onChange={(e) => setBSel(e.target.value)}
              style={{ ...inputStyle, width: "auto", minWidth: 130 }}
            >
              <option value="">Player B…</option>
              {unpaired.filter((p) => pkey(p) !== aSel).map((p) => (
                <option key={pkey(p)} value={pkey(p)}>
                  {p.display_name}
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
          {unpaired.length > 0 && (
            <div style={{ color: C.faint, fontSize: 11, marginTop: 8 }}>
              Not yet paired: {unpaired.map((p) => p.display_name).join(", ")}
            </div>
          )}
        </div>
      )}

      {mode === "setup" && isCreator && (
        <GuestManager game={game} players={players} onChanged={onChanged} />
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
        const allow = matchAllowance(pa.course_handicap, pb.course_handicap, game.allowance_pct ?? 100);
        const leader =
          st.lead > 0 ? pa.display_name : st.lead < 0 ? pb.display_name : null;
        const statusText = st.result
          ? `${leader} wins ${st.result}`
          : st.lead === 0
            ? "All square"
            : `${leader} ${Math.abs(st.lead)} UP`;
        const iAmIn = pr.a === user.id || pr.b === user.id;
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
  const playerOf = (uid: string) => players.find((p) => pkey(p) === uid) || null;
  const nameOf = (uid: string) => playerOf(uid)?.display_name || "—";
  const firstName = (uid: string) => (playerOf(uid)?.display_name || "—").split(" ")[0];

  const saveFoursomes = async (next: typeof foursomes) => {
    await supabase.from("games").update({ foursomes: next }).eq("id", game.id);
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
      return { id: uid, gross: p?.scores || [], ch: p?.course_handicap ?? null, noShow: !!(p as any)?.no_show };
    });

  if (mode === "setup") {
    return (
      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <Eyebrow>FOURSOMES (2 v 2)</Eyebrow>
          <div style={{ flex: 1 }} />
          {isCreator && <button style={{ ...btn(true), fontSize: 12 }} onClick={addFoursome}>+ Add foursome</button>}
        </div>
        <div style={{ color: C.sage, fontSize: 12, marginTop: 6 }}>
          Each foursome is a 2-v-2 better-net-ball match. Put 2 players in each pair. Big groups: add a foursome per group of four.
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
                <div style={{ color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>{team === "a" ? "PAIR 1" : "PAIR 2"}</div>
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
                    {unplaced.map((p) => <option key={p.id} value={pkey(p)}>{p.display_name}</option>)}
                  </select>
                )}
              </div>
            ))}
          </div>
        ))}

        {unplaced.length > 0 && (
          <div style={{ color: C.sage, fontSize: 11, marginTop: 10 }}>
            Unassigned: {unplaced.map((p) => p.display_name).join(", ")}
          </div>
        )}
        {isCreator && <GuestManager game={game} players={players} onChanged={onChanged} />}
      </div>
    );
  }

  // Play mode: foursome match cards.
  return (
    <div style={{ marginTop: 16 }}>
      <Eyebrow>FOUR-BALL MATCHES</Eyebrow>
      {foursomes.length === 0 && (
        <div style={{ background: C.greenLight, borderRadius: 12, padding: 18, marginTop: 12, color: C.sage }}>
          No foursomes set yet. {isCreator ? "Open Game setup to build them." : "Waiting for the organizer to set up the foursomes."}
        </div>
      )}
      {foursomes.map((f) => {
        const ms = members4(f);
        const full = f.a.length && f.b.length;
        const st = full ? fourballStatus(game.holes_meta, ms, f.a, f.b, game.allowance_pct ?? 100) : null;
        const mine = f.a.includes(user.id) || f.b.includes(user.id);
        const lead = st?.lead ?? 0;
        const leadText = !st || st.thru === 0 ? "" : lead === 0 ? "All square" : `${firstName(lead > 0 ? f.a[0] : f.b[0])}'s pair ${Math.abs(lead)} UP`;
        return (
          <div key={f.id} style={{ background: C.card, borderRadius: 12, padding: 14, marginTop: 12, border: mine ? `1px solid ${C.gold}` : "none" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <div style={{ color: C.ink, fontWeight: 800, fontSize: 15 }}>{f.name}{mine ? " · your match" : ""}</div>
              <div style={{ flex: 1 }} />
              <div style={{ color: C.green, fontWeight: 800, fontSize: 14, fontFamily: "Georgia, serif" }}>{st ? st.result : "—"}</div>
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
            {st && st.thru > 0 && (
              <div style={{ color: C.faint, fontSize: 11, marginTop: 6 }}>{leadText} · thru {st.thru}</div>
            )}
            {!full && <div style={{ color: C.faint, fontSize: 11, marginTop: 6 }}>Needs players in both pairs.</div>}
          </div>
        );
      })}
    </div>
  );
}


// ---------------- Organizer panel (game creator) ----------------
// Lets the game's creator manage the roster, handicaps, and the game itself.
function OrganizerPanel({
  game,
  players,
  user,
  onOverride,
  onAdd,
  onRemove,
  onToggleNoShow,
  onRename,
  onDelete,
  onEnd,
  onReopen,
}: {
  game: Game;
  players: Player[];
  user: any;
  onOverride: (p: Player, idx: number | null) => Promise<void>;
  onAdd: (prof: {
    id: string;
    display_name: string;
    handicap_index: number | null;
  }) => Promise<void>;
  onRemove: (p: Player) => Promise<void>;
  onToggleNoShow: (p: Player) => Promise<void>;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onEnd: () => Promise<void>;
  onReopen: () => Promise<void>;
}) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [roster, setRoster] = useState<
    { id: string; display_name: string; handicap_index: number | null }[]
  >([]);
  const [showAdd, setShowAdd] = useState(false);
  const [nameEdit, setNameEdit] = useState(game.name);

  // Load registered players not already in this game.
  useEffect(() => {
    if (!showAdd) return;
    (async () => {
      const { data } = await supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", game.group_id)
        .eq("status", "active");
      const ids = (data || []).map((r: any) => r.user_id).filter(Boolean);
      const { data: profs } = ids.length
        ? await supabase
            .from("profiles")
            .select("id, display_name, handicap_index")
            .in("id", ids)
        : ({ data: [] as any[] } as any);
      const inGame = new Set(players.map((p) => p.user_id));
      setRoster((profs || []).filter((p: any) => !inGame.has(p.id)));
    })();
  }, [showAdd, players]);

  const withHcp = players.filter((p) => p.course_handicap != null).length;
  const allSet = players.length > 0 && withHcp === players.length;

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
          {/* Add registered players */}
          <button
            style={{ ...btn(true), fontSize: 13 }}
            onClick={() => setShowAdd((v) => !v)}
          >
            {showAdd ? "Done adding" : "＋ Add players"}
          </button>
          {showAdd && (
            <div
              style={{
                background: C.card,
                borderRadius: 10,
                padding: 12,
                marginTop: 8,
              }}
            >
              <div style={{ color: C.faint, fontSize: 12, marginBottom: 6 }}>
                Tap a registered player to add them straight into the game.
                They'll be notified and can open it from their Games tab (or
                with the code {game.code}).
              </div>
              {roster.length === 0 && (
                <div style={{ color: C.faint, fontSize: 13 }}>
                  No other registered players to add.
                </div>
              )}
              {roster.map((r) => (
                <div
                  key={r.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 4px",
                    borderBottom: `1px solid ${C.line}`,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ color: C.ink, fontWeight: 700 }}>
                      {r.display_name || "Player"}
                    </div>
                    <div style={{ color: C.faint, fontSize: 12 }}>
                      {r.handicap_index != null
                        ? `index ${r.handicap_index}`
                        : "no handicap on file"}
                    </div>
                  </div>
                  <button
                    style={{ ...btn(true), padding: "6px 12px", fontSize: 12 }}
                    onClick={() => onAdd(r)}
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Current players */}
          {players.map((p) => (
            <div
              key={p.id}
              style={{
                background: C.card,
                borderRadius: 10,
                padding: "10px 14px",
                marginTop: 8,
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: 1, minWidth: 150 }}>
                <div style={{ color: C.ink, fontWeight: 700 }}>
                  {p.display_name}
                  {p.user_id === game.created_by ? " (organizer)" : ""}
                </div>
                <div style={{ color: C.faint, fontSize: 12 }}>
                  {p.course_handicap != null
                    ? `course handicap ${p.course_handicap}`
                    : "no handicap yet"}
                  {p.rating != null && p.slope != null
                    ? ` · ${p.rating}/${p.slope}`
                    : ""}
                </div>
              </div>
              <div>
                <label style={{ color: C.sage, fontSize: 10 }}>
                  Handicap index
                </label>
                <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                  <input
                    inputMode="decimal"
                    defaultValue={
                      p.handicap_index != null ? String(p.handicap_index) : ""
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || /^\d*\.?\d*$/.test(v))
                        setEdits((m) => ({ ...m, [p.id]: v }));
                    }}
                    style={{
                      ...inputStyle,
                      padding: "6px 8px",
                      width: 80,
                      textAlign: "center",
                    }}
                  />
                  <button
                    style={{
                      ...btn(true),
                      padding: "6px 12px",
                      fontSize: 12,
                      opacity: savingId === p.id ? 0.5 : 1,
                    }}
                    disabled={savingId === p.id}
                    onClick={() => save(p)}
                  >
                    Set
                  </button>
                </div>
              </div>
              {game.game_type === "fourball" && (
                <button
                  title="Mark no-show (scored net double bogey)"
                  style={{
                    background: p.no_show ? C.gold : "none",
                    border: `1px solid ${p.no_show ? C.gold : C.line}`,
                    borderRadius: 6,
                    color: p.no_show ? C.green : C.sage,
                    fontWeight: 800,
                    cursor: "pointer",
                    padding: "6px 10px",
                    fontSize: 13,
                    marginRight: 8,
                  }}
                  onClick={() => onToggleNoShow(p)}
                >
                  {p.no_show ? "No-show ✓" : "No-show"}
                </button>
              )}
              {p.user_id !== game.created_by && (
                <button
                  title="Remove player"
                  style={{
                    background: "none",
                    border: `1px solid ${C.line}`,
                    borderRadius: 6,
                    color: C.birdie,
                    fontWeight: 800,
                    cursor: "pointer",
                    padding: "6px 10px",
                    fontSize: 13,
                  }}
                  onClick={() => onRemove(p)}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          <div style={{ color: C.sage, fontSize: 11, marginTop: 8 }}>
            You can add or remove players and set anyone's handicap at any time.
            Players are notified of changes.
          </div>

          {/* Game settings */}
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
