/** 212.40 — the one-step equivalence test (ci/assert-create-game-complete.sql) is generated from the phase-1 cases and
 * golden record; this test fails if the committed file is stale. Regenerate: UPDATE_CREATE_COMPLETE_SQL=1. */
import * as fs from "fs";
import * as path from "path";
import { ok, report } from "./screen-harness";
import { reachableFormatKeys } from "@/lib/create-game-format";
import { structureCases, renderCreateCompleteSql } from "@/lib/create-complete-behaviour";
import { STRUCTURE_GOLDEN_START, STRUCTURE_GOLDEN_END } from "@/lib/structure-behaviour";

const phase1 = fs.readFileSync(path.resolve(process.cwd(), "ci/assert-structure-behaviour.sql"), "utf8");
const m = phase1.match(new RegExp(`${STRUCTURE_GOLDEN_START}\\n'([\\s\\S]*?)'\\n${STRUCTURE_GOLDEN_END}`));
ok(!!m, "the phase-1 golden record is readable");
const golden = m ? m[1].replace(/''/g, "'") : "{}";
const cases = structureCases(reachableFormatKeys());
const sql = renderCreateCompleteSql(cases, golden);
const file = path.resolve(process.cwd(), "ci/assert-create-game-complete.sql");
if (process.env.UPDATE_CREATE_COMPLETE_SQL === "1") { fs.writeFileSync(file, sql); console.log(`wrote ${file} (${cases.length} cases)`); }
ok(Object.keys(JSON.parse(golden)).length === cases.length, `one golden entry per case (${cases.length})`);
ok(fs.existsSync(file) && fs.readFileSync(file, "utf8") === sql, "ci/assert-create-game-complete.sql matches the phase-1 cases and golden record (regenerate with UPDATE_CREATE_COMPLETE_SQL=1)");
report("create game complete");
