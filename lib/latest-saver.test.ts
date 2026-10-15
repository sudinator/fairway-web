function eq(a: unknown, b: unknown, m: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
import { createLatestSaver } from "./latest-saver";
(async () => {
  // Review finding 9: an earlier save that completes LATE must not overwrite or confirm a later edit.
  const sent: string[] = []; const stored: string[] = []; const states: string[] = [];
  const resolvers: (() => void)[] = [];
  const saver = createLatestSaver<string>((v) => { sent.push(v); return new Promise((res) => resolvers.push(() => { stored.push(v); res(); })); }, (s) => states.push(`${s.status}:${s.value}`));
  void saver.request("USA");          // in flight
  void saver.request("Team U");       // held
  void saver.request("Team USA");     // replaces the held one
  eq(sent, ["USA"], "only one save in flight; later edits held");
  resolvers.shift()!();               // USA completes
  await new Promise((r) => setTimeout(r, 0));
  eq(sent, ["USA", "Team USA"], "the NEWEST held edit is sent next; the intermediate one skipped");
  eq(states.includes("saved:USA"), false, "an earlier save is never acknowledged as saved while a newer edit exists");
  resolvers.shift()!();
  await new Promise((r) => setTimeout(r, 0));
  eq(stored[stored.length - 1], "Team USA", "the stored name is the last thing typed");
  eq(states[states.length - 1], "saved:Team USA", "acknowledged once the latest is saved");
  // A failure with a newer edit waiting sends the newer edit rather than reporting the stale error.
  const s2: string[] = []; let fail = true;
  const sv2 = createLatestSaver<string>(async (v) => { s2.push(v); if (fail) { fail = false; throw new Error("network"); } }, () => {});
  const p = sv2.request("A"); void sv2.request("B"); await p; await new Promise((r) => setTimeout(r, 0));
  eq(s2, ["A", "B"], "after a failed save, the newer edit is still sent");
  // 206.2 follow-up 4: reverting mid-save. Stored "USA"; type "United States" (saving); change back
  // to "USA" before it finishes. The final stored value must be "USA".
  {
    let stored3 = "USA"; const sent3: string[] = []; const res3: (() => void)[] = [];
    const sv3 = createLatestSaver<string>((v) => { sent3.push(v); return new Promise((r) => res3.push(() => { stored3 = v; r(); })); }, () => {}, undefined, (v) => v === stored3);
    void sv3.request("USA");                 // equals the stored value, nothing in flight → no save
    eq(sent3, [], "an unchanged value is not saved");
    void sv3.request("United States");       // in flight
    void sv3.request("USA");                 // reverted mid-save → must still be queued
    res3.shift()!(); await new Promise((r) => setTimeout(r, 0));
    eq(sent3, ["United States", "USA"], "the reversal is sent after the in-flight save");
    res3.shift()!(); await new Promise((r) => setTimeout(r, 0));
    eq(stored3, "USA", "the final stored name is the user's final choice");
  }
  console.log("latest-saver tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
