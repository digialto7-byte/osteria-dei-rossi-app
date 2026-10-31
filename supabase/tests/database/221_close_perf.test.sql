-- M21 step 8 (docs/plans/2026-10-30-m21-bill-close.md §3.10, §5): a regression net, not a latency claim. Under a 5 s statement limit and a
-- venue-sized history (60 business days x 60 closed sessions x 8 lines, 30 open sessions, 2 000 applied_op rows) the report, a 40-line items
-- split and a close answer, and the closed-day read can use table_session_closed_day_idx. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo');
insert into public.menu_item (id, tenant_id, name, category, course_default, created_by, updated_by) values
  ('11000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Acqua (demo)', 'Bevande', 'bevande', 'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a');
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('13000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111', 'Tavolo ' || n || ' (demo)', n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 62) n;

create temporary table today as select app.business_date('11111111-1111-4111-8111-111111111111', now()) as t;
-- 60 business days (today and the 59 before) x 60 closed sessions, each with 8 lines of 3,00 (bill 24,00).
create temporary table closed_ids as
  select g as n, gen_random_uuid() as id, (select t from today) - ((g - 1) / 60) as bdate from generate_series(1, 3600) g;
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, closed_at, closed_by, closed_business_date,
                                  receipt_type, receipt_number, payment_type, total, created_by, updated_by)
  select c.id, '11111111-1111-4111-8111-111111111111', ('13000000-0000-4000-8000-0000000000' || lpad((1 + c.n % 60)::text, 2, '0'))::uuid, 'Tavolo ' || (1 + c.n % 60) || ' (demo)', 2,
         'd1000000-0000-4000-8000-00000000000d', c.bdate, ((c.bdate + time '21:00') at time zone 'Europe/Rome') + make_interval(mins => c.n % 60), 'd1000000-0000-4000-8000-00000000000d', c.bdate,
         case when c.n % 7 = 0 then 'fattura' else 'scontrino' end, case when c.n % 5 = 0 then null else 'N' || c.n end,
         (array['cash', 'card', 'other'])[1 + c.n % 3], 24.00, 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'
    from closed_ids c;
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by, fired_at, fired_by)
  select gen_random_uuid(), '11111111-1111-4111-8111-111111111111', c.id, '11000000-0000-4000-8000-000000000003', 'bevande', 1, 3.00, 10, 'menu', now() - interval '1 day',
         'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d', now() - interval '1 day', 'd1000000-0000-4000-8000-00000000000d'
    from closed_ids c, generate_series(1, 8) l;
-- 30 open sessions (tables 1..30) with 8 fired lines each, opened today; table 61 holds the 40-line session used for the split and the close.
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by)
  select ('14000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111', ('13000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
         'Tavolo ' || n || ' (demo)', 2, 'd1000000-0000-4000-8000-00000000000d', (select t from today), 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 30) n;
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by, fired_at, fired_by)
  select gen_random_uuid(), '11111111-1111-4111-8111-111111111111', ('14000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, '11000000-0000-4000-8000-000000000003', 'bevande', 1, 3.00, 10, 'menu',
         now() - interval '1 day', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d', now() - interval '1 day', 'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 30) n, generate_series(1, 8) l;
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by) values
  ('14000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000061', 'Tavolo 61 (demo)', 4,
   'd1000000-0000-4000-8000-00000000000d', (select t from today), 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d');
insert into public.order_line (id, tenant_id, table_session_id, menu_item_id, course, qty, unit_price, vat_rate, price_source, client_updated_at, created_by, updated_by, fired_at, fired_by)
  select ('15000000-0000-4000-8000-0000000000' || lpad(l::text, 2, '0'))::uuid, '11111111-1111-4111-8111-111111111111', '14000000-0000-4000-8000-0000000000f1', '11000000-0000-4000-8000-000000000003',
         'bevande', 1, 3.00, 10, 'menu', now() - interval '1 day', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d', now() - interval '1 day', 'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 40) l;
-- 2 000 applied_op rows over the same days: a third are session_closed conflicts.
insert into public.applied_op (tenant_id, op_id, user_id, kind, seq, client_ts, received_at, outcome, payload_hash, result, created_by)
  select '11111111-1111-4111-8111-111111111111', gen_random_uuid(), 'd1000000-0000-4000-8000-00000000000d', 'add_line', g, now(),
         ((select t from today) - (g % 60) + time '22:00') at time zone 'Europe/Rome', case when g % 3 = 0 then 'conflict' else 'applied' end, repeat('a', 64),
         case when g % 3 = 0 then '{"sqlstate": "P0001", "message": "session_closed", "detail": null}'::jsonb else '{}'::jsonb end, 'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 2000) g;
analyze public.table_session;
analyze public.order_line;
analyze public.applied_op;

select set_config('request.jwt.claims', json_build_object('sub', 'a0000000-0000-4000-8000-00000000000a', 'role', 'authenticated',
  'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', 'owner')::text, true);
set local statement_timeout = '5s';

select is((public.app_vs_register(null) -> 'app' ->> 'tables')::int, 60, 'app_vs_register answers under the limit: today has 60 closed tables');
select is((public.app_vs_register(null) -> 'openTables' ->> 'count')::int, 31, 'and counts the 31 open tables with their provisional bills');
select is((public.app_vs_register((select t from today) - 59) -> 'app' ->> 'tables')::int, 60, 'the oldest day of the history answers too');
select cmp_ok((public.app_vs_register(null) -> 'lateOps' ->> 'count')::int, '>', 0, 'late ops are counted from 2 000 rows');

create temporary table split40 as
  select public.session_bill('14000000-0000-4000-8000-0000000000f1', jsonb_build_object('mode', 'items', 'groups', jsonb_build_array(
    jsonb_build_object('covers', 2, 'lineIds', (select jsonb_agg(('15000000-0000-4000-8000-0000000000' || lpad(l::text, 2, '0'))) from generate_series(1, 20) l)),
    jsonb_build_object('covers', 2, 'lineIds', (select jsonb_agg(('15000000-0000-4000-8000-0000000000' || lpad(l::text, 2, '0'))) from generate_series(21, 40) l))),
    'sharedLineIds', '[]'::jsonb)) as j;
select is((select (j ->> 'total')::numeric from split40), 120.00, 'a 40-line items split answers under the limit (40 x 3,00)');
select is((select public.close_table('14000000-0000-4000-8000-0000000000f1',
            jsonb_build_object('receiptType', 'scontrino', 'receiptNumber', 'P1', 'paymentType', 'cash', 'billToken', (select j ->> 'billToken' from split40))) ->> 'changed')::boolean, true,
          'close_table answers under the limit');

-- The closed-day read (the report's) can use the partial index; seqscan is switched off so the plan shows the index is usable.
create function pg_temp.plan_of(q text) returns text language plpgsql as $$
declare
  r text;
begin
  execute 'explain (format json) ' || q into r;
  return r;
end
$$;
set local enable_seqscan = off;
select matches(pg_temp.plan_of(format($f$select count(*) from public.table_session where tenant_id = '11111111-1111-4111-8111-111111111111'
  and closed_business_date = %L and closed_at is not null$f$, (select t from today))), 'table_session_closed_day_idx', 'the closed-day read can use table_session_closed_day_idx');

select * from finish();
rollback;
