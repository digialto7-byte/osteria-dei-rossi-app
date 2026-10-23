-- M5 step 6: public.invoice_approval_preview and public.approve_invoice (M5 plan §3.1, §3.3).
-- Acts as owner A unless stated. Covers acceptance tests AT1 (total mismatch), AT2 (duplicate),
-- AT3 (receipts, lots, prices, payable, audit), AT4 (a fault at the payable insert leaves nothing),
-- AT5 (second approval, non-stock line) and AT7 (roles) at database level.
-- Fixture 1 is the approvable invoice of 2026-09-29 from 034 without the unconvertible lines: supplier
-- A (terms 30 days), 7 lines, 6 of them received; invoices 30 and up are small ones, one case each.
begin;
create extension if not exists pgtap with schema extensions;
select plan(90);

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
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Cuoco A'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere A'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin DigiAlto');

insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo', 'kg'),
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Pollo', 'kg'),
  ('1c000000-0000-4000-8000-00000000001c', '11111111-1111-4111-8111-111111111111', 'Vitello', 'kg'),
  ('1d000000-0000-4000-8000-00000000001d', '11111111-1111-4111-8111-111111111111', 'Sedano', 'kg');
insert into public.supplier (id, tenant_id, name, vat_number, payment_terms_days) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo Srl', 'IT12345678903', 30);
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_count,
    pack_qty, pack_unit, invoice_unit) values
  ('51000000-0000-4000-8000-000000000051', '11111111-1111-4111-8111-111111111111',
   '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 'MAN-1', 1, 1, 'kg', 'kg'),
  ('52000000-0000-4000-8000-000000000052', '11111111-1111-4111-8111-111111111111',
   '5a000000-0000-4000-8000-00000000005a', '1b000000-0000-4000-8000-00000000001b', 'POL-1', 6, 1, 'kg', 'conf');
insert into public.cost_centre (id, tenant_id, name) values
  ('c5000000-0000-4000-8000-0000000000c5', '11111111-1111-4111-8111-111111111111', 'Pulizie');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella');

create function pg_temp.iid(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.lid(n int) returns uuid language sql immutable as $$
  select ('a2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.mk_inv(n int, p_status public.invoice_status default 'review',
    p_date date default '2026-09-29', p_due date default '2026-10-31') returns void language sql as $$
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status,
      supplier_vat, supplier_name, number_raw, invoice_date, due_date, net_total, vat_total,
      gross_total, supplier_id)
  values (pg_temp.iid(n), '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111/2026/' || pg_temp.iid(n) || '.pdf', 'application/pdf', 100,
      p_status, 'IT12345678903', 'Fornitore Demo Srl', 'FT ' || n, p_date, p_due, 0, 0, 0,
      '5a000000-0000-4000-8000-00000000005a')
$$;
create function pg_temp.mk_line(n int, inv int, pos int, p_qty numeric, p_unit text, p_amount numeric,
    p_ing uuid default null, p_item uuid default null, p_vat numeric default 10,
    p_credit numeric default 0, p_sub int default 0, p_parent int default null,
    p_stock boolean default true, p_split boolean default false, p_superseded boolean default false,
    p_lot text default null, p_expiry date default null) returns void language sql as $$
  insert into public.invoice_line (id, tenant_id, invoice_id, position, sub_position, parent_line_id,
      raw_description, qty, line_amount, vat_rate, unit, ingredient_id, supplier_item_id,
      mapping_source, is_stock, cost_centre_id, credit_qty, split_at, superseded_at, lot_code, expiry,
      field_confidence, extracted)
  values (pg_temp.lid(n), '11111111-1111-4111-8111-111111111111', pg_temp.iid(inv), pos, p_sub,
      case when p_parent is not null then pg_temp.lid(p_parent) end, 'Prodotto', p_qty, p_amount,
      p_vat, p_unit, p_ing, p_item, case when p_ing is not null then 'manual' end, p_stock,
      case when not p_stock then 'c5000000-0000-4000-8000-0000000000c5'::uuid end, p_credit,
      case when p_split then now() end, case when p_superseded then now() end, p_lot, p_expiry,
      '{}', '{}')
$$;
create function pg_temp.fix_totals(n int) returns void language sql as $$
  update public.invoice i
     set net_total = s.total, vat_total = round(s.total * 0.1, 2),
         gross_total = s.total + round(s.total * 0.1, 2)
    from (select coalesce(sum(line_amount), 0) as total from public.invoice_line
           where invoice_id = pg_temp.iid(n) and split_at is null and superseded_at is null) s
   where i.id = pg_temp.iid(n)
$$;
-- An approvable invoice: one 2 kg Manzo line (MAN-1) of p_amount (line n*10+1).
create function pg_temp.mk_clean(n int, p_status public.invoice_status default 'review',
    p_date date default '2026-09-29', p_amount numeric default 10) returns void language plpgsql as $$
begin
  perform pg_temp.mk_inv(n, p_status, p_date);
  perform pg_temp.mk_line(n * 10 + 1, n, 1, 2, 'kg', p_amount, '1a000000-0000-4000-8000-00000000001a',
    '51000000-0000-4000-8000-000000000051');
  perform pg_temp.fix_totals(n);
end
$$;
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
create function pg_temp.approve(n int, loc uuid default null) returns text language sql as $$
  select pg_temp.err(format('select public.approve_invoice(%L, %L)', pg_temp.iid(n), loc)) $$;
create function pg_temp.preview(n int, loc uuid default null) returns jsonb language sql as $$
  select public.invoice_approval_preview(pg_temp.iid(n), loc) $$;
create function pg_temp.preview_err(n int, loc uuid default null) returns text language sql as $$
  select pg_temp.err(format('select public.invoice_approval_preview(%L, %L)', pg_temp.iid(n), loc)) $$;
create function pg_temp.status(n int) returns text language sql as $$
  select status::text from public.invoice where id = pg_temp.iid(n) $$;
-- lots/movements/prices/payables/audit rows visible to the caller (owner A sees all of tenant A).
create function pg_temp.counts() returns text language sql as $$
  select (select count(*) from public.raw_lot) || '/' || (select count(*) from public.stock_movement)
      || '/' || (select count(*) from public.price_history) || '/' || (select count(*) from public.payable)
      || '/' || (select count(*) from public.audit_event) $$;
create function pg_temp.last_price(code text) returns numeric language sql as $$
  select last_price from public.supplier_item where supplier_code = code $$;
create temporary table approve_ret (j jsonb);
create temporary table xact_snapshot as
  select relname::text as relname, n_tup_ins + n_tup_upd + n_tup_del as writes
    from pg_stat_xact_user_tables where schemaname = 'public';
create function pg_temp.snapshot() returns void language sql as $$
  with gone as (delete from xact_snapshot)
  insert into xact_snapshot
    select relname::text, n_tup_ins + n_tup_upd + n_tup_del
      from pg_stat_xact_user_tables where schemaname = 'public' $$;
create function pg_temp.written_since_snapshot() returns text[] language sql as $$
  select coalesce(array_agg(t.relname::text order by t.relname), '{}')
    from pg_stat_xact_user_tables t
    left join xact_snapshot s on s.relname = t.relname::text
   where t.schemaname = 'public' and t.n_tup_ins + t.n_tup_upd + t.n_tup_del > coalesce(s.writes, 0) $$;
grant select, insert, delete on xact_snapshot, approve_ret to authenticated;
grant execute on function pg_temp.iid(int), pg_temp.lid(int), pg_temp.act_as(uuid, uuid, text),
  pg_temp.err(text), pg_temp.approve(int, uuid), pg_temp.preview(int, uuid),
  pg_temp.preview_err(int, uuid), pg_temp.status(int), pg_temp.counts(), pg_temp.last_price(text),
  pg_temp.snapshot(), pg_temp.written_since_snapshot() to authenticated;

-- Fixture 1.
select pg_temp.mk_inv(1, p_due => null);
select pg_temp.mk_line(101, 1, 1, 2, 'kg', 25.5, '1a000000-0000-4000-8000-00000000001a',
  '51000000-0000-4000-8000-000000000051', p_lot => 'L-A', p_expiry => '2026-12-01');
select pg_temp.mk_line(102, 1, 2, 500, 'g', 4, '1a000000-0000-4000-8000-00000000001a',
  '51000000-0000-4000-8000-000000000051');
select pg_temp.mk_line(103, 1, 3, 2, 'conf', 30, '1b000000-0000-4000-8000-00000000001b',
  '52000000-0000-4000-8000-000000000052');
select pg_temp.mk_line(104, 1, 4, 3, 'kg', 30, p_split => true);
select pg_temp.mk_line(105, 1, 4, 1, 'kg', 10, '1c000000-0000-4000-8000-00000000001c', p_sub => 1, p_parent => 104);
select pg_temp.mk_line(106, 1, 4, 2, 'kg', 20, '1d000000-0000-4000-8000-00000000001d', p_sub => 2, p_parent => 104);
select pg_temp.mk_line(107, 1, 4, 1, 'kg', 10, '1c000000-0000-4000-8000-00000000001c', p_sub => 3, p_parent => 104,
  p_superseded => true);
select pg_temp.mk_line(108, 1, 5, 1, 'pz', 8, p_stock => false, p_vat => 22);
select pg_temp.mk_line(109, 1, 6, 2, 'kg', 20, '1a000000-0000-4000-8000-00000000001a',
  '51000000-0000-4000-8000-000000000051', p_credit => 0.5);
select pg_temp.mk_line(110, 1, 7, 1, 'kg', 4, '1a000000-0000-4000-8000-00000000001a',
  '51000000-0000-4000-8000-000000000051', p_credit => 1);
select pg_temp.fix_totals(1);
-- Other invoices. 30: total mismatch. 31: duplicate. 32: for the injected fault. 33: rejected.
-- 34: failed extraction. 35 and 36: earlier and later dated invoices of MAN-1. 37: two locations.
-- 38: admin. 39: chef, waiter, owner B. 40: second approval of a non-stock line.
select pg_temp.mk_clean(30);
update public.invoice set gross_total = 99 where id = pg_temp.iid(30);
select pg_temp.mk_clean(31);
update public.invoice set status = 'duplicate', duplicate_of = pg_temp.iid(1) where id = pg_temp.iid(31);
select pg_temp.mk_clean(32);
select pg_temp.mk_clean(33, 'rejected');
select pg_temp.mk_clean(34, 'extraction_failed');
select pg_temp.mk_clean(35, p_date => '2026-09-15', p_amount => 22);
select pg_temp.mk_clean(36, p_date => '2026-10-01', p_amount => 28);
select pg_temp.mk_clean(37);
select pg_temp.mk_clean(38);
select pg_temp.mk_clean(39);

-- Privileges and shape (the conditions for a definer procedure).
select ok((select bool_and(has_function_privilege('authenticated', f, 'execute')
                           and not has_function_privilege('anon', f, 'execute')
                           and not has_function_privilege('service_role', f, 'execute')
                           and not has_function_privilege('public', f, 'execute'))
             from unnest(array['public.approve_invoice(uuid, uuid)',
                               'public.invoice_approval_preview(uuid, uuid)']) f),
  'only authenticated can execute approve_invoice and the preview');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
             from pg_proc p
            where p.oid in ('public.approve_invoice(uuid, uuid)'::regprocedure,
                            'public.invoice_approval_preview(uuid, uuid)'::regprocedure)),
  'both are SECURITY DEFINER with an empty search_path');

