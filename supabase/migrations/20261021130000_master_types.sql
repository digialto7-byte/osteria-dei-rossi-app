-- M1: types and helpers for master data (plan §3.5.1; M1 plan §3).

-- Units: entry units and the base units ingredients are stored in (src/lib/units).
create type public.measure_unit as enum ('kg', 'g', 'l', 'ml', 'pz');
create type public.base_unit as enum ('kg', 'l', 'pz');

-- The 14 allergen groups of EU Regulation 1169/2011, Annex II.
create type public.allergen as enum (
  'glutine', 'crostacei', 'uova', 'pesce', 'arachidi', 'soia', 'latte', 'frutta_a_guscio',
  'sedano', 'senape', 'sesamo', 'solfiti', 'lupini', 'molluschi'
);

-- The caller's active app_user id, for created_by defaults. Same lookup as app.tenant_id().
create function app.app_user_id() returns uuid
  language sql stable security definer
  set search_path = ''
as $$
  select u.id
    from public.app_user u
   where u.auth_id = auth.uid()
     and u.is_active
     and u.tenant_id = nullif(auth.jwt() ->> 'tenant_id', '')::uuid
$$;

-- Lower-case, trimmed, single-spaced: the key for "same name" uniqueness and import matching.
create function app.normalise_name(name text) returns text
  language sql immutable
  set search_path = ''
as $$
  select lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
$$;

-- Italian VAT number: "IT" + 11 digits with a valid check digit. Same algorithm and test
-- vectors as src/lib/vat/it-vat.ts. Null in, null out, so a check constraint allows null.
create function app.is_valid_it_vat(vat text) returns boolean
  language plpgsql immutable
  set search_path = ''
as $$
declare
  digits text;
  digit int;
  doubled int;
  total int := 0;
begin
  if vat is null then
    return null;
  end if;
  if vat !~ '^IT[0-9]{11}$' then
    return false;
  end if;
  digits := substr(vat, 3);
  for position in 1..11 loop
    digit := substr(digits, position, 1)::int;
    if position % 2 = 0 then
      doubled := digit * 2;
      total := total + case when doubled > 9 then doubled - 9 else doubled end;
    else
      total := total + digit;
    end if;
  end loop;
  return total % 10 = 0;
end
$$;

create function app.unit_dimension(unit public.measure_unit) returns text
  language sql immutable
  set search_path = ''
as $$
  select case unit
    when 'kg' then 'mass' when 'g' then 'mass'
    when 'l' then 'volume' when 'ml' then 'volume'
    else 'count'
  end
$$;

revoke all on function app.app_user_id(), app.normalise_name(text), app.is_valid_it_vat(text),
  app.unit_dimension(public.measure_unit) from public, anon;
-- Constraints, indexes and column defaults run these as the calling role.
grant execute on function app.app_user_id(), app.normalise_name(text), app.is_valid_it_vat(text),
  app.unit_dimension(public.measure_unit) to authenticated, service_role;
-- Master-data column defaults call app.* functions, so the secret-key role (scripts, cron) needs
-- the schema too; M0 granted it only to authenticated and supabase_auth_admin.
grant usage on schema app to service_role;
