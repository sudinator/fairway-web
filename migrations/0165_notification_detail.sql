-- 0165_notification_detail.sql
--
-- Notifications say WHAT happened, to WHOM, and WHERE — not that "something changed".
--
-- Every notification in the app was audited (23 of them: 13 written here in SQL, 10 by the client
-- through create_notification). The pattern was "A new golfer joined your club", "You've been added
-- to a new game", "A course in your library has upstream data changes". Each one made the reader go
-- and find out what the notification already knew. This migration:
--
--   1. Adds notifications.detail: a second, longer line (the list of yardage changes, the holes an
--      admin edited) shown under the message. The push payload carries only the message.
--   2. Adds one helper, person_label(uuid), so every function names people the same way: display
--      name, else the email prefix, else "A golfer". The member-joined trigger was reading
--      profiles.display_name at the instant the membership row was inserted, which for a brand-new
--      signup is still empty — hence "A new golfer joined your club." The email is always present.
--   3. Redefines the nine trigger/function writers with specific text (below).
--   4. Moves the bet notification to a DEFERRED constraint trigger. save_bet_expense_atomic inserts
--      the expense row first and the payers/shares after it, inside one transaction; an ordinary
--      AFTER INSERT trigger on expenses therefore fires before any share exists and cannot say who
--      owes what. Deferred to commit, it sees the complete bet. notify_money_owed now skips bet
--      shares so a loser is told once, not twice.
--   5. Gives create_notification a p_detail argument. The 5-argument overload is dropped: both
--      overloads would match the client's named-argument calls and PostgREST refuses an ambiguous
--      call (PGRST203).
--   6. Adds admin_member_signups() for the Admin screen: when each member signed up for BNN
--      (auth.users.created_at, the true moment) and when they joined each club.
--
-- AUTHORIZATION:
--   * All notify_* trigger functions are SECURITY DEFINER with no grant to app roles; they run only
--     from their triggers and insert for the same recipients as before. Recipient selection is
--     unchanged: active group members, the game's players, the owning group's active admins.
--   * person_label is a read helper granted to authenticated; it exposes a display name or the
--     local part of an email address, which the roster screens already show to members.
--   * create_notification keeps its existing caller check (self, admin, game organizer to a player,
--     club admin to a member) verbatim; only the insert gains p_detail.
--   * send_tee_reminders and sweep_friction are pg_cron jobs; the sweep itself is untouched and its
--     admin notice is enriched by a BEFORE INSERT trigger on notifications (no grant to app roles).
--   * admin_member_signups requires is_admin(); it reads auth.users.created_at and group_members
--     for everyone, which is why it is gated on the app admin and nobody else.
--   * record_course_freshness keeps its is_group_member(v_group, auth.uid()) gate from 0126.
--
-- Idempotent; safe to re-run.

begin;

alter table public.notifications add column if not exists detail text;
comment on column public.notifications.detail is
  'Optional second line with the specifics (change list, holes edited). The message is the one-line '
  'summary and is what push carries (0165).';

-- ── Name people one way ──────────────────────────────────────────────────────────────────────────
create or replace function public.person_label(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(trim(display_name), '') from public.profiles where id = p_user),
    (select split_part(email, '@', 1) from public.profiles where id = p_user and nullif(email, '') is not null),
    (select split_part(u.email::text, '@', 1) from auth.users u where u.id = p_user),
    'A golfer');
$$;
revoke all on function public.person_label(uuid) from public;
revoke all on function public.person_label(uuid) from anon;
grant execute on function public.person_label(uuid) to authenticated;

create or replace function public.usd(p_cents integer)
returns text language sql immutable as $$
  select '$' || to_char(coalesce(p_cents, 0) / 100.0, 'FM999,999,990.00');
$$;

-- ── create_notification: + detail ────────────────────────────────────────────────────────────────
drop function if exists public.create_notification(uuid, text, uuid, text, text);
create or replace function public.create_notification(
  p_recipient uuid,
  p_message   text,
  p_group_id  uuid default null,
  p_type      text default null,
  p_link      text default null,
  p_detail    text default null
) returns void
language plpgsql security definer set search_path = public as $function$
declare
  v_sender uuid := auth.uid();
