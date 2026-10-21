// 211.6 — the server computes badges and the player card from the rounds THE DATABASE holds (a stand-in here),
// with the same code as the phone; nothing the phone could send is involved.
function ok(c: unknown, m: string) { if (!c) throw new Error(m); }
import { refreshMemberStats, loadFinishedRounds } from "./member-stats-server";
import { computeCardStats } from "./card";

// a stand-in database: filters by .eq / .in, honours .range, records upserts
function fakeDb(tables: Record<string, any[]>) {
  const writes: Record<string, any[]> = {};
  const from = (t: string) => {
    let rows = [...(tables[t] || [])];
    const q: any = {
      select: () => q, order: () => q, is: (c: string, v: any) => { rows = rows.filter((r) => (r[c] ?? null) === v); return q; },
      eq: (c: string, v: any) => { rows = rows.filter((r) => r[c] === v); return q; },
      in: (c: string, vs: any[]) => { rows = rows.filter((r) => vs.includes(r[c])); return q; },
      range: (a: number, b: number) => Promise.resolve({ data: rows.slice(a, b + 1), error: null }),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (res: any) => Promise.resolve({ data: rows, error: null }).then(res),
      upsert: (v: any) => { (writes[t] ||= []).push(...(Array.isArray(v) ? v : [v])); return Promise.resolve({ error: null }); },
      delete: () => ({ eq: () => ({ in: () => Promise.resolve({ error: null }) }) }),
    };
    return q;
  };
  return { db: { from }, writes };
}
const U = "user-1";
const rounds = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, user_id: U, played_at: `2026-0${i + 1}-15`, course: "C", rating: 72, slope: 113, status: "final", deleted_at: null, handicap_index: 12, course_handicap: 12, groups: null }));
const holes = rounds.flatMap((r, i) => Array.from({ length: 18 }, (_, h) => ({ id: `${r.id}-${h}`, round_id: r.id, hole_number: h + 1, par: 4, si: h + 1, strokes: 4 + (h < 8 + i ? 1 : 0) })));
const extra = [{ ...rounds[0], id: "other", user_id: "someone-else" }, { ...rounds[1], id: "inprog", status: "in_progress" }, { ...rounds[2], id: "deleted", deleted_at: "2026-09-01" }];

(async () => {
  const { db, writes } = fakeDb({ rounds: [...rounds, ...extra], holes, player_cards: [], member_badges: [] });
  const fin = await loadFinishedRounds(db, U);
  ok(fin.length === 6 && fin.every((r: any) => r.user_id === U && r.status === "final"), `only the member's finished, undeleted rounds (got ${fin.length})`);
  const res = await refreshMemberStats(db, U);
  const card = (writes["player_cards"] || [])[0];
  const expected = computeCardStats(fin);
  ok(!!card && card.user_id === U && card.idx === expected.idx && card.rounds === 6, `the card the server saves is computed from the database's rounds (got ${JSON.stringify(card)})`);
  ok(res.cardChanged === true, "the card was written");
  const none = fakeDb({ rounds: [], holes: [], player_cards: [], member_badges: [] });
  const r2 = await refreshMemberStats(none.db, U);
  ok(!r2.cardChanged && !none.writes["player_cards"], "no rounds: nothing written (as on the phone)");
  console.log("member-stats-server tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
