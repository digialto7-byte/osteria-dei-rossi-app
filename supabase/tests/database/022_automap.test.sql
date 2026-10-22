-- M4 step 4: auto-mapping at extraction completion (plan §3.1.1, §3.2). Runs as service_role like
-- the worker (claim state set up directly, then extraction_complete as in 016). Covers AT2 (DB):
-- a known supplier code or description is mapped at completion with corrected = false.
begin;
create extension if not exists pgtap with schema extensions;
select plan(68);

insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');

insert into public.ingredient (id, tenant_id, name, base_unit, is_active) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo', 'kg', true),
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Vitello', 'kg', true),
  ('1c000000-0000-4000-8000-00000000001c', '11111111-1111-4111-8111-111111111111', 'Olio', 'l', true),
  ('1d000000-0000-4000-8000-00000000001d', '11111111-1111-4111-8111-111111111111', 'Vecchio', 'kg', false),
  ('1e000000-0000-4000-8000-00000000001e', '22222222-2222-4222-8222-222222222222', 'Manzo B', 'kg', true);
-- Supplier A1 has the VAT the invoices print; B1 is tenant B's supplier with the same VAT.
insert into public.supplier (id, tenant_id, name, vat_number, is_active) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo Srl', 'IT12345678903', true),
  ('5b000000-0000-4000-8000-00000000005b', '22222222-2222-4222-8222-222222222222',
   'Fornitore Demo Srl', 'IT12345678903', true),
  ('5c000000-0000-4000-8000-00000000005c', '11111111-1111-4111-8111-111111111111',
   'Ditta Demo', null, true),
  ('5d000000-0000-4000-8000-00000000005d', '11111111-1111-4111-8111-111111111111',
   'Ambigua', null, true),
  ('5e000000-0000-4000-8000-00000000005e', '11111111-1111-4111-8111-111111111111',
   ' ambigua ', null, true),
  ('5f000000-0000-4000-8000-00000000005f', '11111111-1111-4111-8111-111111111111',
   'Fornitore Spento', 'IT11111111115', false),
  ('50000000-0000-4000-8000-000000000050', '11111111-1111-4111-8111-111111111111',
   'Altro Fornitore', 'IT00000000000', true);
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code,
    description_hash, pack_qty, pack_unit, invoice_unit, is_active) values
  -- Keyed by code.
  ('51000000-0000-4000-8000-000000000051', '11111111-1111-4111-8111-111111111111',
   '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 'MAN-1', null,
   1, 'kg', 'kg', true),
  -- Keyed by description.
  ('52000000-0000-4000-8000-000000000052', '11111111-1111-4111-8111-111111111111',
   '5a000000-0000-4000-8000-00000000005a', '1b000000-0000-4000-8000-00000000001b', null,
   app.description_hash('Fesa di manzo'), 1, 'kg', 'kg', true),
  ('53000000-0000-4000-8000-000000000053', '11111111-1111-4111-8111-111111111111',
   '5a000000-0000-4000-8000-00000000005a', '1c000000-0000-4000-8000-00000000001c', null,
   app.description_hash('Olio'), 1, 'l', null, true),
  -- Inactive item, and an item whose ingredient is inactive.
  ('54000000-0000-4000-8000-000000000054', '11111111-1111-4111-8111-111111111111',
   '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 'OLD-1', null,
   1, 'kg', null, false),
  ('55000000-0000-4000-8000-000000000055', '11111111-1111-4111-8111-111111111111',
   '5a000000-0000-4000-8000-00000000005a', '1d000000-0000-4000-8000-00000000001d', 'GHOST-1', null,
   1, 'kg', null, true),
  -- Tenant B's item: same VAT and same code as A would use, and a code only B has.
  ('56000000-0000-4000-8000-000000000056', '22222222-2222-4222-8222-222222222222',
   '5b000000-0000-4000-8000-00000000005b', '1e000000-0000-4000-8000-00000000001e', 'MAN-1', null,
   1, 'kg', null, true),
  ('57000000-0000-4000-8000-000000000057', '22222222-2222-4222-8222-222222222222',
   '5b000000-0000-4000-8000-00000000005b', '1e000000-0000-4000-8000-00000000001e', 'B-ONLY', null,
   1, 'kg', null, true),
  -- An item of the VAT-less supplier: a name suggestion must not apply it.
  ('58000000-0000-4000-8000-000000000058', '11111111-1111-4111-8111-111111111111',
   '5c000000-0000-4000-8000-00000000005c', '1a000000-0000-4000-8000-00000000001a', 'D-1', null,
   1, 'kg', null, true);

