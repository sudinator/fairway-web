#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]

def text(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")

def require(rel: str, needle: str, why: str) -> bool:
    body = text(rel)
    if needle not in body:
        print(f"FAIL {rel}: {why}\n  missing: {needle}")
        return False
    return True

ok = True
workspace = "components/game/setup/game-setup-workspace.tsx"
tournaments = "components/tournaments.tsx"

checks = [
    (workspace, 'export type SetupTab = "players" | "teams" | "matchups" | "groups";', "setup navigation domain must remain explicit"),
    (workspace, "organizerPanelProps: OrganizerPanelProps;", "workspace must receive the existing organizer mutation contract rather than recreating it"),
    (workspace, 'const { usesTeams, usesMatchups, usesFoursomes } = shapeOf(game);', "step visibility must remain driven by current game shape"),
    (workspace, '{ key: "players", label: "Players" }', "Players must remain the first setup step"),
    (workspace, '...(usesTeams ? [{ key: "teams" as const, label: "Teams" }] : [])', "Teams visibility must remain format-dependent"),
    (workspace, '...(usesMatchups ? [{ key: "matchups" as const, label: "Matchups" }] : [])', "Matchups visibility must remain format-dependent"),
    (workspace, '...(!usesFoursomes ? [{ key: "groups" as const, label: "Groups" }] : [])', "Groups visibility must preserve foursome behavior"),
    (workspace, 'const activeStep = steps.some((s) => s.key === setupTab) ? setupTab : "players";', "hidden stale tabs must still fall back to Players without deleting state"),
    (workspace, '<OrganizerPanel section="players" {...organizerPanelProps} />', "Players step must reach the existing OrganizerPanel"),
    (workspace, '<OrganizerPanel section="teams" {...organizerPanelProps} />', "Teams step must reach the existing OrganizerPanel"),
    (workspace, '<GroupsBuilder game={game} players={players} onSetTeeGroup={onSetTeeGroup}', "Groups step must preserve tee-group callback wiring"),
    (tournaments, '} satisfies OrganizerPanelProps;', "GameRoom must keep compile-time checking of the organizer mutation contract"),
    (tournaments, '} satisfies React.ComponentProps<typeof GameSetupWorkspace>;', "GameRoom must keep compile-time checking of the setup workspace boundary"),
    (tournaments, 'return <GameSetupWorkspace {...workspaceProps} />;', "GameRoom setup render must reach the extracted workspace"),
    (tournaments, 'onSetTeeGroup: setPlayerTeeGroup, onRandomizeGroups: randomizeGroups, canRandomize, randomizeReason,', "tee-group/randomize behavior must remain wired through the boundary"),
    (tournaments, 'onOverride: overridePlayerHandicap, courseTees, onSetTee: setPlayerTee,', "per-player handicap and tee callbacks must remain wired"),
    (tournaments, 'eligibleMembers, onAddMember: addMemberToGame, onAddGuest: addGuestToGame,', "member/guest add callbacks must remain wired"),
]
for args in checks:
    ok = require(*args) and ok

body = text(workspace)
for forbidden in ["createClient(", "supabase.", '.from("', ".rpc("]:
    if forbidden in body:
        print(f"FAIL {workspace}: extracted render workspace must not own database side effects\n  forbidden: {forbidden}")
        ok = False

# Matchups intentionally remains outside this first extraction because StrokesSummary
# consumes setupTab in GameRoom. Keep that observable bridge until the UX redesign.
ok = require(tournaments, 'roomTab === "setup" && setupTab === "matchups"', "Matchups setup must remain connected to the existing StrokesSummary render path") and ok

if not ok:
    sys.exit(1)
print(f"Game setup workspace contract: PASS ({len(checks)} boundary links + no DB ownership)")
