/** RENDERED CHECK (210.2, review point 9): a failed load shows an error with Retry — never "no history". */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { HeadToHead } from "@/components/head-to-head";

const H18 = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const game = { id: "g1", status: "ended", game_type: "match", holes_meta: H18, course_par: 72, allowance_pct: 100, teams: null, pairings: [{ a: "me", b: "bob" }], foursomes: [] };
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
  report("head-to-head errors");
})().catch((e) => { console.error(e); process.exit(1); });
