-- M21 step 1 (docs/plans/2026-10-30-m21-bill-close.md §3.2, §5; ADR-023): the closing columns of table_session, missing_receipt, the receipt
-- and payment code lists, the replaced table_session_guard, and public.day_close (append-only, RLS owner/admin, no write grant). Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(60);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo');
-- Six tables of tenant A (one open session each, except 6 which only holds closed ones) and one of tenant B.
insert into public.dining_table (id, tenant_id, name, position, created_by, updated_by)
  select ('13000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111', 'Tavolo ' || n || ' (demo)', n,
         'a1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-00000000000a' from generate_series(1, 6) n;
insert into public.table_session (id, tenant_id, dining_table_id, table_name, covers, opened_by, business_date, created_by, updated_by)
  select ('14000000-0000-4000-8000-00000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111',
         ('13000000-0000-4000-8000-00000000000' || n)::uuid, 'Tavolo ' || n || ' (demo)', 2,
         'd1000000-0000-4000-8000-00000000000d', '2026-11-04', 'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d'
    from generate_series(1, 5) n;

create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end
$$;
-- A closed session of table 6 with the given extra columns, as SQL text.
create function pg_temp.ins_closed(p_cols text, p_vals text) returns text language sql as $$
  select format($f$ insert into public.table_session (tenant_id, dining_table_id, table_name, covers, opened_by, business_date, closed_at, closed_by,
                                                      created_by, updated_by %s)
                    values ('11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000006', 'Tavolo 6 (demo)', 2,
                            'd1000000-0000-4000-8000-00000000000d', '2026-11-04', now(), 'd1000000-0000-4000-8000-00000000000d',
                            'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d' %s) $f$, p_cols, p_vals)
$$;

-- Code lists -----------------------------------------------------------------------------------------------------------------------
select is(app.receipt_types(), array['scontrino', 'fattura'], 'receipt_types() is scontrino, fattura');
select is(app.payment_type_codes(), array['cash', 'card', 'other'], 'payment_type_codes() is cash, card, other (Q126)');
select is((select array_agg(provolatile::text order by proname::text collate "C") from pg_proc
            where pronamespace = 'app'::regnamespace and proname in ('receipt_types', 'payment_type_codes')), array['i', 'i'], 'both lists are immutable');
select is((select bool_or(has_function_privilege(r, f, 'execute')) from unnest(array['anon', 'authenticated', 'service_role']) r,
            unnest(array['app.receipt_types()', 'app.payment_type_codes()']) f), false, 'no API role can execute the code lists');

-- Columns --------------------------------------------------------------------------------------------------------------------------
select is((select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by column_name collate "C") from information_schema.columns
            where table_schema = 'public' and table_name = 'table_session'
              and column_name in ('closed_business_date', 'receipt_type', 'receipt_number', 'payment_type', 'total', 'missing_receipt')),
          'closed_business_date:date:YES,missing_receipt:boolean:YES,payment_type:text:YES,receipt_number:text:YES,receipt_type:text:YES,total:numeric:YES',
          'the six new columns exist, all nullable');
select is((select numeric_precision::text || ',' || numeric_scale::text from information_schema.columns
            where table_schema = 'public' and table_name = 'table_session' and column_name = 'total'), '12,2', 'total is numeric(12,2)');

-- Guard ----------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.err($$update public.table_session set closed_at = now(), closed_by = 'd1000000-0000-4000-8000-00000000000d' where id = '14000000-0000-4000-8000-000000000001'$$),
  'P0001 table_session_close_incomplete', 'closing with no details is refused');
select is(pg_temp.err($$update public.table_session set closed_at = now(), closed_by = 'd1000000-0000-4000-8000-00000000000d',
    closed_business_date = '2026-11-04', receipt_type = 'scontrino', total = 100 where id = '14000000-0000-4000-8000-000000000001'$$),
  'P0001 table_session_close_incomplete', 'closing without payment_type is refused');
select is(pg_temp.err($$update public.table_session set closed_at = now(), closed_by = 'd1000000-0000-4000-8000-00000000000d',
    closed_business_date = '2026-11-04', payment_type = 'card', total = 100 where id = '14000000-0000-4000-8000-000000000001'$$),
  'P0001 table_session_close_incomplete', 'closing without receipt_type is refused');
