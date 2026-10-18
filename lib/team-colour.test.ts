function eq(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
import { teamColour, TEAM_COLOR_BY_NAME, TEAM_PALETTE } from "./game-colors";
// 209.1 owner rule: a team named after a colour gets that colour, always; a chosen colour applies only otherwise.
eq(teamColour({ name: "Red", color: "teal" }, 0), TEAM_COLOR_BY_NAME.red, "a team named Red is red, whatever was picked");
eq(teamColour({ name: "blue " }, 1), TEAM_COLOR_BY_NAME.blue, "name match ignores case and spaces");
eq(teamColour({ name: "Gold Diggers", color: "purple" }, 0), TEAM_COLOR_BY_NAME.purple, "a non-colour name uses the chosen colour");
eq(teamColour({ name: "Gold Diggers" }, 0), "#5AA9E6", "no choice: first team blue, as before");
eq(teamColour({ name: "Purple Haze" }, 1), "#E0915B", "no choice: second team orange, as before");
eq(teamColour({ name: "Eagles", color: "white" }, 0), "#5AA9E6", "a colour outside the eight is ignored");
eq(TEAM_PALETTE.length, 8, "eight colours");
eq(TEAM_PALETTE.some((p) => p.key === "white"), false, "no white");
console.log("team-colour tests passed");
