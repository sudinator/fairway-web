function eq(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
import { autoGameName, refreshedAutoName } from "./game-create";
// 208.5: an automatic "Format / Course / Date" name follows a changed date or course; a typed name never changes.
const auto = autoGameName("fourball", "Francis Byrne", "2026-10-18");
const g = { name: auto, game_type: "fourball", course: "Francis Byrne", played_at: "2026-10-18" };
eq(refreshedAutoName(g, { date: "2026-10-25" }), autoGameName("fourball", "Francis Byrne", "2026-10-25"), "automatic name follows a new date");
eq(refreshedAutoName(g, { course: "Bowling Green" }), autoGameName("fourball", "Bowling Green", "2026-10-18"), "automatic name follows a new course");
eq(refreshedAutoName({ ...g, name: "Saturday Ryder Cup" }, { date: "2026-10-25" }), null, "a typed name is kept");
eq(refreshedAutoName({ ...g, name: "Four-Ball / Francis Byrne / with the boys" }, { date: "2026-10-25" }), null, "a typed name that only looks similar is kept");
// written on a phone set up for another country — still recognised as automatic
eq(refreshedAutoName({ ...g, name: "Four-Ball / Francis Byrne / 18 Oct 2026" }, { date: "2026-10-25" }), autoGameName("fourball", "Francis Byrne", "2026-10-25"), "a differently written date is still automatic");
eq(refreshedAutoName(g, { date: "2026-10-18" }), null, "no change, no rename");
console.log("game-name tests passed");
