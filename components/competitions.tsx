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
  competitionOutcome,
  competitionSchedule,
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
    if (teamA.trim().toLocaleLowerCase() === teamB.trim().toLocaleLowerCase()) { setErr("Give the two Ryder Cup teams different names."); return; }
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
          <Eyebrow style={{ margin: 0 }}>NEW RYDER CUP</Eyebrow>
        </div>
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 14 }}>
          <label style={{ color: C.sage, fontSize: 11, fontWeight: 800 }}>COMPETITION NAME</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Club Ryder Cup 2026" style={{ ...inputStyle, marginTop: 6 }} />
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
          <div style={{ color: C.sage, fontSize: 12, marginTop: 12, lineHeight: 1.45 }}>Assign the Ryder Cup roster once. Each session inherits these teams; you can choose which players participate when creating that session's game.</div>
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
        <button disabled={busy} onClick={createCompetition} style={{ ...btn(true), width: "100%", marginTop: 16 }}>{busy ? "Creating…" : "Create Ryder Cup"}</button>
      </div>
    );
  }

  return (
    <div>
      <Eyebrow>RYDER CUPS</Eyebrow>
      <div style={{ background: C.greenLight, borderRadius: 14, padding: 18, marginTop: 10 }}>
        <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 700 }}>Run a Ryder Cup</div>
        <div style={{ color: C.sage, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>Create two club teams, add Four-Ball, Alternate Shot and Singles sessions, and let BNN tally every match into one live Ryder Cup score.</div>
        {canManage ? <button onClick={() => setCreating(true)} style={{ ...btn(true), marginTop: 12 }}>＋ Start a Ryder Cup</button> : null}
      </div>
      <Eyebrow>YOUR RYDER CUPS</Eyebrow>
      {competitions === null ? <div style={{ color: C.sage }}>Loading…</div> : competitions.length === 0 ? <div style={{ background: C.greenLight, borderRadius: 14, padding: 22, color: C.sage, textAlign: "center" }}>No Ryder Cups yet.</div> : competitions.map((c) => (
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
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState("Saturday Morning");
  const [format, setFormat] = useState<CompetitionSession["format"]>("fourball");
  const [playDate, setPlayDate] = useState(today());
  const [plannedMatches, setPlannedMatches] = useState("3");
  const [pointsPerMatch, setPointsPerMatch] = useState("1");
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const [cRes, rRes, sRes] = await Promise.all([
      supabase.from("competitions").select("*").eq("id", competitionId).single(),
      supabase.from("competition_players").select("*").eq("competition_id", competitionId).order("display_name"),
      supabase.from("competition_sessions").select("*").eq("competition_id", competitionId).order("session_order"),
    ]);
    if (cRes.error || !cRes.data) { setErr(cRes.error?.message || "Competition not found."); return; }
    if (rRes.error || sRes.error) { setErr(rRes.error?.message || sRes.error?.message || "Could not load Ryder Cup setup."); return; }
    const rawSessions = (sRes.data || []) as CompetitionSession[];
    const ids = rawSessions.map((s) => s.game_id).filter((x): x is string => !!x);
    let games: Game[] = [], players: Player[] = [], altScores: AltShotScoreRow[] = [];
    if (ids.length) {
      const [gRes, pRes, aRes] = await Promise.all([
        supabase.from("games").select("*").in("id", ids),
        supabase.from("game_players").select("*").in("game_id", ids),
        supabase.from("game_alt_shot_scores").select("*").in("game_id", ids),
      ]);
      if (gRes.error || pRes.error || aRes.error) { setErr(gRes.error?.message || pRes.error?.message || aRes.error?.message || "Could not load Ryder Cup match scores."); return; }
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
  const schedule = useMemo(() => competitionSchedule(sessions || [], competition?.tie_rule || "shared"), [sessions, competition?.tie_rule]);
  if (!competition) return <div><button onClick={onBack} style={{ ...btn(false), marginBottom: 12 }}>‹ Ryder Cups</button><div style={{ color: err ? C.overRedDark : C.sage }}>{err || "Loading…"}</div></div>;
  const manage = canManage || competition.created_by === user.id;
  const aColor = teamAccent(competition.team_a_name, 0), bColor = teamAccent(competition.team_b_name, 1);

  const savePlannedSession = async () => {
    const order = (sessions?.reduce((m, s) => Math.max(m, s.session_order), 0) || 0) + 1;
    const count = Number(plannedMatches), points = Number(pointsPerMatch);
    if (!Number.isInteger(count) || count < 1 || count > 100) { setErr("Enter a match count between 1 and 100."); return; }
    if (!Number.isFinite(points) || points <= 0 || points > 10) { setErr("Points per match must be greater than 0 and no more than 10."); return; }
    setScheduleBusy(true); setErr(null);
    const values = {
      name: sessionName.trim() || competitionFormatLabel(format), format, play_date: playDate,
      points_per_match: points, planned_match_count: count,
    };
    const { error } = editingSessionId
      ? await supabase.from("competition_sessions").update(values).eq("id", editingSessionId).eq("competition_id", competition.id)
      : await supabase.from("competition_sessions").insert({ competition_id: competition.id, session_order: order, ...values });
    setScheduleBusy(false);
    if (error) { setErr(error.message); return; }
    setAdding(false); setEditingSessionId(null); await load();
  };

  const editPlannedSession = (session: CompetitionSession) => {
    setSessionName(session.name); setFormat(session.format); setPlayDate(session.play_date);
    setPlannedMatches(String(session.planned_match_count)); setPointsPerMatch(String(session.points_per_match));
    setEditingSessionId(session.id); setAdding(true); setErr(null);
  };

  const createSessionGame = (session: CompetitionSession) => {
    const participantTeams: Record<string, "A" | "B"> = Object.fromEntries(roster.map((p) => [p.user_id, p.team_key]));
    onCreateGame({
      playDate: session.play_date, course: null, memberIds: roster.map((p) => p.user_id), guests: [],
      name: `${competition.name} · ${session.name}`,
      gameType: session.format,
      teamNames: { A: competition.team_a_name, B: competition.team_b_name },
      participantTeams,
      competitionSession: { sessionId: session.id, competitionId: competition.id, name: session.name, sessionOrder: session.session_order, format: session.format, playDate: session.play_date, pointsPerMatch: Number(session.points_per_match) },
    });
  };

  const lockSchedule = async () => {
    if (!confirm(`Lock ${sessions?.length || 0} sessions worth ${fmtCompetitionPoints(schedule.totalPoints)} total points? Session scoring cannot change unless the schedule is explicitly reopened.`)) return;
    setScheduleBusy(true); setErr(null);
    const { error } = await supabase.rpc("lock_competition_schedule", { p_competition: competition.id });
    setScheduleBusy(false); if (error) { setErr(error.message); return; } await load();
  };

  const reopenSchedule = async () => {
    const reason = prompt("Why is the locked Ryder Cup schedule being changed?")?.trim();
    if (!reason) return;
    setScheduleBusy(true); setErr(null);
    const { error } = await supabase.rpc("reopen_competition_schedule", { p_competition: competition.id, p_reason: reason });
    setScheduleBusy(false); if (error) { setErr(error.message); return; } await load();
  };

  const changeTieRule = async (tieRule: Competition["tie_rule"]) => {
    setScheduleBusy(true); setErr(null);
    const { error } = await supabase.from("competitions").update({ tie_rule: tieRule }).eq("id", competition.id);
    setScheduleBusy(false); if (error) { setErr(error.message); return; } await load();
  };

  const locked = competition.schedule_status === "locked";
  const editingSession = sessions?.find((s) => s.id === editingSessionId) || null;
  const plannedMatchCount = (sessions || []).reduce((sum, s) => sum + Number(s.planned_match_count || 0), 0);
  const outcome = competitionOutcome(total.decidedA, total.decidedB, schedule, competition.tie_rule);
  const clinched: "A" | "B" | null = locked && outcome.teamA.clinched ? "A" : locked && outcome.teamB.clinched ? "B" : null;
  const cupShared = locked && competition.tie_rule === "shared" && outcome.remainingPoints < 1e-9 && Math.abs(total.decidedA - total.decidedB) < 1e-9;
  const pathText = (name: string, path: typeof outcome.teamA, target: number) => {
    if (path.canWin) {
      const action = target <= schedule.totalPoints / 2 + 1e-9 ? "retain the Ryder Cup" : "win the Ryder Cup";
      return `${name} needs ${fmtCompetitionPoints(path.pointsNeeded)} ${path.pointsNeeded <= 1 + 1e-9 ? "point" : "points"} to ${action}`;
    }
    if (path.canShare) {
      const mustTakeAll = Math.abs(path.maxPoints - schedule.totalPoints / 2) < 1e-9;
      return mustTakeAll
        ? `${name} must take all ${fmtCompetitionPoints(outcome.remainingPoints)} remaining points to share the Ryder Cup`
        : `${name} can still share the Ryder Cup`;
    }
    return `${name} cannot win or share the Ryder Cup`;
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={onBack} style={{ ...btn(false), padding: "8px 12px" }}>‹ Ryder Cups</button>
        <div style={{ flex: 1 }} />
        <span style={{ color: locked ? "#5BD08A" : C.gold, fontSize: 11 }}>{locked ? "● Schedule locked" : "● Schedule draft"}</span>
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
        <div style={{ color: C.sage, fontSize: 11, textAlign: "center", marginTop: 7 }}>
          Live projection · {fmtCompetitionPoints(total.decidedA)}–{fmtCompetitionPoints(total.decidedB)} secured · {total.decidedCount}/{locked ? plannedMatchCount : total.matchCount} matches final
        </div>
        {locked ? <div style={{ marginTop: 12, borderTop: `1px solid ${C.borderGreen}`, paddingTop: 10, textAlign: "center" }}>
          <div style={{ color: C.cream, fontSize: 12, fontWeight: 800 }}>
            {cupShared
              ? "The Ryder Cup is shared"
              : clinched
                ? `${clinched === "A" ? competition.team_a_name : competition.team_b_name} has clinched the Ryder Cup`
                : <><div>{pathText(competition.team_a_name, outcome.teamA, schedule.teamATarget)}</div><div style={{ marginTop: 3 }}>{pathText(competition.team_b_name, outcome.teamB, schedule.teamBTarget)}</div></>}
          </div>
          <div style={{ color: C.sage, fontSize: 11, marginTop: 3 }}>{fmtCompetitionPoints(schedule.totalPoints)} scheduled points · {competition.tie_rule === "shared" ? "a level finish shares the Ryder Cup" : `${competition.tie_rule === "team_a_retains" ? competition.team_a_name : competition.team_b_name} retains on a tie`}</div>
        </div> : <div style={{ marginTop: 12, background: "rgba(201,162,39,.12)", border: `1px solid ${C.gold}`, borderRadius: 10, padding: "8px 12px", color: C.cream, fontSize: 11.5, lineHeight: 1.4 }}>
          Schedule is not locked. Current games can be scored, but BNN will not declare a Ryder Cup winner until the points denominator is confirmed.
        </div>}
      </div>

      <Eyebrow>TEAMS</Eyebrow>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {(["A", "B"] as const).map((key, idx) => <div key={key} style={{ background: C.greenLight, borderRadius: 12, padding: 12 }}>
          <div style={{ color: idx === 0 ? aColor : bColor, fontSize: 13, fontWeight: 800 }}>{key === "A" ? competition.team_a_name : competition.team_b_name}</div>
          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>{roster.filter((p) => p.team_key === key).map((p) => <div key={p.user_id} style={{ display: "flex", alignItems: "center", gap: 7, color: C.cream, fontSize: 12 }}><Avatar src={p.avatar_url} name={p.display_name} size={22} /><span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.display_name}</span></div>)}</div>
        </div>)}
      </div>

      <div style={{ display: "flex", alignItems: "center" }}><Eyebrow>SESSIONS</Eyebrow><div style={{ flex: 1 }} />{manage && !locked ? <button onClick={() => { setAdding((v) => !v); setEditingSessionId(null); }} style={{ ...btn(false), fontSize: 12, padding: "8px 12px" }}>{adding ? "Cancel" : "＋ Add session"}</button> : null}</div>
      <div style={{ background: C.greenLight, borderRadius: 12, padding: 12, marginBottom: 10, border: `1px solid ${locked ? "#5BD08A" : C.gold}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ flex: 1 }}><div style={{ color: C.cream, fontWeight: 800, fontSize: 13 }}>{locked ? "Ryder Cup scoring contract" : "Build the Ryder Cup scoring contract"}</div><div style={{ color: C.sage, fontSize: 11, marginTop: 3 }}>{sessions?.length || 0} sessions · {plannedMatchCount} matches · {fmtCompetitionPoints(schedule.totalPoints)} total points</div></div>{manage ? <button disabled={scheduleBusy || (!locked && !sessions?.length)} onClick={locked ? reopenSchedule : lockSchedule} style={{ ...btn(!locked), fontSize: 11, padding: "8px 12px", opacity: scheduleBusy ? .6 : 1 }}>{locked ? "Reopen schedule" : "Review & lock"}</button> : null}</div>
        <label style={{ display: "block", color: C.sage, fontSize: 11, fontWeight: 800, marginTop: 10 }}>IF THE RYDER CUP FINISHES LEVEL<select disabled={locked || !manage || scheduleBusy} value={competition.tie_rule} onChange={(e) => void changeTieRule(e.target.value as Competition["tie_rule"])} style={{ ...inputStyle, marginTop: 5, width: "100%", fontSize: 12 }}><option value="shared">The Ryder Cup is shared</option><option value="team_a_retains">{competition.team_a_name} retains the Ryder Cup</option><option value="team_b_retains">{competition.team_b_name} retains the Ryder Cup</option></select></label>
      </div>
      {adding ? <div style={{ background: C.greenLight, borderRadius: 14, padding: 14, marginBottom: 12 }}>
        <label style={{ color: C.sage, fontSize: 11, fontWeight: 800 }}>SESSION NAME</label><input value={sessionName} onChange={(e) => setSessionName(e.target.value)} style={{ ...inputStyle, marginTop: 6 }} />
        <label style={{ display: "block", color: C.sage, fontSize: 11, fontWeight: 800, marginTop: 12 }}>FORMAT</label>
        <select disabled={!!editingSession?.game_id} value={format} onChange={(e) => setFormat(e.target.value as CompetitionSession["format"])} style={{ ...inputStyle, marginTop: 6, opacity: editingSession?.game_id ? .65 : 1 }}><option value="fourball">Four-Ball</option><option value="alt_shot">Alternate Shot</option><option value="match">Singles</option></select>
        <div style={{ marginTop: 12 }}><label style={{ color: C.sage, fontSize: 11, fontWeight: 800 }}>DATE</label><ShortDateInput value={playDate} onChange={setPlayDate} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}><label style={{ color: C.sage, fontSize: 11, fontWeight: 800 }}>MATCHES<input inputMode="numeric" value={plannedMatches} onChange={(e) => setPlannedMatches(e.target.value)} style={{ ...inputStyle, marginTop: 6 }} /></label><label style={{ color: C.sage, fontSize: 11, fontWeight: 800 }}>POINTS EACH<input inputMode="decimal" value={pointsPerMatch} onChange={(e) => setPointsPerMatch(e.target.value)} style={{ ...inputStyle, marginTop: 6 }} /></label></div>
        <div style={{ color: C.sage, fontSize: 11, lineHeight: 1.45, marginTop: 10 }}>A halved match splits its value equally. Save every planned session, review the total, then lock the schedule before play.</div>
        <button disabled={scheduleBusy} onClick={savePlannedSession} style={{ ...btn(true), width: "100%", marginTop: 12 }}>{scheduleBusy ? "Saving…" : editingSessionId ? "Save schedule changes" : "Add to Ryder Cup schedule"}</button>
      </div> : null}

      {sessions === null ? <div style={{ color: C.sage }}>Loading sessions…</div> : sessions.length === 0 ? <div style={{ background: C.greenLight, borderRadius: 12, padding: 18, color: C.sage, textAlign: "center" }}>No sessions yet. Add Four-Ball, Alternate Shot or Singles.</div> : sessions.map((s) => (
        <div key={s.id} style={{ width: "100%", boxSizing: "border-box", background: C.greenLight, borderRadius: 12, padding: "13px 16px", marginBottom: 9 }}>
          <button disabled={!s.game_id} onClick={() => s.game_id && onOpenGame(s.game_id)} style={{ width: "100%", background: "none", border: "none", padding: 0, textAlign: "left", cursor: s.game_id ? "pointer" : "default" }}><div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ flex: 1, minWidth: 0 }}><div style={{ color: C.cream, fontSize: 14, fontWeight: 800 }}>{s.name}</div><div style={{ color: C.sage, fontSize: 11, marginTop: 2 }}>{competitionFormatLabel(s.format)} · {formatDate(s.play_date)} · {s.planned_match_count} × {fmtCompetitionPoints(Number(s.points_per_match))} pt · {s.score.decidedCount}/{s.planned_match_count} final</div></div>{s.game_id ? <><div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 800 }}><span style={{ color: aColor }}>{fmtCompetitionPoints(s.score.projectedA)}</span><span style={{ color: C.sage, margin: "0 6px" }}>–</span><span style={{ color: bColor }}>{fmtCompetitionPoints(s.score.projectedB)}</span></div><span style={{ color: C.gold, fontSize: 18 }}>›</span></> : null}</div></button>
          {manage && !locked ? <button onClick={() => editPlannedSession(s)} style={{ ...btn(false), marginTop: 9, padding: "8px 12px", fontSize: 11 }}>Edit schedule</button> : null}
          {!s.game_id && manage ? <button onClick={() => createSessionGame(s)} style={{ ...btn(true), width: "100%", marginTop: 10, fontSize: 12 }}>Set up this session’s game</button> : null}
          {s.game_id && s.score.matchCount !== Number(s.planned_match_count) ? <div style={{ color: C.gold, fontSize: 11, marginTop: 8 }}>Setup needs attention: this game currently has {s.score.matchCount} of {s.planned_match_count} planned matches.</div> : null}
          {s.score.matches.length ? <div style={{ borderTop: `1px solid ${C.borderGreen}`, marginTop: 10, paddingTop: 6 }}>{s.score.matches.map((m) => {
            const status = !m.started ? "Not started" : m.decided ? (m.result || (m.lead === 0 ? "Halved" : `${Math.abs(m.lead)} UP`)) : (m.lead === 0 ? `All square thru ${m.thru}` : `${m.winnerTeam === "A" ? competition.team_a_name : competition.team_b_name} ${Math.abs(m.lead)} UP thru ${m.thru}`);
            return <div key={m.key} style={{ padding: "8px 12px", borderBottom: `1px solid rgba(178,203,189,.14)` }}><div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 18px minmax(0,1fr)", gap: 6, color: C.cream, fontSize: 11.5 }}><span style={{ overflowWrap: "anywhere" }}>{m.leftNames}</span><span style={{ color: C.sage, textAlign: "center" }}>v</span><span style={{ textAlign: "right", overflowWrap: "anywhere" }}>{m.rightNames}</span></div><div style={{ marginTop: 3, color: m.winnerTeam === "A" ? aColor : m.winnerTeam === "B" ? bColor : C.sage, fontSize: 11, fontWeight: 800, textAlign: "center" }}>{m.decided && m.winnerTeam ? `${m.winnerTeam === "A" ? m.leftNames : m.rightNames} · ${status}` : status}</div></div>;
          })}</div> : null}
        </div>
      ))}
      {err ? <div style={{ color: C.overRedDark, fontSize: 12, marginTop: 10 }}>{err}</div> : null}
    </div>
  );
}
