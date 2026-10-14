/**
 * Finding 7 (205.4): opening a season summary must actually SEND mark_season_wrapped_seen. A Supabase
 * request builder is lazy — `void client.rpc(...)` sends nothing. Counts real fetch calls.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "anon-key-for-test";
let calls: string[] = [];
(globalThis as any).fetch = async (url: any) => { calls.push(String(url)); return new Response("null", { status: 200, headers: { "content-type": "application/json" } }); };
import { createClient as createSb } from "@supabase/supabase-js";
function fail(m: string): never { throw new Error(m); }
(async () => {
  // The old pattern: discard the builder.
  const c = createSb(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  calls = [];
  void c.rpc("mark_season_wrapped_seen", { p_year: 2026 });
  await new Promise((r) => setTimeout(r, 50));
  if (calls.length !== 0) fail(`expected the discarded builder to send nothing, sent ${calls.length}`);
  // The fix.
  const { markSeasonSeen } = await import("../components/season-wrapped");
  calls = [];
  const res = await markSeasonSeen(2026);
  if (calls.filter((u) => u.includes("/rpc/mark_season_wrapped_seen")).length !== 1) fail(`markSeasonSeen must send exactly one request, sent: ${JSON.stringify(calls)}`);
  if (res.error) fail(`unexpected error: ${String(res.error)}`);
  console.log("season seen request tests passed (discarded builder: 0 requests; markSeasonSeen: 1)");
})().catch((e) => { console.error(e); process.exit(1); });