create temporary table fail_log (n int);
create function public.fail_payable_insert() returns trigger language plpgsql as $$
begin
  raise exception 'injected_fault' using errcode = 'P0001';
end
$$;

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');

-- Preview of the approvable invoice.
select is(pg_temp.preview(1) -> 'blockers', '[]'::jsonb, 'the preview of the fixture lists no blocker');
select is(pg_temp.preview(1) ->> 'status', 'review', 'it reports the status');
select is(pg_temp.preview(1) ->> 'receiptDate', '2026-09-29', 'the receipt date');
select is(pg_temp.preview(1) -> 'payable',
  '{"amount": 123.75, "dueDate": "2026-10-29", "grossAmount": 133.65, "creditedAmount": 9.9, "dueDateSource": "supplier_terms"}'::jsonb,
  'the payable: gross 133.65, credited 5.50 + 4.40, due from the supplier terms');
select is((pg_temp.preview(1) ->> 'receipts')::int, 6, 'six lines would be received');
select is((select trim_scale((e.value ->> 'receivedQty')::numeric) || ' ' || (e.value ->> 'baseUnit') || ' '
                  || trim_scale((e.value ->> 'unitPrice')::numeric)
             from jsonb_array_elements(pg_temp.preview(1) -> 'lines') e
            where e.value ->> 'lineId' = pg_temp.lid(103)::text),
  '12 kg 2.5', 'the pack line shows 12 kg at 2.50 per kg');
