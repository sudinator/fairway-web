/** RENDERED CHECK (210.2, review point 9): a failed load shows an error with Retry — never "no history". */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { HeadToHead } from "@/components/head-to-head";

const H18 = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const game = { id: "g1", status: "ended", game_type: "match", holes_meta: H18, course_par: 72, allowance_pct: 100, teams: null, pairings: [{ a: "me", b: "bob" }], foursomes: [], played_at: "2026-11-03", course: "Francis Byrne" };
const pl = (id: string, name: string, v: number) => ({ id: `p-${id}`, game_id: "g1", user_id: id, display_name: name, scores: Array(18).fill(v), course_handicap: 0, course_handicap_source: "manual", handicap_index: 0, rating: 72, slope: 113, no_show: false });
let failFirst = true;
(globalThis as any).fetch = async (input: any) => {
  const url = String(input?.url ?? input);
  if (failFirst) { failFirst = false; return new Response(JSON.stringify({ message: "connection reset" }), { status: 500, headers: { "content-type": "application/json" } }); }
  const body = url.includes("/game_alt_shot_scores") ? [] : url.includes("/games") ? [game]
    : url.includes("select=game_id") ? [{ game_id: "g1", id: "p-me" }] : url.includes("/game_players") ? [pl("me", "Me", 4), pl("bob", "Bob", 5)] : [];
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });

(async () => {
  const t = renderScreen(<HeadToHead user={{ id: "me" }} />);
  await settle();
  const txt = () => t.el.textContent || "";
  ok(txt().includes("Couldn't load your match history.") && txt().includes("Retry"), "a failed load shows an error with Retry");
  ok(!t.el.querySelector("[data-h2h]"), "…and no record built from partial data");
  await act(async () => { Array.from(t.el.querySelectorAll("button")).find((b) => b.textContent === "Retry")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await settle();
  ok(!!t.el.querySelector("[data-h2h]") && txt().includes("Bob"), `Retry loads the record (${txt().slice(0, 120)})`);
  t.unmount();
  // 212.133 (owner): a record opens the games behind it — "Lost 10&8 · Nov 3 · Francis Byrne", each opening its game
  const opened: string[] = [];
  const r = renderScreen(<HeadToHead user={{ id: "me" }} onOpenGame={(id) => opened.push(id)} />);
  await settle();
  ok(!r.el.querySelector("[data-record-matches]"), "the games behind a record are hidden until the row is tapped");
  await act(async () => { r.el.querySelector("[data-h2h-row='bob']")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  const line = r.el.querySelector("[data-record-match='g1']");
  ok(!!line && /^Won 10&8 · Nov 3 · Francis Byrne/.test(line.textContent || ""), `tapping Bob lists the match as the owner asked (got "${line?.textContent}")`);
  await act(async () => { line?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  ok(opened.length === 1 && opened[0] === "g1", "tapping the match opens that game");
  await act(async () => { r.el.querySelector("[data-h2h-row='bob']")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  ok(!r.el.querySelector("[data-record-matches]"), "tapping the row again closes the list");
  r.unmount();
  // partners: a four-ball with a partner lists "with …", newest first
  const fb = { id: "g2", status: "ended", game_type: "fourball", holes_meta: H18, course_par: 72, allowance_pct: 100, team_score_mode: "best_ball", teams: null, pairings: [], foursomes: [{ a: ["me", "sam"], b: ["bob", "dee"] }], played_at: "2026-11-10", course: "Weequahic" };
  const fbOld = { ...fb, id: "g3", played_at: "2026-10-01", course: "Oak Hollow" };
  (globalThis as any).fetch = async (input: any) => {
    const url = String(input?.url ?? input);
    const body = url.includes("/game_alt_shot_scores") ? [] : url.includes("/games") ? [fb, fbOld]
      : url.includes("select=game_id") ? [{ game_id: "g2", id: "p-me" }, { game_id: "g3", id: "p-me3" }]
      : url.includes("/game_players") ? [...["g2", "g3"].flatMap((g) => [{ ...pl("me", "Me", 4), game_id: g }, { ...pl("sam", "Sam", 4), game_id: g }, { ...pl("bob", "Bob", 5), game_id: g }, { ...pl("dee", "Dee", 5), game_id: g }])] : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  const q = renderScreen(<HeadToHead user={{ id: "me" }} onOpenGame={() => {}} />);
  await settle();
  await act(async () => { q.el.querySelector("[data-partner-row='sam']")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  const lines = [...q.el.querySelectorAll("[data-record-match]")].map((b) => b.textContent || "");
  ok(lines.length === 2 && /^Won 10&8 · Nov 10 · Weequahic · with Sam/.test(lines[0]) && lines[1].includes("Oct 1 · Oak Hollow"), `a partner's record lists both matches newest first with "with Sam" (got ${JSON.stringify(lines)})`);
  q.unmount();
  report("head-to-head errors");
})().catch((e) => { console.error(e); process.exit(1); });
