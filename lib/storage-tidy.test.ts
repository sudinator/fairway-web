// 212.26 — a full storage area must not lose scores (owner, Oct 23: on staging every score backup failed silently once
// the site's storage was full; the writer found "nothing to send" and the next refresh wiped the entry).
import { ok, report } from "./screen-harness";
import { saveGameScores, loadGameScores } from "./draft";
import * as D from "./draft";
import { tidyScoringStorage, storageWriteFailed, scoringStorage, __setScoringIdentityForTest } from "./scoring-device";
import { saveAltShotDraft } from "./alt-shot-side-scores";
import { measureStorage } from "@/components/storage-meter";
import { createGameScoreWriter } from "./game-score-sync";

const ls = window.localStorage;
const St = (window as unknown as { Storage: typeof globalThis.Storage }).Storage;
const realSet = St.prototype.setItem;
const used = () => { let n = 0; for (let i = 0; i < ls.length; i++) { const k = ls.key(i)!; n += k.length + (ls.getItem(k) || "").length; } return n; };
let LIMIT = Infinity;
St.prototype.setItem = function (this: globalThis.Storage, k: string, v: string) {
  const prev = this.getItem(k) || "";
  if (used() - prev.length + k.length + v.length > LIMIT) { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; }
  return realSet.call(this, k, v);
};
const big = "x".repeat(20000);
const bundle = { scores: [5, ...Array(17).fill(null)], putts: [], fairways: [], penalties: [], sand: [] };

// 1. what staging accumulated: an ever-growing archive, old identities' backups, old snapshots — and a full area
ls.clear();
ls.setItem("bnn_scoring_recovery_v1", JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ at: new Date(Date.now() - i * 3600e3).toISOString(), data: { k: big } }))));
for (let t = 0; t < 6; t++) ls.setItem(`bnn_device_scores::old-token-${t}:bnn_game_scores_g_p`, JSON.stringify({ at: Date.now() - 45 * 86400e3, scores: [big] }));   // abandoned: 45 days old
ls.setItem("bnn_device_scores::recent-token:bnn_game_scores_g_p", JSON.stringify({ at: Date.now() - 3600e3, scores: [4] }));   // recent: may resume
for (let g = 0; g < 5; g++) ls.setItem(`bnn_game_snap_old${g}`, JSON.stringify({ at: Date.now() - 40 * 86400e3, game: big }));
LIMIT = used() + 100;   // the area is now full
let threw = false;
try { ls.setItem("probe", big); } catch { threw = true; }
ok(threw, "the simulated storage area is full (a direct write is refused)");
saveGameScores("g", "p", bundle, true, undefined, 0);
ok(loadGameScores("g", "p")?.scores?.[0] === 5, "a score backup SUCCEEDS on a full area — tidied, then retried");
ok(JSON.parse(ls.getItem("bnn_scoring_recovery_v1") || "[]").length === 3, "the recovery archive is capped at its 3 newest entries");
ok(!Array.from({ length: ls.length }, (_, i) => ls.key(i)!).some((k) => k.startsWith("bnn_game_snap_old")), "game snapshots not opened for 30 days are removed");
ok(ls.getItem("bnn_device_scores::recent-token:bnn_game_scores_g_p") != null, "another identity's RECENT backup is kept (offline work may resume)");
ok(Array.from({ length: ls.length }, (_, i) => ls.key(i)!).some((k) => k.includes("old-token-")), "with no settled identity yet, nobody's backups are removed (it can't tell which is current)");

// 2. storage that can't be freed: the failure is FLAGGED (shown on screen), not swallowed
ls.clear(); LIMIT = 10;
saveGameScores("g", "q", bundle, true, undefined, 0);
ok(D.backupWriteFailed === true && loadGameScores("g", "q") == null, "nothing can be freed: the failure is flagged for the on-screen warning");
LIMIT = Infinity; St.prototype.setItem = realSet;

// 212.28 — synced game backups over 30 days old go; unsynced or recent ones stay
ls.clear();
const old = Date.now() - 45 * 86400e3, row = (scores: (number | null)[], at: number) => JSON.stringify({ at, scores, putts: [], fairways: [], penalties: [], sand: [] });
const ss = scoringStorage();   // backups are written under the device identity, as the app does
ss.setItem("bnn_game_scores_gOld_p", row([4, 5], old)); ss.setItem("bnn_game_wm_gOld_p", row([4, 5], old));          // synced, old
ss.setItem("bnn_game_scores_gPend_p", row([4, 6], old)); ss.setItem("bnn_game_wm_gPend_p", row([4, null], old));      // old, NOT synced
ss.setItem("bnn_game_scores_gNew_p", row([4, 5], Date.now())); ss.setItem("bnn_game_wm_gNew_p", row([4, 5], Date.now())); // synced, recent
tidyScoringStorage();
ok(ss.getItem("bnn_game_scores_gOld_p") == null && ss.getItem("bnn_game_wm_gOld_p") == null, "a synced game backup over 30 days old is removed (with its confirmed copy)");
ok(ss.getItem("bnn_game_scores_gPend_p") != null, "an old backup with scores NOT yet uploaded is kept");
ok(ss.getItem("bnn_game_scores_gNew_p") != null, "a recent synced backup is kept");

