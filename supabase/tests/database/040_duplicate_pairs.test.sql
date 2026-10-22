-- M5 code-review fix, round 3 (migration 20261022140900_duplicate_pairs.sql): a duplicate decision is a
-- row per pair (public.invoice_duplicate_decision), both gates recompute the undeclared look-alikes, and
-- clearing a match re-points the warning to the next undeclared look-alike. Acts as owner A unless stated.
begin;
create extension if not exists pgtap with schema extensions;
select plan(82);

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
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo', 'kg');
insert into public.supplier (id, tenant_id, name, vat_number, payment_terms_days) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo Srl', 'IT12345678903', 30);
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_count,
    pack_qty, pack_unit, invoice_unit) values
  ('51000000-0000-4000-8000-000000000051', '11111111-1111-4111-8111-111111111111',
   '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 'MAN-1', 1, 1, 'kg', 'kg');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella');

create function pg_temp.iid(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.lid(n int) returns uuid language sql immutable as $$
  select ('a2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
-- An approvable invoice n with document number 'FT <num>' (same number = same document), one 2 kg line of
-- 10,00 and consistent totals. p_vat null makes it a no-VAT invoice (name key); p_dup_of makes it status
-- duplicate, p_warn_of gives it a name-match warning. created_at follows n, so a lower n is "older".
create function pg_temp.mk(n int, num int, p_vat text default 'IT12345678903', p_dup_of int default null,
    p_warn_of int default null) returns void language plpgsql as $$
begin
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status,
      supplier_vat, supplier_name, number_raw, invoice_date, due_date, net_total, vat_total,
      gross_total, supplier_id, duplicate_of, duplicate_warning_of, created_at)
  values (pg_temp.iid(n), '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111/2026/' || pg_temp.iid(n) || '.pdf', 'application/pdf', 100,
      case when p_dup_of is null then 'review' else 'duplicate' end::public.invoice_status,
      p_vat, 'Fornitore Demo Srl', 'FT ' || num, '2026-09-29', '2026-10-31', 10, 1, 11,
      '5a000000-0000-4000-8000-00000000005a'::uuid,
      case when p_dup_of is not null then pg_temp.iid(p_dup_of) end,
      case when p_warn_of is not null then pg_temp.iid(p_warn_of) end,
      now() - interval '1 day' + n * interval '1 second');
  insert into public.invoice_line (id, tenant_id, invoice_id, position, raw_description, qty,
      line_amount, vat_rate, unit, ingredient_id, supplier_item_id, mapping_source, is_stock,
      field_confidence, extracted)
  values (pg_temp.lid(n), '11111111-1111-4111-8111-111111111111', pg_temp.iid(n), 1, 'Manzo', 2, 10, 10,
      'kg', '1a000000-0000-4000-8000-00000000001a', '51000000-0000-4000-8000-000000000051', 'manual',
      true, '{}', '{}');
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
create function pg_temp.approve(n int) returns text language sql as $$
  select pg_temp.err(format('select public.approve_invoice(%L)', pg_temp.iid(n))) $$;
create function pg_temp.clear(n int) returns text language sql as $$
  select pg_temp.err(format('select public.review_clear_duplicate(%L)', pg_temp.iid(n))) $$;
create function pg_temp.header(n int, patch text) returns text language sql as $$
  select pg_temp.err(format('select public.review_update_header(%L, %L::jsonb)', pg_temp.iid(n), patch)) $$;
create function pg_temp.codes(n int) returns jsonb language sql as $$
  select jsonb_path_query_array(public.invoice_approval_preview(pg_temp.iid(n)) -> 'blockers', '$[*].code') $$;
create function pg_temp.status(n int) returns text language sql as $$
  select status::text from public.invoice where id = pg_temp.iid(n) $$;
create function pg_temp.inv(n int) returns public.invoice language sql as $$
  select i from public.invoice i where i.id = pg_temp.iid(n) $$;

create function pg_temp.reject(n int) returns text language sql as $$
  select pg_temp.err(format('select public.reject_invoice(%L)', pg_temp.iid(n))) $$;
create function pg_temp.pairs(a int, b int) returns int language sql as $$
  select count(*)::int from public.invoice_duplicate_decision d
   where (d.invoice_id, d.other_id) in ((pg_temp.iid(a), pg_temp.iid(b)), (pg_temp.iid(b), pg_temp.iid(a))) $$;
create function pg_temp.payables(variadic ns int[]) returns int language sql as $$
  select count(*)::int from public.payable p where p.invoice_id in (select pg_temp.iid(n) from unnest(ns) n) $$;

-- Fixtures (n = invoice number; num = the document number, same number = same document).
-- A. Name triple (the founder's repro): X = 111, Y = 112, W = 113, no VAT, one name, FT 40; Y and W warn of X.
select pg_temp.mk(111, 40, p_vat => null);
select pg_temp.mk(112, 40, p_vat => null, p_warn_of => 111);
select pg_temp.mk(113, 40, p_vat => null, p_warn_of => 111);
-- B. The same triple with the owner declaring Y != W as well: 121, 122, 123 (FT 41).
select pg_temp.mk(121, 41, p_vat => null);
select pg_temp.mk(122, 41, p_vat => null, p_warn_of => 121);
select pg_temp.mk(123, 41, p_vat => null, p_warn_of => 121);
-- C. VAT re-key (round 2): X = 131 (FT 130), Z = 132 (FT 199), Y = 133 is a copy of X misread as FT 199.
select pg_temp.mk(131, 130);
select pg_temp.mk(132, 199);
select pg_temp.mk(133, 199, p_dup_of => 132);
-- D. Round 1: original 141 and copy 142 (FT 140); 151 and 152 (FT 150), approved copy first; a third copy:
-- 161 original, 162 its copy (a duplicate), 163 another copy nobody has looked at (in review), FT 160.
select pg_temp.mk(141, 140);
select pg_temp.mk(142, 140, p_dup_of => 141);
select pg_temp.mk(151, 150);
select pg_temp.mk(152, 150, p_dup_of => 151);
select pg_temp.mk(161, 160);
select pg_temp.mk(162, 160, p_dup_of => 161);
select pg_temp.mk(163, 160);
-- E. M4-cleared invoices: a flag and no partner. VAT pair 171/172 (FT 170), name pair 173/174 (FT 171).
select pg_temp.mk(171, 170);
select pg_temp.mk(172, 170);
select pg_temp.mk(173, 171, p_vat => null);
select pg_temp.mk(174, 171, p_vat => null);
update public.invoice set duplicate_override = true, duplicate_override_by = 'a1000000-0000-4000-8000-00000000000a',
       duplicate_override_at = now() where id in (pg_temp.iid(172), pg_temp.iid(174));
-- F. Re-pointing order: 181 < 182 < 183 < 184 (FT 180, no VAT); 184 warns of 181.
select pg_temp.mk(181, 180, p_vat => null);
select pg_temp.mk(182, 180, p_vat => null);
select pg_temp.mk(183, 180, p_vat => null);
select pg_temp.mk(184, 180, p_vat => null, p_warn_of => 181);
-- G. Scratch invoices for the table tests (a pair 192/193 is inserted by hand): 191, 192 (duplicate of 191), 193.
select pg_temp.mk(191, 190);
select pg_temp.mk(192, 190, p_dup_of => 191);
select pg_temp.mk(193, 190);

-- The table: shape, privileges, append-only. The table is written by the definer procedures alone.
select has_table('public', 'invoice_duplicate_decision', 'the pair table exists');
select col_not_null('public', 'invoice_duplicate_decision', 'tenant_id', 'it carries tenant_id');
select col_not_null('public', 'invoice_duplicate_decision', 'decided_by', 'decided_by is mandatory');
select is((select relrowsecurity from pg_class where oid = 'public.invoice_duplicate_decision'::regclass), true,
  'row level security is on');
select is((select count(*)::int from pg_policies where schemaname = 'public'
            and tablename = 'invoice_duplicate_decision'), 1, 'one policy');
select is((select string_agg(roles::text || cmd, ',') from pg_policies where schemaname = 'public'
            and tablename = 'invoice_duplicate_decision'), '{authenticated}SELECT', 'and it is a SELECT policy');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r,
            unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
           where has_table_privilege(r, 'public.invoice_duplicate_decision', p)), 0,
  'anon, authenticated and service_role have no INSERT, UPDATE, DELETE or TRUNCATE');
