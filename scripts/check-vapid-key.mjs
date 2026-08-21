/**
 * VAPID key drift check — runs from `prebuild`, so every `npm run build` executes it.
 *
 * Push notifications need the public key the APP subscribes with to match the one the SERVICE
 * WORKER expects. If they diverge, subscriptions silently stop delivering: no error, no crash,
 * users simply never receive a notification.
 *
 * `public/sw.js` holds one copy (it ships to browsers — a VAPID *public* key is not a secret).
 * `NEXT_PUBLIC_VAPID_PUBLIC_KEY` holds the other, set in Vercel.
 *
 * WHY ABSENCE IS NOW A FAILURE
 * This previously exited 0 with "comparison skipped" when the variable was unset — so deleting it
 * from Vercel would have produced a green build that verified nothing, and push would have broken
 * at runtime with no warning. Absence of the input is a failure of the check, not a pass.
 * Same failure shape as GOLF_API_KEY, which sat unset for months while its workflow reported
 * nothing wrong.
 *
 * Local builds without the variable set VAPID_CHECK_OPTIONAL=1 to opt out explicitly. CI and
 * Vercel must never set it.
 */
import fs from "node:fs";
import path from "node:path";

const swPath = path.join(process.cwd(), "public", "sw.js");
const sw = fs.readFileSync(swPath, "utf8");
const match = sw.match(/const\s+VAPID_PUBLIC_KEY\s*=\s*["']([^"']+)["']/);
if (!match) {
  console.error("VAPID contract: public/sw.js does not expose the expected VAPID_PUBLIC_KEY constant");
  process.exit(1);
}
const swKey = match[1].trim();
const envKey = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "").trim();

if (!envKey) {
  if (process.env.VAPID_CHECK_OPTIONAL === "1") {
    console.log("VAPID contract: SKIPPED by VAPID_CHECK_OPTIONAL=1 (local build).");
    process.exit(0);
  }
  console.error(
    "VAPID contract: NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set, so the keys could not be compared.\n" +
    "  This is a FAILURE, not a skip: an unverified build is how push notifications break silently.\n" +
    `  Expected value (from public/sw.js): ${swKey}\n` +
    "  - Vercel: Settings -> Environment Variables. It is a PUBLIC key, not a secret.\n" +
    "  - CI:     set it in the workflow env.\n" +
    "  - Local:  export VAPID_CHECK_OPTIONAL=1 to opt out deliberately."
  );
  process.exit(1);
}

if (envKey !== swKey) {
  console.error(
    "VAPID contract: NEXT_PUBLIC_VAPID_PUBLIC_KEY does not match public/sw.js.\n" +
    "  Push subscriptions made with one key are not deliverable by the other, so notifications\n" +
    "  would stop with no error. Update BOTH, or revert whichever changed.\n" +
    `    public/sw.js : ${swKey}\n` +
    `    environment  : ${envKey}`
  );
  process.exit(1);
}

console.log("VAPID contract: PASS (service worker and build environment agree)");
