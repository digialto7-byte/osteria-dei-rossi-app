-- Small fix (lead, 2026-11-15): the line comment in 20261025100000_staff_auth_tables.sql calls device_enrolment.code_hash a
-- "sha256 of the 8-character code". Since M11 it has been an HMAC-SHA-256 with the server pepper (hashEnrolmentCode in
-- src/server/staff-auth/tokens.ts). A merged migration is never edited, so the truth goes on the column, where the catalogue
-- shows it. No data, constraint or grant changes. Numbered before SP2's first migration (20261207100000) so it never lands
-- after a migration the stacked branches will add. Pinned by supabase/tests/database/388_device_enrolment_code_hash_comment.test.sql.
comment on column public.device_enrolment.code_hash is
  'HMAC-SHA-256 (hex) with the server pepper (PIN_PEPPER) over "code:" plus the normalised enrolment code '
  '(src/server/staff-auth/tokens.ts hashEnrolmentCode). Never a plain sha256: the code has 40 bits, so an unpeppered hash '
  'of a leaked row could be brute-forced. The plain code is shown once and never stored.';
