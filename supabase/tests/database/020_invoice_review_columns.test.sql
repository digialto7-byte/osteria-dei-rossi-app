-- M4 step 2: review columns on invoice and invoice_line, supplier_item.invoice_unit (plan §3.2).
-- Constraint checks run as service_role (the only role that writes these tables directly);
-- the access checks run as the owner, who still has no UPDATE on invoice or invoice_line.
begin;
create extension if not exists pgtap with schema extensions;
select plan(58);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere A');

insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo', 'kg'),
  ('1b000000-0000-4000-8000-00000000001b', '22222222-2222-4222-8222-222222222222', 'Manzo B', 'kg');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo Srl', 'IT12345678903'),
  ('5b000000-0000-4000-8000-00000000005b', '22222222-2222-4222-8222-222222222222',
   'Fornitore Demo Srl', 'IT12345678903');
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_qty,
                                  pack_unit) values
  ('51000000-0000-4000-8000-000000000051', '11111111-1111-4111-8111-111111111111',
   '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 'MAN-1', 1, 'kg'),
  ('52000000-0000-4000-8000-000000000052', '22222222-2222-4222-8222-222222222222',
   '5b000000-0000-4000-8000-00000000005b', '1b000000-0000-4000-8000-00000000001b', 'MAN-1', 1, 'kg');
insert into public.cost_centre (id, tenant_id, name) values
  ('c5000000-0000-4000-8000-0000000000c5', '11111111-1111-4111-8111-111111111111', 'Pulizie'),
  ('c6000000-0000-4000-8000-0000000000c6', '22222222-2222-4222-8222-222222222222', 'Gas B');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes) values
  ('a1000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/a1000000-0000-4000-8000-0000000000a1.pdf',
   'application/pdf', 1000),
  ('b1000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222',
   '22222222-2222-4222-8222-222222222222/2026/b1000000-0000-4000-8000-0000000000b1.pdf',
   'application/pdf', 1000);
-- Tenant B's line, the target of a cross-tenant parent attempt.
insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty, line_amount,
                                 field_confidence, extracted) values
  ('b2000000-0000-4000-8000-0000000000b2', '22222222-2222-4222-8222-222222222222',
   'b1000000-0000-4000-8000-0000000000b1', 1, 'Pesce', 3, 30, '{}', '{}');

-- Runs a statement as the current role and reports "<sqlstate> <constraint>" or "ok".
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  cname text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, cname = constraint_name;
  return btrim(state || ' ' || coalesce(cname, ''));
end
$$;
-- One A line on invoice a1: position, sub-position and any extra columns/values.
create function pg_temp.ln(p_pos int, p_sub int default 0, p_cols text default '', p_vals text default '')
  returns text language plpgsql as $$
begin
  return pg_temp.err(format($q$
    insert into public.invoice_line (tenant_id, invoice_id, position, sub_position, raw_description,
        qty, line_amount, field_confidence, extracted %s)
    values ('11111111-1111-4111-8111-111111111111', 'a1000000-0000-4000-8000-0000000000a1',
        %s, %s, 'X', 2, 10, '{}', '{}' %s)$q$,
    case when p_cols = '' then '' else ', ' || p_cols end, p_pos, p_sub,
    case when p_vals = '' then '' else ', ' || p_vals end));
end
$$;
create function pg_temp.act_as(auth_id uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated',
    'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', app_role)::text, true)
$$;
grant execute on function pg_temp.err(text), pg_temp.ln(int, int, text, text),
  pg_temp.act_as(uuid, text) to service_role, authenticated;

-- Columns and index.
select has_column('public', 'invoice', 'supplier_id', 'invoice.supplier_id exists');
select has_column('public', 'invoice', 'supplier_suggestion_id', 'invoice.supplier_suggestion_id exists');
select has_column('public', 'invoice', 'header_corrected_fields', 'invoice.header_corrected_fields exists');
select has_index('public', 'invoice', 'invoice_supplier_status_idx', 'the propagation index exists');
select has_column('public', 'supplier_item', 'invoice_unit', 'supplier_item.invoice_unit exists');

