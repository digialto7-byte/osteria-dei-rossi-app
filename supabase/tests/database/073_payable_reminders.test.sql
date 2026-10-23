-- M9 step 11 (migration 20261024100300_payable_rules.sql): the payable reminders (AT1, AT2). Reminders fire at
-- D-7, D and D+3 by the Europe/Rome business date, only while the payable is open; a missed run or a late
-- approval catches up with the latest stage reached, and each stage fires once (dedup on the stage's
-- nominal date). A fake clock: every run passes its own instant to app.run_alert_rules.
-- Fixture, tenant A: P (due 2026-12-10, paid on 12-05), Q (control, same date, stays open), S (scheduled)
-- and T (disputed); R is approved late (inserted after 12-10). The DST payables X1..X3 come last.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo');
insert into public.supplier (id, tenant_id, name, vat_number) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo Srl', 'IT12345678903');

create function pg_temp.id(prefix text, n int) returns uuid language sql as $$
  select (prefix || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.mk(n int, due date, status text, gross numeric default 1234.50) returns void
  language plpgsql as $$
begin
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, number_raw, invoice_date)
  values (pg_temp.id('e0000000', n), '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111/2026/' || pg_temp.id('e0000000', n) || '.pdf',
          'application/pdf', 2048, 'FT ' || n, '2026-10-01');
  insert into public.payable (id, tenant_id, invoice_id, supplier_id, gross_amount, credited_amount, amount,
                              due_date, due_date_source, status, paid_at, paid_on, created_by)
  values (pg_temp.id('90000000', n), '11111111-1111-4111-8111-111111111111', pg_temp.id('e0000000', n),
          '5a000000-0000-4000-8000-00000000005a', gross, 0, gross, due, 'invoice', status::public.payable_status,
          case when status = 'paid' then now() end, case when status = 'paid' then due end,
          'a1000000-0000-4000-8000-00000000000a');
end
$$;
-- Alerts of one payable as 'kind@business_date', sorted by date.
create function pg_temp.alerts_of(n int) returns text language sql as $$
  select coalesce(string_agg(kind || '@' || business_date, ' ' order by business_date, kind), '-')
    from public.alert where entity_type = 'payable' and entity_id = pg_temp.id('90000000', n)
$$;
create function pg_temp.last_items() returns integer language sql as $$
  select items from app.job_run where job = 'alert-rules' order by id desc limit 1
$$;

select pg_temp.mk(1, '2026-12-10', 'open');       -- P
select pg_temp.mk(2, '2026-12-10', 'open');       -- Q
select pg_temp.mk(3, '2026-12-10', 'scheduled');  -- S
select pg_temp.mk(4, '2026-12-10', 'disputed');   -- T

-- AT1: nothing before 00:00 on 12-03 (Rome), the 7-day reminder at 00:00 ---------------------------------------------
select app.run_alert_rules('2026-12-02T22:59:59Z');
select is((select count(*)::int from public.alert where entity_type = 'payable'), 0,
  '12-02 23:59:59 Rome: no reminder yet');
select app.run_alert_rules('2026-12-02T23:00Z');
select is(pg_temp.alerts_of(1), 'payable_due_7d@2026-12-03', 'P: 00:00 on 12-03 Rome: one payable_due_7d, dated 12-03');
select is(pg_temp.alerts_of(2), 'payable_due_7d@2026-12-03', 'Q: the same');
select is(pg_temp.alerts_of(3) || ' ' || pg_temp.alerts_of(4), '- -', 'scheduled and disputed payables get none (Q29)');
select is((select payload ->> 'amount_eur' from public.alert where entity_id = pg_temp.id('90000000', 1)),
  '1234.50', 'payload amount_eur = the payable amount');
select is((select audience_roles::text || ' ' || cost_bearing::text || ' ' || severity::text
             from public.alert where entity_id = pg_temp.id('90000000', 1)),
  '{owner} true info', 'owner only, cost-bearing, info');
select is((select payload ->> 'supplier_name' || '|' || (payload ->> 'invoice_number') || '|' || (payload ->> 'due_date')
             from public.alert where entity_id = pg_temp.id('90000000', 1)),
  'Fornitore Demo Srl|FT 1|2026-12-10', 'payload names the supplier, invoice number and due date');