select is(pg_temp.err($$update public.table_session set closed_at = now(), closed_by = 'd1000000-0000-4000-8000-00000000000d',
    receipt_type = 'scontrino', payment_type = 'card', total = 100 where id = '14000000-0000-4000-8000-000000000001'$$),
  'P0001 table_session_close_incomplete', 'closing without closed_business_date is refused');
select is(pg_temp.err($$update public.table_session set closed_at = now(), closed_by = 'd1000000-0000-4000-8000-00000000000d',
    closed_business_date = '2026-11-04', receipt_type = 'scontrino', payment_type = 'card' where id = '14000000-0000-4000-8000-000000000001'$$),
  'P0001 table_session_close_incomplete', 'closing without total is refused');
select is((select closed_at is null from public.table_session where id = '14000000-0000-4000-8000-000000000001'), true, 'and the session is still open');
select is(pg_temp.err($$update public.table_session set closed_at = now(), closed_by = 'd1000000-0000-4000-8000-00000000000d',
    closed_business_date = '2026-11-04', receipt_type = 'scontrino', receipt_number = '0012-0034', payment_type = 'card', total = 100
    where id = '14000000-0000-4000-8000-000000000002'$$), 'ok', 'closing with all details is accepted');
select is(pg_temp.err($$update public.table_session set receipt_number = '1' where id = '14000000-0000-4000-8000-000000000003'$$),
  'P0001 table_session_immutable', 'a receipt number on an open session is refused');
select is(pg_temp.err($$update public.table_session set total = 5 where id = '14000000-0000-4000-8000-000000000003'$$),
  'P0001 table_session_immutable', 'a total on an open session is refused');
select is(pg_temp.err($$update public.table_session set closed_business_date = '2026-11-04' where id = '14000000-0000-4000-8000-000000000003'$$),
  'P0001 table_session_immutable', 'a closed business date on an open session is refused');
select is(pg_temp.err($$update public.table_session set covers = 3 where id = '14000000-0000-4000-8000-000000000002'$$),
  'P0001 table_session_closed', 'any update of a closed session is refused');
select is(pg_temp.err($$update public.table_session set receipt_number = '9' where id = '14000000-0000-4000-8000-000000000002'$$),
  'P0001 table_session_closed', 'the receipt number of a closed session cannot change (V4 would replace the guard)');
select is(pg_temp.err($$update public.table_session set closed_at = now(), closed_by = 'd1000000-0000-4000-8000-00000000000d',
    closed_business_date = '2026-11-04', receipt_type = 'fattura', payment_type = 'cash', total = 54 where id = '14000000-0000-4000-8000-000000000004'$$),
  'ok', 'closing without a receipt number is accepted (flagged, not refused)');
-- M17 rules still hold (the full set is re-run by 150).
select is(pg_temp.err($$update public.table_session set business_date = '2026-10-25' where id = '14000000-0000-4000-8000-000000000005'$$),
  'P0001 table_session_immutable', 'business_date (the opening date) still never changes');
select is(pg_temp.err($$update public.table_session set covers = 4 where id = '14000000-0000-4000-8000-000000000005'$$), 'ok', 'covers of an open session still change');

-- Checks ---------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.err(pg_temp.ins_closed(', closed_business_date, receipt_type, receipt_number, payment_type, total',
  $$, '2026-11-04', 'scontrino', '0012-0034', 'card', 10$$)), 'ok', 'receipt number 0012-0034 is accepted');
