-- P2-0 F12 (docs/plans/2026-11-11-p2-0-golive-carryovers.md §3.1, step A2): `authenticated` cannot UPDATE the
-- mapping-memory columns of public.supplier_item (ingredient_id, description_hash) directly. They change only
-- through the review procedures (SECURITY DEFINER). The columns the supplier screen edits keep their grant.
-- The grant is held per column (no table-level UPDATE), so a column revoke is effective; the exact lists are pinned.
-- INSERT of description_hash is revoked too (a hash planted on a new article is a mapping); ingredient_id stays insertable
-- because creating an article on the supplier screen sets it. Sections: P privileges, D direct writes, I direct inserts,
-- R review procedures still work.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

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
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Vitello', 'kg');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo Srl', 'IT12345678903');
-- MAN-1 is already remembered (mapped to Manzo) and carries a description hash of its own.
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, description_hash,
    pack_qty, pack_unit, invoice_unit, last_price) values
  ('51000000-0000-4000-8000-000000000051', '11111111-1111-4111-8111-111111111111',
   '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 'MAN-1',
   repeat('b', 64), 1, 'kg', 'kg', 12.5);

-- One invoice in review with the supplier linked and three lines: MAN-1 (mapped), NEW-1 and no code.
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_id) values
  ('00000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/00000000-0000-4000-8000-000000000001.pdf',
   'application/pdf', 100, 'review', '5a000000-0000-4000-8000-00000000005a');
create function pg_temp.mk_line(n int, pos int, p_code text, p_desc text, p_extra text default '',
    p_vals text default '') returns void language plpgsql as $$
begin
  execute format($q$
    insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, supplier_code,
        qty, unit_raw, unit_price, line_amount, vat_rate, unit, suggested_unit, field_confidence,
        extracted %s)
    values (%L, '11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-000000000001', %s, %L, %L,
        2, 'kg', 12.75, 25.5, 10, 'kg', 'kg', '{}',
        jsonb_build_object('qty', 2, 'unit_price', 12.75, 'line_amount', 25.5, 'vat_rate', 10,
          'supplier_code', %L::text, 'lot_code', null, 'expiry', null) %s)$q$,
    case when p_extra = '' then '' else ', ' || p_extra end,
    ('a2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, pos, p_desc, p_code, p_code,
    case when p_vals = '' then '' else ', ' || p_vals end);
end
$$;
select pg_temp.mk_line(1, 1, 'MAN-1', 'Manzo macinato',
  'ingredient_id, supplier_item_id, suggested_ingredient_id, suggested_supplier_item_id, mapping_source',
  $$'1a000000-0000-4000-8000-00000000001a', '51000000-0000-4000-8000-000000000051',
    '1a000000-0000-4000-8000-00000000001a', '51000000-0000-4000-8000-000000000051', 'auto'$$);
select pg_temp.mk_line(2, 2, 'NEW-1', 'Prodotto nuovo');
select pg_temp.mk_line(3, 3, null, 'Fesa di manzo');

create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role)::text, true)
$$;
create function pg_temp.upd(p_line int, p_patch text) returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  perform public.review_update_line('00000000-0000-4000-8000-000000000001',
    ('a2000000-0000-4000-8000-' || lpad(p_line::text, 12, '0'))::uuid, p_patch::jsonb);
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end
$$;
-- The columns of supplier_item on which a role holds a privilege, in table order.
create function pg_temp.cols(p_role text, p_priv text) returns text language sql as $$
  select coalesce(string_agg(a.attname, ',' order by a.attnum), '')
    from pg_attribute a
   where a.attrelid = 'public.supplier_item'::regclass and a.attnum > 0 and not a.attisdropped
     and has_column_privilege(p_role, 'public.supplier_item', a.attname, p_priv) $$;
-- Rows changed by an UPDATE of an allowed column (0 when RLS hides the row).
create function pg_temp.relabel(p_label text) returns int language plpgsql as $$
declare n int;
begin
  update public.supplier_item set pack_label = p_label where id = '51000000-0000-4000-8000-000000000051';
  get diagnostics n = row_count;
  return n;
end
$$;
grant execute on function pg_temp.relabel(text), pg_temp.mk_line(int, int, text, text, text, text), pg_temp.act_as(uuid, uuid, text),
  pg_temp.upd(int, text), pg_temp.cols(text, text) to authenticated;

-- P: privileges --------------------------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'public.supplier_item', 'UPDATE'),
  'P1 authenticated holds no table-level UPDATE (a table-level grant would void a column revoke)');
select ok(not has_column_privilege('authenticated', 'public.supplier_item', 'ingredient_id', 'UPDATE'),
  'P2 authenticated cannot UPDATE ingredient_id');
select ok(not has_column_privilege('authenticated', 'public.supplier_item', 'description_hash', 'UPDATE'),
  'P3 authenticated cannot UPDATE description_hash');
select is(pg_temp.cols('authenticated', 'UPDATE'),
  'supplier_code,pack_count,pack_qty,pack_unit,pack_label,is_preferred,is_active',
  'P4 the exact UPDATE columns of authenticated are the supplier screen''s');
