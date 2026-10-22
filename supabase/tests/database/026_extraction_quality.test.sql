-- M4 step 8: public.extraction_quality (plan §3.2). Covers AT5 (DB): 10 original lines with 1
-- corrected is a 10 % correction rate. SECURITY INVOKER, so RLS limits it to owner/admin of the
-- caller's tenant; the extraction date is taken in the tenant's time zone.
begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Cuoco A'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere A');
insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo', 'kg'),
  ('1e000000-0000-4000-8000-00000000001e', '22222222-2222-4222-8222-222222222222', 'Manzo B', 'kg');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo Srl', 'IT12345678903'),
  ('5b000000-0000-4000-8000-00000000005b', '11111111-1111-4111-8111-111111111111',
   'Altro Fornitore', 'IT00000000018'),
  ('5c000000-0000-4000-8000-00000000005c', '22222222-2222-4222-8222-222222222222',
   'Fornitore Demo Srl', 'IT12345678903');

create function pg_temp.iid(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.lid(n int) returns uuid language sql immutable as $$
  select ('a2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.mk_invoice(n int, p_status public.invoice_status, p_extracted timestamptz,
    p_supplier uuid default null, p_tenant uuid default '11111111-1111-4111-8111-111111111111')
  returns void language sql as $$
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id,
      extracted_at, duplicate_of)
  values (pg_temp.iid(n), p_tenant, p_tenant || '/2026/' || pg_temp.iid(n) || '.pdf',
      'application/pdf', 100, p_status, p_supplier, p_extracted,
      case when p_status = 'duplicate' then pg_temp.iid(1) end)
$$;
create function pg_temp.mk_line(n int, inv int, pos int, p_extra text default '', p_vals text default '',
    p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns void language plpgsql as $$
begin
  execute format($q$
    insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty,
        line_amount, field_confidence, extracted %s)
    values (%L, %L, %L, %s, 'Prodotto', 1, 1, '{}', '{}' %s)$q$,
    case when p_extra = '' then '' else ', ' || p_extra end, pg_temp.lid(n), p_tenant, pg_temp.iid(inv),
    pos, case when p_vals = '' then '' else ', ' || p_vals end);
end
$$;
-- An auto-mapped line (suggestion stored), optionally corrected.
create function pg_temp.auto_line(n int, inv int, pos int, p_fields text default '{}') returns void
  language sql as $$
  select pg_temp.mk_line(n, inv, pos,
    'ingredient_id, suggested_ingredient_id, mapping_source, corrected_fields',
    format($v$'1a000000-0000-4000-8000-00000000001a', '1a000000-0000-4000-8000-00000000001a', 'auto', %L$v$,
      p_fields)) $$;

