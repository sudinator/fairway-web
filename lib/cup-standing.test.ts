function eq(a: unknown, b: unknown, m: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
import { cupStandingAfter, type CupSession } from "./cup-standing";
import type { Competition } from "./competition";
import type { Game, Player } from "./game-types";
// 209.5: the Cup's standing on a session recap — the Cup standings page's own numbers.
const holes = Array.from({ length: 3 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const singles = (id: string, aWins: boolean): { game: Game; players: Player[] } => {
  const game = { id, code: "123456", name: id, course: "T", course_par: 12, holes_meta: holes, game_type: "match", allowance_pct: 100,
    pairings: [{ a: `${id}a`, b: `${id}b` }], teams: [{ key: "A", name: "Violet" }, { key: "B", name: "Burgundy" }], foursomes: null,
    created_by: "x", created_at: "2026-09-01T00:00:00Z" } as unknown as Game;
  const base = { game_id: id, avatar_url: null, handicap_index: 0, rating: 72, slope: 113, tee_name: "Blue", course_handicap: 0, putts: [], fairways: [] };
  const players = [
    { ...base, id: `${id}pa`, user_id: `${id}a`, display_name: "A", team: "A", scores: aWins ? [4, 4, 4] : [5, 5, 5] },
    { ...base, id: `${id}pb`, user_id: `${id}b`, display_name: "B", team: "B", scores: aWins ? [5, 5, 5] : [4, 4, 4] },
  ] as unknown as Player[];
  return { game, players };
};
const comp = (tie: Competition["tie_rule"] = "shared", locked = true) => ({ id: "c", name: "Test Cup", team_a_name: "Violet", team_b_name: "Burgundy", tie_rule: tie, schedule_status: locked ? "locked" : "draft" } as unknown as Competition);
const sessions = (wins: boolean[], points = 2): CupSession[] => wins.map((w, i) => {
  const { game, players } = singles(`g${i + 1}`, w);
  return { id: `s${i + 1}`, competition_id: "c", name: `S${i + 1}`, format: "match", session_order: i + 1, play_date: "2026-10-01",
    points_per_match: points, planned_match_count: 1, game_id: game.id, created_at: "", game, players, altScores: [] } as CupSession;
});
// Five sessions × 2 points = 10; 6 wins it outright.
const five = sessions([true, true, false, true, false]);
const s3 = cupStandingAfter(comp(), five, "g3")!;
eq([s3.a, s3.b, s3.sessionNo, s3.sessionCount], ["4", "2", 3, 5], "after session 3: 4–2, session 3 of 5");
eq(s3.detail, "4 points left · Violet need 2 more to win, Burgundy need 4", "still alive: points left and what each team needs");
eq(cupStandingAfter(comp(), five, "g4")!.detail, "🏆 Violet have won the Cup — with 1 session to spare", "clinched with a session to spare");
const s5 = cupStandingAfter(comp(), five, "g5")!;
eq([s5.a, s5.b, s5.final, s5.detail], ["6", "4", true, "🏆 Violet won the Test Cup"], "the final session");
eq(cupStandingAfter(comp(), five, "not-a-cup-game"), null, "a game that isn't a session: no Cup box");
// A tied Cup: shared, or retained by the holders.
const tied = sessions([true, false], 1);
eq(cupStandingAfter(comp("shared"), tied, "g2")!.detail, "The Cup is shared", "a shared Cup");
eq(cupStandingAfter(comp("team_a_retains"), tied, "g2")!.detail, "🏆 Violet retain the Test Cup", "the holders retain it");
// 209.6: an UNLOCKED Cup declares nothing (like the Cup standings page) — score only.
{
  const draft = comp("shared", false);
  for (const g of ["g3", "g4", "g5"]) {
    const c = cupStandingAfter(draft, five, g)!;
    eq([c.detail, c.sessionCount, c.final], ["Schedule not locked yet — no winner until it is", null, false], `unlocked, after ${g}: no winner, clinch or "need"`);
  }
  eq([cupStandingAfter(draft, five, "g4")!.a, cupStandingAfter(draft, five, "g4")!.b], ["6", "2"], "unlocked: the secured score still shows");
}
console.log("cup-standing tests passed");
