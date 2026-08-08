import { barShapeValue } from "./chart-helpers";

let pass = 0, fail = 0; const fails: string[] = [];
function eq<T>(name: string, got: T, want: T) { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; fails.push(`${name} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`); } }

// props.value is the numeric bar value (recharts sets value: value[1]) — primary path
eq("numeric value", barShapeValue({ value: 12.3, payload: { value: [0, 12.3], payload: { diff: 12.3 } } }, "diff"), 12.3);
eq("negative value", barShapeValue({ value: -1.5 }, "diff"), -1.5);
eq("zero value", barShapeValue({ value: 0 }, "diff"), 0);
// value as [base, top] array → take the top
eq("array value -> top", barShapeValue({ value: [0, 8] }, "diff"), 8);
// no numeric value, datum row directly on payload
eq("payload[key]", barShapeValue({ value: undefined, payload: { diff: 5 } }, "diff"), 5);
// no numeric value, wrapper payload (real recharts shape) -> payload.payload[key]
eq("payload.payload[key]", barShapeValue({ value: undefined, payload: { value: [0, 7], payload: { diff: 7 } } }, "diff"), 7);
// other keys
eq("val key", barShapeValue({ value: 42 }, "val"), 42);
// nothing usable -> null (bar falls back to a default color, never crashes)
eq("nothing -> null", barShapeValue({ payload: { payload: {} } }, "diff"), null);
eq("empty -> null", barShapeValue({}, "diff"), null);
eq("undefined props -> null", barShapeValue(undefined, "diff"), null);

console.log(`chart-helpers: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
