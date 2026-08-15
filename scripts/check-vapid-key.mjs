import fs from "node:fs";
import path from "node:path";

const envKey = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "").trim();
const swPath = path.join(process.cwd(), "public", "sw.js");
const sw = fs.readFileSync(swPath, "utf8");
const match = sw.match(/const\s+VAPID_PUBLIC_KEY\s*=\s*["']([^"']+)["']/);
if (!match) {
  console.error("VAPID contract: public/sw.js does not expose the expected VAPID_PUBLIC_KEY constant");
  process.exit(1);
}
const swKey = match[1].trim();

if (!envKey) {
  console.log("VAPID contract: NEXT_PUBLIC_VAPID_PUBLIC_KEY not set; runtime comparison skipped");
  process.exit(0);
}
if (envKey !== swKey) {
  console.error("VAPID contract: NEXT_PUBLIC_VAPID_PUBLIC_KEY does not match public/sw.js; push re-subscription would drift");
  process.exit(1);
}
console.log("VAPID contract: PASS (service worker and build environment agree)");
