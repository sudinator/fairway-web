/** 212.41 — saved drafts (owner, Oct 25): only the organizer and club admins see a draft until it is sent; Manage Game
 * shows a Draft banner whose "Send to players" announces it; nothing can be shared before that. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { isDraftGame, visibleGames } from "@/lib/one-step-create";
import { DraftBanner, ShareLinks } from "@/components/game/setup/one-step";

const games = [
  { id: "sent", created_by: "org", players_notified_at: "2026-10-25T10:00:00Z" },
  { id: "draft", created_by: "org", players_notified_at: null },
  { id: "old", created_by: "org" },   // a game from before 0219 has no field at all: announced
];
ok(JSON.stringify(games.map(isDraftGame)) === "[false,true,false]", "only players_notified_at = null is a draft (older games are not)");
ok(visibleGames(games, "org", false).length === 3, "the organizer sees their draft");
ok(JSON.stringify(visibleGames(games, "player", false).map((g) => g.id)) === '["sent","old"]', "a player does not see the draft");
ok(visibleGames(games, "admin", true).length === 3, "a club admin sees the draft");
ok(JSON.stringify(visibleGames(games, null, false).map((g) => g.id)) === '["sent","old"]', "signed-out / unknown: no drafts");
(async () => {
  let sent = 0;
  const t = renderScreen(<DraftBanner onSend={async () => { sent++; }} />);
  ok((t.el.textContent || "").includes("Only you can see this game"), "the banner says who can see it");
  const b = [...t.el.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Send to players")) as HTMLButtonElement;
  await act(async () => { b.click(); await Promise.resolve(); });
  ok(sent === 1, "Send to players sends it");
  t.unmount();
  // Manage Game → Review: the two share links, one switch (owner, Oct 25)
  const ons: boolean[] = [];
  const off = renderScreen(<ShareLinks lineupToken={null} liveToken={null} onShare={async (on) => { ons.push(on); }} />);
  ok((off.el.textContent || "").includes("Turn on the share links") && !off.el.querySelector("[data-share-link]"), "sharing off: one button, no links");
  const turnOn = [...off.el.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Turn on")) as HTMLButtonElement;
  await act(async () => { turnOn.click(); await Promise.resolve(); });
  ok(ons[0] === true, "the button turns sharing on");
  off.unmount();
  const on = renderScreen(<ShareLinks lineupToken="oak-hollow-oct25-ab12cd" liveToken="tok123" onShare={async (v) => { ons.push(v); }} />);
  const rows = [...on.el.querySelectorAll("[data-share-link]")].map((r) => r.textContent || "");
  ok(rows.length === 2 && rows[0].includes("Line-up link") && rows[0].includes("/lineup/oak-hollow-oct25-ab12cd") && rows[1].includes("Live scores link") && rows[1].includes("/live/oak-hollow-oct25-ab12cd"), `sharing on: the line-up and live scores links, both in the readable form (212.72) (got ${JSON.stringify(rows)})`);
  const stop = [...on.el.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Stop sharing")) as HTMLButtonElement;
  await act(async () => { stop.click(); await Promise.resolve(); });
  ok(ons[1] === false && (stop.textContent || "").includes("both"), "one Stop sharing turns off both links");
  on.unmount();
  report("draft games");
})();
