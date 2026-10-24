/** 212.36 — the public live scorecard scores skins with the app's rules (lib/live-skins → skinsTotals). It used to score
 * every skins game as individual carry-over across the whole field (no "Halved", no 1:1 or 2 v 2 team skins). */
import { ok, report } from "./screen-harness";
import { liveSkins, type LiveSkinsGame, type LiveSkinsPlayer } from "@/lib/live-skins";
import { skinsTotals } from "@/lib/game-results";
import { computeSkins } from "@/lib/golf";
import type { Game, Player } from "@/lib/game-types";

const eq = <V,>(a: V, e: V, label: string) => ok(JSON.stringify(a) === JSON.stringify(e), `${label} (expected ${JSON.stringify(e)}, got ${JSON.stringify(a)})`);
const meta = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const card = (xs: number[]) => [...xs, ...Array(18 - xs.length).fill(null)];
// four players, teams A/B, handicaps 0/6/3/9, six holes played
const raw: [string, string, "A" | "B", number, number[]][] = [
  ["p1", "Raj", "A", 0, [4, 4, 5, 4, 3, 5]], ["p2", "Sam", "B", 6, [5, 4, 4, 4, 4, 5]],
  ["p3", "Bo", "A", 3, [4, 5, 4, 3, 4, 4]], ["p4", "Lex", "B", 9, [4, 4, 4, 5, 4, 4]],
];
const live: LiveSkinsPlayer[] = raw.map(([id, n, t, ch, s]) => ({ id, display_name: n, ch, team: t, no_show: false, scores: card(s) }));
// the SAME players as the app holds them (live ids are the player keys; the app's course handicap = the feed's ch)
const app = raw.map(([id, n, t, ch, s]) => ({ id, user_id: null, display_name: n, team: t, no_show: false, scores: card(s), course_handicap: ch, course_handicap_source: null, handicap_index: null })) as unknown as Player[];
const teams = [{ key: "A", name: "Reds" }, { key: "B", name: "Blues" }];
const lg = (mode: string, t: typeof teams | null): LiveSkinsGame => ({ game_type: "skins", skins_mode: mode, teams: t ?? [], holes_meta: meta, allowance_pct: 100, team_score_mode: "best_ball", course_par: 72 });
const ag = (mode: string, t: typeof teams | null, pairings: unknown[], foursomes: unknown) => ({ id: "g", game_type: "skins", skins_mode: mode, teams: t, holes_meta: meta, allowance_pct: 100, team_score_mode: "best_ball", course_par: 72, pairings, foursomes } as unknown as Game);
const PAIRS = [{ a: "p1", b: "p2" }, { a: "p3", b: "p4" }];
const FOUR = [{ id: "f1", name: "Match 1", a: ["p1", "p3"], b: ["p2", "p4"] }];

for (const mode of ["carryover", "split"]) {
  // individual skins: the live numbers ARE the app's numbers
  const li = liveSkins(lg(mode, null), live, [], []), ai = skinsTotals(ag(mode, null, [], null), app);
  eq(li.style, "individual", `${mode} individual: style`);
  eq(li.byPlayer, ai.byPlayer, `${mode} individual: live == app, per player`);
  // 1:1 team skins (no foursomes — the live feed sends [] for "none")
  const l1 = liveSkins(lg(mode, teams), live, PAIRS, []), a1 = skinsTotals(ag(mode, teams, PAIRS, null), app);
  eq(l1.style, "team_11", `${mode} 1:1: an empty live foursome list means 1:1`);
  eq([l1.byPlayer, l1.byTeam], [a1.byPlayer, a1.byTeam], `${mode} 1:1: live == app, per player and per team`);
  eq(l1.stillInPlay, 36 - (a1.byTeam!.A + a1.byTeam!.B), `${mode} 1:1: still in play counts both matches (36 skins)`);
  // 2 v 2 team skins
  const l2 = liveSkins(lg(mode, teams), live, [], FOUR), a2 = skinsTotals(ag(mode, teams, [], FOUR), app);
  eq(l2.style, "team_2v2", `${mode} 2 v 2: style`);
  eq(l2.byTeam, a2.byTeam, `${mode} 2 v 2: live == app, per team`);
  ok(l2.byPlayer.p1 === l2.byPlayer.p3 && l2.byPlayer.p1 === a2.byTeam!.A && l2.byPlayer.p2 === a2.byTeam!.B, `${mode} 2 v 2: each player shows their pair's skins`);
}
// the setting matters on the live page now (it was ignored): halved and carry over give different 1:1 results here
const h = liveSkins(lg("split", teams), live, PAIRS, []).byTeam!, c = liveSkins(lg("carryover", teams), live, PAIRS, []).byTeam!;
ok(JSON.stringify(h) !== JSON.stringify(c), `1:1: halved ${JSON.stringify(h)} differs from carry over ${JSON.stringify(c)}`);
// what the live page used to show for this 1:1 game — individual carry-over across all four — is NOT the app's answer
const old = computeSkins(meta as never, live.map((p) => ({ id: p.id, name: p.display_name, gross: p.scores, ch: p.ch })), 100).skinsByPlayer;
const oldTeams = { A: (old.p1 || 0) + (old.p3 || 0), B: (old.p2 || 0) + (old.p4 || 0) };
ok(JSON.stringify(oldTeams) !== JSON.stringify(h), `the old live answer ${JSON.stringify(oldTeams)} was not the app's ${JSON.stringify(h)} (the bug)`);
// an older feed without skins_mode carries over, as the app defaults
eq(liveSkins({ ...lg("carryover", teams), skins_mode: undefined }, live, PAIRS, []).byTeam, c, "no skins_mode in the feed = carry over");
report("live skins");