set local role service_role;

-- Defaults of a plain M3-style line.
select is(pg_temp.ln(1), 'ok', 'an M3-style line is still accepted');
select is((select is_stock and credit_qty = 0 and sub_position = 0 and not corrected
                  and corrected_fields = '{}' and not pack_corrected and unit is null
             from public.invoice_line where invoice_id = 'a1000000-0000-4000-8000-0000000000a1'
              and position = 1), true, 'review defaults: stock, no credit, not corrected');

-- AT4 (DB): credit quantity and non-stock rules.
select is(pg_temp.ln(2, 0, 'credit_qty', '3'), '23514 invoice_line_credit_qty_ck',
  'credit_qty 3 on qty 2 is refused');
select is(pg_temp.ln(2, 0, 'credit_qty', '2'), 'ok', 'credit_qty equal to qty is accepted');
select is(pg_temp.ln(3, 0, 'credit_qty', '-1'), '23514 invoice_line_credit_qty_ck',
  'a negative credit_qty is refused');
select is(pg_temp.ln(4, 0, 'is_stock', 'false'), '23514 invoice_line_non_stock_ck',
  'non-stock without a cost centre is refused');
select is(pg_temp.ln(4, 0, 'is_stock, cost_centre_id', $$false, 'c5000000-0000-4000-8000-0000000000c5'$$),
  'ok', 'non-stock with a cost centre is accepted');
select is(pg_temp.ln(5, 0, 'is_stock, cost_centre_id, ingredient_id, mapping_source',
    $$false, 'c5000000-0000-4000-8000-0000000000c5', '1a000000-0000-4000-8000-00000000001a', 'manual'$$),
  '23514 invoice_line_non_stock_unmapped_ck', 'non-stock with an ingredient is refused');
select is(pg_temp.ln(5, 0, 'is_stock, cost_centre_id, supplier_item_id',
    $$false, 'c5000000-0000-4000-8000-0000000000c5', '51000000-0000-4000-8000-000000000051'$$),
  '23514 invoice_line_non_stock_unmapped_ck', 'non-stock with a supplier item is refused');
select is(pg_temp.ln(5, 0, 'cost_centre_id', $$'c5000000-0000-4000-8000-0000000000c5'$$),
  '23514 invoice_line_stock_no_cost_centre_ck', 'a stock line with a cost centre is refused');

-- Mapping.
select is(pg_temp.ln(5, 0, 'ingredient_id', $$'1a000000-0000-4000-8000-00000000001a'$$),
  '23514 invoice_line_mapping_source_ck', 'an ingredient without a mapping source is refused');
select is(pg_temp.ln(5, 0, 'mapping_source', $$'manual'$$),
  '23514 invoice_line_mapping_source_ck', 'a mapping source without an ingredient is refused');
select is(pg_temp.ln(5, 0, 'ingredient_id, mapping_source, supplier_item_id',
    $$'1a000000-0000-4000-8000-00000000001a', 'auto', '51000000-0000-4000-8000-000000000051'$$),
  'ok', 'a mapped line with its supplier item is accepted');
select is(pg_temp.ln(6, 0, 'ingredient_id, mapping_source',
    $$'1b000000-0000-4000-8000-00000000001b', 'manual'$$), '23503 invoice_line_ingredient_fk',
  'tenant B''s ingredient on A''s line is refused');
select is(pg_temp.ln(6, 0, 'supplier_item_id', $$'52000000-0000-4000-8000-000000000052'$$),
  '23503 invoice_line_supplier_item_fk', 'tenant B''s supplier item on A''s line is refused');
select is(pg_temp.ln(6, 0, 'suggested_ingredient_id', $$'1b000000-0000-4000-8000-00000000001b'$$),
  '23503 invoice_line_suggested_ingredient_fk', 'tenant B''s suggested ingredient is refused');
select is(pg_temp.ln(6, 0, 'suggested_supplier_item_id', $$'52000000-0000-4000-8000-000000000052'$$),
  '23503 invoice_line_suggested_supplier_item_fk', 'tenant B''s suggested supplier item is refused');
