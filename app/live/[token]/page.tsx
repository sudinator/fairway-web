"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import {
  C,
  allocateStrokes,
  applyAllowance,
  stablefordPts,
  matchStatus,
  fourballStatus,
  computeSkins,
  computeTrifecta,
  toParStr,
  type FourballMember,
  type SkinPlayer,
} from "@/lib/golf";

export const dynamic = "force-dynamic";

const supabase = createClient();

// ---- shapes returned by get_live_scorecard (display-safe; no account ids) ----
type LiveMeta = {
  n: number; par: number; si: number | null;
};
type LivePlayer = {
  id: string;                 // per-game alias (game_players row id)
  display_name: string;
  course_handicap: number | null;
  ch: number;                 // playing-handicap BASIS (pre-allowance), computed server-side
  team: string | null;
  tee_group: number | null;
  no_show: boolean;
  scores: (number | null)[];
  putts: (number | null)[];
  fairways: ("hit" | "miss" | null)[];
};
type LiveGame = {
  name: string; course: string; course_par: number | null;
  game_type: "stableford" | "match" | "fourball" | "skins" | "trifecta";
  status: "active" | "ended"; allowance_pct: number | null;
  team_score_mode: "best_ball" | "aggregate" | null;
  holes_meta: LiveMeta[]; played_at: string | null; ended_at: string | null;
};
type LiveData = {
  game: LiveGame;
  players: LivePlayer[];
  pairings: { a: string | null; b: string | null }[];
  foursomes: { id: string; name: string; swap: boolean; a: (string | null)[]; b: (string | null)[] }[];
};

const TEAM_COLOR: Record<string, string> = {
  red: "#E0695B", blue: "#5AA9E6", green: "#5BD08A", black: "#9AA0A6", white: "#D9D4C7",
  yellow: "#E8C84A", gold: "#D8B24A", orange: "#E0915B", purple: "#B084E0", pink: "#E08AB8",
};
const teamAccent = (name: string | null | undefined, i: number) =>
  TEAM_COLOR[(name || "").trim().toLowerCase()] || (i === 0 ? "#5AA9E6" : "#E0915B");

export default function LiveScorecardPage({ params }: { params: { token: string } }) {
  const token = String(params.token || "");
  const [data, setData] = useState<LiveData | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");

  const load = useCallback(async () => {
    try {
      const { data: res, error } = await supabase.rpc("get_live_scorecard", { p_token: token });
      if (error) { setState("error"); return; }
      if (!res) { setState("missing"); return; }
      setData(res as LiveData);
      setState("ok");
    } catch {
      setState("error");
    }
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(load, 25000); // poll for live updates
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  return (
    <div style={{ minHeight: "100vh", background: C.green, color: C.cream, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "20px 14px 60px" }}>
        <div style={{ textAlign: "center", paddingTop: 8 }}>
          <span style={{ fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 800, color: C.cream }}>Birdie</span>
          <span style={{ fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 800, color: C.gold }}> Num Num</span>
        </div>

        {state === "loading" && <Centered text="Loading the live scorecard…" />}
        {state === "missing" && <Centered text="This live scorecard isn't available. The link may have been turned off, or the game ended more than 3 days ago." />}
        {state === "error" && <Centered text="Couldn't load this scorecard. Please try again in a moment." />}
        {state === "ok" && data && <Scorecard data={data} />}

        <div style={{ textAlign: "center", color: C.sage, fontSize: 11, marginTop: 28, opacity: 0.7 }}>
          Read-only live view · refreshes automatically
        </div>
      </div>
    </div>
  );
}

function Centered({ text }: { text: string }) {
  return (
    <div style={{ background: C.greenLight, borderRadius: 16, padding: 28, marginTop: 40, textAlign: "center", color: C.sage, fontSize: 15, lineHeight: 1.5 }}>
      {text}
    </div>
  );
}

// Sum gross over played holes + to-par + holes played.
function grossLine(p: LivePlayer, meta: LiveMeta[]) {
  let gross = 0, parPlayed = 0, thru = 0;
  meta.forEach((m, i) => {
    const s = p.scores?.[i];
    if (s != null && s > 0) { gross += s; parPlayed += m.par; thru++; }
  });
  return { gross, toPar: gross - parPlayed, thru };
}

function Scorecard({ data }: { data: LiveData }) {
  const { game, players, pairings, foursomes } = data;
  const meta = game.holes_meta || [];
  const allowance = game.allowance_pct ?? 100;
  const byId = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p])), [players]);
  const ended = game.status === "ended";

  const fmtLabel: Record<string, string> = {
    stableford: "Stableford", match: "Singles match play", fourball: "Four-ball match play",
    skins: "Skins", trifecta: "Trifecta",
  };

  return (
    <div>
      {/* Header */}
      <div style={{ background: C.greenLight, borderRadius: 16, padding: "18px 18px 16px", marginTop: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{
            fontSize: 10, fontWeight: 800, letterSpacing: 1.5, padding: "3px 8px", borderRadius: 999,
            background: ended ? "#3F3414" : "#1f7a52", color: ended ? "#E4CF86" : "#CFF5E2",
          }}>
            {ended ? "FINAL" : "● LIVE"}
          </span>
          <span style={{ color: C.gold, fontSize: 11, letterSpacing: 1.5, fontWeight: 700 }}>
            {(fmtLabel[game.game_type] || game.game_type).toUpperCase()}
          </span>
        </div>
        <div style={{ fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 800, color: C.cream, marginTop: 10 }}>
          {game.name}
        </div>
        <div style={{ color: C.sage, fontSize: 13, marginTop: 4 }}>
          {game.course}{game.played_at ? ` · ${game.played_at}` : ""}
          {allowance !== 100 ? ` · ${allowance}% allowance` : ""}
        </div>
      </div>

      {/* Format-specific standings */}
      <Standings data={data} meta={meta} allowance={allowance} byId={byId} />

      {/* Universal gross scorecards */}
      <SectionTitle>Scorecards</SectionTitle>
      {players.map((p, i) => (
        <PlayerCard key={p.id} p={p} meta={meta} allowance={allowance} teamIndex={teamIndexOf(p, players)} />
      ))}
    </div>
  );
}

