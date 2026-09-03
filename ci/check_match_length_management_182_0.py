#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
files = {
    rel: (ROOT / rel).read_text(encoding="utf-8")
    for rel in [
        "components/game/organizer-panel.tsx",
        "components/tournaments.tsx",
        "lib/game-setup-policy.ts",
        "migrations/0149_change_game_match_length.sql",
        "ci/test_fresh_db_rebuild.sh",
        "ci/assert-match-length-roundtrip.sql",
    ]
}

checks = {
    "Format renders shared hole picker": "<MatchLengthPicker" in files["components/game/organizer-panel.tsx"],
    "UI exposes scoring lock reason": "The number of holes is locked once scoring begins." in files["lib/game-setup-policy.ts"],
    "writer enforces shared policy": '!allowSetupChange({ type: "set_match_length", length: next })' in files["components/tournaments.tsx"],
    "client uses atomic RPC": 'supabase.rpc("change_game_match_length_before_scoring"' in files["components/tournaments.tsx"],
    "RPC locks authoritative state": "for update;" in files["migrations/0149_change_game_match_length.sql"],
    "RPC checks ordinary scores": "jsonb_array_elements(coalesce(gp.scores" in files["migrations/0149_change_game_match_length.sql"],
    "RPC checks Alternate Shot scores": "game_alt_shot_scores" in files["migrations/0149_change_game_match_length.sql"],
    "RPC preserves competitive fields": all(x not in files["migrations/0149_change_game_match_length.sql"].split("update public.games", 1)[1].split("update public.game_players", 1)[0] for x in ["teams =", "foursomes =", "pairings ="]),
    "fresh DB executes lifecycle": "assert-match-length-roundtrip.sql" in files["ci/test_fresh_db_rebuild.sh"],
    "round trip covers score lock": "Scored game unexpectedly changed length" in files["ci/assert-match-length-roundtrip.sql"],
    "round trip covers reset re-entry": "Reset did not restore length editability" in files["ci/assert-match-length-roundtrip.sql"],
}

failed = [name for name, passed in checks.items() if not passed]
if failed:
    print("Match-length management contract: FAIL")
    for name in failed: print(f" - {name}")
    sys.exit(1)
print(f"Match-length management contract: PASS ({len(checks)}/{len(checks)})")
