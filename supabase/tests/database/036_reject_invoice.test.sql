-- M5 step 7: public.reject_invoice (M5 plan §3.1.12, §3.3). Acts as owner A unless stated.
-- Covers AT7 (chef and waiter) at database level and the definer conditions: role first, empty
-- search_path, tenant of the invoice, execute for authenticated only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

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

create function pg_temp.iid(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
-- Invoices of supplier IT12345678903, number FT <n> unless told otherwise, dated 2026-09-29.
create function pg_temp.mk_inv(n int, p_status public.invoice_status default 'review',
    p_number text default null, p_dup_of uuid default null) returns void language sql as $$
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status,
      supplier_vat, supplier_name, number_raw, invoice_date, due_date, net_total, vat_total,
      gross_total, duplicate_of)
  values (pg_temp.iid(n), '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111/2026/' || pg_temp.iid(n) || '.pdf', 'application/pdf', 100,
      p_status, 'IT12345678903', 'Fornitore Demo Srl', coalesce(p_number, 'FT ' || n), '2026-09-29',
      '2026-10-31', 10, 1, 11, p_dup_of)
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
create function pg_temp.reject(n int, p_reason text default null) returns text language sql as $$
  select pg_temp.err(format('select public.reject_invoice(%L, %L)', pg_temp.iid(n), p_reason)) $$;
create function pg_temp.status(n int) returns text language sql as $$
  select status::text from public.invoice where id = pg_temp.iid(n) $$;
create function pg_temp.audit_count(n int) returns int language sql as $$
  select count(*)::int from public.audit_event where entity_id = pg_temp.iid(n) $$;
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
grant execute on function pg_temp.iid(int), pg_temp.act_as(uuid, uuid, text), pg_temp.err(text),
  pg_temp.reject(int, text), pg_temp.status(int), pg_temp.audit_count(int), pg_temp.snapshot(),
  pg_temp.written_since_snapshot() to authenticated;

-- 1, 2 share the key FT 1 (both live). 3: duplicate of 1. 4: reason with spaces. 5: blank reason.
-- 6: 201 characters. 7: 200 characters. 8: approved. 9: rejected. 10: extracting. 11: no reason.
-- 12: chef and waiter targets. 13: failed extraction.
select pg_temp.mk_inv(1);
select pg_temp.mk_inv(2, p_number => 'FT 1');
select pg_temp.mk_inv(3, 'duplicate', 'FT 3', pg_temp.iid(1));
select pg_temp.mk_inv(4);
select pg_temp.mk_inv(5);
select pg_temp.mk_inv(6);
select pg_temp.mk_inv(7);
select pg_temp.mk_inv(8, 'approved');
select pg_temp.mk_inv(9, 'rejected');
select pg_temp.mk_inv(10, 'extracting');
select pg_temp.mk_inv(11);
select pg_temp.mk_inv(12);
select pg_temp.mk_inv(13, 'extraction_failed');
select pg_temp.mk_inv(20);

select ok((select bool_and(has_function_privilege('authenticated', f, 'execute')
                           and not has_function_privilege('anon', f, 'execute')
                           and not has_function_privilege('service_role', f, 'execute')
                           and not has_function_privilege('public', f, 'execute'))
             from unnest(array['public.reject_invoice(uuid, text)']) f),
  'only authenticated can execute reject_invoice');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""']
             from pg_proc p where p.oid = 'public.reject_invoice(uuid, text)'::regprocedure),
  'reject_invoice is SECURITY DEFINER with an empty search_path');

set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner');

-- Reject from review.
select is(app.find_duplicate_invoice_in('11111111-1111-4111-8111-111111111111', 'IT12345678903', 'FT 1',
  '2026-09-29', pg_temp.iid(2)), pg_temp.iid(1), 'before: invoice 1 is the live invoice with the key of 2');
select pg_temp.snapshot();
select is(pg_temp.reject(4, '  Doppia consegna  '), 'ok', 'an invoice in review is rejected');
select is(pg_temp.written_since_snapshot(), array['audit_event', 'invoice'],
  'only the invoice and the audit are written: no ledger, no payable');
select is(pg_temp.status(4), 'rejected', 'the status is rejected');
select is((select action || ' ' || created_by || ' ' || reason || ' ' || (before ->> 'status') || ' ' || (after ->> 'status')
             from public.audit_event where entity_id = pg_temp.iid(4)),
  'invoice.rejected a1000000-0000-4000-8000-00000000000a Doppia consegna review rejected',
  'one audit row: who, the trimmed reason, status before and after');
