-- M5 step 4: helpers for invoice approval (M5 plan §3.3), in schema app, which the Data API does
-- not expose. Execute is revoked from public, anon and authenticated: the approval procedures are
-- SECURITY DEFINER and call these as their owner.

-- Owner and admin approve invoices (plan §3.11.2). Kept apart from require_invoice_reviewer so a
-- future change to who may review cannot silently grant approval. Founder decision 2026-10-22:
-- the chef neither reviews nor approves.
create function app.require_invoice_approver() returns void
  language plpgsql
  set search_path = ''
as $$
begin
  if coalesce((select app.role())::text, '') not in ('owner', 'admin') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
end
$$;

-- The calendar day at the venue for a moment in time (the tenant's time zone, e.g. Europe/Rome).
-- Daylight saving is handled by the time zone database, not by an offset.
create function app.venue_date(p_at timestamptz, p_tz text) returns date
  language sql immutable
  set search_path = ''
as $$
  select (p_at at time zone p_tz)::date
$$;

-- Base units per one line unit (M5 plan §3.2), or null when the line cannot be converted to the
-- ingredient's base unit: the unit is missing or unknown, its dimension differs from the base
-- unit's, or it is `conf` and the supplier item's pack is missing or of another dimension.
--   kg, l, pz -> 1; g, ml -> 0.001; conf -> pack_count x pack_qty x factor(pack_unit).
-- One implementation in SQL; src/lib/units/convert.ts (toIngredientBase) is pinned to it by
-- tests/parity/approval-sql-parity.test.ts.
create function app.base_factor(
  p_unit text, p_base public.base_unit, p_pack_count numeric, p_pack_qty numeric,
  p_pack_unit public.measure_unit
) returns numeric
  language sql immutable
  set search_path = ''
as $$
  select case
    when p_unit is null or p_base is null then null
    when p_unit = 'conf' then
      case
        when p_pack_count is null or p_pack_qty is null or p_pack_unit is null then null
        when p_pack_count <= 0 or p_pack_qty <= 0 then null
        when (case p_pack_unit::text
                when 'kg' then 'kg' when 'g' then 'kg'
                when 'l' then 'l' when 'ml' then 'l' else 'pz' end) <> p_base::text then null
        else p_pack_count * p_pack_qty
             * (case when p_pack_unit::text in ('g', 'ml') then 0.001 else 1 end)
      end
    when (case p_unit
            when 'kg' then 'kg' when 'g' then 'kg'
            when 'l' then 'l' when 'ml' then 'l'
            when 'pz' then 'pz' end) is distinct from p_base::text then null
    else case when p_unit in ('g', 'ml') then 0.001 else 1 end
  end
$$;

revoke all on function
  app.require_invoice_approver(),
  app.venue_date(timestamptz, text),
  app.base_factor(text, public.base_unit, numeric, numeric, public.measure_unit)
  from public, anon, authenticated;
