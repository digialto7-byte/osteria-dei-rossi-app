-- SP3 step 1 (docs/plans/2026-11-15-sp3-console.md §3.1.1): the organisation-side VAT guard. SP2's tenant-side trigger refuses a tenant whose organisation has
-- another VAT number; nothing guarded a VAT change on the organisation row itself. This trigger refuses it for every role (the migration owner included)
-- while any tenant points at the organisation. A name change, a no-op VAT update and a VAT change on an organisation no tenant points at stay allowed.
-- Moving a tenant to another legal entity stays "update both tenant columns together". The function lives in the platform schema (not app), so the app
-- catalogue pins do not move for it; it is closed to every API role.

create function platform.organisation_vat_locked() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  if new.vat_number is distinct from old.vat_number
     and exists (select 1 from public.tenant t where t.organisation_id = old.id) then
    raise exception 'organisation_vat_in_use' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all on function platform.organisation_vat_locked() from public, anon, authenticated, service_role;

create trigger organisation_vat_locked before update of vat_number on platform.organisation
  for each row execute function platform.organisation_vat_locked();
