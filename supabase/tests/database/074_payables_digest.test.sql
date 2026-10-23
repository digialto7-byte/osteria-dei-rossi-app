-- M9 step 11: the weekly digest (AT3, as an in-app alert: founder decision of 2026-10-23). One alert per tenant
-- per ISO week, deduplicated on the ISO Monday (Europe/Rome), listing the unpaid payables (open, scheduled,
-- disputed) grouped by supplier; owner only. A fake clock throughout.
-- Tenant A: supplier X (2 payables, one overdue), supplier Y (1). Tenant B: a paid payable and a fully credited (0,00 EUR) open one.
-- Tenant C: 40 suppliers with 80-character names.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('c0000000-0000-4000-8000-00000000000c', 'chef-a@example.test'),
  ('f0000000-0000-4000-8000-00000000000f', 'admin-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test'),
  ('e0000000-0000-4000-8000-00000000000e', 'owner-c@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115'),
  ('33333333-3333-4333-8333-333333333333', 'Osteria Demo C', 'IT22222222220');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('c1000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-00000000000c', 'chef', 'Chef Demo'),
  ('f1000000-0000-4000-8000-00000000000f', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-00000000000f', 'admin', 'Admin Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B'),
  ('e1000000-0000-4000-8000-00000000000e', '33333333-3333-4333-8333-333333333333',
   'e0000000-0000-4000-8000-00000000000e', 'owner', 'Titolare C');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Srl', 'IT12345678903'),
  ('5b000000-0000-4000-8000-00000000005b', '11111111-1111-4111-8111-111111111111', 'Fornitore Demo Due', 'IT01234567897'),
  ('5c000000-0000-4000-8000-00000000005c', '22222222-2222-4222-8222-222222222222', 'Fornitore B Srl', 'IT00000000000');
insert into public.supplier (id, tenant_id, name, vat_number)
select ('5d' || lpad(n::text, 6, '0') || '-0000-4000-8000-000000000000')::uuid,
       '33333333-3333-4333-8333-333333333333', repeat(chr(65 + n % 26), 79) || n % 10, null
  from generate_series(1, 40) n;

create function pg_temp.id(prefix text, n int) returns uuid language sql as $$
  select (prefix || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.mk(n int, tenant uuid, supplier uuid, due date, status text, gross numeric) returns void
  language plpgsql as $$
begin
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, number_raw, invoice_date)
  values (pg_temp.id('e0000000', n), tenant, tenant || '/2026/' || pg_temp.id('e0000000', n) || '.pdf',
          'application/pdf', 2048, 'FT ' || n, '2026-10-01');
  insert into public.payable (id, tenant_id, invoice_id, supplier_id, gross_amount, credited_amount, amount,
                              due_date, due_date_source, status, paid_at, paid_on, created_by)
  values (pg_temp.id('90000000', n), tenant, pg_temp.id('e0000000', n), supplier, gross, 0, gross, due, 'invoice',
          status::public.payable_status, case when status = 'paid' then now() end,
          case when status = 'paid' then due end,
          (select u.id from public.app_user u where u.tenant_id = mk.tenant limit 1));
end
$$;
-- The tenant-A digests as the sorted list of their business dates.
create function pg_temp.digest_dates(tenant uuid default '11111111-1111-4111-8111-111111111111') returns text
  language sql as $$
  select coalesce(string_agg(business_date::text, ' ' order by business_date), '-')
    from public.alert where kind = 'payables_weekly_digest' and tenant_id = tenant
$$;

-- X: 100,00 overdue (due 10-20) and 250,50 (due 11-15). Y: 80,00 scheduled (due 11-20). Z: disputed 20,00.
select pg_temp.mk(1, '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '2026-10-20', 'open', 100);
select pg_temp.mk(2, '11111111-1111-4111-8111-111111111111', '5a000000-0000-4000-8000-00000000005a', '2026-11-15', 'disputed', 250.50);
select pg_temp.mk(3, '11111111-1111-4111-8111-111111111111', '5b000000-0000-4000-8000-00000000005b', '2026-11-20', 'scheduled', 80);
select pg_temp.mk(4, '11111111-1111-4111-8111-111111111111', '5b000000-0000-4000-8000-00000000005b', '2026-09-01', 'paid', 999);
select pg_temp.mk(5, '22222222-2222-4222-8222-222222222222', '5c000000-0000-4000-8000-00000000005c', '2026-10-01', 'paid', 77);
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, number_raw, invoice_date)
values (pg_temp.id('e0000000', 6), '22222222-2222-4222-8222-222222222222',
        '22222222-2222-4222-8222-222222222222/2026/' || pg_temp.id('e0000000', 6) || '.pdf',
        'application/pdf', 2048, 'FT 6', '2026-10-01');
insert into public.payable (id, tenant_id, invoice_id, supplier_id, gross_amount, credited_amount, amount, due_date, due_date_source, created_by)
values (pg_temp.id('90000000', 6), '22222222-2222-4222-8222-222222222222', pg_temp.id('e0000000', 6),
        '5c000000-0000-4000-8000-00000000005c', 40, 40, 0, '2026-10-05', 'invoice',
        'b1000000-0000-4000-8000-00000000000b');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, number_raw, invoice_date)
