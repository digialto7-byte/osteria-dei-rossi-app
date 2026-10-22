-- M5 code-review fix, round 4 (migration 20261022141000_clear_duplicate_partner.sql): review_clear_duplicate(invoice,
-- partner) declares exactly the named pair. A repeat is a no-op, a stale partner is refused, the old one-argument
-- function is gone. Acts as owner A unless stated.
begin;
create extension if not exists pgtap with schema extensions;
select plan(72);

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
-- The partner the screen would send: the first duplicate blocker's partnerId in the approval preview. A caller
-- the preview refuses (chef, waiter, another tenant) sends none, so the procedure's own answer is tested.
create function pg_temp.partner(n int) returns uuid language sql as $$
  select (public.invoice_approval_preview(pg_temp.iid(n)) -> 'blockers' -> 0 ->> 'partnerId')::uuid $$;
create function pg_temp.clear_with(n int, p_partner uuid) returns text language sql as $$
  select pg_temp.err(format('select public.review_clear_duplicate(%L, %L)', pg_temp.iid(n), p_partner)) $$;
create function pg_temp.clear(n int) returns text language plpgsql as $$
declare
  v_partner uuid;
begin
  begin
    v_partner := pg_temp.partner(n);
  exception when others then
    v_partner := null;
  end;
  return pg_temp.clear_with(n, v_partner);
end
$$;
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

-- What a refused request must leave alone: the invoice row, and the number of decision and audit rows.
create temporary table state_snap (inv jsonb, decisions int, audits int);
grant select, insert, delete on state_snap to authenticated;
create function pg_temp.state_now(n int) returns state_snap language sql as $$
  select to_jsonb(i), (select count(*)::int from public.invoice_duplicate_decision),
         (select count(*)::int from public.audit_event)
    from public.invoice i where i.id = pg_temp.iid(n) $$;
create function pg_temp.snapshot_state(n int) returns void language sql as $$
  with gone as (delete from state_snap)
  insert into state_snap select * from pg_temp.state_now(n) $$;
create function pg_temp.state_unchanged(n int) returns boolean language sql as $$
  select (select s from state_snap s limit 1) is not distinct from (select r from pg_temp.state_now(n) r)
$$;

-- Fixtures (n = invoice number; num = the document number, same number = same document).
-- A. The X/Y/W repro: X = 211, Y = 212, W = 213, no VAT, one name, FT 60; Y and W warn of X.
select pg_temp.mk(211, 60, p_vat => null);
select pg_temp.mk(212, 60, p_vat => null, p_warn_of => 211);
select pg_temp.mk(213, 60, p_vat => null, p_warn_of => 211);
-- B. Stale partners: 221 and 222 are one document (FT 61, VAT); 223 has another number (FT 62), 224 is a copy of
-- 222 that is already a duplicate; 225 is approved; the same document also exists in tenant B (below).
select pg_temp.mk(221, 61);
select pg_temp.mk(222, 61);
select pg_temp.mk(223, 62);
select pg_temp.mk(224, 61, p_dup_of => 221);
select pg_temp.mk(225, 63);
-- C. A VAT duplicate (status duplicate) with a live original: 241, 242 (FT 64); and one whose original has since
-- been rejected: 251, 252 (FT 65).
select pg_temp.mk(241, 64);
select pg_temp.mk(242, 64, p_dup_of => 241);
select pg_temp.mk(251, 65);
select pg_temp.mk(252, 65, p_dup_of => 251);
-- D. A pair declared and then its partner rejected: 261, 262 (FT 66, no VAT).
select pg_temp.mk(261, 66, p_vat => null);
select pg_temp.mk(262, 66, p_vat => null, p_warn_of => 261);
-- E. A copy in tenant B with the key of 211/212/213 (name FT 60) and of 221 (FT 61).
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status, supplier_vat,
    supplier_name, number_raw, invoice_date)
  values ('b2000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222',
          '22222222-2222-4222-8222-222222222222/2026/b2000000-0000-4000-8000-0000000000b1.pdf', 'application/pdf', 100, 'review',
          'IT12345678903', 'Fornitore Demo Srl', 'FT 61', '2026-09-29'),
         ('b2000000-0000-4000-8000-0000000000b2', '22222222-2222-4222-8222-222222222222',
          '22222222-2222-4222-8222-222222222222/2026/b2000000-0000-4000-8000-0000000000b2.pdf', 'application/pdf', 100, 'review',
          'IT12345678903', 'Fornitore Demo Srl', 'FT 61', '2026-09-29');
update public.invoice set status = 'approved' where id = pg_temp.iid(225);

-- The signature: one function of two uuids, the old one-argument function is gone.
select hasnt_function('public', 'review_clear_duplicate', array['uuid'], 'the one-argument function is dropped');
select has_function('public', 'review_clear_duplicate', array['uuid', 'uuid'], 'review_clear_duplicate(invoice, partner) exists');
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace
            and proname = 'review_clear_duplicate'), 1, 'and it is the only one');
select is((select prosecdef from pg_proc where oid = 'public.review_clear_duplicate(uuid, uuid)'::regprocedure), true,
  'it is a definer function');