-- The weekly digest of the week of 11-30 was already raised by the 22:59:59 run (074 has its cases).
select is(pg_temp.last_items(), 2, 'the run counted its 2 reminders');

-- AT2: the same day again -> nothing new --------------------------------------------------------------------------------
select app.run_alert_rules('2026-12-03T15:00Z');
select is(pg_temp.alerts_of(1), 'payable_due_7d@2026-12-03', 'AT2: re-run the same day: still one');
select is(pg_temp.last_items(), 0, 'AT2: and that run counts 0');
select app.run_alert_rules('2026-12-03T15:00Z');
select is((select count(*)::int from public.alert where kind <> 'payables_weekly_digest'), 2,
  'AT2: twice at the same instant: two reminders in all');

-- AT1: P is paid on 12-05 -> no more reminders for it ------------------------------------------------------------------
select app.run_alert_rules('2026-12-04T09:00Z');
select app.run_alert_rules('2026-12-05T09:00Z');
create function pg_temp.act_as(auth_id uuid, app_role text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role', 'authenticated',
    'tenant_id', '11111111-1111-4111-8111-111111111111', 'app_role', app_role)::text, true)
$$;
grant execute on function pg_temp.act_as(uuid, text) to authenticated;
set local role authenticated;
select pg_temp.act_as('a0000000-0000-4000-8000-00000000000a', 'owner');
select lives_ok($$ select public.set_payable_status(pg_temp.id('90000000', 1), 'paid',
    (now() at time zone 'Europe/Rome')::date) $$, 'the owner marks P paid');
reset role;
select app.run_alert_rules('2026-12-10T09:00Z');
select app.run_alert_rules('2026-12-13T09:00Z');
select is(pg_temp.alerts_of(1), 'payable_due_7d@2026-12-03', 'AT1: P paid on 12-05: nothing on 12-10 or 12-13');

-- AT1 + AT2: the control payable Q, two runs a day, 12-06 ... 12-14 -------------------------------------------------------
select app.run_alert_rules((('2026-12-06'::date + g) + time '09:00') at time zone 'UTC') from generate_series(0, 8) g;
select app.run_alert_rules((('2026-12-06'::date + g) + time '15:00') at time zone 'UTC') from generate_series(0, 8) g;
select is(pg_temp.alerts_of(2), 'payable_due_7d@2026-12-03 payable_due_today@2026-12-10 payable_overdue_3d@2026-12-13',
  'AT1+AT2: Q has exactly one of each kind, on 12-03, 12-10 and 12-13');
select is(pg_temp.alerts_of(3) || ' ' || pg_temp.alerts_of(4), '- -', 'S and T: none on any of those days');
select is(pg_temp.alerts_of(1), 'payable_due_7d@2026-12-03', 'P: still only the first');

-- Catch-up: R due 12-10, first seen on 12-11 --------------------------------------------------------------------------------
select pg_temp.mk(5, '2026-12-10', 'open');
select app.run_alert_rules('2026-12-11T09:00Z');
select is(pg_temp.alerts_of(5), 'payable_due_today@2026-12-10',
  'catch-up: first seen on 12-11: only payable_due_today, dated 12-10, never a stale 7-day one');
select app.run_alert_rules('2026-12-11T10:00Z');
select is(pg_temp.alerts_of(5), 'payable_due_today@2026-12-10', 'and not again the next hour');
select app.run_alert_rules('2026-12-14T09:00Z');
select is(pg_temp.alerts_of(5), 'payable_due_today@2026-12-10 payable_overdue_3d@2026-12-13',
  'then the +3 d reminder, dated 12-13');
-- A payable approved when it is already past +3 days gets the latest stage only.
select pg_temp.mk(6, '2026-12-01', 'open');
select app.run_alert_rules('2026-12-14T10:00Z');
select is(pg_temp.alerts_of(6), 'payable_overdue_3d@2026-12-04', 'a payable far overdue: only the +3 d stage (dated D+3)');

-- Reopened payables are reminded again at their stage; paid ones never ----------------------------------------------------
select pg_temp.mk(7, '2026-12-20', 'paid');
select app.run_alert_rules('2026-12-20T09:00Z');
select is(pg_temp.alerts_of(7), '-', 'a payable inserted as paid gets none');

