function eq(a: unknown, b: unknown, m: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
import { fetchAll } from "./fetch-all";
// 210.2 (review point 8): every row arrives, however many pages; an error is never a partial result.
(async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => i);
  const asked: [number, number][] = [];
  const all = await fetchAll<number>(async (from, to) => { asked.push([from, to]); return { data: rows.slice(from, to + 1), error: null }; });
  eq(all.length, 2500, "all 2,500 rows, not the first 1,000");
  eq(asked, [[0, 999], [1000, 1999], [2000, 2999]], "three pages, in order");
  const exact = await fetchAll<number>(async (from, to) => ({ data: rows.slice(0, 1000).slice(from, to + 1), error: null }));
  eq(exact.length, 1000, "exactly 1,000 rows: one more (empty) page confirms the end");
  let threw = false;
  try { await fetchAll<number>(async (from) => (from === 0 ? { data: rows.slice(0, 1000), error: null } : { data: null, error: { message: "timeout" } })); } catch { threw = true; }
  eq(threw, true, "an error on a later page throws — never a silent partial result");
  console.log("fetch-all tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