select is((select proconfig from pg_proc where oid = 'public.review_clear_duplicate(uuid, uuid)'::regprocedure),
  array['search_path=""'], 'with an empty search_path');
select is((select count(*)::int from unnest(array['anon', 'service_role']) r
           where has_function_privilege(r, 'public.review_clear_duplicate(uuid, uuid)', 'execute')), 0,
  'anon and service_role cannot execute it');
select is(has_function_privilege('authenticated', 'public.review_clear_duplicate(uuid, uuid)', 'execute'), true,
  'authenticated can');

-- The finders agree with the named-pair predicate, over every invoice of the fixtures.
select is((select count(*)::int from public.invoice i
            where app.undeclared_look_alike(i.id) is not null
              and not app.is_undeclared_look_alike(i.id, app.undeclared_look_alike(i.id))), 0,
  'the first undeclared look-alike is an undeclared look-alike by the named-pair predicate');
select is((select count(*)::int from public.invoice i
            where app.undeclared_look_alike(i.id) is null
              and exists (select 1 from public.invoice o where o.id <> i.id
                           and app.is_undeclared_look_alike(i.id, o.id))), 0,
  'and an invoice with no first look-alike has none by the predicate either');
select is((select string_agg(right(o.id::text, 3), ',' order by o.id) from public.invoice o
            where app.is_undeclared_look_alike(pg_temp.iid(211), o.id)), '212,213',
  'predicate: X is a look-alike of Y and W only (not of the other documents, not of tenant B)');
select is(app.is_undeclared_look_alike(pg_temp.iid(221), 'b2000000-0000-4000-8000-0000000000b1'), false,
  'predicate: a copy in another tenant is not a look-alike');
select is(app.is_undeclared_look_alike(pg_temp.iid(211), pg_temp.iid(211)), false, 'predicate: nor is the invoice itself');
select is(app.is_undeclared_look_alike(pg_temp.iid(221), null), false, 'predicate: nor null');

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');

-- The screen's partner is in the preview: the first undeclared look-alike (created_at, id).
select is(pg_temp.partner(212), pg_temp.iid(211), 'preview: Y names X');
select is(pg_temp.partner(211), pg_temp.iid(212), 'preview: X names Y');
select is(pg_temp.partner(242), pg_temp.iid(241), 'preview: a status duplicate names its original');

-- A. The X/Y/W repro (Y = 212, W = 213, both warn of X = 211).
select is(pg_temp.clear_with(212, pg_temp.iid(211)), 'ok', 'A: Y is declared not a duplicate of X');
select is(pg_temp.pairs(212, 211), 1, 'A: the pair Y/X is recorded');
select is((pg_temp.inv(212)).duplicate_warning_of, pg_temp.iid(213), 'A: Y is re-pointed to W');
select is(pg_temp.clear_with(212, pg_temp.iid(211)), 'ok', 'A: the same request again (a double tap, a retry) succeeds');
select is(pg_temp.pairs(212, 211), 1, 'A: and still exactly one pair row');
select is(pg_temp.pairs(212, 213), 0, 'A: Y is NOT declared against W, which the owner never saw');
select is((select count(*)::int from public.invoice_duplicate_decision
            where invoice_id in (pg_temp.iid(211), pg_temp.iid(212), pg_temp.iid(213))), 1, 'A: one decision row in all');
select is((select count(*)::int from public.audit_event where entity_id = pg_temp.iid(212)), 1,
  'A: and one audit row: the repeat wrote nothing');
select is((pg_temp.inv(212)).duplicate_warning_of, pg_temp.iid(213), 'A: Y still warns of W after the repeat');
select is(pg_temp.clear_with(211, pg_temp.iid(212)), 'ok', 'A: the same pair from the other side is a no-op too');
select is(pg_temp.pairs(212, 211), 1, 'A: still one pair row');
select is(pg_temp.codes(213), '["duplicate_warning"]'::jsonb, 'A: W is still blocked');
select is(pg_temp.approve(213), 'P0001 duplicate_warning', 'A: W cannot be approved');
select is(pg_temp.clear_with(213, pg_temp.iid(211)), 'ok', 'A: W is declared not a duplicate of X (its own, explicit request)');
select is(pg_temp.codes(213), '["duplicate_warning"]'::jsonb, 'A: W is still blocked, by Y');
select is(pg_temp.codes(212), '["duplicate_warning"]'::jsonb, 'A: and so is Y, by W');
select is(pg_temp.approve(212) || ' ' || pg_temp.approve(213), 'P0001 duplicate_warning P0001 duplicate_warning',
  'A: neither Y nor W can be approved');
select is(pg_temp.clear_with(212, pg_temp.iid(213)), 'ok', 'A: only the explicit (Y, W) declaration releases them');
select is(pg_temp.pairs(212, 213), 1, 'A: now the pair Y/W is recorded');
select is(pg_temp.codes(211) || pg_temp.codes(212) || pg_temp.codes(213), '[]'::jsonb, 'A: nobody is blocked');
select is(pg_temp.approve(211) || ' ' || pg_temp.approve(212) || ' ' || pg_temp.approve(213), 'ok ok ok',
  'A: the owner declared all three pairs: three approvals');

