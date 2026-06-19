"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import {
  C, allocateStrokes, applyAllowance, stablefordPts,
  matchStatus, fourballStatus, computeTrifecta, computeSkins, toParStr,
  type FourballMember, type SkinPlayer,
} from "@/lib/golf";

export const dynamic = "force-dynamic";
const supabase = createClient();

type LiveMeta = { n: number; par: number; si: number | null };
type LivePlayer = {
  id: string; display_name: string; course_handicap: number | null; ch: number;
  team: string | null; tee_group: number | null; no_show: boolean;
  scores: (number | null)[]; putts: (number | null)[]; fairways: ("hit" | "miss" | null)[];
  penalties: (number | null)[]; sand: (boolean | null)[];
};
type LiveGame = {
  name: string; course: string; course_par: number | null;
  game_type: "stableford" | "match" | "fourball" | "skins" | "trifecta";
  status: "active" | "ended"; allowance_pct: number | null;
  team_score_mode: "best_ball" | "aggregate" | null;
  teams: { key: string; name: string }[];
  holes_meta: LiveMeta[]; played_at: string | null; ended_at: string | null;
};
type LiveData = {
  game: LiveGame; players: LivePlayer[];
  pairings: { a: string | null; b: string | null }[];
  foursomes: { id: string; name: string; swap: boolean; a: (string | null)[]; b: (string | null)[] }[];
};

const TEAM_COLOR: Record<string, string> = {
  red: "#E0695B", blue: "#5AA9E6", green: "#5BD08A", black: "#9AA0A6", white: "#D9D4C7",
  yellow: "#E8C84A", gold: "#D8B24A", orange: "#E0915B", purple: "#B084E0", pink: "#E08AB8",
};
const teamColor = (name: string | null | undefined, i: number) =>
  TEAM_COLOR[(name || "").trim().toLowerCase()] || (i === 0 ? "#5AA9E6" : "#E0915B");
const fmtHalf = (n: number) => { const w = Math.floor(n + 1e-9); const half = (n - w) >= 0.5 - 1e-9; if (w === 0 && half) return "\u00bd"; return `${w}${half ? "\u00bd" : ""}`; };

type PStat = {
  gross: number; net: number; thru: number; toPar: number; points: number;
  perHole: { n: number; par: number; gross: number | null; recv: number; pts: number | null }[];
  fairways: string | null; gir: string | null; putts: number | null; penalties: number | null;
};

function computePlayer(p: LivePlayer, meta: LiveMeta[], allowance: number): PStat {
  const playing = applyAllowance(p.ch, allowance);
  const alloc = allocateStrokes(meta.map((m) => ({ hole_number: m.n, stroke_index: m.si })), playing);
  let gross = 0, parPlayed = 0, thru = 0, points = 0, net = 0, putts = 0, pen = 0, fwHit = 0, fwTot = 0, girHit = 0, girTot = 0;
  let puttsT = false, penT = false, fwT = false;
  const perHole = meta.map((m, i) => {
    const s = p.scores?.[i] ?? null; const recv = alloc[m.n] || 0;
    const pts = stablefordPts(s, m.par, recv);
    if (s != null && s > 0) {
      gross += s; parPlayed += m.par; thru++; points += pts || 0; net += s - recv;
      const pt = p.putts?.[i]; if (pt != null) { puttsT = true; putts += pt; girTot++; if ((s - pt) <= (m.par - 2)) girHit++; }
      const pe = p.penalties?.[i]; if (pe != null) { pen += pe || 0; if (pe > 0) penT = true; }
      const fw = p.fairways?.[i]; if (m.par >= 4 && fw != null) { fwT = true; fwTot++; if (fw === "hit") fwHit++; }
    }
    return { n: m.n, par: m.par, gross: s, recv, pts: (s != null && s > 0) ? pts : null };
  });
  return {
    gross, net, thru, toPar: gross - parPlayed, points, perHole,
    fairways: fwT ? `${fwHit}/${fwTot}` : null, gir: (puttsT && girTot > 0) ? `${girHit}/${girTot}` : null,
    putts: puttsT ? putts : null, penalties: penT ? pen : null,
  };
}

