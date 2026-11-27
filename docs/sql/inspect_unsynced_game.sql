-- inspect_unsynced_game.sql — READ-ONLY. Run in the Supabase SQL editor (staging or production) to see the SERVER side of
-- a game whose scores the Profile reports as "not yet synced" on a phone. Replace the two codes with the games in question.
-- What "not yet synced" means on the phone: the game room keeps, per player row it scored, a BACKUP (the entries made
-- on this phone) and a WATERMARK (the server's copy as last confirmed by a read). A hole counts as pending when the
-- backup differs from the watermark on any of strokes / putts / fairway / penalties / sand. The outbox retries pending
-- entries whenever the scorecard is open AND this phone is the primary scoring device AND the game still accepts
-- scores. So a NEVER-CONFIRMED entry stays pending for good when one of those stops being true: the game ENDED before it
-- uploaded (ended cards refuse score writes), another device took over as primary (this phone's entries are kept but
-- never sent), or the game's scoring_version moved on (a reset, a course change — the backup is discarded on the next
-- open). An entry the server HAD confirmed never goes pending again: if someone corrects that row later, the next open
-- takes the server's value. And note the other direction: on a game that is still ACTIVE, opening it from the primary
-- phone RESENDS a pending entry — the phone's value wins over anything written on the server since (an organizer's
-- correction, the staging randomiser). Pending work is the phone's unfinished business, not a record of the server.
-- Whose outbox: the backups belong to the PHONE that made the entries, whoever the player is. A keeper who scores the
-- group has a backup per player; those are the keeper's own outbox, which is why other players' unsynced scores appear
-- on the keeper's Profile and hold the keeper's sign-out.
with g as (
  select id, code, name, status, game_type, played_at, created_at, scoring_version, score_epoch, scores_reset_at,
         last_score_change_at, marker_user_id, holes_meta
    from public.games where code in ('610175', '341750')
)
select g.code, g.name, g.status, g.game_type, g.played_at, g.scoring_version, g.score_epoch, g.scores_reset_at, g.last_score_change_at,
       jsonb_array_length(coalesce(g.holes_meta, '[]'::jsonb)) as holes,
       p.id as player_row_id, p.display_name, p.user_id, p.no_show, p.is_marker,
       (select count(*) from jsonb_array_elements(coalesce(p.scores, '[]'::jsonb)) s where s <> 'null'::jsonb and s <> '0'::jsonb) as holes_scored_on_server,
       p.scores, p.putts, p.penalties
  from g join public.game_players p on p.game_id = g.id
 order by g.code, p.display_name;

-- Who is the primary scoring device right now for each member in these games (the phone whose entries are accepted):
with g as (
  select id, code, name, status, game_type, played_at, created_at, scoring_version, score_epoch, scores_reset_at,
         last_score_change_at, marker_user_id, holes_meta
    from public.games where code in ('610175', '341750')
)
select g.code, p.display_name, d.user_id, d.token, d.claimed_at, d.last_seen_at
  from g join public.game_players p on p.game_id = g.id
  left join public.scoring_devices d on d.user_id = p.user_id
 where p.user_id is not null
 order by g.code, p.display_name;

-- The game's recent score history, if the activity log has it (who changed scores, when):
with g as (
  select id, code, name, status, game_type, played_at, created_at, scoring_version, score_epoch, scores_reset_at,
         last_score_change_at, marker_user_id, holes_meta
    from public.games where code in ('610175', '341750')
)
select g.code, a.created_at, a.actor_name, a.action, a.summary
  from g join public.activity_log a on a.summary ilike '%' || g.code || '%' or a.summary ilike '%' || g.name || '%'
 order by a.created_at desc limit 40;
