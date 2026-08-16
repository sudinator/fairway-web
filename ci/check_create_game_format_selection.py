from pathlib import Path

create_src = Path("components/tournaments.tsx").read_text(encoding="utf-8")
manage_src = Path("components/game/organizer-panel.tsx").read_text(encoding="utf-8")
shared = Path("components/game/setup/format-family-selector.tsx").read_text(encoding="utf-8")
helper = Path("lib/create-game-format.ts").read_text(encoding="utf-8")
checks = {
    "shared guided family selector exists": 'export function FormatFamilySelector' in shared and '>The whole field<' in shared and '>Head to head<' in shared,
    "family icons live in shared selector": shared.count('<svg viewBox="0 0 24 24" width="18" height="18"') == 2,
    "create uses shared selector": 'import { FormatFamilySelector }' in create_src and '<FormatFamilySelector' in create_src,
    "manage uses shared selector": 'import { FormatFamilySelector, type FormatFamily }' in manage_src and '<FormatFamilySelector value={manageFormatFamily}' in manage_src,
    "stroke formats preserved": '>Stableford<' in create_src and '>Stroke play<' in create_src and '>Skins<' in create_src,
    "match hierarchy preserved": '>Individual<' in create_src and '>Team<' in create_src and '>Singles match<' in create_src and '>Four-ball<' in create_src and '>Trifecta<' in create_src,
    "fourball team-name label clarified": 'Create Team Names (Red vs Blue)' in create_src and 'Create named teams (e.g. Red vs Blue)' not in create_src and 'Team four-ball (Red vs Blue)' not in create_src,
    "custom handicap allowance restored": 'type="number"' in create_src and 'setAllowancePct(Math.max(0, Math.min(100' in create_src and '[100, 90, 85].map' in create_src,
    "manage format keeps policy gate": 'policy({ type: "set_format", target: key })' in manage_src and 'd.decision !== "block"' in manage_src,
    "manage family cards are presentation only": 'The family cards only filter the choices; the game changes when you select a format.' in manage_src,
    "review keeps detailed shape": 'formatReviewLabel({ gameType, teamMode, skinsTeamStyle, teamScoreMode, trifectaScoring, strokeBasis, skinsMode })' in create_src,
    "pure mapping helper retained": 'export function formatReviewLabel' in helper and 'export function reachableFormatKeys' in helper,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit("CREATE_GAME_FORMAT_SELECTION_FAIL: " + ", ".join(failed))
print(f"CREATE_GAME_FORMAT_SELECTION_PASS {len(checks)}/{len(checks)} checks")