begin
  if v_sender is null then
    raise exception 'not authenticated';
  end if;
  if p_recipient is null or p_message is null then
    raise exception 'recipient and message are required';
  end if;
  if not (
    p_recipient = v_sender
    or is_admin()
    or exists (select 1 from profiles p where p.id = p_recipient and p.is_admin = true)
    or exists (
      select 1 from games g
      join game_players gp on gp.game_id = g.id
      where g.created_by = v_sender and gp.user_id = p_recipient
    )
    or exists (
      select 1 from group_members ga
      join group_members gm on gm.group_id = ga.group_id
      where ga.user_id = v_sender and ga.role = 'admin' and ga.status = 'active'
        and gm.user_id = p_recipient and gm.status = 'active'
    )
  ) then
    raise exception 'not allowed to notify this user';
  end if;
  insert into notifications (user_id, message, group_id, type, link, detail)
  values (p_recipient, p_message, p_group_id, p_type, p_link, nullif(trim(p_detail), ''));
end;
$function$;
revoke all on function public.create_notification(uuid, text, uuid, text, text, text) from public;
revoke all on function public.create_notification(uuid, text, uuid, text, text, text) from anon;
grant execute on function public.create_notification(uuid, text, uuid, text, text, text) to authenticated;

-- ── Member joined ────────────────────────────────────────────────────────────────────────────────
-- "Amit Sud joined Pine Valley Hackers (new to BNN, signed up today)." or "(already in 2 other clubs)".
create or replace function public.notify_group_member() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare nm text; cn text; v_other integer; v_signed timestamptz; v_who text;
begin
  if new.user_id is null or new.status is distinct from 'active' then return new; end if;
  if tg_op = 'UPDATE' and old.status is not distinct from 'active' then return new; end if;
  nm := public.person_label(new.user_id);
  select name into cn from groups where id = new.group_id;
  select count(*) into v_other from group_members
   where user_id = new.user_id and status = 'active' and group_id <> new.group_id;
  select created_at into v_signed from auth.users where id = new.user_id;
  v_who := case
    when v_other = 0 and v_signed > now() - interval '2 days' then ' (new to BNN, signed up ' ||
      case when v_signed::date = current_date then 'today' else 'yesterday' end || ')'
    when v_other = 0 then ' (their first club)'
    else ' (already in ' || v_other || ' other club' || case when v_other = 1 then '' else 's' end || ')'
  end;
  insert into notifications (user_id, message, group_id, type, link)
  select gm.user_id, nm || ' joined ' || coalesce(cn, 'your club') || v_who || '.',
         new.group_id, 'group_member', '/?tab=groups'
  from group_members gm
  where gm.group_id = new.group_id and gm.status = 'active' and gm.user_id is not null
    and gm.user_id is distinct from new.user_id;
  return new;
end $fn$;

-- ── Added to a game ──────────────────────────────────────────────────────────────────────────────
-- "Amit added you to "Saturday Fourball" — Essex County, set up Sat Oct 4, fourball (code ABCD)."
create or replace function public.notify_game_added() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare g record;
begin
  if new.user_id is null then return new; end if;
  select id, name, course, game_type, code, created_by, group_id, created_at into g from games where id = new.game_id;
  if g.id is null then return new; end if;
  if g.created_by is not null and new.user_id = g.created_by then return new; end if;
  insert into notifications (user_id, message, group_id, type, link, detail)
  values (new.user_id,
          public.person_label(g.created_by) || ' added you to "' || coalesce(g.name, 'a game') || '".',
          g.group_id, 'game_added', '/?tab=games',
          coalesce(g.course, '') ||
          case when g.course is not null then ' · ' else '' end ||
          'set up ' || to_char(g.created_at at time zone 'America/New_York', 'Dy Mon FMDD') ||
          ' · ' || replace(coalesce(g.game_type, 'game'), '_', ' ') ||
          case when g.code is not null then ' · code ' || g.code else '' end ||
          case when new.tee_name is not null then ' · you play the ' || new.tee_name || ' tees' else '' end ||
          case when new.course_handicap is not null then ' (CH ' || new.course_handicap || ')' else '' end);
  return new;
