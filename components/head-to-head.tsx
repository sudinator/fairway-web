"use client";
// Profile → Head-to-head & partners (210.0, owner-approved mock). A member's OWN record only (owner decision):
// it loads only the member's own finished games. Results are the recap's own (lib/match-outcomes).
import React, { useEffect, useMemo, useState } from "react";
import { C } from "@/lib/golf";
import { Eyebrow } from "@/components/ui";
import { createClient } from "@/lib/supabase";
import { matchOutcomes, memberRecord, type H2HRow, type PartnerRow } from "@/lib/match-outcomes";
import type { Game, Player } from "@/lib/game-types";
import type { AltShotScoreRow } from "@/lib/alt-shot-side-scores";

const pts = (n: number) => (Math.floor(n) === n ? String(n) : `${Math.floor(n) || ""}½`);

export function HeadToHead({ user }: { user: { id: string } }) {
  const supabase = useMemo(() => createClient(), []);
  const [rec, setRec] = useState<{ headToHead: H2HRow[]; partners: PartnerRow[] } | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const { data: mine } = await supabase.from("game_players").select("game_id").eq("user_id", user.id);
      const ids = [...new Set((mine || []).map((r: { game_id: string }) => r.game_id))];
      if (!ids.length) { if (live) setRec({ headToHead: [], partners: [] }); return; }
      const games: Game[] = [], players: Player[] = [], alt: AltShotScoreRow[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const [g, p, a] = await Promise.all([
          supabase.from("games").select("*").in("id", chunk).eq("status", "ended"),
          supabase.from("game_players").select("*").in("game_id", chunk),
          supabase.from("game_alt_shot_scores").select("*").in("game_id", chunk),
        ]);
        games.push(...((g.data || []) as Game[])); players.push(...((p.data || []) as Player[])); alt.push(...((a.data || []) as AltShotScoreRow[]));
      }
      const outcomes = games.flatMap((g) => { try { return matchOutcomes(g, players.filter((p) => p.game_id === g.id), alt.filter((x) => x.game_id === g.id)); } catch { return []; } });
      if (live) setRec(memberRecord(outcomes, user.id));
    })();
    return () => { live = false; };
  }, [supabase, user.id]);

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
