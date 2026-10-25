/** 212.41 — ONE-STEP CREATE, walked end to end on the REAL Create screen (components/tournaments.tsx CreateGame) with a
 * sample club: the steps in order, the hint, the Teams step, the Review, and the one server call it makes. With
 * WALKTHROUGH_DIR set, each step's screen is saved for the design gallery photographer. */
import { ok, report } from "./screen-harness";
import * as React from "react";
import * as fs from "fs";
import * as path from "path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { CreateGame } from "@/components/tournaments";

const COURSE = { id: "c1", data: { id: "c1", name: "Oak Hollow", location: "Livingston, NJ",
  holes: Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: [4, 5, 3, 4, 4, 3, 5, 4, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5][i], si: [7, 1, 17, 11, 3, 15, 9, 5, 13, 8, 2, 18, 6, 12, 4, 16, 10, 14][i] })),
  tees: [{ name: "Blue", rating: 72.3, slope: 133, par: 72, yardages: Array(18).fill(380) }, { name: "White", rating: 70.7, slope: 132, par: 72, yardages: Array(18).fill(355) }] } };
var ROSTER_IDX: Record<string, number> = { "u-amit": 1, "u-raj": 2, "u-nihar": 3, "u-karan": 4, "u-sam": 5, "u-vikram": 6, "u-bo": 7, "u-lex": 8 };
const ROSTER = [["u-amit", "Amit Sud", 14.7], ["u-raj", "Raj Mehta", 4.2], ["u-nihar", "Nihar Shah", 19.4], ["u-karan", "Karan Patel", 6.4],
  ["u-sam", "Sam Lee", 22.4], ["u-vikram", "Vikram Rao", 11.3], ["u-bo", "Bo Li", 9.1], ["u-lex", "Lex Rivera", 16.8]]
  .map(([id, display_name, handicap_index]) => ({ id: `00000000-0000-0000-0000-0000000000${String(ROSTER_IDX[id as string]).padStart(2, "0")}`, display_name, handicap_index, avatar_url: null }));
const calls: { url: string; body: unknown }[] = [];
(globalThis as { fetch: unknown }).fetch = async (input: string | URL, init?: { body?: string }) => {
  const url = String(input); const body = init?.body ? JSON.parse(init.body) : null;
  calls.push({ url, body });
  const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { "content-type": "application/json", "content-range": "0-99/*" } });
  if (url.includes("/rest/v1/group_courses")) return json([{ course_id: "c1" }]);
  if (url.includes("/rest/v1/favorite_courses")) return json([COURSE]);
  if (url.includes("/rpc/group_roster")) return json(ROSTER);
  if (url.includes("/rpc/create_game_complete")) return json("11111111-1111-1111-1111-111111111111");
  if (url.includes("/rpc/set_game_share")) return json(null);
  if (url.includes("/rest/v1/games") && url.includes("lineup_slug")) return json({ lineup_slug: "oak-hollow-oct25-ab12cd", share_token: "tok" });
  return json([]);
};

