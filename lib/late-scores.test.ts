/** 212.50 — the phone's side of late scores (lib/late-scores): what it recognises, what it says, when it holds and
 * resumes — and that it listens for exactly the code the server raises (migration 0222). */
import * as fs from "fs";
import * as path from "path";
import { ok, report } from "./screen-harness";
import { LATE_SCORE_CODE, isLateScoreRefusal, lateScoreNotice, lateScoreHold, keepsSideScores } from "@/lib/late-scores";

const mig = fs.readFileSync(path.resolve(process.cwd(), "migrations/0222_setup_locks_at_server.sql"), "utf8");
const serverCodes = [...mig.matchAll(/errcode = '(BN\d+)'/g)].map((m) => m[1]);
ok(serverCodes.length >= 2 && serverCodes.every((c) => c === LATE_SCORE_CODE), `the phone listens for the code the server raises for late scores (${LATE_SCORE_CODE}; server: ${[...new Set(serverCodes)]})`);
ok(isLateScoreRefusal({ code: "BN164" }) && !isLateScoreRefusal({ code: "BN163" }) && !isLateScoreRefusal({ code: "55000" }) && !isLateScoreRefusal(null), "only the late-score refusal is treated as one (not a reset, not a setup lock, not success)");
ok(lateScoreNotice(3) === "This game has ended, so 3 scores on this phone weren't added. They're kept on this phone — ask the organizer to reopen the game if they should count.", `the message, plural ("${lateScoreNotice(3)}")`);
ok(lateScoreNotice(1).includes("1 score on this phone wasn't") === false && lateScoreNotice(1).includes("1 score on this phone weren't"), "the message, one score");
ok(lateScoreNotice(0).includes("the latest scores on this phone"), "the message when the count is unknown");
ok(lateScoreNotice(5).includes("kept on this phone") && lateScoreNotice(5).includes("reopen"), "it says the scores are kept, and how they can still count");
ok(JSON.stringify(lateScoreHold({ refused: false, status: "ended" })) === '{"hold":false,"resume":false}', "nothing refused: nothing held");
ok(JSON.stringify(lateScoreHold({ refused: true, status: "ended" })) === '{"hold":true,"resume":false}', "refused and still ended: hold (no endless retries)");
ok(JSON.stringify(lateScoreHold({ refused: true, status: "active" })) === '{"hold":false,"resume":true}', "refused, then reopened: resume sending");
ok(keepsSideScores("scramble") && keepsSideScores("alt_shot") && !keepsSideScores("fourball") && !keepsSideScores("stableford"), "team / side scores counted only in scramble and alternate shot");
report("late scores");