select pg_temp.id('e0000000', 100 + n), '33333333-3333-4333-8333-333333333333',
       '33333333-3333-4333-8333-333333333333/2026/' || pg_temp.id('e0000000', 100 + n) || '.pdf',
       'application/pdf', 2048, 'FT ' || (100 + n), '2026-10-01'
  from generate_series(1, 40) n;
insert into public.payable (id, tenant_id, invoice_id, supplier_id, gross_amount, credited_amount, amount, due_date, due_date_source, created_by)
select pg_temp.id('90000000', 100 + n), '33333333-3333-4333-8333-333333333333', pg_temp.id('e0000000', 100 + n),
       ('5d' || lpad(n::text, 6, '0') || '-0000-4000-8000-000000000000')::uuid, 10 + n, 0, 10 + n,
       '2030-01-01'::date + n, 'invoice', 'e1000000-0000-4000-8000-00000000000e'
  from generate_series(1, 40) n;

-- T1: the ISO week across the Sunday night; AT3: one digest per week ----------------------------------------------
select app.run_alert_rules('2026-10-25T22:59:59Z');
select is(pg_temp.digest_dates(), '2026-10-19', 'Sun 10-25 23:59:59 Rome: the digest of the week of Monday 10-19');
select app.run_alert_rules('2026-10-25T23:00Z');
select is(pg_temp.digest_dates(), '2026-10-19 2026-10-26', 'Mon 10-26 00:00 Rome: a new digest, dated Monday 10-26');
select app.run_alert_rules(g) from generate_series('2026-10-26T00:00Z'::timestamptz, '2026-11-01T22:00Z', '1 hour') g;
select app.run_alert_rules('2026-11-01T22:59:59Z');
select is(pg_temp.digest_dates(), '2026-10-19 2026-10-26', 'hourly runs until Sun 11-01 23:59:59 Rome: still one for the week');
select app.run_alert_rules('2026-11-01T23:00Z');
select is(pg_temp.digest_dates(), '2026-10-19 2026-10-26 2026-11-02', 'Mon 11-02 00:00 Rome: the next week''s digest');

-- The content: grouped by supplier, owner only ------------------------------------------------------------------------
select is((select count(*)::int from public.alert where kind = 'payables_weekly_digest'
            and tenant_id = '11111111-1111-4111-8111-111111111111' and business_date = '2026-10-26'
            and entity_type = 'tenant' and entity_id = '11111111-1111-4111-8111-111111111111'
            and audience_roles = '{owner}' and cost_bearing), 1,
  'entity tenant/tenant id, audience owner, cost-bearing');
select is((select payload ->> 'week_start_date' || ' ' || (payload ->> 'as_of_date') from public.alert
            where kind = 'payables_weekly_digest' and business_date = '2026-10-26'
              and tenant_id = '11111111-1111-4111-8111-111111111111'),
  '2026-10-26 2026-10-26', 'week_start_date and as_of_date are the run''s Monday');
select is((select (payload ->> 'payables_count') || '/' || (payload ->> 'suppliers_count') || '/' || (payload ->> 'suppliers_listed')
                  || '/' || (payload ->> 'amount_eur') || '/' || (payload ->> 'overdue_count') || '/'
                  || (payload ->> 'overdue_amount_eur') from public.alert
            where kind = 'payables_weekly_digest' and business_date = '2026-10-26'
              and tenant_id = '11111111-1111-4111-8111-111111111111'),
  '3/2/2/430.50/1/100.00', 'open, scheduled and disputed counted (not the paid one); one overdue of 100,00');
select is((select (payload -> 'suppliers' -> 0) ->> 'supplier_name' || '|' || ((payload -> 'suppliers' -> 0) ->> 'payables_count')
                  || '|' || ((payload -> 'suppliers' -> 0) ->> 'amount_eur') || '|' || ((payload -> 'suppliers' -> 0) ->> 'overdue_count')
                  || '|' || ((payload -> 'suppliers' -> 0) ->> 'next_due_date') from public.alert
            where kind = 'payables_weekly_digest' and business_date = '2026-10-26'
              and tenant_id = '11111111-1111-4111-8111-111111111111'),
  'Fornitore Demo Srl|2|350.50|1|2026-10-20', 'first supplier (earliest due date): count, amount, overdue, next due');
select is((select (payload -> 'suppliers' -> 1) ->> 'supplier_name' || '|' || ((payload -> 'suppliers' -> 1) ->> 'payables_count')
                  || '|' || ((payload -> 'suppliers' -> 1) ->> 'amount_eur') || '|' || ((payload -> 'suppliers' -> 1) ->> 'overdue_count')
             from public.alert where kind = 'payables_weekly_digest' and business_date = '2026-10-26'
              and tenant_id = '11111111-1111-4111-8111-111111111111'),
  'Fornitore Demo Due|1|80.00|0', 'second supplier');