select is((select (e.value ->> 'creditedAmount')::numeric from jsonb_array_elements(pg_temp.preview(1) -> 'lines') e
            where e.value ->> 'lineId' = pg_temp.lid(109)::text),
  5.5, 'and the credit of line f');
select is(jsonb_array_length(pg_temp.preview(1) -> 'lines'), 8, 'every active line is listed');
select is(pg_temp.preview(1) -> 'locations',
  '{"required": false, "options": [{"id": "10000000-0000-4000-8000-0000000000a1", "name": "Cella"}], "defaultId": "10000000-0000-4000-8000-0000000000a1"}'::jsonb,
  'one location: not required, chosen by default');
select is(pg_temp.preview(30) -> 'blockers', '[{"code": "total_mismatch", "lineIds": []}]'::jsonb,
  'AT1: a mismatching invoice lists total_mismatch');
select is(pg_temp.preview(33) -> 'blockers', '[]'::jsonb, 'a rejected invoice lists no blockers (not review)');
select is(pg_temp.preview_err(1, '10000000-0000-4000-8000-0000000000b9'), 'ok',
  'an unknown location is a blocker, not an error');
select is(pg_temp.preview(1, '10000000-0000-4000-8000-0000000000b9') -> 'blockers',
  '[{"code": "location_not_found", "lineIds": []}]'::jsonb, 'location_not_found');