select is((select count(*)::int from unnest(array['anon', 'service_role']) r
           where has_table_privilege(r, 'public.invoice_duplicate_decision', 'SELECT')), 0,
  'anon and service_role cannot read it');
select is(has_table_privilege('authenticated', 'public.invoice_duplicate_decision', 'SELECT'), true,
  'authenticated has SELECT (the policy narrows it)');
select throws_ok(format('insert into public.invoice_duplicate_decision (tenant_id, invoice_id, other_id, decided_by) values (%L, %L, %L, %L)',
    '11111111-1111-4111-8111-111111111111', pg_temp.iid(191), pg_temp.iid(191), 'a1000000-0000-4000-8000-00000000000a'),
  '23514', null, 'a pair cannot name one invoice twice');
insert into public.invoice_duplicate_decision (tenant_id, invoice_id, other_id, decided_by)
  values ('11111111-1111-4111-8111-111111111111', pg_temp.iid(192), pg_temp.iid(193),
          'a1000000-0000-4000-8000-00000000000a');
select throws_ok(format('insert into public.invoice_duplicate_decision (tenant_id, invoice_id, other_id, decided_by) values (%L, %L, %L, %L)',
    '11111111-1111-4111-8111-111111111111', pg_temp.iid(193), pg_temp.iid(192), 'a1000000-0000-4000-8000-00000000000a'),
  '23505', null, 'a pair is unique whichever way round it is written');