-- Invoice n (extracting, claim token known), tenant A unless given.
create function pg_temp.iid(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.tok(n int) returns uuid language sql immutable as $$
  select ('99999999-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.mk(n int, p_tenant uuid default '11111111-1111-4111-8111-111111111111')
  returns void language sql as $$
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, attempts,
      extraction_started_at, claim_token)
  values (pg_temp.iid(n), p_tenant, p_tenant || '/2026/' || pg_temp.iid(n) || '.pdf',
      'application/pdf', 100, 'extracting', 1, now(), pg_temp.tok(n))
$$;
-- A line as extraction_complete receives it, with a realistic baseline in `extracted`.
create function pg_temp.xl(p_code text, p_desc text, p_unit text) returns jsonb language sql as $$
  select jsonb_build_object('raw_description', p_desc, 'supplier_code', p_code, 'qty', 2,
    'unit_raw', p_unit, 'unit_price', 5, 'line_amount', 10, 'vat_rate', 10, 'lot_code', null,
    'expiry', null, 'field_confidence', jsonb_build_object(), 'checks', jsonb_build_array(),
    'extracted', jsonb_build_object('description', p_desc, 'supplier_code', p_code, 'qty', 2,
      'unit', p_unit, 'unit_price', 5, 'line_amount', 10, 'vat_rate', 10, 'lot_code', null,
      'expiry', null))
$$;
create function pg_temp.res(p_vat text, p_name text, p_number text, p_lines jsonb)
  returns jsonb language sql as $$
  select jsonb_build_object(
    'header', jsonb_build_object('supplier_vat', p_vat, 'supplier_name', p_name,
      'number_raw', p_number, 'invoice_date', '2026-10-01', 'due_date', '2026-11-30',
      'payment_terms', '30 gg', 'net_total', 10, 'vat_total', 1, 'gross_total', 11),
    'lines', p_lines, 'gate_flags', jsonb_build_array(), 'totals_diff', 0,
    'field_confidence', jsonb_build_object(), 'extraction_json', jsonb_build_object())
$$;
create function pg_temp.complete(n int, p_result jsonb) returns text language sql as $$
  select public.extraction_complete(pg_temp.iid(n), pg_temp.tok(n), p_result, 'test-model')::text $$;
grant execute on function pg_temp.iid(int), pg_temp.tok(int), pg_temp.xl(text, text, text),
  pg_temp.res(text, text, text, jsonb), pg_temp.complete(int, jsonb) to service_role;

select pg_temp.mk(31);
select pg_temp.mk(32);
select pg_temp.mk(33);
select pg_temp.mk(34);
select pg_temp.mk(35);
select pg_temp.mk(36);
select pg_temp.mk(37, '22222222-2222-4222-8222-222222222222');
select pg_temp.mk(38);

-- Privileges.
select ok(has_function_privilege('service_role', 'app.automap_invoice(uuid)', 'execute'),
  'service_role can run auto-mapping');
select ok(not has_function_privilege('authenticated', 'app.automap_invoice(uuid)', 'execute')
      and not has_function_privilege('anon', 'app.automap_invoice(uuid)', 'execute'),
  'the API roles cannot run auto-mapping');
select ok(not has_function_privilege('authenticated', 'app.propagate_mapping(uuid)', 'execute')
      and not has_function_privilege('anon', 'app.propagate_mapping(uuid)', 'execute'),
  'the API roles cannot propagate mappings');

set local role service_role;

-- Invoice 31: a known supplier by VAT; nine lines.
select is(pg_temp.complete(31, pg_temp.res('IT12345678903', 'Fornitore Demo Srl', 'FT 1/2026',
  jsonb_build_array(
    pg_temp.xl('MAN-1', 'Manzo fesa', 'KG'),                -- 1 by code
    pg_temp.xl(null, 'Fesa di manzo', 'Kg.'),               -- 2 by description
    pg_temp.xl('ZZZ-9', ' FESA   di MANZO ', 'boh'),        -- 3 unknown code, known description
    pg_temp.xl('NEW-1', 'Prodotto nuovo', 'CT'),            -- 4 unknown
    pg_temp.xl('OLD-1', 'Vecchio articolo', null),          -- 5 inactive item
    pg_temp.xl('GHOST-1', 'Articolo fantasma', null),       -- 6 inactive ingredient
    pg_temp.xl('B-ONLY', 'Solo tenant B', null),            -- 7 tenant B's code
    pg_temp.xl(null, 'Olio', null),                         -- 8 item without invoice_unit
    pg_temp.xl('MAN-1', 'Manzo macinato', 'g')              -- 9 known code, a printed unit
  ))), 'review', 'the status outcome is unchanged: review');
reset role;

select is((select supplier_id from public.invoice where id = pg_temp.iid(31)),
  '5a000000-0000-4000-8000-00000000005a'::uuid, 'the supplier is linked by VAT, in the same tenant');
select is((select supplier_suggestion_id from public.invoice where id = pg_temp.iid(31)), null,
  'a VAT match leaves no suggestion');
create function pg_temp.line(n int, pos int) returns public.invoice_line language sql as $$
  select l from public.invoice_line l where l.invoice_id = pg_temp.iid(n) and l.position = pos $$;
select is((pg_temp.line(31, 1)).ingredient_id, '1a000000-0000-4000-8000-00000000001a'::uuid,
  'a known code maps to the ingredient (AT2)');
select is((pg_temp.line(31, 1)).supplier_item_id, '51000000-0000-4000-8000-000000000051'::uuid,
  'and to the supplier item');
select is((pg_temp.line(31, 1)).mapping_source, 'auto', 'the source is auto');
select is((pg_temp.line(31, 1)).suggested_ingredient_id, (pg_temp.line(31, 1)).ingredient_id,
  'the suggestion is stored as the correction baseline');
select is((pg_temp.line(31, 1)).suggested_supplier_item_id, (pg_temp.line(31, 1)).supplier_item_id,
  'including the suggested supplier item');
select is((pg_temp.line(31, 1)).corrected, false, 'an auto-mapped line is not corrected');
select is(app.line_corrected_fields(pg_temp.line(31, 1)), '{}',
  'and nothing in it differs from the baseline');
select is((pg_temp.line(31, 2)).ingredient_id, '1b000000-0000-4000-8000-00000000001b'::uuid,
  'a known description maps to the ingredient (AT2)');
select is((pg_temp.line(31, 2)).mapping_source, 'auto', 'by description, source auto');
select is((pg_temp.line(31, 3)).ingredient_id, '1b000000-0000-4000-8000-00000000001b'::uuid,
  'an unknown code with a known description is mapped by the description');
select is((pg_temp.line(31, 4)).ingredient_id, null, 'an unknown article stays unmapped');
select is((pg_temp.line(31, 4)).mapping_source, null, 'with no source');
select is((pg_temp.line(31, 5)).ingredient_id, null, 'an inactive item is not applied');
select is((pg_temp.line(31, 6)).ingredient_id, null, 'an item with an inactive ingredient is not applied');
select is((pg_temp.line(31, 7)).ingredient_id, null, 'tenant B''s item with another code is ignored');
select is((pg_temp.line(31, 8)).ingredient_id, '1c000000-0000-4000-8000-00000000001c'::uuid,
  'a one-word description maps');
select is((select count(*)::int from public.invoice_line
            where invoice_id = pg_temp.iid(31) and mapping_source = 'auto'), 5,
  'five of the nine lines are mapped');
select is((select count(*)::int from public.invoice_line
            where invoice_id = pg_temp.iid(31) and suggested_ingredient_id is not null
              and corrected), 0, 'none of them is corrected');

-- Units.
select is((pg_temp.line(31, 1)).unit, 'kg', 'unit KG is parsed');
select is((pg_temp.line(31, 1)).suggested_unit, 'kg', 'and stored as the suggested unit');
select is((pg_temp.line(31, 2)).unit, 'kg', 'unit Kg. is parsed');
select is((pg_temp.line(31, 3)).unit, 'kg',
  'an unknown printed unit takes the article''s remembered invoice unit');
select is((pg_temp.line(31, 3)).suggested_unit, 'kg', 'which is also the suggested unit');
select is((pg_temp.line(31, 4)).unit, 'conf', 'unit CT is parsed to conf on an unmapped line');
select is((pg_temp.line(31, 4)).suggested_unit, 'conf', 'with the suggestion');
select is((pg_temp.line(31, 5)).unit, null, 'a missing printed unit stays null');
select is((pg_temp.line(31, 8)).unit, null, 'an article with no remembered unit leaves it null');
select is((pg_temp.line(31, 9)).unit, 'g', 'a parsed unit wins over the remembered one');
select is((pg_temp.line(31, 9)).ingredient_id, '1a000000-0000-4000-8000-00000000001a'::uuid,
  'the line with a printed g is still mapped by its code');

-- Invoice 32: no VAT, one VAT-less supplier with the same normalised name -> a suggestion only.
set local role service_role;
select is(pg_temp.complete(32, pg_temp.res(null, '  ditta   DEMO ', 'N 1',
  jsonb_build_array(pg_temp.xl('D-1', 'Articolo della ditta', 'kg')))), 'review',
  'a name-only match still lands in review');
reset role;
select is((select supplier_id from public.invoice where id = pg_temp.iid(32)), null,
  'a name match does not link the supplier');
select is((select supplier_suggestion_id from public.invoice where id = pg_temp.iid(32)),
  '5c000000-0000-4000-8000-00000000005c'::uuid, 'but suggests it');
select is((pg_temp.line(32, 1)).ingredient_id, null, 'no line is mapped without a linked supplier');

-- Invoice 33: two VAT-less suppliers with the same normalised name -> no suggestion.
set local role service_role;
select pg_temp.complete(33, pg_temp.res(null, 'AMBIGUA', 'N 2',
  jsonb_build_array(pg_temp.xl('X', 'Qualcosa', 'kg'))));
reset role;
select is((select supplier_suggestion_id from public.invoice where id = pg_temp.iid(33)), null,
  'an ambiguous name gives no suggestion');

-- Invoice 34: a VAT nobody has. Invoice 35: the VAT of an inactive supplier.
set local role service_role;
select pg_temp.complete(34, pg_temp.res('IT99999999999', 'Sconosciuto', 'N 3',
  jsonb_build_array(pg_temp.xl('MAN-1', 'Manzo fesa', 'kg'))));
select pg_temp.complete(35, pg_temp.res('IT11111111115', 'Fornitore Spento', 'N 4',
  jsonb_build_array(pg_temp.xl('MAN-1', 'Manzo fesa', 'kg'))));
reset role;
select is((select supplier_id from public.invoice where id = pg_temp.iid(34)), null,
  'an unknown VAT links nothing');
select is((select supplier_id from public.invoice where id = pg_temp.iid(35)), null,
  'an inactive supplier is not linked');
select is((select count(*)::int from public.invoice_line
            where invoice_id in (pg_temp.iid(34), pg_temp.iid(35)) and ingredient_id is not null),
  0, 'and nothing is mapped');

-- Invoice 36: the same invoice as 31 -> duplicate, as before, and its lines are still mapped.
set local role service_role;
select is(pg_temp.complete(36, pg_temp.res('IT12345678903', 'Fornitore Demo Srl', 'FT 1/2026',
  jsonb_build_array(pg_temp.xl('MAN-1', 'Manzo fesa', 'kg')))), 'duplicate',
  'the duplicate decision is unchanged');
reset role;
select is((pg_temp.line(36, 1)).mapping_source, 'auto', 'a duplicate''s lines are mapped too');

-- Invoice 37 (tenant B): the same VAT and code map to B's own data only.
set local role service_role;
select pg_temp.complete(37, pg_temp.res('IT12345678903', 'Fornitore Demo Srl', 'FT 1/2026',
  jsonb_build_array(pg_temp.xl('MAN-1', 'Manzo fesa', 'kg'))));
reset role;
select is((select supplier_id from public.invoice where id = pg_temp.iid(37)),
  '5b000000-0000-4000-8000-00000000005b'::uuid, 'tenant B links its own supplier');
select is((pg_temp.line(37, 1)).ingredient_id, '1e000000-0000-4000-8000-00000000001e'::uuid,
  'and maps to its own ingredient, never tenant A''s');

-- An invoice that already has a linked supplier is not re-linked by auto-mapping.
update public.invoice set supplier_id = '50000000-0000-4000-8000-000000000050'
  where id = pg_temp.iid(38);
select is((select app.automap_invoice(pg_temp.iid(38))), 0, 'an invoice with no lines maps nothing');
select is((select supplier_id from public.invoice where id = pg_temp.iid(38)),
  '50000000-0000-4000-8000-000000000050'::uuid, 'a linked supplier is kept');

-- propagate_mapping: a new item reaches unmapped stock lines of other invoices in review.
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_qty,
    pack_unit, invoice_unit) values
  ('59000000-0000-4000-8000-000000000059', '11111111-1111-4111-8111-111111111111',
   '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 'NEW-1', 1, 'kg',
   'kg');
