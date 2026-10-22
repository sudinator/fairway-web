/**
 * 212.6 — SCRAMBLE SIMULATION (owner, Oct 22: "run this version through simulated game tests for various combinations").
 * Hundreds of seeded random games through the REAL code, each checked against an INDEPENDENT calculation written here
 * (not the engine): team handicaps, strokes on the card, leaderboard, match play and closeout, Ryder Cup points (app
 * and live page), line-up / live / recap agreement, club-report rounds, drive tallies.
 */
import { ok, report } from "./screen-harness";
import type { Game, Player } from "@/lib/game-types";
import { scrambleResults } from "@/lib/scramble-game";
import { strokeSets, scrambleTeamHandicapFor } from "@/lib/game-shape";
import { buildRecap } from "@/lib/game-recap";
import { scoreCompetitionGame } from "@/lib/competition";
import { liveCupSessionScore } from "@/lib/live-competition";
import { liveScrambleTeamHandicap } from "@/lib/live-scramble";
import { scrambleLineupTeams } from "@/components/game/scramble-lineup";
import { buildClubReport } from "@/lib/club-report";
import { driveTally } from "@/lib/scramble";

// ── a seeded random source, so every run plays the same games ──
let seed = 212_6;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

// ── the independent reference ──
const USGA: Record<number, number[]> = { 2: [0.35, 0.15], 3: [0.3, 0.2, 0.1], 4: [0.25, 0.2, 0.15, 0.1] };
const roundHalfAway = (x: number) => Math.sign(x) * Math.round(Math.abs(x));
function refTeamHcp(chs: number[], pcts: number[] | null): number {
  const p = pcts ?? USGA[chs.length];
  const raw = [...chs].sort((a, b) => a - b).reduce((s, ch, i) => s + ch * p[i], 0);
  const r = roundHalfAway(raw);
  return Object.is(r, -0) ? 0 : r;
}
/** strokes on a hole with stroke index `si` (1..n) for a team handicap H — plus handicaps give back on the easiest */
function refStrokes(H: number, si: number, n: number): number {
  if (H >= 0) return Math.floor(H / n) + (si <= H % n ? 1 : 0);
  const g = -H;
  return -(Math.floor(g / n) + (si > n - (g % n) ? 1 : 0));
}
function refLead(holes: { si: number }[], a: (number | null)[], ha: number, b: (number | null)[], hb: number) {
  let lead = 0, thru = 0;
  for (let i = 0; i < holes.length; i++) {
    if (a[i] == null || b[i] == null) break;
    const na = a[i]! - refStrokes(ha, holes[i].si, holes.length), nb = b[i]! - refStrokes(hb, holes[i].si, holes.length);
    thru++; if (na < nb) lead++; else if (nb < na) lead--;
    if (Math.abs(lead) > holes.length - thru) break;
  }
  return { lead, thru };
}

// ── a random course and field ──
const SI18 = [7, 3, 17, 1, 11, 15, 5, 9, 13, 8, 2, 18, 4, 12, 6, 16, 10, 14];
const PAR18 = [4, 5, 3, 4, 4, 3, 4, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4];
const holes = PAR18.map((par, i) => ({ n: i + 1, par, si: SI18[i] }));
let pid = 0;
const mkPlayer = (team: "A" | "B" | null, ch: number): Player => {
  pid++;
  return { id: `p${pid}`, user_id: `u${pid}`, display_name: `P${pid}`, team, course_handicap: ch, course_handicap_source: "manual", handicap_index: ch, scores: [], no_show: false, tee_group: null } as unknown as Player;
};
const randCh = () => (rnd() < 0.06 ? -int(1, 4) - 0.4 : Math.round((rnd() * 30 + 0.5) * 10) / 10);   // some plus handicaps
const teamScores = (thru: number) => holes.map((h, i) => (i < thru ? Math.max(1, h.par + pick([-2, -1, -1, 0, 0, 0, 0, 1, 1, 2] as const)) : null));
const rowsFor = (gid: string, fid: string, side: "a" | "b", scores: (number | null)[], members: string[], drives: boolean) =>
  scores.map((s, i) => ({ game_id: gid, foursome_id: fid, side, hole_index: i, strokes: s, ...(drives && s != null ? { drive_key: members[i % members.length] } : {}) })).filter((r) => r.strokes != null);

