#!/usr/bin/env python3
"""212.41 (owner, Oct 25) — no personal scorecard in a format where you don't play your own ball: scramble (the
team's ball) and alternate shot (the pair's). ONE rule decides it — lib/round-rules countsForIndividualStats — so a
new shared-ball format can't be missed (scramble showed an empty card at the bottom of Results because the screen
had its own "not alternate shot" check). A shamble (best drive, then your own ball) would keep individual cards."""
import pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
t = (ROOT / "components/tournaments.tsx").read_text(encoding="utf-8")
rules = (ROOT / "lib/round-rules.ts").read_text(encoding="utf-8")
bad = []
m = re.search(r"export function countsForIndividualStats\([^)]*\): boolean \{\s*return ([^;]*);", rules)
if not m or '"alt_shot"' not in m.group(1) or '"scramble"' not in m.group(1): bad.append("lib/round-rules countsForIndividualStats must exclude both alt_shot and scramble")
if 'roomTab === "play" && me && countsForIndividualStats(game.game_type) && (() => {' not in t: bad.append("the personal scorecard (Results) must be shown only when countsForIndividualStats(game.game_type)")
if 'roomTab === "play" && me && countsForIndividualStats(game.game_type) && (me.scores || []).some(' not in t: bad.append("'Share my scorecard' must follow the same rule")
if re.search(r'roomTab === "play" && me && game\.game_type !== "alt_shot" && \(\(\) => \{', t): bad.append("the personal scorecard must not keep its own alt_shot-only check")
if bad: print("SHARED-BALL SCORECARDS: FAIL\n  " + "\n  ".join(bad)); sys.exit(1)
print("shared-ball scorecards: PASS (no personal scorecard in scramble or alternate shot — one rule)")
