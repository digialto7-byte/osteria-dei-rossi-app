-- SP1 step 5 (docs/plans/2026-11-15-sp01-tenant-config.md §3.1.2, §3.1.4, §3.2, §5 step 5; AT1 shape for the codes): public.tenant_close_code, the two helpers
-- app.tenant_receipt_types / app.tenant_payment_types, the re-created seed function and the backfill. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

insert into auth.users (id, email) values
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
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
create function pg_temp.act_as(auth_id uuid, tenant uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated', 'tenant_id', tenant, 'app_role', app_role, 'aal', 'aal1')::text, true)
$$;

insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');

-- The first test of the step: the seed gives a new tenant today's codes, in catalogue order.
select is((select string_agg(kind || ':' || code || '@' || position, ',' order by kind, position) from public.tenant_close_code where tenant_id = '11111111-1111-4111-8111-111111111111'),
  'payment:cash@1,payment:card@2,payment:other@3,receipt:scontrino@1,receipt:fattura@2',
  'a new tenant gets receipt codes [scontrino, fattura] and payment codes [cash, card, other] in that order');
select is((select count(*)::int from public.tenant_close_code where tenant_id = '11111111-1111-4111-8111-111111111111' and is_active), 5, 'all five are active');
select is(app.tenant_receipt_types('11111111-1111-4111-8111-111111111111'), array['scontrino', 'fattura'], 'app.tenant_receipt_types(A) is [scontrino, fattura]');
select is(app.tenant_payment_types('11111111-1111-4111-8111-111111111111'), array['cash', 'card', 'other'], 'app.tenant_payment_types(A) is [cash, card, other]');
select is(app.tenant_receipt_types('11111111-1111-4111-8111-111111111111'), app.receipt_types(), 'and they equal the catalogue lists today (receipt)');
select is(app.tenant_payment_types('11111111-1111-4111-8111-111111111111'), app.payment_type_codes(), 'and (payment)');
select is(app.tenant_receipt_types('99999999-9999-4999-8999-999999999999'), '{}'::text[], 'an unknown tenant has an empty receipt list');
select is(app.tenant_payment_types('99999999-9999-4999-8999-999999999999'), '{}'::text[], 'and an empty payment list');

-- B chooses: fattura first, scontrino off; card only (positions as the owner's order).
update public.tenant_close_code set is_active = false where tenant_id = '22222222-2222-4222-8222-222222222222' and kind = 'receipt' and code = 'scontrino';
select is(app.tenant_receipt_types('22222222-2222-4222-8222-222222222222'), array['fattura'], 'tenant_receipt_types(B) skips an inactive code');
update public.tenant_close_code set is_active = true, position = 2 where tenant_id = '22222222-2222-4222-8222-222222222222' and kind = 'receipt' and code = 'scontrino';
update public.tenant_close_code set position = 1 where tenant_id = '22222222-2222-4222-8222-222222222222' and kind = 'receipt' and code = 'fattura';
select is(app.tenant_receipt_types('22222222-2222-4222-8222-222222222222'), array['fattura', 'scontrino'], 'tenant_receipt_types(B) follows position, not the catalogue order');
update public.tenant_close_code set position = 3 where tenant_id = '22222222-2222-4222-8222-222222222222' and kind = 'payment' and code = 'cash';
update public.tenant_close_code set position = 1 where tenant_id = '22222222-2222-4222-8222-222222222222' and kind = 'payment' and code = 'other';
update public.tenant_close_code set position = 2, is_active = false where tenant_id = '22222222-2222-4222-8222-222222222222' and kind = 'payment' and code = 'card';
select is(app.tenant_payment_types('22222222-2222-4222-8222-222222222222'), array['other', 'cash'], 'tenant_payment_types(B) follows position and skips the inactive card');
select is(app.tenant_payment_types('11111111-1111-4111-8111-111111111111'), array['cash', 'card', 'other'], 'and tenant A is not touched');
select is(pg_typeof(app.tenant_receipt_types('22222222-2222-4222-8222-222222222222'))::text, 'text[]', 'the helpers return text[]');

-- The table: the catalogue bound, the shape, one row per code.
select is(left(pg_temp.err($$insert into public.tenant_close_code (tenant_id, kind, code, position) values ('11111111-1111-4111-8111-111111111111', 'receipt', 'bonifico', 3)$$), 5), '23514',
  'a receipt code outside the catalogue: 23514');
select is(left(pg_temp.err($$insert into public.tenant_close_code (tenant_id, kind, code, position) values ('11111111-1111-4111-8111-111111111111', 'payment', 'scontrino', 4)$$), 5), '23514',
  'a receipt code under kind payment: 23514 (the catalogue is per kind)');
select is(left(pg_temp.err($$insert into public.tenant_close_code (tenant_id, kind, code, position) values ('11111111-1111-4111-8111-111111111111', 'other', 'cash', 4)$$), 5), '23514', 'a kind other than receipt or payment: 23514');
select is(pg_temp.err($$insert into public.tenant_close_code (tenant_id, kind, code, position) values ('11111111-1111-4111-8111-111111111111', 'payment', 'cash', 4)$$),
  '23505 duplicate key value violates unique constraint "tenant_close_code_pkey"', 'one row per tenant, kind and code');
select is(left(pg_temp.err($$update public.tenant_close_code set position = 0 where tenant_id = '11111111-1111-4111-8111-111111111111' and kind = 'payment' and code = 'cash'$$), 5), '23514', 'a position below 1: 23514');
select is(left(pg_temp.err($$update public.tenant_close_code set position = 21 where tenant_id = '11111111-1111-4111-8111-111111111111' and kind = 'payment' and code = 'cash'$$), 5), '23514', 'and above 20: 23514');
select is(left(pg_temp.err($$insert into public.tenant_close_code (tenant_id, kind, code, position) values ('99999999-9999-4999-8999-999999999999', 'payment', 'cash', 4)$$), 5), '23503', 'a code for an unknown tenant: 23503');
select is((select pg_get_constraintdef(oid) from pg_constraint where conname = 'tenant_close_code_updated_by_fkey' and conrelid = 'public.tenant_close_code'::regclass),
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'tenant_vat_rate_updated_by_fkey' and conrelid = 'public.tenant_vat_rate'::regclass),
  'updated_by is the same composite key as tenant_vat_rate''s: on delete set null (updated_by), so the demo purge keeps the row');
select ok((select pg_get_constraintdef(oid) like '%ON DELETE SET NULL (updated_by)' from pg_constraint where conname = 'tenant_close_code_updated_by_fkey' and conrelid = 'public.tenant_close_code'::regclass),
  'and that is ON DELETE SET NULL (updated_by)');

-- Seed and backfill are idempotent and complete.
select is((select count(*)::int from public.tenant t where (select count(*) from public.tenant_close_code c where c.tenant_id = t.id) <> 5), 0, 'every tenant of the database holds exactly five code rows (the backfill and the seed)');
delete from public.tenant_close_code where tenant_id = '11111111-1111-4111-8111-111111111111';
select is(app.tenant_receipt_types('11111111-1111-4111-8111-111111111111'), '{}'::text[], 'deleting A''s rows (as table owner) leaves an empty list');
-- The migration's backfill statement, run again: it restores A and leaves B's choices alone (on conflict do nothing).
insert into public.tenant_close_code (tenant_id, kind, code, position)
  select t.id, 'receipt', r.code, r.ord from public.tenant t cross join unnest(app.receipt_types()) with ordinality r (code, ord)
on conflict do nothing;
insert into public.tenant_close_code (tenant_id, kind, code, position)
  select t.id, 'payment', p.code, p.ord from public.tenant t cross join unnest(app.payment_type_codes()) with ordinality p (code, ord)
on conflict do nothing;
select is(app.tenant_payment_types('11111111-1111-4111-8111-111111111111'), array['cash', 'card', 'other'], 'the backfill restores A in catalogue order');
select is(app.tenant_payment_types('22222222-2222-4222-8222-222222222222'), array['other', 'cash'], 'and leaves B''s choices as they were');
insert into public.tenant (id, name, vat_number) values ('33333333-3333-4333-8333-333333333333', 'Osteria Demo C', 'IT22222222228');
select is((select count(*)::int from public.tenant_close_code where tenant_id = '33333333-3333-4333-8333-333333333333' and is_active), 5, 'a tenant created later gets five active codes');
select is((select count(*)::int from public.tenant_vat_rate where tenant_id = '33333333-3333-4333-8333-333333333333' and is_active), 5, 'and still its five VAT rates (the re-created seed function keeps step 3''s part)');

-- RLS, grants, function ACLs.
select pg_temp.act_as('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'owner');
set local role authenticated;
select is((select count(*)::int from public.tenant_close_code), 5, 'B''s owner reads B''s five code rows and no other tenant''s');
select is(left(pg_temp.err($$update public.tenant_close_code set is_active = false where tenant_id = '22222222-2222-4222-8222-222222222222'$$), 5), '42501', 'no API role updates tenant_close_code');
reset role;
select is((select bool_or(has_table_privilege(r, 'public.tenant_close_code', p)) from unnest(array['anon', 'authenticated', 'service_role']) r,
            unnest(array['insert', 'update', 'delete', 'truncate']) p), false, 'no write grant to anon, authenticated or service_role');
select is((select string_agg(polname || ':' || polcmd::text, ',') from pg_policy where polrelid = 'public.tenant_close_code'::regclass), 'tenant_close_code_select:r', 'one policy, select only');
select ok((select relrowsecurity from pg_class where oid = 'public.tenant_close_code'::regclass), 'row level security is on');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('tenant_receipt_types', 'tenant_payment_types', 'seed_tenant_settings')
              and p.prosecdef and p.proconfig = array['search_path=""']
              and not exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, p.oid, 'execute'))), 3,
  'the helpers and the seed function are definers with an empty search_path, closed to every API role');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('tenant_receipt_types', 'tenant_payment_types') and p.provolatile = 's'), 2, 'the two helpers are stable');

select * from finish();
rollback;