let games = 0, checks = 0;
const fail: string[] = [];
const expect = (cond: boolean, msg: string) => { checks++; if (!cond && fail.length < 25) fail.push(msg); };

for (let g = 0; g < 240; g++) {
  const cup = g % 4 === 3;                                         // every 4th: a Ryder Cup session
  const mode: "field" | "match" = cup ? "match" : pick(["field", "match"] as const);
  const captains = !cup && rnd() < 0.15;
  const method: "usga" | "agreed" = captains ? "agreed" : pick(["usga", "usga", "agreed"] as const);
  const cupSize = cup ? pick([2, 3, 4] as const) : null;
  const custom = method === "usga" && rnd() < 0.4 ? { "2": [40, 10], "3": [30, 25, 10], "4": [30, 20, 15, 10] } : null;
  const minDrives = !cup && rnd() < 0.3 ? 3 : null;
  const thru = pick([3, 9, 12, 18, 18, 18] as const);
  const nTeams = mode === "match" ? 2 * int(1, 3) : int(2, 6);
  const players: Player[] = [], foursomes: any[] = [], rows: any[] = [], teamDefs: { fid: string; side: "a" | "b"; members: Player[]; scores: (number | null)[]; agreed: number | null }[] = [];
  for (let t = 0; t < nTeams; t++) {
    const size = captains ? 1 : cupSize ?? pick([2, 3, 4] as const);
    const side: "a" | "b" = mode === "match" ? (t % 2 === 0 ? "a" : "b") : "a";
    const members = Array.from({ length: size }, () => mkPlayer(cup ? (side === "a" ? "A" : "B") : null, randCh()));
    players.push(...members);
    const fid = mode === "match" ? `m${Math.floor(t / 2) + 1}` : `t${t + 1}`;
    const agreed = method === "agreed" && rnd() < 0.8 ? int(-2, 20) : null;   // some agreed teams left blank (scratch)
    if (side === "a") foursomes.push({ id: fid, name: mode === "match" ? `Match ${Math.floor(t / 2) + 1}` : `Team ${t + 1}`, a: members.map((m) => m.user_id), b: [], ...(agreed != null ? { a_hcp: agreed } : {}) });
    else { const f = foursomes[foursomes.length - 1]; f.b = members.map((m) => m.user_id); if (agreed != null) f.b_hcp = agreed; }
    const scores = teamScores(thru);
    teamDefs.push({ fid, side, members, scores, agreed });
    rows.push(...rowsFor(`g${g}`, fid, side, scores, members.map((m) => m.user_id!), !!minDrives));
  }
  const game = { id: `g${g}`, game_type: "scramble", status: thru === 18 ? "ended" : "active", holes_meta: holes, course_par: 72, played_at: "2026-10-25", course: "Sim",
    scramble_mode: mode, scramble_handicap: method, scramble_team_size: captains ? 1 : cupSize, scramble_allowance: custom, scramble_min_drives: minDrives,
    teams: cup ? [{ key: "A", name: "Reds" }, { key: "B", name: "Blues" }] : null, foursomes } as unknown as Game;
  games++;

  // 1. team handicaps — independent
  const expectedHcp = teamDefs.map((t) => method === "agreed" ? (t.agreed ?? 0)
    : refTeamHcp(t.members.map((m) => m.course_handicap as number), custom ? (custom as any)[String(t.members.length)].map((x: number) => x / 100) : null));
  const r = scrambleResults(game, players, rows as never);
  expect(r.teams.length === teamDefs.length, `g${g}: ${r.teams.length} teams, expected ${teamDefs.length}`);
  r.teams.forEach((t, i) => expect(t.handicap === expectedHcp[i], `g${g} ${t.name}: team handicap ${t.handicap}, expected ${expectedHcp[i]} (${method}${custom ? " custom" : ""}, size ${teamDefs[i].members.length})`));

  // 2. strokes on the card: only the team's, totalling the team handicap, on the right holes
  teamDefs.forEach((t, i) => {
    const sets = holes.map((h) => strokeSets(game as never, t.members[0] as never, h.si, players as never));
    expect(sets.every((s) => s.length === 1 && s[0].key === "team"), `g${g} team ${i + 1}: a non-team stroke set on the card`);
    const net = (s: { strokes: number; gives: number }[]) => (s[0]?.strokes ?? 0) - (s[0]?.gives ?? 0);   // gives = a plus team's give-back
    const total = sets.reduce((a, s) => a + net(s), 0);
    expect(total === expectedHcp[i], `g${g} team ${i + 1}: card strokes total ${total}, team handicap ${expectedHcp[i]}`);
    holes.forEach((h, k) => expect(net(sets[k]) === refStrokes(expectedHcp[i], h.si, 18), `g${g} team ${i + 1} hole ${h.n}: ${net(sets[k])} strokes, expected ${refStrokes(expectedHcp[i], h.si, 18)}`));
    expect(scrambleTeamHandicapFor(game as never, players as never, t.members[0].user_id!) === expectedHcp[i], `g${g} team ${i + 1}: the one team-handicap rule disagrees`);
  });

  // 3. the leaderboard (one leaderboard): net = gross − strokes, ordered, ties shared
  if (mode === "field") {
    const exp = teamDefs.map((t, i) => {
      let gross = 0, net = 0, par = 0, played = 0;
      holes.forEach((h, k) => { const s = t.scores[k]; if (s == null) return; played++; gross += s; par += h.par; net += s - refStrokes(expectedHcp[i], h.si, 18); });
      return { name: `Team ${i + 1}`, netToPar: net - par, thru: played };
    });
    r.board.forEach((b) => { const e = exp.find((x) => x.name === b.name)!; expect(b.netToPar === e.netToPar && b.thru === e.thru, `g${g} ${b.name}: net to par ${b.netToPar} thru ${b.thru}, expected ${e.netToPar} thru ${e.thru}`); });
    for (let k = 1; k < r.board.length; k++) expect(r.board[k - 1].netToPar <= r.board[k].netToPar, `g${g}: leaderboard out of order`);
    for (let k = 1; k < r.board.length; k++) if (r.board[k].netToPar === r.board[k - 1].netToPar) expect(r.board[k].rank === r.board[k - 1].rank && r.board[k].pos.startsWith("T"), `g${g}: a tie isn't shared`);
  }

  // 4. team v team: the lead hole by hole, independent
  if (mode === "match") {
    r.matches.forEach((m) => {
      const ai = teamDefs.findIndex((t) => t.fid === m.groupId && t.side === "a"), bi = teamDefs.findIndex((t) => t.fid === m.groupId && t.side === "b");
      const e = refLead(holes, teamDefs[ai].scores, expectedHcp[ai], teamDefs[bi].scores, expectedHcp[bi]);
      expect(m.status.lead === e.lead && m.status.thru === e.thru, `g${g} ${m.name}: lead ${m.status.lead} thru ${m.status.thru}, expected ${e.lead} thru ${e.thru}`);
      if (e.thru === 18 || Math.abs(e.lead) > 18 - e.thru) expect(m.status.decided, `g${g} ${m.name}: should be decided`);
    });
  }

  // 5. Ryder Cup: app points == live page points; a decided match is worth exactly 1
  if (cup) {
    const app = scoreCompetitionGame(game, players, rows as never, 1);
    const live = liveCupSessionScore({ id: "s", game: { game_type: "scramble", holes_meta: holes, allowance_pct: 100, course_par: 72, scramble_mode: mode, scramble_handicap: method, scramble_team_size: cupSize, scramble_allowance: custom } as never,
      players: players.map((p) => ({ id: p.user_id, ch: p.course_handicap, team: p.team, no_show: false, scores: [] })) as never, pairings: [],
      foursomes: foursomes.map((f) => ({ ...f, swap: false })) as never, alt_shot_scores: rows.map(({ game_id: _g, ...x }) => x) as never, points_per_match: 1 } as never);
    expect(app.matches.length === live.matches.length && app.matches.length === nTeams / 2, `g${g}: ${app.matches.length} app / ${live.matches.length} live matches, expected ${nTeams / 2}`);
    app.matches.forEach((am: any, k: number) => { const lm = live.matches[k] as any; expect(am.lead === lm.lead && am.thru === lm.thru, `g${g} match ${k + 1}: app ${am.lead}/${am.thru} v live ${lm.lead}/${lm.thru}`); });
    expect(Math.abs((live.decidedA + live.decidedB) - live.decidedCount) < 1e-9, `g${g}: decided points ${live.decidedA + live.decidedB} for ${live.decidedCount} decided matches`);
    expect(r.teams.slice(0, 2).map((t) => t.name).join(",") === "Reds,Blues", `g${g}: Cup sides should be Reds / Blues`);
  }

  // 6. live page, line-up and recap agree with the results
  const byId = Object.fromEntries(players.map((p) => [p.user_id, p]));
  teamDefs.forEach((t, i) => {
    const entered = (foursomes.find((f) => f.id === t.fid) as any)?.[t.side === "a" ? "a_hcp" : "b_hcp"];
    const live = liveScrambleTeamHandicap(game as never, t.members.map((m) => byId[m.user_id!].course_handicap as number), entered);
    expect(live === expectedHcp[i], `g${g} team ${i + 1}: live page handicap ${live}, expected ${expectedHcp[i]}`);
  });
  const lu = scrambleLineupTeams(game, players);
  lu.forEach((t, i) => expect(t.handicap === expectedHcp[i], `g${g} line-up ${t.name}: ${t.handicap}, expected ${expectedHcp[i]}`));
  if (thru === 18 && mode === "field") {
    const rc = buildRecap(game, players, rows as never);
    const leaders = r.board.filter((b) => b.rank === 1);
    expect(leaders.length > 1 ? rc.headline.includes("tie") : rc.headline.startsWith(`${leaders[0].name} wins`), `g${g}: recap "${rc.headline}" v leader ${leaders.map((x) => x.name)}`);
    expect(rc.sections.individualStats === false, `g${g}: the recap counted individual stats`);
  }

  // 7. club report: every player of a team that played 9+ holes is a round; no best gross
  const rep: any = buildClubReport("Sim", { key: "x", label: "x", from: "2026-10-01", to: "2026-10-31" }, [{ game, players, altScores: rows as never }]);
  const expRounds = teamDefs.reduce((n, t) => n + (t.scores.filter((s) => s != null).length >= 9 ? t.members.length : 0), 0);
  expect(rep.rounds === expRounds, `g${g}: club report ${rep.rounds} rounds, expected ${expRounds}`);
  expect(!rep.bestGross && !rep.bestNet, `g${g}: a scramble produced a best gross / net`);

  // 8. drives: the tally adds up to the holes recorded
  if (minDrives) teamDefs.forEach((t, i) => {
    const drives = holes.map((_, k) => rows.find((x) => x.foursome_id === t.fid && x.side === t.side && x.hole_index === k)?.drive_key ?? null);
    const tally = driveTally(drives, t.members.map((m) => m.user_id!), minDrives, 18);
    const counted = Object.values(tally.counts).reduce((a, b) => a + b, 0);
    expect(counted === t.scores.filter((s) => s != null).length, `g${g} team ${i + 1}: ${counted} drives counted for ${t.scores.filter((s) => s != null).length} holes`);
  });
}

ok(fail.length === 0, `${games} simulated games, ${checks} checks — first failures:\n  ${fail.join("\n  ")}`);
console.log(`scramble simulation: ${games} games, ${checks} checks`);
report("scramble simulation");
