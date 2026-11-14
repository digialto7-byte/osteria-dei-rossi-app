-- SP2 S1 (docs/plans/2026-11-14-sp2-memberships.md §3.1.1): organisations and H1.
-- One organisation per legal VAT number (Q-S3). A tenant gets its organisation from a trigger, so every insert path stays unchanged and two tenants
-- with one VAT number land in one organisation. tenant.vat_number stays (the per-tenant copy the extraction and XML buyer checks read) but is no
-- longer unique (H1). platform.organisation is platform metadata above tenants: it has no tenant_id, RLS is on, and no API role has any privilege
-- on it or on its schema (Q-S6). legal_name is a client fact: nullable, never filled here (F-4).

create schema platform;
revoke all on schema platform from public, anon, authenticated, service_role;

create table platform.organisation (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  legal_name text check (length(legal_name) between 1 and 200),
  vat_number text not null unique check (vat_number ~ '^IT[0-9]{11}$'),
  created_at timestamptz not null default now()
);
alter table platform.organisation enable row level security;
revoke all on platform.organisation from public, anon, authenticated, service_role;

-- Finds or creates the organisation of a VAT number; returns its id. The name is used only when the organisation is created.
create function app.ensure_organisation(p_name text, p_vat text) returns uuid
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into platform.organisation (name, vat_number) values (p_name, p_vat)
    on conflict (vat_number) do nothing
    returning id into v_id;
  if v_id is null then
    select o.id into v_id from platform.organisation o where o.vat_number = p_vat;
  end if;
  return v_id;
end
$$;
revoke all on function app.ensure_organisation(text, text) from public, anon, authenticated, service_role;

alter table public.tenant add column organisation_id uuid references platform.organisation (id);

-- One organisation per existing VAT number, named after the oldest tenant that holds it; then every tenant points at its organisation.
-- pgTAP cannot express "before this migration", so the backfill was proven by hand (docs/plans/2026-11-14-sp2-memberships.md §11, Build notes).
insert into platform.organisation (name, vat_number)
  select distinct on (t.vat_number) t.name, t.vat_number
    from public.tenant t
   order by t.vat_number, t.created_at, t.id;
update public.tenant t set organisation_id = o.id
  from platform.organisation o
 where o.vat_number = t.vat_number;
alter table public.tenant alter column organisation_id set not null;

-- On insert without an organisation, finds or creates the one of the tenant's VAT number. On every insert and on any change of the organisation or
-- the VAT number, by any role (service_role and the migration owner included), refuses an organisation whose VAT number is not the tenant's: a
-- tenant moves to another legal entity only by changing both together. An update never fills a missing organisation; the not-null refuses it.
create function app.tenant_set_organisation() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.organisation_id is null then
    new.organisation_id := app.ensure_organisation(new.name, new.vat_number);
  end if;
  if new.organisation_id is not null and not exists (
       select 1 from platform.organisation o where o.id = new.organisation_id and o.vat_number = new.vat_number) then
    raise exception 'organisation_vat_mismatch' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all on function app.tenant_set_organisation() from public, anon, authenticated, service_role;

create trigger tenant_set_organisation before insert or update of organisation_id, vat_number on public.tenant
  for each row execute function app.tenant_set_organisation();

alter table public.tenant drop constraint tenant_vat_number_key;
