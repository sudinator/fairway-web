import { commitAllowance, editAllowance } from "./handicap-allowance";

function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

let n = 0;
function check(actual: unknown, expected: unknown, label: string) {
  eq(actual, expected, label);
  n += 1;
}

check(editAllowance("100"), { text: "100", pct: 100 }, "100 remains 100");
check(editAllowance("92"), { text: "92", pct: 92 }, "custom 92 accepted");
check(editAllowance(""), { text: "", pct: 100 }, "blank editor falls back to default domain value");
check(commitAllowance(""), { text: "100", pct: 100 }, "blank blur visibly restores 100");
check(commitAllowance("   "), { text: "100", pct: 100 }, "whitespace blur restores 100");
check(editAllowance("-5"), { text: "0", pct: 0 }, "negative clamps to zero");
check(editAllowance("120"), { text: "100", pct: 100 }, "over 100 clamps to 100");
check(commitAllowance("85"), { text: "85", pct: 85 }, "preset-like custom value commits");

console.log(`HANDICAP_ALLOWANCE_PASS ${n}/8 assertions`);
