-- 0054_money_simplify.sql — group-wide toggle for the Money tab.
-- true (default) = fewest-payments netting; false = show debts "as entered" (who owes whom).
-- Idempotent.
alter table public.groups add column if not exists money_simplify boolean not null default true;
