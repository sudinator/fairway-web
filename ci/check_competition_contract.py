#!/usr/bin/env python3
from pathlib import Path

checks = []
def check(name, cond):
    checks.append((name, bool(cond)))

root = Path(__file__).resolve().parents[1]
mig = (root/'migrations/0142_team_competitions.sql').read_text()
comp = (root/'components/competitions.tsx').read_text()
tour = (root/'components/tournaments.tsx').read_text()
types = (root/'lib/game-types.ts').read_text()
create = (root/'lib/game-create.ts').read_text()
logic = (root/'lib/competition.ts').read_text()
scoring = (root/'components/game/scoring-views.tsx').read_text()
schedule_mig = (root/'migrations/0143_competition_schedule_contract.sql').read_text()
lifecycle_mig = (root/'migrations/0145_competition_lifecycle.sql').read_text()

check('0142 records itself', "record_migration('0142_team_competitions')" in mig)
check('competition parent/roster/session tables exist', all(x in mig for x in ['create table if not exists public.competitions', 'create table if not exists public.competition_players', 'create table if not exists public.competition_sessions']))
check('session supports only existing team match engines', "format in ('fourball','alt_shot','match')" in mig)
check('child session links to ordinary game', 'game_id uuid unique references public.games(id)' in mig)
check('RLS enabled on all competition tables', mig.count('enable row level security') >= 3)
check('competition policies call canonical two-argument group helpers', 'is_group_member(group_id, auth.uid())' in mig and 'is_group_admin(group_id, auth.uid())' in mig and 'is_group_admin(p_group, auth.uid())' in mig and 'is_group_member(group_id)' not in mig and 'is_group_admin(group_id)' not in mig)
check('system admin retains Cup read/update visibility outside membership', 'is_group_member(group_id, auth.uid()) or public.is_admin()' in mig and 'public.is_admin() or (public.is_group_member(group_id, auth.uid())' in mig and mig.count('public.is_group_member(c.group_id, auth.uid()) or public.is_admin()') >= 2)
check('removed organizers cannot mutate Cup structure unless system admin', mig.count('public.is_admin() or (public.is_group_member(c.group_id, auth.uid()) and (c.created_by = auth.uid() or public.is_group_admin(c.group_id, auth.uid())))') >= 7 and mig.count('public.is_admin() or (public.is_group_member(group_id, auth.uid()) and (created_by = auth.uid() or public.is_group_admin(group_id, auth.uid())))') >= 3)
check('Cup creation is atomic through one database RPC', 'create or replace function public.create_team_competition' in mig and 'supabase.rpc("create_team_competition"' in comp)
check('Cup creation RPC validates active club roster and both teams', all(x in mig for x in ["Every Cup player must be an active club member", "Put at least one player on each Cup team"]))
check('Cup teams require distinct names and canonical A/B child keys', 'competitions_distinct_team_names_chk' in mig and "Cup team names must be different" in mig and "g.teams->0->>'key','') <> 'A'" in mig and "new.teams->1->>'key','') <> 'B'" in mig)
check('cup entry lives inside Games surface', 'listMode === "cups"' in tour and '<Competitions' in tour)
check('cup child game reuses CreateGame seed', 'competitionSession?:' in types and 'participantTeams?:' in types and 'seed?.competitionSession' in tour)
check('Cup organizer opt-out contract exists in shared player-row builder', 'includeCreator?: boolean' in create and 'const includeCreator = o.includeCreator !== false' in create and 'includeCreator: seed?.competitionSession' in tour)
check('team assignment is inherited into child game rows', 'seed?.participantTeams' in tour and 'team: seed.participantTeams?.[row.user_id]' in tour)
check('aggregation uses canonical existing scoring engines', all(x in logic for x in ['matchProgress(', 'fourballProgress(', 'altShotProgress(', 'canonicalAltShotGross(']))
check('UI exposes Four-Ball Alternate Shot Singles sessions', all(x in comp for x in ['Four-Ball', 'Alternate Shot', 'Singles']))
check('one match row keeps teams left/right with centered result', 'gridTemplateColumns: "minmax(0,1fr) 18px minmax(0,1fr)"' in comp and 'm.leftNames' in comp and 'm.rightNames' in comp)
check('linked Cup games keep persistent team contract', all(x in mig for x in ['competition_game_player_contract', 'competition_game_structure_contract', 'competition_roster_contract']))
check('roster trigger handles DELETE without touching NEW', "case when tg_op = 'DELETE' then old.competition_id else new.competition_id end" in mig)
check('competition score normalizes Team A to left', 'const reversed = ta === "B" && tb === "A"' in logic and 'winnerTeam: displayLead === 0 ? null : (displayLead > 0 ? "A" : "B")' in logic)
check('Cup score refreshes live while open', 'window.setInterval(() => { void load(); }, 15000)' in comp and '↻ Refresh' in comp)
check('0143 records locked schedule contract', "record_migration('0143_competition_schedule_contract')" in schedule_mig and 'planned_match_count' in schedule_mig and 'schedule_status' in schedule_mig)
check('locked schedule changes require explicit audited reopen', all(x in schedule_mig for x in ['lock_competition_schedule', 'reopen_competition_schedule', 'competition_schedule_events', 'p_reason']))
check('Cup denominator and clinch copy use planned schedule', all(x in logic + comp for x in ['competitionSchedule', 'planned_match_count', 'has clinched the Ryder Cup', 'needs ${fmtCompetitionPoints']))
check('Cup game handoff links an existing planned session', 'sessionId:' in types and 'from("competition_sessions").update({ game_id: game.id })' in tour)
check('weighted Cup points use golf quarter fractions', all(x in logic for x in ['"¼"', '"½"', '"¾"']) and 'fmtCompetitionPoints(path.pointsNeeded)' in comp)
check('Cup outcome separates outright and share-only paths', 'competitionOutcome' in logic and 'path.canShare' in comp and 'cannot win or share the Ryder Cup' in comp)
check('Singles outlook uses match points and long names wrap', 'matchPointsNeeded' in scoring and 'to win this session' in scoring and scoring.count('overflowWrap: "anywhere", lineHeight: 1.2') >= 2)
check('0145 records the Ryder Cup lifecycle contract', "record_migration('0145_competition_lifecycle')" in lifecycle_mig)
check('Ryder Cup lifecycle RPCs are authenticated and permission checked', all(x in lifecycle_mig for x in ['rename_team_competition', 'delete_team_competition', 'can_manage_competition(p_competition, auth.uid())', 'grant execute on function public.rename_team_competition(uuid, text)', 'grant execute on function public.delete_team_competition(uuid)', 'from public, anon']))
check('Ryder Cup deletion is atomic across linked games and parent', all(x in lifecycle_mig for x in ["set schedule_status = 'draft'", 'delete from public.game_players', 'delete from public.games', 'delete from public.competitions', 'v_game_ids uuid[]']))
check('Ryder Cup deletion preserves own-ball rounds and removes shared-ball rounds', all(x in lifecycle_mig for x in ["cs.format = 'alt_shot'", 'delete from public.rounds', 'Four-Ball and Singles posted rounds intentionally remain']))
check('Ryder Cup UI exposes rename and explicit format-aware deletion', all(x in comp for x in ['Edit title', 'Delete Ryder Cup', 'rename_team_competition', 'delete_team_competition', 'Personal rounds from Four-Ball and Singles will remain', 'Posted Alternate Shot rounds will also be deleted']))
check('successful Ryder Cup deletion exits detail and reloads the parent list',
      'onDeleted={() => { onSelected(null); void loadList(); }}' in comp and 'onDeleted();' in comp)
check('deleted Ryder Cup links use zero-row-safe loading and friendly copy',
      '.eq("id", competitionId).maybeSingle()' in comp and 'This Ryder Cup no longer exists.' in comp)
check('Ryder Cup navigation title is singular while list grammar remains plural', all(x in comp + tour for x in [
    '>Ryder Cup</button>', '<Eyebrow>RYDER CUP</Eyebrow>', 'YOUR RYDER CUPS', 'No Ryder Cups yet.',
]) and '>Ryder Cups</button>' not in tour)

bad=[name for name,ok in checks if not ok]
for name,ok in checks: print(('PASS' if ok else 'FAIL')+': '+name)
if bad: raise SystemExit(1)
print(f'competition contract: PASS ({len(checks)}/{len(checks)})')