function teamIndexOf(p: LivePlayer, players: LivePlayer[]): number {
  const teams = Array.from(new Set(players.map((x) => x.team).filter(Boolean)));
  return p.team ? teams.indexOf(p.team) : -1;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ color: C.gold, fontSize: 11, letterSpacing: 2, fontWeight: 800, margin: "24px 4px 10px" }}>{String(children).toUpperCase()}</div>;
}

// ---------------- Standings (format-aware) ----------------
function Standings({ data, meta, allowance, byId }: {
  data: LiveData; meta: LiveMeta[]; allowance: number; byId: Record<string, LivePlayer>;
}) {
  const { game, players, pairings, foursomes } = data;
  const holeMeta = meta.map((m) => ({ n: m.n, par: m.par, si: m.si }));

  // Singles match play: head-to-head per pairing.
  if (game.game_type === "match" && pairings.length) {
    return (
      <>
        <SectionTitle>Matches</SectionTitle>
        {pairings.map((pr, i) => {
          const a = pr.a ? byId[pr.a] : null, b = pr.b ? byId[pr.b] : null;
          if (!a || !b) return null;
          const st = matchStatus(holeMeta, a.scores || [], b.scores || [], a.ch, b.ch, allowance);
          const lead = st.lead;
          const leaderName = lead === 0 ? null : (lead > 0 ? a.display_name : b.display_name);
          const label = st.thru === 0 ? "Not started" : (lead === 0 ? (st.result || "All square") : `${leaderName} ${st.result || `${Math.abs(lead)} UP`}`);
          return (
            <MatchRow key={i} left={a.display_name} right={b.display_name} label={label} thru={st.thru} total={meta.length} />
          );
        })}
      </>
    );
  }

  // Four-ball / trifecta: team result per foursome.
  if ((game.game_type === "fourball" || game.game_type === "trifecta") && foursomes.length) {
    const mkMembers = (ids: (string | null)[]): FourballMember[] =>
      ids.filter(Boolean).map((id) => {
        const p = byId[id as string];
        return { id: id as string, gross: p?.scores || [], ch: p?.ch ?? null, noShow: !!p?.no_show };
      });
    return (
      <>
        <SectionTitle>{game.game_type === "trifecta" ? "Trifecta" : "Matches"}</SectionTitle>
        {foursomes.map((f, i) => {
          const aIds = (f.a || []).filter(Boolean) as string[];
          const bIds = (f.b || []).filter(Boolean) as string[];
          const members = mkMembers([...aIds, ...bIds]);
          const aNames = aIds.map((id) => byId[id]?.display_name).filter(Boolean).join(" & ");
          const bNames = bIds.map((id) => byId[id]?.display_name).filter(Boolean).join(" & ");
          if (game.game_type === "trifecta") {
            const tri = computeTrifecta(holeMeta, members, aIds, bIds, allowance, game.team_score_mode || "best_ball", !!f.swap);
            return (
              <MatchRow key={i} left={aNames || "Side A"} right={bNames || "Side B"}
                label={`${tri.aPts} – ${tri.bPts} pts`} thru={tri.thru} total={meta.length} />
            );
          }
          const st = fourballStatus(holeMeta, members, aIds, bIds, allowance);
          const lead = st.lead;
          const leaderNames = lead === 0 ? null : (lead > 0 ? aNames : bNames);
          const label = st.thru === 0 ? "Not started" : (lead === 0 ? (st.result || "All square") : `${leaderNames} ${st.result || `${Math.abs(lead)} UP`}`);
          return <MatchRow key={i} left={aNames || "Side A"} right={bNames || "Side B"} label={label} thru={st.thru} total={meta.length} />;
        })}
      </>
    );
  }

  // Skins: skins won per player.
  if (game.game_type === "skins") {
    const skinPlayers: SkinPlayer[] = players.map((p) => ({ id: p.id, name: p.display_name, gross: p.scores || [], ch: p.ch }));
    const res = computeSkins(holeMeta, skinPlayers, allowance);
    const ranked = [...players].sort((a, b) => (res.skinsByPlayer[b.id] || 0) - (res.skinsByPlayer[a.id] || 0));
    return (
      <>
        <SectionTitle>Skins</SectionTitle>
        <div style={{ background: C.card, borderRadius: 14, padding: "6px 0", color: C.ink }}>
          {ranked.map((p, i) => (
            <LeaderRow key={p.id} pos={i + 1} name={p.display_name} team={p.team} teamIdx={teamIndexOf(p, players)}
              right={`${res.skinsByPlayer[p.id] || 0} skin${(res.skinsByPlayer[p.id] || 0) === 1 ? "" : "s"}`} />
          ))}
        </div>
        {res.carryAtEnd > 0 && (
          <div style={{ color: C.sage, fontSize: 12, marginTop: 8, textAlign: "center" }}>
            {res.carryAtEnd} skin{res.carryAtEnd === 1 ? "" : "s"} still carrying.
          </div>
        )}
      </>
    );
  }

  // Stableford and everything else: points (or net) leaderboard.
  const rows = players.map((p) => {
    const playing = applyAllowance(p.ch, allowance);
    const alloc = allocateStrokes(meta.map((m) => ({ hole_number: m.n, stroke_index: m.si })), playing);
    let pts = 0;
    meta.forEach((m, i) => { pts += stablefordPts(p.scores?.[i] ?? null, m.par, alloc[m.n] || 0) || 0; });
    const gl = grossLine(p, meta);
    const net = gl.gross - playing;
    return { p, pts, gross: gl.gross, toPar: gl.toPar, thru: gl.thru, net };
  });
  const isStableford = game.game_type === "stableford";
  rows.sort((a, b) => isStableford ? b.pts - a.pts : a.net - b.net);
  return (
    <>
      <SectionTitle>Leaderboard</SectionTitle>
      <div style={{ background: C.card, borderRadius: 14, padding: "6px 0", color: C.ink }}>
        {rows.map((r, i) => (
          <LeaderRow key={r.p.id} pos={i + 1} name={r.p.display_name} team={r.p.team} teamIdx={teamIndexOf(r.p, players)}
            sub={r.thru > 0 ? `thru ${r.thru} · ${toParStr(r.toPar)}` : "—"}
            right={isStableford ? `${r.pts} pts` : (r.thru > 0 ? `${Math.round(r.net)} net` : "—")} />
        ))}
      </div>
    </>
  );
}