-- A fully credited payable (amount 0,00 EUR) is not worth a reminder; a normal one on the same date still is -----------------
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, number_raw, invoice_date)
values (pg_temp.id('e0000000', 8), '11111111-1111-4111-8111-111111111111',
        '11111111-1111-4111-8111-111111111111/2026/' || pg_temp.id('e0000000', 8) || '.pdf',
        'application/pdf', 2048, 'FT 8', '2026-10-01');
insert into public.payable (id, tenant_id, invoice_id, supplier_id, gross_amount, credited_amount, amount,
                            due_date, due_date_source, created_by)
values (pg_temp.id('90000000', 8), '11111111-1111-4111-8111-111111111111', pg_temp.id('e0000000', 8),
        '5a000000-0000-4000-8000-00000000005a', 100, 100, 0, '2026-12-27', 'invoice',
        'a1000000-0000-4000-8000-00000000000a');
select pg_temp.mk(9, '2026-12-27', 'open');
select app.run_alert_rules('2026-12-20T09:00Z');
select is(pg_temp.alerts_of(8), '-', 'a fully credited payable due in 7 days: no payable_due_7d');
select is(pg_temp.alerts_of(9), 'payable_due_7d@2026-12-20', 'a normal payable on the same date still gets it');
select app.run_alert_rules('2026-12-27T09:00Z');
select app.run_alert_rules('2026-12-30T09:00Z');
select is(pg_temp.alerts_of(8), '-', 'and none at due date or +3 d either');

-- DST: the business date is the Europe/Rome calendar day ------------------------------------------------------------------
select pg_temp.mk(11, '2026-11-01', 'open');  -- D-7 = 10-25, the day summer time ends
select pg_temp.mk(12, '2027-04-04', 'open');  -- D-7 = 03-28, the day summer time starts
select pg_temp.mk(13, '2027-03-28', 'open');
select app.run_alert_rules('2026-10-24T21:59:59Z');
select is(pg_temp.alerts_of(11), '-', 'due 11-01: 23:59:59 on 10-24 Rome (CEST): nothing');
select app.run_alert_rules('2026-10-24T22:00Z');
select is(pg_temp.alerts_of(11), 'payable_due_7d@2026-10-25', '00:00 on 10-25 Rome: payable_due_7d, dated 10-25');
select app.run_alert_rules('2027-03-27T22:59:59Z');
select is(pg_temp.alerts_of(12), '-', 'due 2027-04-04: 23:59:59 on 03-27 Rome (CET): nothing');
select app.run_alert_rules('2027-03-27T23:00Z');
select is(pg_temp.alerts_of(12), 'payable_due_7d@2027-03-28', '00:00 on 03-28 Rome: payable_due_7d, dated 03-28');
select app.run_alert_rules('2027-03-28T01:30Z');
select ok(pg_temp.alerts_of(13) like '%payable_due_today@2027-03-28%', 'due 2027-03-28: 01:30Z is 03:30 CEST: payable_due_today');

-- Tenant isolation and the shape of the rows ---------------------------------------------------------------------------------
select is((select count(*)::int from public.alert where tenant_id <> '11111111-1111-4111-8111-111111111111'), 0,
  'every alert belongs to tenant A');
select is((select count(*)::int from public.alert where kind like 'payable%' and kind <> 'payables_weekly_digest'
            and (entity_type <> 'payable' or audience_roles <> '{owner}' or not cost_bearing)), 0,
  'every reminder is about a payable, owner only and cost-bearing');
select is((select count(*)::int from (select entity_id, kind, business_date from public.alert
            group by 1, 2, 3 having count(*) > 1) d), 0, 'no duplicate (entity, kind, business date)');
select is((select count(*)::int from app.alert_refusal), 0, 'no refusal along the way');
select is((select count(*)::int from app.job_run where job = 'alert-rules' and not ok), 0, 'every run was ok');

-- Privileges -----------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r,
    unnest(array['app.payable_reminder_rule(uuid, timestamptz)', 'app.payables_digest_payload(uuid, date)',
                 'app.payables_digest_rule(uuid, timestamptz)', 'app.alert_rules_body(timestamptz)']) f
   where has_function_privilege(r, f, 'execute')), 0, 'no API role can execute the rules');
select is((select prosecdef and proconfig = array['search_path=""'] from pg_proc
            where oid = 'app.payable_reminder_rule(uuid, timestamptz)'::regprocedure), true,
  'the reminder rule is a definer with an empty search_path');

select * from finish();
rollback;
