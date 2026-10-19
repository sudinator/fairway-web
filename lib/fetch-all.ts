// Fetch EVERY row, page by page (210.2 — review point 8). Supabase returns at most 1,000 rows per request by
// default, and batching game ids doesn't limit how many player or score rows those games hold. Pages are
// read in a stable order until a short page arrives; any error throws — never a silent partial result.
export const PAGE = 1000;

export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
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