end $fn$;

-- ── Game final ───────────────────────────────────────────────────────────────────────────────────
-- Individual formats: ""Saturday Stableford" is final: you shot 84 (net 72), 2nd of 8 by net."
-- Team formats:       ""Saturday Fourball" is final: you shot 84 (net 72). Open the game for the match result."
-- The team result itself lives in the scoring engines in the app, not in SQL; stating it here would
-- be a second implementation of the match rules. The player's own strokes are plain arithmetic.
create or replace function public.notify_game_finished() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  v_holes integer;
  v_individual boolean;
begin
  if new.status is distinct from 'ended' or old.status is not distinct from 'ended' then return new; end if;
  v_holes := coalesce(jsonb_array_length(new.holes_meta), 18);
  v_individual := coalesce(new.game_type, '') in ('stableford', 'stroke', 'individual', 'skins');
  with scored as (
    select gp.user_id, gp.course_handicap,
           (select sum((x)::text::numeric)::integer from jsonb_array_elements(gp.scores) x
             where jsonb_typeof(x) = 'number' and (x)::text::numeric > 0) as gross,
           (select count(*) from jsonb_array_elements(gp.scores) x
             where jsonb_typeof(x) = 'number' and (x)::text::numeric > 0) as played
    from game_players gp
    where gp.game_id = new.id and gp.user_id is not null and not coalesce(gp.no_show, false)
  ),
  ranked as (
    select s.*, (s.gross - coalesce(s.course_handicap, 0)) as net,
           rank() over (order by (s.gross - coalesce(s.course_handicap, 0)) asc) as pos,
           count(*) over () as field
    from scored s where s.gross is not null and s.played >= v_holes
  )
  insert into notifications (user_id, message, group_id, type, link)
  select s.user_id,
         '"' || coalesce(new.name, 'Your game') || '" is final' ||
         case when s.gross is null then '.'
              when s.played < v_holes then ': you were ' || s.gross || ' thru ' || s.played || '.'
              else ': you shot ' || s.gross || ' (net ' || (s.gross - coalesce(s.course_handicap, 0)) || ')' ||
                   case when v_individual and r.pos is not null then
                        ', ' || r.pos || case when r.pos % 10 = 1 and r.pos % 100 <> 11 then 'st'
                                              when r.pos % 10 = 2 and r.pos % 100 <> 12 then 'nd'
                                              when r.pos % 10 = 3 and r.pos % 100 <> 13 then 'rd' else 'th' end ||
                        ' of ' || r.field || ' by net.'
                        else '. Open the game for the match result.' end
         end,
         new.group_id, 'game_finished', '/?tab=games'
  from scored s left join ranked r on r.user_id = s.user_id;
  return new;
end $fn$;