-- AT1: total mismatch.
select is(pg_temp.counts(), '0/0/0/0/0', 'nothing is posted yet');
select is(pg_temp.approve(30), 'P0001 total_mismatch', 'AT1: a total mismatch is refused');
select is(pg_temp.counts(), '0/0/0/0/0', 'AT1: nothing was written');
select is(pg_temp.status(30), 'review', 'AT1: the invoice stays in review');

-- AT2: duplicate.
select is(pg_temp.approve(31), 'P0001 duplicate_invoice', 'AT2: a duplicate is refused');
select is(pg_temp.counts(), '0/0/0/0/0', 'AT2: nothing was written');
select is(pg_temp.status(31), 'duplicate', 'AT2: the invoice stays a duplicate');

-- Statuses.
select is(pg_temp.approve(33), 'P0001 invoice_rejected', 'a rejected invoice');
select is(pg_temp.approve(34), 'P0001 invoice_not_in_review', 'an invoice whose extraction failed');
select is(pg_temp.err(format('select public.approve_invoice(%L)', pg_temp.iid(99))), 'P0002 not_found',
  'an unknown invoice');

-- AT4: a fault at the payable insert undoes everything (a temporary trigger is the fault).
reset role;
create trigger fail_payable before insert on public.payable
  for each row execute function public.fail_payable_insert();
set local role authenticated;
select is(pg_temp.approve(32), 'P0001 injected_fault', 'AT4: the injected fault at the payable insert surfaces');
select is(pg_temp.counts(), '0/0/0/0/0', 'AT4: no lot, movement, price, payable or audit row remains');
select is(pg_temp.status(32), 'review', 'AT4: the invoice is still in review');
select is(pg_temp.last_price('MAN-1'), null, 'AT4: last_price is untouched');
reset role;
drop trigger fail_payable on public.payable;
set local role authenticated;

