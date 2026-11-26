// 212.130 — sign-out can no longer discard unsynced scores. The review harness showed the old clearAllLocalState removing a
// pending personal round, another identity's pending game score and the recovery archive, before the sign-out result
// was known. Each of those is a case here, run against the REAL helpers and storage.
import { ok, report } from "./screen-harness";
import { unsyncedWork, clearLocalStateForSignOut, signOutSafely } from "./sign-out";
import { rowPendingHoles, personalRoundFingerprint } from "./draft";
import { SCORING_ARCHIVE_KEY, SCORING_OWNER_KEY } from "./scoring-device";

const ls = window.localStorage;
const ME = "user-me", OTHER = "user-other";
const out = (uid: string, tok: string, key: string) => `bnn_device_scores:${uid}:${tok}:${key}`;
const bundle = (first: number | null) => ({ scores: [first, ...Array(17).fill(null)], putts: [], fairways: [], penalties: [], sand: [] });
const round = { id: "r1", course: "Oak Hollow", played_at: "2026-11-20", holes: [{ hole_number: 1, par: 4, strokes: 5, putts: 2 }], status: "in_progress" } as any;

function seed() {
  ls.clear(); window.sessionStorage.clear();
  // mine: a game score with one hole not yet confirmed (no watermark), and a personal round draft with scores but no ack
  ls.setItem(out(ME, "t1", "bnn_game_scores_g1_p1"), JSON.stringify(bundle(5)));
  ls.setItem(`bnn_game_snap_g1`, JSON.stringify({ game: { name: "Saturday Stableford", code: "481207" }, players: [{ id: "p1", display_name: "Amit" }] }));
  ls.setItem(out(ME, "t1", "bnn_round_draft_v1"), JSON.stringify({ savedAt: Date.now(), round }));
  // mine, synced: a game score whose watermark matches (display cache, not pending)
  ls.setItem(out(ME, "t1", "bnn_game_scores_g2_p1"), JSON.stringify(bundle(4)));
  ls.setItem(out(ME, "t1", "bnn_game_wm_g2_p1"), JSON.stringify(bundle(4)));
  // another identity's pending game score on the same phone
  ls.setItem(out(OTHER, "t9", "bnn_game_scores_g3_p2"), JSON.stringify(bundle(6)));
  // the recovery archive, this phone's device owner, shared caches
  ls.setItem(SCORING_ARCHIVE_KEY, JSON.stringify([{ user: OTHER, at: new Date().toISOString(), data: { k: "v" } }]));
  ls.setItem(SCORING_OWNER_KEY, JSON.stringify({ user: ME, token: "t1" }));
  ls.setItem("bnn_app_boot_v1", JSON.stringify({ profile: { id: ME } }));
  ls.setItem("bnn_active_game_v1", JSON.stringify({ gameId: "g1", tab: "play" }));
  window.sessionStorage.setItem(`bnn_primary_tab_${ME}`, "t1");
  ls.setItem("unrelated", "keep");
}

