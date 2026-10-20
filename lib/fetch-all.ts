// Fetch EVERY row, page by page (210.2 — review point 8). Supabase returns at most 1,000 rows per request by
// default, and batching game ids doesn't limit how many player or score rows those games hold. Pages are
// read in a stable order until a short page arrives; any error throws — never a silent partial result.
export const PAGE = 1000;

export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    // A hard stop: a source that ignores paging (returns full pages forever) fails loudly instead of looping.
    if (from >= PAGE * 1000) throw new Error("fetchAll: stopped after 1,000 pages — the source is not honouring paging");
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data || [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** The stable order for paging each table (its key). game_alt_shot_scores has no id — its key is four columns. */
const ORDER: Record<string, string[]> = { game_alt_shot_scores: ["game_id", "foursome_id", "side", "hole_index"] };

/** Every row of `table` whose `column` is one of `ids` — ids in chunks, each chunk paged, in a stable order. */
export async function fetchAllIn<T>(db: { from: (t: string) => any }, table: string, column: string, ids: string[]): Promise<T[]> {
  const out: T[] = [];
  const cols = ORDER[table] || ["id"];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    out.push(...(await fetchAll<T>((from, to) => { let q = db.from(table).select("*").in(column, chunk); for (const c of cols) q = q.order(c); return q.range(from, to); })));
  }
  return out;
}

/** Every row a list-returning server function produces (210.4 — server-function lists are capped at 1,000 rows
 *  like table reads). Pages arrive in the FUNCTION'S OWN ORDER, so each screen keeps its sort (several functions
 *  sort by calculations the app shouldn't duplicate); rows are de-duplicated by their unique key in case one
 *  shifts between pages. Returns { data, error } like a normal call, so call sites change minimally. */
export async function rpcAll<T = any>(db: { rpc: (fn: string, args?: Record<string, unknown>) => any }, fn: string, args: Record<string, unknown> | undefined, key: string | string[]): Promise<{ data: T[] | null; error: { message: string } | null }> {
  const keys = Array.isArray(key) ? key : [key];
  try {
    const rows = await fetchAll<T>((from, to) => db.rpc(fn, args ?? {}).range(from, to));
    const seen = new Set<string>();
    return { data: rows.filter((r) => { const k = keys.map((c) => String((r as Record<string, unknown>)[c])).join("|"); if (seen.has(k)) return false; seen.add(k); return true; }), error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
  }
}
