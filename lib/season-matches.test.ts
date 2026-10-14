function eq(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`${m}: expected ${String(b)}, got ${String(a)}`); }
import { seasonMatches, wrappedYearOn, lookbackYears } from "./season-matches";
const H = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const g = (id: string, scoresMe: number[], scoresOpp: number[], date = "2026-06-01", holes = H) => ({
  id, game_type: "match", played_at: date, allowance_pct: 100, course_par: 72, holes_meta: holes, pairings: [{ a: "me", b: "op" }],
  players: [{ user_id: "me", display_name: "Me", scores: scoresMe, course_handicap: 10, course_handicap_source: "manual" },
            { user_id: "op", display_name: "Opp", scores: scoresOpp, course_handicap: 10, course_handicap_source: "manual" }],
});
const win = g("g1", Array(18).fill(4), Array(18).fill(5));
const unfinished = g("g2", [4, 4, 4, 4, 4, 4, 4, 4, 4, ...Array(9).fill(null)], [5, 5, 5, 5, ...Array(14).fill(null)]);
const r = seasonMatches([win, unfinished], "me");
eq(r.matches.length, 1, "only the settled match counts (an unfinished one does not)");
eq(r.matches[0].result, "won", "won the settled match");
eq(r.playedWith[0].name, "Opp", "played with"); eq(r.playedWith[0].games, 2, "counted per game shared");
eq(seasonMatches([win], "someone-else").matches.length, 0, "a game the golfer did not play is ignored");
// Availability
eq(wrappedYearOn(new Date(2026, 11, 31)), 2026, "Dec 31 opens this year");
eq(wrappedYearOn(new Date(2027, 0, 20)), 2026, "January keeps last year open");
eq(wrappedYearOn(new Date(2026, 11, 30)), null, "Dec 30: not yet");
eq(lookbackYears(["2025-06-01", "2026-05-01"], new Date(2026, 9, 13)).join(","), "2025", "mid-season: only finished seasons");
eq(lookbackYears(["2025-06-01", "2026-05-01"], new Date(2026, 11, 31)).join(","), "2026,2025", "Dec 31: this season too, newest first");
// Finding 8: a completed win against a GUEST (no user_id; pairings use the row id) counts.
{
  const guestGame = { ...g("g3", Array(18).fill(4), Array(18).fill(5)), pairings: [{ a: "me", b: "row-guest" }],
    players: [{ user_id: "me", display_name: "Me", scores: Array(18).fill(4), course_handicap: 10, course_handicap_source: "manual" },
              { id: "row-guest", user_id: null, display_name: "Guest Gary", scores: Array(18).fill(5), course_handicap: 10, course_handicap_source: "manual" }] };
  const rg = seasonMatches([guestGame as any], "me");
  eq(rg.matches.length, 1, "a match against a guest is counted");
  eq(rg.matches[0].opponent, "Guest Gary", "guest named as the opponent");
  eq(rg.playedWith[0]?.name, "Guest Gary", "guests count in played-with");
}
console.log("season-matches tests passed");
