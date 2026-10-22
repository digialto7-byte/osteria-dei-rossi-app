-- M5 step 4: approval helpers in schema app (M5 plan §3.3): require_invoice_approver,
-- venue_date, base_factor.
--
-- The two "vectors" blocks below (marked begin/end) are read by
-- tests/parity/approval-sql-parity.test.ts, which runs the same rows through toIngredientBase in
-- src/lib/units/convert.ts. Keep one row per line, names without apostrophes or commas.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('d0000000-0000-4000-8000-00000000000d', 'waiter-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Cuoco A'),
  ('d1000000-0000-4000-8000-00000000000d', '11111111-1111-4111-8111-111111111111',
   'd0000000-0000-4000-8000-00000000000d', 'waiter', 'Cameriere A'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin DigiAlto');

-- base_factor: base units per one line unit. Null when the unit cannot be converted.
create temporary table vec_factor (
  name text, unit text, base public.base_unit, pack_count numeric, pack_qty numeric,
  pack_unit public.measure_unit, expected numeric);
insert into vec_factor values
-- begin vectors: base_factor
('kg on kg', 'kg', 'kg', null, null, null, 1),
('g on kg', 'g', 'kg', null, null, null, 0.001),
('l on l', 'l', 'l', null, null, null, 1),
('ml on l', 'ml', 'l', null, null, null, 0.001),
('pz on pz', 'pz', 'pz', null, null, null, 1),
('pz on kg', 'pz', 'kg', null, null, null, null),
('kg on l', 'kg', 'l', null, null, null, null),
('g on pz', 'g', 'pz', null, null, null, null),
('conf of 6 x 1 kg on kg', 'conf', 'kg', 6, 1, 'kg', 6),
('conf of 4 x 500 g on kg', 'conf', 'kg', 4, 500, 'g', 2),
('conf of 2 x 12 pz on pz', 'conf', 'pz', 2, 12, 'pz', 24),
('conf of 3 x 750 ml on l', 'conf', 'l', 3, 750, 'ml', 2.25),
('conf of 6 x 1 kg on l', 'conf', 'l', 6, 1, 'kg', null),
('conf without a pack', 'conf', 'kg', null, null, null, null),
('null unit', null, 'kg', null, null, null, null)
-- end vectors: base_factor
;
select is_empty(
  $$ select name from vec_factor
      where app.base_factor(unit, base, pack_count, pack_qty, pack_unit) is distinct from expected $$,
  'base_factor gives the expected factor for every vector');
select cmp_ok((select count(*)::int from vec_factor), '>=', 10, 'the factor vectors are not vacuous');

-- Received quantity = round(qty x factor, 4), the rule of raw_lot_qty_ck and of toIngredientBase.
create temporary table vec_qty (
  name text, qty numeric, unit text, base public.base_unit, pack_count numeric, pack_qty numeric,
  pack_unit public.measure_unit, expected numeric);
insert into vec_qty values
-- begin vectors: base_qty
('1.25 g on kg', 1.25, 'g', 'kg', null, null, null, 0.0013),
('0.5 g on kg', 0.5, 'g', 'kg', null, null, null, 0.0005),
('0.05 g on kg tie rounds up', 0.05, 'g', 'kg', null, null, null, 0.0001),
('500 g on kg', 500, 'g', 'kg', null, null, null, 0.5),
('1.5 kg on kg', 1.5, 'kg', 'kg', null, null, null, 1.5),
('0 kg on kg', 0, 'kg', 'kg', null, null, null, 0),
('250 ml on l', 250, 'ml', 'l', null, null, null, 0.25),
('2 conf of 6 x 1 kg', 2, 'conf', 'kg', 6, 1, 'kg', 12),
('3 conf of 4 x 500 g', 3, 'conf', 'kg', 4, 500, 'g', 6),
('2 pz on kg is incompatible', 2, 'pz', 'kg', null, null, null, null),
('1 conf without a pack', 1, 'conf', 'kg', null, null, null, null)
-- end vectors: base_qty
;
select is_empty(
  $$ select name from vec_qty
      where round(qty * app.base_factor(unit, base, pack_count, pack_qty, pack_unit), 4)
            is distinct from expected $$,
  'round(qty x factor, 4) gives the expected base quantity for every vector');
select cmp_ok((select count(*)::int from vec_qty), '>=', 10, 'the quantity vectors are not vacuous');

select is(
  (select p.provolatile::text from pg_proc p where p.oid =
    'app.base_factor(text, public.base_unit, numeric, numeric, public.measure_unit)'::regprocedure),
  'i', 'base_factor is immutable');

-- venue_date: the calendar day at the venue. Europe/Rome is UTC+2 until 2026-10-25 03:00 local
-- (01:00Z), then UTC+1 until 2027-03-28 02:00 local (01:00Z), then UTC+2 again.
select is(app.venue_date('2026-10-24T21:59:59Z', 'Europe/Rome'), '2026-10-24'::date,
  'summer time: 23:59:59 local is still the 24th');
select is(app.venue_date('2026-10-24T22:00:00Z', 'Europe/Rome'), '2026-10-25'::date,
  'summer time: 00:00 local is the 25th');
select is(app.venue_date('2026-10-25T22:59:00Z', 'Europe/Rome'), '2026-10-25'::date,
  'winter time: 23:59 local is still the 25th');
select is(app.venue_date('2026-10-25T23:00:00Z', 'Europe/Rome'), '2026-10-26'::date,
  'winter time: 00:00 local is the 26th');
select is(app.venue_date('2027-03-28T21:59:00Z', 'Europe/Rome'), '2027-03-28'::date,
  'winter time: 22:59 local is still the 28th (before the spring change)');
select is(app.venue_date('2027-03-28T22:00:00Z', 'Europe/Rome'), '2027-03-29'::date,
  'summer time returns: 00:00 local is the 29th');
select is(app.venue_date('2026-10-24T22:00:00Z', 'UTC'), '2026-10-24'::date,
  'another zone gives its own day');

-- require_invoice_approver (the role comes from the app_user row, not from a claim alone).
create function pg_temp.act_as(auth_id uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', auth_id, 'role', 'authenticated',
    'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', app_role)::text, true)
$$;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'owner');
select lives_ok($$ select app.require_invoice_approver() $$, 'the owner may approve');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', 'admin');
select lives_ok($$ select app.require_invoice_approver() $$, 'the admin may approve');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', 'chef');
select throws_ok($$ select app.require_invoice_approver() $$, '42501', null, 'the chef may not approve');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', 'waiter');
select throws_ok($$ select app.require_invoice_approver() $$, '42501', null, 'the waiter may not approve');
select pg_temp.act_as('d0000000-0000-4000-8000-00000000000d', 'owner');
select throws_ok($$ select app.require_invoice_approver() $$, '42501', null,
  'a stale owner claim on a waiter is refused');
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select app.require_invoice_approver() $$, '42501', null, 'no session is refused');

select is_empty(
  $$ select p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
        and p.proname in ('require_invoice_approver', 'venue_date', 'base_factor')
        and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute')) $$,
  'no approval helper is executable by anon or authenticated');

select * from finish();
rollback;
