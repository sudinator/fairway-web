-- 0071_title_case_names.sql
-- One-time backfill: title-case existing profile names the same way the app now does
-- on save (lib/golf.ts titleCaseName). It uppercases the first letter of each word
-- (start of string, or after a space, apostrophe, or hyphen) ONLY when that letter is
-- lowercase. It deliberately does NOT lowercase anything, so intentional mid-word caps
-- (McDonald, DeVito) and ALL-CAPS names are left untouched — exactly matching the app.
-- Safe to re-run: rows already correct are skipped.
create or replace function public.bnn_title_case(s text) returns text
language plpgsql immutable as $fn$
declare result text := ''; i int; ch text; prev text := '';
begin
  if s is null then return null; end if;
  for i in 1..length(s) loop
    ch := substr(s, i, 1);
    if (i = 1 or prev ~ '[\s''\-]') and ch ~ '[a-z]' then
      result := result || upper(ch);
    else
      result := result || ch;
    end if;
    prev := ch;
  end loop;
  return result;
end $fn$;

update public.profiles
set display_name = public.bnn_title_case(display_name)
where display_name is not null
  and display_name <> public.bnn_title_case(display_name);

drop function public.bnn_title_case(text);
