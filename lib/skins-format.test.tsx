/** 212.37 — one printer for skins counts (lib/skins-format). A tie between three players splits a skin three ways; the
 * old printers showed ⅓ as "0" and 1⅔ as "1½" (app, live page), "½" (recap email) or "1.6666666666666665" (recap). */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { fmtSkins, skinsWord } from "@/lib/skins-format";
import { buildRecap } from "@/lib/game-recap";
import { recapEmailHtml } from "@/lib/recap-email";
import { RecapBody } from "@/components/game/recap-body";
import { SkinsView } from "@/components/game/scoring-views";
import type { Game, Player } from "@/lib/game-types";

const eq = <V,>(a: V, e: V, label: string) => ok(JSON.stringify(a) === JSON.stringify(e), `${label} (expected ${JSON.stringify(e)}, got ${JSON.stringify(a)})`);
// --- the printer ---
eq([0, 1, 2, 12].map(fmtSkins), ["0", "1", "2", "12"], "whole numbers print plain");
eq([0.5, 1.5, 1 / 3, 2 / 3, 1 + 2 / 3, 0.25, 0.75, 2.25].map(fmtSkins), ["½", "1½", "⅓", "⅔", "1⅔", "¼", "¾", "2¼"], "halves, thirds and quarters as fractions");
eq([1.6666666666666665, 5.666666666666667, 2.9999999999, 1e-12].map(fmtSkins), ["1⅔", "5⅔", "3", "0"], "floating-point noise is absorbed");
eq([0.2, 1 + 2 / 5, 2 + 5 / 6, 1 / 6, 0.125, 1 + 7 / 8].map(fmtSkins), ["⅕", "1⅖", "2⅚", "⅙", "⅛", "1⅞"], "fifths (fields of 5+), sixths (½ + ⅓), eighths");
eq([1 / 12, 1 + 7 / 12, 2 + 11 / 12].map(fmtSkins), ["0.1", "1.6", "2.9"], "anything else: one decimal");
eq([skinsWord(1 / 3), skinsWord(1), skinsWord(1.5), skinsWord(0), skinsWord(2 + 2 / 3)], ["⅓ skin", "1 skin", "1½ skins", "0 skins", "2⅔ skins"], "skin / skins");

// --- a real three-way tie, end to end: individual skins, ties halved; Raj wins hole 1, every other hole tied by all three
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const card = (first: number) => [first, ...Array(17).fill(4)];
const players = [["Raj", 3], ["Sam", 4], ["Bo", 4]].map(([n, f], i) => ({ id: `p${i}`, user_id: `u${i}`, display_name: n, scores: card(f as number), course_handicap: 0, course_handicap_source: "manual", no_show: false, team: null, putts: [], fairways: [] } as unknown as Player));
const game = { id: "g", name: "Thirds", course: "C", game_type: "skins", skins_mode: "split", teams: null, foursomes: null, pairings: [], holes_meta: holes, course_par: 72, allowance_pct: 100, status: "ended" } as unknown as Game;
// each of the 17 tied holes is ⅓ each: Raj 1 + 17/3 = 6⅔; Sam and Bo 17/3 = 5⅔
const r = buildRecap(game, players);
ok(r.headline === "Raj won 6⅔ skins", `recap headline (got "${r.headline}")`);
ok(r.personal.u1 === "you won 5⅔ skins", `recap personal line (got "${r.personal.u1}")`);
// the recap BODY agrees with its headline (212.37: shared holes were dropped — "Raj 1 skin", "Longest carry: holes 2–18")
eq((r.sections.skins || []).map((k) => [k.name, fmtSkins(k.skins)]), [["Raj", "6⅔"], ["Bo", "5⅔"], ["Sam", "5⅔"]], "recap body: every player's share of the tied holes");
ok(!(r.highlights as unknown as { tiles?: { label: string }[] }).tiles?.some((t) => t.label === "Longest carry") && !JSON.stringify(r).includes("Longest carry"), "recap: no \"Longest carry\" when ties are halved (nothing carries)");
const html = recapEmailHtml(r);
ok(html.includes("6⅔") && html.includes("5⅔") && !/\b\d\.\d{3,}/.test(html), "the recap email prints 6⅔ and 5⅔");
{
  const t = renderScreen(<RecapBody recap={r} game={game} mode="app" />);
  const txt = t.el.textContent || "";
  ok(txt.includes("6⅔") && txt.includes("5⅔") && !/\d\.\d{3,}/.test(txt), "the recap screen prints 6⅔ and 5⅔");
  t.unmount();
}
{
  const t = renderScreen(<SkinsView game={{ ...game, status: "active" } as Game} players={players} user={{ id: "u0" }} isCreator mode="view" onChanged={() => {}} />);
  const txt = t.el.textContent || "";
  ok(txt.includes("6⅔") && txt.includes("5⅔"), `the scoring screen prints 6⅔ and 5⅔ (old: "6½" and "5½")`);
  t.unmount();
}
report("skins format");