-- Invoice 1 (review, SA, Oct 15): 10 original lines.
--   1-4 auto-mapped, line 1 corrected (qty); 5-6 mapped by hand; 7 split in two (children 71, 72);
--   8-10 unmapped.
select pg_temp.mk_invoice(1, 'review', '2026-10-15 10:00+00', '5a000000-0000-4000-8000-00000000005a');
select pg_temp.auto_line(1, 1, 1, '{qty}');
select pg_temp.auto_line(2, 1, 2);
select pg_temp.auto_line(3, 1, 3);
select pg_temp.auto_line(4, 1, 4);
select pg_temp.mk_line(5, 1, 5, 'ingredient_id, mapping_source', $$'1a000000-0000-4000-8000-00000000001a', 'manual'$$);
select pg_temp.mk_line(6, 1, 6, 'ingredient_id, mapping_source', $$'1a000000-0000-4000-8000-00000000001a', 'manual'$$);
select pg_temp.mk_line(7, 1, 7, 'split_at', 'now()');
select pg_temp.mk_line(71, 1, 7, 'sub_position, parent_line_id', format('1, %L', pg_temp.lid(7)));
select pg_temp.mk_line(72, 1, 7, 'sub_position, parent_line_id', format('2, %L', pg_temp.lid(7)));
select pg_temp.mk_line(8, 1, 8);
select pg_temp.mk_line(9, 1, 9);
select pg_temp.mk_line(10, 1, 10);
-- Invoice 2 (duplicate) and 3 (rejected): corrected lines that must not count.
select pg_temp.mk_invoice(2, 'duplicate', '2026-10-15 10:00+00', '5a000000-0000-4000-8000-00000000005a');
select pg_temp.auto_line(21, 2, 1, '{qty,unit_price}');
select pg_temp.auto_line(22, 2, 2, '{qty}');
select pg_temp.mk_invoice(3, 'rejected', '2026-10-15 10:00+00', '5a000000-0000-4000-8000-00000000005a');
select pg_temp.auto_line(31, 3, 1, '{ingredient}');
-- Invoice 4 (approved, SA, Sep 10): two lines, one corrected (pack).
select pg_temp.mk_invoice(4, 'approved', '2026-09-10 10:00+00', '5a000000-0000-4000-8000-00000000005a');
select pg_temp.auto_line(41, 4, 1, '{pack}');
select pg_temp.auto_line(42, 4, 2);
-- Invoice 5 (review, SB2, Oct 16): two lines, one corrected (qty and lot_code).
select pg_temp.mk_invoice(5, 'review', '2026-10-16 10:00+00', '5b000000-0000-4000-8000-00000000005b');
select pg_temp.mk_line(51, 5, 1, 'corrected_fields', $$'{qty,lot_code}'$$);
select pg_temp.mk_line(52, 5, 2);
-- Invoice 6 (review, no supplier, never extracted): never counts.
select pg_temp.mk_invoice(6, 'review', null);
select pg_temp.mk_line(61, 6, 1, 'corrected_fields', $$'{qty}'$$);
-- Time zone: Europe/Rome leaves summer time on 2026-10-25 at 03:00 local (01:00 UTC).
select pg_temp.mk_invoice(11, 'review', '2026-10-24 21:30+00');   -- 23:30 local on the 24th: out
select pg_temp.mk_invoice(12, 'review', '2026-10-24 22:30+00');   -- 00:30 local on the 25th: in
select pg_temp.mk_invoice(13, 'review', '2026-10-24 23:30+00');   -- 01:30 local on the 25th: in
select pg_temp.mk_invoice(14, 'review', '2026-10-25 22:30+00');   -- 23:30 local on the 25th (winter time): in
select pg_temp.mk_invoice(15, 'review', '2026-10-25 23:30+00');   -- 00:30 local on the 26th: out
select pg_temp.mk_line(111, 11, 1); select pg_temp.mk_line(121, 12, 1); select pg_temp.mk_line(131, 13, 1);
select pg_temp.mk_line(141, 14, 1); select pg_temp.mk_line(151, 15, 1);
-- Tenant B.
select pg_temp.mk_invoice(40, 'review', '2026-10-15 10:00+00', '5c000000-0000-4000-8000-00000000005c',
  '22222222-2222-4222-8222-222222222222');
select pg_temp.mk_line(401, 40, 1, 'corrected_fields', $$'{qty}'$$, '22222222-2222-4222-8222-222222222222');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
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
create function pg_temp.q(p_from date, p_to date, p_supplier uuid default null, p_status text default 'all')
  returns jsonb language sql as $$
  select public.extraction_quality(p_from, p_to, p_supplier, p_status) $$;
create function pg_temp.n(p_report jsonb, p_key text) returns numeric language sql as $$
  select (p_report ->> p_key)::numeric $$;
grant execute on function pg_temp.act_as(uuid, uuid, text), pg_temp.err(text),
  pg_temp.q(date, date, uuid, text), pg_temp.n(jsonb, text) to authenticated;

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');

select ok(has_function_privilege('authenticated', 'public.extraction_quality(date, date, uuid, text)', 'execute')
      and not has_function_privilege('anon', 'public.extraction_quality(date, date, uuid, text)', 'execute')
      and not has_function_privilege('service_role', 'public.extraction_quality(date, date, uuid, text)', 'execute'),
  'only authenticated can call the report');

