// Season Wrapped match results and companions (205.0). Pure; tested. Exactly the logic that matched
// the owner's real 2026 (Oct 13), moved out of the one-off script so the app uses it:
//   * 1 v 1 match play: matchStatus on each pairing that includes the golfer; counted only when the
//     engine says the match is settled.
//   * Trifecta: the golfer's single, from computeTrifecta; counted only when settled.
//   * "Played with": everyone else (with an account) in a game the golfer played.
// Callers pass only ENDED games whose round the golfer kept (cancelled games never reach here).
import { matchStatus, computeTrifecta } from "./golf";
import { chBasis } from "./game-shape";

export type SeasonGame = {
  id: string; game_type: string; played_at: string; allowance_pct?: number | null; course_par?: number | null;
  team_score_mode?: string | null; holes_meta: any[];
  pairings?: { a: string; b: string }[] | null;
  foursomes?: { a: string[]; b: string[]; swap?: boolean }[] | null;
  players: { id?: string; user_id: string | null; display_name: string; scores: (number | null)[] | null; course_handicap?: number | null;
    handicap_index?: number | null; slope?: number | null; rating?: number | null; course_handicap_source?: string | null }[];
};
export type SeasonMatch = { opponent: string; opponentId?: string; result: "won" | "lost" | "halved"; played_at: string };

export function seasonMatches(games: SeasonGame[], me: string): { matches: SeasonMatch[]; playedWith: { name: string; games: number }[] } {
  const matches: SeasonMatch[] = [];
  const shared = new Map<string, { name: string; games: number }>();
  const outcome = (lead: number): SeasonMatch["result"] => (lead > 0 ? "won" : lead < 0 ? "lost" : "halved");
  for (const g of games) {
    const players = g.players || [];
    // Player identity, as everywhere else in the app (pairings and foursomes store user_id for members
    // and the game_players row id for guests): key = user_id ?? id. Keying on user_id alone dropped
    // every match against a guest (review finding 8, 205.4).
    const key = (p: (typeof players)[number]) => p.user_id ?? p.id ?? "";
    if (!players.some((p) => p.user_id === me)) continue;
    const identity = (p: (typeof players)[number]) => p.user_id ? `user:${p.user_id}` : `guest:${g.id}:${p.id}`;
    const seen = new Set<string>();
    for (const p of players) if (key(p) && p.user_id !== me && !seen.has(identity(p))) {
      const id = identity(p); seen.add(id);
      shared.set(id, { name: p.display_name, games: (shared.get(id)?.games || 0) + 1 });
    }
    const pOf = (k: string) => players.find((p) => key(p) === k);
    const ch = (p: any) => chBasis(p, g.course_par ?? undefined, g.holes_meta?.length);
    if (g.game_type === "match") {
      for (const pr of g.pairings || []) {
        if (pr.a !== me && pr.b !== me) continue;
        const a = pOf(pr.a), b = pOf(pr.b); if (!a || !b) continue;
        const st = matchStatus(g.holes_meta, a.scores || [], b.scores || [], ch(a), ch(b), g.allowance_pct ?? 100);
        if (!st.result) continue;
        matches.push({ opponentId: identity(pr.a === me ? b : a), opponent: (pr.a === me ? b : a).display_name, result: outcome(pr.a === me ? st.lead : -st.lead), played_at: g.played_at });
      }
    }
    if (g.game_type === "trifecta") {
      for (const f of g.foursomes || []) {
        if (!f.a.includes(me) && !f.b.includes(me)) continue;
        const ms = [...f.a, ...f.b].map((uid) => pOf(uid)).filter((p): p is NonNullable<typeof p> => !!p).map((p) => ({ id: key(p), ch: ch(p), gross: p.scores || [] }));
        const r = computeTrifecta(g.holes_meta, ms, f.a, f.b, g.allowance_pct ?? 100, g.team_score_mode === "aggregate" ? "aggregate" : "best_ball", !!f.swap);
        const iAmA = f.a.includes(me);
        for (const c of r.contests) {
          if (c.kind !== "single" || !c.settled || (!c.aIds.includes(me) && !c.bIds.includes(me))) continue;
          const opp = (c.aIds.includes(me) ? c.bIds : c.aIds).map((id) => pOf(id)?.display_name ?? "?").join(" & ");
          const oppIds = (c.aIds.includes(me) ? c.bIds : c.aIds).map((id) => pOf(id)).filter((p): p is NonNullable<typeof p> => !!p).map(identity).sort();
          matches.push({ opponentId: oppIds.length === 1 ? oppIds[0] : JSON.stringify(oppIds), opponent: opp, result: outcome(iAmA ? c.lead : -c.lead), played_at: g.played_at });
        }
      }
    }
  }
  const playedWith = Array.from(shared.values()).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
  return { matches, playedWith };
}

/** Which season can be opened today: Dec 31 → this year; all of January → last year; else none. */
export function wrappedYearOn(d: Date): number | null {
  const m = d.getMonth(), day = d.getDate();
  if (m === 11 && day === 31) return d.getFullYear();
  if (m === 0) return d.getFullYear() - 1;
  return null;
}

/** Seasons available for look-back in Rounds: every year with a round that has finished (or ends today). */
export function lookbackYears(roundDates: string[], now: Date): number[] {
  const open = wrappedYearOn(now);
  const years = Array.from(new Set(roundDates.map((d) => Number((d || "").slice(0, 4))).filter((y) => y > 2000)));
  return years.filter((y) => y < now.getFullYear() || y === open).sort((a, b) => b - a);
}
