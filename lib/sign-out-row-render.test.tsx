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
  // 212.135: an entry for a game the server has deleted is cleared automatically and the row says so
  ls.setItem("bnn_device_scores:me:t1:bnn_game_scores_g7_p1", JSON.stringify({ scores: [5], putts: [], fairways: [], penalties: [], sand: [] }));
  ls.setItem("bnn_game_snap_g7", JSON.stringify({ game: { name: "Trifecta", code: "610175" }, players: [{ id: "p1", display_name: "Amit" }] }));
  const r2 = renderScreen(<SignOutRow userId="me" onSignOut={async () => ({ error: null })} onOpenGame={() => {}} gameStates={async () => [{ id: "g1", status: "active" }]} />);
  await act(async () => { await new Promise((res) => setTimeout(res, 20)); });
  const note = r2.el.querySelector("[data-retired-notice]");
  ok(!!note && (note.textContent || "").includes("1 deleted game"), `the row says the deleted game's entry was cleared (got ${note?.textContent})`);
  ok(!!r2.el.querySelector("[data-unsynced-item='g1']") && !r2.el.querySelector("[data-unsynced-item='g7']") && ls.getItem("bnn_game_snap_g7") === null, "the active game's item remains; the deleted game's entry and snapshot are gone");
  report("sign-out row render");
}
main().catch((e) => { console.error(e); process.exit(1); });
