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
organizer = "components/game/organizer-panel.tsx"
tournaments = "components/tournaments.tsx"

checks = [
    (workspace, 'export type SetupTab = "overview" | "details" | "players" | "format" | "teams" | "matchups" | "groups" | "review";', "control-center navigation domain must remain explicit"),
    (workspace, "organizerPanelProps: OrganizerPanelProps;", "workspace must receive the existing organizer mutation contract rather than recreating it"),
    (workspace, 'const { usesTeams, usesMatchups, usesFoursomes } = shapeOf(game);', "structure visibility must remain driven by current game shape"),
    (workspace, 'title: "Game details"', "overview must expose Game details"),
    (workspace, 'title: "Players"', "overview must expose Players"),
    (workspace, 'title: "Format"', "overview must expose Format"),
    (workspace, 'title: "Teams & groups"', "overview must expose Teams & groups"),
    (workspace, 'title: "Review"', "overview must expose Review"),
    (workspace, '<OrganizerPanel section="players" {...organizerPanelProps} />', "Players section must reach the existing OrganizerPanel"),
    (workspace, '<OrganizerPanel section="format" {...organizerPanelProps} />', "Format section must reuse existing format mutation handlers"),
    (workspace, '<OrganizerPanel section="teams" {...organizerPanelProps} />', "Teams structure section must reach the existing OrganizerPanel"),
    (workspace, '<GroupsBuilder game={game} players={players} onSetTeeGroup={onSetTeeGroup}', "Groups structure section must preserve tee-group callback wiring"),
    (workspace, 'setupTab === "matchups"', "Matchups must remain a distinct reachable sub-state"),
    (workspace, 'onSetGameDate: (date: string) => Promise<void>;', "Game details must receive the existing organizer date writer"),
    (organizer, 'section?: "players" | "teams" | "format";', "OrganizerPanel must expose the separated Format surface"),
    (organizer, 'const orderedPlayers = useMemo(() => [...players].sort((a, b) =>', "setup roster order must be explicit rather than database-return order"),
    (organizer, '(a.display_name || "").localeCompare(b.display_name || "", undefined, { sensitivity: "base" }) ||', "setup roster must sort alphabetically, case-insensitively"),
    (organizer, 'a.id.localeCompare(b.id),', "setup roster ordering must have a stable id tie-breaker"),
    (organizer, '{orderedPlayers.map((p) => {', "player editor must render the canonical alphabetical roster"),
    (organizer, 'display: section === "format" ? "none" : undefined', "Format surface must not duplicate the player editor"),
    (organizer, '{section === "format" && (', "existing game-setting mutations must be reachable from Format"),
    (tournaments, '} satisfies OrganizerPanelProps;', "GameRoom must keep compile-time checking of the organizer mutation contract"),
    (tournaments, '} satisfies React.ComponentProps<typeof GameSetupWorkspace>;', "GameRoom must keep compile-time checking of the setup workspace boundary"),
    (tournaments, 'return <GameSetupWorkspace {...workspaceProps} />;', "GameRoom setup render must reach the extracted workspace"),
    (tournaments, 'onSetGameDate: setGameDate,', "existing game-date writer must cross the workspace boundary"),
    (tournaments, 'onSetTeeGroup: setPlayerTeeGroup, getTeeGroupPolicy:', "tee-group/randomize behavior must remain wired through the boundary"),
    (tournaments, 'onOverride: overridePlayerHandicap, courseTees, onSetTee: setPlayerTee,', "per-player handicap and tee callbacks must remain wired"),
    (tournaments, 'eligibleMembers, onAddMember: addMemberToGame, onAddGuest: addGuestToGame,', "member/guest add callbacks must remain wired"),
]
for args in checks:
    ok = require(*args) and ok

body = text(workspace)
for forbidden in ["createClient(", "supabase.", '.from("', ".rpc("]:
    if forbidden in body:
        print(f"FAIL {workspace}: control-center workspace must not own database side effects\n  forbidden: {forbidden}")
        ok = False

# Matchups remain rendered by the established StrokesSummary/match components in GameRoom.
ok = require(tournaments, 'roomTab === "setup" && setupTab === "matchups"', "Matchups setup must remain connected to the existing downstream render path") and ok

if not ok:
    sys.exit(1)
print(f"Game setup workspace contract: PASS ({len(checks)} boundary links + no DB ownership)")