-- AT3: the approval.
select pg_temp.snapshot();
insert into approve_ret select public.approve_invoice(pg_temp.iid(1));
select is(pg_temp.status(1), 'approved', 'AT3: the invoice is approved');
select is((select j ->> 'receipts' from approve_ret), '6', 'the result counts six receipts');
select is((select (j ->> 'amount')::numeric from approve_ret), 123.75, 'and the payable amount');
select is((select j ->> 'dueDate' from approve_ret), '2026-10-29', 'and its due date');
select is((select j ->> 'payableId' from approve_ret), (select id::text from public.payable), 'and its id');
select is(pg_temp.counts(), '6/6/6/1/1', 'six lots, movements and prices, one payable and one audit row');
select is(pg_temp.written_since_snapshot(),
  array['audit_event', 'invoice', 'payable', 'price_history', 'raw_lot', 'stock_movement', 'supplier_item'],
  'only the ledgers, the item, the invoice and the audit are written');

select is((select string_agg(format('%s.%s %s %s %s %s', l.position, l.sub_position, trim_scale(r.qty_received),
              trim_scale(r.source_qty), r.source_unit, trim_scale(r.base_factor)), '|'
              order by l.position, l.sub_position)
            from public.raw_lot r join public.invoice_line l on l.id = r.invoice_line_id),
  '1.0 2 2 kg 1|2.0 0.5 500 g 0.001|3.0 12 2 conf 6|4.1 1 1 kg 1|4.2 2 2 kg 1|6.0 1.5 1.5 kg 1',
  'lots: base quantity, source quantity and unit, and the factor used');
select is((select count(*)::int from public.raw_lot
            where location_id = '10000000-0000-4000-8000-0000000000a1' and received_on = '2026-09-29'
              and supplier_id = '5a000000-0000-4000-8000-00000000005a'
              and created_by = 'a1000000-0000-4000-8000-00000000000a'), 6,
  'all lots: Cella, 2026-09-29, supplier A, created by the owner');
select is((select lot_code || ' ' || expiry from public.raw_lot where invoice_line_id = pg_temp.lid(101)),
  'L-A 2026-12-01', 'lot code and expiry come from the line');
select is((select string_agg(format('%s.%s %s %s', l.position, l.sub_position, trim_scale(m.qty),
              trim_scale(m.unit_cost)), '|' order by l.position, l.sub_position)
            from public.stock_movement m join public.invoice_line l on l.id = m.ref_id),
  '1.0 2 12.75|2.0 0.5 8|3.0 12 2.5|4.1 1 10|4.2 2 10|6.0 1.5 10',
  'movements: quantity = lot quantity, unit cost = price per base unit');
select is((select count(*)::int from public.stock_movement m join public.raw_lot r on r.id = m.raw_lot_id
            where m.type = 'receipt' and m.ref_type = 'invoice_line' and m.ref_id = r.invoice_line_id
              and m.qty = r.qty_received and m.location_id = r.location_id
              and m.effective_on = '2026-09-29' and m.ingredient_id = r.ingredient_id), 6,
  'each movement points at its lot, line and location with the business date');
select is((select string_agg(format('%s.%s %s', l.position, l.sub_position, trim_scale(p.unit_price)), '|'
              order by p.seq)
            from public.price_history p join public.invoice_line l on l.id = p.invoice_line_id),
  '1.0 12.75|2.0 8|3.0 2.5|4.1 10|4.2 10|6.0 10', 'price rows: in line order, EUR per base unit');
select is((select count(*)::int from public.price_history
            where supplier_item_id is null and effective_on = '2026-09-29' and base_unit = 'kg'), 2,
  'the two split children have no item; every row has the business date');
select is((select count(*)::int from public.price_history p
            join public.invoice_line l on l.id = p.invoice_line_id where l.position = 4
              and p.supplier_item_id is null), 2, 'they are the children of the split line');
