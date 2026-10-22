-- M3 review note: the gate flag `supplier_is_buyer` is allowed by invoice_gate_flags_ck.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes) values
  ('a1000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111',
   '11111111-1111-4111-8111-111111111111/2026/a1000000-0000-4000-8000-0000000000a1.pdf',
   'application/pdf', 1000);

select lives_ok($$ update public.invoice set gate_flags = '{supplier_is_buyer}'
    where id = 'a1000000-0000-4000-8000-0000000000a1' $$, 'supplier_is_buyer is accepted');
select lives_ok($$ update public.invoice
    set gate_flags = '{total_mismatch,low_confidence,supplier_is_buyer}'
    where id = 'a1000000-0000-4000-8000-0000000000a1' $$, 'all three flags together are accepted');
select lives_ok($$ update public.invoice set gate_flags = '{}'
    where id = 'a1000000-0000-4000-8000-0000000000a1' $$, 'no flags is accepted');
select throws_ok($$ update public.invoice set gate_flags = '{foo}'
    where id = 'a1000000-0000-4000-8000-0000000000a1' $$, '23514', null,
  'an unknown gate flag is still rejected');
select is((select count(*) from pg_constraint
    where conrelid = 'public.invoice'::regclass and conname = 'invoice_gate_flags_ck'), 1::bigint,
  'exactly one gate flag constraint remains');

select * from finish();
rollback;
