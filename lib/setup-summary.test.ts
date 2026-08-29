/**
 * The setup summary — the text pasted into a group chat so everyone can confirm their handicap,
 * tee and team BEFORE teeing off.
 *
 * Asserted on the text itself, which is the deliverable. A React component rendering the same
 * strings could only be checked by scraping the DOM.
 */
import { buildSetupSummary, dominantTee } from "./setup-summary";

let pass = 0, fail = 0; const fails: string[] = [];
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; fails.push("FAIL " + n); } };

const P = (name: string, o: Partial<Record<string, unknown>> = {}) =>
  ({ display_name: name, handicap_index: 14, course_handicap: 16, tee_name: "Blue", ...o }) as never;

const eighteen = Array.from({ length: 18 }, (_, i) => ({ n: i + 1 }));
const backNine = Array.from({ length: 9 }, (_, i) => ({ n: i + 10 }));

// ── the tee is stated ONCE, not on every line ────────────────────────────
{
  const T = (tee: string) => ({ display_name: "x", tee_name: tee }) as never;
  // Everyone on one tee.
  const all4 = dominantTee([T("Blue"), T("Blue"), T("Blue"), T("Blue")]);
  ok("all on one tee is dominant", all4?.tee === "Blue" && all4?.exceptions === 0);
  // 3 of 4 is 75% — a flat 80% rule would NOT catch this, yet repeating the tee three times to
  // flag one exception is exactly the repetition worth removing.
  const three = dominantTee([T("Blue"), T("Blue"), T("Blue"), T("White")]);
  ok("3 of 4 is still dominant", three?.tee === "Blue" && three?.exceptions === 1);
  // An even split has no main tee; calling one dominant would mislabel half the field.
  ok("2/2 has no main tee", dominantTee([T("Blue"), T("Blue"), T("White"), T("White")]) === null);
  // Too many exceptions to be "unless noted".
  ok("5 of 8 is not dominant", dominantTee([...Array(5).fill(T("Blue")), ...Array(3).fill(T("White"))]) === null);
  // Large field, a quarter differing, still worth factoring.
  const big = dominantTee([...Array(12).fill(T("Blue")), ...Array(4).fill(T("White"))]);
  ok("12 of 16 is dominant", big?.tee === "Blue" && big?.exceptions === 4);
  ok("no tees at all yields null", dominantTee([{ display_name: "x" } as never]) === null);
}

// ── a team game: alphabetical, team named inline ─────────────────────────
{
  const game = {
    name: "Saturday Match", course: "Berkshire Valley", game_type: "fourball" as const,
    allowance_pct: 85, played_at: "Aug 29, 2026", holes_meta: eighteen,
    teams: [{ key: "A", name: "Red" }, { key: "B", name: "Blue" }],
  } as never;
  const players = [
    P("Rajiv Menon", { team: "B", tee_group: 1, handicap_index: 21, course_handicap: 24 }),
    P("Amit Sud", { team: "A", tee_group: 1, course_handicap: 16 }),
    P("Shubho Ghosh", { team: "B", tee_group: 2, handicap_index: 8, course_handicap: 9 }),
    P("Bryan Fingeroot", { team: "A", tee_group: 1, handicap_index: 4, course_handicap: 5, tee_name: "White" }),
  ];
  const out = buildSetupSummary(game, players);
  const body = out.split("\n").filter((l) => l.startsWith("  "));

  // ALPHABETICAL regardless of the order they were added — finding yourself is the job.
  ok("sorted alphabetically", /Amit/.test(body[0]) && /Bryan/.test(body[1]) && /Rajiv/.test(body[2]) && /Shubho/.test(body[3]));
  // The team is NAMED, not coded. An earlier draft used R/B prefixes plus a legend — a code you
  // have to decode, which is worse than repeating the word.
  ok("team named inline", body[0].includes("Team Red"));
  ok("and the other team too", body[2].includes("Team Blue"));
  ok("no single-letter team code", !/^\s+[RB]\s/.test(body[0]));

  // The tee is stated once in the header and only on the line that differs.
  ok("header states the common tee", out.includes("Blue tees unless noted"));
  ok("the exception carries its tee", body[1].includes("White tees"));
  ok("everyone else omits it", !body[0].includes("tees") && !body[2].includes("tees"));

  ok("both handicap numbers", body[0].includes("CH 16") && body[0].includes("idx 14"));
  ok("group shown when they differ", body[3].includes("Grp 2"));
  ok("non-default allowance stated", out.includes("85%"));
}

// ── no teams: the same layout, unchanged ─────────────────────────────────
{
  const game = { name: "Solo", game_type: "stableford" as const, holes_meta: eighteen } as never;
  const out = buildSetupSummary(game, [P("Zoe Last"), P("Amy First")]);
  const body = out.split("\n").filter((l) => l.startsWith("  "));
  ok("still alphabetical", /Amy/.test(body[0]) && /Zoe/.test(body[1]));
  ok("no team text when there are none", !out.includes("Team"));
  // A single shared tee is still factored out.
  ok("tee still stated once", out.includes("All playing Blue tees"));
  ok("and not repeated per line", !body[0].includes("tees"));
}

// ── a nine names its holes ────────────────────────────────────────────────
{
  const game = { name: "Back nine", game_type: "match" as const, allowance_pct: 100, holes_meta: backNine } as never;
  const out = buildSetupSummary(game, [P("Amit Sud")]);
  ok("names the holes played", out.includes("9 holes (10\u201318)"));
  ok("a default allowance stays quiet", !out.includes("100%"));
}

// ── nobody dropped, nothing blank ─────────────────────────────────────────
{
  const game = { game_type: "stableford" as const, holes_meta: eighteen } as never;
  const out = buildSetupSummary(game, [P("Amit Sud"), P("Didn't Come", { no_show: true })]);
  ok("a no-show is listed", out.includes("Didn't Come"));
  ok("and marked", out.includes("no-show"));
}
{
  const game = { game_type: "stableford" as const, holes_meta: eighteen } as never;
  const out = buildSetupSummary(game, [P("No Data", { handicap_index: null, course_handicap: null, tee_name: null })]);
  ok("a missing value shows as a dash", out.includes("\u2014"));
  ok("never prints null", !/null|undefined|NaN/.test(out));
  ok("falls back to the format as a title", out.startsWith("Stableford"));
}

// ── it has to survive a group chat ───────────────────────────────────────
{
  const game = { game_type: "fourball" as const, holes_meta: eighteen } as never;
  const out = buildSetupSummary(game, [P("A"), P("B")]);
  ok("no box-drawing characters", !/[\u2500-\u257F]/.test(out));
  ok("no tab characters", !out.includes("\t"));
  ok("no run of blank lines", !/\n\n\n/.test(out));
  ok("no leading or trailing whitespace", out === out.trim());
}

console.log(`setup summary: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