function LeaderRow({ pos, name, team, teamIdx, sub, right }: {
  pos: number; name: string; team: string | null; teamIdx: number; sub?: string; right: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "9px 14px", borderTop: pos === 1 ? "none" : `1px solid ${C.line}` }}>
      <div style={{ width: 22, color: C.faint, fontWeight: 700, fontSize: 13 }}>{pos}</div>
      {team && <span style={{ width: 8, height: 8, borderRadius: 2, background: teamAccent(team, teamIdx), marginRight: 8, display: "inline-block" }} />}
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{name}</div>
        {sub && <div style={{ color: C.faint, fontSize: 11 }}>{sub}</div>}
      </div>
      <div style={{ fontWeight: 800, fontSize: 14, color: C.green }}>{right}</div>
    </div>
  );
}

function MatchRow({ left, right, label, thru, total }: {
  left: string; right: string; label: string; thru: number; total: number;
}) {
  return (
    <div style={{ background: C.card, borderRadius: 14, padding: "12px 14px", marginBottom: 8, color: C.ink }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700 }}>
        <span>{left}</span><span style={{ color: C.faint }}>vs</span><span style={{ textAlign: "right" }}>{right}</span>
      </div>
      <div style={{ textAlign: "center", marginTop: 8, fontWeight: 800, color: C.green, fontSize: 15 }}>{label}</div>
      <div style={{ textAlign: "center", color: C.faint, fontSize: 11, marginTop: 2 }}>
        {thru > 0 ? `thru ${thru} of ${total}` : ""}
      </div>
    </div>
  );
}

