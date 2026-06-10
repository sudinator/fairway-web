"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import {
  C, Hole, courseHandicap, strokesReceived, stablefordPts, stablefordBySix,
} from "@/lib/golf";
import { btn, inputStyle, Eyebrow } from "@/components/ui";

const supabase = createClient();

// A short, friendly join code (avoids ambiguous chars).
function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

type Game = {
  id: string;
  code: string;
  name: string;
  course: string;
  course_par: number | null;
  holes_meta: { n: number; par: number; si: number | null }[]; // par + stroke index per hole
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
};

// ---------------- Root tournament tab ----------------
export default function Tournaments({ session }: { session: any }) {
  const [view, setView] = useState<"list" | "create" | { gameId: string }>("list");
  const user = session.user;
  const displayName = user.user_metadata?.full_name || user.email?.split("@")[0] || "Golfer";

  if (view === "create")
    return <CreateGame displayName={displayName} onCancel={() => setView("list")} onCreated={(gameId) => setView({ gameId })} />;
  if (typeof view === "object")
    return <GameRoom gameId={view.gameId} user={user} displayName={displayName} onBack={() => setView("list")} />;
  return <GameList displayName={displayName} onOpen={(gameId) => setView({ gameId })} onCreate={() => setView("create")} />;
}

// ---------------- List + join ----------------
function GameList({ displayName, onOpen, onCreate }: { displayName: string; onOpen: (id: string) => void; onCreate: () => void }) {
  const [games, setGames] = useState<Game[] | null>(null);
  const [code, setCode] = useState("");
  const [joinErr, setJoinErr] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const load = useCallback(async () => {
    // Games I'm a player in (RLS lets me see games I've joined).
    const { data: mine } = await supabase.from("game_players").select("game_id");
    const ids = (mine || []).map((m: any) => m.game_id);
    if (!ids.length) { setGames([]); return; }
    const { data } = await supabase.from("games").select("*").in("id", ids).order("created_at", { ascending: false });
    setGames(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const join = async () => {
    const c = code.trim().toUpperCase();
    if (!c) return;
    setJoining(true); setJoinErr(null);
    try {
      const { data: game, error } = await supabase.from("games").select("*").eq("code", c).single();
      if (error || !game) throw new Error("No game found with that code.");
      // Add me as a player if not already in.
      const { data: existing } = await supabase.from("game_players").select("id").eq("game_id", game.id).eq("user_id", (await supabase.auth.getUser()).data.user!.id);
      if (!existing || !existing.length) {
        const { error: e2 } = await supabase.from("game_players").insert({
          game_id: game.id, display_name: displayName, scores: Array(game.holes_meta.length).fill(null),
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
        <div style={{ color: C.sage, fontSize: 13, marginTop: 8 }}>Enter the 6-character code a friend shared with you.</div>
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <input style={{ ...inputStyle, textTransform: "uppercase", letterSpacing: 3, fontWeight: 700 }}
            value={code} placeholder="ABC123" maxLength={6}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && join()} />
          <button style={{ ...btn(true), whiteSpace: "nowrap", opacity: code.trim() ? 1 : 0.5 }} disabled={!code.trim() || joining} onClick={join}>
            {joining ? "Joining…" : "Join"}
          </button>
        </div>
        {joinErr && <div style={{ color: "#E8A199", fontSize: 13, marginTop: 8 }}>{joinErr}</div>}
      </div>

      <div style={{ display: "flex", alignItems: "center", marginTop: 22 }}>
        <Eyebrow>YOUR GAMES</Eyebrow>
        <div style={{ flex: 1 }} />
        <button style={btn(true)} onClick={onCreate}>＋ Create game</button>
      </div>

      {games === null && <div style={{ color: C.sage, marginTop: 12 }}>Loading…</div>}
      {games?.length === 0 && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 24, marginTop: 12, color: C.sage, textAlign: "center" }}>
          No games yet. Create one and share the code, or join with a friend's code above.
        </div>
      )}
      {games?.map((g) => (
        <div key={g.id} onClick={() => onOpen(g.id)}
          style={{ background: C.card, borderRadius: 12, padding: "14px 16px", marginTop: 10, cursor: "pointer" }}>
          <div style={{ color: C.ink, fontWeight: 700, fontSize: 15 }}>{g.name}</div>
          <div style={{ color: C.faint, fontSize: 12, marginTop: 2 }}>{g.course} · code <b style={{ color: C.green }}>{g.code}</b></div>
        </div>
      ))}
    </div>
  );
}

// ---------------- Create a game ----------------
function CreateGame({ displayName, onCancel, onCreated }: { displayName: string; onCancel: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [favorites, setFavorites] = useState<any[]>([]);
  const [pickedFav, setPickedFav] = useState<any | null>(null);
  const [teeIdx, setTeeIdx] = useState(0);
  const [idxStr, setIdxStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("favorite_courses").select("*").order("name").then(({ data }) => {
      if (data) setFavorites(data.map((f: any) => {
        const d = f.data || {};
        if ((!d.holes || !d.holes.length) && Array.isArray(d.tees)) {
          const t = d.tees.find((x: any) => x.holes && x.holes.length);
          if (t) { d.holes = t.holes; d.tees = d.tees.map((x: any) => ({ name: x.name, rating: x.rating, slope: x.slope, par: x.par })); }
        }
        return d;
      }));
    });
  }, []);

  const tee = pickedFav?.tees?.[teeIdx];
  const coursePar = pickedFav ? pickedFav.holes.reduce((s: number, h: any) => s + (h.par || 0), 0) : null;
  const idxVal = idxStr.trim() === "" ? null : parseFloat(idxStr);
  const ch = tee && idxVal != null && coursePar ? courseHandicap(idxVal, tee.slope, tee.rating, coursePar) : null;

  const create = async () => {
    if (!pickedFav || !tee) { setErr("Pick a course (from your favorites)."); return; }
    setBusy(true); setErr(null);
    try {
      const code = makeCode();
      const holesMeta = pickedFav.holes.map((h: any) => ({ n: h.n, par: h.par, si: h.si }));
      const { data: game, error } = await supabase.from("games").insert({
        code, name: name.trim() || "Tournament", course: pickedFav.name,
        course_par: coursePar, holes_meta: holesMeta,
      }).select().single();
      if (error || !game) throw error || new Error("Could not create game");
      // Add creator as first player.
      const { error: e2 } = await supabase.from("game_players").insert({
        game_id: game.id, display_name: displayName,
        handicap_index: idxVal, rating: tee.rating, slope: tee.slope, tee_name: tee.name,
        course_handicap: ch, scores: Array(holesMeta.length).fill(null),
      });
      if (e2) throw e2;
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
        <input style={{ ...inputStyle, marginTop: 6 }} value={name} placeholder="Saturday Skins" onChange={(e) => setName(e.target.value)} />
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={{ color: C.sage, fontSize: 12 }}>Course (from your favorites — so par &amp; stroke index are correct)</label>
        {favorites.length === 0 && (
          <div style={{ color: C.sage, fontSize: 13, marginTop: 8, background: C.greenLight, borderRadius: 10, padding: 12 }}>
            You have no favorite courses yet. Go to a New round, pick a course, fix its data, and save it as a favorite first — then it'll appear here.
          </div>
        )}
        {favorites.map((f, i) => (
          <button key={i} onClick={() => { setPickedFav(f); setTeeIdx(0); }}
            style={{ display: "block", width: "100%", textAlign: "left", marginTop: 8, cursor: "pointer",
              background: pickedFav?.name === f.name ? C.cream : C.card, border: `1px solid ${pickedFav?.name === f.name ? C.gold : C.line}`, borderRadius: 10, padding: "10px 14px" }}>
            <span style={{ color: C.ink, fontWeight: 700 }}>{f.name}</span>
            {f.location ? <span style={{ color: C.faint, fontSize: 13 }}> · {f.location}</span> : null}
          </button>
        ))}
      </div>

      {pickedFav && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 14 }}>
          <label style={{ color: C.sage, fontSize: 12 }}>Your tee</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
            {pickedFav.tees.map((t: any, i: number) => (
              <button key={i} onClick={() => setTeeIdx(i)} style={{ ...btn(i === teeIdx), padding: "8px 14px", fontSize: 13 }}>
                {t.name} · {t.rating}/{t.slope}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={{ color: C.sage, fontSize: 12 }}>Your handicap index</label>
            <input style={{ ...inputStyle, marginTop: 6, maxWidth: 140 }} inputMode="decimal" placeholder="14.2" value={idxStr} onChange={(e) => { const v = e.target.value; if (v === "" || /^\d*\.?\d*$/.test(v)) setIdxStr(v); }} />
          </div>
          {ch != null && <div style={{ color: C.gold, fontWeight: 800, marginTop: 10 }}>Your course handicap: {ch}</div>}
        </div>
      )}

      {err && <div style={{ color: "#E8A199", fontSize: 13, marginTop: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button style={btn(false)} onClick={onCancel}>Cancel</button>
        <button style={{ ...btn(true), opacity: pickedFav && !busy ? 1 : 0.5 }} disabled={!pickedFav || busy} onClick={create}>
          {busy ? "Creating…" : "Create & get code"}
        </button>
      </div>
    </div>
  );
}

// ---------------- Game room: score entry + leaderboard ----------------
function GameRoom({ gameId, user, displayName, onBack }: { gameId: string; user: any; displayName: string; onBack: () => void }) {
  const [game, setGame] = useState<Game | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [me, setMe] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingHole, setSavingHole] = useState<number | null>(null);
  // join-setup if I'm in the game but haven't set my tee/handicap
  const [needsSetup, setNeedsSetup] = useState(false);
  const [teeIdx, setTeeIdx] = useState(0);
  const [idxStr, setIdxStr] = useState("");

  const load = useCallback(async () => {
    const { data: g } = await supabase.from("games").select("*").eq("id", gameId).single();
    const { data: ps } = await supabase.from("game_players").select("*").eq("game_id", gameId);
    setGame(g);
    setPlayers(ps || []);
    const mine = (ps || []).find((p: any) => p.user_id === user.id) || null;
    setMe(mine);
    if (mine && mine.course_handicap == null && (g as any)?.holes_meta) setNeedsSetup(true);
    setLoading(false);
  }, [gameId, user.id]);
  useEffect(() => { load(); }, [load]);

  // Build a player's per-hole Hole[] (with strokes received) for scoring math.
  const playerHoles = (p: Player): Hole[] => {
    if (!game) return [];
    return game.holes_meta.map((m, i) => ({
      hole_number: m.n, par: m.par, stroke_index: m.si,
      strokes: p.scores?.[i] ?? null, putts: null, fairway: null, penalties: 0,
      recv: strokesReceived(m.si, p.course_handicap),
    }));
  };

  const playerPoints = (p: Player) =>
    playerHoles(p).reduce((s, h) => s + (stablefordPts(h.strokes, h.par, h.recv || 0) || 0), 0);

  const playerThru = (p: Player) => (p.scores || []).filter((s) => s != null && s > 0).length;

  // Save one hole's strokes for me.
  const setMyScore = async (holeIdx: number, value: number | null) => {
    if (!me) return;
    const scores = [...(me.scores || [])];
    scores[holeIdx] = value;
    setMe({ ...me, scores });
    setPlayers((ps) => ps.map((p) => (p.id === me.id ? { ...p, scores } : p)));
    setSavingHole(holeIdx);
    await supabase.from("game_players").update({ scores }).eq("id", me.id);
    setSavingHole(null);
  };

  const completeSetup = async () => {
    if (!game || !me) return;
    // course data comes from the game's first player who has tee info, else ask via favorites — simplified: reuse game course par
    const idxVal = idxStr.trim() === "" ? null : parseFloat(idxStr);
    // We need rating/slope; pull from any player who has them, or leave handicap null.
    const ref = players.find((p) => p.rating != null && p.slope != null);
    const rating = ref?.rating ?? null, slope = ref?.slope ?? null;
    const ch = idxVal != null && rating != null && slope != null && game.course_par != null
      ? courseHandicap(idxVal, slope, rating, game.course_par) : null;
    await supabase.from("game_players").update({
      handicap_index: idxVal, rating, slope, tee_name: ref?.tee_name ?? null, course_handicap: ch,
    }).eq("id", me.id);
    setNeedsSetup(false);
    await load();
  };

  if (loading) return <div style={{ color: C.sage, padding: 20 }}>Loading game…</div>;
  if (!game) return <div style={{ color: C.sage, padding: 20 }}>Game not found. <button style={btn(false)} onClick={onBack}>Back</button></div>;

  const leaderboard = [...players].sort((a, b) => playerPoints(b) - playerPoints(a));

  // Segment winners (three sixes), by net Stableford.
  const segLabels = ["Holes 1–6", "Holes 7–12", "Holes 13–18"];
  const segTotals = players.map((p) => ({ p, seg: stablefordBySix(playerHoles(p)) }));
  const segWinners = [0, 1, 2].map((si) => {
    let best = -1, who: string[] = [];
    segTotals.forEach(({ p, seg }) => {
      // only count a segment if the player has entered all 6 holes
      const played = playerHoles(p).slice(si * 6, si * 6 + 6).filter((h) => h.strokes).length;
      if (played < 6) return;
      if (seg[si] > best) { best = seg[si]; who = [p.display_name]; }
      else if (seg[si] === best) who.push(p.display_name);
    });
    return { label: segLabels[si], best, who };
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button style={btn(false)} onClick={onBack}>‹ Games</button>
        <div>
          <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 700 }}>{game.name}</div>
          <div style={{ color: C.sage, fontSize: 13 }}>{game.course}</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ background: C.greenLight, borderRadius: 10, padding: "8px 14px", textAlign: "center" }}>
          <div style={{ color: C.sage, fontSize: 10, letterSpacing: 2 }}>SHARE CODE</div>
          <div style={{ color: C.gold, fontWeight: 800, fontSize: 20, letterSpacing: 3 }}>{game.code}</div>
        </div>
        <button style={btn(false)} onClick={load}>⟳ Refresh</button>
      </div>

      {needsSetup && me && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 16 }}>
          <Eyebrow>SET YOUR HANDICAP</Eyebrow>
          <div style={{ color: C.sage, fontSize: 13, marginTop: 8 }}>
            Enter your handicap index so your net Stableford is scored correctly. (Tees use the game creator's course rating/slope.)
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "flex-end" }}>
            <div>
              <label style={{ color: C.sage, fontSize: 12 }}>Handicap index</label>
              <input style={{ ...inputStyle, marginTop: 6, maxWidth: 140 }} inputMode="decimal" placeholder="14.2"
                value={idxStr} onChange={(e) => { const v = e.target.value; if (v === "" || /^\d*\.?\d*$/.test(v)) setIdxStr(v); }} />
            </div>
            <button style={btn(true)} onClick={completeSetup}>Save</button>
          </div>
        </div>
      )}

      {/* Leaderboard */}
      <div style={{ marginTop: 18 }}>
        <Eyebrow>LEADERBOARD · NET STABLEFORD</Eyebrow>
        {leaderboard.map((p, i) => (
          <div key={p.id} style={{ background: p.user_id === user.id ? C.cream : C.card, borderRadius: 12, padding: "12px 16px", marginTop: 8, display: "flex", alignItems: "center" }}>
            <div style={{ color: C.gold, fontFamily: "Georgia, serif", fontWeight: 700, width: 28, fontSize: 18 }}>{i + 1}</div>
            <div style={{ flex: 1 }}>
              <div style={{ color: C.ink, fontWeight: 700 }}>{p.display_name}{p.user_id === user.id ? " (you)" : ""}</div>
              <div style={{ color: C.faint, fontSize: 12 }}>
                thru {playerThru(p)}{p.course_handicap != null ? ` · CH ${p.course_handicap}` : " · no handicap set"}
              </div>
            </div>
            <div style={{ color: C.green, fontWeight: 800, fontSize: 22, fontFamily: "Georgia, serif" }}>{playerPoints(p)}</div>
            <div style={{ color: C.faint, fontSize: 11, marginLeft: 6 }}>pts</div>
          </div>
        ))}
      </div>

      {/* Three sixes */}
      <div style={{ marginTop: 18 }}>
        <Eyebrow>SIX-HOLE SEGMENTS (NET STABLEFORD)</Eyebrow>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
          {segWinners.map((s, i) => (
            <div key={i} style={{ flex: 1, minWidth: 150, background: C.greenLight, borderRadius: 12, padding: 14 }}>
              <div style={{ color: C.sage, fontSize: 12 }}>{s.label}</div>
              {s.best < 0 ? (
                <div style={{ color: C.faint, fontSize: 13, marginTop: 6 }}>Not complete yet</div>
              ) : (
                <>
                  <div style={{ color: C.cream, fontWeight: 800, marginTop: 6 }}>{s.who.join(", ")}</div>
                  <div style={{ color: C.gold, fontSize: 13 }}>{s.best} pts {s.who.length > 1 ? "(tie)" : ""}</div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* My score entry */}
      {me && !needsSetup && (
        <div style={{ marginTop: 22 }}>
          <Eyebrow>ENTER YOUR SCORES</Eyebrow>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 4 }}>Tap a hole and type your strokes — it saves and updates the leaderboard. Tap ⟳ Refresh to see others' latest.</div>
          <ScoreGrid game={game} me={me} savingHole={savingHole} onSet={setMyScore} />
        </div>
      )}
    </div>
  );
}

function ScoreGrid({ game, me, savingHole, onSet }: {
  game: Game; me: Player; savingHole: number | null; onSet: (i: number, v: number | null) => void;
}) {
  const nine = (from: number, to: number, label: string) => (
    <div style={{ background: C.card, borderRadius: 12, padding: 12, flex: 1, minWidth: 320, overflowX: "auto" }}>
      <div style={{ color: C.faint, fontSize: 11, letterSpacing: 2, fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <td style={{ color: C.faint, fontSize: 10, padding: "2px 4px" }}>Hole</td>
            {game.holes_meta.slice(from, to).map((m) => <td key={m.n} style={{ textAlign: "center", color: C.faint, fontSize: 10 }}>{m.n}</td>)}
          </tr>
          <tr>
            <td style={{ color: C.sage, fontSize: 10, padding: "2px 4px" }}>Par</td>
            {game.holes_meta.slice(from, to).map((m, j) => <td key={j} style={{ textAlign: "center", color: C.ink, fontSize: 12 }}>{m.par}</td>)}
          </tr>
          <tr>
            <td style={{ color: C.sage, fontSize: 10, padding: "2px 4px" }}>Score</td>
            {game.holes_meta.slice(from, to).map((m, j) => {
              const i = from + j;
              return (
                <td key={j} style={{ padding: 2 }}>
                  <input inputMode="numeric" value={me.scores?.[i] ?? ""} placeholder="–"
                    onChange={(e) => {
                      const v = e.target.value === "" ? null : Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 0)) || null;
                      onSet(i, v);
                    }}
                    style={{ ...inputStyle, padding: "5px 2px", width: 38, textAlign: "center", fontSize: 15, borderColor: savingHole === i ? C.gold : C.line }} />
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );

  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10 }}>
      {nine(0, Math.min(9, game.holes_meta.length), "FRONT NINE")}
      {game.holes_meta.length > 9 && nine(9, 18, "BACK NINE")}
    </div>
  );
}
