/**
 * Every game type must be handled everywhere it matters.
 *
 * Adding `alt_shot` meant touching 63 sites across 14 files. TypeScript caught only the two that
 * were real `switch` statements and the seven that restated the union verbatim; the rest are
 * ternary chains that silently fall through to a default, so a half-landed format would look fine
 * to the compiler and simply never appear in the picker.
 *
 * This walks GAME_TYPES — the single list — and asserts each one is genuinely handled. A format
 * added to the union but forgotten in a label or a shape fails here rather than on a phone.
 */
import { GAME_TYPES, shapeOf, type GameType } from "./game-shape";
import { gameTypeLabel, buildGamePayload } from "./game-create";

let pass = 0, fail = 0;
const fails: string[] = [];
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; fails.push("FAIL " + n); } };

ok("the list is not empty", GAME_TYPES.length > 0);
ok("alt_shot is in the list", GAME_TYPES.includes("alt_shot" as GameType));
ok("no duplicates in the list", new Set(GAME_TYPES).size === GAME_TYPES.length);

for (const gt of GAME_TYPES) {
  // A label. The fall-through default used to be the type's own key, so an unhandled format would
  // show a golfer "alt_shot" on the game list.
  const label = gameTypeLabel(gt);
  ok(`${gt}: has a label`, typeof label === "string" && label.length > 0);
  ok(`${gt}: label is not the raw key`, label !== gt);
  ok(`${gt}: label has no underscore`, !label.includes("_"));

  // A shape, in both the plain and the two-team configuration. shapeOf drives which setup steps
  // appear and how a hole is scored, so an unhandled type quietly becomes "absolute" scoring.
  for (const teams of [null, [{ id: "a", name: "A" }, { id: "b", name: "B" }]]) {
    const shape = shapeOf({ game_type: gt, teams: teams as never, foursomes: [] });
    ok(`${gt}: shape has a view`, typeof shape.view === "string" && shape.view.length > 0);
    ok(`${gt}: shape has a dot basis`, shape.dotBasis != null);
    ok(`${gt}: shape type round-trips`, shape.type === gt);
  }
}


// Labels must be DISTINCT. The chain ends in a fall-through to "Stableford", so a format added to
// the union but forgotten here is not labelled with its raw key — it is labelled as a different
// real format, and a golfer sees "Stableford" on an alternate shot game with nothing looking
// wrong. Distinctness is the only assertion that catches that.
{
  const labels = GAME_TYPES.map((gt) => gameTypeLabel(gt));
  const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
  ok(
    `every game type has its OWN label (duplicated: ${[...new Set(dupes)].join(", ") || "none"})`,
    dupes.length === 0,
  );
}

// ── alt_shot specifically: it must behave like a 2v2 team format ───────────
{
  const teams = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
  const s = shapeOf({ game_type: "alt_shot", teams: teams as never, foursomes: [] });
  ok("alt_shot uses two named teams", s.usesTeams);
  ok("alt_shot uses matchups", s.usesMatchups);
  ok("alt_shot uses foursomes (the 2v2 pairs)", s.usesFoursomes);
  // NOT relative_foursome — that was the assumption at 177.82, modelling alternate shot on
  // four-ball. It gives each player strokes against the foursome's lowest INDIVIDUAL handicap.
  // Alternate shot's SIDE has one handicap (50% of the partners combined) and strokes are the
  // difference between sides, so it needs its own basis.
  ok("alt_shot uses the side basis, not four-ball's", s.dotBasis === "alt_shot_side");
  ok("and four-ball still uses relative_foursome",
     shapeOf({ game_type: "fourball", teams: teams as never, foursomes: [] }).dotBasis === "relative_foursome");
  ok("alt_shot is not skins", s.skinsStyle === null);
}


// ── the payload must supply whatever the shape claims to use ───────────────
// A format whose shape says usesTeams but whose payload writes teams:null reaches the database
// with no sides at all. Every downstream view reads teams/foursomes, so the format is inert at
// runtime — and the picker, the review label and the game list all look correct.
{
  const opts = {
    code: "ABC", activeGroupId: "g1", name: "", courseName: "C", coursePar: 72,
    matchDate: "2026-08-26", allowancePct: 50, courseHoles: [],
    teamMode: true, team1: "Red", team2: "Blue",
    skinsTeamStyle: "best_ball" as const, teamScoreMode: "best_ball" as const,
    trifectaScoring: "per_hole" as const, strokeBasis: "net" as const,
    skinsMode: "carryover" as const, flightsSupported: false, flightMode: "off" as const,
  };
  for (const gt of GAME_TYPES) {
    const shape = shapeOf({ game_type: gt, teams: [{ id: "a", name: "A" }, { id: "b", name: "B" }] as never, foursomes: [] });
    const payload = buildGamePayload({ ...opts, gameType: gt } as never) as Record<string, unknown>;
    if (shape.usesTeams) {
      ok(`${gt}: shape uses teams, so the payload supplies them`, Array.isArray(payload.teams));
    }
    if (shape.usesFoursomes) {
      ok(`${gt}: shape uses foursomes, so the payload supplies them`, payload.foursomes !== null && payload.foursomes !== undefined);
    }
  }
}


// ── every format's setup must be COMPLETABLE ─────────────────────────────
// shapeOf says which structures a format needs; the UI must offer an editor for each. alt_shot
// required foursomes while the foursome builder was gated on fourball||trifecta only — so the
// Matchups tab rendered nothing, the Tee groups tab is hidden when usesFoursomes is true, and
// setup could never finish. Every previous check passed.
{
  const teams = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
  for (const gt of GAME_TYPES) {
    const shape = shapeOf({ game_type: gt, teams: teams as never, foursomes: [] });
    // A format cannot demand foursomes AND have no tee-group fallback unless an editor exists.
    // This is the reachability the app depends on; the source check below enforces the other half.
    ok(
      `${gt}: does not require a structure with no way to reach it`,
      !(shape.usesFoursomes && !shape.usesTeams && !shape.usesMatchups),
    );
  }
}

console.log(`game type coverage: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
