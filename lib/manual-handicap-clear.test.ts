/** 212.75 — clearing a manual course-handicap override (lib/manual-handicap.test.ts holds the 0153 rules) stores the DERIVED figure (production game 947286: 13 v 18). */
import { ok, report } from "./screen-harness";
import { manualHandicapPatch } from "@/lib/manual-handicap";
const ankur = { handicap_index: 13, rating: 72.4, slope: 138 };   // 13 × 138/113 + (72.4 − 72) = 16.3 → … the owner's case: index 13 → CH 18 on his tee
const cleared = manualHandicapPatch(ankur, 72, null, "u-amit");
ok(cleared.course_handicap_source === "derived" && cleared.course_handicap === Math.round(13 * (138 / 113) + (72.4 - 72)) && cleared.course_handicap_set_by === null, `clearing stores the derived figure (got ${JSON.stringify(cleared)})`);
const set = manualHandicapPatch(ankur, 72, 13, "u-amit", new Date("2026-10-30T12:00:00Z"));
ok(set.course_handicap === 13 && set.course_handicap_source === "manual" && set.course_handicap_set_by === "u-amit" && set.course_handicap_set_at === "2026-10-30T12:00:00.000Z", "setting stores the manual number, who and when");
const noTee = manualHandicapPatch({ handicap_index: 13, rating: null, slope: null }, 72, null, "u-amit");
ok(noTee.course_handicap === null && noTee.course_handicap_source === "derived", "clearing with no tee data stores no figure (as a join would)");
report("manual handicap");
