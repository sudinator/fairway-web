#!/usr/bin/env node
// Dependency currency monitor. Checks the installed major of the packages that actually carry
// security/EOL risk against the latest published on the npm registry, and prints a loud ALERT when
// we fall a major behind. Runs inside `npm run ci`, so it surfaces on every build; also runnable
// on its own via `npm run deps:check`. Non-blocking by default (a warning, not a hard failure) so a
// new upstream major never stops a deploy — but it makes drift impossible to miss silently again.
//
// This is the mechanical backstop. The PRIMARY alerting for the admin is GitHub Dependabot (opens
// PRs / security alerts directly on the repo) — see SECURITY_CHECKLIST.md for enabling it.

import { readFileSync } from "node:fs";

// NOTE: typescript is intentionally held at 5.x — Next.js rejects TypeScript >= 7.0. The monitor
// will flag it as "behind"; that flag is expected and should be IGNORED until Next supports TS 7.
const WATCH = ["next", "react", "react-dom", "@supabase/supabase-js", "@supabase/ssr", "typescript"];
const HELD = { typescript: "held at 5.x — Next.js rejects TS >= 7.0" };
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };

const majorOf = (v) => parseInt(String(v).replace(/^[^\d]*/, "").split(".")[0], 10);

async function latest(name) {
  try {
    const res = await fetch(`https://registry.npmjs.org/${name}/latest`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return (await res.json()).version;
  } catch { return null; }
}

const rows = [];
let behind = 0, unknown = 0;
for (const name of WATCH) {
  const installed = deps[name];
  if (!installed) continue;
  const latestV = await latest(name);
  if (!latestV) { rows.push([name, installed, "?", "registry unreachable"]); unknown++; continue; }
  const gap = majorOf(latestV) - majorOf(installed);
  const held = HELD[name];
  const flag = held ? `held (${held})` : gap >= 1 ? `⚠️  ${gap} MAJOR${gap > 1 ? "S" : ""} BEHIND` : "ok";
  if (gap >= 1 && !held) behind++;
  rows.push([name, String(installed), latestV, flag]);
}

console.log("\n=== dependency currency ===");
for (const [n, i, l, f] of rows) console.log(`  ${n.padEnd(26)} installed ${i.padEnd(12)} latest ${String(l).padEnd(12)} ${f}`);

if (behind > 0) {
  console.log(`\nDEPENDENCY ALERT: ${behind} watched package(s) are at least one MAJOR version behind.`);
  console.log("Plan a dedicated upgrade pass (framework majors need manual QA — no differential test covers them).");
  console.log("Ensure GitHub Dependabot is enabled for direct admin alerts (Settings → Code security).");
} else if (unknown > 0) {
  console.log("\n(dependency check: registry unreachable for some packages — network-restricted build, skipping)");
} else {
  console.log("\ndependency currency: all watched majors current.");
}
// Intentionally exit 0 — informational, never blocks a deploy.
