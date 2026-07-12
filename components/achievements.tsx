"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { C } from "@/lib/golf";
import { BADGES, BADGE_BY_KEY } from "@/lib/badges";

const supabase = createClient();

const TIER_COLOR: Record<string, string> = { common: C.sage, rare: "#7FB8FF", elite: C.gold };
const CAT_LABEL: Record<string, string> = {
  scoring: "Scoring",
  streaks: "Streaks & consistency",
  ballstriking: "Ball-striking & short game",
  milestones: "Milestones",
};
const CAT_ORDER = ["scoring", "streaks", "ballstriking", "milestones"];

type Earned = { badge_key: string; count: number; best_value: number | null };

// How a "best" badge's value reads on the disc.
function fmtBest(key: string, v: number | null): string | null {
  if (v == null) return null;
  if (key === "best_vs_par") return v === 0 ? "E" : v > 0 ? `+${v}` : `${v}`;
  if (key === "best_differential") return Number(v).toFixed(1);
  return `${v}`;
}

export function AchievementsWall({ user, refreshKey = 0 }: { user: any; refreshKey?: number }) {
  const [earned, setEarned] = useState<Record<string, Earned> | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("member_badges")
        .select("badge_key,count,best_value")
        .eq("user_id", user.id);
      if (!alive) return;
      const m: Record<string, Earned> = {};
      (data || []).forEach((r: any) => { m[r.badge_key] = r; });
      setEarned(m);
    })();
    return () => { alive = false; };
  }, [user.id, refreshKey]);

  const total = BADGES.length;
  const got = earned ? Object.keys(earned).length : 0;

  return (
    <div style={{ maxWidth: 640, margin: "16px auto 0", background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: "16px 16px 20px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontFamily: "Georgia, serif", fontSize: 19, fontWeight: 800, color: C.ink }}>Achievements</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.gold }}>{earned == null ? "…" : `${got} of ${total} earned`}</div>
      </div>
      <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 14 }}>Badges you&apos;ve unlocked across your rounds. Records update whenever you beat them.</div>

      {CAT_ORDER.map((cat) => {
        const defs = BADGES.filter((b) => b.category === cat);
        if (!defs.length) return null;
        return (
          <div key={cat} style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, letterSpacing: 1.5, fontWeight: 800, textTransform: "uppercase", color: C.gold, marginBottom: 10 }}>{CAT_LABEL[cat]}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 12 }}>
              {defs.map((b) => {
                const e = earned?.[b.key];
                const on = !!e;
                const tc = TIER_COLOR[b.tier];
                const best = on ? fmtBest(b.key, e!.best_value) : null;
                const showCount = on && b.kind === "count" && (e!.count || 0) > 1;
                return (
                  <div key={b.key} title={b.desc} style={{ textAlign: "center", opacity: on ? 1 : 0.4 }}>
                    <div style={{
                      width: 50, height: 50, margin: "0 auto", borderRadius: "50%",
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 23,
                      background: on ? "radial-gradient(circle at 50% 32%, #20624a, #0e3a2c)" : "#E7E2D2",
                      border: `2px solid ${on ? tc : C.line}`,
                      boxShadow: on && b.tier !== "common" ? `0 0 12px -4px ${tc}` : "none",
                      filter: on ? "none" : "grayscale(1)",
                      position: "relative",
                    }}>
                      <span>{on ? b.icon : "🔒"}</span>
                      {showCount && (
                        <span style={{ position: "absolute", right: -4, bottom: -4, minWidth: 18, height: 18, padding: "0 4px", borderRadius: 9, background: C.gold, color: "#1c1c15", fontSize: 10.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", border: "1.5px solid #fffdf6" }}>×{e!.count}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: C.ink, marginTop: 6, lineHeight: 1.2, fontWeight: on ? 700 : 500 }}>{b.label}</div>
                    {best != null && <div style={{ fontSize: 10.5, color: C.gold, fontWeight: 800, marginTop: 1 }}>{best}</div>}
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
