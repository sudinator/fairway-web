/** 212.38 — ONE-STEP CREATION, PHASE 1: pin what today's Create step saves for every format combination.
 * ci/golden/create-behaviour.json is the yardstick. Any change to what Create saves fails here, field by field.
 * To accept an INTENDED change: UPDATE_CREATE_GOLDEN=1 node .testout-screens/lib/create-behaviour.test.js, and say why
 * in DEPLOY_NOTES. */
import * as fs from "fs";
import * as path from "path";
import { ok, report } from "./screen-harness";
import { reachableFormatKeys, skinsStyleFromState } from "@/lib/create-game-format";
import { createBehaviour, behaviourCases } from "@/lib/create-behaviour";
import { defaultAllowanceFor } from "@/lib/game-create";

const keys = reachableFormatKeys();
ok(keys.length === 20, `20 reachable combinations (got ${keys.length})`);
const records = behaviourCases(keys).map(createBehaviour);

// 1. the replayed clicks land on the combination each key names
for (const r of records.slice(0, keys.length)) {
  const f = r.format, [type, a, b, c] = r.key.split(":");
  const want: Record<string, unknown> = { gameType: type };
  if (type === "stroke") want.strokeBasis = a;
  if (type === "match") want.teamMode = a === "team";
  if (type === "fourball") want.teamScoreMode = b;
  if (type === "trifecta") want.teamScoreMode = a;
  if (type === "skins") { want.skinsStyle = a; want.skinsMode = a === "team_2v2" ? c : b; if (a === "team_2v2") want.teamScoreMode = b; }
  if (type === "scramble") want.scrambleMode = a;
  const got: Record<string, unknown> = { gameType: f.gameType, strokeBasis: f.strokeBasis, teamMode: f.teamMode, teamScoreMode: f.teamScoreMode,
    skinsStyle: skinsStyleFromState(f), skinsMode: f.skinsMode, scrambleMode: (r.game as { scramble_mode?: string }).scramble_mode };
  const bad = Object.keys(want).filter((k) => got[k] !== want[k]);
  ok(bad.length === 0, `${r.key}: the replayed buttons reach it (${bad.map((k) => `${k}=${String(got[k])}≠${String(want[k])}`).join(", ") || "ok"})`);
  ok(f.allowancePct === defaultAllowanceFor(f.gameType), `${r.key}: starts at its format's allowance (${f.allowancePct}%)`);
}

// 2. everything Create saves matches the golden record
const file = path.resolve(process.cwd(), "ci/golden/create-behaviour.json");
const now = JSON.stringify(records, null, 1) + "\n";
if (process.env.UPDATE_CREATE_GOLDEN === "1") { fs.writeFileSync(file, now); console.log(`wrote ${file} (${records.length} cases)`); }
const golden: typeof records = JSON.parse(fs.readFileSync(file, "utf8"));
ok(golden.length === records.length, `the golden file covers every case (${golden.length} vs ${records.length})`);
for (const r of records) {
  const g = golden.find((x) => x.id === r.id);
  if (!g) { ok(false, `${r.id}: missing from the golden file`); continue; }
  const diff = (Object.keys(r) as (keyof typeof r)[]).filter((k) => JSON.stringify(r[k]) !== JSON.stringify(g[k]));
  ok(diff.length === 0, `${r.id}: what Create saves is unchanged${diff.length ? ` — differs in ${diff.join(", ")}` : ""}`);
}
report("create behaviour");
