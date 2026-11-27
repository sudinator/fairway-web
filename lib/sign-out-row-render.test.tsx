/** Profile → the unsynced-scores notice (212.134, owner): each item names the holes and opens its game. */
import { ok, report, renderScreen } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { SignOutRow } from "../components/sign-out-row";
async function main() {
  const ls = window.localStorage; ls.clear();
  ls.setItem("bnn_device_scores:me:t1:bnn_game_scores_g1_p1", JSON.stringify({ scores: [5, null, 4], putts: [], fairways: [], penalties: [], sand: [] }));
  ls.setItem("bnn_game_snap_g1", JSON.stringify({ game: { name: "Saturday Stableford", code: "481207" }, players: [{ id: "p1", display_name: "Amit" }] }));
  const opened: string[] = [];
  const r = renderScreen(<SignOutRow userId="me" onSignOut={async () => ({ error: null })} onOpenGame={(id) => opened.push(id)} />);
  await act(async () => { await new Promise((res) => setTimeout(res, 10)); });
  const item = r.el.querySelector("[data-unsynced-item='g1']");
  ok(!!item && (item.textContent || "").includes("holes 1, 3") && (item.textContent || "").includes("Open"), `the notice names the holes and offers Open (got ${item?.textContent})`);
  await act(async () => { item?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  ok(opened.length === 1 && opened[0] === "g1", "tapping the item opens the game");
  report("sign-out row render");
}
main().catch((e) => { console.error(e); process.exit(1); });
