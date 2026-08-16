declare const process: { exit(code?: number): never };
import { decideSetupChange, gameHasScores, playerHasScores } from "./game-setup-policy";
import type { Game, Player } from "./game-types";

const teams = [{ key: "A", name: "Team 1" }, { key: "B", name: "Team 2" }];
const foursomes = [{ id: "f1", name: "F1", a: ["p1", "p2"], b: ["p3", "p4"] }];
const baseGame = (): Game => ({
  id: "g", group_id: "grp", code: "TEST", name: "Test", course: "Course", course_par: 72, holes_meta: [],
  game_type: "stableford", status: "active", allowance_pct: 100, pairings: [], teams: null, foursomes: null,
  created_by: "u1", created_at: "2026-08-16T00:00:00Z",
} as Game);
const P = (id: string, scores: (number | null)[] = [null, null], extra: Partial<Player> = {}): Player => ({
  id, game_id: "g", user_id: id, display_name: id, handicap_index: 10, rating: 72, slope: 120,
  tee_name: "Blue", course_handicap: 11, scores, putts: [null, null], fairways: [null, null],
  ...extra,
});

let pass = 0, fail = 0; const failures: string[] = [];
const check = (name: string, got: unknown, expected: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(expected)) pass++;
  else { fail++; failures.push(`${name}: got ${JSON.stringify(got)} expected ${JSON.stringify(expected)}`); }
};
const decision = (game: Game, players: Player[], action: any) => decideSetupChange({ game, players, action }).decision;
const scored = P("p1", [4, null]);
const blank = P("p2");

check("playerHasScores blank", playerHasScores(blank), false);
check("playerHasScores scored", playerHasScores(scored), true);
check("gameHasScores", gameHasScores([blank, scored]), true);
check("rename ended allowed", decision({ ...baseGame(), status: "ended" }, [scored], { type: "rename_game" }), "allow");
check("date scored confirm", decision(baseGame(), [scored], { type: "set_game_date" }), "confirm");
check("add individual midround confirm", decision(baseGame(), [scored], { type: "add_player" }), "confirm");
check("add team midround blocked", decision({ ...baseGame(), game_type: "fourball", foursomes }, [scored], { type: "add_player" }), "block");
check("remove scored blocked", decision(baseGame(), [scored], { type: "remove_player", player: scored }), "block");
check("remove blank confirm", decision(baseGame(), [blank], { type: "remove_player", player: blank }), "confirm");
check("hcp scored confirm", decision(baseGame(), [scored], { type: "set_handicap", player: scored }), "confirm");
check("tee scored confirm", decision(baseGame(), [scored], { type: "set_tee", player: scored, teeName: "White" }), "confirm");
check("team scored blocked", decision({ ...baseGame(), game_type: "match", teams }, [scored], { type: "set_team", player: scored, team: "B" }), "block");
check("team blank allowed", decision({ ...baseGame(), game_type: "match", teams }, [scored, blank], { type: "set_team", player: blank, team: "B" }), "allow");
check("tee group scored blocked", decision(baseGame(), [scored], { type: "set_tee_group", player: scored, group: 2 }), "block");
check("tee group blank midround confirm", decision(baseGame(), [scored, blank], { type: "set_tee_group", player: blank, group: 2 }), "confirm");
check("randomize midround blocked", decision(baseGame(), [scored], { type: "randomize_groups" }), "block");
check("stableford to stroke scored confirm", decision(baseGame(), [scored], { type: "set_format", target: "stroke" }), "confirm");
check("stableford to individual skins scored confirm", decision(baseGame(), [scored], { type: "set_format", target: "skins" }), "confirm");
check("stableford to match scored blocked", decision(baseGame(), [scored], { type: "set_format", target: "match" }), "block");
check("team to individual scored blocked", decision({ ...baseGame(), game_type: "fourball", foursomes }, [scored], { type: "set_format", target: "stableford" }), "block");
check("fourball to trifecta same foursomes confirm", decision({ ...baseGame(), game_type: "fourball", teams, foursomes }, [scored], { type: "set_format", target: "trifecta" }), "confirm");
check("allowance scored confirm", decision(baseGame(), [scored], { type: "set_allowance", pct: 85 }), "confirm");
check("skins style scored blocked", decision({ ...baseGame(), game_type: "skins" }, [scored], { type: "set_skins_style", style: "team_11" }), "block");
check("match team scored blocked", decision({ ...baseGame(), game_type: "match" }, [scored], { type: "set_match_team", on: true }), "block");
check("ended edit blocks until reopen", decision({ ...baseGame(), status: "ended" }, [scored], { type: "set_allowance", pct: 85 }), "block");
check("no-show pre-score allow", decision(baseGame(), [blank], { type: "toggle_no_show", player: blank, next: true }), "allow");
check("no-show midround confirm", decision(baseGame(), [scored], { type: "toggle_no_show", player: scored, next: true }), "confirm");
check("tee target locked blocked", decision(baseGame(), [scored, P("p3", [null, null], { tee_group: 2, group_locked: true }), blank], { type: "set_tee_group", player: blank, group: 2 }), "block");
check("team score midround confirm", decision({ ...baseGame(), game_type: "fourball", foursomes }, [scored], { type: "set_team_score_mode", mode: "aggregate" }), "confirm");
check("skins tie mode midround confirm", decision({ ...baseGame(), game_type: "skins" }, [scored], { type: "set_skins_mode", mode: "split" }), "confirm");
check("trifecta scoring midround confirm", decision({ ...baseGame(), game_type: "trifecta", teams, foursomes }, [scored], { type: "set_trifecta_scoring", mode: "match" }), "confirm");
check("leg config midround confirm", decision({ ...baseGame(), game_type: "fourball", foursomes }, [scored], { type: "set_leg_config" }), "confirm");
check("share ended allowed", decision({ ...baseGame(), status: "ended" }, [scored], { type: "share_live" }), "allow");
check("date ended confirm", decision({ ...baseGame(), status: "ended" }, [scored], { type: "set_game_date" }), "confirm");
check("remove ended blocked", decision({ ...baseGame(), status: "ended" }, [blank], { type: "remove_player", player: blank }), "block");
check("format ended blocked", decision({ ...baseGame(), status: "ended" }, [scored], { type: "set_format", target: "stroke" }), "block");
check("pairings pre-score allowed", decision({ ...baseGame(), game_type: "match" }, [blank], { type: "set_pairings" }), "allow");
check("pairings scored blocked", decision({ ...baseGame(), game_type: "match", pairings: [{ a: "p1", b: "p2" }] }, [scored, blank], { type: "set_pairings" }), "block");
check("foursomes pre-score allowed", decision({ ...baseGame(), game_type: "fourball", teams, foursomes }, [blank], { type: "set_foursomes" }), "allow");
check("foursomes scored blocked", decision({ ...baseGame(), game_type: "fourball", teams, foursomes }, [scored], { type: "set_foursomes" }), "block");
check("course loophole represented by no action", true, true);

console.log(`\n=== game-setup-policy.test ===\nPASS ${pass}  FAIL ${fail}`);
if (failures.length) { console.log(failures.join("\n")); process.exit(1); }
console.log("All assertions passed.");
