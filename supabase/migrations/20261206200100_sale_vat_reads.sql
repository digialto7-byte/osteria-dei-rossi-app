-- SP1 step 4 (docs/plans/2026-11-15-sp01-tenant-config.md section 3.2, 5 step 4; platform plan 5.4 H14, H15): the default sale rate and the owner's two sale reads
-- follow the tenant's SALE VAT list (app.sale_vat_rates, step 3) instead of the statutory one. The statutory list (app.allowed_vat_rates) still bounds the
-- column CHECKs and the purchase side; only the three sale-side reads change, each by one expression:
--   app.default_vat_rate(uuid)      cost_settings.sale_vat_pct counts as a default only if it is in the tenant's sale list (was: the statutory list);
--   public.menu_items_manage()      'vatRates' is the tenant's sale list (was: the statutory list), the same text for a tenant that keeps the five rates;
--   public.sale_settings_read()     the same.
-- Same signatures, same bodies otherwise, same grants. Tenant #1's payloads do not change (pgTAP 389); /api/me gets no VAT key (plan flag 1).

create or replace function app.default_vat_rate(p_tenant uuid) returns numeric
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select c.sale_vat_pct
    from app.cost_settings(p_tenant) c
   where c.sale_vat_pct = any (app.sale_vat_rates(p_tenant))
$$;

create or replace function public.menu_items_manage() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  perform app.require_menu_writer();
  v_tenant := app.tenant_id();
  return jsonb_build_object(
    'defaults', jsonb_build_object('vatRate', app.default_vat_rate(v_tenant)),
    'vatRates', to_jsonb(app.sale_vat_rates(v_tenant)),
    'courses', (select jsonb_agg(e::text order by o) from unnest(enum_range(null::public.course)) with ordinality x(e, o)),
    'categories', coalesce((select jsonb_agg(c.category order by c.category collate "C")
                              from (select distinct i.category from public.menu_item i where i.tenant_id = v_tenant) c),
                           '[]'::jsonb),
    'items', app.menu_items_json(v_tenant, null));
end
$$;

create or replace function public.sale_settings_read() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  perform app.require_menu_writer();
  v_tenant := app.tenant_id();
  return jsonb_build_object(
    'coperto', (select jsonb_build_object('amount', trim_scale(c.amount), 'vatRate', trim_scale(c.vat_rate))
                  from app.coperto_settings(v_tenant) c),
    'defaults', jsonb_build_object('vatRate', app.default_vat_rate(v_tenant)),
    'vatRates', to_jsonb(app.sale_vat_rates(v_tenant)));
end
$$;
revoke all on function app.default_vat_rate(uuid) from public, anon, authenticated, service_role;
revoke all on function public.menu_items_manage(), public.sale_settings_read() from public, anon, authenticated, service_role;
grant execute on function public.menu_items_manage(), public.sale_settings_read() to authenticated;
