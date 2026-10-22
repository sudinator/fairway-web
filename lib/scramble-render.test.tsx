/** 211.1 — scramble results, the results view and the Teams screen. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { scrambleResults } from "@/lib/scramble-game";
import { ScrambleView } from "@/components/game/scramble-view";
import { ScrambleTeamsBuilder } from "@/components/game/scramble-teams-builder";
import { RecapBody } from "@/components/game/recap-body";
import { ScrambleSettings } from "@/components/game/scramble-settings";
import { GroupScorecard } from "@/components/game/scorecard-views";
import { strokeSets } from "@/lib/game-shape";
import { buildRecap } from "@/lib/game-recap";
import { scrambleRowValue, scrambleFinishGaps } from "@/lib/scramble-game";
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
  ok(!!t.el.querySelector("[data-scramble-board]") && txt.includes("SCRAMBLE · LEADERBOARD · NET") && txt.includes("Raj · Nihar · Karan · Sam"), "leaderboard with team members");
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
  ok(rc.headline === "Team 2 wins the scramble — 54 net (63 gross, -18)", `recap headline (got ${rc.headline})`);
  ok(rc.personal["u-Amit"] === "Your team (Team 2) finished 1st, 54 net (63 gross, -18)" && rc.personal["u-Raj"] === "Your team (Team 1) finished 2nd, 58 net (65 gross, -14)", `personal lines (got ${JSON.stringify(rc.personal)})`);
  ok(rc.sections.individualStats === false && rc.sections.scramble?.rows.length === 2, "scramble section; no individual stats");
  ok(rc.sections.scramble?.rows[0].pos === "1" && scrambleRowValue(rc.sections.scramble!.rows[0], false) === "54 net (63 gross, -18)", "row wording: 54 net (63 gross, -18)");
  const g = buildRecap(game({ status: "ended", scramble_handicap: "gross" }), players, rows as never);
  ok(g.headline === "Team 2 wins the scramble — 63 gross (-9)", `gross headline (got ${g.headline})`);
  const empty = buildRecap(game({ status: "ended" }), players, []);
  ok(empty.headline === "Scramble — no scores yet", `no scores yet (got ${empty.headline})`);
  const t = renderScreen(<RecapBody game={game({ status: "ended" })} recap={rc} mode="share" />);
  // 212.15: the final leaderboard is a table — net (biggest), gross, ± — with the members on a full-width line
  const rowsEl = Array.from(t.el.querySelectorAll("[data-recap-scramble-row]"));
  const first = rowsEl[0]?.textContent || "";
  ok(rowsEl.length === 2 && first.includes("Team 2") && first.includes("54") && first.includes("63") && first.includes("-18"), `the final leaderboard: Team 2 · 54 · 63 · -18 (got ${first})`);
  ok(first.includes("Amit · Vikram · Probir · Hp"), `the members on their own line (got ${first})`);
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
  // 212.11 — the owner's layout: every player in one column with a team selector; the teams summarised below
  let placed: any = null;
  const pg = renderScreen(<ScrambleTeamsBuilder game={game({ foursomes: [] })} players={players} readOnly={false} onSave={(g) => { placed = g; }} />);
  ok(pg.el.querySelectorAll("[data-scramble-player]").length === players.length, "every player is listed in one column");
  const rajSel = pg.el.querySelector('select[aria-label="Team for Raj"]') as HTMLSelectElement;
  ok(Array.from(rajSel.options).map((o) => o.textContent).join("|") === "No team|New team", `no teams yet: No team / New team (got ${Array.from(rajSel.options).map((o) => o.textContent)})`);
  rajSel.value = "new"; rajSel.dispatchEvent(new Event("change", { bubbles: true }));
  ok(placed && placed.length === 1 && placed[0].a.join() === "u-Raj", `New team puts Raj on a new team (got ${JSON.stringify(placed)})`);
  pg.unmount();
  let moved: any = null;
  const twoTeams = [{ id: "t1", name: "Team 1", a: ["u-Raj", "u-Nihar"], b: [] }, { id: "t2", name: "Team 2", a: ["u-Karan"], b: [] }];
  const mv = renderScreen(<ScrambleTeamsBuilder game={game({ foursomes: twoTeams })} players={players} readOnly={false} onSave={(g) => { moved = g; }} />);
  ok((mv.el.querySelector('select[aria-label="Team for Raj"]') as HTMLSelectElement).value === "0", "a player's selector shows their team");
  const ks = mv.el.querySelector('select[aria-label="Team for Karan"]') as HTMLSelectElement;
  ks.value = "0"; ks.dispatchEvent(new Event("change", { bubbles: true }));
  ok(moved && moved.length === 1 && moved[0].a.join() === "u-Raj,u-Nihar,u-Karan", `moving Team 2's only player removes the empty team (got ${JSON.stringify(moved)})`);
  ok(!!mv.el.querySelector('[data-scramble-team="Team 1"]') && (mv.el.textContent || "").includes("TEAMS"), "the teams are summarised below the players");
  mv.unmount();
  const full = [{ id: "t1", name: "Team 1", a: ["u-Raj", "u-Nihar", "u-Karan", "u-Sam"], b: [] }, { id: "t2", name: "Team 2", a: ["u-Amit", "u-Vikram", "u-Probir"], b: [] }];
  const fu = renderScreen(<ScrambleTeamsBuilder game={game({ foursomes: full })} players={players} readOnly={false} onSave={() => {}} />);
  const opts = Array.from((fu.el.querySelector('select[aria-label="Team for Hp"]') as HTMLSelectElement).options).map((o) => o.textContent || "");
  ok(!opts.some((o) => o.startsWith("Team 1")) && opts.some((o) => o.startsWith("Team 2")), `a full team (4) can't be picked (got ${opts})`);
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
// 212.10 — an UNFINISHED round (owner, staging game 109487): team handicap 22, 15 holes played. The row shows the
// strokes actually taken on those 15 holes (not the 18-hole 22), the arithmetic adds up, and everything reads to par.
{
  const hiTeam = players.filter((p) => ["Sam", "Hp", "Probir", "Karan"].includes(p.display_name));   // course hcps 22.4, 24.8, 16.9, 14.6
  const pg = game({ status: "ended", scramble_handicap: "agreed", foursomes: [{ id: "t1", name: "Team 1", a: hiTeam.map((p) => p.user_id), b: [], a_hcp: 22 }] });
  const pr = red.slice(0, 15).map((st, i) => ({ game_id: "g", foursome_id: "t1", side: "a" as const, hole_index: i, strokes: st }));
  const rc = buildRecap(pg, hiTeam, pr as never);
  const row = rc.sections.scramble!.rows[0];
  const takenOn15 = holes.slice(0, 15).reduce((n, h) => n + (h.si <= 22 - 18 ? 2 : 1), 0);   // 22 strokes: 1 on every hole, a 2nd on SI 1–4
  ok(row.gross - row.net === takenOn15, `strokes taken through 15 = ${takenOn15}, not the 18-hole 22 (got ${row.gross - row.net})`);
  const v = scrambleRowValue(row, false);
  const tp = row.toPar < 0 ? `-${-row.toPar}` : row.toPar === 0 ? "E" : `+${row.toPar}`;
  ok(v === `${row.net} net (${row.gross} gross, ${tp} thru 15)`, `unfinished: "49 net (67 gross, -9 thru 15)" style (got ${v})`);
  ok(rc.headline === `Team 1 wins the scramble — ${row.net} net (${row.gross} gross, ${tp} thru 15)`, `the headline reads the same (got ${rc.headline})`);
  ok(scrambleRowValue({ ...row, thru: 18, holes: 18 }, false) === `${row.net} net (${row.gross} gross, ${tp})`, "a full round: net, gross and net to par");
}
// 212.14 — the scramble scorecard (owner): team headers and a compact table, not the per-player layout
{
  const g4 = game({ foursomes: [groups[0]] });
  const four = players.filter((p) => groups[0].a.includes(p.user_id!)).map((p) => ({ ...p, tee_group: 1 })) as Player[];
  const sc = renderScreen(<GroupScorecard game={g4} players={four} allPlayers={four} user={{ id: "u-Raj" } as never} isMarker markerName={null} onTakeOver={() => {}} onRelease={() => {}} onSetHole={() => {}}
    altShotScores={rows.filter((r) => r.foursome_id === "team-1") as never} />);
  const txt = sc.el.textContent || "";
  ok(!!sc.el.querySelector("[data-scramble-card]") && sc.el.querySelectorAll("[data-scramble-team-header]").length === 1, "the scramble card with one team header");
  ok(["Raj", "Nihar", "Karan", "Sam"].every((n) => txt.includes(n)) && txt.includes("Team hcp 7"), "every member and the team handicap in the header");
  ok(sc.el.querySelectorAll("[data-scramble-cell]").length === 18 && txt.includes("OUT") && txt.includes("IN") && txt.includes("TOTAL"), "18 compact cells; Out / In / Total");
  ok(!txt.includes("Stableford"), "no Stableford legend on a scramble");
  const before = (sc.el.textContent || "").length;
  act(() => { (sc.el.querySelectorAll("[data-scramble-cell]")[4] as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  const after = document.body.textContent || "";
  ok(after.length > before && /Hole\s*5/.test(after), `tapping a cell opens the score editor for that hole (${after.slice(-200)})`);
  sc.unmount();
}
report("scramble screens");
