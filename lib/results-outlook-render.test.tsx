/**
 * RENDERED CHECK (204.0): the group's Results card sits under the group scorecard, and the Results
 * tab shows "If every match ended now" mid-round. Real Tournaments screen, Trifecta fixture.
 */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import Tournaments from "@/components/tournaments";
import { saveGameSnapshot } from "@/lib/draft";
const GAME_ID = "51a8ed51-d28d-40ec-bfc0-741d57579415";
const GROUP_ID = "trifecta-render-group";

const HOLES = [
  { n: 1, si: 11, par: 5, yards: 500 }, { n: 2, si: 13, par: 3, yards: 185 }, { n: 3, si: 5, par: 5, yards: 510 },
  { n: 4, si: 7, par: 4, yards: 422 }, { n: 5, si: 9, par: 4, yards: 345 }, { n: 6, si: 17, par: 3, yards: 135 },
  { n: 7, si: 3, par: 4, yards: 400 }, { n: 8, si: 15, par: 3, yards: 174 }, { n: 9, si: 1, par: 4, yards: 410 },
  { n: 10, si: 14, par: 4, yards: 358 }, { n: 11, si: 10, par: 5, yards: 523 }, { n: 12, si: 18, par: 3, yards: 182 },
  { n: 13, si: 6, par: 5, yards: 494 }, { n: 14, si: 4, par: 4, yards: 454 }, { n: 15, si: 2, par: 4, yards: 432 },
  { n: 16, si: 8, par: 4, yards: 443 }, { n: 17, si: 16, par: 3, yards: 180 }, { n: 18, si: 12, par: 4, yards: 385 },
];

// game_players rows, verbatim. user_id is the pkey the foursomes reference.
const P = (id: string, user_id: string, display_name: string, hi: number, slope: number, rating: number, ch: number, team: "A" | "B", scores: number[]) => ({
  id, game_id: GAME_ID, user_id, display_name, handicap_index: hi, slope, rating, tee_name: "White", course_handicap: ch,
  scores, putts: Array(18).fill(null), fairways: Array(18).fill(null), penalties: Array(18).fill(null), sand: Array(18).fill(null),
  team, no_show: false, is_guest: false, bets: true, tee_group: null, is_marker: false,
});
const KARAN = "bbe388ee-dc27-4272-b450-a9f230563e38", SACHIN = "94916c8a-1913-41aa-bb78-c5c572716dbf";
const ASHUTOSH = "a89d81d4-2b9d-4fd3-966b-4bd432354328", BK = "7afdee8d-4361-49da-a3b8-cc2585582426";
const players = [
  P("bb7e11a0", ASHUTOSH, "Ashutosh Rathore", 10, 129, 71.5, 12, "B", [5, 4, 5, 5, 4, 3, 4, 3, 5, 4, 5, 4, 7, 5, 5, 6, 3, 4]),
  P("e9037bf3", "79ce0874-179e-4fdb-bf8f-9146b02edd0f", "Nihar Vasavada", 20, 127, 69.6, 21, "B", [5, 5, 8, 6, 7, 4, 6, 6, 5, 5, 6, 4, 7, 5, 5, 7, 5, 5]),
  P("38f72cd3", SACHIN, "Sachin Manchanda", 13, 127, 69.6, 13, "A", [7, 3, 7, 7, 4, 4, 6, 4, 5, 5, 6, 3, 5, 3, 4, 5, 3, 4]),
  P("dab3dabe", BK, "BK Jain", 16, 127, 69.6, 17, "B", [5, 4, 6, 6, 4, 5, 7, 5, 4, 5, 6, 5, 7, 4, 6, 6, 3, 6]),
  P("aaf2db2a", KARAN, "Karan Sarin", 9, 129, 71.5, 11, "A", [4, 4, 7, 6, 4, 3, 4, 4, 5, 6, 5, 4, 6, 5, 5, 4, 4, 5]),
  P("4ae6b433", "9b8c13c0-c65b-43b0-a38d-d75ae6ac3d28", "gaurav mathur", 26, 127, 69.6, 28, "A", [7, 4, 6, 5, 5, 4, 7, 4, 7, 6, 7, 5, 6, 6, 8, 5, 3, 6]),
  P("79663f53", "97c52b0f-0849-4166-a3fd-094ac3b50a70", "Preet Takkar", 22, 127, 69.6, 23, "A", [6, 6, 6, 7, 4, 4, 4, 4, 7, 5, 6, 4, 7, 5, 5, 7, 5, 5]),
  P("d65f22b4", "ea7e006c-1fcc-42d0-ac68-8fbdf9db1c16", "Alok Jha", 13, 129, 71.5, 15, "B", [6, 3, 5, 4, 5, 3, 4, 4, 7, 6, 5, 3, 6, 5, 5, 6, 3, 6]),
  P("64ec7328", "e93f5a84-ef92-443e-9782-00d8224473ff", "Probir Rao", 3, 129, 71.5, 4, "A", [4, 5, 5, 5, 4, 3, 4, 3, 5, 5, 6, 5, 4, 5, 5, 5, 3, 5]),
  P("c966b87c", "9efce746-9fc0-42db-b1c0-946dbb1382b0", "A Masud", 14, 129, 71.5, 16, "A", [4, 4, 5, 5, 5, 3, 5, 4, 6, 5, 6, 5, 7, 5, 5, 4, 4, 4]),
  P("7ae9c1a2", "66cccf4b-bc8e-4895-a4ca-a33e61d2a79b", "Amit Sud", 12, 129, 71.5, 14, "B", [5, 5, 5, 5, 5, 3, 5, 3, 6, 6, 5, 4, 6, 6, 5, 5, 4, 6]),
  P("22a0bf54", "f04017ba-5bf1-4c0c-bc86-03ad552f5fd4", "Prateek Kumar Solanki", 17, 127, 69.6, 18, "B", [8, 4, 6, 5, 6, 3, 4, 4, 6, 5, 6, 5, 7, 5, 6, 5, 5, 5]),
];

