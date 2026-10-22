#!/usr/bin/env node
// 212.16 — photograph the design gallery (lib/design-gallery.tsx) at phone width. Every new or changed screen is
// reviewed this way before it ships (HANDOFF.md).
//   npm run gallery            → PNGs in ./.design-gallery/
// Needs Playwright's Chromium (npx playwright install chromium), or PLAYWRIGHT_CHROMIUM=/path/to/chrome.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const out = path.resolve(process.argv[2] || ".design-gallery");
execSync("npx tsc -p tsconfig.screens.json && node ci/patch_test_aliases.mjs .testout-screens", { stdio: "ignore" });
execSync(`node .testout-screens/lib/design-gallery.js ${JSON.stringify(out)}`, { stdio: "inherit", env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "x" } });
const { chromium } = require("playwright");
const found = ["/opt/pw-browsers"].flatMap((d) => { try { return fs.readdirSync(d).filter((x) => x.startsWith("chromium_headless_shell")).map((x) => path.join(d, x, "chrome-linux", "headless_shell")); } catch { return []; } }).find((p) => fs.existsSync(p));
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM || found ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM || found } : {});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
for (const f of fs.readdirSync(out).filter((x) => x.endsWith(".html")).sort()) {
  await page.goto("file://" + path.join(out, f));
  await page.screenshot({ path: path.join(out, f.replace(/\.html$/, ".png")), fullPage: true });
}
await browser.close();
console.log(`photographed → ${out}`);
