/**
 * The setup summary — the text pasted into a group chat so everyone can confirm their handicap,
 * tee and team BEFORE teeing off.
 *
 * Asserted on the text itself, which is the deliverable. A React component rendering the same
 * strings could only be checked by scraping the DOM.
 */
import { buildSetupSummary } from "./setup-summary";

let pass = 0, fail = 0; const fails: string[] = [];
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; fails.push("FAIL " + n); } };

const P = (name: string, o: Partial<Record<string, unknown>> = {}) =>
  ({ display_name: name, handicap_index: 14, course_handicap: 16, tee_name: "Blue", ...o }) as never;

const eighteen = Array.from({ length: 18 }, (_, i) => ({ n: i + 1 }));
const backNine = Array.from({ length: 9 }, (_, i) => ({ n: i + 10 }));

// ── a team game: the case this was asked for ───────────────────────────────
{
  const game = {
    name: "Saturday Match", course: "Berkshire Valley", game_type: "fourball" as const,
    allowance_pct: 85, played_at: "2026-08-29", holes_meta: eighteen,
    teams: [{ key: "A", name: "Red" }, { key: "B", name: "Blue" }],
  } as never;
  const players = [
    P("Amit Sud", { team: "A", tee_group: 1, course_handicap: 16 }),
    P("Bryan Fingeroot", { team: "A", tee_group: 1, handicap_index: 4, course_handicap: 5, tee_name: "White" }),
    P("Rajiv Menon", { team: "B", tee_group: 1, handicap_index: 21, course_handicap: 24 }),
    P("Shubho Ghosh", { team: "B", tee_group: 2, handicap_index: 8, course_handicap: 9 }),
  ];
  const out = buildSetupSummary(game, players);

  ok("names the game", out.includes("Saturday Match"));
  ok("names the course", out.includes("Berkshire Valley"));
  ok("states the format", out.includes("Four-Ball"));
  // The allowance is the number people query afterwards, so a non-default one must be stated.
  ok("states a non-default allowance", out.includes("85%"));
  ok("groups by team name, not key", out.includes("Red:") && out.includes("Blue:"));
  for (const nm of ["Amit Sud", "Bryan Fingeroot", "Rajiv Menon", "Shubho Ghosh"]) {
    ok(`lists ${nm}`, out.includes(nm));
  }
  // BOTH numbers: the index is what a player recognises, the course handicap is what they play off,
  // and the gap between them is what surprises people.
  ok("shows the handicap index", out.includes("idx 14"));
  ok("shows the course handicap", out.includes("CH 16"));
  ok("shows each player's own tee", out.includes("White") && out.includes("Blue"));
  // A player in a different tee group must be visible, or someone waits on the wrong tee.
  ok("shows the tee group when it differs", out.includes("Grp 2"));
  ok("asks people to check", /check your handicap/i.test(out));
}

// ── a nine must say so ─────────────────────────────────────────────────────
{
  const game = {
    name: "Back nine", course: "C", game_type: "match" as const,
    allowance_pct: 100, holes_meta: backNine,
  } as never;
  const out = buildSetupSummary(game, [P("Amit Sud")]);
  // Someone turning up at the 1st tee for a back-nine match is exactly what this prevents.
  ok("names the holes played", out.includes("9 holes (10\u201318)"));
  // 100% is the default and stays quiet, so the common case is not cluttered.
  ok("a default allowance is not stated", !out.includes("100%"));
}

// ── missing data is visible, never blank ──────────────────────────────────
{
  const game = { game_type: "stableford" as const, holes_meta: eighteen } as never;
  const out = buildSetupSummary(game, [P("No Handicap", { handicap_index: null, course_handicap: null, tee_name: null })]);
  ok("a missing value shows as a dash", out.includes("\u2014"));
  ok("and never prints null", !/null|undefined|NaN/.test(out));
  // With no game name it still has a title rather than opening on a blank line.
  ok("falls back to the format as a title", out.startsWith("Stableford"));
}

// ── nobody is silently dropped ────────────────────────────────────────────
{
  const game = {
    game_type: "match" as const, holes_meta: eighteen,
    teams: [{ key: "A", name: "Red" }, { key: "B", name: "Blue" }],
  } as never;
  // A player with no team must still appear — a roster that omits someone is worse than no roster.
  const out = buildSetupSummary(game, [P("On Red", { team: "A" }), P("Unassigned")]);
  ok("an unassigned player still appears", out.includes("Unassigned"));
  ok("and is labelled as such", out.includes("Not on a team"));
}
{
  // A no-show is flagged rather than hidden, so the count in the chat matches the count on the tee.
  const game = { game_type: "stableford" as const, holes_meta: eighteen } as never;
  const out = buildSetupSummary(game, [P("Amit Sud"), P("Didn't Come", { no_show: true })]);
  ok("a no-show is listed", out.includes("Didn't Come"));
  ok("and marked", out.includes("no-show"));
}

// ── it has to survive a group chat ────────────────────────────────────────
{
  const game = {
    game_type: "fourball" as const, holes_meta: eighteen,
    teams: [{ key: "A", name: "Red" }, { key: "B", name: "Blue" }],
  } as never;
  const out = buildSetupSummary(game, [P("A", { team: "A" }), P("B", { team: "B" })]);
  // No table drawing, no box characters, no reliance on a monospace font — WhatsApp, iMessage and
  // Slack render none of those consistently.
  ok("no box-drawing characters", !/[\u2500-\u257F]/.test(out));
  ok("no tab characters", !out.includes("\t"));
  ok("no run of blank lines", !/\n\n\n/.test(out));
  ok("does not start or end with whitespace", out === out.trim());
}

console.log(`setup summary: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
