-- 0117_settlement_dedup.sql
-- One confirmation per debt line — enforced in the DB so two parties (or a double-tap) confirming the
-- SAME outstanding line can NEVER both post, even under a simultaneous race. The client stamps a stable
-- dedup_key derived from the debt facts + how much of that pair's debt is already confirmed-settled; both
-- parties compute an identical key for the same line, and this unique index rejects the second write. A
-- genuinely new later debt for the same pair carries a different key (the confirmed-so-far total changed),
-- so legitimate repeat settlements still work. Idempotent. Run after 0116.

alter table public.settlements add column if not exists dedup_key text;

create unique index if not exists settlements_dedup_uq
  on public.settlements(group_id, dedup_key) where dedup_key is not null;

select record_migration('0117_settlement_dedup');