select throws_ok(format('insert into public.invoice_duplicate_decision (tenant_id, invoice_id, other_id, decided_by) values (%L, %L, %L, %L)',
    '22222222-2222-4222-8222-222222222222', pg_temp.iid(191), pg_temp.iid(193), 'b1000000-0000-4000-8000-00000000000b'),
  '23503', null, 'a pair across tenants is refused by the composite foreign keys');
select throws_ok(format('update public.invoice_duplicate_decision set decided_by = %L', 'c1000000-0000-4000-8000-00000000000c'),
  'P0001', 'append_only', 'UPDATE raises append_only even for the migration owner');
select throws_ok('delete from public.invoice_duplicate_decision', 'P0001', 'append_only', 'DELETE raises append_only');
select throws_ok('truncate public.invoice_duplicate_decision cascade', 'P0001', 'append_only', 'TRUNCATE raises append_only');

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');

-- The API roles cannot write the table.
select throws_ok(format('insert into public.invoice_duplicate_decision (tenant_id, invoice_id, other_id, decided_by) values (%L, %L, %L, %L)',
    '11111111-1111-4111-8111-111111111111', pg_temp.iid(191), pg_temp.iid(193), 'a1000000-0000-4000-8000-00000000000a'),
  '42501', null, 'the owner cannot insert a decision directly');

-- A. The founder's repro: Y and W both warn of X; clearing each against X must not release Y against W.
select is(pg_temp.codes(111), '["duplicate_warning"]'::jsonb, 'A: X is blocked by its look-alikes (recomputed, not stored)');
select is(pg_temp.codes(112) || pg_temp.codes(113), '["duplicate_warning","duplicate_warning"]'::jsonb, 'A: Y and W are blocked');
select is(pg_temp.clear(112), 'ok', 'A: Y is declared not a duplicate of X');
select is((pg_temp.inv(112)).duplicate_warning_of, pg_temp.iid(113), 'A: Y''s warning is re-pointed to W');
select is(pg_temp.pairs(112, 111), 1, 'A: the pair Y/X is recorded');
select is(pg_temp.clear(113), 'ok', 'A: W is declared not a duplicate of X');
select is((pg_temp.inv(113)).duplicate_warning_of, pg_temp.iid(112), 'A: W''s warning is re-pointed to Y');
select is(pg_temp.codes(111), '[]'::jsonb, 'A: X is approvable now');
select is(pg_temp.codes(112) || pg_temp.codes(113), '["duplicate_warning","duplicate_warning"]'::jsonb,
  'A: Y and W are still blocked by each other');
