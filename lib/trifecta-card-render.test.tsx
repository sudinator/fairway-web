/**
 * RENDERED CHECK — the Trifecta player card on screen, not the engine in isolation.
 *
 * lib/trifecta-card-scoring.test.ts proves computeTrifecta returns 2UP/5UP for Sachin when told
 * the game is match-scored. ci/check_trifecta_scoring_argument.py proves the card passes that
 * argument. Neither opens the screen. This does: it mounts the real Tournaments → GameRoom →
 * ScoreEntryCard chain with the Jul 5 Architects rows and reads the running strip off the DOM.
 *
 * GameRoom boots from its localStorage snapshot when navigator.onLine is false — the offline cold
 * launch path — so no Supabase stub is needed and the component under test is the production one.
 */
import { renderScreen, eq, ok, report } from "./screen-harness";
import * as React from "react";
import Tournaments from "@/components/tournaments";
import { saveGameSnapshot } from "@/lib/draft";
import { computeTrifecta, matchLeadLabel } from "@/lib/golf";
import { chBasis } from "@/lib/game-shape";

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

function stripFor(viewerUserId: string, viewerName: string): (string | null)[] {
  const s = renderScreen(
    <Tournaments
      session={{ user: { id: viewerUserId, user_metadata: { full_name: viewerName } } }}
      activeGroupId={GROUP_ID}
      openGameId={GAME_ID}
    />,
  );
  const labels: (string | null)[] = [];
  for (let i = 0; i < 18; i++) {
    const card = s.el.querySelector(`#sehole-${i}`);
    if (!card) { labels.push(null); continue; }
    // The running label is rendered in its own element; read that element, not the concatenated
    // card text (which glues the Stableford points digit onto it).
    const el = Array.from(card.querySelectorAll("*")).find((e) => /^(\d+UP|\d+DN|AS)$/.test((e.textContent || "").trim()) && e.children.length === 0);
    labels.push(el ? (el.textContent || "").trim() : "");
  }
  s.unmount();
  return labels;
}

console.log("trifecta card render — Architects Jul 5, Foursome 1");

const sachin = stripFor(SACHIN, "Sachin Manchanda");
ok(sachin.every((l) => l != null), "all 18 hole cards rendered for Sachin");
eq(sachin[12], "1UP", "Sachin's card thru 13 reads 1UP (agrees under both bases)");
eq(sachin[13], "2UP", "Sachin's card thru 14 reads 2UP — pair basis (Results), not 1UP (four-ball basis, 182.0)");
eq(sachin[17], "5UP", "Sachin's card thru 18 reads 5UP — matches Results 5 UP / 4 & 2, not 4UP");
// Whole strip must equal what the Results page computes for the same single (match scoring).
const f1 = game.foursomes[0];
const members = [...f1.a, ...f1.b].map((uid) => { const r = players.find((q) => q.user_id === uid)!; return { id: uid, gross: r.scores, ch: chBasis(r, 71, 18), noShow: false }; });
const results = computeTrifecta(HOLES, members, f1.a, f1.b, 90, "aggregate", false, "match");
const single = results.contests.find((c) => c.kind === "single" && c.aIds[0] === SACHIN)!;
const expected = single.perHole.map((h) => matchLeadLabel(h.aRun - h.bRun));
eq(sachin.join(" "), expected.join(" "), "Sachin's full 18-hole strip equals the Results-page single hole for hole");

// The opponent's card is the mirror image.
const bk = stripFor(BK, "BK Jain");
eq(bk[13], "2DN", "BK's card thru 14 reads 2DN");
eq(bk[17], "5DN", "BK's card thru 18 reads 5DN");

// Immune single: Karan is the low under both bases, so his card is unchanged by the fix.
const karan = stripFor(KARAN, "Karan Sarin");
eq(karan[17], "4DN", "Karan's card thru 18 reads 4DN (Results: Ashutosh 3 & 1)");

report("trifecta card render");
