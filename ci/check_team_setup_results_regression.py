#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]

def read(rel): return (root / rel).read_text(encoding='utf-8')

def need(cond, msg):
    if not cond:
        raise SystemExit(f'TEAM/RESULTS REGRESSION CONTRACT: FAIL - {msg}')

trn = read('components/tournaments.tsx')
org = read('components/game/organizer-panel.tsx')
ws = read('components/game/setup/game-setup-workspace.tsx')
seg = read('components/game/segment-views.tsx')
score = read('components/game/scoring-views.tsx')

checks = [
    ('create fourball names visible', 'teamMode || gameType === "fourball" || gameType === "alt_shot"' in trn),
    ('manage team rename callback wired', 'onRenameTeams: renameTeams' in trn and 'onRenameTeams?: (names: [string, string])' in org),
    ('team-name inputs rendered in teams section', 'TEAM NAMES' in org and 'Save names' in org),
    ('leg editor lives in setup workspace format', 'LegConfigEditor' in ws and 'onSetLegConfig' in ws),
    ('old external leg editor removed', 'setupTab === "format" && isOrganizer && !isEnded && (game.game_type === "match"' not in trn),
    ('off suppresses group results', 'game.game_type === "alt_shot" || cfg.scheme === "none"' in seg),
    ('match progression is clickable', 'tap for progression' in score and 'MATCH PROGRESSION' in score and 'setOpenProgress' in score),
    ('match progression shows both net scores', 'pa.display_name.split(" ")[0]} NET' in score and 'pb.display_name.split(" ")[0]} NET' in score and 'Net scores drive the running match position' in score),
]
for label, ok in checks:
    need(ok, label)
print(f'Team/setup/results regression contract: PASS ({len(checks)}/{len(checks)})')
