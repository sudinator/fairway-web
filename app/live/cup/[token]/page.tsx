"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { C, fmtDate } from "@/lib/golf";
import { teamAccent } from "@/lib/game-colors";
import { liveCupContext, type LiveCupSession, type LiveCupMatch, type LiveCupPlayer } from "@/lib/live-competition";

export const dynamic = "force-dynamic";
const supabase = createClient();

type LiveCup = {
  competition: {
    name: string; location: string | null; start_date: string; status: string;
    team_a_name: string; team_b_name: string;
    tie_rule: "shared" | "team_a_retains" | "team_b_retains";
    schedule_status: string; completed_at: string | null;
  };
  sessions: LiveCupSession[];
  /** The Cup's own roster (competition_players). Absent on payloads from before 0152 was amended. */
  players?: LiveCupPlayer[];
};

const FORMAT_LABEL: Record<string, string> = {
  fourball: "Four-Ball", alt_shot: "Alternate Shot", match: "Singles", trifecta: "Trifecta",
};
/** What the viewer is actually watching, in one sentence per format. */
const FORMAT_BLURB: Record<string, string> = {
  fourball: "Both partners play their own ball; the better net score counts for the side. One point per match.",
  alt_shot: "One ball per side, partners alternating shots. One point per match.",
  match: "Singles: one player against one player, hole by hole. One point per match.",
  trifecta: "Two singles matches plus a team match inside every foursome \u2014 three points per group.",
};
const fmtPts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));

const card: React.CSSProperties = { background: C.card, borderRadius: 14, color: C.ink, padding: "8px 12px", marginBottom: 10 };
const label: React.CSSProperties = { color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase", margin: "16px 2px 6px" };

function MatchRow({ m, nameOf, aColor, bColor }: {
  m: LiveCupMatch; nameOf: (id: string) => string; aColor: string; bColor: string;
}) {
  // Read from the LEADING side, never a "DN" the reader has to attribute to somebody (183.1).
  const text = !m.started ? "not started"
    : m.settled ? (m.lead === 0 ? "halved" : `won ${m.result || `${Math.abs(m.lead)} UP`}`)
    : (m.lead === 0 ? "all square" : `${Math.abs(m.lead)} up`);
  const color = !m.started ? C.faint : m.lead === 0 ? "#1E5B8A" : "#1B7A4B";
  // How far along, and whether it is over. A margin alone tells a viewer who is ahead but not
  // whether there are five holes left to change it — and a decided match reads as merely "ahead"
  // without saying it is finished. The close-out `thru` is the DECIDING hole, not holes played.
  const sub = !m.started ? "" : m.settled ? `final \u00b7 thru ${m.thru}` : `thru ${m.thru}`;
  const w = (side: "a" | "b") => (m.lead === 0 || !m.started ? 500 : ((side === "a") === (m.lead > 0) ? 800 : 500));
  const c = (side: "a" | "b") => (m.lead === 0 || !m.started ? C.ink : ((side === "a") === (m.lead > 0) ? C.ink : "#8B8775"));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 7, paddingBottom: 7, borderTop: `1px solid ${C.borderCard}` }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: aColor, flex: "none" }} />
      <span style={{ flex: 1, fontSize: 13, fontWeight: w("a"), color: c("a"), minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {m.leftIds.map(nameOf).join(" & ")}
      </span>
      <span style={{ color: C.faint, fontSize: 11 }}>v</span>
      <span style={{ flex: 1, fontSize: 13, fontWeight: w("b"), color: c("b"), textAlign: "right", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {m.rightIds.map(nameOf).join(" & ")}
      </span>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: bColor, flex: "none" }} />
      <span style={{ minWidth: 86, textAlign: "right", lineHeight: 1.25 }}>
        <span style={{ display: "block", color, fontSize: 12, fontWeight: 700 }}>{text}</span>
        {sub ? <span style={{ display: "block", color: C.faint, fontSize: 11 }}>{sub}</span> : null}
      </span>
    </div>
  );
}