-- AT5 (DB): 10 original lines, 1 corrected -> 10 %. Invoice 1 only (Oct 1-15).
create temporary table r1 as select pg_temp.q('2026-10-01', '2026-10-15') as r;
grant select on r1 to authenticated;
select is(pg_temp.n((select r from r1), 'invoices'), 1::numeric, 'one invoice in scope');
select is(pg_temp.n((select r from r1), 'lines'), 10::numeric,
  'ten original lines: a split parent counts once, its children not at all');
select is(pg_temp.n((select r from r1), 'correctedLines'), 1::numeric, 'one corrected line');
select is(pg_temp.n((select r from r1), 'correctionRate'), 0.1, 'a correction rate of 0.1 (AT5)');
select is(pg_temp.n((select r from r1), 'autoMappedLines'), 4::numeric, 'four lines were auto-mapped');
select is(pg_temp.n((select r from r1), 'autoMappedCorrected'), 1::numeric, 'one of them was corrected');
select is(pg_temp.n((select r from r1), 'autoMappedCorrectionRate'), 0.25, 'a mapped-supplier rate of 0.25 (AT5)');
select is(pg_temp.n((select r from r1), 'manualMappedLines'), 2::numeric, 'two lines were mapped by hand');
select is(pg_temp.n((select r from r1), 'splitLines'), 1::numeric, 'one line is split');
select is(pg_temp.n((select r from r1) -> 'byField', 'qty'), 1::numeric, 'byField counts the corrected quantity');
select is(pg_temp.n((select r from r1) -> 'byField', 'ingredient'), 0::numeric, 'and zero for fields nobody corrected');
select is((select array_agg(k order by k) from jsonb_object_keys((select r from r1) -> 'byField') k),
  array['expiry', 'ingredient', 'line_amount', 'lot_code', 'pack', 'qty', 'supplier_code', 'unit',
        'unit_price', 'vat_rate'], 'byField always has the ten fields');
select is(jsonb_array_length((select r from r1) -> 'bySupplier'), 1, 'one supplier');
select is((select r from r1) -> 'bySupplier' -> 0 ->> 'name', 'Fornitore Demo Srl', 'named');
select is((select r from r1) -> 'bySupplier' -> 0 ->> 'supplierId', '5a000000-0000-4000-8000-00000000005a',
  'with its id');
select is(pg_temp.n((select r from r1) -> 'bySupplier' -> 0, 'correctionRate'), 0.1, 'and its own rate');

-- Excluded statuses: invoice 2 (duplicate) and 3 (rejected) are in the same period but not counted.
-- Both periods: the approved invoice of September joins in 'all'.
create temporary table r2 as select pg_temp.q('2026-09-01', '2026-10-20') as r;
grant select on r2 to authenticated;
select is(pg_temp.n((select r from r2), 'invoices'), 3::numeric, 'review and approved invoices count');
select is(pg_temp.n((select r from r2), 'lines'), 14::numeric, 'duplicate, rejected and never-extracted lines do not');
select is(pg_temp.n((select r from r2), 'correctedLines'), 3::numeric, 'corrected lines: 1 + 1 (pack) + 1 (qty, lot)');
select is(pg_temp.n((select r from r2) -> 'byField', 'lot_code'), 1::numeric, 'byField counts a line''s every corrected field');
select is(pg_temp.n((select r from r2) -> 'byField', 'pack'), 1::numeric, 'including pack');
select is(jsonb_array_length((select r from r2) -> 'bySupplier'), 2, 'two suppliers');
select is((select r from r2) -> 'bySupplier' -> 0 ->> 'name', 'Fornitore Demo Srl', 'ordered by number of lines');

-- The approved filter.
create temporary table r3 as select pg_temp.q('2026-09-01', '2026-10-20', null, 'approved') as r;
grant select on r3 to authenticated;
select is(pg_temp.n((select r from r3), 'lines'), 2::numeric, 'status approved: only the approved invoice''s lines');
select is(pg_temp.n((select r from r3), 'correctionRate'), 0.5, 'with its rate');
select is(pg_temp.n((select r from r3), 'invoices'), 1::numeric, 'and one invoice');