function addPts(m: Record<string, number>, k: string | null | undefined, v: number) { if (k) m[k] = (m[k] || 0) + v; }

type TeamRows = { rows: { key: string; name: string; color: string; members: string[]; scoreNum: number; scoreLabel: string }[]; out: number; isSkins: boolean };

function teamScores(game: LiveGame, players: LivePlayer[], pairings: LiveData["pairings"], foursomes: LiveData["foursomes"], byId: Record<string, LivePlayer>, meta: LiveMeta[], allowance: number): TeamRows | null {
  const teams = (game.teams || []).filter((t) => t && t.key);
  const anyTeamed = players.some((p) => p.team);
  if (teams.length < 2 || !anyTeamed) return null;
  const pts: Record<string, number> = {}; teams.forEach((t) => { pts[t.key] = 0; });
  let out = 0;
  const teamOf = (id: string | null | undefined) => (id ? byId[id]?.team : null);
  const mkMembers = (ids: (string | null)[]): FourballMember[] =>
    ids.filter(Boolean).map((id) => { const q = byId[id as string]; return { id: id as string, gross: q?.scores || [], ch: q?.ch ?? null, noShow: !!q?.no_show }; });

  if (game.game_type === "match") {
    pairings.forEach((pr) => {
      const a = pr.a ? byId[pr.a] : null, b = pr.b ? byId[pr.b] : null; if (!a || !b) return;
      const st = matchStatus(meta, a.scores || [], b.scores || [], a.ch, b.ch, allowance);
      if (st.result !== "") { if (st.lead === 0) { addPts(pts, a.team, .5); addPts(pts, b.team, .5); } else if (st.lead > 0) addPts(pts, a.team, 1); else addPts(pts, b.team, 1); }
      else out++;
    });
  } else if (game.game_type === "fourball") {
    foursomes.forEach((f) => {
      const aIds = (f.a || []).filter(Boolean) as string[]; const bIds = (f.b || []).filter(Boolean) as string[];
      const st = fourballStatus(meta, mkMembers([...aIds, ...bIds]), aIds, bIds, allowance);
      const remaining = meta.length - st.thru; const decided = st.thru > 0 && (remaining === 0 || Math.abs(st.lead) > remaining);
      if (decided) { if (st.lead === 0) { addPts(pts, teamOf(aIds[0]), .5); addPts(pts, teamOf(bIds[0]), .5); } else if (st.lead > 0) addPts(pts, teamOf(aIds[0]), 1); else addPts(pts, teamOf(bIds[0]), 1); }
      else out++;
    });
  } else if (game.game_type === "trifecta") {
    foursomes.forEach((f) => {
      const aIds = (f.a || []).filter(Boolean) as string[]; const bIds = (f.b || []).filter(Boolean) as string[];
      const tri = computeTrifecta(meta, mkMembers([...aIds, ...bIds]), aIds, bIds, allowance, game.team_score_mode || "best_ball", !!f.swap);
      addPts(pts, teamOf(aIds[0]), tri.aPts); addPts(pts, teamOf(bIds[0]), tri.bPts);
    });
  } else if (game.game_type === "skins") {
    const sp: SkinPlayer[] = players.map((p) => ({ id: p.id, name: p.display_name, gross: p.scores || [], ch: p.ch }));
    const res = computeSkins(meta, sp, allowance);
    players.forEach((p) => { if (p.team) addPts(pts, p.team, res.skinsByPlayer[p.id] || 0); });
  } else {
    players.forEach((p) => { if (p.team) addPts(pts, p.team, computePlayer(p, meta, allowance).points); });
  }
  const isSkins = game.game_type === "skins";
  const rows = teams.map((t, i) => ({
    key: t.key, name: t.name, color: teamColor(t.name, i),
    members: players.filter((p) => p.team === t.key).map((p) => p.display_name),
    scoreNum: pts[t.key] || 0, scoreLabel: isSkins ? String(pts[t.key] || 0) : fmtHalf(pts[t.key] || 0),
  })).sort((x, y) => y.scoreNum - x.scoreNum);
  return { rows, out, isSkins };
}