export default function CupLivePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token as string;
  const [data, setData] = useState<LiveCup | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");

  const load = useCallback(async () => {
    const { data: d } = await supabase.rpc("get_live_competition", { p_token: token });
    if (!d) { setState("missing"); return; }
    setData(d as LiveCup); setState("ok");
  }, [token]);

  useEffect(() => { void load(); const t = setInterval(() => void load(), 45000); return () => clearInterval(t); }, [load]);

  const ctx = useMemo(() => (data ? liveCupContext(data.sessions, data.competition.tie_rule, data.players) : null), [data]);

  if (state === "loading") return <Shell><div style={{ color: C.sage, padding: 20 }}>Loading&hellip;</div></Shell>;
  if (state === "missing" || !data || !ctx) {
    return <Shell><div style={{ ...card, textAlign: "center" }}>This link isn&rsquo;t available.</div></Shell>;
  }

  const cup = data.competition;
  // Colour from the team NAME, using the same map the app uses. Hardcoding position colours meant
  // a team called "Red" rendered with an orange dot (188.5).
  const aColor = teamAccent(cup.team_a_name, 0), bColor = teamAccent(cup.team_b_name, 1);
  const nameById: Record<string, string> = {};
  for (const s of data.sessions) for (const p of s.players) nameById[p.id] = (p as { display_name?: string | null }).display_name || "\u2014";
  const nameOf = (id: string) => nameById[id] || "\u2014";
  const leader = ctx.total.decidedA === ctx.total.decidedB ? null : (ctx.total.decidedA > ctx.total.decidedB ? "A" : "B");

  return (
    <Shell>
      <div style={{ ...card, background: C.greenLight, color: C.cream }}>
        <div style={{ color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 1.2 }}>
          {cup.status === "complete" ? "FINAL" : "LIVE"} &middot; TEAM COMPETITION
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, fontFamily: "Georgia, serif" }}>{cup.name}</div>
        <div style={{ color: C.sage, fontSize: 12, marginTop: 4 }}>
          {[cup.location, cup.start_date ? fmtDate(cup.start_date) : null].filter(Boolean).join(" \u00b7 ")}
        </div>
      </div>

      {/* CONTEXT: what this competition IS, before any numbers. */}
      <div style={{ ...card, background: "rgba(201,162,39,0.10)", border: "1px solid rgba(201,162,39,0.45)", color: C.cream }}>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <b>{ctx.roster.length} players</b>, {ctx.teamA.length} v {ctx.teamB.length}, across{" "}
          <b>{data.sessions.length} session{data.sessions.length === 1 ? "" : "s"}</b> &mdash;{" "}
          <b>{ctx.plannedMatches} matches</b> worth <b>{fmtPts(ctx.schedule.totalPoints)} points</b> in total.
          {" "}
          {" "}Every match is worth its points however it is won &mdash; a one-hole win counts the same
          as a rout &mdash; and a halved match splits them.{" "}
          {cup.tie_rule === "shared"
            ? <>First to <b>{fmtPts(ctx.schedule.teamATarget)}</b> wins; {fmtPts(ctx.schedule.totalPoints / 2)}&ndash;{fmtPts(ctx.schedule.totalPoints / 2)} and the cup is shared.</>
            : <>{cup.tie_rule === "team_a_retains" ? cup.team_a_name : cup.team_b_name} retains on a tie, so they need <b>{fmtPts(cup.tie_rule === "team_a_retains" ? ctx.schedule.teamATarget : ctx.schedule.teamBTarget)}</b> and {cup.tie_rule === "team_a_retains" ? cup.team_b_name : cup.team_a_name} needs <b>{fmtPts(cup.tie_rule === "team_a_retains" ? ctx.schedule.teamBTarget : ctx.schedule.teamATarget)}</b> to take it.</>}
        </div>
      </div>

      <div style={label}>Team scores</div>
      <div style={card}>
        {([["A", cup.team_a_name, aColor, ctx.total.decidedA, ctx.teamA, ctx.neededA],
           ["B", cup.team_b_name, bColor, ctx.total.decidedB, ctx.teamB, ctx.neededB]] as const).map(([key, name, colr, pts, roster, needed]) => (
          <div key={key} style={{ paddingTop: 8, paddingBottom: 8, borderTop: key === "B" ? `1px solid ${C.borderCard}` : undefined }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 11, height: 11, borderRadius: 999, background: colr, flex: "none" }} />
              <span style={{ flex: 1, fontWeight: 800, fontSize: 16, color: leader && leader !== key ? "#8B8775" : C.ink }}>{name}</span>
              <span style={{ fontFamily: "Georgia, serif", fontVariantNumeric: "tabular-nums lining-nums", fontWeight: 800, fontSize: 24, color: leader === key ? C.gold : C.ink }}>{fmtPts(pts)}</span>
            </div>
            <div style={{ color: C.faint, fontSize: 11, marginTop: 3, marginLeft: 19, lineHeight: 1.5 }}>
              {roster.map((r) => r.name).join(" \u00b7 ") || "\u2014"}
            </div>
            {/* Before a ball is struck both teams "need" the same target, which is just the target
                restated twice. It earns its place once points are on the board. */}
            {needed > 0 && ctx.pointsRemaining > 0 && (ctx.total.decidedA + ctx.total.decidedB) > 0 && (
              <div style={{ color: "#8A6D12", fontSize: 12, fontWeight: 700, marginTop: 4, marginLeft: 19 }}>
                needs {fmtPts(needed)} more
              </div>
            )}
          </div>
        ))}
        <div style={{ borderTop: `1px solid ${C.borderCard}`, marginTop: 6, paddingTop: 8, textAlign: "center", color: C.faint, fontSize: 12 }}>
          {ctx.pointsRemaining > 0
            ? <><b style={{ color: C.ink }}>{fmtPts(ctx.pointsRemaining)}</b> point{ctx.pointsRemaining === 1 ? "" : "s"} still to play for</>
            : "All points decided"}
        </div>
      </div>

      <div style={label}>Sessions</div>
      {data.sessions.map((s, i) => {
        const sc = ctx.scores[i];
        return (
          <SessionCard key={s.id} s={s} sc={sc} nameOf={nameOf} aColor={aColor} bColor={bColor}
            aName={cup.team_a_name} bName={cup.team_b_name} />
        );
      })}

      <div style={{ color: C.sage, fontSize: 11, textAlign: "center", margin: "18px 0 26px", lineHeight: 1.6 }}>
        Scores update automatically. Handicap strokes are applied as each format requires.
      </div>
    </Shell>
  );
}