const ME = { id: "00000000-0000-0000-0000-000000000001" };
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const OUT = process.env.WALKTHROUGH_DIR;
const shot = (el: HTMLElement, name: string) => {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  // the test DOM drops "border: none" when it writes styles out — restore it where an element's own style sets no border
  const css = "body{margin:0;background:#0A2A20;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#F2EBDC}#wrap{padding:16px}"
    + "button:not([style*=border]),input:not([style*=border]),select:not([style*=border]){border:none}";
  // the page is written from the DOM's attributes, so copy in what is only held as live state: ticks, choices, typed values
  el.querySelectorAll("input").forEach((i) => { if (i.type === "checkbox" || i.type === "radio") { if (i.checked) i.setAttribute("checked", ""); else i.removeAttribute("checked"); } else i.setAttribute("value", i.value); });
  el.querySelectorAll("select").forEach((sel) => [...sel.options].forEach((o) => { if (o.selected) o.setAttribute("selected", ""); else o.removeAttribute("selected"); }));
  fs.writeFileSync(path.join(OUT, `${name}.html`), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=390"><style>${css}</style><div id="wrap">${el.innerHTML}</div>`);
};
const clickText = async (el: HTMLElement, text: string, sel = "button") => {
  const t = [...el.querySelectorAll(sel)].find((b) => (b.textContent || "").trim().includes(text)) as HTMLElement | undefined;
  if (!t) throw new Error(`no ${sel} with "${text}" — screen says: ${(el.textContent || "").slice(0, 300)}`);
  await act(async () => { t.click(); }); await flush(3);
};
const stepBar = (el: HTMLElement) => [...el.querySelectorAll("button")].map((b) => (b.textContent || "").replace(/^[0-9✓]+/, "").trim()).filter((x) => ["Course", "Game", "Players", "Teams", "Review"].includes(x));

(async () => {
  const el = document.createElement("div"); document.body.appendChild(el);
  const root = createRoot(el);
  let created: unknown[] | null = null;
  await act(async () => { root.render(<CreateGame user={ME} displayName="Amit Sud" activeGroupId="00000000-0000-0000-0000-00000000c1b0" onCancel={() => {}} onCreated={(...a: unknown[]) => { created = a; }} />); });
  await flush();
  // 1. GAME: course, date, tee — the first thing chosen
  ok(JSON.stringify(stepBar(el)) === JSON.stringify(["Course", "Game", "Players", "Review"]), `steps before a format is picked: Course, Game, Players, Review (got ${stepBar(el).join(", ")})`);
  await clickText(el, "Oak Hollow");
  ok(!(el.textContent || "").includes("Your handicap index"), "the Course step has no 'your handicap index' field (owner, Oct 25)");
  ok(!(el.textContent || "").includes("Game name"), "Game name is not on the Course step (owner, Oct 25)");
  shot(el, "w1-game");
  // 2. FORMAT: chosen before players
  await clickText(el, "Continue");
  ok((el.textContent || "").includes("Scramble"), "Continue from Game opens Format");
  ok((el.textContent || "").includes("Game name"), "Game name is on the Game step");
  await clickText(el, "Scramble");
  ok(JSON.stringify(stepBar(el)) === JSON.stringify(["Course", "Game", "Players", "Teams", "Review"]), `scramble adds a Teams step (got ${stepBar(el).join(", ")})`);
  shot(el, "w2-format");
  // 3. PLAYERS: picked once the format is known, with the hint
  await clickText(el, "Continue");
  for (const name of ["Raj Mehta", "Nihar Shah", "Karan Patel", "Sam Lee", "Vikram Rao", "Bo Li", "Lex Rivera"]) await clickText(el, name, "label");
  const hint = el.querySelector("[data-player-count-hint]")?.textContent || "";
  ok(hint.includes("8 players can play as 4 teams of 2 or 2 teams of 4"), `the Players hint (got "${hint}")`);
  shot(el, "w3-players");
  // 4. TEAMS: opens on balanced teams, groups underneath
  await clickText(el, "Continue");
  const teamsTxt = el.querySelector("[data-one-step-teams]")?.textContent || "";
  ok(teamsTxt.includes("Suggested teams") && teamsTxt.includes("Team 1") && teamsTxt.includes("Team 2"), "the Teams step opens on suggested teams");
  shot(el, "w4-teams");
  // 5. REVIEW: everything at once
  await clickText(el, "Continue");
  ok(!!el.querySelector("[data-one-step-review]"), "Review is the one-step Review");
  const rv = el.querySelector("[data-one-step-review]")?.textContent || "";
  ok(rv.includes("2 teams of 4") && /(Sun|Mon|Tue|Wed|Thu|Fri|Sat), [A-Z][a-z]{2} \d{1,2}/.test(rv), `Review reads "2 teams of 4" and a friendly date (got "${rv.slice(0, 160)}")`);
  shot(el, "w5-review");
  // 6. CREATE GAME: one server call with the game, players, groups and teams; then Play
  calls.length = 0;
  await clickText(el, "Create game");
  const c = calls.find((x) => x.url.includes("/rpc/create_game_complete"));
  const b = (c?.body ?? {}) as { p_game?: { game_type?: string; foursomes?: unknown }; p_players?: unknown[]; p_groups?: unknown[]; p_foursomes?: { a: string[] }[]; p_announce?: boolean };
  ok(!!c, "Create game makes ONE create_game_complete call");
  ok(b.p_game?.game_type === "scramble" && (b.p_players ?? []).length === 8 && (b.p_foursomes ?? []).length === 2 && (b.p_groups ?? []).length === 8 && b.p_announce === true,
    `it carries the game, 8 players, 2 teams, 8 group places, and tells the players (got ${JSON.stringify({ t: b.p_game?.game_type, p: b.p_players?.length, f: b.p_foursomes?.length, g: b.p_groups?.length, a: b.p_announce })})`);
  ok(!calls.some((x) => /\/rest\/v1\/(games|game_players)\b/.test(x.url) && x.url.indexOf("select") < 0 && x.body), "no separate game or player inserts");
  ok(Array.isArray(created) && (created as unknown[])[1] === "play", `Create game goes straight to the scorecard (got ${JSON.stringify(created)})`);
  ok(!calls.some((x) => x.url.includes("/rpc/set_game_share")), "nothing is shared by creating the game");
  ok(calls.some((x) => /activity/.test(x.url) && JSON.stringify(x.body ?? "").includes("game_created")), "Create game tells the club's activity feed, as today");
  root.unmount();

  // SAVE DRAFT: the same game, saved for later — not announced; opens Manage Game (where the Draft banner is)
  const el2 = document.createElement("div"); document.body.appendChild(el2);
  const root2 = createRoot(el2); let created2 = null as unknown[] | null;
  await act(async () => { root2.render(<CreateGame user={ME} displayName="Amit Sud" activeGroupId="00000000-0000-0000-0000-00000000c1b0" onCancel={() => {}} onCreated={(...a: unknown[]) => { created2 = a; }} />); });
  await flush();
  await clickText(el2, "Oak Hollow"); await clickText(el2, "Continue"); await clickText(el2, "Scramble"); await clickText(el2, "Continue");
  for (const name of ["Raj Mehta", "Nihar Shah", "Karan Patel"]) await clickText(el2, name, "label");
  await clickText(el2, "Continue"); await clickText(el2, "Continue");
  calls.length = 0;
  await clickText(el2, "Save draft");
  const d = calls.find((x) => x.url.includes("/rpc/create_game_complete"))?.body as { p_announce?: boolean } | undefined;
  ok(d?.p_announce === false, "Save draft saves the game WITHOUT telling anyone");
  ok(!calls.some((x) => x.url.includes("/rpc/set_game_share")), "Save draft shares nothing");
  ok(!calls.some((x) => /activity/.test(x.url) && JSON.stringify(x.body ?? "").includes("game_created")), "Save draft writes nothing to the club's activity feed");
  ok(JSON.stringify((created2 as unknown[] | null)?.slice(1)) === JSON.stringify(["setup", "overview"]), `Save draft opens Manage Game's overview (got ${JSON.stringify(created2)})`);
  root2.unmount();

  // RESUME: teams survive the app closing mid-setup (the local draft keeps them, with the same guest ids)
  const el3 = document.createElement("div"); document.body.appendChild(el3);
  const root3 = createRoot(el3);
  const mount = async (root: ReturnType<typeof createRoot>) => { await act(async () => { root.render(<CreateGame user={ME} displayName="Amit Sud" activeGroupId="00000000-0000-0000-0000-00000000c1b0" onCancel={() => {}} onCreated={() => {}} />); }); await flush(); };
  await mount(root3);
  if ((el3.textContent || "").includes("Resume")) await clickText(el3, "Start fresh");
  await clickText(el3, "Oak Hollow"); await clickText(el3, "Continue"); await clickText(el3, "Scramble"); await clickText(el3, "Continue");
  for (const name of ["Raj Mehta", "Nihar Shah", "Karan Patel", "Sam Lee", "Vikram Rao", "Bo Li", "Lex Rivera"]) await clickText(el3, name, "label");
  await clickText(el3, "Continue");
  await clickText(el3, "2 players");   // the organizer changes the suggestion: teams of 2
  const teamsBefore = [...el3.querySelectorAll("[data-scramble-team]")].map((t) => t.textContent || "").join(" | ");
  await flush(4);
  root3.unmount();   // the app closes
  const el4 = document.createElement("div"); document.body.appendChild(el4);
  const root4 = createRoot(el4);
  await mount(root4);
  ok((el4.textContent || "").includes("Resume"), "reopening offers to resume the unfinished game");
  await clickText(el4, "Resume");
  const teamsAfter = [...el4.querySelectorAll("[data-scramble-team]")].map((t) => t.textContent || "").join(" | ");
  ok(teamsBefore.length > 0 && teamsAfter === teamsBefore, `the teams come back exactly as left (4 teams of 2)${teamsAfter === teamsBefore ? "" : ` — before "${teamsBefore.slice(0, 120)}", after "${teamsAfter.slice(0, 120)}"`}`);
  root4.unmount();
  report("one-step walkthrough");
})();
