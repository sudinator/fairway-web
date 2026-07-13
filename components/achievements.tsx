"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { C, Round, Hole } from "@/lib/golf";
import { BADGES, badgeEvidence } from "@/lib/badges";
import { syncBadges } from "@/lib/badge-sync";

const supabase = createClient();

const TIER_COLOR: Record<string, string> = { common: C.sage, rare: "#7FB8FF", elite: C.gold };
const CAT_LABEL: Record<string, string> = {
  scoring: "Scoring",
  streaks: "Streaks & consistency",
  ballstriking: "Ball-striking & short game",
  milestones: "Milestones",
};
const CAT_ORDER = ["scoring", "streaks", "ballstriking", "milestones"];

type Earned = { badge_key: string; count: number; best_value: number | null; best_round_id: string | null; first_earned_at: string; last_earned_at: string };

function fmtBest(key: string, v: number | null): string | null {
  if (v == null) return null;
  if (key === "best_vs_par") return v === 0 ? "E" : v > 0 ? `+${v}` : `${v}`;
  if (key === "best_differential") return Number(v).toFixed(1);
  return `${v}`;
}
const fmtDate = (d?: string | null) => {
  if (!d) return "";
  const dt = new Date(d + (d.length <= 10 ? "T00:00:00" : ""));
  return isNaN(+dt) ? "" : dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

function HoleChip({ h }: { h: Hole }) {
  const tp = h.strokes != null ? h.strokes - h.par : null;
  const col = tp == null ? C.faint : tp < 0 ? C.birdie : tp > 0 ? C.bogey : C.ink;
  return (
    <div style={{ textAlign: "center", minWidth: 26 }}>
      <div style={{ fontSize: 9, color: C.faint }}>{h.hole_number}</div>
      <div style={{ fontSize: 13, fontWeight: 800, color: col, lineHeight: 1.1 }}>{h.strokes ?? "\u2013"}</div>
    </div>
  );
}

export function AchievementsWall({ user, rounds, refreshKey = 0 }: { user: any; rounds?: Round[]; refreshKey?: number }) {
  const [earned, setEarned] = useState<Record<string, Earned> | null>(null);
  const [roundsById, setRoundsById] = useState<Record<string, Round>>({});
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Sync first so the round link is attached before anything renders — this is
      // why opening Profile always shows the earning round, with no stale first click.
      if (rounds && rounds.length) { try { await syncBadges(supabase, user.id, rounds); } catch {} }
      if (!alive) return;
      const { data } = await supabase
        .from("member_badges")
        .select("badge_key,count,best_value,best_round_id,first_earned_at,last_earned_at")
        .eq("user_id", user.id);
      if (!alive) return;
      const m: Record<string, Earned> = {};
      (data || []).forEach((r: any) => { m[r.badge_key] = r; });
      setEarned(m);

      const ids = Array.from(new Set(Object.values(m).map((e) => e.best_round_id).filter(Boolean))) as string[];
      if (ids.length) {
        const { data: rs } = await supabase
          .from("rounds")
          .select("id,course,played_at,course_par,rating,slope,handicap_index,course_handicap,gross_score,holes(hole_number,par,stroke_index,strokes,putts,fairway,penalties,sand)")
          .in("id", ids);
        if (!alive) return;
        const rm: Record<string, Round> = {};
        (rs || []).forEach((r: any) => { rm[r.id] = { ...r, holes: (r.holes || []) as Hole[] }; });
        setRoundsById(rm);
      }
    })();
    return () => { alive = false; };
  }, [user.id, refreshKey, rounds]);

  const total = BADGES.length;
  const got = earned ? Object.keys(earned).length : 0;

  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 3 }}>
        <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 800 }}>Achievements</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.gold }}>{earned == null ? "\u2026" : `${got} of ${total}`}</div>
      </div>
      <div style={{ fontSize: 11.5, color: C.sage, marginBottom: 12 }}>Tap a badge to see the round that earned it.</div>

      {CAT_ORDER.map((cat) => {
        const defs = BADGES.filter((b) => b.category === cat);
        if (!defs.length) return null;
        const openDefInCat = defs.find((d) => d.key === open && earned?.[d.key]);
        return (
          <div key={cat} style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, letterSpacing: 1.5, fontWeight: 800, textTransform: "uppercase", color: C.gold, marginBottom: 10 }}>{CAT_LABEL[cat]}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gap: 12 }}>
              {defs.map((b) => {
                const e = earned?.[b.key];
                const on = !!e;
                const tc = TIER_COLOR[b.tier];
                const best = on ? fmtBest(b.key, e!.best_value) : null;
                const showCount = on && b.kind === "count" && (e!.count || 0) > 1;
                const isOpen = open === b.key && on;
                return (
                  <button key={b.key} onClick={() => on && setOpen(isOpen ? null : b.key)} title={b.desc}
                    style={{ textAlign: "center", opacity: on ? 1 : 0.4, background: "transparent", border: "none", padding: 0, cursor: on ? "pointer" : "default" }}>
                    <div style={{
                      width: 48, height: 48, margin: "0 auto", borderRadius: "50%",
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
                      background: on ? "radial-gradient(circle at 50% 32%, #20624a, #0e3a2c)" : "#20463a",
                      border: `2px solid ${on ? tc : C.greenMid}`,
                      boxShadow: isOpen ? `0 0 0 3px ${tc}66` : on && b.tier !== "common" ? `0 0 12px -4px ${tc}` : "none",
                      filter: on ? "none" : "grayscale(1)", position: "relative",
                    }}>
                      <span>{on ? b.icon : "\uD83D\uDD12"}</span>
                      {showCount && (
                        <span style={{ position: "absolute", right: -4, bottom: -4, minWidth: 18, height: 18, padding: "0 4px", borderRadius: 9, background: C.gold, color: "#1c1c15", fontSize: 10.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", border: "1.5px solid #10402f" }}>{"\u00d7"}{e!.count}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 9.5, color: C.cream, marginTop: 6, lineHeight: 1.2, fontWeight: on ? 700 : 500 }}>{b.label}</div>
                    {best != null && <div style={{ fontSize: 10.5, color: C.gold, fontWeight: 800, marginTop: 1 }}>{best}</div>}
                  </button>
                );
              })}
            </div>

            {openDefInCat && (() => {
              const e = earned![openDefInCat.key];
              const rnd = e.best_round_id ? roundsById[e.best_round_id] : null;
              const ev = rnd ? badgeEvidence(openDefInCat.key, rnd) : null;
              const evHoles = ev?.holes && rnd ? rnd.holes.filter((h) => ev.holes!.includes(h.hole_number)).sort((a, b) => a.hole_number - b.hole_number) : [];
              const repeat = openDefInCat.kind === "count" && (e.count || 0) > 1;
              return (
                <div style={{ marginTop: 12, background: "#0e3a2c", border: `1px solid ${C.greenMid}`, borderRadius: 12, padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                    <div style={{ color: C.cream, fontSize: 13.5, fontWeight: 800 }}>{openDefInCat.icon} {openDefInCat.label}</div>
                    <button onClick={() => setOpen(null)} style={{ background: "transparent", border: "none", color: C.sage, fontSize: 16, cursor: "pointer", lineHeight: 1 }}>{"\u00d7"}</button>
                  </div>
                  <div style={{ color: C.sage, fontSize: 11.5, marginTop: 3, lineHeight: 1.5 }}>{openDefInCat.desc}</div>

                  {ev && <div style={{ color: C.cream, fontSize: 12.5, marginTop: 9, fontWeight: 600 }}>{ev.text}</div>}

                  {evHoles.length > 0 && (
                    <div style={{ display: "flex", gap: 8, marginTop: 9, overflowX: "auto", paddingBottom: 2 }}>
                      {evHoles.map((h) => <HoleChip key={h.hole_number} h={h} />)}
                    </div>
                  )}

                  {rnd && (
                    <div style={{ color: C.gold, fontSize: 11, marginTop: 10, fontWeight: 700 }}>
                      {repeat ? "Most recently at " : "At "}{rnd.course}{rnd.played_at ? ` \u00b7 ${fmtDate(rnd.played_at)}` : ""}
                      {repeat ? ` \u00b7 earned ${e.count}\u00d7` : ""}
                    </div>
                  )}
                  {!rnd && <div style={{ color: C.faint, fontSize: 11, marginTop: 10 }}>Earned {fmtDate(e.first_earned_at)}.</div>}
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}