function SessionCard({ s, sc, nameOf, aColor, bColor, aName, bName }: {
  s: LiveCupSession; sc: ReturnType<typeof liveCupContext>["scores"][number];
  nameOf: (id: string) => string; aColor: string; bColor: string; aName: string; bName: string;
}) {
  // Not-started sessions still render, and still open: a viewer should be able to see WHO is playing
  // and what the format is before a ball is struck (product decision, Sep 2026).
  const [open, setOpen] = useState(!sc.notStarted);
  const planned = s.planned_match_count ?? sc.matchCount;
  return (
    <div style={card}>
      <div onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "baseline", gap: 8, cursor: "pointer" }}>
        <span style={{ fontWeight: 800, fontSize: 15 }}>{s.name}</span>
        <span style={{ color: C.faint, fontSize: 12 }}>{FORMAT_LABEL[s.format] || s.format}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "Georgia, serif", fontVariantNumeric: "tabular-nums lining-nums", fontWeight: 800, fontSize: 15 }}>
          {sc.notStarted ? <span style={{ color: C.faint, fontSize: 12, fontFamily: "inherit" }}>not started</span>
            : <>{fmtPts(sc.projectedA)}&ndash;{fmtPts(sc.projectedB)}</>}
        </span>
        <span style={{ color: C.faint }}>{open ? "\u25b4" : "\u25be"}</span>
      </div>
      <div style={{ color: C.faint, fontSize: 11, marginTop: 3 }}>
        {planned} match{planned === 1 ? "" : "es"} &middot; {fmtPts(s.points_per_match)} point{s.points_per_match === 1 ? "" : "s"} each
        {s.play_date ? ` \u00b7 ${fmtDate(s.play_date)}` : ""}
        {sc.matchCount > 0 && !sc.notStarted
          ? ` \u00b7 ${sc.decidedCount} of ${sc.matchCount} finished`
          : ""}
      </div>
      {open && (
        <>
          <div style={{ color: C.faint, fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>{FORMAT_BLURB[s.format] || ""}</div>
          {sc.matches.length ? (
            <div style={{ marginTop: 6 }}>
              <div style={{ display: "flex", gap: 8, color: C.faint, fontSize: 11, fontWeight: 800, letterSpacing: 1, marginBottom: 2 }}>
                <span style={{ width: 8 }} /><span style={{ flex: 1 }}>{aName.toUpperCase()}</span>
                <span style={{ flex: 1, textAlign: "right" }}>{bName.toUpperCase()}</span><span style={{ width: 8 }} /><span style={{ minWidth: 78 }} />
              </div>
              {sc.matches.map((m) => <MatchRow key={m.key} m={m} nameOf={nameOf} aColor={aColor} bColor={bColor} />)}
            </div>
          ) : (
            <div style={{ color: C.faint, fontSize: 12, marginTop: 8 }}>
              Matchups aren&rsquo;t set yet.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  // Own scroll container: globals.css locks the document for iOS bounce prevention and this route
  // renders outside .app-shell, so without this nothing below the fold is reachable (184.1).
  return (
    <div className="live-scroll" style={{ position: "fixed", inset: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", background: C.green, color: C.cream, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <div style={{ maxWidth: 620, margin: "0 auto", padding: "8px 12px" }}>
        <div style={{ textAlign: "center", color: C.cream, fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 800, marginBottom: 12 }}>
          Birdie <span style={{ color: C.gold }}>Num Num</span>
        </div>
        {children}
      </div>
    </div>
  );
}
