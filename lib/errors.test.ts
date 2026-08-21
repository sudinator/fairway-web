// Failure messages. These are user-facing strings, so they are the deliverable — a wrong one is a
// wrong feature, not a cosmetic slip.
//
// The rule being tested: the ADVICE changes with the cause. Telling someone to "try again" after a
// permission error wastes their time; telling them to "ask an admin" after a dropped connection is
// worse. The old messages leaked raw Postgres text ("new row violates row-level security policy"),
// which serves a developer and means nothing to a golfer.

import { adviceFor, failureMessage } from "./errors";

let passed = 0, failed = 0;
function ok(cond: unknown, label: string) {
  if (cond) { passed++; return; }
  failed++; console.log(`  FAIL  ${label}`);
}
function eq<T>(a: T, b: T, label: string) {
  if (JSON.stringify(a) === JSON.stringify(b)) { passed++; return; }
  failed++;
  console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(b)}\n        actual   ${JSON.stringify(a)}`);
}

// Permission: retrying is pointless, so the advice must not say "try again".
{
  const a = adviceFor({ code: "42501" });
  eq(a.code, "42501", "RLS keeps the Postgres code");
  ok(/admin/i.test(a.action), "RLS advises asking an admin");
  ok(!/try again/i.test(a.action), "RLS does NOT advise retrying");
}

// Connection: retrying is exactly right. Every engine words this differently, and matching only
// Chrome's phrasing meant an iPhone in airplane mode fell through to the generic branch — found
// on a real device minutes after shipping, which is why each wording is pinned here.
{
  for (const [msg, engine] of [
    ["Failed to fetch", "Chrome"],
    ["Load failed", "Safari — every iPhone"],
    ["NetworkError when attempting to fetch resource", "Firefox"],
    ["Network request failed", "React Native / older WebKit"],
    ["The Internet connection appears to be offline.", "iOS system"],
  ] as const) {
    const a = adviceFor({ message: msg });
    eq(a.code, "NET", `"${msg}" (${engine}) is coded NET`);
    ok(/try again/i.test(a.action), `"${msg}" advises retrying`);
  }
  // A TypeError wrapper is what actually reaches us from a fetch rejection.
  eq(adviceFor({ message: "TypeError: Load failed" }).code, "NET", "the TypeError wrapper is still NET");
}

{ eq(adviceFor({ code: "23505" }).code, "23505", "duplicate key keeps its code");
  ok(/already exists/i.test(adviceFor({ code: "23505" }).action), "duplicate advises checking"); }

{ ok(/sign in/i.test(adviceFor({ message: "JWT expired" }).action), "auth advises signing in again");
  eq(adviceFor({ message: "JWT expired" }).code, "AUTH", "auth is coded AUTH"); }

{ eq(adviceFor({}).code, "BNN-UNK", "an unrecognised error still yields a quotable code");
  ok(adviceFor({}).action.length > 0, "an unrecognised error still gives advice"); }

// The composed string: what failed, what to do, code last.
{
  const m = failureMessage("Couldn't save the pairing", { code: "42501" });
  ok(m.startsWith("Couldn't save the pairing."), "leads with what failed");
  ok(m.includes("(error code 42501)"), "ends with a quotable error code");
  ok(!/row-level security|violates/i.test(m), "does NOT leak raw Postgres text");
}

// Regression: the raw provider message must never reach the user.
{
  const m = failureMessage("Couldn't save", { code: "42501", message: "new row violates row-level security policy for table \"games\"" });
  ok(!m.includes("row-level security"), "raw provider text stays out of the toast");
}

console.log(`failure messages: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
