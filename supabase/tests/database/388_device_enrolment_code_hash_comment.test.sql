-- Small fix (lead, 2026-11-15): public.device_enrolment.code_hash holds an HMAC-SHA-256 with the server pepper over the normalised
-- code (src/server/staff-auth/tokens.ts hashEnrolmentCode), not a plain sha256 as the original migration's line comment says. The
-- merged migration stays as it is; a later one records the truth on the column itself, where the catalogue shows it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

select is(
  col_description('public.device_enrolment'::regclass,
    (select attnum from pg_attribute where attrelid = 'public.device_enrolment'::regclass and attname = 'code_hash')),
  'HMAC-SHA-256 (hex) with the server pepper (PIN_PEPPER) over "code:" plus the normalised enrolment code '
    || '(src/server/staff-auth/tokens.ts hashEnrolmentCode). Never a plain sha256: the code has 40 bits, so an unpeppered hash '
    || 'of a leaked row could be brute-forced. The plain code is shown once and never stored.',
  'code_hash is described as the peppered HMAC, with where it is computed'
);
select ok(
  col_description('public.device_enrolment'::regclass,
    (select attnum from pg_attribute where attrelid = 'public.device_enrolment'::regclass and attname = 'code_hash'))
    !~* '(^|[^-])sha256 of',
  'the comment does not call it a "sha256 of" the code anywhere (the stale wording)'
);
-- The comment changes nothing else about the column.
select col_type_is('public', 'device_enrolment', 'code_hash', 'text', 'code_hash is still text (64 hex, checked by its constraint)');

select * from finish();
rollback;
