/** 212.71 (owner, Oct 29) — the recap additions: segments, side contests in the email, stats and streaks (dynamic on the
 *  share), the net front / back field line, par-or-better on the hole line, standouts in net birdies' place on the share,
 *  trifecta's results, and NO money anywhere. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { RecapBody } from "@/components/game/recap-body";
import { buildRecap } from "@/lib/game-recap";
import { recapEmailHtml } from "@/lib/recap-email";
import { game, players, contests, formatGames } from "@/lib/recap-mockups";
import type { Player } from "@/lib/game-types";

const r = buildRecap(game, players, []);
const sx = r.sections, h = r.highlights;
// ── segments: a Stableford with three sixes ──
ok(sx.segments?.length === 3 && sx.segments.every((x) => x.who.length >= 1 && x.unit === "pts"), `three sixes, each with its winner(s), in points (got ${JSON.stringify(sx.segments?.map((x) => [x.short, x.who, x.val]))})`);
const noScheme = buildRecap({ ...game, leg_config: { scheme: "none", metric: "pts", points: {} } } as never, players, []);   // segments OFF (no setting = sixes, as on the game screen)
ok(!noScheme.sections.segments, "segments off: no segments section");
const stroke = buildRecap(formatGames["stroke"].game, formatGames["stroke"].players, []);
ok(stroke.sections.segments?.length === 2 && stroke.sections.segments[0].unit === "net", "stroke play with nines: two segments, in net strokes");
// ── stats and streaks ──
ok(sx.statTiles.some((t) => t.label === "Fewest putts") && sx.statTiles.some((t) => t.label === "Longest par streak") && sx.statTiles.some((t) => t.label === "Most fairways"), `stat tiles for every stat entered (got ${sx.statTiles.map((t) => t.label).join(", ")})`);
const bare = players.map((p) => ({ ...p, putts: [], fairways: [] }) as unknown as Player);
const rb = buildRecap(game, bare, []);
ok(!rb.sections.statTiles.some((t) => t.label === "Fewest putts" || t.label === "Most fairways"), "no stats entered: no putts or fairways tiles");
// ── the field line and the hole line ──
ok(!!h.frontBackNet && Math.abs(h.frontBackNet.front + h.frontBackNet.back - (h.fieldNet ?? 0)) < 0.01, `the net front and back add up to the field average (${h.frontBackNet?.front} + ${h.frontBackNet?.back} vs ${h.fieldNet})`);
let t = renderScreen(<RecapBody game={game} recap={r} mode="share" contests={contests} netBirdiesTop={3} />);
const share = t.el.textContent || "";
ok(share.includes("Field average (net)") && /front [0-9.]+ \((E|[+−][0-9.]+)\)/.test(share), `share: "Field average (net) · … front 35.3 (−0.8) …" (got "${share.match(/Field average[^T]*/)?.[0]}")`);
ok(/Toughest hole \d+ \(par \d, avg [0-9.]+, [+−]?[0-9.]+; (nobody made par|\d+ made par or better)/.test(share), "share: the toughest hole says who made par or better");
ok(!!t.el.querySelector("[data-recap-segments]") && !t.el.querySelector("[data-recap-segments-box]"), "share: segments as a line; no box");
ok(share.includes("Closest to the pin #12") && share.includes("Long drive #16"), "share: the side contests line");
// stat tiles on the share: notable only, two at most
const statLabels = ["Fewest putts", "Longest par streak", "Most fairways", "Bounce-back birdie"];
const shownStats = [...t.el.querySelectorAll("[data-recap-tiles] > div")].filter((d) => statLabels.some((l) => (d.textContent || "").toUpperCase().startsWith(l.toUpperCase()))).length;
ok(shownStats <= 2 && shownStats === Math.min(2, sx.statTiles.filter((x) => x.notable).length), `share: the notable stat tiles, two at most (shown ${shownStats}, notable ${sx.statTiles.filter((x) => x.notable).length})`);
// standouts take net birdies' place on the share
ok(!!h.standouts?.rows.length && !t.el.querySelector("[data-recap-net-birdies]") && share.includes("STANDOUT ROUNDS"), "share: a standout day shows standouts in net birdies' place");
t.unmount();
const calm = players.filter((p) => p.display_name !== "Probir Das");
const rc = buildRecap(game, calm, []);
t = renderScreen(<RecapBody game={game} recap={rc} mode="share" contests={[]} netBirdiesTop={3} />);
const nbRows = t.el.querySelectorAll("[data-recap-net-birdies] [data-recap-row], [data-recap-net-birdies] div").length;
ok(!rc.highlights.standouts?.rows.length ? !!t.el.querySelector("[data-recap-net-birdies]") && (t.el.textContent || "").includes("TOP 3") : true, `share: no standouts — net birdies, top 3 (${nbRows} nodes)`);
t.unmount();
// the app: segments box, every stat tile
t = renderScreen(<RecapBody game={game} recap={r} mode="app" contests={contests} />);
ok(!!t.el.querySelector("[data-recap-segments-box]") && sx.statTiles.every((x) => (t.el.textContent || "").includes(x.label.toUpperCase()) || (t.el.textContent || "").includes(x.label)), "app: the segments box and every stat tile");
t.unmount();
// ── the email: segments, contests, stats; no money ──
const html = recapEmailHtml(r, null, contests);
ok(html.includes("SEGMENTS") && html.includes("SIDE CONTESTS") && html.includes("Closest to the pin") && html.includes("STATS &amp; STREAKS"), "email: segments, side contests, stats and streaks");
ok(html.includes("Field average (net)"), "email: the field line in its new form");
for (const [label, out] of [["app", (() => { const x = renderScreen(<RecapBody game={game} recap={r} mode="app" contests={contests} />); const s = x.el.innerHTML; x.unmount(); return s; })()], ["share", share], ["email", html]] as const)
  ok(!/winnings|Money tab|\$\d|data-recap-money/i.test(out), `${label}: no money anywhere`);
// ── trifecta: its results table ──
const tf = buildRecap(formatGames["trifecta"].game, formatGames["trifecta"].players, []);
ok((tf.sections.matches?.rows.length ?? 0) === 6, `trifecta: six results — two singles and a four-ball per foursome (got ${tf.sections.matches?.rows.length})`);
report("recap additions");