const game = {
  id: GAME_ID, group_id: GROUP_ID, code: "000000", name: "Trifecta / The Architects Golf Club / Jul 5, 2026",
  course: "The Architects Golf Club", course_par: 71, holes_meta: HOLES, game_type: "trifecta",
  allowance_pct: 90, team_score_mode: "aggregate", trifecta_scoring: "match", status: "active",
  teams: [{ key: "A", name: "USA" }, { key: "B", name: "Europe" }],
  pairings: [],
  foursomes: [
    { a: [KARAN, SACHIN], b: [ASHUTOSH, BK], id: "uf1e8s", name: "Foursome 1" },
    { a: ["e93f5a84-ef92-443e-9782-00d8224473ff", "9efce746-9fc0-42db-b1c0-946dbb1382b0"], b: ["66cccf4b-bc8e-4895-a4ca-a33e61d2a79b", "ea7e006c-1fcc-42d0-ac68-8fbdf9db1c16"], id: "7t1z70", name: "Foursome 2" },
    { a: ["97c52b0f-0849-4166-a3fd-094ac3b50a70", "9b8c13c0-c65b-43b0-a38d-d75ae6ac3d28"], b: ["79ce0874-179e-4fdb-bf8f-9146b02edd0f", "f04017ba-5bf1-4c0c-bc86-03ad552f5fd4"], id: "ef08jp", name: "Foursome 3" },
  ],
  created_by: KARAN, created_at: "2026-07-05T12:00:00Z", played_at: "2026-07-05",
};