select is((select count(*)::int from (values (' ''12 34'' '), (' '''' '), (' ''-1'' '), (format(' %L ', repeat('1', 21)))) v(n)
            where left(pg_temp.err(pg_temp.ins_closed(', closed_business_date, receipt_type, receipt_number, payment_type, total',
              ', ''2026-11-04'', ''scontrino'', ' || v.n || ', ''card'', 10')), 5) = '23514'), 4,
  'receipt numbers "12 34", "", "-1" and 21 characters are refused (23514)');
select is(pg_temp.err(pg_temp.ins_closed(', closed_business_date, receipt_type, receipt_number, payment_type, total',
  $$, '2026-11-04', 'scontrino', repeat('1', 20), 'card', 10$$)), 'ok', 'a 20 character receipt number is accepted (boundary)');
select is(left(pg_temp.err(pg_temp.ins_closed(', closed_business_date, receipt_type, payment_type, total', $$, '2026-11-04', 'pos', 'card', 10$$)), 5),
  '23514', 'receipt type "pos" is refused');
select is(left(pg_temp.err(pg_temp.ins_closed(', closed_business_date, receipt_type, payment_type, total', $$, '2026-11-04', 'scontrino', 'cheque', 10$$)), 5),
  '23514', 'payment type "cheque" is refused');
select is(left(pg_temp.err(pg_temp.ins_closed(', closed_business_date, receipt_type, payment_type, total', $$, '2026-11-04', 'scontrino', 'card', -0.01$$)), 5),
  '23514', 'a negative total is refused');
select is(pg_temp.err(pg_temp.ins_closed(', closed_business_date, receipt_type, payment_type, total', $$, '2026-11-04', 'scontrino', 'card', 0$$)), 'ok',
  'a total of 0 is accepted (boundary)');
select is(left(pg_temp.err(pg_temp.ins_closed(', receipt_type, payment_type, total', $$, 'scontrino', 'card', 10$$)), 5), '23514',
  'three of the four details (no closed_business_date) are refused');
select is(left(pg_temp.err(pg_temp.ins_closed(', closed_business_date, receipt_type', $$, '2026-11-04', 'scontrino'$$)), 5), '23514',
  'two of the four details are refused');
select is(left(pg_temp.err($$ insert into public.table_session (tenant_id, dining_table_id, table_name, covers, opened_by, business_date, receipt_type,
                                  created_by, updated_by)
                              values ('11111111-1111-4111-8111-111111111111', '13000000-0000-4000-8000-000000000006', 'Tavolo 6 (demo)', 2,
                                      'd1000000-0000-4000-8000-00000000000d', '2026-11-04', 'scontrino',
                                      'd1000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-00000000000d') $$), 5), '23514',
  'a receipt type on an open session is refused');
select is(pg_temp.err(pg_temp.ins_closed('', '')), 'ok', 'a legacy closed session without details still inserts (one-directional check)');

-- missing_receipt (T1) -------------------------------------------------------------------------------------------------------------
select is((select missing_receipt from public.table_session where id = '14000000-0000-4000-8000-000000000002'), false, 'closed with a number: not missing');
select is((select missing_receipt from public.table_session where id = '14000000-0000-4000-8000-000000000004'), true,
  'closed with a type and no number: missing, recomputed by the closing UPDATE (T1)');
select is((select missing_receipt from public.table_session where id = '14000000-0000-4000-8000-000000000005'), false, 'open: not missing');
select is((select missing_receipt from public.table_session where tenant_id = '11111111-1111-4111-8111-111111111111' and receipt_type is null and closed_at is not null limit 1),
  false, 'legacy closed without details: not missing');

-- Indexes --------------------------------------------------------------------------------------------------------------------------
select is((select pg_get_indexdef(indexrelid) from pg_index where indexrelid = 'public.table_session_closed_day_idx'::regclass),
  'CREATE INDEX table_session_closed_day_idx ON public.table_session USING btree (tenant_id, closed_business_date) WHERE (closed_at IS NOT NULL)',
  'table_session_closed_day_idx is partial on closed sessions');
select is((select pg_get_indexdef(indexrelid) from pg_index where indexrelid = 'public.day_close_day_idx'::regclass),
  'CREATE INDEX day_close_day_idx ON public.day_close USING btree (tenant_id, business_date, created_at DESC, id DESC)', 'day_close_day_idx columns');
select is(count(*)::int, 1, 'the guard trigger keeps its name (157 disables it by name)')
  from pg_trigger where tgrelid = 'public.table_session'::regclass and tgname = 'table_session_guard' and not tgisinternal;

-- day_close ------------------------------------------------------------------------------------------------------------------------
select is((select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position) from information_schema.columns
            where table_schema = 'public' and table_name = 'day_close'),
  'id:uuid:NO,tenant_id:uuid:NO,business_date:date:NO,register_total:numeric:NO,created_at:timestamp with time zone:NO,created_by:uuid:NO',
  'day_close columns, all not null');
select is(pg_temp.err($$insert into public.day_close (tenant_id, business_date, register_total, created_by)
  values ('11111111-1111-4111-8111-111111111111', '2026-11-04', 1222.00, 'a1000000-0000-4000-8000-00000000000a')$$), 'ok', 'a register entry inserts');
select is(pg_temp.err($$insert into public.day_close (tenant_id, business_date, register_total, created_by)
  values ('11111111-1111-4111-8111-111111111111', '2026-11-04', 1240.00, 'f1000000-0000-4000-8000-00000000000f')$$), 'ok', 'a second entry for the same date inserts (append-only)');
select is(pg_temp.err($$insert into public.day_close (tenant_id, business_date, register_total, created_by)
  values ('22222222-2222-4222-8222-222222222222', '2026-11-04', 9.00, 'b1000000-0000-4000-8000-00000000000b')$$), 'ok', 'tenant B has its own entry');
select is(left(pg_temp.err($$insert into public.day_close (tenant_id, business_date, register_total, created_by)
  values ('11111111-1111-4111-8111-111111111111', '2026-11-04', -1, 'a1000000-0000-4000-8000-00000000000a')$$), 5), '23514', 'register total -1 is refused');
select is(left(pg_temp.err($$insert into public.day_close (tenant_id, business_date, register_total, created_by)
  values ('11111111-1111-4111-8111-111111111111', '2026-11-04', 10000000, 'a1000000-0000-4000-8000-00000000000a')$$), 5), '23514', 'register total 10 000 000 is refused');
select is(pg_temp.err($$insert into public.day_close (tenant_id, business_date, register_total, created_by)
  values ('11111111-1111-4111-8111-111111111111', '2026-11-04', 9999999.99, 'a1000000-0000-4000-8000-00000000000a')$$), 'ok', '9 999 999,99 is accepted (boundary)');
select is(left(pg_temp.err($$insert into public.day_close (tenant_id, business_date, register_total, created_by)
  values ('11111111-1111-4111-8111-111111111111', '2026-11-04', 5, 'b1000000-0000-4000-8000-00000000000b')$$), 5), '23503', 'a tenant-B user on a tenant-A entry is a foreign key violation');
select is(pg_temp.err($$update public.day_close set register_total = 1 where tenant_id = '11111111-1111-4111-8111-111111111111'$$), 'P0001 append_only', 'UPDATE is refused');
select is(pg_temp.err($$delete from public.day_close$$), 'P0001 append_only', 'DELETE is refused');
select is(pg_temp.err($$truncate public.day_close$$), 'P0001 append_only', 'TRUNCATE is refused');

-- RLS and privileges ---------------------------------------------------------------------------------------------------------------
create function pg_temp.rows_as(p_who text, p_sub uuid, p_tenant uuid) returns text language plpgsql as $$
declare
  n int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated', 'tenant_id', p_tenant, 'app_role', p_who)::text, true);
  set local role authenticated;
  select count(*) into n from public.day_close;
  reset role;
  return n::text;
exception when others then
  reset role;
  return 'error';
end
$$;
select is(pg_temp.rows_as('owner', 'a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111'), '3', 'owner A reads A''s three entries');
select is(pg_temp.rows_as('admin', 'f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111'), '3', 'admin A reads them too');
select is(pg_temp.rows_as('chef', 'c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111'), '0', 'chef A reads none');
select is(pg_temp.rows_as('waiter', 'd0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111'), '0', 'waiter A reads none');
select is(pg_temp.rows_as('owner', 'b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222'), '1', 'owner B reads only B''s entry');
select is((select bool_or(has_table_privilege('authenticated', 'public.day_close', p)) from unnest(array['insert', 'update', 'delete', 'truncate']) p), false,
  'authenticated has no write privilege on day_close');
select is(has_table_privilege('service_role', 'public.day_close', 'select'), true, 'service_role may select day_close');
select is((select bool_or(has_table_privilege('service_role', 'public.day_close', p)) from unnest(array['insert', 'update', 'delete', 'truncate']) p), false,
  'but not write');
select is((select bool_or(has_table_privilege('anon', 'public.day_close', p)) from unnest(array['select', 'insert', 'update', 'delete', 'truncate']) p), false,
  'anon has nothing');
select is((select count(*)::int from pg_policy where polrelid = 'public.day_close'::regclass and polcmd <> 'r'), 0, 'no write policy on day_close');

select * from finish();
rollback;