-- ── Bet posted (deferred so the shares exist) ────────────────────────────────────────────────────
-- Winner: "Bet posted for "Saturday Fourball": you won $36.00."
-- Loser:  "Bet posted for "Saturday Fourball": you owe Amit Sud $12.00."
create or replace function public.notify_bet_posted() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare v_game text; v_payer text;
begin
  if new.source_kind is distinct from 'tgc_bet' or new.source_game_id is null then return new; end if;
  select name into v_game from games where id = new.source_game_id;
  v_payer := public.person_label(new.payer_user_id);
  insert into notifications (user_id, message, group_id, type, link, detail)
  select gp.user_id,
         'Bet posted for "' || coalesce(v_game, 'your game') || '": ' ||
         case when coalesce(pay.paid, 0) - coalesce(sh.owed, 0) > 0 then 'you won ' || public.usd(coalesce(pay.paid, 0) - coalesce(sh.owed, 0)) || '.'
              when coalesce(sh.owed, 0) - coalesce(pay.paid, 0) > 0 then 'you owe ' || v_payer || ' ' || public.usd(coalesce(sh.owed, 0) - coalesce(pay.paid, 0)) || '.'
              else 'you broke even.' end,
         new.group_id, 'bet_posted', '/?tab=money',
         'Pot ' || public.usd(new.amount_cents) || case when nullif(new.description, '') is not null then ' · ' || new.description else '' end ||
         ' · posted by ' || public.person_label(new.created_by)
  from game_players gp
  left join lateral (select sum(share_cents)::integer as owed from expense_shares es
                      where es.expense_id = new.id and (es.user_id = gp.user_id or es.sponsor_user_id = gp.user_id)) sh on true
  left join lateral (select sum(paid_cents)::integer as paid from expense_payers ep
                      where ep.expense_id = new.id and (ep.user_id = gp.user_id or ep.sponsor_user_id = gp.user_id)) pay on true
  where gp.game_id = new.source_game_id and gp.user_id is not null
    and gp.user_id is distinct from new.created_by;
  return new;
end $fn$;
drop trigger if exists trg_notify_bet_posted on public.expenses;
create constraint trigger trg_notify_bet_posted
  after insert on public.expenses
  deferrable initially deferred
  for each row execute function public.notify_bet_posted();

-- ── Charged ──────────────────────────────────────────────────────────────────────────────────────
-- "$25.00 charge from Amit Sud: "Greens fees, Oct 4" (Pine Valley Hackers)."
create or replace function public.notify_money_owed() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare e record; cn text;
begin
  if new.user_id is null then return new; end if;
  if new.share_cents <= 0 then return new; end if;
  select payer_user_id, group_id, description, source_kind, created_by into e from expenses where id = new.expense_id;
  if e.payer_user_id is not null and new.user_id = e.payer_user_id then return new; end if;
  -- Bet shares are announced by notify_bet_posted with the game and the result.
  if e.source_kind = 'tgc_bet' then return new; end if;
  select name into cn from groups where id = e.group_id;
  insert into notifications (user_id, message, group_id, type, link)
  values (new.user_id,
          public.usd(new.share_cents) || ' charge from ' || public.person_label(coalesce(e.payer_user_id, e.created_by)) ||
          case when nullif(e.description, '') is not null then ': "' || e.description || '"' else '' end ||
          case when cn is not null then ' (' || cn || ')' else '' end || '.',
          e.group_id, 'money_owed', '/?tab=money');
  return new;
end $fn$;

-- ── Paid ─────────────────────────────────────────────────────────────────────────────────────────
-- "Amit Sud paid you $25.00 by Venmo (Pine Valley Hackers)."
create or replace function public.notify_money_paid() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare cn text;
begin
  if new.to_user_id is null then return new; end if;
  select name into cn from groups where id = new.group_id;
  insert into notifications (user_id, message, group_id, type, link)
  values (new.to_user_id,
          public.person_label(new.from_user_id) || ' paid you ' || public.usd(new.amount_cents) ||
          case when nullif(new.method, '') is not null then ' by ' || new.method else '' end ||
          case when cn is not null then ' (' || cn || ')' else '' end || '.',
          new.group_id, 'money_paid', '/?tab=money');
  return new;
end $fn$;

