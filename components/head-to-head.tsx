"use client";
// Profile → Head-to-head & partners (210.0, owner-approved mock). A member's OWN record only (owner decision):
// it loads only the member's own finished games. Results are the recap's own (lib/match-outcomes).
import React, { useEffect, useMemo, useState } from "react";
import { C } from "@/lib/golf";
import { Eyebrow } from "@/components/ui";
import { createClient } from "@/lib/supabase";
import { matchOutcomes, memberRecord, type H2HRow, type PartnerRow } from "@/lib/match-outcomes";
import { fetchAll, fetchAllIn } from "@/lib/fetch-all";
import type { Game, Player } from "@/lib/game-types";
import type { AltShotScoreRow } from "@/lib/alt-shot-side-scores";

const pts = (n: number) => (Math.floor(n) === n ? String(n) : `${Math.floor(n) || ""}½`);

export function HeadToHead({ user }: { user: { id: string } }) {
  const supabase = useMemo(() => createClient(), []);
  const [rec, setRec] = useState<{ headToHead: H2HRow[]; partners: PartnerRow[] } | null>(null);
  // 210.2 (review point 9): a failed load is an error with Retry — never "no history", never a partial record.
  const [err, setErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setErr(null);
    (async () => {
      try {
        // Every row, paged (210.2 — review point 8).
        const mine = await fetchAll<{ game_id: string }>((from, to) => supabase.from("game_players").select("game_id, id").eq("user_id", user.id).order("id").range(from, to));
        const ids = [...new Set(mine.map((r) => r.game_id))];
        const [games, players, alt] = ids.length ? await Promise.all([
          fetchAllIn<Game>(supabase, "games", "id", ids),
          fetchAllIn<Player>(supabase, "game_players", "game_id", ids),
          fetchAllIn<AltShotScoreRow>(supabase, "game_alt_shot_scores", "game_id", ids),
        ]) : [[], [], []] as [Game[], Player[], AltShotScoreRow[]];
        const ended = games.filter((g) => (g as { status?: string }).status === "ended");
        const outcomes = ended.flatMap((g) => matchOutcomes(g, players.filter((p) => p.game_id === g.id), alt.filter((x) => x.game_id === g.id)));
        if (live) setRec(memberRecord(outcomes, user.id));
      } catch (e) {
        if (live) setErr(e instanceof Error ? e.message : String(e));   // keep any earlier good result on screen
      }
    })();
    return () => { live = false; };
  }, [supabase, user.id, attempt]);

  if (err && !rec) return (
    <div data-head-to-head-error style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.borderGreen}` }}>
      <Eyebrow>HEAD-TO-HEAD & PARTNERS</Eyebrow>
      <div style={{ color: C.sage, fontSize: 13, marginTop: 6 }}>Couldn&apos;t load your match history.{" "}
        <button type="button" onClick={() => setAttempt((a) => a + 1)} style={{ background: "transparent", border: "none", padding: 0, color: C.gold, fontWeight: 800, cursor: "pointer", fontSize: 13 }}>Retry</button>
      </div>
    </div>
  );
  if (!rec) return null;
  if (!rec.headToHead.length && !rec.partners.length) return null;   // nothing to show until there are finished matches
  const best = rec.partners.find((p) => p.played >= 2);
  const th: React.CSSProperties = { color: C.sage, fontSize: 11, fontWeight: 700, textAlign: "right", paddingTop: 4, paddingBottom: 4 };
  const td: React.CSSProperties = { borderTop: `1px solid ${C.green}`, paddingTop: 6, paddingBottom: 6, textAlign: "right", fontSize: 13, color: C.cream };
  return (
    <div data-head-to-head style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.borderGreen}` }}>
      <Eyebrow>HEAD-TO-HEAD & PARTNERS</Eyebrow>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 4 }}>Your record in finished games — only you see this.</div>
      {rec.headToHead.length ? (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }} data-h2h>
          <thead><tr><th style={{ ...th, textAlign: "left" }}>Against · singles</th><th style={th}>W</th><th style={th}>L</th><th style={th}>H</th></tr></thead>
          <tbody>{rec.headToHead.map((r) => (
            <tr key={r.userId}><td style={{ ...td, textAlign: "left" }}>{r.name}</td><td style={td}>{r.won}</td><td style={td}>{r.lost}</td><td style={td}>{r.halved}</td></tr>
          ))}</tbody>
        </table>
      ) : null}
      {rec.partners.length ? (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14 }} data-partners>
          <thead><tr><th style={{ ...th, textAlign: "left" }}>With · four-ball, alt shot, Trifecta</th><th style={th}>Played</th><th style={th}>Won</th><th style={th}>Pts</th></tr></thead>
          <tbody>{rec.partners.map((r) => (
            <tr key={r.userId}><td style={{ ...td, textAlign: "left" }}>{r.name}{best && best.userId === r.userId ? " ⭐" : ""}</td><td style={td}>{r.played}</td><td style={td}>{r.won}</td><td style={td}>{pts(r.points)}</td></tr>
          ))}</tbody>
        </table>
      ) : null}
      {best ? <div style={{ color: C.cream, fontSize: 13, marginTop: 8 }}>⛳ Your best partner: <b>{best.name}</b> — {best.won} win{best.won === 1 ? "" : "s"} in {best.played}.</div> : null}
    </div>
  );
}