select is(pg_temp.last_price('MAN-1'), 10::numeric, 'last_price of MAN-1: the newest price row (line f)');
select is(pg_temp.last_price('POL-1'), 2.5, 'last_price of POL-1: price per kg, not per case');
select is((select gross_amount::text || ' ' || credited_amount || ' ' || amount || ' ' || due_date || ' '
                  || due_date_source || ' ' || status || ' ' || supplier_id
             from public.payable where invoice_id = pg_temp.iid(1)),
  '133.65 9.90 123.75 2026-10-29 supplier_terms open 5a000000-0000-4000-8000-00000000005a',
  'payable: gross, credited (incl. VAT), amount, due date and source');
select is((select action || ' ' || created_by || ' ' || (before ->> 'status') || ' ' || (after ->> 'status')
             from public.audit_event where entity_id = pg_temp.iid(1)),
  'invoice.approved a1000000-0000-4000-8000-00000000000a review approved',
  'audit: who approved, status before and after');
select is((select (after ->> 'payable_id') || ' ' || (after ->> 'amount') || ' ' || (after ->> 'due_date') || ' '
                  || (after ->> 'due_date_source') || ' ' || (after ->> 'receipt_date') || ' '
                  || (after ->> 'location_id') || ' ' || (after ->> 'receipts')
             from public.audit_event where entity_id = pg_temp.iid(1)),
  (select id::text from public.payable) || ' 123.75 2026-10-29 supplier_terms 2026-09-29 10000000-0000-4000-8000-0000000000a1 6',
  'audit: the posted figures');
select is((select count(*)::int from public.audit_event where entity_type = 'invoice'
            and entity_id = pg_temp.iid(1) and tenant_id = '11111111-1111-4111-8111-111111111111'), 1,
  'one audit row, in the invoice''s tenant');
select is((select count(*)::int from (select 1 from public.raw_lot where invoice_line_id = pg_temp.lid(108)
            union all select 1 from public.stock_movement where ref_id = pg_temp.lid(108)
            union all select 1 from public.price_history where invoice_line_id = pg_temp.lid(108)) x), 0,
  'AT5: the non-stock line posted nothing');
select is((select count(*)::int from (select 1 from public.raw_lot where invoice_line_id = pg_temp.lid(110)
            union all select 1 from public.stock_movement where ref_id = pg_temp.lid(110)
            union all select 1 from public.price_history where invoice_line_id = pg_temp.lid(110)) x), 0,
  'and neither did the fully credited line');
select is((select count(*)::int from public.v_stock_on_hand), 6, 'the stock view shows the six lots');
select is((select sum(qty_on_hand) from public.v_stock_on_hand), 19::numeric, 'with 19 kg in total');
select is((select sum(qty_on_hand) from public.v_stock_on_hand
            where ingredient_id = '1a000000-0000-4000-8000-00000000001a'), 4::numeric,
  'Manzo: 2 + 0.5 + 1.5 kg');
select is((select count(*)::int from public.v_stock_on_hand
            where location_id = '10000000-0000-4000-8000-0000000000a1'), 6, 'all of it in Cella');

-- The preview after the fact equals what was written.
select is(pg_temp.preview(1) -> 'blockers', '[]'::jsonb, 'an approved invoice lists no blocker');
select is((select count(*)::int from jsonb_array_elements(pg_temp.preview(1) -> 'lines') e
            join public.raw_lot r on r.invoice_line_id = (e.value ->> 'lineId')::uuid
            where (e.value ->> 'receivedQty')::numeric = r.qty_received), 6,
  'the preview''s quantities equal the lots');
select is((select (pg_temp.preview(1) -> 'payable' ->> 'amount')::numeric = amount
                  and (pg_temp.preview(1) -> 'payable' ->> 'creditedAmount')::numeric = credited_amount
             from public.payable), true, 'and its payable equals the payable row');

-- AT5: a second approval.
select is(pg_temp.approve(1), 'P0001 invoice_already_approved', 'AT5: a second approval is refused');
select is(pg_temp.counts(), '6/6/6/1/1', 'AT5: nothing was added');

