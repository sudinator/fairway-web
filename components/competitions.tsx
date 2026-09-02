"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { C } from "@/lib/golf";
import { Avatar, Eyebrow, ShortDateInput, btn, inputStyle } from "@/components/ui";
import type { Game, GameSeed, Player } from "@/lib/game-types";
import type { AltShotScoreRow } from "@/lib/alt-shot-side-scores";
import {
  combineCompetitionScores,
  competitionFormatLabel,
  fmtCompetitionPoints,
  scoreCompetitionGame,
  type Competition,
  type CompetitionPlayer,
  type CompetitionSession,
  type CompetitionSessionScore,
} from "@/lib/competition";
import { teamAccent } from "@/lib/game-colors";

const supabase = createClient();

type Roster = { id: string; display_name: string; avatar_url: string | null; handicap_index: number | null };
type SessionLive = CompetitionSession & { game?: Game | null; players: Player[]; altScores: AltShotScoreRow[]; score: CompetitionSessionScore };

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function formatDate(v: string) {
  const [y, m, d] = (v || "").split("-").map(Number);
  if (!y || !m || !d) return v;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function Competitions({
  user,
  activeGroupId,
  canManage,
  selectedId,
  onSelected,
  onOpenGame,
  onCreateGame,
}: {
  user: any;
  activeGroupId: string;
  canManage: boolean;
  selectedId: string | null;
  onSelected: (id: string | null) => void;
  onOpenGame: (id: string) => void;
  onCreateGame: (seed: GameSeed) => void;
}) {
  const [competitions, setCompetitions] = useState<Competition[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [roster, setRoster] = useState<Roster[]>([]);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState(today());
  const [teamA, setTeamA] = useState("Violet");
  const [teamB, setTeamB] = useState("Burgundy");
  const [assign, setAssign] = useState<Record<string, "A" | "B" | "">>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    const { data, error } = await supabase.from("competitions").select("*").eq("group_id", activeGroupId).order("start_date", { ascending: false }).order("created_at", { ascending: false });
    if (error) { setErr(error.message); return; }
    setCompetitions((data || []) as Competition[]);
  }, [activeGroupId]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => {
    if (!creating) return;
    (async () => {
      const rpc = await supabase.rpc("group_roster", { p_group: activeGroupId });
      if (rpc.error) { setErr(`Could not load the club roster: ${rpc.error.message}`); return; }
      if (Array.isArray(rpc.data)) {
        const rows = (rpc.data as any[]).map((p) => ({ id: p.id, display_name: p.display_name || "Player", avatar_url: p.avatar_url ?? null, handicap_index: p.handicap_index ?? null }))
          .sort((a, b) => a.display_name.localeCompare(b.display_name, undefined, { sensitivity: "base" }));
        setRoster(rows);
      }
    })();
  }, [creating, activeGroupId]);

  const createCompetition = async () => {
    if (!name.trim()) { setErr("Enter a competition name."); return; }
    const picked = Object.entries(assign).filter(([, t]) => t === "A" || t === "B");
    if (teamA.trim().toLocaleLowerCase() === teamB.trim().toLocaleLowerCase()) { setErr("Give the two Cup teams different names."); return; }
    if (!picked.some(([, t]) => t === "A") || !picked.some(([, t]) => t === "B")) { setErr("Put at least one player on each team."); return; }
    setBusy(true); setErr(null);
    try {
      const { data: competitionId, error } = await supabase.rpc("create_team_competition", {
        p_group: activeGroupId,
        p_name: name.trim(),
        p_location: location.trim() || null,
        p_start_date: startDate,
        p_team_a_name: teamA.trim() || "Team 1",
        p_team_b_name: teamB.trim() || "Team 2",
        p_roster: picked.map(([userId, teamKey]) => ({ user_id: userId, team_key: teamKey })),
      });
      if (error || !competitionId) throw error || new Error("Could not create competition");
      setCreating(false); setName(""); setLocation(""); setAssign({}); await loadList(); onSelected(String(competitionId));
    } catch (e: any) { setErr(e?.message || "Could not create competition."); }
    finally { setBusy(false); }
  };

  if (selectedId) return <CompetitionDetail competitionId={selectedId} user={user} canManage={canManage} onBack={() => onSelected(null)} onOpenGame={onOpenGame} onCreateGame={onCreateGame} />;

  if (creating) {
    return (
      <div style={{ maxWidth: 620 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => setCreating(false)} style={{ ...btn(false), padding: "8px 12px" }}>‹ Back</button>
          <Eyebrow style={{ margin: 0 }}>NEW CUP</Eyebrow>
        </div>
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 14 }}>
          <label style={{ color: C.sage, fontSize: 11, fontWeight: 800 }}>COMPETITION NAME</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="TGC Cup 2026" style={{ ...inputStyle, marginTop: 6 }} />
          <label style={{ display: "block", color: C.sage, fontSize: 11, fontWeight: 800, marginTop: 14 }}>LOCATION <span style={{ fontWeight: 500 }}>(optional)</span></label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Tumble Creek Club" style={{ ...inputStyle, marginTop: 6 }} />
          <div style={{ marginTop: 14 }}><label style={{ color: C.sage, fontSize: 11, fontWeight: 800 }}>START DATE</label><ShortDateInput value={startDate} onChange={setStartDate} /></div>
        </div>

        <Eyebrow>TEAMS</Eyebrow>
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label style={{ color: C.sage, fontSize: 11, fontWeight: 800 }}>TEAM 1</label><input value={teamA} onChange={(e) => setTeamA(e.target.value)} style={{ ...inputStyle, marginTop: 6 }} /></div>
            <div><label style={{ color: C.sage, fontSize: 11, fontWeight: 800 }}>TEAM 2</label><input value={teamB} onChange={(e) => setTeamB(e.target.value)} style={{ ...inputStyle, marginTop: 6 }} /></div>
          </div>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 12, lineHeight: 1.45 }}>Assign the Cup roster once. Each session inherits these teams; you can choose which players participate when creating that session's game.</div>
        </div>

        <Eyebrow>ROSTER</Eyebrow>
        <div style={{ display: "grid", gap: 8 }}>
          {roster.map((p) => {
            const t = assign[p.id] || "";
            return <div key={p.id} style={{ background: C.greenLight, borderRadius: 12, padding: "8px 12px", display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar src={p.avatar_url} name={p.display_name} size={30} />
              <div style={{ minWidth: 0, flex: 1 }}><div style={{ color: C.cream, fontSize: 14, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.display_name}</div><div style={{ color: C.sage, fontSize: 11 }}>{p.handicap_index == null ? "No handicap" : `Index ${p.handicap_index}`}</div></div>
              <button onClick={() => setAssign((a) => ({ ...a, [p.id]: t === "A" ? "" : "A" }))} style={{ ...btn(false), background: C.greenMid, border: t === "A" ? `2px solid ${C.gold}` : `1px solid ${C.borderGreen}`, padding: "8px 12px", fontSize: 11, color: C.cream }}>{teamA || "Team 1"}</button>
              <button onClick={() => setAssign((a) => ({ ...a, [p.id]: t === "B" ? "" : "B" }))} style={{ ...btn(false), background: C.greenMid, border: t === "B" ? `2px solid ${C.gold}` : `1px solid ${C.borderGreen}`, padding: "8px 12px", fontSize: 11, color: C.cream }}>{teamB || "Team 2"}</button>
            </div>;
          })}
        </div>
        {err ? <div style={{ color: C.overRedDark, fontSize: 12, marginTop: 12 }}>{err}</div> : null}
        <button disabled={busy} onClick={createCompetition} style={{ ...btn(true), width: "100%", marginTop: 16 }}>{busy ? "Creating…" : "Create Cup"}</button>
      </div>
    );
  }

  return (
    <div>
      <Eyebrow>CUPS</Eyebrow>
      <div style={{ background: C.greenLight, borderRadius: 14, padding: 18, marginTop: 10 }}>
        <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 700 }}>Run a Ryder Cup-style competition</div>
        <div style={{ color: C.sage, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>Create two club teams, add Four-Ball, Alternate Shot and Singles sessions, and let BNN tally every match into one live Cup score.</div>
        {canManage ? <button onClick={() => setCreating(true)} style={{ ...btn(true), marginTop: 12 }}>＋ Start a Cup</button> : null}
      </div>
      <Eyebrow>YOUR CUPS</Eyebrow>
      {competitions === null ? <div style={{ color: C.sage }}>Loading…</div> : competitions.length === 0 ? <div style={{ background: C.greenLight, borderRadius: 14, padding: 22, color: C.sage, textAlign: "center" }}>No Cups yet.</div> : competitions.map((c) => (
        <button key={c.id} onClick={() => onSelected(c.id)} style={{ width: "100%", textAlign: "left", background: C.greenLight, border: "none", borderRadius: 12, padding: "13px 16px", marginTop: 10, cursor: "pointer" }}>
          <div style={{ color: C.cream, fontSize: 15, fontWeight: 800 }}>{c.name}</div>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 3 }}>{formatDate(c.start_date)}{c.location ? ` · ${c.location}` : ""} · {c.team_a_name} vs {c.team_b_name}</div>
        </button>
      ))}
      {err ? <div style={{ color: C.overRedDark, fontSize: 12, marginTop: 12 }}>{err}</div> : null}
    </div>
  );
}