-- Spring and year end ------------------------------------------------------------------------------------------------------
select app.run_alert_rules('2027-03-28T21:59:59Z');
select app.run_alert_rules('2027-03-28T22:00Z');
select is((select string_agg(business_date::text, ' ' order by business_date) from public.alert
            where kind = 'payables_weekly_digest' and tenant_id = '11111111-1111-4111-8111-111111111111'
              and business_date >= '2027-03-01'),
  '2027-03-22 2027-03-29', 'Sun 2027-03-28 23:59:59 CEST: the week of 03-22; 00:00 on 03-29: the week of 03-29');
select app.run_alert_rules('2026-12-31T09:00Z');
select app.run_alert_rules('2027-01-03T09:00Z');
select is((select count(*)::int from public.alert where kind = 'payables_weekly_digest'
            and tenant_id = '11111111-1111-4111-8111-111111111111' and business_date = '2026-12-28'), 1,
  'year end: 12-31 and 01-03 share the week of Monday 2026-12-28: one digest');
select is((select count(*)::int from public.alert where kind = 'payables_weekly_digest'
            and tenant_id = '11111111-1111-4111-8111-111111111111' and business_date = '2027-01-04'), 0,
  'and the next one is not yet there');

-- Nothing unpaid, nothing sent ----------------------------------------------------------------------------------------------------
select is(pg_temp.digest_dates('22222222-2222-4222-8222-222222222222'), '-', 'tenant B (a paid and a fully credited payable): no digest');
select is(app.payables_digest_payload('22222222-2222-4222-8222-222222222222', '2026-10-26'), null::jsonb,
  'the payload builder returns null for it');

-- Bounded payload (tenant C: 40 suppliers, 80-character names) ----------------------------------------------------------------------
select is((select (payload ->> 'suppliers_count')::int from public.alert where kind = 'payables_weekly_digest'
            and tenant_id = '33333333-3333-4333-8333-333333333333' and business_date = '2026-10-26'), 40,
  'C: suppliers_count 40');
select cmp_ok((select (payload ->> 'suppliers_listed')::int from public.alert where kind = 'payables_weekly_digest'
            and tenant_id = '33333333-3333-4333-8333-333333333333' and business_date = '2026-10-26'), '<=', 15,
  'C: at most 15 suppliers listed');
select is((select jsonb_array_length(payload -> 'suppliers') = (payload ->> 'suppliers_listed')::int
             from public.alert where kind = 'payables_weekly_digest'
              and tenant_id = '33333333-3333-4333-8333-333333333333' and business_date = '2026-10-26'), true,
  'C: suppliers_listed matches the entries');
select cmp_ok((select octet_length(payload::text) from public.alert where kind = 'payables_weekly_digest'
            and tenant_id = '33333333-3333-4333-8333-333333333333' and business_date = '2026-10-26'), '<=', 7680,
  'C: the payload is at most 7 680 bytes');
select is((select (payload ->> 'payables_count') || '/' || (payload ->> 'amount_eur') from public.alert
            where kind = 'payables_weekly_digest' and tenant_id = '33333333-3333-4333-8333-333333333333'
              and business_date = '2026-10-26'), '40/1220.00', 'C: the totals cover all 40 suppliers, not just the listed ones');
select is((select (payload -> 'suppliers' -> 0) ->> 'next_due_date' from public.alert
            where kind = 'payables_weekly_digest' and tenant_id = '33333333-3333-4333-8333-333333333333'
              and business_date = '2026-10-26'), '2030-01-02', 'C: ordered by next due date');
-- A direct call with a tiny cap-busting payload: names of 80 characters, 15 entries, trimmed to the bound.
select cmp_ok(octet_length(app.payables_digest_payload('33333333-3333-4333-8333-333333333333', '2026-10-26')::text),
  '<=', 7680, 'the payload builder itself respects the bound');

-- RLS: only the owner reads the digest ------------------------------------------------------------------------------------------------
create function pg_temp.act_as(auth_id uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role', 'authenticated',
    'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', app_role)::text, true)
$$;
grant execute on function pg_temp.act_as(uuid, text) to authenticated;
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'owner');
select cmp_ok((select count(*)::int from public.alert where kind = 'payables_weekly_digest'), '>=', 3, 'owner A reads the digests');
select is((select count(*)::int from public.alert where tenant_id <> '11111111-1111-4111-8111-111111111111'), 0,
  'and none of tenant C');
select pg_temp.act_as('c0000000-0000-4000-8000-00000000000c', 'chef');
select is((select count(*)::int from public.alert where kind = 'payables_weekly_digest'), 0, 'the chef reads no digest');
select pg_temp.act_as('f0000000-0000-4000-8000-00000000000f', 'admin');
select is((select count(*)::int from public.alert where kind = 'payables_weekly_digest'), 0, 'the admin reads no digest');
reset role;

select is((select count(*)::int from app.alert_refusal), 0, 'no refusal along the way');
select is((select count(*)::int from app.job_run where job = 'alert-rules' and not ok), 0, 'every run was ok');

select * from finish();
rollback;
