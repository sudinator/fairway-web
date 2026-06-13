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
  fourballStatus,
  type FourballMember,
} from "@/lib/golf";
import { loadCoursesForGroup } from "@/lib/courses";
import { logActivity } from "@/lib/activity";
import { saveActiveGame, loadActiveGame, clearActiveGame } from "@/lib/draft";
import {
  btn,
  inputStyle,
  Eyebrow,
  NumPicker,
  ScoreEntryCard,
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
  holes_meta: { n: number; par: number; si: number | null }[]; // par + stroke index per hole
  game_type: "stableford" | "match" | "fourball";
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
  user_id: string;
  display_name: string;
  handicap_index: number | null;
  rating: number | null;
  slope: number | null;
  tee_name: string | null;
  course_handicap: number | null;
  scores: (number | null)[]; // strokes per hole
  putts: (number | null)[]; // putts per hole
  fairways: ("hit" | "miss" | null)[]; // fairway result per hole (par 4/5)
  team?: string | null; // team key ("A"/"B") for team match play
};

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
      <div style={{ background: C.greenLight, borderRadius: 14, padding: 18 }}>
        <Eyebrow>JOIN A GAME</Eyebrow>
        <div style={{ color: C.sage, fontSize: 13, marginTop: 8 }}>
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
            style={{
              ...btn(true),
              whiteSpace: "nowrap",
              opacity: code.trim() ? 1 : 0.5,
            }}
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

      <div style={{ display: "flex", alignItems: "center", marginTop: 22 }}>
        <Eyebrow>YOUR GAMES</Eyebrow>
        <div style={{ flex: 1 }} />
        <button style={btn(true)} onClick={onCreate}>
          ＋ Create game
        </button>
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
          No games yet. Create one and share the code, or join with a friend's
          code above.
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
  const [favorites, setFavorites] = useState<any[]>([]);
  const [pickedFav, setPickedFav] = useState<any | null>(null);
  const [teeIdx, setTeeIdx] = useState(0);
  const [idxStr, setIdxStr] = useState("");
  const [gameType, setGameType] = useState<"stableford" | "match" | "fourball">(
    "stableford",
  );
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
      const holesMeta = pickedFav.holes.map((h: any) => ({
        n: h.n,
        par: h.par,
        si: h.si,
      }));
      const { data: game, error } = await supabase
        .from("games")
        .insert({
          code,
          group_id: activeGroupId,
          name:
            name.trim() || (gameType === "match" ? "Match Play" : gameType === "fourball" ? "Four-Ball" : "Tournament"),
          course: pickedFav.name,
          course_par: coursePar,
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
      <div style={{ marginTop: 12 }}>
        <label style={{ color: C.sage, fontSize: 12 }}>Game name</label>
        <input
          style={{ ...inputStyle, marginTop: 6 }}
          value={name}
          placeholder="Saturday Skins"
          onChange={(e) => setName(e.target.value)}
        />
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
        {favorites.map((f, i) => (
          <button
            key={i}
            onClick={() => {
              setPickedFav(f);
              setTeeIdx(0);
            }}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              marginTop: 8,
              cursor: "pointer",
              background: pickedFav?.name === f.name ? C.cream : C.card,
              border: `1px solid ${pickedFav?.name === f.name ? C.gold : C.line}`,
              borderRadius: 10,
              padding: "10px 14px",
            }}
          >
            <span style={{ color: C.ink, fontWeight: 700 }}>{f.name}</span>
            {f.location ? (
              <span style={{ color: C.faint, fontSize: 13 }}>
                {" "}
                · {f.location}
              </span>
            ) : null}
          </button>
        ))}
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
        </div>
        <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>
          {gameType === "stableford"
            ? "Everyone competes on one net-Stableford leaderboard."
            : gameType === "fourball"
            ? "2-player teams play better-net-ball match play. Big groups split into foursomes (2 v 2) — set them up after creating. Great for 12–16 players in 3–4 foursomes."
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
    setPlayers(ps || []);
    const mine = (ps || []).find((p: any) => p.user_id === user.id) || null;
    setMe(mine);
    if (mine && mine.course_handicap == null && (safeGame as any)?.holes_meta?.length)
      setNeedsSetup(true);
    setLoading(false);
  }, [gameId, user.id]);
  useEffect(() => {
    load();
  }, [load]);

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

  // Build a player's per-hole Hole[] (with strokes received) for scoring math.
  const playerHoles = (p: Player): Hole[] => {
    if (!game) return [];
    const alloc = allocateStrokes(
      game.holes_meta.map((m) => ({ hole_number: m.n, stroke_index: m.si })),
      p.course_handicap,
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
    },
  ) => {
    if (!me) return;
    const n = game?.holes_meta.length || 18;
    const scores = [...(me.scores || Array(n).fill(null))];
    const putts = [...(me.putts || Array(n).fill(null))];
    const fairways = [...(me.fairways || Array(n).fill(null))];
    if ("strokes" in patch) scores[holeIdx] = patch.strokes ?? null;
    if ("putts" in patch) putts[holeIdx] = patch.putts ?? null;
    if ("fairway" in patch) fairways[holeIdx] = patch.fairway ?? null;
    const updated = { ...me, scores, putts, fairways };
    setMe(updated);
    setPlayers((ps) => ps.map((p) => (p.id === me.id ? updated : p)));
    setSavingHole(holeIdx);
    lastEditRef.current = Date.now();
    await supabase
      .from("game_players")
      .update({ scores, putts, fairways })
      .eq("id", me.id);
    lastEditRef.current = Date.now();
    setSavingHole(null);
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
    if (!confirm(`End "${game.name}"? Final standings are locked in and players can no longer change scores.`)) return;
    await supabase.from("games").update({ status: "ended" }).eq("id", game.id);
    await logActivity(supabase, { actor_id: user.id, actor_name: displayName, action: "game_ended", group_id: (game as any).group_id || null, summary: `Ended the game "${game.name}"` });
    await load();
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
    if (
      !confirm(
        `Delete the game "${game.name}"? This removes it for everyone and can't be undone.`,
      )
    )
      return;
    await supabase.from("game_players").delete().eq("game_id", game.id);
    await supabase.from("games").delete().eq("id", game.id);
    await logActivity(supabase, { actor_id: user.id, actor_name: (user.email || "Someone"), action: "game_deleted", group_id: (game as any).group_id || null, summary: `Deleted the game "${game.name}"` });
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
          onRename={renameGame}
          onDelete={deleteGame}
          onEnd={endGame}
          onReopen={reopenGame}
        />
      )}

      {roomTab === "play" && (
      <div style={{ marginTop: 16, background: isEnded ? "#3A3A3A" : game.game_type === "match" ? "#1E3A8A" : game.game_type === "fourball" ? "#1E3A8A" : C.green, borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 800 }}>
          {game.game_type === "match" ? "⛳ Singles Match Play" : game.game_type === "fourball" ? "⛳ Four-Ball Match (Best Net)" : "🏆 Stableford Tournament"}
        </span>
        {isEnded ? (
          <span style={{ fontSize: 12, fontWeight: 800, background: C.gold, color: "#1A1A1A", borderRadius: 20, padding: "3px 10px" }}>FINAL · GAME ENDED</span>
        ) : (
          <span style={{ color: C.cream, opacity: 0.8, fontSize: 12 }}>
            {game.game_type === "match" ? "1-on-1 pairings" : game.game_type === "fourball" ? "2 v 2 better-net-ball" : "net Stableford leaderboard"}
          </span>
        )}
      </div>
      )}

      {game.game_type === "fourball" ? (
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
        </>
      ) : null}

      {/* My score entry */}
      {roomTab === "play" && me && (
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
              if (game.game_type === "match") {
                const pr = game.pairings.find((p) => p.a === user.id || p.b === user.id);
                if (pr) {
                  const oppId = pr.a === user.id ? pr.b : pr.a;
                  const oppP = players.find((p) => p.user_id === oppId);
                  matchAllow = matchAllowance(me.course_handicap, oppP?.course_handicap ?? null).a;
                }
              }
              const alloc = allocateStrokes(
                game.holes_meta.map((m) => ({
                  hole_number: m.n,
                  stroke_index: m.si,
                })),
                me.course_handicap,
              );
              return game.holes_meta.map((m, i) => ({
                n: m.n,
                par: m.par,
                si: m.si,
                strokes: me.scores?.[i] ?? null,
                putts: me.putts?.[i] ?? null,
                fairway: me.fairways?.[i] ?? null,
                recv: matchAllow != null ? matchStrokesFor(matchAllow, m.si) : (alloc[m.n] || 0),
              }));
            })()}
            hasHandicap={me.course_handicap != null}
            onSet={(i, patch) => { if (!isEnded) setMyHole(i, patch); }}
            savingHole={savingHole}
            showPenalties={false}
            opp={(() => {
              if (game.game_type !== "match") return undefined;
              const pr = game.pairings.find((p) => p.a === user.id || p.b === user.id);
              if (!pr) return undefined;
              const oppId = pr.a === user.id ? pr.b : pr.a;
              const oppP = players.find((p) => p.user_id === oppId);
              return oppP?.scores || undefined;
            })()}
            oppLabel={(() => {
              if (game.game_type !== "match") return undefined;
              const pr = game.pairings.find((p) => p.a === user.id || p.b === user.id);
              if (!pr) return undefined;
              const oppId = pr.a === user.id ? pr.b : pr.a;
              const oppP = players.find((p) => p.user_id === oppId);
              return oppP?.display_name?.split(" ")[0] || "Opp";
            })()}
            matchRun={(() => {
              if (game.game_type !== "match") return undefined;
              const pr = game.pairings.find((p) => p.a === user.id || p.b === user.id);
              if (!pr) return undefined;
              const oppId = pr.a === user.id ? pr.b : pr.a;
              const oppP = players.find((p) => p.user_id === oppId);
              if (!oppP) return undefined;
              // Compute from MY perspective: me = A.
              const prog = matchProgress(
                game.holes_meta,
                me.scores || [],
                oppP.scores || [],
                me.course_handicap,
                oppP.course_handicap,
              );
              return prog.map((lead) => matchLeadLabel(lead));
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
    players.find((p) => p.user_id === uid)?.display_name || "—";
  const playerOf = (uid: string) =>
    players.find((p) => p.user_id === uid) || null;
  const paired = new Set(game.pairings.flatMap((pr) => [pr.a, pr.b]));
  const unpaired = players.filter((p) => !paired.has(p.user_id));

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
      const st = matchStatus(game.holes_meta, pa.scores || [], pb.scores || [], pa.course_handicap, pb.course_handicap);
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
              {players.map((p) => (
                <option key={p.user_id} value={p.user_id}>
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
              {players.map((p) => (
                <option key={p.user_id} value={p.user_id}>
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
        );
        const allow = matchAllowance(pa.course_handicap, pb.course_handicap);
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
  const playerOf = (uid: string) => players.find((p) => p.user_id === uid) || null;
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
  const unplaced = players.filter((p) => !placed.has(p.user_id));

  const members4 = (f: { a: string[]; b: string[] }): FourballMember[] =>
    [...f.a, ...f.b].map((uid) => {
      const p = playerOf(uid);
      return { id: uid, gross: p?.scores || [], ch: p?.course_handicap ?? null };
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
                    {unplaced.map((p) => <option key={p.id} value={p.user_id}>{p.display_name}</option>)}
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
        const st = full ? fourballStatus(game.holes_meta, ms, f.a, f.b) : null;
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