select is(pg_temp.cols('authenticated', 'INSERT'),
  'supplier_id,ingredient_id,supplier_code,pack_count,pack_qty,pack_unit,pack_label,is_preferred',
  'P5 the exact INSERT columns of authenticated: the eight left after the description_hash revoke (ingredient_id stays: create sets it)');
select ok(not has_column_privilege('authenticated', 'public.supplier_item', 'description_hash', 'INSERT'),
  'P5b authenticated cannot INSERT description_hash');
select ok(not has_column_privilege('authenticated', 'public.supplier_item', 'last_price', 'UPDATE')
      and not has_column_privilege('authenticated', 'public.supplier_item', 'invoice_unit', 'UPDATE')
      and not has_column_privilege('authenticated', 'public.supplier_item', 'tenant_id', 'UPDATE')
      and not has_column_privilege('authenticated', 'public.supplier_item', 'supplier_id', 'UPDATE'),
  'P6 last_price, invoice_unit, tenant_id and supplier_id stay out of reach of UPDATE');
select is(pg_temp.cols('anon', 'SELECT') || '|' || pg_temp.cols('anon', 'INSERT') || '|'
          || pg_temp.cols('anon', 'UPDATE'), '||', 'P7 anon holds no column privilege on supplier_item');
select ok(has_table_privilege('authenticated', 'public.supplier_item', 'SELECT')
      and not has_table_privilege('authenticated', 'public.supplier_item', 'DELETE'),
  'P8 authenticated can still read and still cannot delete');

-- D: direct writes -----------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select throws_ok($$update public.supplier_item set ingredient_id = '1b000000-0000-4000-8000-00000000001b'
    where id = '51000000-0000-4000-8000-000000000051'$$, '42501', null,
  'D1 owner: a direct UPDATE of ingredient_id is refused');
select throws_ok($$update public.supplier_item set description_hash = repeat('a', 64)
    where id = '51000000-0000-4000-8000-000000000051'$$, '42501', null,
  'D2 owner: a direct UPDATE of description_hash is refused');
select throws_ok($$update public.supplier_item set ingredient_id = '1b000000-0000-4000-8000-00000000001b',
    pack_label = 'cassa' where id = '51000000-0000-4000-8000-000000000051'$$, '42501', null,
  'D3 owner: a mapping column hidden among allowed ones is refused too');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select throws_ok($$update public.supplier_item set ingredient_id = '1b000000-0000-4000-8000-00000000001b'
    where id = '51000000-0000-4000-8000-000000000051'$$, '42501', null,
  'D4 admin: a direct UPDATE of ingredient_id is refused');
select throws_ok($$update public.supplier_item set description_hash = repeat('a', 64)
    where id = '51000000-0000-4000-8000-000000000051'$$, '42501', null,
  'D5 admin: a direct UPDATE of description_hash is refused');
-- Chef and waiter: refused as before (the privilege check comes first for the mapping columns; for an allowed column
-- the owner/admin-only policy leaves them no visible row).
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select throws_ok($$update public.supplier_item set ingredient_id = '1b000000-0000-4000-8000-00000000001b'
    where id = '51000000-0000-4000-8000-000000000051'$$, '42501', null,
  'D6 chef: a direct UPDATE of ingredient_id is refused');
select is(pg_temp.relabel('chef'), 0,
  'D7 chef: an UPDATE of an allowed column changes no row (RLS)');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select throws_ok($$update public.supplier_item set description_hash = repeat('a', 64)
    where id = '51000000-0000-4000-8000-000000000051'$$, '42501', null,
  'D8 waiter: a direct UPDATE of description_hash is refused');
select is(pg_temp.relabel('waiter'), 0,
  'D9 waiter: an UPDATE of an allowed column changes no row (RLS)');
reset role;
select is((select ingredient_id::text || '/' || description_hash || '/' || coalesce(pack_label, 'none')
             from public.supplier_item where id = '51000000-0000-4000-8000-000000000051'),
  '1a000000-0000-4000-8000-00000000001a/' || repeat('b', 64) || '/none',
  'D10 nothing changed: MAN-1 still means Manzo, with its hash and label');

-- The supplier screen's columns still work, as owner.
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select lives_ok($$update public.supplier_item set pack_label = 'cassa'
    where id = '51000000-0000-4000-8000-000000000051'$$, 'D11 owner: UPDATE of pack_label lives');
select lives_ok($$update public.supplier_item set is_active = false
    where id = '51000000-0000-4000-8000-000000000051'$$, 'D12 owner: UPDATE of is_active lives');
select lives_ok($$update public.supplier_item set is_active = true, supplier_code = 'MAN-1', pack_count = 1,
    pack_qty = 1, pack_unit = 'kg' where id = '51000000-0000-4000-8000-000000000051'$$,
  'D13 owner: UPDATE of is_active, supplier_code and the pack columns lives');
