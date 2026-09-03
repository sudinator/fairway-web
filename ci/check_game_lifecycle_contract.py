#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
migration = (root / "migrations/0145_competition_lifecycle.sql").read_text()
manage = (root / "components/manage.tsx").read_text()
home = (root / "components/home.tsx").read_text()
tournaments = (root / "components/tournaments.tsx").read_text()
competitions = (root / "components/competitions.tsx").read_text()
workspace = (root / "components/game/setup/game-setup-workspace.tsx").read_text()
live_rls = (root / "ci/assert-core-rls-live.sql").read_text()
behavior = (root / "ci/assert-core-rls-behavior.sql").read_text()

checks = []

def check(name, condition):
    checks.append((name, bool(condition)))

check("organizer deletion rejects ended or posted Games", all(x in migration for x in [
    "v_game.status = 'ended'", "where r.game_id = p_game", "Only a system admin can delete a completed game",
]))
check("system-admin Game deletion is authenticated and anon-denied", all(x in migration for x in [
    "create or replace function public.admin_delete_game", "not public.is_admin()",
    "revoke all on function public.admin_delete_game(uuid)", "from public, anon",
]))
check("system-admin deletion removes only Alternate Shot history", all(x in migration for x in [
    "v_game.game_type = 'alt_shot'", "delete from public.holes", "delete from public.rounds",
]))
check("system-admin Game deletion is transactionally audited", all(x in migration for x in [
    "'admin_game_repair'", "System admin deleted game", "v_game.group_id",
]) and 'await adminLog(`System admin deleted game' not in tournaments)
check("completed Ryder Cup deletion is system-admin-only", all(x in migration for x in [
    "v_status = 'complete'", "g.status = 'ended'", "if v_protected and not public.is_admin()",
    "Only a system admin can delete a Ryder Cup containing completed games",
]))
oversight_body = migration[migration.index("create or replace function public.admin_game_oversight"):migration.index("create or replace function public.delete_team_competition")]
check("system-admin oversight RPC is bounded and read-only", all(x in oversight_body for x in [
    "least(coalesce(p_limit, 200), 500)", "Only a system admin can inspect all games", "returns table",
    "grant execute on function public.admin_game_oversight",
]) and all(x not in oversight_body for x in ["delete from", "update public.", "insert into public."]))
check("system admins get SELECT-only game-player inspection", all(x in migration for x in [
    'create policy "system admins read game players"', "for select", "using (public.is_admin())",
]))
check("live RLS contract includes system-admin inspection policy", "system admins read game players" in live_rls and "60 policy identities" in live_rls)
check("fresh database behavior proves admin visibility and deletion preservation", all(x in behavior for x in [
    "ordinary member used system-admin Game oversight", "organizer deleted a completed game",
    "unrelated Game players are not visible", "removed an own-ball round",
    "preserved an Alternate Shot shared-ball round",
]))
auth_fixture_pos = behavior.find("insert into auth.users")
competition_fixture_pos = behavior.find("insert into public.competitions")
check("fresh database creates auth principals before FK-protected Ryder Cup fixtures",
      0 <= auth_fixture_pos < competition_fixture_pos)
check("Admin home exposes searchable Games oversight", all(x in manage for x in [
    "function AdminGamesOversight", 'case "games": title = "Games oversight"',
    'name="Games oversight"', 'supabase.rpc("admin_game_oversight"', "Inspect Game →",
]))
admin_screen = manage[manage.index("function AdminGamesOversight"):manage.index("function RoundSaveDiag")]
check("Admin inspection opens existing Game without joining and returns to oversight", all(x in home for x in [
    'setOpenGameId(gid); setOpenGameReturnTab("admin"); setTab("games")',
    'onExitOpenGame={openGameReturnTab === "admin"',
]) and "onExitOpenGame?.()" in tournaments and '.from("game_players").insert' not in admin_screen)
check("Game room labels system-admin actions explicitly", "System admin repair" in tournaments and "as system admin" in tournaments and 'Admin repair · you are not the organizer' not in tournaments)
check("organizer UI hides completed Game deletion", "canDelete: !completedGame" in tournaments and "Only a system admin can delete a completed game" in workspace)
check("Ryder Cup UI distinguishes system admin from other managers", all(x in competitions for x in [
    "isSystemAdmin", "containsCompletedGame", "canDeleteCompetition", "Only a system admin can delete it",
]))

failed = [name for name, ok in checks if not ok]
for name, ok in checks:
    print(("PASS" if ok else "FAIL") + ": " + name)
if failed:
    raise SystemExit(1)
print(f"game lifecycle contract: PASS ({len(checks)}/{len(checks)})")
