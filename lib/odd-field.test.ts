/** 212.45 (owner, Oct 26) — an odd field in four-ball or trifecta plays ONE 2 v 1 group, scored as before; alternate
 * shot needs two a side. One rule (lib/grouping) for Create, the Groups editor, Review and Manage Game. */
import { ok, report } from "./screen-harness";
import { allowsOneShortGroup, teamSizesFitGroups, groupShapesOk, groupShapeOk, balancedTeamGroups, balancedTeamMatchups } from "@/lib/grouping";
import { teamGroupLineupProblem } from "@/lib/one-step-create";

ok(allowsOneShortGroup("fourball") && allowsOneShortGroup("trifecta") && !allowsOneShortGroup("alt_shot") && !allowsOneShortGroup("scramble"), "four-ball and trifecta allow one 2 v 1; alternate shot and scramble don't");
const fits: [string, number, number, boolean][] = [["fourball", 4, 4, true], ["fourball", 4, 3, true], ["fourball", 3, 4, true], ["trifecta", 6, 5, true], ["fourball", 2, 1, true],
  ["fourball", 5, 4, false], ["fourball", 3, 3, false], ["fourball", 4, 2, false], ["alt_shot", 4, 3, false], ["alt_shot", 4, 4, true], ["fourball", 0, 0, false]];
for (const [t, a, b, want] of fits) ok(teamSizesFitGroups(t, a, b) === want, `${t} ${a} v ${b}: groups ${want ? "open" : "stay locked"}`);
ok(groupShapesOk("fourball", [[2, 2], [2, 1]]) && groupShapesOk("trifecta", [[1, 2], [2, 2]]), "one 2 v 1 group is fine in four-ball and trifecta");
ok(!groupShapesOk("fourball", [[2, 1], [1, 2]]) && !groupShapesOk("fourball", [[2, 2], [1, 1]]) && !groupShapesOk("fourball", [[3, 1]]), "two short groups, a 1 v 1 or a 3 v 1 are not");
ok(!groupShapesOk("alt_shot", [[2, 2], [2, 1]]), "alternate shot: no 2 v 1");
ok(groupShapeOk("fourball", 2, 1, 1) && !groupShapeOk("fourball", 2, 1, 2), "a single group's badge: ready as the only short group, not as one of two");
const f = [4, 7, 9, 12, 15, 17, 20].map((ph, i) => ({ id: `p${i}`, team: i < 4 ? "A" : "B", playingHandicap: ph }));
for (const [name, build] of [["even groups", balancedTeamGroups], ["balanced matchups", balancedTeamMatchups]] as const) {
  const off = build(f, ["A", "B"]), on = build(f, ["A", "B"], { oneShortGroup: true });
  ok(off.unassignedIds.length === 3, `${name}: without the option, the odd three stay unassigned (as before)`);
  const g2 = on.assignments.filter((a) => a.group === 2).map((a) => f.find((p) => p.id === a.playerId)!.team).sort().join("");
  ok(on.unassignedIds.length === 0 && g2 === "AAB", `${name}: with it, the leftover two and one make group 2 (got ${g2})`);
}
const pl = (team: string | null, g: number | null, i: number) => ({ id: `x${i}`, display_name: `P${i}`, team, tee_group: g });
const seven = [pl("A", 1, 1), pl("A", 1, 2), pl("B", 1, 3), pl("B", 1, 4), pl("A", 2, 5), pl("A", 2, 6), pl("B", 2, 7)];
const fs = [{ id: "g1", name: "Group 1", a: ["x1", "x2"], b: ["x3", "x4"], a_first: "x1", b_first: "x3" }, { id: "g2", name: "Group 2", a: ["x5", "x6"], b: ["x7"], a_first: "x5", b_first: "x7" }];
ok(teamGroupLineupProblem("fourball", seven, fs) === null, "Review: a 7-player four-ball with one 2 v 1 group is ready");
ok(teamGroupLineupProblem("trifecta", seven, fs) === null, "Review: the same in trifecta");
ok((teamGroupLineupProblem("alt_shot", seven, fs) || "").includes("even number"), "Review: alternate shot with 7 says it needs an even number");
report("odd field");
