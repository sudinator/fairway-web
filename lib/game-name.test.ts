function eq(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
import { autoGameName, refreshedAutoName } from "./game-create";
import { lineupDescription } from "./lineup-meta";
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
// 212.23 — the FORMAT is part of the automatic name
const sf = { name: autoGameName("stableford", "Francis Byrne", "2026-10-18"), game_type: "stableford", course: "Francis Byrne", played_at: "2026-10-18" };
eq(refreshedAutoName(sf, { gameType: "stroke" }), autoGameName("stroke", "Francis Byrne", "2026-10-18"), "a format change renames an automatic name");
// a name left behind by an earlier format change (still "Stableford / …" on a stroke play game) is recognised and repaired
eq(refreshedAutoName({ ...sf, game_type: "stroke" }, { gameType: "stroke" }), autoGameName("stroke", "Francis Byrne", "2026-10-18"), "a stale format name is repaired");
eq(refreshedAutoName({ ...sf, game_type: "stroke" }, { date: "2026-10-25" }), autoGameName("stroke", "Francis Byrne", "2026-10-25"), "…and on a date change too");
eq(refreshedAutoName({ ...sf, name: "Sunday Skins" }, { gameType: "stroke" }), null, "a typed name is kept on a format change");
eq(lineupDescription({ course: "Francis Byrne", players: [1, 2], game_type: "stroke" }).startsWith("Francis Byrne · 2 players · Stroke Play"), true, "the line-up link's description names the format properly");
console.log("game-name tests passed");
