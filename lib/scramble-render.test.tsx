/** 211.1 — scramble results, the results view and the Teams screen. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { scrambleResults } from "@/lib/scramble-game";
import { ScrambleView } from "@/components/game/scramble-view";
import { ScrambleTeamsBuilder } from "@/components/game/scramble-teams-builder";
import { RecapBody } from "@/components/game/recap-body";
import { ScrambleSettings } from "@/components/game/scramble-settings";
import { strokeSets } from "@/lib/game-shape";
import { buildRecap } from "@/lib/game-recap";
import { scrambleRowValue } from "@/lib/scramble-game";
import type { Game, Player } from "@/lib/game-types";

const par = [4, 5, 3, 4, 4, 3, 4, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4], si = [7, 3, 17, 1, 11, 15, 5, 9, 13, 8, 2, 18, 4, 12, 6, 16, 10, 14];
const holes = par.map((p, i) => ({ n: i + 1, par: p, si: si[i] }));
const CH: Record<string, number> = { Raj: 4.2, Nihar: 9.8, Karan: 14.6, Sam: 22.4, Amit: 6.1, Vikram: 11.3, Probir: 16.9, Hp: 24.8 };
const players = Object.entries(CH).map(([n, ch], i) => ({ id: `p${i}`, user_id: `u-${n}`, display_name: n, course_handicap: ch, course_handicap_source: "manual", scores: [], no_show: false } as unknown as Player));
const groups = [{ id: "team-1", name: "Team 1", a: ["u-Raj", "u-Nihar", "u-Karan", "u-Sam"], b: [] }, { id: "team-2", name: "Team 2", a: ["u-Amit", "u-Vikram", "u-Probir", "u-Hp"], b: [] }];
const red = [4, 4, 3, 3, 4, 3, 4, 4, 4, 3, 4, 3, 4, 4, 3, 3, 4, 4], blue = [4, 4, 2, 4, 3, 3, 4, 5, 3, 4, 3, 3, 4, 3, 4, 2, 4, 4];
const rows = [...red.map((s, i) => ({ game_id: "g", foursome_id: "team-1", side: "a" as const, hole_index: i, strokes: s })), ...blue.map((s, i) => ({ game_id: "g", foursome_id: "team-2", side: "a" as const, hole_index: i, strokes: s }))];
const game = (extra: Record<string, unknown> = {}) => ({ id: "g", game_type: "scramble", holes_meta: holes, course_par: 72, status: "active", scramble_team_size: 4, scramble_mode: "field", scramble_handicap: "usga", foursomes: groups, ...extra } as unknown as Game);

// results: Team 1's handicap is Red's 7 (1.05 + 1.96 + 2.19 + 2.24 = 7.44), Team 2's 9
const r = scrambleResults(game(), players, rows);
ok(r.teams.map((t) => t.handicap).join(",") === "7,9", `team handicaps 7 and 9 (got ${r.teams.map((t) => t.handicap)})`);
ok(r.board[0].name === "Team 2" && r.board[0].net === 63 - 9 && r.board[1].net === 65 - 7, `Team 2 leads net 54 v 58 (got ${r.board.map((b) => b.name + " " + b.net)})`);
const gross = scrambleResults(game({ scramble_handicap: "gross" }), players, rows);
ok(gross.teams.every((t) => t.handicap === 0) && gross.board[0].gross === 63, "gross: no strokes, lowest gross leads");
const mg = game({ scramble_mode: "match", foursomes: [{ id: "match-1", name: "Match 1", a: groups[0].a, b: groups[1].a }] });
const m = scrambleResults(mg, players, [...rows.filter((x) => x.foursome_id === "team-1").map((x) => ({ ...x, foursome_id: "match-1" })), ...rows.filter((x) => x.foursome_id === "team-2").map((x) => ({ ...x, foursome_id: "match-1", side: "b" as const }))]);
ok(m.matches.length === 1 && /^Team (1|2) (won|\\d+ UP)|All square|Halved/.test(m.matches[0].line), `the match has a status line (got ${m.matches[0]?.line})`);

// the results view
{
  const t = renderScreen(<ScrambleView game={game()} players={players} altShotScores={rows as never} />);
  const txt = t.el.textContent || "";
  ok(!!t.el.querySelector("[data-scramble-board]") && txt.includes("SCRAMBLE · LEADERBOARD · NET") && txt.includes("Raj, Nihar, Karan, Sam"), "leaderboard with team members");
  ok(txt.includes("don't count as anyone's individual round"), "says scramble scores aren't individual rounds");
  t.unmount();
  const tm = renderScreen(<ScrambleView game={mg} players={players} altShotScores={[]} />);
  ok(!!tm.el.querySelector("[data-scramble-match]") && (tm.el.textContent || "").includes("Not started"), "team v team: matches, not started yet");
  tm.unmount();
}
// the Teams screen: handicap breakdown and balancing
{
  let saved: unknown = null;
  const t = renderScreen(<ScrambleTeamsBuilder game={game()} players={players} readOnly={false} onSave={(g) => { saved = g; }} />);
  const txt = t.el.textContent || "";
  ok(txt.includes("Team handicap 7") && txt.includes("4.2 × 25% = 1.1") && txt.includes("7.44, rounded to 7"), `handicap breakdown shown (${txt.slice(0, 200)})`);
  const btn = Array.from(t.el.querySelectorAll("button")).find((b) => b.textContent === "4 players") as HTMLButtonElement;
  btn.click();
  ok(Array.isArray(saved) && (saved as unknown[]).length === 2, "balanced teams of 4: two teams of four");
  (Array.from(t.el.querySelectorAll("button")).find((b) => b.textContent === "2 players") as HTMLButtonElement).click();
  ok(Array.isArray(saved) && (saved as any[]).length === 4 && (saved as any[]).every((g) => g.a.length === 2), `balanced teams of 2: four teams of two (got ${JSON.stringify(saved)?.slice(0, 120)})`);
  ok((t.el.textContent || "").includes("Team 1 · 4 players (full)"), "each team shows its player count, full at 4");
  t.unmount();
  const empty = renderScreen(<ScrambleTeamsBuilder game={game({ foursomes: [] })} players={players} readOnly={false} onSave={() => {}} />);
  ok((empty.el.textContent || "").includes("MAKE BALANCED TEAMS OF") && (empty.el.textContent || "").includes("Make the teams — Setup → Teams."), "no teams yet: says so, offers balanced teams of 2, 3 or 4");
  empty.unmount();
}
// the recap
{
  const rc = buildRecap(game({ status: "ended" }), players, rows as never);
  ok(rc.headline === "Team 2 wins the scramble — net 54", `recap headline (got ${rc.headline})`);
  ok(rc.personal["u-Amit"] === "Your team (Team 2) finished 1st, net 54" && rc.personal["u-Raj"] === "Your team (Team 1) finished 2nd, net 58", `personal lines (got ${JSON.stringify(rc.personal)})`);
  ok(rc.sections.individualStats === false && rc.sections.scramble?.rows.length === 2, "scramble section; no individual stats");
  ok(rc.sections.scramble?.rows[0].pos === "1" && scrambleRowValue(rc.sections.scramble!.rows[0], false) === "net 54 (63 − 9)", "row wording: net 54 (63 − 9)");
  const g = buildRecap(game({ status: "ended", scramble_handicap: "gross" }), players, rows as never);
  ok(g.headline === "Team 2 wins the scramble — gross 63", `gross headline (got ${g.headline})`);
  const empty = buildRecap(game({ status: "ended" }), players, []);
  ok(empty.headline === "Scramble — no scores yet", `no scores yet (got ${empty.headline})`);
  const t = renderScreen(<RecapBody game={game({ status: "ended" })} recap={rc} mode="share" />);
  ok((t.el.querySelector("[data-recap-scramble]")?.textContent || "").includes("net 54 (63 − 9)"), "the recap shows the scramble leaderboard");
  t.unmount();
}
// 211.7 — Setup → Format: a scramble's own settings
{
  const calls: unknown[] = [];
  (globalThis as any).confirm = () => true; if (typeof window !== "undefined") (window as any).confirm = () => true;
  const t = renderScreen(<ScrambleSettings game={game()} locked={false} onSave={(p, c) => { calls.push([p, c]); }} />);
  const b = (label: string) => Array.from(t.el.querySelectorAll("button")).find((x) => x.textContent === label) as HTMLButtonElement;
  ok(!Array.from(t.el.querySelectorAll("button")).some((x) => /^[234] players$/.test(x.textContent || "")), "no team-size setting in Format any more");
  b("Agreed handicaps").click();
  ok(JSON.stringify(calls[0]) === JSON.stringify([{ scramble_handicap: "agreed" }, false]), `handicaps: saved, teams kept (got ${JSON.stringify(calls[0])})`);
  b("Captains only").click();
  ok(JSON.stringify(calls[1]) === JSON.stringify([{ scramble_team_size: 1, scramble_handicap: "agreed" }, true]), `captains only: agreed handicaps, teams cleared (got ${JSON.stringify(calls[1])})`);
  ok(!Array.from(t.el.querySelectorAll("button")).some((x) => x.textContent === "Gross" || x.textContent === "Gross only"), "gross is no longer offered");
  t.unmount();
  const l = renderScreen(<ScrambleSettings game={game()} locked onSave={() => { calls.push("locked"); }} />);
  (Array.from(l.el.querySelectorAll("button")).find((x) => x.textContent === "Captains only") as HTMLButtonElement).click();
  ok(!calls.includes("locked") && (l.el.textContent || "").includes("Scoring has started"), "locked once scoring starts");
  l.unmount();
}
// 211.9 — USGA with the game's own percentages; agreed handicaps; captains only; picking teams yourself
{
  const custom = scrambleResults(game({ scramble_allowance: { "4": [30, 20, 15, 10] } }), players, rows);
  ok(custom.teams[0].handicap === 8, `custom 30/20/15/10: Team 1 = 1.26 + 1.96 + 2.19 + 2.24 = 7.65 → 8 (got ${custom.teams[0].handicap})`);
  const agreed = scrambleResults(game({ scramble_handicap: "agreed", foursomes: [{ ...groups[0], a_hcp: 12 }, groups[1]] }), players, rows);
  ok(agreed.teams.map((x) => x.handicap).join(",") === "12,0", `agreed: 12 entered, blank plays scratch (got ${agreed.teams.map((x) => x.handicap)})`);
  ok(scrambleResults(game({ foursomes: [{ ...groups[0], a_hcp: 12 }, groups[1]] }), players, rows).teams[0].handicap === 7, "USGA: a leftover entered number is not used — the method decides");
  const two = players.filter((p) => p.display_name === "Raj" || p.display_name === "Amit");
  const cg = game({ scramble_team_size: 1, scramble_handicap: "agreed", foursomes: [{ id: "team-1", name: "Team 1", a: ["u-Raj"], b: [] }, { id: "team-2", name: "Team 2", a: ["u-Amit"], b: [], a_hcp: 6 }] });
  let saved: any = null;
  const tb = renderScreen(<ScrambleTeamsBuilder game={cg} players={two} readOnly={false} onSave={(g) => { saved = g; }} />);
  const txt = tb.el.textContent || "";
  ok(txt.includes("Captains only") && txt.includes("Raj · captain") && txt.includes("Scratch (no handicap entered)") && txt.includes("Team handicap 6"), `captains only on the Teams screen (${txt.slice(0, 200)})`);
  const input = tb.el.querySelector('input[aria-label="Team 1 team handicap"]') as HTMLInputElement;
  input.value = "9"; input.dispatchEvent(new Event("focusout", { bubbles: true }));
  ok(saved && saved[0].a_hcp === 9 && saved[1].a_hcp === 6, `typing 9 saves Team 1's agreed handicap (got ${JSON.stringify(saved)})`);
  tb.unmount();
  // pick teams myself: empty teams, then Add to… from "Not on a team yet"
  let picked: any = null;
  const pk = renderScreen(<ScrambleTeamsBuilder game={game({ foursomes: [] })} players={players} readOnly={false} onSave={(g) => { picked = g; }} />);
  (Array.from(pk.el.querySelectorAll("button")).find((b) => b.textContent === "Pick teams myself") as HTMLButtonElement).click();
  ok(Array.isArray(picked) && picked.length === 2 && picked.every((g: any) => !g.a.length), `pick teams myself: two empty teams for eight players (got ${JSON.stringify(picked)?.slice(0, 120)})`);
  pk.unmount();
  let added: any = null;
  const ad = renderScreen(<ScrambleTeamsBuilder game={game({ foursomes: picked })} players={players} readOnly={false} onSave={(g) => { added = g; }} />);
  ok(!!ad.el.querySelector("[data-scramble-unplaced]") && (ad.el.textContent || "").includes("NOT ON A TEAM YET"), "everyone is listed as not on a team yet");
  const sel = ad.el.querySelector('select[aria-label="Add Raj to a team"]') as HTMLSelectElement;
  sel.value = "1"; sel.dispatchEvent(new Event("change", { bubbles: true }));
  ok(added && added[1].a.includes("u-Raj") && !added[0].a.includes("u-Raj"), `Add to… Team 2 puts Raj on Team 2 (got ${JSON.stringify(added)?.slice(0, 160)})`);
  ad.unmount();
  const full = [{ id: "t1", name: "Team 1", a: ["u-Raj", "u-Nihar", "u-Karan", "u-Sam"], b: [] }, { id: "t2", name: "Team 2", a: ["u-Amit", "u-Vikram", "u-Probir"], b: [] }];
  const fu = renderScreen(<ScrambleTeamsBuilder game={game({ foursomes: full })} players={players} readOnly={false} onSave={() => {}} />);
  const opts = Array.from((fu.el.querySelector('select[aria-label="Add Hp to a team"]') as HTMLSelectElement).options).map((o) => o.textContent);
  ok(!opts.some((o) => (o || "").startsWith("Team 1")) && opts.some((o) => (o || "").startsWith("Team 2")), `a full team (4) isn't offered in Add to… (got ${opts})`);
  ok((fu.el.textContent || "").includes("Teams of different sizes: Team 1 has 4 players"), "mixed sizes are noted");
  fu.unmount();
}
// 212.1 — the team's strokes, never a player's own: a team whose FIRST player is a 24.8 used to show that
// player's ~25 strokes (one on every hole, two on several). The team's handicap here is 9.
{
  const hiFirst = game({ foursomes: [{ id: "t1", name: "Team 1", a: ["u-Hp", "u-Amit", "u-Vikram", "u-Probir"], b: [] }] });
  const first = players.find((p) => p.display_name === "Hp")!;
  const sets = holes.map((h) => strokeSets(hiFirst as never, first as never, h.si, players as never));
  ok(sets.every((ss) => ss.length === 1 && ss[0].key === "team"), `only the team's strokes are drawn — no personal course-handicap set (got ${JSON.stringify(sets[0])})`);
  const total = sets.reduce((a, ss) => a + ss[0].strokes, 0);
  ok(total === 9, `the team's 9 strokes across 18 holes, not the first player's ~25 (got ${total})`);
  ok(sets.every((ss) => ss[0].strokes <= 1), "no hole gets two strokes at a team handicap of 9");
}
report("scramble screens");
