-- Comanda per uscita, step 3 (docs/plans/2026-11-18-comanda-uscite.md section 3.15 "Must stay unchanged"): the functions this feature must never
-- re-create keep the definition they had on main before step 3 (md5 of pg_get_functiondef, computed in step 0). The cost engine, the
-- depletion helpers, the bill, the ledger checks, the replay dispatcher, the kitchen wrapper, the reports and the close stay byte-identical
-- (depletion at send, plan 3.2 A). tests/config/uscite-preserves.test.ts refuses their names in the migration text; this file proves the
-- database agrees. A later step that has to change one of them is a stop for the lead, not a re-pin.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

create temp table kept (sig text primary key, md5 text not null);
insert into kept values
  ('app.app_vs_register_json(uuid,date)', 'd11de099acd97026ff10322c635d1445'),
  ('app.batch_settle_state(uuid,uuid,text)', '98e8d22c0cae87d8c68053734eebec4c'),
  ('app.deplete_line_batches(uuid,uuid,uuid,uuid,numeric,timestamp with time zone,uuid[])', '0c07b8f712c23d6f7c8a742d33ac1807'),
  ('app.forecast_portion_lines(uuid,date[])', 'e3fe7129b872f2ee059e77b55a089914'),
  ('app.freeze_line_cost(uuid,uuid,uuid,uuid,uuid[],timestamp with time zone)', '7c1d6268f192404a639d7a7effc4c500'),
  ('app.kpi_sales_lines(uuid,date,date)', '062abe6d320266baa73fd790a495bb74'),
  ('app.ledger_checks_body(uuid,timestamp with time zone)', '44bec28a5f61b440cb3eabf0416fea39'),
  ('app.post_plate_raw_outflow(uuid,uuid,uuid,numeric,uuid,timestamp with time zone)', 'db726fcfc59579fa2f327a040601de5b'),
  ('app.post_stock_outflow(uuid,uuid,uuid,uuid,numeric,stock_movement_type,text,uuid,text,uuid,timestamp with time zone,timestamp with time zone,text)', '3b15bf31f358da78bbf78a692ce3a81d'),
  ('app.session_bill_json(uuid,uuid,jsonb)', '2818b61a789fcf36bd39e96172bd0b9f'),
  ('app.session_fired_lines(uuid,uuid[])', 'e7b24b2f6af476958641c076de2de9f5'),
  ('public.apply_op(jsonb)', 'ab16069b7caaebb82efcac073614dd4d'),
  ('public.close_table(uuid,jsonb)', 'f9161bb02afe6c8870ef1d89bbeda9d7'),
  ('public.kitchen_tickets()', 'f22a90848d14c4efcb7d9c40ddd2db9d'),
  ('public.remove_order_line(uuid,jsonb)', 'd6c44c8d39bb757783ee8d0fd6077a9f'),
  ('public.trace_order_line(uuid)', '1f7e6144abcb16afb2eb61f05f09aa18');

select is((select count(*)::int from kept), 16, 'the list holds the sixteen functions of plan 3.15 "must stay"');
select is((select count(*)::int from kept k join pg_proc p on p.oid = to_regprocedure(k.sig)), 16, 'each of them exists with that signature');
select is((select array_agg(k.sig order by k.sig) from kept k where md5(pg_get_functiondef(to_regprocedure(k.sig))) is distinct from k.md5), null,
  'every section 3.15 "must stay" function keeps the md5 computed in step 0');

select * from finish();
rollback;
