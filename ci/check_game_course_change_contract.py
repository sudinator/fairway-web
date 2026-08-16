#!/usr/bin/env python3
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]

def body(rel): return (ROOT / rel).read_text(encoding="utf-8")
def req(rel, needle, why):
    if needle not in body(rel):
        print(f"FAIL {rel}: {why}\n  missing: {needle}")
        return False
    return True
ok=True
migration="migrations/0138_change_game_course_before_scoring.sql"
tournaments="components/tournaments.tsx"
workspace="components/game/setup/game-setup-workspace.tsx"
checks=[
 (migration,"create or replace function public.change_game_course_before_scoring", "atomic RPC must exist"),
 (migration,"for update;", "game/player state must be locked before mutation"),
 (migration,"v_game.created_by is distinct from auth.uid()", "only organizer may change course"),
 (migration,"ended games cannot change course", "ended games must be blocked"),
 (migration,"course cannot change after scoring begins", "authoritative DB score guard must exist"),
 (migration,"tee_name = null", "old tee name must be invalidated"),
 (migration,"rating = null", "old rating must be invalidated"),
 (migration,"slope = null", "old slope must be invalidated"),
 (migration,"course_handicap = null", "old course handicap must be invalidated"),
 (migration,"scores = v_blank", "blank score arrays must resize to new course"),
 (migration,"revoke all on function public.change_game_course_before_scoring", "RPC must not be public/anon executable"),
 (migration,"grant execute on function public.change_game_course_before_scoring", "authenticated organizer must be able to call RPC"),
 (tournaments,'supabase.rpc("change_game_course_before_scoring"', "client must use atomic RPC rather than browser multi-write"),
 (tournaments,'clearAllGameScores(game.id);', "old local score backups must be cleared after course replacement"),
 (tournaments,'setSetupTab("players");', "successful course replacement must route organizer to tee reassignment"),
 (workspace,'Course is locked once scoring begins.', "UI must explain score-state lock"),
 (workspace,"clears every player's tee", "UI must explain tee invalidation"),
 (workspace,'playersDone = total > 0 && cWithHcp === total', "Review readiness must remain incomplete while cleared tees have no course handicap"),
]
for c in checks: ok=req(*c) and ok
if not ok: sys.exit(1)
print(f"Game course-change contract: PASS ({len(checks)} source links)")
