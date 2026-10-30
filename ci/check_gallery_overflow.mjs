// 212.72 (owner, Oct 29: the Cup roster "does not fit in the width of the phone screen. This breaks the display rule we
// already have in place") — EVERY design-gallery screen is laid out at phone width and must not scroll sideways.
// Runs the gallery's HTML through headless Chromium (no screenshots) and fails on any page wider than the viewport.
import { chromium } from "playwright";
import fs from "fs"; import path from "path"; import { execSync } from "child_process";
const out = "/tmp/bnn-gallery-overflow";
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
if (!fs.existsSync(".testout-screens/lib/design-gallery.js")) { execSync("npx tsc -p tsconfig.screens.json", { stdio: "pipe" }); execSync("node ci/patch_test_aliases.mjs .testout-screens", { stdio: "pipe" }); }
execSync("node .testout-screens/lib/design-gallery.js " + out, { stdio: "pipe" });
const found = fs.readdirSync("/opt/pw-browsers").filter((x) => x.startsWith("chromium_headless_shell")).map((x) => path.join("/opt/pw-browsers", x, "chrome-linux", "headless_shell"))[0];
const browser = await chromium.launch({ executablePath: found });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const bad = [];
for (const f of fs.readdirSync(out).filter((x) => x.endsWith(".html")).sort()) {
  await page.goto("file://" + path.join(out, f));
  // the right edge of every element — a clipping frame hides sideways scroll, but not content that runs off the phone
  const w = await page.evaluate(() => Math.ceil(Math.max(...[...document.querySelectorAll("body *")].map((el) => el.getBoundingClientRect().right))));
  if (w > 391) bad.push(`${f}: content reaches ${w}px (phone is 390)`);
}
await browser.close();
if (bad.length) { console.log("GALLERY OVERFLOW: FAIL — screens wider than the phone:\n  " + bad.join("\n  ")); process.exit(1); }
console.log("gallery overflow: PASS (every design-gallery screen fits a 390px phone)");