function summaryText(game: LiveGame, teamRows?: TeamRows["rows"]): string {
  const a = game.allowance_pct ?? 100;
  const allow = a !== 100 ? ` Handicaps play at ${a}%.` : "";
  const named = teamRows && teamRows.length >= 2 ? `${teamRows.map((r) => r.name).join(" vs ")}` : null;
  switch (game.game_type) {
    case "stableford": return `Stableford — each hole scores points by net result vs par (par = 2 points, birdie = 3, bogey = 1, and so on). Most points wins.${allow}`;
    case "match": return named
      ? `Team match play — ${named}. Each pairing is its own match; winning earns a point for your team and a halved match is \u00bd each. Most team points wins.${allow}`
      : `Singles match play — win more holes than your opponent on net score. Each player's match status is shown below.${allow}`;
    case "fourball": return named
      ? `Four-ball — ${named}. Each foursome (2 v 2) is a match worth a point for the winning team, \u00bd for a halved match — Ryder-Cup style.${allow}`
      : `Four-ball match play — each 2-player side counts its better net ball on every hole; win more holes to win the match.${allow}`;
    case "trifecta": return `Trifecta${named ? ` — ${named}` : ""} — every 2-v-2 foursome plays three points a hole: two singles (each player vs an opponent) plus a team point (${game.team_score_mode === "aggregate" ? "both partners' nets added" : "the side's better net ball"}). Points roll up to the team total.${allow}`;
    case "skins": return `Skins — the lowest net score on a hole wins the skin; a tied hole carries the pot forward to the next.${allow}`;
    default: return "";
  }
}

function statusFor(p: LivePlayer, game: LiveGame, pairings: LiveData["pairings"], foursomes: LiveData["foursomes"], byId: Record<string, LivePlayer>, meta: LiveMeta[], allowance: number): string {
  if (game.game_type === "match") {
    const pr = pairings.find((x) => x.a === p.id || x.b === p.id); if (!pr) return "";
    const a = pr.a ? byId[pr.a] : null, b = pr.b ? byId[pr.b] : null; if (!a || !b) return "";
    const st = matchStatus(meta, a.scores || [], b.scores || [], a.ch, b.ch, allowance);
    if (st.thru === 0) return "not started";
    const lead = pr.a === p.id ? st.lead : -st.lead;
    if (st.result !== "") { if (st.lead === 0) return "halved"; return lead > 0 ? `won ${st.result}` : `lost ${st.result}`; }
    return lead > 0 ? `${lead} up` : lead < 0 ? `${-lead} dn` : "all square";
  }
  if (game.game_type === "fourball" || game.game_type === "trifecta") {
    const f = foursomes.find((x) => (x.a || []).includes(p.id) || (x.b || []).includes(p.id)); if (!f) return "";
    const aIds = (f.a || []).filter(Boolean) as string[]; const bIds = (f.b || []).filter(Boolean) as string[];
    const members = [...aIds, ...bIds].map((id) => { const q = byId[id]; return { id, gross: q?.scores || [], ch: q?.ch ?? null, noShow: !!q?.no_show }; });
    const st = fourballStatus(meta, members, aIds, bIds, allowance);
    if (st.thru === 0) return "not started";
    const lead = aIds.includes(p.id) ? st.lead : -st.lead;
    if (lead === 0) return "all square";
    return lead > 0 ? `team ${lead} up` : `team ${-lead} dn`;
  }
  return "";
}