select is(pg_temp.audit_count(4), 1, 'exactly one');
select is((select entity_type || ' ' || tenant_id from public.audit_event where entity_id = pg_temp.iid(4)),
  'invoice 11111111-1111-4111-8111-111111111111', 'an invoice event in the invoice''s tenant');

-- Reasons.
select is(pg_temp.reject(5, '   '), 'ok', 'a blank reason is accepted');
select is((select reason from public.audit_event where entity_id = pg_temp.iid(5)), null, 'and stored as null');
select is(pg_temp.reject(11), 'ok', 'no reason at all');
select is((select reason from public.audit_event where entity_id = pg_temp.iid(11)), null, 'is null');
select is(pg_temp.reject(6, repeat('x', 201)), 'P0001 invalid_request', '201 characters are refused');
select is(pg_temp.status(6), 'review', 'the status is unchanged');
select is(pg_temp.audit_count(6), 0, 'and nothing is audited');
select is(pg_temp.reject(6, repeat('x', 200) || '   '), 'ok', '200 characters (plus spaces) are accepted');
select is((select length(reason) from public.audit_event where entity_id = pg_temp.iid(6)), 200, 'stored in full');
select is(pg_temp.reject(7, repeat('x', 199) || ' y'), 'P0001 invalid_request',
  'spaces inside count: 199 + 1 + 1 characters are 201');

-- From duplicate; the key is free afterwards.
select is(pg_temp.reject(3, 'Già registrata'), 'ok', 'a duplicate is rejected');
select is(pg_temp.status(3), 'rejected', 'the status is rejected');
select is(pg_temp.reject(1), 'ok', 'the live invoice with the key is rejected');
select is(app.find_duplicate_invoice_in('11111111-1111-4111-8111-111111111111', 'IT12345678903', 'FT 1',
  '2026-09-29', pg_temp.iid(2)), null, 'a rejected invoice leaves the duplicate check: the document can come again');

-- Other statuses.
select is(pg_temp.reject(8), 'P0001 invoice_already_approved', 'an approved invoice cannot be rejected');
select is(pg_temp.reject(9), 'P0001 invoice_rejected', 'a rejected one cannot be rejected again');
select is(pg_temp.reject(10), 'P0001 invoice_not_in_review', 'an invoice being read');
select is(pg_temp.reject(13), 'P0001 invoice_not_in_review', 'or one whose reading failed');
select is((pg_temp.audit_count(8) + pg_temp.audit_count(9) + pg_temp.audit_count(10) + pg_temp.audit_count(13)), 0,
  'none of them is audited');
select is(pg_temp.status(8) || ' ' || pg_temp.status(9) || ' ' || pg_temp.status(10) || ' ' || pg_temp.status(13),
  'approved rejected extracting extraction_failed', 'and none changes');
select is(pg_temp.reject(99), 'P0002 not_found', 'an unknown invoice');

-- A rejected invoice is final: its lines are frozen and no status leads out of rejected.
select is(pg_temp.err(format('select public.reject_invoice(%L)', pg_temp.iid(4))), 'P0001 invoice_rejected',
  'rejecting again changes nothing');
select is(pg_temp.audit_count(4), 1, 'and adds no audit row');

-- Admin.
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111', 'admin');
select is(pg_temp.reject(12, 'Merce non conforme'), 'ok', 'an admin may reject');
select is((select created_by from public.audit_event where entity_id = pg_temp.iid(12)),
  'f1000000-0000-4000-8000-00000000000f'::uuid, 'and is named in the audit');

-- AT7: roles (invoice 20, in review, is the target).
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111', 'chef');
select is(pg_temp.reject(20), '42501 insufficient_privilege', 'AT7: the chef may not reject');
select is(pg_temp.reject(99), '42501 insufficient_privilege', 'the role is checked before the invoice is looked up');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111', 'waiter');
select is(pg_temp.reject(20), '42501 insufficient_privilege', 'AT7: the waiter may not reject');
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
select is(pg_temp.reject(20), 'P0002 not_found', 'owner B cannot reject A''s invoice');
select is(pg_temp.reject(8), 'P0002 not_found', 'nor learn that another tenant''s invoice is approved');
reset role;
select is(pg_temp.status(20), 'review', 'A''s invoice is untouched');
select is(pg_temp.audit_count(20), 0, 'and not audited');
set local role anon;
select is(pg_temp.err(format('select public.reject_invoice(%L)', pg_temp.iid(20))),
  '42501 permission denied for function reject_invoice', 'anon has no execute');
reset role;

-- The invoice cannot leave rejected, whoever asks (the guard of M2).
select is(pg_temp.err(format('update public.invoice set status = %L where id = %L', 'review', pg_temp.iid(4))),
  'P0001 invalid_status_transition', 'rejected is final');

select * from finish();
rollback;
