/** 212.34 — small scramble teams share a tee group: one card, one scorer (owner, Oct 23). Saving teams used to make each
 * team its own group, so two teams of 2 playing as a foursome had two cards. Rules (lib/scramble-teams scrambleTeeGroups):
 * a team never splits; ≤ 4 players a group; teams of 2 pair up by default; captains and teams of 3–4 default to one team
 * per group, and captains can be combined; the organizer's choice wins where it fits; team v team = one group per match. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { scrambleTeeGroups, type ScrambleGroup } from "@/lib/scramble-teams";
import { ScrambleTeamsBuilder } from "@/components/game/scramble-teams-builder";
import { GroupScorecard } from "@/components/game/scorecard-views";
import type { Game, Player } from "@/lib/game-types";

// compare by value (the harness eq is identity)
const eq = <V,>(actual: V, expected: V, label: string) => ok(JSON.stringify(actual) === JSON.stringify(expected), `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
const T = (id: string, a: string[], tee?: number): ScrambleGroup => ({ id, name: `Team ${id.slice(1)}`, a, b: [], ...(tee != null ? { tee } : {}) });
const seq = (m: Map<string, number>, ids: string[]) => ids.map((i) => m.get(i));
const pairs = (n: number) => Array.from({ length: n }, (_, i) => T(`t${i + 1}`, [`p${i * 2}`, `p${i * 2 + 1}`]));

// --- the rules ---
// game 386503's shape (real staging: three teams of 2): Teams 1 and 2 share Group 1, Team 3 is Group 2
eq(seq(scrambleTeeGroups(pairs(3), "field", false), ["t1", "t2", "t3"]), [1, 1, 2], "386503 (3 teams of 2): 1+2 together, 3 alone");
eq(seq(scrambleTeeGroups(pairs(4), "field", false), ["t1", "t2", "t3", "t4"]), [1, 1, 2, 2], "4 teams of 2: two foursomes");
eq(seq(scrambleTeeGroups([T("t1", ["a", "b", "c", "d"]), T("t2", ["e", "f", "g"])], "field", false), ["t1", "t2"]), [1, 2], "teams of 4 and 3: one team per group (as before)");
eq(seq(scrambleTeeGroups([T("t1", ["a", "b"]), T("t2", ["c", "d", "e"]), T("t3", ["f", "g"])], "field", false), ["t1", "t2", "t3"]), [1, 2, 1], "2, 3, 2: the pairs still share, past the 3");
eq(seq(scrambleTeeGroups([T("t1", ["a"]), T("t2", ["b"]), T("t3", ["c"])], "field", true), ["t1", "t2", "t3"]), [1, 2, 3], "captains: one team per group by default (owner)");
eq(seq(scrambleTeeGroups([T("t1", ["a"], 1), T("t2", ["b"], 1), T("t3", ["c"], 2)], "field", true), ["t1", "t2", "t3"]), [1, 1, 2], "captains: can be combined (owner: 'have that option')");
eq(seq(scrambleTeeGroups(pairs(3).map((g) => ({ ...g, tee: 1 })), "field", false), ["t1", "t2", "t3"]), [1, 1, 2], "a choice that would make 6 in a group: the third team goes to its own group");
eq(seq(scrambleTeeGroups(pairs(2).map((g) => ({ ...g, tee: 7 })), "field", false), ["t1", "t2"]), [1, 1], "groups are renumbered 1..n");
eq(seq(scrambleTeeGroups([T("t1", ["a", "b"], 2), T("t2", ["c", "d"], 1)], "field", false), ["t1", "t2"]), [1, 2], "a chosen split stays split (numbered in team order)");
eq(seq(scrambleTeeGroups([{ id: "m1", name: "Match 1", a: ["a", "b"], b: ["c", "d"] }, { id: "m2", name: "Match 2", a: ["e", "f"], b: ["g", "h"] }], "match", false), ["m1", "m2"]), [1, 2], "team v team: one group per match (unchanged)");
ok(scrambleTeeGroups([...pairs(1), T("t9", [])], "field", false).has("t9") === false, "an empty team gets no group");

// --- the Teams screen ---
const names = ["Raj", "Nihar", "Karan", "Sam", "Amit", "Vikram"];
const mk = (tee: (i: number) => number | null) => names.map((n, i) => ({ id: `id${i}`, user_id: `p${i}`, display_name: n, course_handicap: 5 + i * 3, course_handicap_source: "manual", scores: [], no_show: false, tee_group: tee(i) } as unknown as Player));
const game = (fs: ScrambleGroup[], extra: Record<string, unknown> = {}) => ({ id: "g", game_type: "scramble", scramble_mode: "field", scramble_team_size: 2, scramble_handicap: "usga", holes_meta: Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 })), course_par: 72, foursomes: fs, status: "setup", ...extra } as unknown as Game);
{
  let saved: ScrambleGroup[] | null = null;
  const t = renderScreen(<ScrambleTeamsBuilder game={game(pairs(3))} players={mk((i) => (i < 4 ? 1 : 2))} readOnly={false} onSave={(g) => { saved = g; }} />);
  const groupsShown = [...t.el.querySelectorAll("[data-scramble-group]")].map((g) => `${g.getAttribute("data-scramble-group")}: ${[...g.querySelectorAll("[data-scramble-group-team]")].map((x) => x.getAttribute("data-scramble-group-team")).join("+")}`);
  eq(groupsShown, ["Group 1: Team 1+Team 2", "Group 2: Team 3"], "the screen shows the SAVED groups");
  const opts = (team: string) => [...(t.el.querySelector(`[aria-label="Group for ${team}"]`) as HTMLSelectElement).options].map((o) => o.textContent);
  eq(opts("Team 3"), ["Group 2"], "Team 3 can't join the full Group 1 and is already on its own");
  eq(opts("Team 1"), ["Group 1", "Group 2", "Own group"], "Team 1 can move to Group 2 (room for 2) or its own group");
  ok((t.el.textContent || "").includes("share one scorecard"), "the screen says what a group means");
  const sel = t.el.querySelector('[aria-label="Group for Team 1"]') as HTMLSelectElement;
  act(() => { sel.value = "new"; sel.dispatchEvent(new Event("change", { bubbles: true })); });
  ok(!!saved, "moving a team saves");
  const after = scrambleTeeGroups(saved!, "field", false);
  eq(seq(after, ["t1", "t2", "t3"]), [1, 2, 3], "Team 1 to its own group: every team pinned, then renumbered");
  ok(saved!.every((g) => typeof g.tee === "number"), "every team's group is pinned, so later team edits keep the plan");
  t.unmount();
}
{
  const four = [T("t1", ["p0", "p1", "p2", "p3"]), T("t2", ["p4", "p5"])];
  const t = renderScreen(<ScrambleTeamsBuilder game={game(four, { scramble_team_size: null })} players={mk((i) => (i < 4 ? 1 : 2))} readOnly={false} onSave={() => {}} />);
  ok(!!t.el.querySelector("[data-scramble-groups]"), "shown when any team is 2 or fewer");
  t.unmount();
  const big = [T("t1", ["p0", "p1", "p2"]), T("t2", ["p3", "p4", "p5"])];
  const u = renderScreen(<ScrambleTeamsBuilder game={game(big, { scramble_team_size: 3 })} players={mk((i) => (i < 3 ? 1 : 2))} readOnly={false} onSave={() => {}} />);
  ok(!u.el.querySelector("[data-scramble-groups]"), "hidden when every team fills a group on its own");
  u.unmount();
  const v = renderScreen(<ScrambleTeamsBuilder game={game([{ id: "m1", name: "Match 1", a: ["p0", "p1"], b: ["p2", "p3"] }], { scramble_mode: "match" })} players={mk(() => 1)} readOnly={false} onSave={() => {}} />);
  ok(!v.el.querySelector("[data-scramble-groups]"), "hidden in team v team (a match is its group)");
  v.unmount();
  const caps = [T("t1", ["p0"]), T("t2", ["p1"]), T("t3", ["p2"])];
  const w = renderScreen(<ScrambleTeamsBuilder game={game(caps, { scramble_team_size: 1 })} players={mk((i) => (i < 3 ? i + 1 : null)).slice(0, 3)} readOnly={false} onSave={() => {}} />);
  eq([...w.el.querySelectorAll("[data-scramble-group]")].length, 3, "captains: three groups, one each");
  ok((w.el.querySelector('[data-scramble-group="Group 1"]')?.textContent || "").includes("1 team") && (w.el.textContent || "").includes("Up to 4 teams a group"), "captains: counted as teams, not players");
  eq([...(w.el.querySelector('[aria-label="Group for Team 2"]') as HTMLSelectElement).options].map((o) => o.textContent), ["Group 1", "Group 2", "Group 3"], "captains: any captain can join another");
  w.unmount();
}

// --- one card for the whole group ---
{
  const fs = pairs(2);
  const ps = mk(() => 1).slice(0, 4);
  const sc = renderScreen(<GroupScorecard game={{ ...game(fs), status: "active" } as Game} players={ps} allPlayers={ps} user={{ id: "p0" } as never} isMarker markerName={null} onTakeOver={() => {}} onRelease={() => {}} onSetHole={() => {}} altShotScores={[] as never} />);
  const heads = [...sc.el.querySelectorAll("[data-scramble-team-header]")].map((h) => h.textContent || "");
  ok(heads.length === 2 && heads[0].includes("Team 1") && heads[1].includes("Team 2"), `the group's card shows both teams (got ${heads.length})`);
  sc.unmount();
}
report("scramble groups");
