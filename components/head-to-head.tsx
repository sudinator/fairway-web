"use client";
// Profile → Head-to-head & partners (210.0, owner-approved mock). A member's OWN record only (owner decision):
// it loads only the member's own finished games. Results are the recap's own (lib/match-outcomes).
import React, { useEffect, useMemo, useState } from "react";
import { C } from "@/lib/golf";
import { Eyebrow } from "@/components/ui";
import { createClient } from "@/lib/supabase";
import { fetchTestClubIds, withoutTestClubs } from "@/lib/test-clubs";
import { matchOutcomes, memberRecord, bestPartnerRecord, partnerRate, BEST_PARTNER_MIN, formatsLabel, recordMatchLine, type H2HRow, type PartnerRow, type RecordMatch } from "@/lib/match-outcomes";
import { fetchAll, fetchAllIn } from "@/lib/fetch-all";
import type { Game, Player } from "@/lib/game-types";
import type { AltShotScoreRow } from "@/lib/alt-shot-side-scores";

const pts = (n: number) => (Math.floor(n) === n ? String(n) : `${Math.floor(n) || ""}½`);
/** The games behind a record, newest first; each opens its game (the recap). Data rows (DISPLAY_RULES): 13/700 cream, 11 sage. */
function matchList(matches: RecordMatch[], onOpenGame?: (gameId: string) => void) {
  return (
    <div data-record-matches style={{ background: C.greenMid, borderRadius: 10, padding: "6px 12px" }}>
      {matches.map((m) => (
        <button key={`${m.gameId}:${m.against.join(",")}`} type="button" data-record-match={m.gameId} onClick={(e) => { e.stopPropagation(); onOpenGame?.(m.gameId); }} disabled={!onOpenGame}
          style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 0", background: "none", border: "none", borderTop: `1px solid ${C.green}`, color: C.cream, textAlign: "left", cursor: onOpenGame ? "pointer" : "default", fontSize: 13, fontWeight: 700 }}>
          <span style={{ flex: 1 }}>{recordMatchLine(m)}{m.with?.length ? <span style={{ color: C.sage, fontWeight: 500 }}> · with {m.with.join(" & ")}</span> : null}</span>
          {onOpenGame ? <span style={{ color: C.sage, fontSize: 11 }}>Open ›</span> : null}
        </button>
      ))}
    </div>
  );
}

export function HeadToHead({ user, onOpenGame }: { user: { id: string }; onOpenGame?: (gameId: string) => void }) {
  const supabase = useMemo(() => createClient(), []);
  // 212.133 (owner): a record is tappable — it opens the games behind it, each a line "Lost 4&3 · Nov 3 · Francis Byrne"
  const [open, setOpen] = useState<string | null>(null);
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
        // 212.70: test clubs' games don't exist for stats (owner, Oct 29)
        const testClubs = await fetchTestClubIds(supabase);
        const ended = withoutTestClubs(games.filter((g) => (g as { status?: string }).status === "ended"), testClubs);
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
  const best = bestPartnerRecord(rec.partners);   // 210.7: enough matches to mean something
  const th: React.CSSProperties = { color: C.sage, fontSize: 11, fontWeight: 700, textAlign: "right", paddingTop: 4, paddingBottom: 4 };
  // 212.120: the data-row standard (DISPLAY_RULES) — names 13/700, figures 14/700, captions 11 sage
  const td: React.CSSProperties = { borderTop: `1px solid ${C.green}`, paddingTop: 8, paddingBottom: 8, textAlign: "right", fontSize: 14, fontWeight: 700, color: C.cream };
  const tdName: React.CSSProperties = { ...td, textAlign: "left", fontSize: 13, fontWeight: 700 };
  return (
    <div data-head-to-head style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.borderGreen}` }}>
      <Eyebrow>HEAD-TO-HEAD & PARTNERS</Eyebrow>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 4 }}>Your record in finished games — only you see this.</div>
      {rec.headToHead.length ? (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }} data-h2h>
          <thead><tr><th style={{ ...th, textAlign: "left" }}>Against · singles</th><th style={th}>W</th><th style={th}>L</th><th style={th}>H</th></tr></thead>
          <tbody>{rec.headToHead.map((r) => (
            <React.Fragment key={r.userId}>
              <tr data-h2h-row={r.userId} onClick={() => setOpen(open === `h:${r.userId}` ? null : `h:${r.userId}`)} style={{ cursor: "pointer" }} aria-expanded={open === `h:${r.userId}`}>
                <td style={tdName}>{r.name} <span style={{ color: C.sage, fontSize: 11 }}>{open === `h:${r.userId}` ? "▴" : "▾"}</span></td><td style={td}>{r.won}</td><td style={td}>{r.lost}</td><td style={td}>{r.halved}</td></tr>
              {open === `h:${r.userId}` ? <tr><td colSpan={4} style={{ paddingBottom: 8 }}>{matchList(r.matches, onOpenGame)}</td></tr> : null}
            </React.Fragment>
          ))}</tbody>
        </table>
      ) : null}
      {rec.partners.length ? (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14 }} data-partners>
          <thead><tr><th style={{ ...th, textAlign: "left" }}>With · four-ball, alt shot, Trifecta</th><th style={th}>Played</th><th style={th}>Won</th><th style={th}>Pts</th><th style={th}>Rate</th></tr></thead>
          <tbody>{rec.partners.map((r) => (
            <React.Fragment key={r.userId}>
            <tr data-partner-row={r.userId} onClick={() => setOpen(open === `p:${r.userId}` ? null : `p:${r.userId}`)} style={{ cursor: "pointer" }} aria-expanded={open === `p:${r.userId}`}><td style={tdName}>{r.name}{best && best.userId === r.userId ? " ⭐" : ""} <span style={{ color: C.sage, fontSize: 11 }}>{open === `p:${r.userId}` ? "▴" : "▾"}</span></td><td style={td}>{r.played}</td><td style={td}>{r.won}</td><td style={td}>{pts(r.points)}</td><td style={td}>{r.played >= BEST_PARTNER_MIN && partnerRate(r) != null ? `${Math.round(100 * partnerRate(r)!)}%` : "—"}</td></tr>
            {open === `p:${r.userId}` ? <tr><td colSpan={5} style={{ paddingBottom: 8 }}>{matchList(r.matches, onOpenGame)}</td></tr> : null}
            </React.Fragment>
          ))}</tbody>
        </table>
      ) : null}
      <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>Partnership rate counts a win as 1 point and a halved match as ½. At least {BEST_PARTNER_MIN} matches together; equal rates favour more matches.</div>
      {best ? <div style={{ color: C.cream, fontSize: 13, marginTop: 8 }} data-best-partner>⛳ Best partnership record: <b>{best.name}</b> — {Math.round(100 * best.points / best.played)}% of available points in {best.played} matches <span style={{ color: C.sage }}>({formatsLabel(best.formats)})</span></div> : null}
    </div>
  );
}
