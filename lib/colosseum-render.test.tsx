/** 212.136 — the Colosseum on the game screen: the table, the "my matches" strip, the tap-through, and the recap body. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { ColosseumView } from "@/components/game/colosseum-view";
import { RecapBody } from "@/components/game/recap-body";
import { buildRecap } from "@/lib/game-recap";
import type { Game, Player } from "@/lib/game-types";

const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const par = Array(18).fill(4) as number[];
const mk = (id: string, name: string, ch: number, scores: (number | null)[], group: number, team: string | null = null) =>
  ({ id, user_id: `u-${id}`, display_name: name, course_handicap: ch, course_handicap_source: "manual", scores, tee_group: group, team, no_show: false, putts: [], fairways: [] } as unknown as Player);
const players = [
  mk("a", "Amit", 9, par, 1), mk("b", "Raj", 12, [3, 3, 3, ...par.slice(3)], 1),
  mk("c", "Dave", 14, [5, 5, 5, ...par.slice(3)], 2), mk("d", "Pete", 22, Array(18).fill(6), 2),
];
const game = (extra: Record<string, unknown> = {}) => ({ id: "g", code: "100001", name: "Colosseum", course: "C", game_type: "colosseum", holes_meta: holes, course_par: 72, status: "active", allowance_pct: 100, pairings: [], teams: null, foursomes: null, created_by: "u-a", ...extra } as unknown as Game);

async function main() {
  const r = renderScreen(<ColosseumView game={game()} players={players} user={{ id: "u-a" }} />);
  await act(async () => { await new Promise((res) => setTimeout(res, 5)); });
  const el = r.el;
  ok(!!el.querySelector("[data-colosseum-board]") && el.querySelectorAll("[data-colosseum-row]").length === 4, "the table has one row per player");
  ok((el.textContent || "").includes("4 PLAYERS · 6 MATCHES"), `the eyebrow counts the matches (${(el.textContent || "").slice(0, 80)})`);
  const strip = el.querySelector("[data-colosseum-mine]");
  ok(!!strip && (strip.textContent || "").includes("My matches"), "the signed-in player's strip is above the table");
  // Raj (three birdies, 12 strokes) beats everyone; Pete (all 6s, 22 strokes) — the first row is Raj
  const first = el.querySelector("[data-colosseum-row]");
  ok(!!first && (first.textContent || "").includes("Raj"), `Raj leads the table (first row: ${first?.textContent})`);
  ok(Array.from(el.querySelectorAll("[data-colosseum-board] thead th")).map((t) => t.textContent).join(" ") === "Pos Player W L H Pts Holes", "the columns read W-L-H, as the recap and the game list print the record");
  ok(!!el.querySelector("[data-colosseum-back]") === false, "no back button on the table");
  // tap a name → that player's matches, and back
  await act(async () => { first?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  ok(!!el.querySelector("[data-colosseum-player='u-b']") && el.querySelectorAll("[data-colosseum-match]").length === 3, "tapping Raj opens his three matches");
  ok((el.textContent || "").includes("gives 3") || (el.textContent || "").includes("gets 3"), "the stakes line names the handicap difference");
  await act(async () => { el.querySelector("[data-colosseum-back]")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  ok(!!el.querySelector("[data-colosseum-board]"), "back to the table");

  // a Cup / team Colosseum shows the sides' score and only cross-side matches
  const cupPlayers = players.map((p, i) => ({ ...p, team: i < 2 ? "A" : "B" }));
  const r2 = renderScreen(<ColosseumView game={game({ teams: [{ key: "A", name: "Reds" }, { key: "B", name: "Blues" }] })} players={cupPlayers} user={{ id: "u-a" }} />);
  await act(async () => { await new Promise((res) => setTimeout(res, 5)); });
  ok((r2.el.textContent || "").includes("4 MATCHES") && !!r2.el.querySelector("[data-colosseum-sides]"), "2 v 2 is four matches and the sides' score shows");
  ok((r2.el.querySelector("[data-colosseum-sides]")?.textContent || "").includes("Reds") && (r2.el.querySelector("[data-colosseum-sides]")?.textContent || "").includes("Blues"), "the sides are named");

  // the recap: table section, headline, and the Cup headline for a team Colosseum
  const ended = game({ status: "ended" });
  const recap = buildRecap(ended, players, []);
  ok(recap.headline.startsWith("Raj won the Colosseum"), `recap headline (got ${recap.headline})`);
  const sections = recap.sections;
  ok(!!sections.colosseum && sections.colosseum.rows.length === 4 && sections.colosseum.matches === 6, "the recap carries the table");
  const body = renderScreen(<RecapBody game={ended} recap={recap} mode="share" />);
  await act(async () => { await new Promise((res) => setTimeout(res, 5)); });
  ok(!!body.el.querySelector("[data-recap-colosseum]") && (body.el.textContent || "").includes("COLOSSEUM · THE TABLE"), "the recap body renders the table block");
  const cupRecap = buildRecap(game({ status: "ended", teams: [{ key: "A", name: "Reds" }, { key: "B", name: "Blues" }] }), cupPlayers, []);
  ok(/Reds|Blues/.test(cupRecap.headline) && /beat|tied/.test(cupRecap.headline), `a team Colosseum's headline is the sides' score (got ${cupRecap.headline})`);
  report("colosseum render");
}
main().catch((e) => { console.error(e); process.exit(1); });
