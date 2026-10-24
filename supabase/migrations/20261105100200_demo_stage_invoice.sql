-- Demo data step 3 (docs/plans/2026-10-24-demo-data.md §3.1.4; ADR-018): the seed's stand-in for the extraction worker, so
-- fake invoices reach 'review' without calling the extraction provider.
--
-- In ONE transaction it checks that the tenant is the demo, that the creator is an active owner of it and that the file path
-- is <tenant>/<yyyy>/<invoice>.pdf, inserts the invoice, moves it to 'extracting' with a fresh claim token and calls the real
-- public.extraction_complete (header, lines, duplicate check, automap), model name 'demo-seed'. The invoice is never visible
-- as 'received', so extraction_claim (which takes the oldest due invoice of ANY tenant) can never claim it.
--
-- Service role only; the grant is the role gate (as for create_demo_tenant). SECURITY DEFINER because the secret key has no
-- INSERT grant on invoice; every check above runs before any write. The PDF itself is uploaded separately, by the owner's
-- session, through the M2 storage policy.
create function public.demo_stage_invoice(
  p_tenant uuid,
  p_invoice uuid,
  p_file_path text,
  p_file_size integer,
  p_created_by uuid,
  p_result jsonb
) returns public.invoice_status
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_token uuid := gen_random_uuid();
begin
  if not app.tenant_is_demo(p_tenant) then
    raise exception 'not_demo_tenant' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.app_user u
     where u.id = p_created_by and u.tenant_id = p_tenant and u.role = 'owner' and u.is_active
  ) then
    raise exception 'not_tenant_owner' using errcode = '42501';
  end if;
  if p_invoice is null or p_file_path is null
     or p_file_path !~ ('^' || p_tenant::text || '/[0-9]{4}/' || p_invoice::text || '\.pdf$') then
    raise exception 'invalid_file_path' using errcode = 'P0001';
  end if;

  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, original_filename, created_by)
    values (p_invoice, p_tenant, p_file_path, 'application/pdf', p_file_size, 'fattura-di-prova-demo.pdf', p_created_by);
  update public.invoice
     set status = 'extracting', attempts = 1, extraction_started_at = now(), claim_token = v_token
   where id = p_invoice;

  return public.extraction_complete(p_invoice, v_token, p_result, 'demo-seed');
end
$$;
revoke all on function public.demo_stage_invoice(uuid, uuid, text, integer, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.demo_stage_invoice(uuid, uuid, text, integer, uuid, jsonb) to service_role;