export default function LiveScorecardPage({ params }: { params: { token: string } }) {
  const token = String(params.token || "");
  const [data, setData] = useState<LiveData | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");

  const load = useCallback(async () => {
    try {
      const { data: res, error } = await supabase.rpc("get_live_scorecard", { p_token: token });
      if (error) { setState("error"); return; }
      if (!res) { setState("missing"); return; }
      setData(res as LiveData); setState("ok");
    } catch { setState("error"); }
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(load, 25000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  return (
    <div style={{ minHeight: "100vh", background: C.green, color: C.cream, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "20px 14px 60px" }}>
        <div style={{ textAlign: "center", paddingTop: 8 }}>
          <span style={{ fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 800, color: C.cream }}>Birdie</span>
          <span style={{ fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 800, color: C.gold }}> Num Num</span>
        </div>
        {state === "loading" && <Centered text="Loading the live scorecard…" />}
        {state === "missing" && <Centered text="This live scorecard isn't available. The link may have been turned off, or the game ended more than 3 days ago." />}
        {state === "error" && <Centered text="Couldn't load this scorecard. Please try again in a moment." />}
        {state === "ok" && data && <Scorecard data={data} />}
        <div style={{ textAlign: "center", color: C.sage, fontSize: 11, marginTop: 28, opacity: 0.7 }}>Read-only live view · refreshes automatically</div>
      </div>
    </div>
  );
}

function Centered({ text }: { text: string }) {
  return <div style={{ background: C.greenLight, borderRadius: 16, padding: 28, marginTop: 40, textAlign: "center", color: C.sage, fontSize: 15, lineHeight: 1.5 }}>{text}</div>;
}
function SectionTitle({ children }: { children: string }) {
  return <div style={{ color: C.gold, fontSize: 11, letterSpacing: 2, fontWeight: 800, margin: "24px 4px 10px" }}>{children.toUpperCase()}</div>;
}

function Scorecard({ data }: { data: LiveData }) {
  const { game, players, pairings, foursomes } = data;
  const meta = game.holes_meta || [];
  const allowance = game.allowance_pct ?? 100;
  const byId = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p])), [players]);
  const ended = game.status === "ended";
  const ts = useMemo(() => teamScores(game, players, pairings, foursomes, byId, meta, allowance), [game, players, pairings, foursomes, byId, meta, allowance]);
  const stats = useMemo(() => { const m: Record<string, PStat> = {}; players.forEach((p) => { m[p.id] = computePlayer(p, meta, allowance); }); return m; }, [players, meta, allowance]);

  const isStab = game.game_type === "stableford";
  const isSkins = game.game_type === "skins";
  const skinsByPlayer = useMemo(() => {
    if (!isSkins) return {} as Record<string, number>;
    const sp = players.map((p) => ({ id: p.id, name: p.display_name, gross: p.scores || [], ch: p.ch }));
    return computeSkins(meta, sp, allowance).skinsByPlayer || {};
  }, [isSkins, players, meta, allowance]);

  const metricOf = (p: LivePlayer) => isStab ? stats[p.id].points : isSkins ? (skinsByPlayer[p.id] || 0) : -stats[p.id].toPar;
  const sortPlayers = (arr: LivePlayer[]) => [...arr].sort((a, b) => {
    const at = stats[a.id].thru, bt = stats[b.id].thru;
    if ((at > 0) !== (bt > 0)) return at > 0 ? -1 : 1;
    if (at === 0 && bt === 0) return a.display_name.localeCompare(b.display_name);
    const d = metricOf(b) - metricOf(a); if (d !== 0) return d;
    return a.display_name.localeCompare(b.display_name);
  });

  const fmtLabel: Record<string, string> = { stableford: "Stableford", match: "Singles match play", fourball: "Four-ball match play", skins: "Skins", trifecta: "Trifecta" };
  const teamFmt: Record<string, string> = { match: "Team match play", fourball: "Four-ball", trifecta: "Trifecta", skins: "Team skins", stableford: "Team Stableford" };
  const label = ts ? teamFmt[game.game_type] : fmtLabel[game.game_type];

  const groups = ts
    ? ts.rows.map((r) => ({ title: r.name, color: r.color, players: sortPlayers(players.filter((p) => p.team === r.key)) }))
    : [{ title: null as string | null, color: null as string | null, players: sortPlayers(players) }];

  const rightOf = (p: LivePlayer) => isStab ? `${stats[p.id].points} pts` : isSkins ? `${skinsByPlayer[p.id] || 0} skins` : (stats[p.id].thru ? toParStr(stats[p.id].toPar) : "—");

  return (
    <div>
      <div style={{ background: C.greenLight, borderRadius: 16, padding: "18px 18px 16px", marginTop: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, padding: "3px 8px", borderRadius: 999, background: ended ? "#3F3414" : "#1f7a52", color: ended ? "#E4CF86" : "#CFF5E2" }}>{ended ? "FINAL" : "\u25cf LIVE"}</span>
          <span style={{ color: C.gold, fontSize: 11, letterSpacing: 1.5, fontWeight: 700 }}>{(label || game.game_type).toUpperCase()}</span>
        </div>
        <div style={{ fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 800, color: C.cream, marginTop: 10 }}>{game.name}</div>
        <div style={{ color: C.sage, fontSize: 13, marginTop: 4 }}>{game.course}{game.played_at ? ` · ${game.played_at}` : ""}</div>
      </div>

      <SectionTitle>How it works</SectionTitle>
      <div style={{ background: "rgba(201,162,39,0.10)", border: "1px solid rgba(201,162,39,0.45)", borderRadius: 12, padding: "12px 14px", color: "#EFE6CD", fontSize: 13, lineHeight: 1.55 }}>
        {summaryText(game, ts?.rows)}
      </div>

      {ts && (
        <>
          <SectionTitle>Team scores</SectionTitle>
          <div style={{ background: C.card, borderRadius: 14, color: C.ink, padding: 14 }}>
            {ts.rows.map((r, i) => (
              <div key={r.key}>
                {i > 0 && <div style={{ height: 1, background: "#E8E2CE", margin: "12px 0" }} />}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 800, fontSize: 15 }}>
                      <span style={{ width: 11, height: 11, borderRadius: 3, background: r.color, display: "inline-block" }} />{r.name}
                    </div>
                    <div style={{ color: C.faint, fontSize: 12, marginTop: 3 }}>{r.members.join(" · ")}</div>
                  </div>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 28, fontWeight: 800, color: i === 0 ? C.green : C.faint }}>{r.scoreLabel}</div>
                </div>
              </div>
            ))}
            {!ts.isSkins && ts.out > 0 && <div style={{ textAlign: "center", color: C.faint, fontSize: 12, marginTop: 10 }}>{ts.out} match{ts.out === 1 ? "" : "es"} still out</div>}
          </div>
        </>
      )}

      <SectionTitle>Scorecards</SectionTitle>
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.title && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "14px 2px 4px" }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, background: g.color || C.sage, display: "inline-block" }} />
              <span style={{ color: C.cream, fontSize: 13, fontWeight: 800, letterSpacing: 1 }}>{g.title.toUpperCase()}</span>
            </div>
          )}
          {g.players.map((p, idx) => (
            <PlayerRow key={p.id} p={p} pos={idx + 1} stat={stats[p.id]} meta={meta} right={rightOf(p)} status={statusFor(p, game, pairings, foursomes, byId, meta, allowance)} />
          ))}
        </div>
      ))}
    </div>
  );
}