select is(pg_temp.ln(6, 0, 'is_stock, cost_centre_id', $$false, 'c6000000-0000-4000-8000-0000000000c6'$$),
  '23503 invoice_line_cost_centre_fk', 'tenant B''s cost centre on A''s line is refused');

-- Split children.
select is(pg_temp.ln(7, 0, 'parent_line_id', $$(select id from public.invoice_line
    where invoice_id = 'a1000000-0000-4000-8000-0000000000a1' and position = 1)$$),
  '23514 invoice_line_child_ck', 'a child with sub_position 0 is refused');
select is(pg_temp.ln(7, 1), '23514 invoice_line_child_ck', 'sub_position 1 without a parent is refused');
select is(pg_temp.ln(7, -1, 'parent_line_id', $$(select id from public.invoice_line
    where invoice_id = 'a1000000-0000-4000-8000-0000000000a1' and position = 1 and sub_position = 0)$$),
  '23514 invoice_line_sub_position_ck', 'a negative sub_position is refused');
select is(pg_temp.ln(1, 1, 'parent_line_id', $$(select id from public.invoice_line
    where invoice_id = 'a1000000-0000-4000-8000-0000000000a1' and position = 1)$$), 'ok',
  'sub-position 1 under position 1 is accepted');
select is(pg_temp.ln(1, 2, 'parent_line_id', $$(select id from public.invoice_line
    where invoice_id = 'a1000000-0000-4000-8000-0000000000a1' and position = 1 and sub_position = 0)$$),
  'ok', 'sub-position 2 under position 1 is accepted');
select is(pg_temp.ln(1, 2, 'parent_line_id', $$(select id from public.invoice_line
    where invoice_id = 'a1000000-0000-4000-8000-0000000000a1' and position = 1 and sub_position = 0)$$),
  '23505 invoice_line_position_uq', 'the same (position, sub_position) twice is refused');
select is(pg_temp.ln(1), '23505 invoice_line_position_uq', 'the same position twice is refused');
select is(pg_temp.ln(8, 1, 'parent_line_id', $$'b2000000-0000-4000-8000-0000000000b2'$$),
  '23503 invoice_line_parent_fk', 'a parent in another tenant is refused');
select is(pg_temp.ln(8, 0, 'split_at', 'now()'), 'ok', 'a parent line may carry split_at');
select is(pg_temp.ln(9, 1, 'parent_line_id, split_at', $$(select id from public.invoice_line
    where invoice_id = 'a1000000-0000-4000-8000-0000000000a1' and position = 1 and sub_position = 0),
    now()$$), '23514 invoice_line_split_at_ck', 'a child cannot carry split_at');
select is(pg_temp.ln(9, 1, 'parent_line_id, superseded_at', $$(select id from public.invoice_line
    where invoice_id = 'a1000000-0000-4000-8000-0000000000a1' and position = 1 and sub_position = 0),
    now()$$), 'ok', 'a child may be superseded');
select is(pg_temp.ln(10, 0, 'superseded_at', 'now()'), '23514 invoice_line_superseded_at_ck',
  'a parent cannot be superseded');

-- Corrections and units.
select is(pg_temp.ln(11, 0, 'corrected_fields', $$'{qty,ingredient}'$$), 'ok', 'known correction fields');
select is((select corrected from public.invoice_line
            where invoice_id = 'a1000000-0000-4000-8000-0000000000a1' and position = 11), true,
  'corrected is true when corrected_fields is not empty');
select is((select corrected from public.invoice_line
            where invoice_id = 'a1000000-0000-4000-8000-0000000000a1' and position = 2), false,
  'corrected is false when corrected_fields is empty');
select is(pg_temp.ln(12, 0, 'corrected_fields', $$'{foo}'$$), '23514 invoice_line_corrected_fields_ck',
  'an unknown correction field is refused');
