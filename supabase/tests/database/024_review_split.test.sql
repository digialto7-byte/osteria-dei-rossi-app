-- M4 step 6: public.review_split_line and public.review_unsplit_line (plan §3.2). Covers AT3 (DB):
-- split sums are exact or nothing is written. A split keeps its parent (split_at) and adds
-- children; a re-split supersedes the old children; nothing is deleted.
begin;
create extension if not exists pgtap with schema extensions;
select plan(69);

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
insert into public.cost_centre (id, tenant_id, name) values
  ('c5000000-0000-4000-8000-0000000000c5', '11111111-1111-4111-8111-111111111111', 'Pulizie');

create function pg_temp.iid(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.lid(n int) returns uuid language sql immutable as $$
  select ('a2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.mk_invoice(n int, p_status public.invoice_status default 'review',
    p_tenant uuid default '11111111-1111-4111-8111-111111111111', p_vat numeric default null,
    p_gross numeric default null, p_dup_of uuid default null) returns void language sql as $$
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status,
      vat_total, gross_total, duplicate_of)
  values (pg_temp.iid(n), p_tenant, p_tenant || '/2026/' || pg_temp.iid(n) || '.pdf',
      'application/pdf', 100, p_status, p_vat, p_gross, p_dup_of)
$$;
create function pg_temp.mk_line(n int, inv int, pos int, p_qty numeric, p_amount numeric,
    p_extra text default '', p_vals text default '',
    p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns void language plpgsql as $$
begin
  execute format($q$
    insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty,
        unit_price, line_amount, vat_rate, unit, lot_code, expiry, field_confidence, extracted %s)
    values (%L, %L, %L, %s, 'Prodotto', %s, %s, %s, 10, 'kg', 'L-1', '2026-12-01', '{}', '{}' %s)$q$,
    case when p_extra = '' then '' else ', ' || p_extra end, pg_temp.lid(n), p_tenant,
    pg_temp.iid(inv), pos, p_qty, p_amount / nullif(p_qty, 0), p_amount,
    case when p_vals = '' then '' else ', ' || p_vals end);
end
$$;

-- Invoice 1: lines of 30 + 5 + 30 + 10 + 8 = 83.00, no VAT, gross 83.00: the gate passes.
select pg_temp.mk_invoice(1, 'review', p_vat => 0, p_gross => 83);
select pg_temp.mk_invoice(2, 'duplicate', p_dup_of => pg_temp.iid(1));
select pg_temp.mk_invoice(3, 'review', '22222222-2222-4222-8222-222222222222');
select pg_temp.mk_line(1, 1, 1, 3, 30);
select pg_temp.mk_line(2, 1, 2, 1, 5);
select pg_temp.mk_line(3, 1, 3, 3, 30, 'credit_qty', '1');
select pg_temp.mk_line(4, 1, 4, 3, 10);
select pg_temp.mk_line(5, 2, 1, 3, 30);
select pg_temp.mk_line(6, 3, 1, 3, 30, p_tenant => '22222222-2222-4222-8222-222222222222');
-- Line 7 is non-stock: its children inherit that.
select pg_temp.mk_line(7, 1, 5, 2, 8, 'is_stock, cost_centre_id', $$false, 'c5000000-0000-4000-8000-0000000000c5'$$);
update public.invoice set totals_diff = 0 where id = pg_temp.iid(1);

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
create function pg_temp.split(p_line int, p_children text, p_inv int default 1) returns text
  language sql as $$
  select pg_temp.err(format('select public.review_split_line(%L, %L, %L::jsonb)',
    pg_temp.iid(p_inv), pg_temp.lid(p_line), p_children)) $$;
create function pg_temp.unsplit(p_line int, p_inv int default 1) returns text language sql as $$
  select pg_temp.err(format('select public.review_unsplit_line(%L, %L)', pg_temp.iid(p_inv),
    pg_temp.lid(p_line))) $$;
create function pg_temp.upd(p_line int, p_patch text, p_inv int default 1) returns text
  language sql as $$
  select pg_temp.err(format('select public.review_update_line(%L, %L, %L::jsonb)',
    pg_temp.iid(p_inv), pg_temp.lid(p_line), p_patch)) $$;
create function pg_temp.line(n int) returns public.invoice_line language sql as $$
  select l from public.invoice_line l where l.id = pg_temp.lid(n) $$;