function PlayerRow({ p, pos, stat, meta, right, status }: { p: LivePlayer; pos: number; stat: PStat; meta: LiveMeta[]; right: string; status: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div onClick={() => setOpen((o) => !o)} style={{ background: C.card, borderRadius: 14, color: C.ink, padding: "12px 14px", marginTop: 8, cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 16, color: C.faint, fontWeight: 700 }}>{pos}</span>
        <span style={{ flex: 1, fontWeight: 800, fontSize: 15 }}>{p.display_name}{p.no_show ? " (out)" : ""}</span>
        <span style={{ fontWeight: 800, color: C.green, marginRight: 8 }}>{right}</span>
        <span style={{ color: C.faint }}>{open ? "\u25b4" : "\u25be"}</span>
      </div>
      <div style={{ color: C.faint, fontSize: 11, marginTop: 4, marginLeft: 26 }}>
        {stat.thru ? `thru ${stat.thru} · gross ${stat.gross}` : "not started"}{status ? ` · ${status}` : ""}
      </div>
      {open && <PlayerDetail stat={stat} meta={meta} />}
    </div>
  );
}

function PlayerDetail({ stat, meta }: { stat: PStat; meta: LiveMeta[] }) {
  const lblCell: React.CSSProperties = { textAlign: "left", padding: "3px 6px", fontWeight: 700 };
  const cCell: React.CSSProperties = { textAlign: "center", padding: "3px 4px" };
  const totCell: React.CSSProperties = { textAlign: "center", padding: "3px 6px", fontWeight: 800, color: C.green };
  const half = Math.ceil(meta.length / 2);

  const grid = (from: number, to: number, label: string) => {
    const hs = stat.perHole.slice(from, to);
    const parSum = hs.reduce((a, h) => a + h.par, 0);
    const grossSum = hs.reduce((a, h) => a + (h.gross && h.gross > 0 ? h.gross : 0), 0);
    const ptsSum = hs.reduce((a, h) => a + (h.pts || 0), 0);
    return (
      <div style={{ overflowX: "auto", marginTop: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12, minWidth: hs.length * 30 + 72 }}>
          <tbody>
            <tr style={{ color: C.faint }}><td style={lblCell}>Hole</td>{hs.map((h) => <td key={h.n} style={cCell}>{h.n}</td>)}<td style={totCell}>{label}</td></tr>
            <tr style={{ color: C.faint }}><td style={lblCell}>Par</td>{hs.map((h) => <td key={h.n} style={cCell}>{h.par}</td>)}<td style={cCell}>{parSum}</td></tr>
            <tr><td style={lblCell}>Score</td>{hs.map((h) => {
              const c = h.gross == null ? C.faint : h.gross < h.par ? "#1B7A4B" : h.gross === h.par ? "#1E5B8A" : "#C0392B";
              return (
                <td key={h.n} style={{ padding: "2px 3px" }}>
                  <div style={{ height: 8, lineHeight: 0 }}>{h.recv > 0 && Array.from({ length: Math.min(h.recv, 2) }).map((_, d) => <span key={d} style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#E8730C", margin: "0 1px" }} />)}</div>
                  <div style={{ fontWeight: 800, fontSize: 14, color: c }}>{h.gross && h.gross > 0 ? h.gross : "\u00b7"}</div>
                </td>
              );
            })}<td style={totCell}>{grossSum || "\u00b7"}</td></tr>
            <tr style={{ background: "#F4F0E1" }}><td style={{ ...lblCell, background: "transparent" }}>Points</td>{hs.map((h) => <td key={h.n} style={{ ...cCell, color: C.green, fontWeight: 700 }}>{h.gross && h.gross > 0 ? (h.pts ?? 0) : "\u00b7"}</td>)}<td style={{ ...cCell, color: C.green, fontWeight: 800 }}>{ptsSum}</td></tr>
          </tbody>
        </table>
      </div>
    );
  };

  const chips: [string, string][] = [];
  if (stat.fairways != null) chips.push(["Fairways", stat.fairways]);
  if (stat.gir != null) chips.push(["GIR", stat.gir]);
  if (stat.putts != null) chips.push(["Putts", String(stat.putts)]);
  if (stat.penalties != null) chips.push(["Penalties", String(stat.penalties)]);

  return (
    <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 10, borderTop: `1px solid ${C.line}`, paddingTop: 6 }}>
      {grid(0, half, "OUT")}
      {meta.length > half && grid(half, meta.length, "IN")}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 13 }}>
        <span style={{ color: C.faint }}>Gross <b style={{ color: C.ink }}>{stat.gross || "\u00b7"}</b>{stat.thru ? <> · Net <b style={{ color: C.ink }}>{Math.round(stat.net)}</b></> : null}</span>
        <span style={{ color: C.faint }}>Stableford <b style={{ color: C.green }}>{stat.points} pts</b></span>
      </div>
      {chips.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>{chips.map(([k, v]) => <div key={k} style={{ background: "#F2EEDF", borderRadius: 8, padding: "7px 11px", fontSize: 12 }}>{k} <b style={{ color: C.green }}>{v}</b></div>)}</div>}
      <div style={{ color: C.faint, fontSize: 10, marginTop: 10, lineHeight: 1.5 }}><span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#E8730C", verticalAlign: "middle" }} /> gets a stroke (two = two strokes). Score color: under / par / over. Stats shown only if the player tracked them.</div>
    </div>
  );
}