select is(pg_temp.approve(111), 'ok', 'A: X is approved');
select is(pg_temp.approve(112), 'P0001 duplicate_warning', 'A: Y cannot be approved');
select is(pg_temp.approve(113), 'P0001 duplicate_warning', 'A: W cannot be approved');
select is(pg_temp.reject(113), 'ok', 'A: the owner sees they are one document and rejects W');
select is(pg_temp.approve(112), 'ok', 'A: Y is approved');
select is(pg_temp.payables(111, 112, 113), 2, 'A: X, and one payable for the Y/W document');

-- B. Declaring Y != W too lets both go.
select is(pg_temp.clear(122) || ' ' || pg_temp.clear(123), 'ok ok', 'B: Y and W are each declared not a duplicate of X');
select is(pg_temp.clear(122), 'ok', 'B: and Y is declared not a duplicate of W (the re-pointed warning)');
select is((pg_temp.inv(122)).duplicate_warning_of, null, 'B: Y has no warning left');
select is(pg_temp.codes(121) || pg_temp.codes(122) || pg_temp.codes(123), '[]'::jsonb, 'B: nobody is blocked');
select is(pg_temp.approve(121) || ' ' || pg_temp.approve(122) || ' ' || pg_temp.approve(123), 'ok ok ok',
  'B: all three are approved');
select is(pg_temp.pairs(121, 122) + pg_temp.pairs(121, 123) + pg_temp.pairs(122, 123), 3, 'B: three pairs are recorded');
select is(pg_temp.clear(122), 'P0001 not_flagged', 'B: nothing is left to clear');

-- C. The VAT re-key repro of round 2 still blocks.
select is(pg_temp.clear(133), 'ok', 'C: Y is declared not a duplicate of Z');
select is(pg_temp.header(133, '{"number_raw": "FT 130"}'), 'ok', 'C: Y is corrected to the number of X');
select is(pg_temp.status(133) || ' ' || (pg_temp.inv(133)).duplicate_of::text, 'duplicate ' || pg_temp.iid(131)::text,
  'C: Y is a duplicate of X');
select is(pg_temp.approve(133), 'P0001 duplicate_invoice', 'C: Y cannot be approved');
select is(pg_temp.approve(131), 'ok', 'C: X can');
select is(pg_temp.payables(131, 133), 1, 'C: one payable for the document');

-- D. Round 1 cases.
select is(pg_temp.clear(142), 'ok', 'D: the copy is declared not a duplicate');
select is(pg_temp.status(142) || ' ' || coalesce((pg_temp.inv(142)).duplicate_of::text, '-'), 'review -', 'D: it is back in review');
select is(pg_temp.approve(141), 'ok', 'D: the original is approvable after its copy was cleared');
select is(pg_temp.approve(142), 'ok', 'D: and so is the copy');
select is(pg_temp.clear(152), 'ok', 'D: second pair: the copy is cleared');
select is(pg_temp.approve(152), 'ok', 'D: the copy first');
select is(pg_temp.approve(151), 'ok', 'D: then the original');
select is(pg_temp.clear(162), 'ok', 'D: third copy: 162 is cleared against 161');
select is(pg_temp.status(162) || ' ' || (pg_temp.inv(162)).duplicate_of::text, 'duplicate ' || pg_temp.iid(163)::text,
  'D: and 162 stays a duplicate, now of 163 (the next undeclared look-alike)');
select is(pg_temp.codes(161), '["duplicate_invoice"]'::jsonb, 'D: the uncleared third copy blocks the original');
select is(pg_temp.approve(163), 'P0001 duplicate_invoice', 'D: and blocks itself');
select is(pg_temp.approve(162), 'P0001 duplicate_invoice', 'D: and the cleared copy');

