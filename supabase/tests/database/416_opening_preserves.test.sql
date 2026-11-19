-- Opening stock (docs/plans/2026-11-18-opening-stock.md §5 step 3, AT7): what the opening-stock migrations keep true. The md5 of pg_get_functiondef of the procedures the plan leaves
-- unchanged equals its value on main (acaa08c3, taken from a database built from main's migrations): a migration that re-creates one of them, even with the same text in a new
-- shape, fails here and must say why. Opening stock changes the cost fallback and the reconciliation by NEW definitions of other functions (app.ingredient_unit_costs, public.stock_reconciliation),
-- never by editing these. Fake data: none needed.
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

create temp table opening_unchanged (sig text primary key, md5 text not null);
insert into opening_unchanged values
  ('app.post_stock_outflow(uuid, uuid, uuid, uuid, numeric, stock_movement_type, text, uuid, text, uuid, timestamp with time zone, timestamp with time zone, text)', '3b15bf31f358da78bbf78a692ce3a81d'),
  ('public.reverse_movement(uuid)', '86315a44ad8596241d21beab13ec00ab'),
  ('public.approve_invoice(uuid, uuid)', '6b4682a200fa7d7ad6cf848f37556812'),
  ('app.kpi_purchases(uuid, date, date)', '98eb535a2f78272a08d17649f4a8ba48'),
  ('app.avt_rows(uuid, uuid, uuid)', '82c15b817a001a545c871ad05e4af5b0'),
  ('public.avt_report(uuid)', 'c6cc8ea3c18bf8dc2fd6d2f9465e7f5e'),
  ('public.count_close(uuid)', '40db6356fe6445849c0e64d3434d345d'),
  ('public.count_record_lines(uuid, jsonb)', '36b8b91084ec449491e8bad578dbb57b'),
  ('app.freeze_line_cost(uuid, uuid, uuid, uuid, uuid[], timestamp with time zone)', '7c1d6268f192404a639d7a7effc4c500'),
  ('public.stock_movements(uuid, timestamp with time zone, uuid, integer)', '8b03aa84c6ed6004264ae3740fc9926f');
select is((select count(*)::int from opening_unchanged u where to_regprocedure(u.sig) is not null), 10, 'all ten "unchanged on purpose" functions exist (the casts name the exact signatures)');
select is((select string_agg(u.sig, ', ' order by u.sig) from opening_unchanged u where md5(pg_get_functiondef(to_regprocedure(u.sig))) <> u.md5), null,
  'post_stock_outflow, reverse_movement, approve_invoice, kpi_purchases, avt_rows, avt_report, count_close, count_record_lines, freeze_line_cost and stock_movements each equal their value on main');

select * from finish();
rollback;
