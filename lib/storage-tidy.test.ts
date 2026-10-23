// 212.26 — a full storage area must not lose scores (owner, Oct 23: on staging every score backup failed silently once
// the site's storage was full; the writer found "nothing to send" and the next refresh wiped the entry).
import { ok, report } from "./screen-harness";
import { saveGameScores, loadGameScores } from "./draft";
import * as D from "./draft";
import { tidyScoringStorage } from "./scoring-device";
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