// ---------------- Per-player gross scorecard grid ----------------
function PlayerCard({ p, meta, allowance, teamIndex }: {
  p: LivePlayer; meta: LiveMeta[]; allowance: number; teamIndex: number;
}) {
  const playing = applyAllowance(p.ch, allowance);
  const gl = grossLine(p, meta);
  const half = Math.ceil(meta.length / 2);
  const front = meta.slice(0, half);
  const back = meta.slice(half);

  const cell = (m: LiveMeta, idx: number): React.ReactNode => {
    const s = p.scores?.[idx];
    let color = C.ink;
    if (s != null && s > 0) {
      const d = s - m.par;
      if (d <= -1) color = C.birdie;     // under par (red, matching app)
      else if (d >= 1) color = C.bogey;  // over par (blue)
    }
    return <span style={{ color, fontWeight: s != null && s !== m.par ? 800 : 600 }}>{s ?? "·"}</span>;
  };

  const Grid = ({ holes, offset, label }: { holes: LiveMeta[]; offset: number; label: string }) => {
    const sub = holes.reduce((acc, m, i) => { const s = p.scores?.[offset + i]; return s != null && s > 0 ? acc + s : acc; }, 0);
    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12, minWidth: holes.length * 26 + 90 }}>
          <tbody>
            <tr style={{ color: C.faint }}>
              <td style={{ textAlign: "left", padding: "3px 6px", fontWeight: 700 }}>Hole</td>
              {holes.map((m) => <td key={m.n} style={{ textAlign: "center", padding: "3px 4px", minWidth: 20 }}>{m.n}</td>)}
              <td style={{ textAlign: "center", padding: "3px 6px", fontWeight: 800 }}>{label}</td>
            </tr>
            <tr style={{ color: C.faint }}>
              <td style={{ textAlign: "left", padding: "3px 6px" }}>Par</td>
              {holes.map((m) => <td key={m.n} style={{ textAlign: "center", padding: "3px 4px" }}>{m.par}</td>)}
              <td style={{ textAlign: "center", padding: "3px 6px" }}>{holes.reduce((a, m) => a + m.par, 0)}</td>
            </tr>
            <tr>
              <td style={{ textAlign: "left", padding: "4px 6px", fontWeight: 700, color: C.ink }}>Score</td>
              {holes.map((m, i) => <td key={m.n} style={{ textAlign: "center", padding: "4px 4px" }}>{cell(m, offset + i)}</td>)}
              <td style={{ textAlign: "center", padding: "4px 6px", fontWeight: 800, color: C.green }}>{sub || "·"}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div style={{ background: C.card, borderRadius: 14, padding: "12px 12px 14px", marginBottom: 10, color: C.ink }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {p.team && <span style={{ width: 9, height: 9, borderRadius: 2, background: teamAccent(p.team, teamIndex), display: "inline-block" }} />}
          <span style={{ fontWeight: 800, fontSize: 15 }}>{p.display_name}{p.no_show ? " (no-show)" : ""}</span>
        </div>
        <div style={{ textAlign: "right", color: C.faint, fontSize: 11 }}>
          {p.course_handicap != null ? `CH ${p.course_handicap}` : ""}
          {allowance !== 100 && p.course_handicap != null ? ` · plays ${Math.round(playing)}` : ""}
        </div>
      </div>
      <Grid holes={front} offset={0} label="OUT" />
      {back.length > 0 && <div style={{ height: 6 }} />}
      {back.length > 0 && <Grid holes={back} offset={front.length} label="IN" />}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 14, marginTop: 8, fontSize: 13 }}>
        <span style={{ color: C.faint }}>Total <b style={{ color: C.ink }}>{gl.gross || "·"}</b></span>
        <span style={{ color: C.faint }}>To par <b style={{ color: gl.thru ? (gl.toPar < 0 ? C.birdie : gl.toPar > 0 ? C.bogey : C.ink) : C.ink }}>{gl.thru ? toParStr(gl.toPar) : "·"}</b></span>
      </div>
    </div>
  );
}
