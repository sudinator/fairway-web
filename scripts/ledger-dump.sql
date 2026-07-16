-- Live ledger dump for the trace script. Set the group name on line 1. Returns one JSON cell — paste it
-- to Claude, who runs scripts/ledger-trace.ts on it. Read-only; safe to run anytime.
with g as (select id, name from groups where name ilike '%Livingston%' limit 1)
select json_build_object(
  'group',   (select row_to_json(g) from g),
  'members', (select coalesce(json_agg(json_build_object('id',p.id,'display_name',p.display_name)),'[]')
              from group_members gm join profiles p on p.id=gm.user_id, g
              where gm.group_id=g.id and gm.status='active'),
  'expenses',(select coalesce(json_agg(json_build_object('id',e.id,'event_id',e.event_id,'payer_user_id',e.payer_user_id,'amount_cents',e.amount_cents,'description',e.description,'created_at',e.created_at)),'[]')
              from expenses e, g where e.group_id=g.id),
  'shares',  (select coalesce(json_agg(json_build_object('expense_id',s.expense_id,'user_id',s.user_id,'guest_id',s.guest_id,'share_cents',s.share_cents)),'[]')
              from expense_shares s join expenses e on e.id=s.expense_id, g where e.group_id=g.id),
  'payers',  (select coalesce(json_agg(json_build_object('expense_id',pp.expense_id,'user_id',pp.user_id,'guest_id',pp.guest_id,'paid_cents',pp.paid_cents)),'[]')
              from expense_payers pp join expenses e on e.id=pp.expense_id, g where e.group_id=g.id),
  'settlements',(select coalesce(json_agg(json_build_object('id',st.id,'group_id',st.group_id,'from_user_id',st.from_user_id,'to_user_id',st.to_user_id,'amount_cents',st.amount_cents,'event_id',st.event_id,'status',st.status)),'[]')
              from settlements st, g where st.group_id=g.id),
  'allocations',(select coalesce(json_agg(json_build_object('settlement_id',a.settlement_id,'expense_id',a.expense_id,'amount_cents',a.amount_cents)),'[]')
              from settlement_allocations a, g where a.group_id=g.id),
  'events',  (select coalesce(json_agg(json_build_object('id',ev.id,'group_id',ev.group_id,'name',ev.name,'event_date',ev.event_date,'event_type',ev.event_type,'status',ev.status,'created_at',ev.created_at,'source_game_id',ev.source_game_id)),'[]')
              from group_events ev, g where ev.group_id=g.id),
  'guests',  (select coalesce(json_agg(json_build_object('id',gu.id,'sponsor_user_id',gu.sponsor_user_id)),'[]')
              from group_guests gu, g where gu.group_id=g.id)
) as ledger;