-- E. M4-cleared invoices (flag, no partner) are blocked and can be resolved.
select is(pg_temp.codes(171) || pg_temp.codes(172), '["duplicate_invoice","duplicate_invoice"]'::jsonb, 'E: VAT pair: both are blocked');
select is(pg_temp.codes(173) || pg_temp.codes(174), '["duplicate_warning","duplicate_warning"]'::jsonb, 'E: name pair: both are blocked');
select is(pg_temp.clear(172), 'ok', 'E: the flagged invoice (status review, no stored partner) can be cleared');
select is(pg_temp.pairs(171, 172), 1, 'E: the pair is recorded');
select is(pg_temp.approve(171) || ' ' || pg_temp.approve(172), 'ok ok', 'E: VAT pair: both are approved');
select is(pg_temp.clear(174), 'ok', 'E: name pair: cleared');
select is(pg_temp.approve(174) || ' ' || pg_temp.approve(173), 'ok ok', 'E: name pair: both are approved');

-- F. Re-pointing is deterministic: created_at, then id.
select is(pg_temp.clear(184), 'ok', 'F: 184 is cleared against 181');
select is((pg_temp.inv(184)).duplicate_warning_of, pg_temp.iid(182), 'F: and warns of 182');
select is((select after ->> 'duplicate_override_of' from public.audit_event
            where entity_id = pg_temp.iid(184) order by created_at desc, id desc limit 1), pg_temp.iid(181)::text,
  'F: the audit row names the cleared pair');
select is(pg_temp.clear(184), 'ok', 'F: cleared against 182');
select is((pg_temp.inv(184)).duplicate_warning_of, pg_temp.iid(183), 'F: and warns of 183');
select is(pg_temp.clear(184), 'ok', 'F: cleared against 183');
select is((pg_temp.inv(184)).duplicate_warning_of, null, 'F: no warning left');
select is(pg_temp.codes(184), '[]'::jsonb, 'F: and 184 is no longer blocked');

-- Decisions are visible to the owner only, within the tenant.
select is((select count(*)::int from public.invoice_duplicate_decision where decided_by = 'a1000000-0000-4000-8000-00000000000a'),
  (select count(*)::int from public.invoice_duplicate_decision), 'owner A reads the decisions, all by A');
select ok((select count(*) from public.invoice_duplicate_decision) > 10, 'and there are some');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is((select count(*)::int from public.invoice_duplicate_decision), 0, 'owner B sees none of tenant A''s decisions');
select is(pg_temp.clear(191), 'P0002 not_found', 'owner B cannot clear tenant A''s invoice');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is((select count(*)::int from public.invoice_duplicate_decision), 0, 'the chef reads nothing');
select is(pg_temp.clear(192), '42501 insufficient_privilege', 'the chef cannot clear');
select throws_ok(format('insert into public.invoice_duplicate_decision (tenant_id, invoice_id, other_id, decided_by) values (%L, %L, %L, %L)',
    '11111111-1111-4111-8111-111111111111', pg_temp.iid(191), pg_temp.iid(193), 'c1000000-0000-4000-8000-00000000000c'),
  '42501', null, 'the chef cannot write');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is((select count(*)::int from public.invoice_duplicate_decision), 0, 'the waiter reads nothing');
select is(pg_temp.clear(192), '42501 insufficient_privilege', 'the waiter cannot clear');
reset role;
set local role anon;
select throws_ok('select count(*) from public.invoice_duplicate_decision', '42501', null, 'anon cannot read it');
select throws_ok(format('insert into public.invoice_duplicate_decision (tenant_id, invoice_id, other_id, decided_by) values (%L, %L, %L, %L)',
    '11111111-1111-4111-8111-111111111111', pg_temp.iid(191), pg_temp.iid(193), 'a1000000-0000-4000-8000-00000000000a'),
  '42501', null, 'anon cannot write it');

select * from finish();
rollback;

