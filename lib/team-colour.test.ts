function eq(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
import { teamColour, TEAM_COLOR_BY_NAME, TEAM_PALETTE, pickTeamColour, isAutomaticColour } from "./game-colors";
// 209.1 owner rule: a team named after a colour gets that colour, always; a chosen colour applies only otherwise.
eq(teamColour({ name: "Red", color: "teal" }, 0), TEAM_COLOR_BY_NAME.red, "a team named Red is red, whatever was picked");
eq(teamColour({ name: "blue " }, 1), TEAM_COLOR_BY_NAME.blue, "name match ignores case and spaces");
eq(teamColour({ name: "Gold Diggers", color: "purple" }, 0), TEAM_COLOR_BY_NAME.purple, "a non-colour name uses the chosen colour");
eq(teamColour({ name: "Gold Diggers" }, 0), "#5AA9E6", "no choice: first team blue, as before");
eq(teamColour({ name: "Purple Haze" }, 1), "#D8B24A", "no choice: second team gold (209.4)");
eq(teamColour({ name: "Eagles", color: "white" }, 0), "#5AA9E6", "a colour outside the eight is ignored");
eq(TEAM_PALETTE.map((p) => p.key).join(","), "red,blue,gold,purple,green", "the five colours (209.4)");
eq(TEAM_PALETTE.some((p) => p.key === "white"), false, "no white");
// 209.4: picking the other team's colour swaps them; a colour-named team keeps its colour.
{
  const eagles = { name: "Eagles" }, hawks = { name: "Hawks" };
  eq(isAutomaticColour(eagles) && isAutomaticColour(hawks), true, "no choice yet: both automatic");
  const r = pickTeamColour([eagles, hawks], 0, "purple")!;
  eq(JSON.stringify(r), JSON.stringify({ colors: ["purple", null], swapped: false }), "a free colour is simply applied");
  const s = pickTeamColour([eagles, hawks], 0, "gold")!;   // Hawks are automatically gold
  eq(JSON.stringify(s), JSON.stringify({ colors: ["gold", "blue"], swapped: true }), "taking the other team's (automatic) colour swaps them");
  const t = pickTeamColour([{ name: "Eagles", color: "green" }, { name: "Hawks", color: "purple" }], 1, "green")!;
  eq(JSON.stringify(t), JSON.stringify({ colors: ["purple", "green"], swapped: true }), "taking a chosen colour swaps them");
  eq(pickTeamColour([{ name: "Red" }, { name: "Sharks" }], 1, "red"), null, "can't take a colour that is the other team's NAME");
  eq(pickTeamColour([{ name: "Red" }, { name: "Sharks" }], 0, "blue"), null, "a colour-named team's colour can't be changed");
  eq(pickTeamColour([eagles, hawks], 0, "orange"), null, "a colour outside the five is refused");
}
console.log("team-colour tests passed");