// jsdom has no matchMedia; a GameRoom effect reads it. Inert stub, test-only.
if (typeof (window as any).matchMedia !== "function") {
  (window as any).matchMedia = (media: string) => ({ matches: false, media, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
}
// Offline boot: GameRoom reads the snapshot instead of Supabase.
Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
saveGameSnapshot(GAME_ID, { game, players, altShotScores: [] });


// Mid-round: foursome 1 complete; foursomes 2 and 3 through 11 and 8 holes.
const F2 = new Set(["e93f5a84-ef92-443e-9782-00d8224473ff","9efce746-9fc0-42db-b1c0-946dbb1382b0","66cccf4b-bc8e-4895-a4ca-a33e61d2a79b","ea7e006c-1fcc-42d0-ac68-8fbdf9db1c16"]);
const F3 = new Set(["97c52b0f-0849-4166-a3fd-094ac3b50a70","9b8c13c0-c65b-43b0-a38d-d75ae6ac3d28","79ce0874-179e-4fdb-bf8f-9146b02edd0f","f04017ba-5bf1-4c0c-bc86-03ad552f5fd4"]);
const mid = players.map((p) => ({ ...p, scores: F2.has(p.user_id) ? p.scores.map((x: number, i: number) => (i < 11 ? x : null)) : F3.has(p.user_id) ? p.scores.map((x: number, i: number) => (i < 8 ? x : null)) : p.scores }));
saveGameSnapshot(GAME_ID, { game, players: mid, altShotScores: [] });
const s = renderScreen(<Tournaments session={{ user: { id: SACHIN, user_metadata: { full_name: "Sachin Manchanda" } } }} activeGroupId={GROUP_ID} openGameId={GAME_ID} />);
const outlook = s.el.querySelector("[data-points-outlook]")?.textContent || "";
ok(outlook.startsWith("If every match ended now: USA ") && outlook.includes("· Europe "), `results: outlook line present (${outlook})`);
ok(!outlook.includes("Decided") && !outlook.includes("still to play for"), "results: only the if-ended-now figures (big number and clinch line carry the rest)");
ok(s.el.querySelectorAll("[data-group-results]").length === 3, "results: three foursome cards, none embedded");
s.click("Group Card");
const embedded = (Array.from(s.el.querySelectorAll("[data-group-results]")) as HTMLElement[]).filter((e) => (e.textContent || "").startsWith("Match status"));
ok(embedded.length === 1, "group card: exactly one embedded results card beneath the scorecard");
ok(!(embedded[0]?.textContent || "").includes("your match") && !(embedded[0]?.textContent || "").includes("EUROPE"), "group card: header and pair boxes suppressed");
ok((embedded[0]?.textContent || "").includes("Team ·"), "group card: contest rows present");
try { s.unmount(); } catch { /* jsdom teardown */ }

// Every team format, same convention; no-team singles use the same table.
const pairs = [[KARAN, ASHUTOSH],[SACHIN, BK],["e93f5a84-ef92-443e-9782-00d8224473ff","66cccf4b-bc8e-4895-a4ca-a33e61d2a79b"],["9efce746-9fc0-42db-b1c0-946dbb1382b0","ea7e006c-1fcc-42d0-ac68-8fbdf9db1c16"],["97c52b0f-0849-4166-a3fd-094ac3b50a70","79ce0874-179e-4fdb-bf8f-9146b02edd0f"],["9b8c13c0-c65b-43b0-a38d-d75ae6ac3d28","f04017ba-5bf1-4c0c-bc86-03ad552f5fd4"]];
const formats: [string, any, boolean][] = [
  ["singles, teams", { ...game, game_type: "match", foursomes: [], pairings: pairs.map(([a, b]) => ({ a, b })) }, true],
  ["four-ball, teams", { ...game, game_type: "fourball", team_score_mode: "best_ball" }, true],
  ["singles, no teams", { ...game, game_type: "match", teams: null, foursomes: [], pairings: pairs.map(([a, b]) => ({ a, b })) }, false],
];
for (const [label, g, teamed] of formats) {
  saveGameSnapshot(GAME_ID, { game: g, players: mid.map((p) => (teamed ? p : { ...p, team: null })), altShotScores: [] });
  const t = renderScreen(<Tournaments session={{ user: { id: SACHIN, user_metadata: { full_name: "Sachin Manchanda" } } }} activeGroupId={GROUP_ID} openGameId={GAME_ID} />);
  const line = t.el.querySelector("[data-points-outlook]")?.textContent || "";
  if (teamed) {
    ok(line.startsWith("If every match ended now:"), `${label}: outlook line`);
    ok(!t.text.includes("Projected"), `${label}: no "Projected" wording`);
  } else {
    ok(!line, `${label}: no standings block`);
    ok(t.el.querySelectorAll("[data-pairing-card]").length === 6 && t.text.includes("PLAYERTHRUPLAYER"), `${label}: the table, headed PLAYER / THRU / PLAYER`);
  }
  if (label === "singles, teams") ok(t.text.includes("Level — either side needs"), "singles, teams: tie sentence at 1–1 (points decided and equal)");
  try { t.unmount(); } catch { /* jsdom teardown */ }
}
// 204.2: at 0–0 with nothing decided, no "Level" sentence — it read as a tied match.
{
  const fresh = players.map((p) => ({ ...p, scores: p.scores.map(() => null) }));
  saveGameSnapshot(GAME_ID, { game: { ...game, game_type: "match", foursomes: [], pairings: pairs.map(([a, b]) => ({ a, b })) }, players: fresh, altShotScores: [] });
  const t = renderScreen(<Tournaments session={{ user: { id: SACHIN, user_metadata: { full_name: "Sachin Manchanda" } } }} activeGroupId={GROUP_ID} openGameId={GAME_ID} />);
  ok(!t.text.includes("Level — either side"), "fresh game: no Level sentence at 0–0");
  try { t.unmount(); } catch { /* jsdom */ }
}
// 204.3: once every match is decided the outlook line is redundant with the big number — gone.
{
  saveGameSnapshot(GAME_ID, { game, players, altShotScores: [] }); // all 18 holes scored, all contests settled
  const t = renderScreen(<Tournaments session={{ user: { id: SACHIN, user_metadata: { full_name: "Sachin Manchanda" } } }} activeGroupId={GROUP_ID} openGameId={GAME_ID} />);
  ok(!t.el.querySelector("[data-points-outlook]"), "finished Trifecta: no 'If every match ended now' line");
  try { t.unmount(); } catch { /* jsdom */ }
}
// 207.2: a FINISHED game opens on its recap, and the recap's score is the Results block's decided score.
{
  saveGameSnapshot(GAME_ID, { game: { ...game, status: "ended" }, players, altShotScores: [] });
  const t = renderScreen(<Tournaments session={{ user: { id: SACHIN, user_metadata: { full_name: "Sachin Manchanda" } } }} activeGroupId={GROUP_ID} openGameId={GAME_ID} />);
  const head = t.el.querySelector("[data-recap-headline]")?.textContent || "";
  ok(!!head, `finished game shows the recap (${head})`);
  const m = head.match(/(\S+) beat (\S+) ([\d½]+)–([\d½]+)|(\S+) and (\S+) tied ([\d½]+)–([\d½]+)/);
  ok(!!m, "headline names the result");
  // The standings block shows "<A> <decidedA> – <B> <decidedB>"; the recap's two numbers must both appear in it.
  const block = Array.from(t.el.querySelectorAll("div")).map((d) => d.textContent || "").find((x) => /RUNNING SCORE|TEAM MATCH|TRIFECTA/i.test(x) && /–/.test(x)) || "";
  const nums = m ? [m[3] ?? m[7], m[4] ?? m[8]] : [];
  ok(nums.every((n) => block.includes(n)), `recap score (${nums.join("–")}) appears in the Results standings`);
  ok(!t.el.querySelector("[data-recap-money]") || /posted|review/.test(t.el.querySelector("[data-recap-money]")?.textContent || ""), "money status, never an amount");
  ok(!/\$\d/.test(t.el.querySelector("[data-game-recap]")?.textContent || ""), "no money amounts in the recap");
  // 207.2 recap redesign: one component, two modes.
  const app = t.el.querySelector('[data-recap-body="app"]'), img = t.el.querySelector('[data-recap-body="share"]');
  ok(!!app && !!img, "in-app recap and share image both rendered");
  ok(!!t.el.querySelector("[data-recap-share]"), "Share with the group offered (Sachin is a player, not the organizer)");
  ok(!!app?.querySelector("[data-recap-you]"), "in-app: Your day");
  ok(!img?.querySelector("[data-recap-you]") && !img?.querySelector("[data-recap-money]"), "share image: no personal line, no money status");
  ok(!/\$\d/.test(img?.textContent || ""), "share image: no amounts");
  ok(!!img?.querySelector("[data-recap-top3]") && !!img?.querySelector("[data-recap-net-birdies]") && !!img?.querySelector("[data-recap-tiles]"), "share image: top 3, net birdies, tiles");
  const nbImg = img?.querySelectorAll("[data-recap-net-birdies] > div").length ?? 0, nbApp = app?.querySelectorAll("[data-recap-net-birdies] > div").length ?? 0;
  ok(nbApp >= nbImg, "the app's net-birdie list is at least as long as the image's top 5");
  ok((img?.textContent || "").includes("Net uses each player's full Course Handicap — you against the course. Match results use the game's allowance."), "net footnote on the image (USGA terms)");
  ok((img?.textContent || "").includes("Net birdies") && (img?.textContent || "").includes("Net eagles"), "columns say Net birdies / Net eagles");
  // 209.0 order: how the field played → highlights → (standout rounds) → top 3 → net birdies.
  const at = (sel: string) => { const el = img?.querySelector(sel); return el ? Array.from(img!.querySelectorAll("*")).indexOf(el) : -1; };
  const order = ["[data-recap-scoring]", "[data-recap-course]", "[data-recap-tiles]", "[data-recap-top3]", "[data-recap-net-birdies]"].map(at);
  ok(order.every((v) => v >= 0) && order.every((v, i) => i === 0 || v > order[i - 1]), `share image in the owner's order (${order.join(" < ")})`);
  const so = at("[data-recap-standouts]");
  ok(so === -1 || (so > at("[data-recap-tiles]") && so < at("[data-recap-top3]")), "standout rounds, when shown, sit between the highlights and the top 3");
  ok(Array.from(img?.querySelectorAll("*") || []).every((e) => (e as HTMLElement).style?.textOverflow !== "ellipsis"), "no name is truncated with an ellipsis");
  try { t.unmount(); } catch { /* jsdom */ }
}
// An ACTIVE game shows no recap.
{
  saveGameSnapshot(GAME_ID, { game: { ...game, status: "active" }, players, altShotScores: [] });
  const t = renderScreen(<Tournaments session={{ user: { id: SACHIN, user_metadata: { full_name: "Sachin Manchanda" } } }} activeGroupId={GROUP_ID} openGameId={GAME_ID} />);
  ok(!t.el.querySelector("[data-game-recap]"), "an active game shows no recap");
  try { t.unmount(); } catch { /* jsdom */ }
}
report("results outlook + embedded group card + all formats");