select is(pg_temp.ln(12, 0, 'corrected', 'true'), '428C9', 'corrected cannot be written');
select is(pg_temp.ln(12, 0, 'unit', $$'cassa'$$), '23514 invoice_line_unit_ck', 'unit cassa is refused');
select is(pg_temp.ln(12, 0, 'suggested_unit', $$'cassa'$$), '23514 invoice_line_suggested_unit_ck',
  'suggested unit cassa is refused');
select is(pg_temp.ln(12, 0, 'unit, suggested_unit', $$'conf', 'conf'$$), 'ok', 'unit conf is accepted');
select is(pg_temp.ln(13, 0, 'mapping_source, ingredient_id', $$'bad', '1a000000-0000-4000-8000-00000000001a'$$),
  '23514 invoice_line_mapping_source_ck', 'an unknown mapping source is refused');

-- Invoice columns.
select is(pg_temp.err($$ update public.invoice set header_corrected_fields = '{foo}'
    where id = 'a1000000-0000-4000-8000-0000000000a1' $$), '23514 invoice_header_corrected_fields_ck',
  'an unknown header field is refused');
select is(pg_temp.err($$ update public.invoice set header_corrected_fields = '{gross_total,supplier_vat}'
    where id = 'a1000000-0000-4000-8000-0000000000a1' $$), 'ok', 'known header fields are accepted');
select is(pg_temp.err($$ update public.invoice set supplier_id = '5b000000-0000-4000-8000-00000000005b'
    where id = 'a1000000-0000-4000-8000-0000000000a1' $$), '23503 invoice_supplier_fk',
  'tenant B''s supplier on A''s invoice is refused');
select is(pg_temp.err($$ update public.invoice
    set supplier_suggestion_id = '5b000000-0000-4000-8000-00000000005b'
    where id = 'a1000000-0000-4000-8000-0000000000a1' $$), '23503 invoice_supplier_suggestion_fk',
  'tenant B''s suggested supplier is refused');
select is(pg_temp.err($$ update public.invoice
    set supplier_id = '5a000000-0000-4000-8000-00000000005a'
    where id = 'a1000000-0000-4000-8000-0000000000a1' $$), 'ok', 'A''s supplier links to A''s invoice');
select is(pg_temp.err($$ update public.invoice
    set duplicate_override_by = 'a1000000-0000-4000-8000-00000000000a'
    where id = 'a1000000-0000-4000-8000-0000000000a1' $$), '23514 invoice_duplicate_override_ck',
  'an override actor without a time is refused');
select is(pg_temp.err($$ update public.invoice
    set duplicate_override = true, duplicate_override_by = 'a1000000-0000-4000-8000-00000000000a',
        duplicate_override_at = now()
    where id = 'a1000000-0000-4000-8000-0000000000a1' $$), 'ok', 'a recorded override is accepted');

-- supplier_item.invoice_unit.
select is(pg_temp.err($$ update public.supplier_item set invoice_unit = 'cassa'
    where id = '51000000-0000-4000-8000-000000000051' $$), '23514 supplier_item_invoice_unit_ck',
  'invoice_unit cassa is refused');
select is(pg_temp.err($$ update public.supplier_item set invoice_unit = 'conf'
    where id = '51000000-0000-4000-8000-000000000051' $$), 'ok', 'invoice_unit conf is accepted');

-- Owner and waiter: no UPDATE on the review tables, waiter reads nothing.
reset role;
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'owner');
select is(pg_temp.err($$ update public.invoice_line set unit = 'kg' $$), '42501',
  'the owner has no UPDATE on invoice_line');
select is(pg_temp.err($$ update public.invoice set supplier_id = null $$), '42501',
  'the owner has no UPDATE on invoice');
select is(pg_temp.err($$ update public.supplier_item set invoice_unit = 'kg' $$), '42501',
  'the owner has no UPDATE on supplier_item.invoice_unit');
select isnt((select count(*) from public.invoice_line), 0::bigint, 'the owner still reads lines');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', 'waiter');
select is((select count(*) from public.invoice_line), 0::bigint, 'the waiter reads no lines');

reset role;
select * from finish();
rollback;
