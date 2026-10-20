// 210.5 — every statistics feature, through the messy data. Rules that must hold whatever the input.
function ok(c: unknown, m: string) { if (!c) throw new Error(m); }
import { messyGames, MESSY_USERS as U } from "./test-fixtures/messy-games";
import { buildClubReport, reportPeriods, completedRoundsNote } from "./club-report";
import { buildRecap } from "./game-recap";
import { matchOutcomes, memberRecord } from "./match-outcomes";
import { gameContextFor } from "./round-email-server";
import { isFullCard, isValidRound, handicapReading, holeScore, shortenedNote } from "./round-rules";

/** Every number anywhere in a result is finite. */
function finite(x: unknown, where: string): void {
  if (typeof x === "number") ok(Number.isFinite(x), `${where}: a non-finite number (${x})`);
  else if (Array.isArray(x)) x.forEach((v, i) => finite(v, `${where}[${i}]`));
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) finite(v, `${where}.${k}`);
}
const games = messyGames();
const memberNames = new Set(["Full Card", "Empty Card", "Single Score", "Fourteen Holes", "No Index", "No Show", "Derived Dee", "String Scores", "Alt A1", "Alt A2", "Alt B1", "Alt B2", "Tri One", "Tri Two", "Tri Three", "Tri Four"]);

// round-rules itself
ok(!isFullCard([], 18) && !isValidRound([], 18) && !isValidRound([4], 18), "an empty or one-score card is not a round");
ok(isValidRound([...Array(14).fill(3), null, null, null, null], 18) && !isFullCard([...Array(14).fill(3), null, null, null, null], 18), "14 holes: a valid round, not a full card");
ok(isFullCard(Array(9).fill(5), 9) && !isValidRound(Array(5).fill(4), 9), "a 9-hole game: all nine for a round");
ok(handicapReading(null) === null && handicapReading("") === null && handicapReading(0) === 0 && handicapReading("12.4") === 12.4, "a missing index is null, a real 0 is 0");
ok(holeScore(0) === null && holeScore(-1) === null && holeScore("5") === 5 && holeScore(null) === null, "only positive numbers are scores");

// the club report
const r = buildClubReport("Messy Club", reportPeriods(2026)[1], games.map((g) => ({ game: g.game, players: g.players })));
finite(r, "club report");
ok(r.bestGross && r.bestGross.score >= 18 * 4 && Number.isInteger(r.bestGross.score), `best gross comes from a full 18 (got ${JSON.stringify(r.bestGross)})`);
ok(r.bestNet && Number.isInteger(r.bestNet.score) && r.bestNet.score > 0, `best net is a positive whole number (got ${JSON.stringify(r.bestNet)})`);
ok(!["Empty Card", "Single Score", "Fourteen Holes", "No Show", "Alt A1", "Alt A2", "Alt B1", "Alt B2", "Tri Two", "Tri Four"].includes(r.bestGross!.name), `best gross holder must have a full individual card (got ${r.bestGross!.name})`);
for (const k of ["mostRounds", "mostNetBirdies", "mostImproved", "longestStreak"] as const) {
  const who = (r as any)[k]?.name; ok(!who || memberNames.has(who), `${k}: members only (got ${who})`);
  ok(!who || !who.startsWith("Alt") || k === "mostRounds" || k === "longestStreak", `${k}: no alternate-shot pair award (got ${who})`);
}
ok(!r.mostImproved || (r.mostImproved.from > 0 && r.mostImproved.to > 0), `most improved never from a missing index (got ${JSON.stringify(r.mostImproved)})`);