-- ── New tee time ─────────────────────────────────────────────────────────────────────────────────
-- "New tee time: Essex County, Sat Oct 4 at 8:10, posted by Amit — RSVP by Thu Oct 2."
create or replace function public.notify_tee_new() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare v_times text;
begin
  select string_agg(t, ', ' order by t) into v_times from unnest(coalesce(new.tee_off_times, '{}')) t;
  insert into notifications (user_id, message, group_id, type, link, detail)
  select gm.user_id,
         'New tee time: ' || coalesce(nullif(new.course, ''), nullif(new.title, ''), 'course TBA') || ', ' ||
         to_char(new.play_date, 'Dy Mon FMDD') ||
         case when v_times is not null and v_times <> '' then ' at ' || v_times else '' end ||
         ', posted by ' || public.person_label(new.created_by) ||
         case when new.signup_deadline is not null
              then ' — RSVP by ' || to_char(new.signup_deadline at time zone 'America/New_York', 'Dy Mon FMDD')
              else ' — tap to RSVP' end || '.',
         new.group_id, 'tee_new', '/?tt=' || new.id::text,
         nullif(concat_ws(' · ', nullif(new.title, ''), case when new.max_spots is not null then new.max_spots || ' spots' end, nullif(new.notes, '')), '')
  from group_members gm
  where gm.group_id = new.group_id and gm.status = 'active' and gm.user_id is not null
    and gm.user_id is distinct from new.created_by;
  return new;
end $fn$;

-- ── Tee reminders (cron) ─────────────────────────────────────────────────────────────────────────
-- Deadline: "RSVP closes soon: Essex County, Sat Oct 4 at 8:10 — 6 in so far."
-- Day-of:   "Tee time today: Essex County at 8:10 — 8 playing: Amit, Bob, ..."
create or replace function public.send_tee_reminders()
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Deadline reminder: once, to active members who have not answered, when the deadline is within
  -- the next 24 hours (same window and dedup as 0074).
  insert into notifications (user_id, message, group_id, type, link)
  select gm.user_id,
         'RSVP closes soon: ' || coalesce(nullif(t.course, ''), nullif(t.title, ''), 'tee time') || ', ' ||
         to_char(t.play_date, 'Dy Mon FMDD') ||
         coalesce(' at ' || (select string_agg(x, ', ' order by x) from unnest(t.tee_off_times) x), '') ||
         ' — ' || (select count(*) from tee_time_rsvps r where r.tee_time_id = t.id and r.choice = 'in') || ' in so far.',
         t.group_id, 'tee_reminder', '/?tt=' || t.id::text || '&r=deadline'
  from public.tee_times t
  join public.group_members gm on gm.group_id = t.group_id and gm.status = 'active' and gm.user_id is not null
  where t.status = 'upcoming'
    and t.signup_deadline is not null
    and t.signup_deadline between now() and now() + interval '24 hours'
    and not exists (select 1 from public.tee_time_rsvps r where r.tee_time_id = t.id and r.user_id = gm.user_id)
    and not exists (select 1 from public.notifications n where n.user_id = gm.user_id and n.type = 'tee_reminder'
                      and n.link = '/?tt=' || t.id::text || '&r=deadline');

  -- Day-of reminder: once, to those who are in, on the morning of the play date (Eastern).
  insert into notifications (user_id, message, group_id, type, link, detail)
  select r.user_id,
         'Tee time today: ' || coalesce(nullif(t.course, ''), nullif(t.title, ''), 'see you out there') ||
         coalesce(' at ' || (select string_agg(x, ', ' order by x) from unnest(t.tee_off_times) x), '') ||
         ' — ' || (select count(*) from tee_time_rsvps r2 where r2.tee_time_id = t.id and r2.choice = 'in') || ' playing.',
         t.group_id, 'tee_reminder', '/?tt=' || t.id::text || '&r=day',
         (select string_agg(public.person_label(r3.user_id), ', ' order by public.person_label(r3.user_id))
            from tee_time_rsvps r3 where r3.tee_time_id = t.id and r3.choice = 'in' and r3.user_id is not null)
  from public.tee_times t
  join public.tee_time_rsvps r on r.tee_time_id = t.id and r.choice = 'in' and r.user_id is not null
  where t.status = 'upcoming'
    and (now() at time zone 'America/New_York')::date = t.play_date
    and not exists (select 1 from public.notifications n where n.user_id = r.user_id and n.type = 'tee_reminder'
                      and n.link = '/?tt=' || t.id::text || '&r=day');
end $$;

