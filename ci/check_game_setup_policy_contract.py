#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]

def body(rel): return (ROOT / rel).read_text(encoding="utf-8")

def require(rel, needle, why):
    if needle not in body(rel):
        print(f"FAIL {rel}: {why}\n  missing: {needle}")
        return False
    return True

ok = True
policy = "lib/game-setup-policy.ts"
tournaments = "components/tournaments.tsx"
organizer = "components/game/organizer-panel.tsx"
workspace = "components/game/setup/game-setup-workspace.tsx"
groups = "components/game/scorecard-views.tsx"
scoring = "components/game/scoring-views.tsx"

checks = [
    (policy, 'export function decideSetupChange', "one pure policy function must own setup decisions"),
    (policy, 'decision: "allow"', "policy must model allow"),
    (policy, 'decision: "confirm"', "policy must model confirm"),
    (policy, 'decision: "block"', "policy must model block"),
    (policy, 'individualReinterpretation', "individual-to-individual reinterpretation must remain explicit"),
    (policy, 'sameFoursomeFamily', "four-ball/trifecta same-foursome reinterpretation must remain explicit"),
    (policy, 'Team membership is frozen once that player\'s scoring begins.', "scored-player team freeze must be explicit"),
    (policy, 'Mark them No-show / Out instead', "played golf must not be deleted through Remove"),
    (policy, 'Do not use this if the player physically changed tees during the round.', "tee correction must distinguish data correction from mid-round tee switching"),
    (tournaments, 'const setupDecision = (action: SetupAction): SetupDecision =>', "GameRoom must evaluate central policy"),
    (tournaments, 'const allowSetupChange = (action: SetupAction): boolean =>', "GameRoom writes must enforce central policy"),
    (tournaments, '!allowSetupChange({ type: "set_tee", player: p, teeName })', "tee write must be policy-gated"),
    (tournaments, '!allowSetupChange({ type: "remove_player", player: p })', "remove write must be policy-gated"),
    (tournaments, '!allowSetupChange({ type: "set_format", target: next })', "format write must be policy-gated"),
    (tournaments, '!allowSetupChange({ type: "set_team", player: p, team })', "team write must be policy-gated"),
    (tournaments, '!allowSetupChange({ type: "set_tee_group", player: p, group })', "tee-group write must be policy-gated"),
    (organizer, 'const policy = (action: SetupAction) => decideSetupChange({ game, players, action });', "Organizer UI must use same central policy"),
    (organizer, 'disabled={blocked({ type: "remove_player", player: p })}', "scored-player Remove must be visibly disabled"),
    (organizer, 'const d = policy({ type: "set_format", target: key });', "format buttons must mirror central policy"),
    (workspace, 'game.status === "ended" ? "FINAL" : anyScores ? "SCORING" : "SETUP"', "Control Center must distinguish ended from active scoring"),
    (groups, 'getTeeGroupPolicy?: (p: Player, group: number | null)', "Groups UI must consume the tee-group policy"),
    (policy, '| { type: "change_course" }', "course replacement must be represented in central policy"),
    (policy, 'The course is locked once scoring begins.', "course replacement must freeze after scoring"),
    (tournaments, '!allowSetupChange({ type: "change_course" })', "course-change writer must enforce central policy"),
    (policy, '| { type: "set_pairings" }', "matchup structure must be represented in the central policy"),
    (policy, '| { type: "set_foursomes" }', "foursome structure must be represented in the central policy"),
    (scoring, 'decideSetupChange({ game, players, action })', "legacy Match/Fourball setup writers must use the central policy"),
    (scoring, 'if (!allowSetupMutation({ type: "set_pairings" })) return;', "matchup writes must be policy-gated"),
    (scoring, 'if (!allowFoursomeMutation()) return;', "foursome and mirrored tee-group writes must be policy-gated"),
    (scoring, 'disabled={matchupsBlocked}', "matchup controls must visibly freeze after scoring"),
    (scoring, 'disabled={foursomesBlocked}', "foursome controls must visibly freeze after scoring"),
]
for c in checks: ok = require(*c) and ok

# The policy layer is pure: no database/browser UI ownership.
for forbidden in ["supabase", "createClient(", ".from(\"", ".rpc(\"", "window.", "confirm(", "alert("]:
    if forbidden in body(policy):
        print(f"FAIL {policy}: policy must remain pure; found {forbidden}")
        ok = False

if not ok: sys.exit(1)
print(f"Game setup transition-policy contract: PASS ({len(checks)} source links + pure policy)")