// the recap, head-to-head and the round email — every game
for (const g of games) {
  let recap: ReturnType<typeof buildRecap>;
  try { recap = buildRecap(g.game, g.players); } catch (e) { throw new Error(`recap crashed on: ${g.note} — ${e}`); }
  finite(recap.highlights, `recap highlights (${g.note})`);
  for (const t of recap.highlights.topGross) ok(t.item.score > 0, `recap top gross is a real score (${g.note})`);
  const outs = matchOutcomes(g.game, g.players);
  for (const o of outs) ok([...o.a, ...o.b].every((p) => g.players.some((x) => x.id === p.key || (x as any).user_id === p.key)), `outcome players exist (${g.note})`);
  for (const uid of Object.values(U)) {
    const rec = memberRecord(outs, uid);
    ok(rec.headToHead.every((h) => h.userId) && rec.partners.every((h) => h.userId), `records list members only (${g.note})`);
    const ctx = gameContextFor(g.game, g.players, uid);
    if (ctx?.context.position) {
      const pos = ctx.context.position;
      const fulls = g.players.filter((p) => !p.no_show && isFullCard(p.scores, g.game.holes_meta.length)).length;
      ok(pos.of === fulls && pos.rank >= 1 && pos.rank <= pos.of, `email net position counts full cards only: ${JSON.stringify(pos)} of ${fulls} (${g.note})`);
    }
    if (ctx) finite(ctx.context, `email context (${g.note})`);
  }
}
// 210.6 (owner): only completed rounds count toward exceptional play — and every place says so.
{
  const stroke = games[0];
  const recap = buildRecap(stroke.game, stroke.players);
  ok(recap.highlights.shortened.some((s) => s.name === "Fourteen Holes" && s.holes === 14), "the recap knows who played a shortened round");
  ok(!recap.highlights.topGross.some((t) => t.item.name === "Fourteen Holes"), "a shortened round isn't in the top scores");
  ok(!recap.highlights.shortened.some((s) => s.name === "Single Score" || s.name === "Empty Card"), "a card under 9 holes isn't a round at all — not 'shortened'");
  ok(shortenedNote(recap.highlights.shortened) === "Only completed rounds count toward top scores and standout rounds — Fourteen Holes (14 holes) isn't counted.", `the sentence (got ${shortenedNote(recap.highlights.shortened)})`);
  ok(shortenedNote([]) === null, "no shortened rounds: no sentence");
  const ctx = gameContextFor(stroke.game, stroke.players, U.fourteen)!;
  ok(ctx.context.shortenedHoles === 14, "the member's own email knows their round was shortened");
  ok(ctx.groupHtml.includes("Only completed rounds count toward top scores and standout rounds"), "the group section of the email carries the recap's sentence");
  ok(gameContextFor(stroke.game, stroke.players, U.full)!.context.shortenedHoles == null, "a full card isn't 'shortened'");
  ok(r.shortenedRounds >= 1 && completedRoundsNote(r).startsWith("Best scores and standout rounds count completed 18-hole rounds only — "), `the club report states the rule with the count (${completedRoundsNote(r)})`);
}
// 210.7 — the real formats: Stableford, skins, Trifecta.
{
  const byNote = (s: string) => games.find((g) => g.note.startsWith(s))!;
  const stab = buildRecap(byNote("Stableford").game, byNote("Stableford").players);
  ok(!stab.highlights.topGross.some((t) => t.item.name === "Fourteen Holes" || t.item.name === "Single Score"), "Stableford: a shortened or one-score card doesn't rank");
  ok(stab.highlights.shortened.some((x) => x.name === "Fourteen Holes"), "Stableford: the shortened card is named");
  const skins = buildRecap(byNote("skins").game, byNote("skins").players);
  finite(skins, "skins recap (all holes tied, everything carries)");
  const tri = byNote("Trifecta");
  const triRecap = buildRecap(tri.game, tri.players);
  finite(triRecap.highlights, "Trifecta recap highlights");
  ok(triRecap.highlights.shortened.some((x) => x.name === "Tri Two" && x.holes === 12), "Trifecta: the 12-hole player is named as shortened");
  for (const o of matchOutcomes(tri.game, tri.players)) ok([...o.a, ...o.b].every((p) => p.userId), "Trifecta outcomes: members only");
}
console.log("messy-data tests passed");
