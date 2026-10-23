// 212.7 — team rounds: the rule, Season Wrapped's headline, and the team-round email.
import { ok, report } from "./screen-harness";
import { teamRoundsFrom } from "./team-rounds";
import { buildSeasonSummary } from "./season-summary";
import { teamRoundEmail } from "./team-round-email";
import { buildRecap } from "./game-recap";
import { parseAppLink } from "./app-links";
import type { Game, Player } from "./game-types";

const H = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const P = (id: string, extra: Record<string, unknown> = {}) => ({ id, user_id: id, display_name: id.toUpperCase(), course_handicap: 10, course_handicap_source: "manual", scores: [], no_show: false, ...extra } as unknown as Player);
const rowsFor = (gid: string, fid: string, side: "a" | "b", n: number, s = 4) => Array.from({ length: n }, (_, i) => ({ game_id: gid, foursome_id: fid, side, hole_index: i, strokes: s }));
const base = { holes_meta: H, course_par: 72, status: "ended", played_at: "2026-09-20" };

const field = { ...base, id: "g1", code: "111111", game_type: "scramble", course: "Oak", scramble_mode: "field", scramble_handicap: "usga",
  foursomes: [{ id: "t1", name: "Team 1", a: ["me", "x"], b: [] }, { id: "t2", name: "Team 2", a: ["y", "z"], b: [] }] } as unknown as Game;
const match = { ...base, id: "g2", code: "222222", game_type: "scramble", course: "Elm", played_at: "2026-08-02", scramble_mode: "match", scramble_handicap: "agreed",
  teams: [{ key: "A", name: "Reds" }, { key: "B", name: "Blues" }], foursomes: [{ id: "m1", name: "Match 1", a: ["me", "x"], b: ["y", "z"] }] } as unknown as Game;
const alt = { ...base, id: "g3", code: "333333", game_type: "alt_shot", course: "Pine", played_at: "2026-07-10", foursomes: [{ id: "f1", name: "G", a: ["me", "raj"], b: ["y", "z"] }] } as unknown as Game;
const short = { ...base, id: "g4", code: "444444", game_type: "scramble", course: "Ash", scramble_mode: "field", foursomes: [{ id: "t1", name: "Team 1", a: ["me", "x"], b: [] }] } as unknown as Game;
const live = { ...field, id: "g5", status: "active" } as unknown as Game;
const ps = [P("me"), P("x"), P("y"), P("z"), P("raj", { display_name: "Raj" })];
const teams = teamRoundsFrom([
  { game: field, players: ps, rows: [...rowsFor("g1", "t1", "a", 18, 4), ...rowsFor("g1", "t2", "a", 18, 5)] as never },
  { game: match, players: ps, rows: [...rowsFor("g2", "m1", "a", 18, 4), ...rowsFor("g2", "m1", "b", 18, 5)] as never },
  { game: alt, players: [P("me", { scores: [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, null, null, null, null, null, null, null, null] }), P("raj", { display_name: "Raj" }), P("y"), P("z")], rows: [] },
  { game: short, players: ps, rows: rowsFor("g4", "t1", "a", 5) as never },
  { game: live, players: ps, rows: rowsFor("g5", "t1", "a", 18) as never },
], "me");
ok(teams.length === 3, `three team rounds — a 5-hole team and a game still in play don't count (got ${teams.map((t) => t.gameId)})`);
const f = teams.find((t) => t.gameId === "g1")!, m = teams.find((t) => t.gameId === "g2")!, a = teams.find((t) => t.gameId === "g3")!;
ok(f.team === "Team 1" && f.result === "1st of 2" && f.holes === 18, `leaderboard scramble: Team 1, 1st of 2 (got ${f.team}, ${f.result})`);
ok(m.team === "Reds" && (m.result || "").startsWith("Reds won"), `Cup scramble: Reds, the match line (got ${m.team}, ${m.result})`);
ok(a.team === "with Raj" && a.holes === 10 && a.format === "alt_shot", `older alternate shot: the card on the player's row, partner named (got ${a.team}, ${a.holes})`);

// Season Wrapped: team rounds in the headline; personal statistics unchanged
const mkRound = (d: string, course: string) => ({ id: d, played_at: d, course, status: "final", rating: 72, slope: 113, holes: H.map((h) => ({ hole_number: h.n, par: 4, si: h.si, strokes: 4 + (h.n % 3 === 0 ? 1 : 0) })) });
const personal = ["2026-05-01", "2026-05-08", "2026-05-15", "2026-05-22", "2026-05-29", "2026-06-05"].map((d) => mkRound(d, "Oak"));
const without = buildSeasonSummary({ year: 2026, name: "Me", rounds: personal as never });
const withTeams = buildSeasonSummary({ year: 2026, name: "Me", rounds: personal as never, teamRounds: teams });
const hd = (s: typeof without) => s.cards.find((c) => c.kind === "headline") as any;
ok(hd(withTeams).rounds === hd(without).rounds + 3 && hd(withTeams).holes === hd(without).holes + 18 + 18 + 10 && hd(withTeams).teamRounds === 3, `headline: +3 rounds, +46 holes, "including 3 team rounds" (got ${JSON.stringify(hd(withTeams))})`);
ok(hd(withTeams).courses === 3 + 0 && hd(without).courses === 1, "courses: Oak plus Elm and Pine (team rounds) = 3");
ok(JSON.stringify(withTeams.cards.filter((c) => c.kind !== "headline")) === JSON.stringify(without.cards.filter((c) => c.kind !== "headline")), "every personal statistic card is unchanged");
const only = buildSeasonSummary({ year: 2026, name: "Me", rounds: [], teamRounds: teams });
ok(only.rounds === 3 && (only.cards[0] as any).kind === "short" && (only.cards[0] as any).rounds === 3, "a scramble-only season: the short version, 3 rounds played");

// the team-round email
const recap = buildRecap(field, ps, [...rowsFor("g1", "t1", "a", 18, 4), ...rowsFor("g1", "t2", "a", 18, 5)] as never);
const e = teamRoundEmail({ format: "scramble", course: "Oak", recap, personalLine: recap.personal["me"] ?? null, firstName: "Amit", gameUrl: "https://bnn.example/?tab=games&game=111111", unsubscribeUrl: "https://bnn.example/u" });
ok(e.subject.startsWith("Scramble at Oak — ") && e.html.includes(recap.headline) && e.html.includes("Hi Amit"), `email: subject, headline, greeting (${e.subject})`);
ok(e.html.includes("counts as a round played, not in your personal stats") && e.text.includes("Open the game"), "email: says it's played, not personal stats; links the game");
ok(parseAppLink("/?tab=games&game=111111").game === "111111", "the game link is one the app understands (lib/app-links)");
report("team rounds");