-- The supplier filter.
create temporary table r4 as select pg_temp.q('2026-09-01', '2026-10-20', '5b000000-0000-4000-8000-00000000005b') as r;
grant select on r4 to authenticated;
select is(pg_temp.n((select r from r4), 'lines'), 2::numeric, 'a supplier filter keeps that supplier''s lines');
select is(pg_temp.n((select r from r4), 'correctedLines'), 1::numeric, 'and corrections');
select is(jsonb_array_length((select r from r4) -> 'bySupplier'), 1, 'and one supplier row');

-- Time zone: the extraction date is the day in Europe/Rome.
create temporary table r5 as select pg_temp.q('2026-10-25', '2026-10-25') as r;
grant select on r5 to authenticated;
select is(pg_temp.n((select r from r5), 'invoices'), 3::numeric,
  'on the DST-change day, 22:30Z and 23:30Z on the 24th and 22:30Z on the 25th all fall on the 25th');
select is(pg_temp.n((select r from r5), 'lines'), 3::numeric, 'with their lines');
create temporary table r6 as select pg_temp.q('2026-10-24', '2026-10-24') as r;
grant select on r6 to authenticated;
select is(pg_temp.n((select r from r6), 'invoices'), 1::numeric, '21:30Z on the 24th is 23:30 local, still the 24th');
create temporary table r7 as select pg_temp.q('2026-10-26', '2026-10-26') as r;
grant select on r7 to authenticated;
select is(pg_temp.n((select r from r7), 'invoices'), 1::numeric, '23:30Z on the 25th is the 26th');

-- No lines in the period: rates are null, not zero.
create temporary table r8 as select pg_temp.q('2026-01-01', '2026-01-31') as r;
grant select on r8 to authenticated;
select is(pg_temp.n((select r from r8), 'lines'), 0::numeric, 'no lines');
select is((select r from r8) -> 'correctionRate', 'null'::jsonb, 'the correction rate is null');
select is((select r from r8) -> 'autoMappedCorrectionRate', 'null'::jsonb, 'so is the mapped-supplier rate');
select is((select r from r8) -> 'bySupplier', '[]'::jsonb, 'and bySupplier is empty');

-- Range and argument checks.
select is(pg_temp.err($$ select pg_temp.q('2026-01-01', '2027-01-02') $$), 'P0001 range_too_long',
  'a 367-day range is refused');
select is(pg_temp.err($$ select pg_temp.q('2026-01-01', '2027-01-01') $$), 'ok', 'a 366-day range is fine');
select is(pg_temp.err($$ select pg_temp.q('2026-02-01', '2026-01-01') $$), 'P0001 invalid_request', 'from after to is refused');
select is(pg_temp.err($$ select pg_temp.q('2026-01-01', '2026-01-31', null, 'foo') $$), 'P0001 invalid_request',
  'an unknown status is refused');
select is(pg_temp.err($$ select pg_temp.q(null, '2026-01-31') $$), 'P0001 invalid_request', 'a missing bound is refused');

-- Roles and tenants.
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.n(pg_temp.q('2026-09-01', '2026-10-31'), 'lines'), 0::numeric, 'the chef sees no lines');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.n(pg_temp.q('2026-09-01', '2026-10-31'), 'lines'), 0::numeric, 'the waiter sees no lines');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.n(pg_temp.q('2026-09-01', '2026-10-31'), 'lines'), 1::numeric, 'owner B sees only B''s line');
select is(pg_temp.n(pg_temp.q('2026-09-01', '2026-10-31'), 'correctedLines'), 1::numeric, 'and B''s correction');
select is(jsonb_array_length(pg_temp.q('2026-09-01', '2026-10-31') -> 'bySupplier'), 1, 'and one supplier, B''s');
select is(pg_temp.n(pg_temp.q('2026-09-01', '2026-10-31', '5a000000-0000-4000-8000-00000000005a'), 'lines'), 0::numeric,
  'a supplier filter with A''s supplier finds nothing for B');

reset role;
select * from finish();
rollback;
