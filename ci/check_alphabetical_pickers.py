#!/usr/bin/env python3
"""212.48 (owner, Oct 26) — every setup list of players to pick from is alphabetical by first name, through ONE rule
(lib/names sortByName / byName): the team card, the scramble Teams list, the groups list, the matchup and foursome
pickers, the first-driver picker, the club roster in Create and Manage Game's Players list."""
import pathlib, sys
R = pathlib.Path(__file__).resolve().parent.parent
need = [
    ("components/game/compact-team-editor.tsx", "const sorted = sortByName(live);", "the team card"),
    ("components/game/scramble-teams-builder.tsx", "{sortByName(live).map((p, i) => {", "the scramble Teams list"),
    ("components/game/scorecard-views.tsx", "units = sortByName(players).map(", "the groups list (individual formats)"),
    ("components/game/scorecard-views.tsx", "{choices.sort(byName).map(", "the team-group slot picker"),
    ("components/game/scorecard-views.tsx", ".sort((x, y) => byName({ display_name: byKey(x)?.display_name }", "alternate shot's first-driver picker"),
    ("components/game/scoring-views.tsx", "{sortByName(choicesFor(side, row)).map(", "the matchup slot picker"),
    ("components/game/scoring-views.tsx", "{sortByName(useTeamPick ? players.filter((p) => p.team === teamA!.key) : players).map(", "the match picker (side A)"),
    ("components/game/scoring-views.tsx", "{sortByName(useTeamPick ? players.filter((p) => p.team === teamB!.key)", "the match picker (side B)"),
    ("components/game/scoring-views.tsx", "{sortByName(unplaced.filter(", "the 2 v 2 '+ Add player' picker"),
    ("components/tournaments.tsx", ".sort(byName);   // 212.48", "Create's club roster (Players step)"),
    ("components/game/organizer-panel.tsx", "[...players].sort((a, b) => byName(a, b)", "Manage Game's Players list"),
]
bad = [f"{what} ({f}) must list players with lib/names" for f, s, what in need if s not in (R / f).read_text(encoding="utf-8")]
if bad: print("ALPHABETICAL PICKERS: FAIL\n  " + "\n  ".join(bad)); sys.exit(1)
print(f"alphabetical pickers: PASS ({len(need)} setup lists alphabetical by first name, one rule)")
