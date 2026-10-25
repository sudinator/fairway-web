#!/usr/bin/env python3
"""212.39 (one-step creation, phase 1 part 2) — ci/assert-structure-behaviour.sql pins what Manage Game sends and stores,
generated from the SHARED rules in lib/structure-ops. That only holds if Manage Game's save handlers use them rather than
their own copies. Each handler's payload-building lives in lib/structure-ops (moved verbatim in 212.39)."""
import pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
t = (ROOT / "components/tournaments.tsx").read_text(encoding="utf-8")
sv = (ROOT / "components/game/scoring-views.tsx").read_text(encoding="utf-8")
bad = []
need = {"SO.teamPlayFoursomesAfter(": "syncTeamPlayFoursomes", "SO.altShotFirstDriverFoursomes(": "setAltShotFirstDriver",
        "SO.trifectaSwapFoursomes(": "setTrifectaPairing", "SO.scrambleTeeAssignments(": "setScrambleTeams"}
for call, handler in need.items():
    if call not in t: bad.append(f"{handler} must use lib/structure-ops ({call.rstrip('(')})")
if t.count("SO.teamMoveArgs(") < 2: bad.append("setPlayerTeam and balanceTeamsByHandicap must both build apply_game_structure with SO.teamMoveArgs")
if re.search(r"const teamFormat = Array\.isArray\(game\.teams\) && game\.teams\.length === 2 && \(game\.game_type === \"fourball\"", t):
    bad.append("a Manage Game handler keeps its own copy of the team-format rule — use lib/structure-ops")
if "foursomeTeeGroupUpdates(" not in sv: bad.append("the foursome editor (saveFoursomes) must use lib/structure-ops foursomeTeeGroupUpdates")
for f in ["ci/test_fresh_db_rebuild.sh", "ci/test_fresh_db_local.sh"]:
    if "assert-structure-behaviour" not in (ROOT / f).read_text(encoding="utf-8"): bad.append(f"{f} must run ci/assert-structure-behaviour.sql")
if bad: print("STRUCTURE BEHAVIOUR: FAIL\n  " + "\n  ".join(bad)); sys.exit(1)
print("structure behaviour: PASS (Manage Game's save handlers use the shared rules the phase-1 record pins)")