create function pg_temp.pinv(n int, p_status public.invoice_status, p_supplier uuid,
    p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns void language sql as $$
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id)
  values (pg_temp.iid(n), p_tenant, p_tenant || '/2026/' || pg_temp.iid(n) || '.pdf',
      'application/pdf', 100, p_status, p_supplier)
$$;
create function pg_temp.pline(n int, pos int, p_code text, p_extra text default '', p_vals text default '',
    p_desc text default 'Prodotto nuovo') returns void language plpgsql as $$
begin
  execute format($q$
    insert into public.invoice_line (tenant_id, invoice_id, position, raw_description, supplier_code,
        qty, line_amount, field_confidence, extracted %s)
    select i.tenant_id, i.id, %s, %L, %L, 1, 1, '{}', '{}' %s
      from public.invoice i where i.id = %L$q$,
    case when p_extra = '' then '' else ', ' || p_extra end, pos, p_desc, p_code,
    case when p_vals = '' then '' else ', ' || p_vals end, pg_temp.iid(n));
end
$$;
insert into public.cost_centre (id, tenant_id, name) values
  ('c5000000-0000-4000-8000-0000000000c5', '11111111-1111-4111-8111-111111111111', 'Pulizie');
select pg_temp.pinv(41, 'review', '5a000000-0000-4000-8000-00000000005a');    -- reached
select pg_temp.pinv(42, 'review', '5a000000-0000-4000-8000-00000000005a');    -- reached + untouched lines
select pg_temp.pinv(43, 'approved', '5a000000-0000-4000-8000-00000000005a');  -- not in review
select pg_temp.pinv(44, 'review', '50000000-0000-4000-8000-000000000050');    -- another supplier
select pg_temp.pinv(45, 'review', null);                                      -- no supplier linked
select pg_temp.pline(41, 1, 'NEW-1');
select pg_temp.pline(42, 1, 'NEW-1');
select pg_temp.pline(42, 2, 'NEW-1', 'is_stock, cost_centre_id', $$false, 'c5000000-0000-4000-8000-0000000000c5'$$);
select pg_temp.pline(43, 1, 'NEW-1');
select pg_temp.pline(44, 1, 'NEW-1');
select pg_temp.pline(45, 1, 'NEW-1');
select pg_temp.pline(42, 3, 'NEW-1', 'ingredient_id, mapping_source',
  $$'1b000000-0000-4000-8000-00000000001b', 'manual'$$);