-- Active children of a parent, as 'sub:qty:amount:price' text, in order.
create function pg_temp.children(n int) returns text language sql as $$
  select coalesce(string_agg(c.sub_position || ':' || c.qty::float8 || ':' || c.line_amount::float8
           || ':' || c.unit_price::float8, ' ' order by c.sub_position), '')
    from public.invoice_line c where c.parent_line_id = pg_temp.lid(n) and c.superseded_at is null $$;
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
grant select, insert, delete on xact_snapshot to authenticated;
grant execute on function pg_temp.iid(int), pg_temp.lid(int), pg_temp.act_as(uuid, uuid, text),
  pg_temp.err(text), pg_temp.split(int, text, int), pg_temp.unsplit(int, int),
  pg_temp.upd(int, text, int), pg_temp.line(int), pg_temp.children(int), pg_temp.snapshot(),
  pg_temp.written_since_snapshot() to authenticated;

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');

select ok(has_function_privilege('authenticated', 'public.review_split_line(uuid, uuid, jsonb)', 'execute')
      and has_function_privilege('authenticated', 'public.review_unsplit_line(uuid, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.review_split_line(uuid, uuid, jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.review_unsplit_line(uuid, uuid)', 'execute')
      and not has_function_privilege('service_role', 'public.review_split_line(uuid, uuid, jsonb)', 'execute')
      and not has_function_privilege('service_role', 'public.review_unsplit_line(uuid, uuid)', 'execute'),
  'only authenticated can call the split procedures');

select gate_flags as flags_before, totals_diff as diff_before into temporary gate_before
  from public.invoice where id = pg_temp.iid(1);
grant select on gate_before to authenticated;

-- A wrong sum writes nothing (AT3).
select pg_temp.snapshot();
select is(pg_temp.split(1, '[{"qty": 1, "line_amount": 10.00}, {"qty": 1.5, "line_amount": 20.00}]'),
  'P0001 split_sum_mismatch', 'quantities that do not add up are refused');
select is(pg_temp.split(1, '[{"qty": 1, "line_amount": 10.00}, {"qty": 2, "line_amount": 19.99}]'),
  'P0001 split_sum_mismatch', 'amounts that do not add up are refused');
select is(pg_temp.split(1, '[{"qty": 1, "line_amount": 10.00}, {"qty": 2, "line_amount": 20.01}]'),
  'P0001 split_sum_mismatch', 'amounts over by a cent are refused');
select is((select count(*)::int from public.invoice_line where parent_line_id = pg_temp.lid(1)), 0,
  'nothing was written');
select is((pg_temp.line(1)).split_at, null, 'and the parent is not split');

-- A correct split.
select is(pg_temp.split(1, '[{"qty": 1, "line_amount": 10.00}, {"qty": 2, "line_amount": 20.00}]'), 'ok',
  'a split whose sums match is accepted (AT3)');
select is((pg_temp.line(1)).split_at, now(), 'the parent is marked split, not removed');
select is(pg_temp.children(1), '1:1:10:10 2:2:20:10', 'two children at sub-positions 1 and 2, each at 10 a unit');
select is((select count(*)::int from public.invoice_line where invoice_id = pg_temp.iid(1) and position = 1), 3,
  'the parent and its two children share the position');
select is((select string_agg(distinct vat_rate::text || unit || lot_code || expiry::text, ',')
             from public.invoice_line where parent_line_id = pg_temp.lid(1)),
  '10.00kgL-12026-12-01', 'VAT rate, unit, lot and expiry are copied');
select is((select string_agg(distinct is_stock::text || coalesce(extracted::text, '') || field_confidence::text, ',')
             from public.invoice_line where parent_line_id = pg_temp.lid(1)),
  'true{}{}', 'children are stock lines with an empty baseline');
select is((select count(*)::int from public.invoice_line where parent_line_id = pg_temp.lid(1)
            and raw_description = 'Prodotto' and created_by = 'a1000000-0000-4000-8000-00000000000a'), 2,
  'children keep the description and record who split');
select is((select checks from public.invoice_line where parent_line_id = pg_temp.lid(1) and sub_position = 1),
  '{}', 'children get their line checks');
select is((select gate_flags from public.invoice where id = pg_temp.iid(1)),
  (select flags_before from gate_before), 'the totals gate is unchanged by a split');
select is((select totals_diff from public.invoice where id = pg_temp.iid(1)),
  (select diff_before from gate_before), 'and so is the difference');