-- B. Stale partners are refused and change nothing (222 is a live copy of 221; 223, 224, 225 are not).
select pg_temp.snapshot_state(222);
select is(pg_temp.clear_with(222, pg_temp.iid(223)), 'P0001 not_flagged', 'B: a partner with another number is refused');
select is(pg_temp.clear_with(222, pg_temp.iid(224)), 'P0001 not_flagged', 'B: a partner that is already a duplicate is not live: refused');
select is(pg_temp.clear_with(222, pg_temp.iid(225)), 'P0001 not_flagged', 'B: an approved invoice with another key is refused');
select is(pg_temp.clear_with(222, pg_temp.iid(222)), 'P0001 not_flagged', 'B: the invoice itself is refused');
select is(pg_temp.clear_with(222, 'b2000000-0000-4000-8000-0000000000b1'), 'P0001 not_flagged',
  'B: a look-alike in another tenant is refused');
select is(pg_temp.clear_with(222, 'ffffffff-ffff-4fff-8fff-ffffffffffff'), 'P0001 not_flagged', 'B: an unknown id is refused');
select is(pg_temp.clear_with(222, null), 'P0001 not_flagged', 'B: no partner is refused');
select is(pg_temp.state_unchanged(222), true, 'B: refusals wrote no row, no audit and changed no column');
select is(pg_temp.reject(221), 'ok', 'B: the partner is rejected meanwhile (it is no longer live)');
select pg_temp.snapshot_state(222);
select is(pg_temp.clear_with(222, pg_temp.iid(221)), 'P0001 not_flagged', 'B: a partner that was rejected since is refused');
select is(pg_temp.state_unchanged(222), true, 'B: and nothing changed');
select is(pg_temp.codes(222), '[]'::jsonb, 'B: 222 is no longer blocked (nothing live to declare)');
select is(pg_temp.clear_with(225, pg_temp.iid(222)), 'P0001 not_flagged', 'B: an approved invoice has nothing to clear');

-- C. A status duplicate: the screen sends the original named by the preview.
select is(pg_temp.status(242) || ' ' || pg_temp.partner(242)::text, 'duplicate ' || pg_temp.iid(241)::text,
  'C: the preview of a duplicate names its original');
select is(pg_temp.clear_with(242, pg_temp.iid(241)), 'ok', 'C: the duplicate is declared not a duplicate of it');
select is(pg_temp.status(242), 'review', 'C: and is back in review');
select is(pg_temp.clear_with(242, pg_temp.iid(241)), 'ok', 'C: a repeat is a no-op');
select is(pg_temp.status(242), 'review', 'C: still in review');
select is(pg_temp.pairs(241, 242), 1, 'C: one pair');
select is(pg_temp.status(252) || ' ' || pg_temp.partner(252)::text, 'duplicate ' || pg_temp.iid(251)::text,
  'C: another duplicate names its original');
select is(pg_temp.reject(251), 'ok', 'C: its original is rejected');
select is(pg_temp.partner(252), null, 'C: the preview names no partner any more');
select is(pg_temp.codes(252), '["duplicate_invoice"]'::jsonb, 'C: but the duplicate is still blocked');
select is(pg_temp.clear_with(252, pg_temp.iid(251)), 'P0001 not_flagged', 'C: and declaring the rejected original is refused');
select is(pg_temp.status(252), 'duplicate', 'C: the status is unchanged');

-- D. A pair that was declared stays declared when the partner is rejected: a repeat is still a no-op.
select is(pg_temp.clear_with(262, pg_temp.iid(261)), 'ok', 'D: the pair is declared');
select is(pg_temp.reject(261), 'ok', 'D: the partner is rejected');
select is(pg_temp.clear_with(262, pg_temp.iid(261)), 'ok', 'D: a repeat still answers ok');
select is(pg_temp.pairs(261, 262), 1, 'D: with one row');

-- Tenant isolation and roles.
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.clear_with(222, pg_temp.iid(223)), 'P0002 not_found', 'owner B cannot clear tenant A''s invoice');
select is(pg_temp.err(format('select public.review_clear_duplicate(%L, %L)', 'b2000000-0000-4000-8000-0000000000b1', pg_temp.iid(222))),
  'P0001 not_flagged', 'owner B cannot declare tenant A''s invoice as a partner of his own');
select is(pg_temp.err(format('select public.review_clear_duplicate(%L, %L)', 'b2000000-0000-4000-8000-0000000000b1',
  'b2000000-0000-4000-8000-0000000000b2')), 'ok', 'owner B can declare his own pair');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.clear_with(242, pg_temp.iid(241)), '42501 insufficient_privilege', 'the chef cannot clear');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.clear_with(242, pg_temp.iid(241)), '42501 insufficient_privilege', 'the waiter cannot clear');
reset role;
set local role anon;
select throws_ok(format('select public.review_clear_duplicate(%L, %L)', pg_temp.iid(242), pg_temp.iid(241)),
  '42501', null, 'anon cannot execute it');

select * from finish();
rollback;
