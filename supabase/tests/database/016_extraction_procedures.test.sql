-- M3 worker procedures (plan step 4), run as service_role: extraction_claim, extraction_complete,
-- extraction_fail, extraction_release. Covers AT1/AT2/AT3/AT6/AT7 at database level, the founder
-- duplicate rules and the advisory lock that serialises the duplicate check.
begin;
create extension if not exists pgtap with schema extensions;
select plan(96);

insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');

-- Invoice n: id 00000000-0000-4000-8000-<n>, claim token 99999999-0000-4000-8000-<n>
-- (set only while extracting). Times are relative to now(), which is fixed inside the transaction.
create function pg_temp.iid(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.tok(n int) returns uuid language sql immutable as $$
  select ('99999999-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.mk(n int, p_status public.invoice_status, p_attempts int default 0,
    p_created_ago interval default '0', p_started_ago interval default null,
    p_next_in interval default null, p_vat text default null, p_name text default null,
    p_numraw text default null, p_date date default null, p_override boolean default false,
    p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns void language sql as $$
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status,
      attempts, created_at, extraction_started_at, next_attempt_at, supplier_vat, supplier_name,
      number_raw, invoice_date, duplicate_override, claim_token)
  values (pg_temp.iid(n), p_tenant, p_tenant || '/2026/' || pg_temp.iid(n) || '.pdf',
      'application/pdf', 100, p_status, p_attempts, now() - p_created_ago,
      now() - p_started_ago, now() + p_next_in, p_vat, p_name, p_numraw, p_date, p_override,
      case when p_status = 'extracting' then pg_temp.tok(n) end)
$$;
grant execute on function pg_temp.iid(int), pg_temp.tok(int) to service_role;

-- Claim fixtures. 1,2 waiting; 3 in backoff (oldest, must be skipped); 4 stale lease with an
-- attempt left; 5 stale lease with none left; 6 live lease; 7 tenant B waiting (newest).
select pg_temp.mk(1, 'received', 0, '3 hours');
select pg_temp.mk(2, 'received', 0, '2 hours');
select pg_temp.mk(3, 'received', 1, '5 hours', null, '1 hour');
select pg_temp.mk(4, 'extracting', 1, '1 hour', '1 hour');
select pg_temp.mk(5, 'extracting', 3, '1 hour', '1 hour');
select pg_temp.mk(6, 'extracting', 1, '1 hour', '0 seconds');
select pg_temp.mk(7, 'received', 0, '10 minutes', null, null, null, null, null, null, false,
  '22222222-2222-4222-8222-222222222222');

-- Privileges.
select ok(not has_function_privilege('anon', 'public.extraction_claim(int, int)', 'execute'),
  'anon cannot claim');
select ok(not has_function_privilege('authenticated', 'public.extraction_claim(int, int)', 'execute'),
  'authenticated cannot claim');
select ok(has_function_privilege('service_role', 'public.extraction_claim(int, int)', 'execute'),
  'service_role can claim');
select ok(not has_function_privilege('authenticated',
  'public.extraction_complete(uuid, uuid, jsonb, text)', 'execute'), 'authenticated cannot complete');
select ok(has_function_privilege('service_role',
  'public.extraction_complete(uuid, uuid, jsonb, text)', 'execute'), 'service_role can complete');
select ok(not has_function_privilege('authenticated',
  'public.extraction_fail(uuid, uuid, text, boolean, int[], int)', 'execute'),
  'authenticated cannot fail');
select ok(has_function_privilege('service_role',
  'public.extraction_fail(uuid, uuid, text, boolean, int[], int)', 'execute'), 'service_role can fail');
select ok(not has_function_privilege('authenticated',
  'public.extraction_release(uuid, uuid, text, int)', 'execute'), 'authenticated cannot release');
select ok(has_function_privilege('service_role',
  'public.extraction_release(uuid, uuid, text, int)', 'execute'), 'service_role can release');
select ok(not has_function_privilege('anon',
  'public.extraction_fail(uuid, uuid, text, boolean, int[], int)', 'execute')
  and not has_function_privilege('anon', 'public.extraction_release(uuid, uuid, text, int)', 'execute')
  and not has_function_privilege('anon', 'public.extraction_complete(uuid, uuid, jsonb, text)', 'execute'),
  'anon cannot call the other procedures');
select ok(not has_function_privilege('authenticated',
  'app.invoice_dup_lock_key(uuid, text, text, text, date)', 'execute'),
  'authenticated cannot call the lock key helper');

-- Lock key helper: same invoice, same key; anything else differs; incomplete keys have none.
select is(app.invoice_dup_lock_key('11111111-1111-4111-8111-111111111111', 'IT12345678903', null,
    'FT 1/2026', '2026-10-01'),
  app.invoice_dup_lock_key('11111111-1111-4111-8111-111111111111', 'it 12345678903', 'Ignored',
    ' ft1/2026 ', '2026-10-01'), 'case, spaces and the name do not change a VAT key');
select is(app.invoice_dup_lock_key('11111111-1111-4111-8111-111111111111', null, 'Rossi  Carni',
    'FT 1/2026', '2026-10-01'),
  app.invoice_dup_lock_key('11111111-1111-4111-8111-111111111111', null, ' rossi carni ',
    'FT 1/2026', '2026-10-01'), 'case and spacing do not change a name key');
select isnt(app.invoice_dup_lock_key('11111111-1111-4111-8111-111111111111', 'IT12345678903', null,
    'FT 1/2026', '2026-10-01'),
  app.invoice_dup_lock_key('22222222-2222-4222-8222-222222222222', 'IT12345678903', null,
    'FT 1/2026', '2026-10-01'), 'another tenant has another key');
select isnt(app.invoice_dup_lock_key('11111111-1111-4111-8111-111111111111', 'IT12345678903', null,
    'FT 1/2026', '2026-10-01'),
  app.invoice_dup_lock_key('11111111-1111-4111-8111-111111111111', 'IT12345678903', null,
    'FT-1-2026', '2026-10-01'), 'punctuation in the number changes the key');
select isnt(app.invoice_dup_lock_key('11111111-1111-4111-8111-111111111111', null, 'IT12345678903',
    'FT 1/2026', '2026-10-01'),
  app.invoice_dup_lock_key('11111111-1111-4111-8111-111111111111', 'IT12345678903', null,
    'FT 1/2026', '2026-10-01'), 'a name that looks like a VAT does not share its key');
select is(app.invoice_dup_lock_key('11111111-1111-4111-8111-111111111111', null, null,
    'FT 1/2026', '2026-10-01'), null, 'no VAT and no name: no key');
select is(app.invoice_dup_lock_key('11111111-1111-4111-8111-111111111111', 'IT12345678903', null,
    null, '2026-10-01'), null, 'no number: no key');
select is(app.invoice_dup_lock_key('11111111-1111-4111-8111-111111111111', 'IT12345678903', null,
    'FT 1/2026', null), null, 'no date: no key');

set local role service_role;

-- Claim.
create temporary table claimed (seq int, id uuid, tenant_id uuid, file_path text, file_mime text,
  claim_token uuid, attempts smallint);
grant all on claimed to service_role;
insert into claimed select 1, * from public.extraction_claim(180, 3);
select is((select id from claimed where seq = 1), pg_temp.iid(1), 'the oldest waiting invoice is claimed first');
select is((select attempts from claimed where seq = 1), 1::smallint, 'the claim counts an attempt');
select isnt((select claim_token from claimed where seq = 1), null, 'the claim carries a token');
select is((select file_mime from claimed where seq = 1), 'application/pdf', 'the claim returns the file type');
select is((select tenant_id from claimed where seq = 1), '11111111-1111-4111-8111-111111111111'::uuid,
  'the claim returns the tenant');
select is((select file_path from claimed where seq = 1),
  '11111111-1111-4111-8111-111111111111/2026/' || pg_temp.iid(1) || '.pdf', 'the claim returns the file path');
reset role;
select is((select status::text from public.invoice where id = pg_temp.iid(1)), 'extracting', 'claimed -> extracting');
select is((select claim_token from public.invoice where id = pg_temp.iid(1)),
  (select claim_token from claimed where seq = 1), 'the stored token is the returned one');
select is((select extraction_started_at from public.invoice where id = pg_temp.iid(1)), now(),
  'the lease start is recorded');
select is((select status::text from public.invoice where id = pg_temp.iid(5)), 'extraction_failed',
  'a stale lease with no attempts left fails');
select is((select extraction_error from public.invoice where id = pg_temp.iid(5)), 'lease_expired',
  'with the lease_expired code');
select is((select claim_token from public.invoice where id = pg_temp.iid(5)), null,
  'and its token is cleared');
set local role service_role;
insert into claimed select 2, * from public.extraction_claim(180, 3);
insert into claimed select 3, * from public.extraction_claim(180, 3);
insert into claimed select 4, * from public.extraction_claim(180, 3);
insert into claimed select 5, * from public.extraction_claim(180, 3);
select is((select id from claimed where seq = 2), pg_temp.iid(2), 'the next waiting invoice follows');
select is((select id from claimed where seq = 3), pg_temp.iid(4), 'a stale lease with an attempt left is re-claimed');
select is((select attempts from claimed where seq = 3), 2::smallint, 'the re-claim counts an attempt');
select isnt((select claim_token from claimed where seq = 3), pg_temp.tok(4), 'the re-claim issues a new token');
select is((select id from claimed where seq = 4), pg_temp.iid(7),
  'the queue spans tenants, oldest first; the claim returns the invoice''s own tenant');
select is((select tenant_id from claimed where seq = 4), '22222222-2222-4222-8222-222222222222'::uuid,
  'tenant B''s invoice is returned with tenant B');
select is((select count(*) from claimed where seq = 5), 0::bigint, 'an empty queue claims nothing');
select is((select count(*) from claimed where id in (pg_temp.iid(3), pg_temp.iid(6))), 0::bigint,
  'an invoice in backoff and one with a live lease are skipped');
reset role;
select is((select status::text from public.invoice where id = pg_temp.iid(3)), 'received',
  'the one in backoff is untouched');

-- Complete. A result is {header, lines, gate_flags, totals_diff, field_confidence, extraction_json}.
create function pg_temp.result(p_vat text, p_name text, p_number text, p_date text,
    p_lines jsonb default null, p_flags text[] default '{}', p_diff numeric default 0)
  returns jsonb language sql as $$
  select jsonb_build_object(
    'header', jsonb_build_object('supplier_vat', p_vat, 'supplier_name', p_name,
      'number_raw', p_number, 'invoice_date', p_date, 'due_date', '2026-11-30',
      'payment_terms', '30 gg', 'net_total', 30, 'vat_total', 3, 'gross_total', 33.00),
    'lines', coalesce(p_lines, jsonb_build_array(
      jsonb_build_object('raw_description', 'Manzo fesa', 'supplier_code', 'MAN-1', 'qty', 2,
        'unit_raw', 'kg', 'unit_price', 5, 'line_amount', 10, 'vat_rate', 10, 'lot_code', 'L-0425',
        'expiry', '2026-11-30', 'field_confidence', jsonb_build_object('qty', 0.99),
        'checks', jsonb_build_array(), 'extracted', jsonb_build_object('description', 'Manzo fesa')),
      jsonb_build_object('raw_description', 'Olio extra vergine', 'qty', 20, 'unit_price', 1,
        'line_amount', 20, 'vat_rate', 22, 'field_confidence', jsonb_build_object(),
        'checks', jsonb_build_array('vat_rate_unexpected'), 'extracted', jsonb_build_object()))),
    'gate_flags', to_jsonb(p_flags), 'totals_diff', p_diff,
    'field_confidence', jsonb_build_object('invoice_number', 0.97),
    'extraction_json', jsonb_build_object('invoice_number', p_number))
$$;
grant execute on function pg_temp.result(text, text, text, text, jsonb, text[], numeric) to service_role;

-- Fixtures: 11 happy path; 12 wrong-token/state checks use 3 (received); 13 gate flags;
-- 24 is the twin that 19 would duplicate if its override did not apply; 14 duplicate of 11; 15 punctuation differs; 16 name-only match for 20; 17 other name; 18 only a
-- rejected twin; 19 override; 22 invalid line; 23 B's tenant, same key as 11.
select pg_temp.mk(11, 'extracting', 1);
select pg_temp.mk(12, 'extracting', 1);
select pg_temp.mk(13, 'extracting', 1);
select pg_temp.mk(14, 'extracting', 1);
select pg_temp.mk(15, 'extracting', 1);
select pg_temp.mk(16, 'extracting', 1);
select pg_temp.mk(17, 'extracting', 1);
select pg_temp.mk(18, 'extracting', 1);
select pg_temp.mk(19, 'extracting', 1, '0', '0 seconds', null, null, null, null, null, true);
select pg_temp.mk(22, 'extracting', 1);
select pg_temp.mk(23, 'extracting', 1, '0', '0 seconds', null, null, null, null, null, false,
  '22222222-2222-4222-8222-222222222222');
select pg_temp.mk(24, 'review', 0, '1 day', null, null, 'IT12345678903', null, 'FT 19/2026', '2026-10-01');
select pg_temp.mk(20, 'review', 0, '1 day', null, null, null, 'ROSSI  Carni S.r.l.', 'FT 9/2026', '2026-10-05');
select pg_temp.mk(21, 'rejected', 0, '1 day', null, null, 'IT00000000000', null, 'FT 5/2026', '2026-10-05');
update public.invoice set supplier_vat = 'IT00000000000' where id = pg_temp.iid(21);

set local role service_role;
select throws_ok(format($q$ select public.extraction_complete(%L, %L, %L, 'test-model') $q$,
    pg_temp.iid(11), pg_temp.tok(99), pg_temp.result('IT12345678903', 'Fornitore Demo Srl', 'FT 1/2026', '2026-10-01')),
  'P0001', 'stale_claim', 'a wrong token is refused');
select throws_ok(format($q$ select public.extraction_complete(%L, %L, %L, 'test-model') $q$,
    pg_temp.iid(3), pg_temp.tok(3), pg_temp.result('IT12345678903', 'Fornitore Demo Srl', 'FT 1/2026', '2026-10-01')),
  'P0001', 'stale_claim', 'an invoice that is not extracting is refused');
select throws_ok(format($q$ select public.extraction_complete(%L, %L, %L, 'test-model') $q$,
    gen_random_uuid(), pg_temp.tok(11), pg_temp.result('IT12345678903', 'Fornitore Demo Srl', 'FT 1/2026', '2026-10-01')),
  'P0001', 'stale_claim', 'an unknown invoice is refused');
select is((select status::text from public.invoice where id = pg_temp.iid(11)), 'extracting',
  'a refused completion changes nothing');

-- AT1: a valid result with two lines (lot and expiry) lands in review.
select is(public.extraction_complete(pg_temp.iid(11), pg_temp.tok(11),
  pg_temp.result('IT12345678903', 'Fornitore Demo Srl', 'FT 1/2026', '2026-10-01'), 'test-model'),
  'review'::public.invoice_status, 'a valid result lands in review');
reset role;
select is((select count(*) from public.invoice_line where invoice_id = pg_temp.iid(11)), 2::bigint, 'both lines are stored');
select is((select lot_code || ' ' || expiry from public.invoice_line
    where invoice_id = pg_temp.iid(11) and position = 1), 'L-0425 2026-11-30', 'lot and expiry are stored');
select is((select array_agg(position order by position) from public.invoice_line where invoice_id = pg_temp.iid(11)),
  array[1, 2]::smallint[], 'lines are numbered in order');
select is((select checks from public.invoice_line where invoice_id = pg_temp.iid(11) and position = 2),
  array['vat_rate_unexpected'], 'line checks are stored');
select is((select tenant_id from public.invoice_line where invoice_id = pg_temp.iid(11) limit 1),
  '11111111-1111-4111-8111-111111111111'::uuid, 'lines carry the invoice''s tenant');
select is((select count(*) from public.invoice_line where invoice_id = pg_temp.iid(11)
    and extracted <> '{}' and field_confidence is not null), 1::bigint, 'the extracted baseline is kept');
select results_eq($$ select supplier_vat, supplier_name, number, invoice_date, due_date, payment_terms,
    gross_total, extraction_model, claim_token, attempts from public.invoice where id = '00000000-0000-4000-8000-000000000011' $$,
  $$ values ('IT12345678903'::text, 'Fornitore Demo Srl'::text, 'FT1/2026'::text, '2026-10-01'::date,
    '2026-11-30'::date, '30 gg'::text, 33.0000::numeric, 'test-model'::text, null::uuid, 1::smallint) $$,
  'the header, model and attempts are stored and the token cleared');
select isnt((select extracted_at from public.invoice where id = pg_temp.iid(11)), null, 'extracted_at is set');
select is((select field_confidence ->> 'invoice_number' from public.invoice where id = pg_temp.iid(11)),
  '0.97', 'field confidence is stored');
select is((select extraction_json ->> 'invoice_number' from public.invoice where id = pg_temp.iid(11)),
  'FT 1/2026', 'the normalised extraction JSON is stored');

-- The duplicate check takes an advisory lock on the key, in the transaction.
select is((select count(*) from pg_locks l
    where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 1
      and ((l.classid::bigint << 32) | l.objid::bigint) = app.invoice_dup_lock_key(
        '11111111-1111-4111-8111-111111111111', 'IT12345678903', 'Fornitore Demo Srl', 'FT 1/2026', '2026-10-01')),
  1::bigint, 'the transaction holds the advisory lock for the VAT key');

-- AT2: the gate flags and the difference are stored.
set local role service_role;
select is(public.extraction_complete(pg_temp.iid(13), pg_temp.tok(13),
  pg_temp.result('IT12345678903', 'Fornitore Demo Srl', 'FT 2/2026', '2026-10-01', null,
    array['total_mismatch'], 0.06), 'test-model'), 'review'::public.invoice_status,
  'a total mismatch still goes to review');
reset role;
select results_eq($$ select gate_flags, totals_diff from public.invoice where id = '00000000-0000-4000-8000-000000000013' $$,
  $$ values (array['total_mismatch']::text[], 0.0600::numeric) $$, 'the gate flag and the difference are stored');

-- AT6: same VAT, number (normalised) and date as invoice 11 -> duplicate.
set local role service_role;
select is(public.extraction_complete(pg_temp.iid(14), pg_temp.tok(14),
  pg_temp.result('IT12345678903', 'Fornitore Demo Srl', ' ft 1/2026 ', '2026-10-01'), 'test-model'),
  'duplicate'::public.invoice_status, 'the same VAT, number and date is a duplicate');
reset role;
select is((select duplicate_of from public.invoice where id = pg_temp.iid(14)), pg_temp.iid(11),
  'duplicate_of points at the first invoice');
select is((select count(*) from public.invoice_line where invoice_id = pg_temp.iid(14)), 2::bigint,
  'the duplicate keeps its lines (an owner may clear the flag in M4)');
select is((select duplicate_warning_of from public.invoice where id = pg_temp.iid(14)), null,
  'a VAT match sets no name warning');

-- Founder rule: FT-1-2026 is not FT 1/2026.
set local role service_role;
select is(public.extraction_complete(pg_temp.iid(15), pg_temp.tok(15),
  pg_temp.result('IT12345678903', 'Fornitore Demo Srl', 'FT-1-2026', '2026-10-01'), 'test-model'),
  'review'::public.invoice_status, 'a different punctuation is a different invoice');

-- Founder rule: no VAT, same normalised name, number and date -> review + warning, not duplicate.
select is(public.extraction_complete(pg_temp.iid(16), pg_temp.tok(16),
  pg_temp.result(null, 'rossi carni s.r.l.', 'FT 9/2026', '2026-10-05'), 'test-model'),
  'review'::public.invoice_status, 'a name-only match stays in review');
reset role;
select is((select duplicate_warning_of from public.invoice where id = pg_temp.iid(16)), pg_temp.iid(20),
  'with the warning pointing at the earlier invoice');
select is((select duplicate_of from public.invoice where id = pg_temp.iid(16)), null,
  'and no duplicate_of');
select is((select count(*) from pg_locks l
    where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 1
      and ((l.classid::bigint << 32) | l.objid::bigint) = app.invoice_dup_lock_key(
        '11111111-1111-4111-8111-111111111111', null, 'Rossi Carni S.r.l.', 'FT 9/2026', '2026-10-05')),
  1::bigint, 'the transaction holds the advisory lock for the name key');

-- No VAT and a different name: no warning.
set local role service_role;
select is(public.extraction_complete(pg_temp.iid(17), pg_temp.tok(17),
  pg_temp.result(null, 'Bianchi Latticini', 'FT 9/2026', '2026-10-05'), 'test-model'),
  'review'::public.invoice_status, 'a different name is not a match');
reset role;
select is((select duplicate_warning_of from public.invoice where id = pg_temp.iid(17)), null,
  'and carries no warning');

-- A rejected twin does not count.
set local role service_role;
select is(public.extraction_complete(pg_temp.iid(18), pg_temp.tok(18),
  pg_temp.result('IT00000000000', 'Osteria Demo', 'FT 5/2026', '2026-10-05'), 'test-model'),
  'review'::public.invoice_status, 'a rejected twin is not a duplicate');

-- Another tenant's invoice with the same key is not a match.
select is(public.extraction_complete(pg_temp.iid(23), pg_temp.tok(23),
  pg_temp.result('IT12345678903', 'Fornitore Demo Srl', 'FT 1/2026', '2026-10-01'), 'test-model'),
  'review'::public.invoice_status, 'the same key in another tenant is not a duplicate');

-- Override: the duplicate check is skipped (and so is its lock).
select is(public.extraction_complete(pg_temp.iid(19), pg_temp.tok(19),
  pg_temp.result('IT12345678903', 'Fornitore Demo Srl', 'FT 19/2026', '2026-10-01'), 'test-model'),
  'review'::public.invoice_status, 'a cleared invoice is never re-flagged');
reset role;
select is((select duplicate_of from public.invoice where id = pg_temp.iid(19)), null, 'the override leaves duplicate_of empty');
select is((select count(*) from pg_locks l
    where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 1
      and ((l.classid::bigint << 32) | l.objid::bigint) = app.invoice_dup_lock_key(
        '11111111-1111-4111-8111-111111111111', 'IT12345678903', null, 'FT 19/2026', '2026-10-01')),
  0::bigint, 'the override skips the check and its lock');
select is((select count(*) from pg_locks l
    where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 1
      and ((l.classid::bigint << 32) | l.objid::bigint) = app.invoice_dup_lock_key(
        '22222222-2222-4222-8222-222222222222', 'IT12345678903', null, 'FT 1/2026', '2026-10-01')),
  1::bigint, 'tenant B''s extraction took its own tenant-scoped lock');

-- AT3 at database level: an invalid line fails the whole completion and leaves no lines.
set local role service_role;
select throws_ok(format($q$ select public.extraction_complete(%L, %L, %L, 'test-model') $q$,
    pg_temp.iid(22), pg_temp.tok(22), pg_temp.result('IT12345678903', 'Fornitore Demo Srl', 'FT 22/2026', '2026-10-01',
      jsonb_build_array(jsonb_build_object('raw_description', 'Ok', 'qty', 1, 'line_amount', 1,
        'field_confidence', jsonb_build_object(), 'extracted', jsonb_build_object()),
      jsonb_build_object('raw_description', 'Bad', 'qty', -1, 'line_amount', 1,
        'field_confidence', jsonb_build_object(), 'extracted', jsonb_build_object()))) ),
  '23514', null, 'a line with a negative quantity is rejected');
reset role;
select is((select count(*) from public.invoice_line where invoice_id = pg_temp.iid(22)), 0::bigint, 'no line is left behind');
select is((select status::text from public.invoice where id = pg_temp.iid(22)), 'extracting',
  'the invoice stays extracting, so the caller can record the failure');

-- Fail. 31..37 are extracting with the stated attempts.
select pg_temp.mk(31, 'extracting', 1);
select pg_temp.mk(32, 'extracting', 2);
select pg_temp.mk(33, 'extracting', 3);
select pg_temp.mk(34, 'extracting', 1);
select pg_temp.mk(36, 'extracting', 3);
set local role service_role;
select is(public.extraction_fail(pg_temp.iid(31), pg_temp.tok(31), 'provider_timeout', true, array[60, 300], 3),
  'received'::public.invoice_status, 'a retryable failure at attempt 1 goes back to received');
select is(public.extraction_fail(pg_temp.iid(32), pg_temp.tok(32), 'provider_unavailable', true, array[60, 300], 3),
  'received'::public.invoice_status, 'a retryable failure at attempt 2 goes back to received');
select is(public.extraction_fail(pg_temp.iid(33), pg_temp.tok(33), 'provider_unavailable', true, array[60, 300], 3),
  'extraction_failed'::public.invoice_status, 'the third failure is final');
select is(public.extraction_fail(pg_temp.iid(34), pg_temp.tok(34), 'schema_invalid', false, array[60, 300], 3),
  'extraction_failed'::public.invoice_status, 'a non-retryable failure is final at once');
select is(public.extraction_fail(pg_temp.iid(36), pg_temp.tok(36), 'provider_timeout', true, array[60, 300], 5),
  'received'::public.invoice_status, 'a retryable failure beyond the backoff list reuses its last value');
select throws_ok(format($q$ select public.extraction_fail(%L, %L, 'provider_timeout', true, array[60], 3) $q$,
    pg_temp.iid(31), pg_temp.tok(99)), 'P0001', 'stale_claim', 'fail with a wrong token is refused');
select throws_ok(format($q$ select public.extraction_fail(%L, %L, 'provider_timeout', true, array[60], 3) $q$,
    pg_temp.iid(31), pg_temp.tok(31)), 'P0001', 'stale_claim', 'fail on an invoice that is not extracting is refused');
reset role;
select results_eq($$ select status::text, next_attempt_at, extraction_error, claim_token from public.invoice
    where id = '00000000-0000-4000-8000-000000000031' $$,
  format($$ values ('received'::text, %L::timestamptz, 'provider_timeout'::text, null::uuid) $$, now() + interval '60 seconds'),
  'attempt 1 waits 60 seconds');
select is((select next_attempt_at from public.invoice where id = pg_temp.iid(32)), now() + interval '300 seconds',
  'attempt 2 waits 300 seconds');
select is((select next_attempt_at from public.invoice where id = pg_temp.iid(36)), now() + interval '300 seconds',
  'attempt 3 with a longer limit waits 300 seconds');
select results_eq($$ select extraction_error, next_attempt_at from public.invoice where id = '00000000-0000-4000-8000-000000000033' $$,
  $$ values ('provider_unavailable'::text, null::timestamptz) $$, 'the final failure records the code and no new attempt');
select is((select count(*) from public.invoice_line where invoice_id in (pg_temp.iid(33), pg_temp.iid(34))), 0::bigint,
  'a failed extraction has no lines');
select is((select extraction_error from public.invoice where id = pg_temp.iid(34)), 'schema_invalid',
  'the non-retryable code is recorded');
select pg_temp.mk(35, 'extracting', 1);
set local role service_role;
select throws_ok(format($q$ select public.extraction_fail(%L, %L, 'bogus', false, array[60], 3) $q$,
    pg_temp.iid(35), pg_temp.tok(35)), '23514', null, 'an unknown error code is refused');
reset role;

-- Release: a configuration fault does not burn an attempt.
select pg_temp.mk(41, 'extracting', 2);
set local role service_role;
select is(public.extraction_release(pg_temp.iid(41), pg_temp.tok(41), 'provider_auth', 900),
  'received'::public.invoice_status, 'release goes back to received');
select throws_ok(format($q$ select public.extraction_release(%L, %L, 'provider_auth', 900) $q$,
    pg_temp.iid(41), pg_temp.tok(41)), 'P0001', 'stale_claim', 'release on a released invoice is refused');
reset role;
select results_eq($$ select attempts, extraction_error, claim_token from public.invoice
    where id = '00000000-0000-4000-8000-000000000041' $$,
  $$ values (1::smallint, 'provider_auth'::text, null::uuid) $$, 'the attempt is given back');
select is((select next_attempt_at from public.invoice where id = pg_temp.iid(41)), now() + interval '900 seconds',
  'and the next try waits 900 seconds');

select * from finish();
rollback;