select pg_temp.pline(42, 4, 'NEW-1', 'split_at', 'now()');
select pg_temp.pinv(46, 'review', '5a000000-0000-4000-8000-00000000005a');    -- hash vs code priority
select pg_temp.pline(46, 1, null, '', '', ' OLIO ');
select pg_temp.pline(46, 2, 'MAN-1', '', '', 'Olio');

select is(app.propagate_mapping('59000000-0000-4000-8000-000000000059'), 3,
  'a new code-keyed item reaches the unmapped stock lines of all the supplier''s invoices in review');
select is((pg_temp.line(31, 4)).ingredient_id, '1a000000-0000-4000-8000-00000000001a'::uuid,
  'including the unknown article of the invoice that was just extracted');
select is((pg_temp.line(41, 1)).ingredient_id, '1a000000-0000-4000-8000-00000000001a'::uuid,
  'the line in another review invoice is mapped');
select is((pg_temp.line(41, 1)).mapping_source, 'auto', 'as an auto mapping');
select is((pg_temp.line(41, 1)).suggested_supplier_item_id, '59000000-0000-4000-8000-000000000059'::uuid,
  'with the suggestion set');
select is((pg_temp.line(41, 1)).unit, 'kg', 'and the remembered unit applied');
select is((pg_temp.line(42, 1)).mapping_source, 'auto', 'a second invoice of the supplier is reached');
select is((pg_temp.line(42, 2)).ingredient_id, null, 'a non-stock line is not mapped');
select is((pg_temp.line(42, 3)).ingredient_id, '1b000000-0000-4000-8000-00000000001b'::uuid,
  'a line the reviewer already mapped keeps its mapping');
