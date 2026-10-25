/** 212.39 — ONE-STEP CREATION, PHASE 1 (part 2): the calls Manage Game makes for every format are pinned in
 * ci/assert-structure-behaviour.sql (replayed on a real database by the fresh-database tests). This test regenerates
 * the file from the current code and fails if it differs — so any change to WHAT Manage Game sends shows up here, and
 * any change to WHAT the server stores shows up in the database test. */
import * as fs from "fs";
import * as path from "path";
import { ok, report } from "./screen-harness";
import { reachableFormatKeys } from "@/lib/create-game-format";
import { structureCases, renderStructureSql, STRUCTURE_GOLDEN_START, STRUCTURE_GOLDEN_END } from "@/lib/structure-behaviour";

const file = path.resolve(process.cwd(), "ci/assert-structure-behaviour.sql");
const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
const m = existing.match(new RegExp(`${STRUCTURE_GOLDEN_START}\\n'([\\s\\S]*?)'\\n${STRUCTURE_GOLDEN_END}`));
const golden = m ? m[1].replace(/''/g, "'") : "{}";
const cases = structureCases(reachableFormatKeys());
const sql = renderStructureSql(cases, golden);
if (process.env.UPDATE_STRUCTURE_SQL === "1") { fs.writeFileSync(file, sql); console.log(`wrote ${file} (${cases.length} cases)`); }
ok(cases.length >= 24, `every format Create can make is covered (${cases.length} cases)`);
ok(golden !== "{}", "the golden record of what Manage Game stores is filled in");
// a game Create already finishes (4 players, one group, no teams) needs no Manage Game calls
for (const c of cases) ok(c.ops.length > 0 || c.id.endsWith("· 4 players"), `${c.id}: the organizer's choices make calls (${c.ops.length})`);
ok((fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "") === sql, "ci/assert-structure-behaviour.sql matches what Manage Game sends today (regenerate with UPDATE_STRUCTURE_SQL=1 if the change is intended)");
report("structure behaviour");