-- last_price follows the invoice date, not the order of approval.
select is(pg_temp.approve(35), 'ok', 'an earlier-dated invoice (2026-09-15, 11.00 per kg) is approved afterwards');
select is(pg_temp.last_price('MAN-1'), 10::numeric, 'last_price keeps the newer invoice''s price');
select is(pg_temp.approve(36), 'ok', 'a later-dated invoice (2026-10-01, 14.00 per kg)');
select is(pg_temp.last_price('MAN-1'), 14::numeric, 'moves last_price');
select is((select count(*)::int from public.price_history where unit_price = 11), 1,
  'the earlier invoice''s price row exists all the same');

-- Locations.
reset role;
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Dispensa');
set local role authenticated;
select is(pg_temp.approve(37), 'P0001 location_required', 'two locations and none chosen');
select is(pg_temp.preview(37) -> 'locations' ->> 'required', 'true', 'the preview says a choice is required');
select is(jsonb_array_length(pg_temp.preview(37) -> 'locations' -> 'options'), 2, 'with both options');
select is(pg_temp.preview(37) -> 'locations' ->> 'defaultId', null, 'and no default');
select is(pg_temp.approve(37, '10000000-0000-4000-8000-0000000000a2'), 'ok', 'a chosen location is accepted');
select is((select location_id from public.raw_lot where invoice_line_id = pg_temp.lid(371)),
  '10000000-0000-4000-8000-0000000000a2'::uuid, 'the lot is in Dispensa');
select is((select location_id from public.stock_movement where ref_id = pg_temp.lid(371)),
  '10000000-0000-4000-8000-0000000000a2'::uuid, 'and so is the movement');

-- Admin may approve; the writes are exactly the eight tables (M8: invoice 38 prices MAN-1 far from its
-- earlier purchases, so the variance check also writes one price_variance alert).
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select pg_temp.snapshot();
select is(pg_temp.approve(38, '10000000-0000-4000-8000-0000000000a1'), 'ok', 'an admin approves');
select is(pg_temp.written_since_snapshot(),
  array['alert', 'audit_event', 'invoice', 'payable', 'price_history', 'raw_lot', 'stock_movement', 'supplier_item'],
  'one approval writes the ledgers, the item, the invoice, the audit and (M8) the price alert, nothing else');
select is((select created_by from public.audit_event where entity_id = pg_temp.iid(38)),
  'f1000000-0000-4000-8000-00000000000f'::uuid, 'the audit row names the admin');

-- AT7: roles.
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.approve(39), '42501 insufficient_privilege', 'AT7: the chef may not approve');
select is(pg_temp.preview_err(39), '42501 insufficient_privilege', 'AT7: or read the preview (it carries prices)');
select is(pg_temp.approve(99), '42501 insufficient_privilege', 'the role is checked before the invoice is looked up');
select is(pg_temp.preview_err(99), '42501 insufficient_privilege', 'also for the preview');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.approve(39), '42501 insufficient_privilege', 'AT7: the waiter may not approve');
select is(pg_temp.preview_err(39), '42501 insufficient_privilege', 'AT7: or read the preview');
select is(pg_temp.status(39), null, 'the waiter cannot even see the invoice');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.approve(39), 'P0002 not_found', 'owner B cannot approve A''s invoice');
select is(pg_temp.preview_err(39), 'P0002 not_found', 'or preview it');
select is(pg_temp.approve(1), 'P0002 not_found', 'not even an approved one (no status leak)');
reset role;
select is(pg_temp.status(39), 'review', 'A''s invoice is untouched');
set local role anon;
select is(pg_temp.err(format('select public.approve_invoice(%L)', pg_temp.iid(39))),
  '42501 permission denied for function approve_invoice', 'anon has no execute on approve_invoice');
select is(pg_temp.err(format('select public.invoice_approval_preview(%L)', pg_temp.iid(39))),
  '42501 permission denied for function invoice_approval_preview', 'or on the preview');
reset role;
select is(pg_temp.counts(), '10/10/10/5/5', 'the ledgers hold only the five approvals');

select * from finish();
rollback;