select is((pg_temp.line(42, 4)).ingredient_id, null, 'a split parent is not mapped');
select is((pg_temp.line(43, 1)).ingredient_id, null, 'an approved invoice is untouched');
select is((pg_temp.line(44, 1)).ingredient_id, null, 'another supplier''s invoice is untouched');
select is((pg_temp.line(45, 1)).ingredient_id, null, 'an invoice with no linked supplier is untouched');
select is(app.propagate_mapping('59000000-0000-4000-8000-000000000059'), 0,
  'propagating again maps nothing more');

select is(app.propagate_mapping('53000000-0000-4000-8000-000000000053'), 1,
  'a description-keyed item reaches the matching uncoded line only');
select is((pg_temp.line(46, 1)).ingredient_id, '1c000000-0000-4000-8000-00000000001c'::uuid,
  'the uncoded line is mapped by its description');
select is((pg_temp.line(46, 2)).ingredient_id, null,
  'a line whose own code has an item is left for that item (code wins)');
select is(app.propagate_mapping('51000000-0000-4000-8000-000000000051'), 1,
  'the code-keyed item then maps its line');
select is((pg_temp.line(46, 2)).ingredient_id, '1a000000-0000-4000-8000-00000000001a'::uuid,
  'to its own ingredient');

select * from finish();
rollback;
