"use client";
// Admin → Sandbaggers → Standout watch (209.1), from the approved mock. ADMIN ONLY — never on a member
// screen or a shared card.
import React, { useEffect, useMemo, useState } from "react";
import { C } from "@/lib/golf";
import { createClient } from "@/lib/supabase";
import { buildHighlights } from "@/lib/game-highlights";
import { summarizeWatch, WATCH_RULE, type WatchRow } from "@/lib/standout-watch";
import { fetchAll, fetchAllIn } from "@/lib/fetch-all";

export function AdminStandoutWatch() {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<WatchRow[] | null>(null);
  const [games, setGames] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const year = new Date().getFullYear();

  useEffect(() => {
    (async () => {
      // Every row, paged (210.2 — review point 8).
      let gs: any[] = [], players: any[] = [];
      try {
        gs = await fetchAll<any>((from, to) => supabase.from("games").select("*").eq("status", "ended").gte("played_at", `${year}-01-01`).lte("played_at", `${year}-12-31`).order("id").range(from, to));
        players = await fetchAllIn<any>(supabase, "game_players", "game_id", gs.map((g) => g.id));
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); return; }
      const perGame = (gs || []).map((g: any) => {
        const ps = players.filter((p) => p.game_id === g.id);
        let fieldRows: { name: string; userId: string | null; better: number }[] = [];
        try { fieldRows = buildHighlights(g, ps).fieldRows; } catch { fieldRows = []; }
        return { gameId: g.id, date: String(g.played_at || "").slice(0, 10), course: g.course || "", fieldRows };
      }).filter((g) => g.fieldRows.length);
      setGames(perGame.length);
      setRows(summarizeWatch(perGame));
    })();
  }, [supabase, year]);

  if (err) return <div style={{ color: C.gold, fontSize: 13 }}>Couldn&apos;t load: {err}</div>;
  if (!rows) return <div style={{ color: C.sage, fontSize: 13 }}>Loading this season&apos;s games…</div>;
  return (
    <div data-standout-watch>
      <div style={{ color: C.sage, fontSize: 12.5, lineHeight: 1.55, marginBottom: 10 }}>
        Who beats their handicap most often in {year}: games with 8+ players ({games} so far), each round measured against the field — the same standard as the recap&apos;s standout rounds.
        &quot;Worth a look&quot; = {WATCH_RULE.minStandouts}+ standouts and {WATCH_RULE.minAvgBetter}+ better than the field on average over {WATCH_RULE.minRounds}+ rounds: a pattern, not one great day — a prompt to check whether an index is out of date, never an accusation.
      </div>
      {!rows.length ? <div style={{ background: C.greenLight, borderRadius: 12, padding: 16, color: C.sage, fontSize: 13 }}>No games with 8+ players yet this season.</div> : (
        <div style={{ background: C.greenLight, borderRadius: 12, padding: "8px 12px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 54px 70px 86px", gap: 6, color: C.sage, fontSize: 11, fontWeight: 700, paddingTop: 4, paddingBottom: 4 }}>
            <span>Member</span><span style={{ textAlign: "right" }}>Rounds</span><span style={{ textAlign: "right" }}>Standouts</span><span style={{ textAlign: "right" }}>Avg vs field</span>
          </div>
          {rows.map((r) => (
            <div key={r.userId} data-watch-row={r.worthALook ? "flag" : "row"} style={{ borderTop: `1px solid ${C.green}` }}>
              <button type="button" onClick={() => setOpen(open === r.userId ? null : r.userId)}
                style={{ display: "grid", gridTemplateColumns: "1fr 54px 70px 86px", gap: 6, width: "100%", background: "transparent", border: "none", paddingTop: 8, paddingBottom: 8, paddingLeft: 0, paddingRight: 0, color: C.cream, fontSize: 13, textAlign: "left", cursor: "pointer" }}>
                <span>{r.name}{r.worthALook ? <span style={{ marginLeft: 6, background: C.gold, color: C.green, borderRadius: 999, padding: "4px 10px", fontSize: 11, fontWeight: 800 }}>WORTH A LOOK</span> : null}</span>
                <span style={{ textAlign: "right" }}>{r.rounds}</span>
                <span style={{ textAlign: "right" }}>{r.standouts}</span>
                <span style={{ textAlign: "right", color: r.avgBetter >= 0 ? C.cream : C.sage }}>{Math.abs(r.avgBetter).toFixed(1)} {r.avgBetter >= 0 ? "better" : "worse"}</span>
              </button>
              {open === r.userId ? (
                <div style={{ paddingBottom: 8, color: C.sage, fontSize: 12, lineHeight: 1.7 }}>
                  {r.detail.map((d) => <div key={d.gameId}>{d.date} · {d.course} · {Math.abs(d.better).toFixed(1)} {d.better >= 0 ? "better" : "worse"} than the field{d.better >= WATCH_RULE.standoutBetter ? " ★" : ""}</div>)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