select is((pg_temp.line(1)).corrected_fields, '{}', 'a split is not a correction');
select is(pg_temp.written_since_snapshot(), array['invoice', 'invoice_line'],
  'a split writes only invoice and invoice_line');
select is((select status from public.invoice where id = pg_temp.iid(1)), 'review'::public.invoice_status,
  'the invoice is still in review');

-- Edits after a split.
select is(pg_temp.upd(1, '{"qty": 2}'), 'P0001 line_split', 'the parent can no longer be edited');
select is(pg_temp.upd(1, '{"reviewed": true}'), 'P0001 line_split', 'not even to mark it checked');
select is(pg_temp.upd(100, '{"qty": 1}'), 'P0002 not_found', 'an unknown line is not found');
create temporary table child_ids as
  select c.id, c.sub_position from public.invoice_line c where c.parent_line_id = pg_temp.lid(1);
grant select on child_ids to authenticated;
select is(pg_temp.err(format('select public.review_update_line(%L, %L, %L::jsonb)', pg_temp.iid(1),
    (select id from child_ids where sub_position = 1), '{"qty": 2}')), 'P0001 split_child_locked',
  'a child''s quantity is locked');
select is(pg_temp.err(format('select public.review_split_line(%L, %L, %L::jsonb)', pg_temp.iid(1),
    (select id from child_ids where sub_position = 1),
    '[{"qty": 0.5, "line_amount": 5}, {"qty": 0.5, "line_amount": 5}]')), 'P0001 split_child_cannot_split',
  'a child cannot be split again');

-- Re-split: the first children are superseded, the new ones continue the numbering.
select is(pg_temp.split(1, '[{"qty": 1.5, "line_amount": 15}, {"qty": 1.5, "line_amount": 15}]'), 'ok',
  'a split line can be split again');
select is(pg_temp.children(1), '3:1.5:15:10 4:1.5:15:10', 'the new children are 3 and 4');
select is((select count(*)::int from public.invoice_line
            where parent_line_id = pg_temp.lid(1) and superseded_at is not null), 2,
  'the first two children are superseded, not deleted');
select is((select count(*)::int from public.invoice_line where parent_line_id = pg_temp.lid(1)), 4,
  'four child rows exist in all');
select is(pg_temp.err(format('select public.review_update_line(%L, %L, %L::jsonb)', pg_temp.iid(1),
    (select id from child_ids where sub_position = 1), '{"reviewed": true}')), 'P0002 not_found',
  'a superseded child is not found');
select is((select gate_flags from public.invoice where id = pg_temp.iid(1)),
  (select flags_before from gate_before), 'the totals gate counts the new children once');

-- Unsplit.
select is(pg_temp.unsplit(1), 'ok', 'a split is undone');
select is((pg_temp.line(1)).split_at, null, 'the parent is active again');
select is(pg_temp.children(1), '', 'no active children remain');
select is((select count(*)::int from public.invoice_line
            where parent_line_id = pg_temp.lid(1) and superseded_at is not null), 4,
  'all four children are superseded, none deleted');
select is((select gate_flags from public.invoice where id = pg_temp.iid(1)),
  (select flags_before from gate_before), 'the totals gate is unchanged after unsplit');
select is(pg_temp.upd(1, '{"reviewed": true}'), 'ok', 'the parent can be edited again');
select is(pg_temp.unsplit(1), 'P0001 not_split', 'an unsplit line cannot be unsplit');
select is(pg_temp.unsplit(2), 'P0001 not_split', 'a line never split cannot be unsplit');
select is(pg_temp.err(format('select public.review_unsplit_line(%L, %L)', pg_temp.iid(1),
    (select id from child_ids where sub_position = 1))), 'P0002 not_found', 'a superseded child is not found');
select is(pg_temp.split(1, '[{"qty": 1, "line_amount": 10}, {"qty": 2, "line_amount": 20}]'), 'ok',
  'it can be split again after an unsplit');
select is(pg_temp.children(1), '5:1:10:10 6:2:20:10', 'numbering continues at 5');

-- Rules.
select is(pg_temp.split(3, '[{"qty": 1, "line_amount": 10}, {"qty": 2, "line_amount": 20}]'),
  'P0001 split_credit_conflict', 'a line with a credit quantity cannot be split');
select is(pg_temp.split(2, '[{"qty": 1, "line_amount": 5}]'), 'P0001 invalid_request', 'one child is refused');
select is(pg_temp.split(2, (select jsonb_agg(jsonb_build_object('qty', 0.1, 'line_amount', 0.1))::text
                              from generate_series(1, 11))), 'P0001 invalid_request', 'eleven children are refused');