async function main() {
  // 1. the scan finds exactly the unsynced work, under any identity
  seed();
  let items = unsyncedWork(ls);
  ok(items.length === 3, `three unsynced items found (got ${items.length}: ${items.map((i) => i.label).join(" | ")})`);
  ok(items.some((i) => i.label.includes("Saturday Stableford · #481207 · Amit: 1 hole not yet synced")), "a pending game score is named by game, code and player");
  ok(items.some((i) => i.label.includes("Round at Oak Hollow · 2026-11-20: scores not yet saved")), "a personal round with scores and no server ack is pending");
  ok(items.some((i) => i.key.startsWith(`bnn_device_scores:${OTHER}:`)), "another identity's pending score counts too");
  ok(!items.some((i) => i.key.includes("g2")), "a synced backup (watermark matches) is not pending");
  ok(rowPendingHoles(bundle(5), null) === 1, "sanity: one hole differs from an absent watermark");
  // an acknowledged personal round is no longer pending
  ls.setItem(out(ME, "t1", "bnn_round_sync_v1"), JSON.stringify({ id: "r1", signature: personalRoundFingerprint(round) }));
  ok(unsyncedWork(ls).length === 2, "a server-acknowledged round draft is not pending");

  // 2. cleanup is scoped: the archive and the other identity's outbox survive; mine and the shared caches go
  seed();
  const removed = clearLocalStateForSignOut(ME, ls);
  ok(ls.getItem(SCORING_ARCHIVE_KEY) !== null, "the recovery archive survives sign-out");
  ok(ls.getItem(out(OTHER, "t9", "bnn_game_scores_g3_p2")) !== null, "another identity's pending score survives sign-out");
  ok(ls.getItem(out(ME, "t1", "bnn_game_scores_g1_p1")) === null, "the signed-out member's outbox is removed");
  ok(ls.getItem("bnn_app_boot_v1") === null && ls.getItem("bnn_active_game_v1") === null && ls.getItem("bnn_game_snap_g1") === null, "shared caches and resume markers are removed");
  ok(ls.getItem(SCORING_OWNER_KEY) === null, "the device-owner marker of the signed-out member is removed");
  ok(window.sessionStorage.getItem(`bnn_primary_tab_${ME}`) === null, "the session tab marker is removed");
  ok(ls.getItem("unrelated") === "keep", "non-BNN keys are untouched");
  ok(removed.length === 8, `eight keys removed (got ${removed.length}: ${removed.join(", ")})`);
  seed(); ls.setItem(SCORING_OWNER_KEY, JSON.stringify({ user: OTHER, token: "t9" }));
  clearLocalStateForSignOut(ME, ls);
  ok(ls.getItem(SCORING_OWNER_KEY) !== null, "another identity's device-owner marker survives");

  // 3. the flow: a refused question changes nothing; a failed sign-out changes nothing; a confirmed one archives then clears
  seed();
  const asked: string[] = [], notes: string[] = [];
  let answer = false, signOuts = 0;
  const deps = (error: { message: string } | null) => ({
    signOut: async () => { signOuts++; return { error }; },
    confirm: async (q: { title: string; message: string }) => { asked.push(`${q.title}\n${q.message}`); return answer; },
    notify: (m: string) => { notes.push(m); }, storage: ls,
  });
  ok((await signOutSafely(ME, deps(null))) === false, "declining the question keeps the member signed in");
  ok(asked.length === 1 && asked[0].includes("haven’t synced") && asked[0].includes("Saturday Stableford") && asked[0].includes("Oak Hollow"), "the question names the unsynced work");
  ok(signOuts === 0 && ls.getItem(out(ME, "t1", "bnn_game_scores_g1_p1")) !== null, "nothing signed out or removed after Cancel");
  answer = true;
  ok((await signOutSafely(ME, deps({ message: "offline" }))) === false, "a failed sign-out reports false");
  ok(notes.length === 1 && notes[0].includes("Nothing on this phone was removed"), "the member is told nothing was removed");
  ok(ls.getItem(out(ME, "t1", "bnn_game_scores_g1_p1")) !== null && ls.getItem("bnn_app_boot_v1") !== null, "a failed sign-out leaves every key in place");
  ok((await signOutSafely(ME, deps(null))) === true, "a confirmed sign-out completes");
  const archive = JSON.parse(ls.getItem(SCORING_ARCHIVE_KEY) || "[]");
  ok(archive.length === 2 && archive[1].user === ME && archive[1].data[out(ME, "t1", "bnn_game_scores_g1_p1")] !== undefined, "the member's pending work is archived once, after the sign-out succeeded and before the clear");
  ok(ls.getItem(out(ME, "t1", "bnn_game_scores_g1_p1")) === null && ls.getItem(out(OTHER, "t9", "bnn_game_scores_g3_p2")) !== null, "after sign-out: mine removed, the other identity's kept");
  // 4. nothing pending: no question, straight through
  ls.clear(); ls.setItem("bnn_app_boot_v1", "{}"); asked.length = 0;
  ok((await signOutSafely(ME, deps(null))) === true && asked.length === 0 && ls.getItem("bnn_app_boot_v1") === null, "with nothing pending there is no question and the cache is cleared");
  report("sign-out");
}
main().catch((e) => { console.error(e); process.exit(1); });
