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
    (workspace, 'title: "Game"', "overview must expose Game"),
    (workspace, 'title: "Players"', "overview must expose Players"),
    (workspace, 'title: "Format"', "overview must expose Format"),
    (workspace, 'title: "Teams & groups"', "overview must expose Teams & groups"),
    (workspace, 'title: "Review"', "overview must expose Review"),
    (workspace, '<OrganizerPanel section="players" {...organizerPanelProps} />', "Players section must reach the existing OrganizerPanel"),
    (workspace, '<OrganizerPanel section="format" {...organizerPanelProps} />', "Format section must reuse existing format mutation handlers"),
    # 212.44 (owner, Oct 26): the compact team card, wired to Manage Game's own save handlers
    (workspace, 'onRenameTeams={organizerPanelProps.onRenameTeams} onSetTeamColours={organizerPanelProps.onSetTeamColours}', "Teams structure section must reach the compact team card with Manage Game's handlers"),
    (workspace, '<GroupsBuilder game={game} players={players} onSetTeeGroup={onSetTeeGroup}', "Groups structure section must preserve tee-group callback wiring"),
    (workspace, 'setupTab === "matchups"', "Matchups must remain a distinct reachable sub-state"),
    (workspace, 'onSetGameDate: (date: string) => Promise<void>;', "Game section must receive the existing organizer date writer"),
    (workspace, 'onChangeCourse: (course: Course) => Promise<void>;', "Game section must receive the atomic pre-score course-change callback"),
    # 202.1: the control passes the readable slug (falls back to the token for games shared before 0177).
    # 212.41 (owner, Oct 25): sharing moved to Review — the line-up and live scores links together (one switch),
    # offered only once the game is created and sent (never for a draft). The readable slug still leads the line-up link.
    (workspace, '<ShareLinks lineupToken={game.lineup_slug ?? null} liveToken={game.share_token ?? null} onShare={organizerPanelProps.onShare} />', "the share links must live in Review"),
    (workspace, 'The line-up and live scores links — and the line-up card — can be shared once you send the game to its players.', "a draft must not offer the share links"),
    (workspace, 'onClick={organizerPanelProps.onReset}', "Reset Scores must live in Game danger zone"),
    (workspace, 'onClick={organizerPanelProps.onDelete}', "Delete Game must live in Game danger zone"),
    (organizer, 'section?: "players" | "teams" | "format";', "OrganizerPanel must expose the separated Format surface"),
    (organizer, 'const orderedPlayers = useMemo(() => [...players].sort((a, b) =>', "setup roster order must be explicit rather than database-return order"),
    # 212.48: the shared name rule (lib/names byName — alphabetical by first name, ignoring capitals), with the id tie-breaker
    (organizer, '[...players].sort((a, b) => byName(a, b) || a.id.localeCompare(b.id))', "setup roster must sort alphabetically (lib/names), with a stable id tie-breaker"),
    (organizer, '{orderedPlayers.map((p) => {', "player editor must render the canonical alphabetical roster"),
    (organizer, 'display: section === "format" ? "none" : undefined', "Format surface must not duplicate the player editor"),
    (organizer, '{section === "format" && (', "competition/scoring mutations must remain reachable from Format"),
    (tournaments, '} satisfies OrganizerPanelProps;', "GameRoom must keep compile-time checking of the organizer mutation contract"),
    (tournaments, '} satisfies React.ComponentProps<typeof GameSetupWorkspace>;', "GameRoom must keep compile-time checking of the setup workspace boundary"),
    (tournaments, 'return <GameSetupWorkspace {...workspaceProps} />;', "GameRoom setup render must reach the extracted workspace"),
    (tournaments, 'onSetGameDate: setGameDate, courseOptions, onChangeCourse: changeGameCourse,', "game date/course writers must cross the workspace boundary"),
    (tournaments, 'onSetTeeGroup: setPlayerTeeGroup,', "tee-group behavior must remain wired through the boundary"),
    (tournaments, 'onSetAltShotFirstDriver: setAltShotFirstDriver,', "Alternate Shot first-driver behavior must remain wired through the boundary"),
    (tournaments, 'onSetTrifectaPairing: setTrifectaPairing,', "Trifecta Singles pairing must remain wired through the boundary"),
    (tournaments, 'onSetLegConfig: setLegConfig, getTeeGroupPolicy:', "leg configuration and group policy must remain wired through the boundary"),
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