select is(pg_temp.split(4, (select jsonb_agg(jsonb_build_object('qty', 0.3, 'line_amount', 1))::text
                              from generate_series(1, 10))), 'ok', 'ten children are accepted');
select is((select count(*)::int from public.invoice_line where parent_line_id = pg_temp.lid(4)), 10, 'all ten are stored');
select is(pg_temp.split(2, '[{"qty": 0, "line_amount": 0}, {"qty": 1, "line_amount": 5}]'), 'P0001 invalid_request',
  'a zero quantity is refused');
select is(pg_temp.split(2, '[{"qty": -1, "line_amount": 0}, {"qty": 2, "line_amount": 5}]'), 'P0001 invalid_request',
  'a negative quantity is refused');
select is(pg_temp.split(2, '[{"qty": 2, "line_amount": -1}, {"qty": -1, "line_amount": 6}]'), 'P0001 invalid_request',
  'a negative amount is refused');
select is(pg_temp.split(2, '[{"qty": 0.5, "line_amount": 2.5}, {"qty": 0.5, "line_amount": 2.5, "x": 1}]'),
  'P0001 invalid_request', 'an unknown key is refused');
select is(pg_temp.split(2, '[{"qty": 0.5, "line_amount": 2.5}, {"qty": "0.5", "line_amount": 2.5}]'),
  'P0001 invalid_request', 'a number sent as text is refused');
select is(pg_temp.split(2, '[{"qty": 0.33333, "line_amount": 2.5}, {"qty": 0.66667, "line_amount": 2.5}]'),
  'P0001 invalid_request', 'more than four decimals are refused');
select is(pg_temp.split(2, '{"qty": 1}'), 'P0001 invalid_request', 'children must be an array');
select is(pg_temp.split(2, '[{"qty": 0.5, "line_amount": 0}, {"qty": 0.5, "line_amount": 5}]'), 'ok',
  'a zero amount child is accepted');
select is(pg_temp.children(2), '1:0.5:0:0 2:0.5:5:10', 'with its unit price');
select is(pg_temp.split(7, '[{"qty": 1, "line_amount": 3}, {"qty": 1, "line_amount": 5}]'), 'ok',
  'a non-stock line is split');
select is((select count(*)::int from public.invoice_line where parent_line_id = pg_temp.lid(7)
            and not is_stock and cost_centre_id = 'c5000000-0000-4000-8000-0000000000c5'), 2,
  'its children are non-stock with the same cost centre');

-- Rounding of the unit price.
select is(pg_temp.unsplit(4), 'ok', 'a ten-way split is undone');
select is(pg_temp.split(4, '[{"qty": 1, "line_amount": 3.3333}, {"qty": 2, "line_amount": 6.6667}]'), 'ok',
  'a split with uneven amounts');
select is(pg_temp.children(4), '11:1:3.3333:3.3333 12:2:6.6667:3.3334', 'unit prices are rounded to four decimals');

-- Access.
select is(pg_temp.split(5, '[{"qty": 1, "line_amount": 10}, {"qty": 2, "line_amount": 20}]', 2),
  'P0001 invoice_not_in_review', 'an invoice in duplicate is closed');
select is(pg_temp.unsplit(5, 2), 'P0001 invoice_not_in_review', 'for unsplit too');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.split(2, '[{"qty": 0.5, "line_amount": 2.5}, {"qty": 0.5, "line_amount": 2.5}]'),
  '42501 insufficient_privilege', 'the chef may not split');
select is(pg_temp.unsplit(1), '42501 insufficient_privilege', 'or unsplit');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.split(2, '[{"qty": 0.5, "line_amount": 2.5}, {"qty": 0.5, "line_amount": 2.5}]'),
  '42501 insufficient_privilege', 'the waiter may not split');
select is(pg_temp.unsplit(1), '42501 insufficient_privilege', 'or unsplit');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.split(1, '[{"qty": 1, "line_amount": 10}, {"qty": 2, "line_amount": 20}]'), 'P0002 not_found',
  'owner B cannot split A''s line');
select is(pg_temp.unsplit(1), 'P0002 not_found', 'or unsplit it');
select is(pg_temp.split(6, '[{"qty": 1, "line_amount": 10}, {"qty": 2, "line_amount": 20}]', 3), 'ok',
  'owner B splits B''s own line');

reset role;
select * from finish();
rollback;