select lives_ok($$select public.set_preferred_supplier_item('51000000-0000-4000-8000-000000000051')$$,
  'D14 owner: set_preferred_supplier_item (SECURITY INVOKER, needs is_preferred) lives');
select is((select pack_label || '/' || is_active || '/' || is_preferred
             from public.supplier_item where id = '51000000-0000-4000-8000-000000000051'),
  'cassa/true/true', 'D15 and the allowed columns changed');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select lives_ok($$update public.supplier_item set pack_label = 'bancale'
    where id = '51000000-0000-4000-8000-000000000051'$$, 'D16 admin: UPDATE of pack_label lives');

-- I: direct INSERT -----------------------------------------------------------------------------------------
select throws_ok($$insert into public.supplier_item (supplier_id, ingredient_id, supplier_code,
    description_hash, pack_qty, pack_unit) values (
    '5a000000-0000-4000-8000-00000000005a', '1b000000-0000-4000-8000-00000000001b', 'HASH-1', repeat('c', 64),
    1, 'kg')$$, '42501', null, 'I1 admin: an INSERT that sets description_hash is refused');
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select throws_ok($$insert into public.supplier_item (supplier_id, ingredient_id, description_hash,
    pack_qty, pack_unit) values (
    '5a000000-0000-4000-8000-00000000005a', '1b000000-0000-4000-8000-00000000001b', repeat('c', 64), 1, 'kg')$$,
  '42501', null, 'I2 owner: an INSERT that sets description_hash is refused');
-- The create path of the supplier screen (createSupplierItem): these columns, and tenant_id from its default.
select lives_ok($$insert into public.supplier_item (supplier_id, ingredient_id, supplier_code, pack_count, pack_qty,
    pack_unit, pack_label) values ('5a000000-0000-4000-8000-00000000005a',
    '1b000000-0000-4000-8000-00000000001b', 'CREATE-1', 6, 1, 'kg', 'cassa')$$,
  'I3 owner: the normal create (as createSupplierItem sends it) still works');
select is((select ingredient_id::text || '/' || coalesce(description_hash, 'none') from public.supplier_item
            where supplier_code = 'CREATE-1'), '1b000000-0000-4000-8000-00000000001b/none',
  'I4 and it maps the article to its ingredient with no hash');
select lives_ok($$insert into public.supplier_item (supplier_id, ingredient_id, supplier_code, pack_qty, pack_unit,
    is_preferred) values ('5a000000-0000-4000-8000-00000000005a', '1b000000-0000-4000-8000-00000000001b',
    'CREATE-2', 1, 'kg', false)$$, 'I5 owner: a create that also sets is_preferred (granted) works');

-- R: the review procedures (SECURITY DEFINER) still set the mapping, as owner --------------------------------
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.upd(1, '{"ingredient_id": "1b000000-0000-4000-8000-00000000001b"}'), 'ok',
  'R1 review_update_line remaps the MAN-1 line to Vitello');
select is((select ingredient_id::text from public.supplier_item where id = '51000000-0000-4000-8000-000000000051'),
  '1b000000-0000-4000-8000-00000000001b', 'R2 the remembered article MAN-1 now means Vitello');
select is((select supplier_item_id::text from public.invoice_line where id = 'a2000000-0000-4000-8000-000000000001'),
  '51000000-0000-4000-8000-000000000051', 'R3 and the line still points at MAN-1');
select is(pg_temp.upd(2, '{"ingredient_id": "1a000000-0000-4000-8000-00000000001a"}'), 'ok',
  'R4 the NEW-1 line is mapped to Manzo');
select is((select count(*) from public.supplier_item where supplier_code = 'NEW-1'
              and ingredient_id = '1a000000-0000-4000-8000-00000000001a'), 1::bigint,
  'R5 exactly one new article with code NEW-1 was created');
select is(pg_temp.upd(3, '{"ingredient_id": "1a000000-0000-4000-8000-00000000001a"}'), 'ok',
  'R6 the line without a code is mapped to Manzo');
reset role;
select is((select count(*) from public.supplier_item where supplier_code is null
              and description_hash = app.description_hash('Fesa di manzo')), 1::bigint,
  'R7 an article keyed by app.description_hash(raw_description) was created');
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');
select is(pg_temp.upd(1, '{"pack": {"count": 2, "size": 5, "unit": "kg"}}'), 'ok',
  'R8 a pack change on a mapped line goes through the procedure');
reset role;
select is((select pack_count || 'x' || pack_qty || pack_unit from public.supplier_item
            where id = '51000000-0000-4000-8000-000000000051'), '2.0000x5.0000kg',
  'R9 and the article''s pack is updated');
-- Cross-tenant: owner B cannot reach tenant A's items through the procedure either.
set local role authenticated;
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select ok(pg_temp.upd(1, '{"ingredient_id": "1a000000-0000-4000-8000-00000000001a"}') like 'P0002%',
  'R10 owner B cannot remap tenant A''s line (not found)');
select is((select count(*) from public.supplier_item), 0::bigint, 'R11 owner B sees none of tenant A''s articles');
reset role;

select * from finish();
rollback;
