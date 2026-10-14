function eq(a: unknown, b: unknown, m: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
import { sendPushToUser } from "./push-send";
// Stand-in for the service-role client: push_subscriptions lookup + the writes the sender makes.
function fakeAdmin(subs: any[] | null, lookupError: { message: string } | null = null) {
  const writes: string[] = [];
  const chain = (table: string): any => ({
    select: () => ({ eq: () => ({ eq: async () => ({ data: subs, error: lookupError }) }) }),
    update: (v: any) => ({ eq: async (_c: string, id: string) => { writes.push(`${table}.update ${id} ${JSON.stringify(v)}`); return { error: null }; } }),
    delete: () => ({ eq: async (_c: string, id: string) => { writes.push(`${table}.delete ${id}`); return { error: null }; } }),
    insert: async (v: any) => { writes.push(`${table}.insert ${v.result}`); return { error: null }; },
  });
  return { admin: { from: chain } as any, writes };
}
const base = { userId: "u", payload: { title: "T", body: "B" }, vapidPub: "x", vapidPriv: "y", log: { type: "t", delivery: "push" }, sleep: async () => {} };
const sub = (id: string) => ({ id, endpoint: `https://push/${id}`, p256dh: "k", auth: "a", fail_count: 0 });
const err = (statusCode?: number) => Object.assign(new Error("x"), { statusCode });
(async () => {
  // 1. Lookup failure is reported as such — never "no enrolled devices".
  { const f = fakeAdmin(null, { message: "connection reset" });
    const o = await sendPushToUser(f.admin, { ...base, sendImpl: async () => {} });
    eq(o.lookupFailed, true, "lookup failure flagged"); eq(o.result.startsWith("device lookup failed"), true, "logged as a lookup failure"); }
  { const f = fakeAdmin([]); const o = await sendPushToUser(f.admin, { ...base, sendImpl: async () => {} });
    eq([o.lookupFailed, o.result], [false, "no enrolled devices"], "genuinely no devices"); }
  // 2. Transient failure on one phone is retried; the phone that succeeded is NOT sent twice.
  { const f = fakeAdmin([sub("A"), sub("B")]); const calls: string[] = []; let bFails = 2;
    const o = await sendPushToUser(f.admin, { ...base, sendImpl: async (s) => { calls.push(s.endpoint); if (s.endpoint.endsWith("B") && bFails-- > 0) throw err(503); } });
    eq(calls.filter((c) => c.endsWith("A")).length, 1, "the phone that got it is never sent a duplicate");
    eq(calls.filter((c) => c.endsWith("B")).length, 3, "the failing phone is retried");
    eq([o.sent, o.retryableFailed, o.failed], [2, 0, 0], "both delivered after retry"); }
  // 3. Still failing after retries → retryable failure, counted against the subscription.
  { const f = fakeAdmin([sub("C")]);
    const o = await sendPushToUser(f.admin, { ...base, sendImpl: async () => { throw err(503); } });
    eq([o.sent, o.retryableFailed], [0, 1], "reported as a retryable failure");
    eq(f.writes.some((w) => w.includes("push_subscriptions.update C") && w.includes('"fail_count":1')), true, "fail_count recorded"); }
  // 4. Gone (410) is final: removed, not retried.
  { const f = fakeAdmin([sub("D")]); let n = 0;
    const o = await sendPushToUser(f.admin, { ...base, sendImpl: async () => { n++; throw err(410); } });
    eq([n, o.permanentFailed, o.retryableFailed], [1, 1, 0], "410: one attempt, permanent");
    eq(f.writes.some((w) => w === "push_subscriptions.delete D"), true, "dead subscription removed"); }
  // 5. Rejected (401, bad VAPID key) is final: retrying cannot help.
  { const f = fakeAdmin([sub("E")]); let n = 0;
    const o = await sendPushToUser(f.admin, { ...base, sendImpl: async () => { n++; throw err(401); } });
    eq([n, o.permanentFailed], [1, 1], "401: not retried"); }
  console.log("push-send tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
