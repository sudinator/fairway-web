// 212.25 — SAVE TRACE (diagnostic, staging only). Owner, Oct 23: scores entered in a stroke play game showed, then
// vanished ~10 s later, with no save request reaching the database and no status shown. This records each step of a
// save — the tap, whether this device is the scorer, why the writer held it, what was sent and what the database said,
// and what each refresh kept — so one screenshot shows where it breaks. Shown at the top of the game screen on staging
// (components/save-trace-view); production never shows it.
const lines: string[] = [];
const subs = new Set<() => void>();
let version = 0;
export function trace(msg: string) {
  const t = new Date();
  const stamp = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}`;
  lines.unshift(`${stamp} ${msg}`);
  if (lines.length > 14) lines.length = 14;
  version++;
  subs.forEach((f) => f());
}
export const traceLines = () => lines;
export const traceVersion = () => version;
export const subscribeTrace = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
