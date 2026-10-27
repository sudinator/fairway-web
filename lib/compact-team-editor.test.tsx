/** 212.44 — the compact team card (owner, Oct 26): one row per player, each side's name, colour and strength at the top,
 * the same actions as the full editor. Used in Create's Teams step and Manage Game's Teams tab. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { CompactTeamEditor } from "@/components/game/compact-team-editor";
import { TEAM_COLOR_BY_NAME, readableInk, contrastRatio } from "@/lib/game-colors";
import type { Game, Player } from "@/lib/game-types";

const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const game = { id: "g", game_type: "fourball", teams: [{ key: "A", name: "Reds", color: "red" }, { key: "B", name: "Blues", color: null }], holes_meta: holes, course_par: 72, allowance_pct: 100, foursomes: [] } as unknown as Game;
const P = (i: number, name: string, ch: number, team: string | null, scored = false) => ({ id: `p${i}`, user_id: `u${i}`, display_name: name, course_handicap: ch, course_handicap_source: "manual", team, no_show: false, scores: scored ? [4, ...Array(17).fill(null)] : [] } as unknown as Player);
const players = [P(1, "Raj", 4, "A"), P(2, "Sam", 22, "B"), P(3, "Bo", 9, "A", true), P(4, "Lex", 17, null)];
(async () => {
  const moves: [string, string | null][] = [], names: [string, string][] = []; let cleared = 0;
  const t = renderScreen(<CompactTeamEditor game={game} players={players} onSetTeam={async (p, team) => { moves.push([p.display_name, team]); }}
    onRenameTeams={async (n) => { names.push(n); }} onSetTeamColours={() => {}} onStartOver={async () => { cleared++; }}
    isBlocked={(p) => ((p.scores || []).some((x) => x != null) ? `${p.display_name} has scores` : null)} />);
  const sum = [...t.el.querySelectorAll("[data-team-summary]")].map((x) => x.textContent || "");
  ok(sum.length === 2 && sum[0].includes("2 players · plays 13") && sum[1].includes("1 player · plays 22"), `each side's players and total playing handicap (got ${JSON.stringify(sum)})`);
  const order = () => [...t.el.querySelectorAll("[data-compact-player]")].map((r) => r.getAttribute("data-compact-player")).join(",");
  ok(order() === "Bo,Lex,Raj,Sam" && (t.el.querySelector('[data-compact-player="Lex"]')?.textContent || "").includes("no team yet"), `players are listed alphabetically by first name; a player with no team is marked (got ${order()})`);
  const btn = (who: string, team: string) => [...t.el.querySelectorAll(`[data-compact-player="${who}"] button`)].find((b) => b.textContent === team) as HTMLButtonElement;
  await act(async () => { btn("Lex", "Blues").click(); });
  await act(async () => { btn("Raj", "Reds").click(); });   // tap the team you're on → clears
  ok(JSON.stringify(moves) === JSON.stringify([["Lex", "B"], ["Raj", null]]), `assign, and tap again to clear (got ${JSON.stringify(moves)})`);
  ok(order() === "Bo,Lex,Raj,Sam", "assigning or clearing a team never moves anyone in the list (owner, Oct 26)");
  ok(btn("Bo", "Blues").disabled && btn("Bo", "Reds").disabled, "a player with scores can't change team");
  ok(!!t.el.querySelector('button[aria-label^="Choose Blues"]') && !!t.el.querySelector("[data-edit-names]"), "each side has its colour dot, and the names an Edit button");
  // rename: Edit → type → Save; nothing changes until Save, and an emptied name keeps the old one (owner, Oct 26)
  await act(async () => { (t.el.querySelector("[data-edit-names]") as HTMLButtonElement).click(); });
  const nameInput = t.el.querySelector('input[aria-label="New name for Blues"]') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setter.call(nameInput, ""); nameInput.dispatchEvent(new Event("input", { bubbles: true })); });
  ok((t.el.querySelector('input[aria-label="New name for Blues"]') as HTMLInputElement).value === "" && names.length === 0, "an emptied name stays empty while editing, and nothing is saved yet");
  await act(async () => { setter.call(nameInput, "Navy"); nameInput.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { (t.el.querySelector("[data-save-names]") as HTMLButtonElement).click(); });
  ok(JSON.stringify(names.at(-1)) === JSON.stringify(["Reds", "Navy"]), `Save renames, keeping the other side (got ${JSON.stringify(names.at(-1))})`);
  await act(async () => { (t.el.querySelector("[data-edit-names]") as HTMLButtonElement).click(); });
  await act(async () => { const inp = t.el.querySelector('input[aria-label="New name for Reds"]') as HTMLInputElement; setter.call(inp, "   "); inp.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { (t.el.querySelector("[data-save-names]") as HTMLButtonElement).click(); });
  ok(names.at(-1)?.[0] === "Reds", "saving a blank name keeps the old one");
  await act(async () => { (t.el.querySelector("[data-teams-start-over]") as HTMLButtonElement).click(); });
  ok(cleared === 1, "Start over clears the teams");
  t.unmount();
  // a selected team button is readable on EVERY team colour (14px bold = large text: 3:1). Dark text on red, purple,
  // navy and maroon fell short before (the contrast guard found it).
  const worst = Object.entries(TEAM_COLOR_BY_NAME).map(([k, hex]) => [k, contrastRatio(readableInk(hex), hex)] as const).sort((a, b) => a[1] - b[1])[0];
  ok(worst[1] >= 3, `every team colour's button text reads at 3:1 or better (worst: ${worst[0]} ${worst[1].toFixed(2)}:1)`);
  ok(Math.abs(contrastRatio("#000000", "#FFFFFF") - 21) < 0.01, "the contrast formula is the WCAG one (black on white = 21:1)");
  report("compact team editor");
})();
