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
  // an exact label first (212.58: "Team" the format must not match the "Teams" step button), then a label containing it
  const all = [...el.querySelectorAll(sel)];
  const t = (all.find((b) => (b.textContent || "").replace(/^[0-9]+/, "").trim() === text) ?? all.find((b) => (b.textContent || "").trim().includes(text))) as HTMLElement | undefined;
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

  // ── 212.43: THE FOUR-BALL FAMILY, one step ─────────────────────────────────────────────────────────────────────
  for (const fmt of ["Four-ball", "Trifecta", "Alternate Shot"] as const) {
    window.localStorage.clear();
    const e = document.createElement("div"); document.body.appendChild(e);
    const r = createRoot(e); let made = null as unknown[] | null;
    await act(async () => { r.render(<CreateGame user={ME} displayName="Amit Sud" activeGroupId="00000000-0000-0000-0000-00000000c1b0" onCancel={() => {}} onCreated={(...a: unknown[]) => { made = a; }} />); });
    await flush();
    await clickText(e, "Oak Hollow"); await clickText(e, "Continue");
    await clickText(e, "Match play"); await clickText(e, "Team"); await clickText(e, fmt);
    const gameTxt = e.textContent || "";
    ok(!gameTxt.includes("Create Team Names") && !gameTxt.includes("Two teams") && !e.querySelector('input[placeholder="Team 1 name"]'), `${fmt}: no team tile or team-name boxes on the Game step — teams are named on the Teams step (owner, Oct 26)`);
    if (fmt === "Four-ball") shot(e, "w6b-fourball-game-step");
    ok(JSON.stringify(stepBar(e)) === JSON.stringify(["Course", "Game", "Players", "Teams", "Review"]), `${fmt}: one step — a Teams step before Review (got ${stepBar(e).join(", ")})`);
    await clickText(e, "Continue");
    for (const name of ["Raj Mehta", "Nihar Shah", "Karan Patel", "Sam Lee", "Vikram Rao", "Bo Li", "Lex Rivera"]) await clickText(e, name, "label");
    await clickText(e, "Continue");
    const teamsTxt = e.querySelector("[data-one-step-teams]")?.textContent || "";
    ok(!!e.querySelector("[data-compact-teams]") && e.querySelectorAll("[data-compact-player]").length === 8, `${fmt}: the Teams step shows the compact team card, one row per player`);
    // owner, Oct 26: nothing picked by default; groups locked until the teams are set
    ok(!e.querySelector("[data-compact-player] button[style*='background: rgb']") || [...e.querySelectorAll("[data-compact-player]")].every((r) => (r.textContent || "").includes("no team yet")), `${fmt}: no player is on a team until the organizer chooses`);
    ok(!!e.querySelector("[data-groups-locked]") && (e.querySelector("[data-groups-locked]")?.textContent || "").includes("8 without a team"), `${fmt}: Groups are locked until the teams are set ("${(e.querySelector("[data-groups-locked]")?.textContent || "").slice(0, 120)}")`);
    void teamsTxt;
    if (fmt === "Four-ball") shot(e, "t1-arrive-nothing-picked");
    await clickText(e, "Balance by handicap");
    ok(!e.querySelector("[data-groups-locked]") && !!e.querySelector("[data-groups-start-over]") === false, `${fmt}: balanced teams (4 v 4) open the Groups — with nothing picked in them yet`);
    // Start over clears the teams (and locks the groups again); balance again
    await clickText(e, "Start over");
    ok(!!e.querySelector("[data-groups-locked]"), `${fmt}: Start over clears every team choice`);
    await clickText(e, "Balance by handicap");
    if (fmt === "Four-ball") {
      // name the sides HERE — Edit names → type → Save (the buttons change only on Save); then pick a colour
      await clickText(e, "Edit names");
      const nameInput = e.querySelector('input[aria-label="New name for Team 1"]') as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      await act(async () => { setter.call(nameInput, ""); nameInput.dispatchEvent(new Event("input", { bubbles: true })); }); await flush(2);
      ok((e.querySelector('input[aria-label="New name for Team 1"]') as HTMLInputElement)?.value === "", "four-ball: an emptied name stays empty while editing (it used to snap back to \"Team 1\")");
      ok([...e.querySelectorAll("[data-compact-player] button")].some((b) => b.textContent === "Team 1"), "four-ball: the players' buttons don't change while the name is being typed");
      await act(async () => { setter.call(nameInput, "Reds"); nameInput.dispatchEvent(new Event("input", { bubbles: true })); }); await flush(2);
      shot(e, "t2-edit-names");
      await clickText(e, "Save names");
      ok([...e.querySelectorAll("[data-compact-player] button")].some((b) => b.textContent === "Reds"), "four-ball: on Save, the players' buttons show the new name");
      const dot = e.querySelector('button[aria-label^="Choose Reds"]') as HTMLButtonElement;
      ok(!!dot, "the colour dot sits beside the team's name");
      await act(async () => { dot.click(); }); await flush(2);
      shot(e, "w7b-colour-picker");
      const swatch = [...e.querySelectorAll("button")].find((b) => /purple|green|red|orange|blue|gold/i.test(b.getAttribute("aria-label") || "") && !(b.getAttribute("aria-label") || "").startsWith("Choose")) as HTMLButtonElement | undefined;
      if (swatch) { await act(async () => { swatch.click(); }); await flush(2); }
      ok(!!swatch, "the colour picker opens with the colours to choose from");
    }
    // the groups: build even groups; start over clears them; build again
    await clickText(e, "Build even groups");
    if (fmt === "Four-ball") shot(e, "t3-groups-built");
    ok(!!e.querySelector("[data-groups-start-over]"), `${fmt}: once groups are built, Start over is offered`);
    await clickText(e, "Start over", "button[data-groups-start-over]");
    ok(!e.querySelector("[data-groups-start-over]"), `${fmt}: Start over clears the groups`);
    await clickText(e, fmt === "Trifecta" ? "Build balanced matchups" : "Build even groups");
    if (fmt === "Four-ball") shot(e, "w7-fourball-teams");
    await clickText(e, "Continue");
    const rv = e.querySelector("[data-one-step-review]")?.textContent || "";
    if (fmt !== "Alternate Shot") {
      ok(rv.includes(`${fmt === "Four-ball" ? "Reds" : "Team 1"} 4 · Team 2 4`) && rv.includes("2 groups of 2 v 2"), `four-ball: Review shows balanced teams of 4 and two 2 v 2 groups (got "${rv.slice(0, 220)}")`);
      shot(e, "w8-fourball-review");
    } else {
      ok(rv.includes("Choose who drives first"), `alternate shot: Review asks for the first drivers before it can be created (got "${rv.slice(0, 200)}")`);
      const createBtn = [...e.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Create game") as HTMLButtonElement;
      ok(!!createBtn && createBtn.disabled, "alternate shot: Create game is disabled until the first drivers are chosen");
      // choose the first drivers on the Teams step (the same picker Manage Game uses), then come back
      await clickText(e, "Teams");   // back to the Teams step through the step bar
      const pickers = [...e.querySelectorAll("select")].filter((sel) => [...sel.options].some((o) => /drive|first/i.test(o.textContent || "") || o.value === ""));
      for (const sel of e.querySelectorAll("select")) {
        const lbl = (sel.getAttribute("aria-label") || "") + " " + (sel.closest("div")?.textContent || "");
        if (!/first|drive/i.test(lbl)) continue;
        const opt = [...(sel as HTMLSelectElement).options].find((o) => o.value);
        if (!opt) continue;
        await act(async () => { (sel as HTMLSelectElement).value = opt.value; sel.dispatchEvent(new Event("change", { bubbles: true })); }); await flush(2);
      }
      void pickers;
      await clickText(e, "Continue");
      const rv2 = e.querySelector("[data-one-step-review]")?.textContent || "";
      ok(!rv2.includes("Choose who drives first") && rv2.includes("2 groups of 2 v 2"), `alternate shot: with first drivers chosen, Review is ready (got "${rv2.slice(0, 200)}")`);
    }
    calls.length = 0;
    await clickText(e, "Create game");
    const b = calls.find((x) => x.url.includes("/rpc/create_game_complete"))?.body as { p_game?: { game_type?: string; teams?: { key: string }[] }; p_players?: unknown[]; p_teams?: { team: string }[]; p_groups?: unknown[]; p_foursomes?: { a: string[]; b: string[]; a_first?: string; b_first?: string }[]; p_announce?: boolean } | undefined;
    const want = fmt === "Four-ball" ? "fourball" : fmt === "Trifecta" ? "trifecta" : "alt_shot";
    ok(!!b && b.p_game?.game_type === want && (b.p_players ?? []).length === 8 && (b.p_teams ?? []).length === 8 && (b.p_groups ?? []).length === 8
      && (b.p_foursomes ?? []).length === 2 && (b.p_foursomes ?? []).every((f) => f.a.length === 2 && f.b.length === 2) && b.p_announce === true,
      `${fmt}: ONE call — the game, 8 players, 8 team places, 8 group places, two 2 v 2 foursomes (got ${JSON.stringify({ t: b?.p_game?.game_type, p: b?.p_players?.length, tm: b?.p_teams?.length, g: b?.p_groups?.length, f: b?.p_foursomes?.map((f) => `${f.a.length}v${f.b.length}`) })})`);
    ok(new Set((b?.p_teams ?? []).map((t) => t.team)).size === 2 && (b?.p_teams ?? []).filter((t) => t.team === "A").length === 4, `${fmt}: four a side`);
    if (fmt === "Four-ball") {
      const tm = (b?.p_game?.teams ?? []) as { key: string; name: string; color?: string | null }[];
      ok(tm[0]?.name === "Reds" && !!tm[0]?.color, `four-ball: the name and colour chosen on the Teams step are saved (got ${JSON.stringify(tm)})`);
    }
    if (fmt === "Alternate Shot") ok((b?.p_foursomes ?? []).every((f) => !!f.a_first && !!f.b_first), "alternate shot: the first drivers are saved with the foursomes");
    ok(Array.isArray(made) && (made as unknown[])[1] === "play", `${fmt}: Create game goes straight to the scorecard`);
    r.unmount();
  }

  // ── 212.47 (owner, Oct 26: keep it strict): SIX players in four-ball don't work — said on Players and on Groups ──
  {
    window.localStorage.clear();
    const e = document.createElement("div"); document.body.appendChild(e);
    const r = createRoot(e);
    await act(async () => { r.render(<CreateGame user={ME} displayName="Amit Sud" activeGroupId="00000000-0000-0000-0000-00000000c1b0" onCancel={() => {}} onCreated={() => {}} />); });
    await flush();
    await clickText(e, "Oak Hollow"); await clickText(e, "Continue");
    await clickText(e, "Match play"); await clickText(e, "Team"); await clickText(e, "Four-ball");
    await clickText(e, "Continue");
    for (const name of ["Raj Mehta", "Nihar Shah", "Karan Patel", "Sam Lee", "Vikram Rao"]) await clickText(e, name, "label");
    const hint = e.querySelector("[data-player-count-hint]")?.textContent || "";
    ok(hint.includes("Four-ball works with 4, 7, 8, 11, 12, 15 or 16 players — you have 6: add 1 player (for 7) or remove 2 (for 4)"), `six in four-ball: the Players step says so up front ("${hint}")`);
    await clickText(e, "Continue");
    await clickText(e, "Balance by handicap");
    const lock = e.querySelector("[data-groups-wrong-size]")?.textContent || "";
    ok(!!e.querySelector("[data-groups-locked]") && lock.includes("you have 6"), `six in four-ball: 3 v 3 keeps the groups locked, saying why ("${lock.slice(0, 90)}")`);
    r.unmount();
  }

  // ── 212.45 (owner, Oct 26): SEVEN players — four-ball plays one 2 v 1 group; alternate shot needs an even number ──
  for (const fmt of ["Four-ball", "Alternate Shot"] as const) {
    window.localStorage.clear();
    const e = document.createElement("div"); document.body.appendChild(e);
    const r = createRoot(e); let made = null as unknown[] | null;
    await act(async () => { r.render(<CreateGame user={ME} displayName="Amit Sud" activeGroupId="00000000-0000-0000-0000-00000000c1b0" onCancel={() => {}} onCreated={(...a: unknown[]) => { made = a; }} />); });
    await flush();
    await clickText(e, "Oak Hollow"); await clickText(e, "Continue");
    await clickText(e, "Match play"); await clickText(e, "Team"); await clickText(e, fmt);
    await clickText(e, "Continue");
    for (const name of ["Raj Mehta", "Nihar Shah", "Karan Patel", "Sam Lee", "Vikram Rao", "Bo Li"]) await clickText(e, name, "label");
    await clickText(e, "Continue");
    await clickText(e, "Balance by handicap");
    const sums = [...e.querySelectorAll("[data-team-summary]")].map((x) => x.textContent || "");
    ok(sums.some((x) => x.includes("4 players")) && sums.some((x) => x.includes("3 players")), `${fmt} with 7: balanced to 4 v 3 (${sums.map((x) => x.match(/\d players/)?.[0]).join(" v ")})`);
    if (fmt === "Four-ball") {
      ok(!e.querySelector("[data-groups-locked]"), "four-ball with 7: the groups open at 4 v 3");
      await clickText(e, "Build even groups");
      const gtxt = e.querySelector("[data-one-step-teams]")?.textContent || "";
      ok(gtxt.includes("READY · 2 v 1") && gtxt.includes("READY · 2 v 2") && gtxt.includes("2 of 2 groups ready"), "four-ball with 7: one group 2 v 2, one 2 v 1 — both ready");
      shot(e, "t4-seven-players");
      await clickText(e, "Continue");
      const rv = e.querySelector("[data-one-step-review]")?.textContent || "";
      ok(rv.includes("2 groups — one plays 2 v 1") && !rv.includes("needs"), `four-ball with 7: Review is ready and says so (got "${rv.slice(0, 200)}")`);
      calls.length = 0;
      await clickText(e, "Create game");
      const b = calls.find((x) => x.url.includes("/rpc/create_game_complete"))?.body as { p_players?: unknown[]; p_foursomes?: { a: string[]; b: string[] }[] } | undefined;
      const shapes = (b?.p_foursomes ?? []).map((f) => `${f.a.length}v${f.b.length}`).sort();
      ok((b?.p_players ?? []).length === 7 && JSON.stringify(shapes) === JSON.stringify(["2v1", "2v2"].sort()) || JSON.stringify(shapes) === JSON.stringify(["1v2", "2v2"].sort()), `four-ball with 7: saved as one 2 v 2 and one 2 v 1 group (got ${JSON.stringify(shapes)})`);
      ok(Array.isArray(made) && (made as unknown[])[1] === "play", "four-ball with 7: Create game goes to the scorecard");
    } else {
      const lock = e.querySelector("[data-groups-locked]")?.textContent || "";
      ok(!!lock && !lock.includes("2 v 1"), `alternate shot with 7: the groups stay locked — two a side only ("${lock.slice(0, 140)}")`);
      await clickText(e, "Continue");
      const rv = e.querySelector("[data-one-step-review]")?.textContent || "";
      ok(rv.includes("needs an even number"), `alternate shot with 7: Review says it needs an even number (got "${rv.slice(0, 200)}")`);
    }
    r.unmount();
  }
  // ── 212.58: MATCH PLAY (individual and team) and SKINS, one step — matchups built inside Create ──
  for (const shape of ["Individual match", "Team match", "Individual skins"] as const) {
    window.localStorage.clear();
    const e = document.createElement("div"); document.body.appendChild(e);
    const r = createRoot(e);
    await act(async () => { r.render(<CreateGame user={ME} displayName="Amit Sud" activeGroupId="00000000-0000-0000-0000-00000000c1b0" onCancel={() => {}} onCreated={() => {}} />); });
    await flush();
    await clickText(e, "Oak Hollow"); await clickText(e, "Continue");
    if (shape === "Individual skins") { await clickText(e, "Stroke play"); await clickText(e, "Skins"); }
    else { await clickText(e, "Match play"); await clickText(e, "Individual"); if (shape === "Team match") await clickText(e, "Team match", "label"); }   // team match play = singles + the "Team match" switch
    ok(JSON.stringify(stepBar(e)) === JSON.stringify(["Course", "Game", "Players", "Teams", "Review"]), `${shape}: one step — a Teams step before Review (got ${stepBar(e).join(", ")})`);
    if (shape === "Team match") ok(!e.querySelector('input[placeholder="Team 1 name"]') && (e.textContent || "").includes("name the teams"), "team match: the teams are named on the Teams step, not here");
    await clickText(e, "Continue");
    for (const name of ["Raj Mehta", "Nihar Shah", "Karan Patel"]) await clickText(e, name, "label");   // 4 players with me
    const hint = e.querySelector("[data-player-count-hint]")?.textContent || "";
    ok(shape === "Individual skins" ? hint.includes("individual skins") : shape === "Team match" ? hint.includes("two teams of 2") : hint.includes("2 matches"), `${shape}: the Players hint reads the count (got "${hint}")`);
    await clickText(e, "Continue");
    ok(!!e.querySelector("[data-match-one-step]"), `${shape}: the Teams step is the match-play one`);
    ok(!!e.querySelector("[data-compact-teams]") === (shape === "Team match"), `${shape}: the compact team card ${shape === "Team match" ? "is" : "isn't"} there`);
    ok([...e.querySelectorAll("button")].some((b) => (b.textContent || "").includes("Build balanced matches")) === (shape !== "Individual skins"), `${shape}: the matchups builder ${shape === "Individual skins" ? "isn't" : "is"} there`);
    if (shape === "Team match") {
      await clickText(e, "Continue");
      const rv0 = e.querySelector("[data-one-step-review]")?.textContent || "";
      ok(rv0.includes("Put 4 players on a team"), `team match: Review is blocked until the players are on teams (got "${rv0.slice(0, 160)}")`);
      await clickText(e, "Teams");
      await clickText(e, "Balance by handicap");
    }
    if (shape !== "Individual skins") {
      await clickText(e, "Continue");
      const rv1 = e.querySelector("[data-one-step-review]")?.textContent || "";
      ok(rv1.includes("matchups") || rv1.includes("Pair everyone up"), `${shape}: Review is blocked until the matchups are set (got "${rv1.slice(0, 160)}")`);
      await clickText(e, "Teams");
      await clickText(e, "Build balanced matches");
    }
    await clickText(e, "Continue");
    const rv = e.querySelector("[data-one-step-review]")?.textContent || "";
    ok(shape === "Individual skins" ? rv.includes("Not set (optional)") : rv.includes("2 matches"), `${shape}: Review is ready (got "${rv.slice(0, 200)}")`);
    const createBtn = [...e.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Create game") as HTMLButtonElement;
    ok(!!createBtn && !createBtn.disabled, `${shape}: Create game is enabled`);
    calls.length = 0;
    await clickText(e, "Create game");
    const b = calls.find((x) => x.url.includes("/rpc/create_game_complete"))?.body as { p_game?: { game_type?: string; pairings?: unknown[]; teams?: unknown[] | null }; p_players?: unknown[]; p_teams?: unknown[] } | undefined;
    const wantType = shape === "Individual skins" ? "skins" : "match";
    ok(!!b && b.p_game?.game_type === wantType && (b.p_players ?? []).length === 4
      && (shape === "Individual skins" ? !(b.p_game?.pairings ?? []).length : (b.p_game?.pairings ?? []).length === 2)
      && (b.p_teams ?? []).length === (shape === "Team match" ? 4 : 0),
      `${shape}: ONE call — the game, 4 players, ${shape === "Individual skins" ? "no" : "2"} matchups, ${shape === "Team match" ? "4 team places" : "no teams"} (got ${JSON.stringify({ t: b?.p_game?.game_type, p: b?.p_players?.length, pr: b?.p_game?.pairings?.length, tm: b?.p_teams?.length })})`);
    r.unmount();
  }

  report("one-step walkthrough");
})();