// 212.28 — a team-score draft on a full storage area doesn't throw (the score is still sent), and is flagged
LIMIT = 10; St.prototype.setItem = function (this: globalThis.Storage, k: string, v: string) { if (k.length + v.length > LIMIT) { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; } return realSet.call(this, k, v); };
let threwDraft = false;
try { saveAltShotDraft("g", { foursomeId: "t1", side: "a", holeIndex: 0, strokes: 4, at: Date.now(), scoringVersion: 0 } as never); } catch { threwDraft = true; }
ok(!threwDraft && storageWriteFailed(), "a team-score draft on a full storage area: no throw (the score is still sent), and flagged for the warning");
St.prototype.setItem = realSet; LIMIT = Infinity;

// 212.29b — resume used to COPY every backup to each new identity (8.7 MB on a staging phone): duplicates go
__setScoringIdentityForTest("u", "cur");
ls.clear();
const B = (scores: (number | null)[], at: number) => JSON.stringify({ at, scores, putts: [], fairways: [], penalties: [], sand: [] });
const day = 86400e3;
// 212.31: ONE timestamp for the pair. Two separate Date.now() reads could land in different milliseconds on a slow CI
// runner, making the "exact duplicate" not exact — the tidy then rightly kept it and this test failed (GitHub, Oct 23).
const AT = Date.now();
ls.setItem("bnn_device_scores:u:cur:bnn_game_scores_g1_p", B([4, 5], AT));
ls.setItem("bnn_device_scores:u:old:bnn_game_scores_g1_p", B([4, 5], AT));                                  // exact duplicate
ls.setItem("bnn_device_scores:u:old:bnn_game_scores_g2_p", B([4, 5], Date.now() - 5 * day)); ls.setItem("bnn_device_scores:u:old:bnn_game_wm_g2_p", B([4, 5], Date.now() - 5 * day)); // uploaded, 5 days
ls.setItem("bnn_device_scores:u:old:bnn_game_scores_g3_p", B([4, 6], Date.now() - 5 * day)); ls.setItem("bnn_device_scores:u:old:bnn_game_wm_g3_p", B([4, null], Date.now() - 5 * day)); // NOT uploaded
ls.setItem("bnn_device_scores:u:old:bnn_game_scores_g4_p", B([4, 5], Date.now() - day)); ls.setItem("bnn_device_scores:u:old:bnn_game_wm_g4_p", B([4, 5], Date.now() - day));     // uploaded, 1 day
tidyScoringStorage();
ok(ls.getItem("bnn_device_scores:u:old:bnn_game_scores_g1_p") == null && ls.getItem("bnn_device_scores:u:cur:bnn_game_scores_g1_p") != null, "an exact duplicate under an old identity is removed; the current copy stays");
ok(ls.getItem("bnn_device_scores:u:old:bnn_game_scores_g2_p") == null, "a fully uploaded old-identity backup over 2 days old is removed");
ok(ls.getItem("bnn_device_scores:u:old:bnn_game_scores_g3_p") != null, "old-identity work NOT yet uploaded is kept");
ok(ls.getItem("bnn_device_scores:u:old:bnn_game_scores_g4_p") != null, "a recent (1 day) uploaded old-identity backup is kept");
__setScoringIdentityForTest("", "");

// the storage meter's figures
ls.clear(); ls.setItem("bnn_game_scores_x_y", "a".repeat(100)); ls.setItem("bnn_game_snap_z", "b".repeat(50)); ls.setItem("other", "c");
const rep = measureStorage(ls);
ok(rep.items === 3 && rep.kinds[0].label === "Score backups" && rep.bytes === ((19 + 100) + (15 + 50) + (5 + 1)) * 2, `the storage meter adds up (got ${rep.bytes} bytes, ${rep.kinds.map((k) => k.label)})`);

// 3. the writer sends from MEMORY when the backup is missing (it used to find "nothing to send")
(async () => {
  const sends: unknown[] = [];
  const mem = new Map([["p", bundle]]);
  let wm: unknown = null;
  const w = createGameScoreWriter({ backup: (id) => (mem.get(id) ?? null) as never, watermark: () => wm as never, confirm: (_id, b) => { wm = b; }, locked: () => false, paused: () => false, revision: () => {},
    send: async (_id, body) => { sends.push(body); return true; } });
  const okd = await w.write("p");
  ok(okd && sends.length === 1 && (sends[0] as { scores: number[] }).scores[0] === 5, "no phone backup: the entry is sent from memory");
  ok(tidyScoringStorage() >= 0, "tidying is safe to call any time");
  report("storage tidy");
})();
