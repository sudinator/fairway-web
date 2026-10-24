/** 212.33 — a no-show keeps their scramble team place and is SHOWN (owner, Oct 23, REAL staging game 386503).
 * The wrong answer: Marcus Johnson was tapped "No-show" by accident; the Teams screen hid him (5 players listed, not 6)
 * but kept him in Team 1 — the team counted a player and showed none, the setup check said "complete", and scoring
 * built Team 1's handicap with him in it. Owner: leave him on the team, flag it, and confirm before marking a no-show. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { ScrambleTeamsBuilder } from "@/components/game/scramble-teams-builder";
import { scrambleLineupTeams, scrambleLineupText, ScrambleLineupCard } from "@/components/game/scramble-lineup";
import { scrambleSetupProblem } from "@/lib/scramble-teams";
import { scrambleTeamHandicapFor, pkey } from "@/lib/game-shape";
import { decideSetupChange as setupDecision } from "@/lib/game-setup-policy";
import type { Game, Player } from "@/lib/game-types";

// REAL: game 386503's teams and players exactly as pulled from staging (ids, user_ids, names, no_show).
// Illustrative (NOT from staging, which the query didn't include): the course handicaps and the course.
const FOURSOMES = [
  { a: ["ed71b253-a950-498b-bc08-78efa15e5b5b", "ecb9e7e7-236b-444e-acc6-2a3513bad739"], b: [], id: "team-1792791451111-1", name: "Team 1" },
  { a: ["f43ee304-591c-4c96-a468-af560c591cbf", "0605eb36-d231-48d4-aecf-ede1387dff77"], b: [], id: "team-1792791581943-2", name: "Team 2" },
  { a: ["7ccf05ac-9bdc-41f4-98f3-c67eab8ef9c1", "9d45e26d-5c2b-4e6a-ba54-f9e326499777"], b: [], id: "team-1792791588917-3", name: "Team 3" },
];
const ROWS: [string, string, string, boolean, number][] = [
  ["1b4ed185-8feb-4807-baf3-fed9d4c813ef", "0605eb36-d231-48d4-aecf-ede1387dff77", "Chris O'Neal", false, 12],
  ["a2292eb5-f37a-41b6-b10a-b77f5f1b920e", "7ccf05ac-9bdc-41f4-98f3-c67eab8ef9c1", "DeShawn Brooks Jr.", false, 18],
  ["5cd65d2e-0b74-4497-bbf0-591d49bbf274", "ed71b253-a950-498b-bc08-78efa15e5b5b", "Marcus Johnson", true, 9],
  ["230d0bfe-a8d3-4b50-9965-5a4d69f6f0f4", "9d45e26d-5c2b-4e6a-ba54-f9e326499777", "Amit Sud", false, 20],
  ["3021dc87-294c-44d3-bc43-c4cd0f232d8b", "ecb9e7e7-236b-444e-acc6-2a3513bad739", "Lex Rivera-Santos", false, 15],
  ["41c5bc87-25af-47f5-af03-bde0b6028f8e", "f43ee304-591c-4c96-a468-af560c591cbf", "Bo Li", false, 7],
];
const players = ROWS.map(([id, uid, name, ns, ch]) => ({ id, user_id: uid, display_name: name, no_show: ns, course_handicap: ch, course_handicap_source: "manual", handicap_index: null, scores: [] } as unknown as Player));
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const game = { id: "g386503", code: "386503", game_type: "scramble", scramble_team_size: null, scramble_mode: "field", scramble_handicap: "usga", holes_meta: holes, course_par: 72, foursomes: FOURSOMES, status: "setup" } as unknown as Game;
const marcus = players.find((p) => p.display_name === "Marcus Johnson")!;
const live = players.filter((p) => !p.no_show), noShows = players.filter((p) => p.no_show).map((p) => ({ key: pkey(p), name: p.display_name }));

// 1. the setup check: it used to say "complete" (the hidden player was counted); now it names him
ok(scrambleSetupProblem(FOURSOMES, live.map(pkey), "field", { method: "usga" }) === null, "386503 as before: the old check found nothing wrong (the bug)");
const problem = scrambleSetupProblem(FOURSOMES, live.map(pkey), "field", { method: "usga", noShows });
ok(problem === "Marcus Johnson is marked as a no-show but is on Team 1 — take them off the team, or return them to play.", `386503: the check names Marcus and Team 1 (got ${problem})`);
const moved = FOURSOMES.map((g) => ({ ...g, a: g.a.filter((k) => k !== marcus.user_id) }));
ok(scrambleSetupProblem([{ ...moved[0], a: [...moved[0].a, moved[1].a[0]] }, { ...moved[1], a: [moved[1].a[1], moved[2].a[0], moved[2].a[1]] }].map((g) => g), live.map(pkey), "field", { method: "usga", noShows }) === null, "once Marcus is off the teams (and everyone else placed), the check is clear");

// 2. the Teams screen: 6 players visible (5 playing + Marcus as a no-show), Team 1 shows him, the problem is shown
{
  const t = renderScreen(<ScrambleTeamsBuilder game={game} players={players} readOnly={false} onSave={() => {}} />);
  const playing = t.el.querySelectorAll("[data-scramble-player]").length, out = t.el.querySelectorAll("[data-scramble-noshow]");
  ok(playing === 5 && out.length === 1 && out[0].getAttribute("data-scramble-noshow") === "Marcus Johnson", `5 playing + Marcus listed as a no-show (got ${playing} + ${out.length})`);
  ok((out[0].textContent || "").includes("No-show · still on Team 1"), "Marcus's row says he is still on Team 1");
  const sel = out[0].querySelector("select") as HTMLSelectElement | null;
  ok(!!sel && [...sel.options].map((o) => o.textContent).join("|") === "Team 1|No team", `his picker can only keep him or take him off (got ${sel ? [...sel.options].map((o) => o.textContent) : "none"})`);
  const team1 = t.el.querySelector('[data-scramble-team="Team 1"]')?.textContent || "";
  ok(team1.includes("Marcus Johnson · no-show") && team1.includes("Lex Rivera-Santos") && team1.includes("2 players"), `Team 1 shows both members, Marcus marked (got "${team1.slice(0, 120)}")`);
  ok((t.el.querySelector("[data-scramble-problem]")?.textContent || "").includes("Marcus Johnson is marked as a no-show"), "the screen shows the problem");
  // no other team offers a place to a no-show; the playing players' pickers don't list "Marcus"
  ok(![...t.el.querySelectorAll("[data-scramble-player] select option")].some((o) => (o.textContent || "").includes("Marcus")), "playing players' pickers are unaffected");
  t.unmount();
}

// 3. one rule: the line-up's team handicap == the one scoring uses, for every team (no-show counted in both)
const lineup = scrambleLineupTeams(game, players);
for (const [i, g] of FOURSOMES.entries()) {
  const scoring = scrambleTeamHandicapFor(game as never, players as never, g.a[0]);
  ok(lineup[i].handicap === scoring, `${g.name}: line-up handicap ${lineup[i].handicap} == scoring ${scoring}`);
}
ok(lineup[0].lines.some((l) => l.name === "Marcus Johnson" && l.noShow) && scrambleLineupText(game, players).includes("Marcus Johnson (no-show)"), "the line-up card and text mark Marcus as a no-show");
{
  // the card shows the label in full on its own line (212.33 gallery review: "Karan Patel · no-sh…" was cut off)
  const t = renderScreen(<ScrambleLineupCard game={game} players={players} />);
  const tags = t.el.querySelectorAll("[data-lineup-noshow]");
  ok(tags.length === 1 && tags[0].textContent === "No-show" && (tags[0].parentElement?.textContent || "").startsWith("Marcus Johnson"), "the line-up card shows \"No-show\" under Marcus's name");
  t.unmount();
}

// 4. marking a no-show asks first — even in setup (the accidental tap); returning to play does not
const d = setupDecision({ game, players, action: { type: "toggle_no_show", player: { ...marcus, no_show: false }, next: true } } as never);
ok(d.decision === "confirm" && /Mark Marcus Johnson as a no-show\?/.test((d as { title: string }).title), `setup no-show asks first (got ${d.decision})`);
ok(setupDecision({ game, players, action: { type: "toggle_no_show", player: marcus, next: false } } as never).decision === "allow", "returning to play is one tap");
report("scramble no-shows");