-- ── Course data changed at the source ────────────────────────────────────────────────────────────
-- "Pinch Brook: GolfCourseAPI now lists different data — Blue rating 64.2→63.6, slope 115→112;
--  18 yardage changes across 6 tees. Review in Courses."
create or replace function public.record_course_freshness(
  p_course_id uuid, p_api_data jsonb, p_diff jsonb, p_has_changes boolean
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_group uuid;
  v_name text;
  was_changed boolean;
  v_tees integer;
  v_yards integer;
  v_first text;
  v_detail text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select group_id, name into v_group, v_name
  from favorite_courses
  where id = p_course_id and coalesce(deleted, false) = false;
  if v_group is null then
    raise exception 'course not found' using errcode = 'P0002';
  end if;
  if not public.is_group_member(v_group, auth.uid()) then
    raise exception 'not an active member of this course''s group' using errcode = '42501';
  end if;

  select has_changes into was_changed from course_freshness where course_id = p_course_id;

  insert into course_freshness (course_id, group_id, checked_at, api_data, diff, has_changes, status, updated_at)
    values (p_course_id, v_group, now(), p_api_data, p_diff, p_has_changes,
            case when p_has_changes then 'pending' else 'none' end, now())
  on conflict (course_id) do update set
    checked_at  = now(),
    group_id    = v_group,
    api_data    = excluded.api_data,
    diff        = excluded.diff,
    has_changes = excluded.has_changes,
    status      = case when excluded.has_changes
                       then (case when course_freshness.status in ('dismissed', 'applied')
                                  then course_freshness.status else 'pending' end)
                       else 'none' end,
    updated_at  = now();

  if p_has_changes and coalesce(was_changed, false) = false then
    -- Summarise the diff the client computed (lib/course-diff.ts shape: {tees:[{name, ratingFrom,
    -- ratingTo, slopeFrom, slopeTo, ratingChanged, slopeChanged, yardageChanges:[{hole,from,to}]}]}).
    select count(*),
           coalesce(sum(jsonb_array_length(coalesce(t->'yardageChanges', '[]'::jsonb))), 0)
      into v_tees, v_yards
      from jsonb_array_elements(coalesce(p_diff->'tees', '[]'::jsonb)) t;
    select string_agg(x, ', ') into v_first from (
      select (t->>'name') ||
             case when (t->>'ratingChanged')::boolean then ' rating ' || (t->>'ratingFrom') || '→' || (t->>'ratingTo') else '' end ||
             case when (t->>'slopeChanged')::boolean then
                  case when (t->>'ratingChanged')::boolean then ',' else '' end || ' slope ' || (t->>'slopeFrom') || '→' || (t->>'slopeTo') else '' end as x
        from jsonb_array_elements(coalesce(p_diff->'tees', '[]'::jsonb)) t
       where (t->>'ratingChanged')::boolean or (t->>'slopeChanged')::boolean
       limit 2) s;
    select string_agg(x, E'\n') into v_detail from (
      select (t->>'name') || ': ' || concat_ws('; ',
               case when (t->>'ratingChanged')::boolean then 'rating ' || (t->>'ratingFrom') || ' → ' || (t->>'ratingTo') end,
               case when (t->>'slopeChanged')::boolean then 'slope ' || (t->>'slopeFrom') || ' → ' || (t->>'slopeTo') end,
               nullif((select string_agg('hole ' || (y->>'hole') || ' ' || coalesce(y->>'from', '—') || '→' || coalesce(y->>'to', '—'), ', ' order by (y->>'hole')::int)
                         from jsonb_array_elements(coalesce(t->'yardageChanges', '[]'::jsonb)) y), '')) as x
        from jsonb_array_elements(coalesce(p_diff->'tees', '[]'::jsonb)) t) d;

    insert into notifications (user_id, message, group_id, type, link, detail)
    select gm.user_id,
           coalesce(v_name, 'A course') || ': GolfCourseAPI now lists different data' ||
           case when v_first is not null then ' — ' || v_first else '' end ||
           case when v_yards > 0 then '; ' || v_yards || ' yardage change' || case when v_yards = 1 then '' else 's' end ||
                                       ' across ' || v_tees || ' tee' || case when v_tees = 1 then '' else 's' end else '' end ||
           '. Review in Courses.',
           v_group, 'course_change', '/?tab=courses', left(v_detail, 2000)
    from group_members gm
    join profiles p on p.id = gm.user_id
    where gm.group_id = v_group and gm.role = 'admin' and gm.status = 'active'
      and gm.user_id is not null and not coalesce(p.banned, false);
  end if;
end $$;
revoke all on function public.record_course_freshness(uuid, jsonb, jsonb, boolean) from public;
revoke all on function public.record_course_freshness(uuid, jsonb, jsonb, boolean) from anon;
grant execute on function public.record_course_freshness(uuid, jsonb, jsonb, boolean) to authenticated;

-- ── Data-integrity flags (cron) ──────────────────────────────────────────────────────────────────
-- The 0092 sweep is unchanged and still inserts "N new data-integrity flags to review". Rather than
-- duplicate 100 lines of detection logic for one line of copy, a BEFORE INSERT trigger on
-- notifications rewrites that one message with the first two flags by name as it is written.
-- "3 new data-integrity flags: Bob Jones — two rounds on one day; Amit — duplicate game round and 1 more"
create or replace function public.enrich_friction_notification() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare v_n integer; v_names text;
begin
  if new.type is distinct from 'friction' or new.detail is not null
     or new.message !~ '^[0-9]+ new data-integrity flag' then
    return new;
  end if;
  v_n := (regexp_match(new.message, '^([0-9]+)'))[1]::integer;
  select string_agg(x, '; ') into v_names from (
    select coalesce(public.person_label(f.subject_user), 'unknown') || ' — ' ||
           case f.kind when 'dup_day' then 'two rounds on one day'
                       when 'dup_game' then 'duplicate game round'
                       when 'multi_draft' then 'several open drafts'
                       else coalesce(nullif(f.detail, ''), f.kind) end as x
      from friction_items f where f.status = 'open'
     order by f.first_seen desc limit 2) s;
  if v_names is not null then
    new.message := v_n || ' new data-integrity flag' || case when v_n = 1 then '' else 's' end || ': ' || v_names ||
                   case when v_n > 2 then ' and ' || (v_n - 2) || ' more' else '' end;
    new.detail := 'Open Admin → Data integrity to review.';
  end if;
  return new;
end $fn$;
revoke all on function public.enrich_friction_notification() from public, anon, authenticated;
drop trigger if exists trg_enrich_friction_notification on public.notifications;
create trigger trg_enrich_friction_notification before insert on public.notifications
  for each row execute function public.enrich_friction_notification();

-- ── Admin: when did each member sign up ──────────────────────────────────────────────────────────
create or replace function public.admin_member_signups()
returns table (
  user_id        uuid,
  display_name   text,
  email          text,
  signed_up_at   timestamptz,
  last_sign_in   timestamptz,
  clubs          text,
  first_club_at  timestamptz
)
language sql stable security definer set search_path = public as $$
  select u.id,
         nullif(trim(p.display_name), ''),
         coalesce(p.email, u.email::text),
         u.created_at,
         u.last_sign_in_at,
         (select string_agg(g.name || ' (' || to_char(gm.created_at at time zone 'America/New_York', 'Mon FMDD, YYYY') || ')', ', ' order by gm.created_at)
            from group_members gm join groups g on g.id = gm.group_id
           where gm.user_id = u.id and gm.status = 'active'),
         (select min(gm.created_at) from group_members gm where gm.user_id = u.id and gm.status = 'active')
    from auth.users u
    left join profiles p on p.id = u.id
   where public.is_admin()
   order by u.created_at desc;
$$;
revoke all on function public.admin_member_signups() from public;
revoke all on function public.admin_member_signups() from anon;
grant execute on function public.admin_member_signups() to authenticated;

select public.record_migration('0165_notification_detail');

commit;