function CompetitionDetail({ competitionId, user, canManage, onBack, onOpenGame, onCreateGame }: { competitionId: string; user: any; canManage: boolean; onBack: () => void; onOpenGame: (id: string) => void; onCreateGame: (seed: GameSeed) => void }) {
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [roster, setRoster] = useState<CompetitionPlayer[]>([]);
  const [sessions, setSessions] = useState<SessionLive[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [sessionName, setSessionName] = useState("Saturday Morning");
  const [format, setFormat] = useState<CompetitionSession["format"]>("fourball");
  const [playDate, setPlayDate] = useState(today());
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const [cRes, rRes, sRes] = await Promise.all([
      supabase.from("competitions").select("*").eq("id", competitionId).single(),
      supabase.from("competition_players").select("*").eq("competition_id", competitionId).order("display_name"),
      supabase.from("competition_sessions").select("*").eq("competition_id", competitionId).order("session_order"),
    ]);
    if (cRes.error || !cRes.data) { setErr(cRes.error?.message || "Competition not found."); return; }
    if (rRes.error || sRes.error) { setErr(rRes.error?.message || sRes.error?.message || "Could not load Cup setup."); return; }
    const rawSessions = (sRes.data || []) as CompetitionSession[];
    const ids = rawSessions.map((s) => s.game_id).filter((x): x is string => !!x);
    let games: Game[] = [], players: Player[] = [], altScores: AltShotScoreRow[] = [];
    if (ids.length) {
      const [gRes, pRes, aRes] = await Promise.all([
        supabase.from("games").select("*").in("id", ids),
        supabase.from("game_players").select("*").in("game_id", ids),
        supabase.from("game_alt_shot_scores").select("*").in("game_id", ids),
      ]);
      if (gRes.error || pRes.error || aRes.error) { setErr(gRes.error?.message || pRes.error?.message || aRes.error?.message || "Could not load Cup match scores."); return; }
      games = (gRes.data || []) as Game[]; players = (pRes.data || []) as Player[]; altScores = (aRes.data || []) as AltShotScoreRow[];
    }
    setCompetition(cRes.data as Competition);
    setRoster((rRes.data || []) as CompetitionPlayer[]);
    setSessions(rawSessions.map((s) => {
      const game = games.find((g) => g.id === s.game_id) || null;
      const gp = game ? players.filter((p) => p.game_id === game.id) : [];
      const as = game ? altScores.filter((a) => a.game_id === game.id) : [];
      return { ...s, game, players: gp, altScores: as, score: game ? scoreCompetitionGame(game, gp, as, Number(s.points_per_match || 1)) : { projectedA: 0, projectedB: 0, decidedA: 0, decidedB: 0, matchCount: 0, decidedCount: 0, matches: [] } };
    }));
  }, [competitionId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = window.setInterval(() => { void load(); }, 15000);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(id); window.removeEventListener("focus", onFocus); };
  }, [load]);

  const total = useMemo(() => combineCompetitionScores((sessions || []).map((s) => s.score)), [sessions]);
  if (!competition) return <div><button onClick={onBack} style={{ ...btn(false), marginBottom: 12 }}>‹ Cups</button><div style={{ color: err ? C.overRedDark : C.sage }}>{err || "Loading…"}</div></div>;
  const manage = canManage || competition.created_by === user.id;
  const aColor = teamAccent(competition.team_a_name, 0), bColor = teamAccent(competition.team_b_name, 1);

  const addSession = () => {
    const order = (sessions?.reduce((m, s) => Math.max(m, s.session_order), 0) || 0) + 1;
    const participantTeams: Record<string, "A" | "B"> = Object.fromEntries(roster.map((p) => [p.user_id, p.team_key]));
    onCreateGame({
      playDate, course: null, memberIds: roster.map((p) => p.user_id), guests: [],
      name: `${competition.name} · ${sessionName.trim() || competitionFormatLabel(format)}`,
      gameType: format,
      teamNames: { A: competition.team_a_name, B: competition.team_b_name },
      participantTeams,
      competitionSession: { competitionId: competition.id, name: sessionName.trim() || competitionFormatLabel(format), sessionOrder: order, format, playDate, pointsPerMatch: 1 },
    });
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={onBack} style={{ ...btn(false), padding: "8px 12px" }}>‹ Cups</button>
        <div style={{ flex: 1 }} />
        <span style={{ color: C.sage, fontSize: 11 }}>● Live</span>
        <button onClick={() => { void load(); }} style={{ ...btn(false), padding: "8px 12px", fontSize: 12 }}>↻ Refresh</button>
      </div>
      <div style={{ marginTop: 12, background: C.green, borderRadius: 14, padding: 16, border: `1px solid ${C.borderGreen}` }}>
        <div style={{ color: C.sage, fontSize: 11, letterSpacing: 2, fontWeight: 800 }}>TEAM COMPETITION · LIVE SCORE</div>
        <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 800, marginTop: 4 }}>{competition.name}</div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 32px minmax(0,1fr)", alignItems: "center", marginTop: 14 }}>
          <div style={{ textAlign: "center" }}><div style={{ color: aColor, fontSize: 15, fontWeight: 800 }}>{competition.team_a_name}</div><div style={{ color: total.projectedA >= total.projectedB ? "#FFE08A" : C.cream, fontFamily: "Georgia, serif", fontSize: 40, fontWeight: 800 }}>{fmtCompetitionPoints(total.projectedA)}</div></div>
          <div style={{ textAlign: "center", color: C.sage, fontSize: 18 }}>–</div>
          <div style={{ textAlign: "center" }}><div style={{ color: bColor, fontSize: 15, fontWeight: 800 }}>{competition.team_b_name}</div><div style={{ color: total.projectedB >= total.projectedA ? "#FFE08A" : C.cream, fontFamily: "Georgia, serif", fontSize: 40, fontWeight: 800 }}>{fmtCompetitionPoints(total.projectedB)}</div></div>
        </div>
        <div style={{ color: C.sage, fontSize: 11, textAlign: "center", marginTop: 7 }}>Projected from live match states · {fmtCompetitionPoints(total.decidedA)}–{fmtCompetitionPoints(total.decidedB)} decided · {total.decidedCount}/{total.matchCount} matches complete</div>
      </div>

      <Eyebrow>TEAMS</Eyebrow>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {(["A", "B"] as const).map((key, idx) => <div key={key} style={{ background: C.greenLight, borderRadius: 12, padding: 12 }}>
          <div style={{ color: idx === 0 ? aColor : bColor, fontSize: 13, fontWeight: 800 }}>{key === "A" ? competition.team_a_name : competition.team_b_name}</div>
          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>{roster.filter((p) => p.team_key === key).map((p) => <div key={p.user_id} style={{ display: "flex", alignItems: "center", gap: 7, color: C.cream, fontSize: 12 }}><Avatar src={p.avatar_url} name={p.display_name} size={22} /><span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.display_name}</span></div>)}</div>
        </div>)}
      </div>

      <div style={{ display: "flex", alignItems: "center" }}><Eyebrow>SESSIONS</Eyebrow><div style={{ flex: 1 }} />{manage ? <button onClick={() => setAdding((v) => !v)} style={{ ...btn(false), fontSize: 12, padding: "8px 12px" }}>{adding ? "Cancel" : "＋ Add session"}</button> : null}</div>
      {adding ? <div style={{ background: C.greenLight, borderRadius: 14, padding: 14, marginBottom: 12 }}>
        <label style={{ color: C.sage, fontSize: 11, fontWeight: 800 }}>SESSION NAME</label><input value={sessionName} onChange={(e) => setSessionName(e.target.value)} style={{ ...inputStyle, marginTop: 6 }} />
        <label style={{ display: "block", color: C.sage, fontSize: 11, fontWeight: 800, marginTop: 12 }}>FORMAT</label>
        <select value={format} onChange={(e) => setFormat(e.target.value as CompetitionSession["format"])} style={{ ...inputStyle, marginTop: 6 }}><option value="fourball">Four-Ball</option><option value="alt_shot">Alternate Shot</option><option value="match">Singles</option></select>
        <div style={{ marginTop: 12 }}><label style={{ color: C.sage, fontSize: 11, fontWeight: 800 }}>DATE</label><ShortDateInput value={playDate} onChange={setPlayDate} /></div>
        <div style={{ color: C.sage, fontSize: 11, lineHeight: 1.45, marginTop: 10 }}>Next opens the standard BNN game setup with this Cup roster and team assignments already loaded. Choose the course, tees and the players participating in this session, then build the normal Groups/Matchups.</div>
        <button onClick={addSession} style={{ ...btn(true), width: "100%", marginTop: 12 }}>Next · Set up this session</button>
      </div> : null}

      {sessions === null ? <div style={{ color: C.sage }}>Loading sessions…</div> : sessions.length === 0 ? <div style={{ background: C.greenLight, borderRadius: 12, padding: 18, color: C.sage, textAlign: "center" }}>No sessions yet. Add Four-Ball, Alternate Shot or Singles.</div> : sessions.map((s) => (
        <button key={s.id} disabled={!s.game_id} onClick={() => s.game_id && onOpenGame(s.game_id)} style={{ width: "100%", background: C.greenLight, border: "none", borderRadius: 12, padding: "13px 16px", marginBottom: 9, textAlign: "left", cursor: s.game_id ? "pointer" : "default" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ flex: 1, minWidth: 0 }}><div style={{ color: C.cream, fontSize: 14, fontWeight: 800 }}>{s.name}</div><div style={{ color: C.sage, fontSize: 11, marginTop: 2 }}>{competitionFormatLabel(s.format)} · {formatDate(s.play_date)} · {s.score.decidedCount}/{s.score.matchCount} complete</div></div><div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 800 }}><span style={{ color: aColor }}>{fmtCompetitionPoints(s.score.projectedA)}</span><span style={{ color: C.sage, margin: "0 6px" }}>–</span><span style={{ color: bColor }}>{fmtCompetitionPoints(s.score.projectedB)}</span></div><span style={{ color: C.gold, fontSize: 18 }}>›</span></div>
          {s.score.matches.length ? <div style={{ borderTop: `1px solid ${C.borderGreen}`, marginTop: 10, paddingTop: 6 }}>{s.score.matches.map((m) => <div key={m.key} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 52px minmax(0,1fr)", gap: 8, alignItems: "center", padding: "8px 12px", fontSize: 11 }}><span style={{ color: C.cream, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.leftNames}{m.winnerTeam === "A" ? <b style={{ color: aColor }}> · {m.result || `${Math.abs(m.lead)} UP`}</b> : null}</span><span style={{ color: C.sage, textAlign: "center" }}>{m.thru ? `Thru ${m.thru}` : "—"}{m.started && m.lead === 0 ? " · AS" : ""}</span><span style={{ color: C.cream, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.rightNames}{m.winnerTeam === "B" ? <b style={{ color: bColor }}> · {m.result || `${Math.abs(m.lead)} UP`}</b> : null}</span></div>)}</div> : null}
        </button>
      ))}
      {err ? <div style={{ color: C.overRedDark, fontSize: 12, marginTop: 10 }}>{err}</div> : null}
    </div>
  );
}
