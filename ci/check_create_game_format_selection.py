from pathlib import Path

src = Path("components/tournaments.tsx").read_text(encoding="utf-8")
helper = Path("lib/create-game-format.ts").read_text(encoding="utf-8")
checks = {
    "direct six-format chooser": '["fourball", "Four-ball"]' in src and '["skins", "Skins"]' in src,
    "match individual/team": 'selectMatchPlayers("individual")' in src and 'selectMatchPlayers("team")' in src,
    "fourball 2v2/team-v-team": 'selectFourballCompetition("2v2")' in src and 'selectFourballCompetition("team")' in src and '>2 v 2 Match<' in src and '>Team vs Team<' in src,
    "skins three explicit styles": 'selectSkinsStyle("individual")' in src and 'selectSkinsStyle("team_11")' in src and 'selectSkinsStyle("team_2v2")' in src,
    "review shows full shape": 'formatReviewLabel({ gameType, teamMode, skinsTeamStyle, teamScoreMode, trifectaScoring, strokeBasis, skinsMode })' in src,
    "old duplicate team labels removed": 'Team four-ball (Red vs Blue)' not in src and 'Team match (e.g. 4 v 4)' not in src,
    "old family chooser removed": 'Two-family guided chooser' not in src and '>The whole field<' not in src and '>Head to head<' not in src,
    "pure mapping helper exists": 'export function selectBaseFormat' in helper and 'export function formatReviewLabel' in helper and 'export function reachableFormatKeys' in helper,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit("CREATE_GAME_FORMAT_SELECTION_FAIL: " + ", ".join(failed))
print(f"CREATE_GAME_FORMAT_SELECTION_PASS {len(checks)}/{len(checks)} checks")
