-- SP1 step 7 (docs/plans/2026-11-15-sp01-tenant-config.md section 3.1.3, 3.2, 3.3, 5 step 7; lead decisions 2026-11-18, Q-c): the tenant's default locale, the read of
-- its settings for every role (public.tenant_settings) and the owner/admin write of its settings (public.set_tenant_settings).
--
--   tenant.default_locale     'it' or 'en' (the list equals LOCALES in src/lib/i18n/locale.ts; tests/parity/locale-sql-parity.test.ts). authenticated already
--                             holds table-level SELECT on public.tenant, so a member can read it on its own row through RLS (not cost data); tenant_settings() is the read.
--   public.tenant_settings()  {timeZone, locale, currency, receiptTypes, paymentTypes} for any role of a tenant; NO VAT key (it feeds GET /api/me, which waiters cache and
--                             the cost guard keeps free of VAT, plan flag 1).
--   public.set_tenant_settings(jsonb)  owner or admin (app.require_menu_writer, so #79's aal gate and FD31 apply), one transaction, strict keys: locale, saleVatRates,
--                             receiptTypes, paymentTypes. Rows are never deleted: a rate or code that is no longer offered becomes is_active = false. One audit row
--                             tenant.settings_changed per effective change, with the changed keys only (codes and numbers, no text of the person or the venue).
--
-- The tenant-row lock (lead, Q-c and its lock-mode ruling, 2026-11-18): set_tenant_settings takes SELECT ... FOR NO KEY UPDATE on the tenant row before it reads or
-- changes the lists, and the sale VAT trigger (app.check_sale_vat_rate, re-created here) takes FOR SHARE on the same row before it reads the list. The two conflict, so a
-- rate being switched off cannot slip into a concurrent create_menu_item, update_menu_item or set_sale_settings: the writer either commits before the switch (and the price
-- is legitimate) or waits for it and then meets the new list. FOR SHARE does not conflict with FOR SHARE, so menu writers do not wait for each other; FOR NO KEY UPDATE does
-- not conflict with FOR KEY SHARE, so the foreign-key checks of every other table that points at the tenant do not wait for a settings change (the stronger row lock would
-- block them all). Race tests: scripts/test-db-races.sh, the sale-vat-* cases, menu-writers-no-wait and settings-vs-fk-insert.

alter table public.tenant
  add column default_locale text not null default 'it' constraint tenant_default_locale_check check (default_locale in ('it', 'en'));

-- Step 3's trigger function, re-created with the lock. Everything else (which rate is checked, when, the error codes) is unchanged.
create or replace function app.check_sale_vat_rate() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_rate numeric;
  v_kept numeric;
begin
  -- An if, not a case: a plpgsql `case` that mentions new.coperto_vat_rate fails with 42703 ("record new has no field") on menu_item_price, because the
  -- field is resolved when the statement runs. With an if, only the table's own column is ever read.
  if tg_table_name = 'menu_item_price' then
    v_rate := new.vat_rate;
    if tg_op = 'UPDATE' then
      v_kept := old.vat_rate;
    else
      select p.vat_rate into v_kept
        from public.menu_item_price p
       where p.tenant_id = new.tenant_id and p.menu_item_id = new.menu_item_id
       order by p.valid_from desc, p.created_at desc
       limit 1;
    end if;
  else
    v_rate := new.coperto_vat_rate;
    if tg_op = 'UPDATE' then
      v_kept := old.coperto_vat_rate;
    end if;
  end if;
  if v_rate is not distinct from v_kept then
    return new;
  end if;
  -- Only the tenant's subset within the statute is enforced here. A rate outside the statutory list falls through, so the CHECK on the column keeps
  -- raising 23514 for it (pgTAP 150 is unchanged); a statutory rate outside the tenant's list raises P0001 vat_rate_invalid.
  if v_rate is not null and v_rate = any (app.allowed_vat_rates()) then
    -- The lock comes first, as its own statement: the list is read after it, with a fresh snapshot, so a set_tenant_settings that committed while this waited is seen.
    perform 1 from public.tenant t where t.id = new.tenant_id for share;
    if not (v_rate = any (app.sale_vat_rates(new.tenant_id))) then
      raise exception 'vat_rate_invalid' using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.check_sale_vat_rate() from public, anon, authenticated, service_role;

-- The tenant's settings for the browser: any role of a tenant. No tenant (no token, or a gated owner or admin whose token is not aal2): 42501.
create function public.tenant_settings() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  t public.tenant;
begin
  v_tenant := app.tenant_id();
  if v_tenant is null then
    raise exception 'permission denied: the tenant settings need a signed-in user of a tenant' using errcode = '42501';
  end if;
  select x.* into t from public.tenant x where x.id = v_tenant;
  return jsonb_build_object(
    'timeZone', t.timezone,
    'locale', t.default_locale,
    'currency', t.currency,
    'receiptTypes', to_jsonb(app.tenant_receipt_types(v_tenant)),
    'paymentTypes', to_jsonb(app.tenant_payment_types(v_tenant)));
end
$$;

-- {locale?: 'it' | 'en', saleVatRates?: [rates], receiptTypes?: [codes], paymentTypes?: [codes]}, at least one key, no other. A list is the codes the tenant offers, in
-- the order it wants them (the array order becomes the position); a code left out is switched off, never deleted.
-- Errors: 42501 (role), 22023 invalid_request (shape, unknown key, no key, a list of more than 20), P0001 locale_invalid, settings_list_empty, vat_rate_invalid (outside the
-- statutory list, or twice), receipt_type_invalid and payment_type_invalid (outside the catalogue, or twice).
create function public.set_tenant_settings(p_patch jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_key text;
  v_kind text;
  v_cat text[];
  v_err text;
  v_list text[];
  v_locale text;
  v_vat numeric[];
  v_receipt text[];
  v_payment text[];
  v_old_locale text;
  v_old_vat numeric[];
  v_old_receipt text[];
  v_old_payment text[];
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_changed boolean := false;
begin
  perform app.require_menu_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();
  perform app.menu_keys_ok(p_patch, array['locale', 'saleVatRates', 'receiptTypes', 'paymentTypes'], null);

  -- Validate everything before the lock and before any write.
  if p_patch ? 'locale' then
    if jsonb_typeof(p_patch -> 'locale') <> 'string' then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    v_locale := p_patch ->> 'locale';
    if v_locale <> all (array['it', 'en']) then
      raise exception 'locale_invalid' using errcode = 'P0001';
    end if;
  end if;

  if p_patch ? 'saleVatRates' then
    if jsonb_typeof(p_patch -> 'saleVatRates') <> 'array' or jsonb_array_length(p_patch -> 'saleVatRates') > 20
       or exists (select 1 from jsonb_array_elements(p_patch -> 'saleVatRates') e where jsonb_typeof(e) <> 'number') then
      raise exception 'invalid_request' using errcode = '22023';
    end if;
    if jsonb_array_length(p_patch -> 'saleVatRates') = 0 then
      raise exception 'settings_list_empty' using errcode = 'P0001';
    end if;
    select array_agg((e #>> '{}')::numeric order by (e #>> '{}')::numeric) into v_vat from jsonb_array_elements(p_patch -> 'saleVatRates') e;
    if exists (select 1 from unnest(v_vat) r where r <> all (app.allowed_vat_rates()))
       or (select count(distinct r) from unnest(v_vat) r) <> cardinality(v_vat) then
      raise exception 'vat_rate_invalid' using errcode = 'P0001';
    end if;
  end if;

  foreach v_key in array array['receiptTypes', 'paymentTypes'] loop
    if p_patch ? v_key then
      v_kind := case v_key when 'receiptTypes' then 'receipt' else 'payment' end;
      v_cat := case v_key when 'receiptTypes' then app.receipt_types() else app.payment_type_codes() end;
      v_err := v_kind || '_type_invalid';
      if jsonb_typeof(p_patch -> v_key) <> 'array' or jsonb_array_length(p_patch -> v_key) > 20
         or exists (select 1 from jsonb_array_elements(p_patch -> v_key) e where jsonb_typeof(e) <> 'string') then
        raise exception 'invalid_request' using errcode = '22023';
      end if;
      if jsonb_array_length(p_patch -> v_key) = 0 then
        raise exception 'settings_list_empty' using errcode = 'P0001';
      end if;
      select array_agg(e #>> '{}' order by o) into v_list from jsonb_array_elements(p_patch -> v_key) with ordinality x (e, o);
      if exists (select 1 from unnest(v_list) c where c <> all (v_cat)) or (select count(distinct c) from unnest(v_list) c) <> cardinality(v_list) then
        raise exception '%', v_err using errcode = 'P0001';
      end if;
      if v_kind = 'receipt' then
        v_receipt := v_list;
      else
        v_payment := v_list;
      end if;
    end if;
  end loop;

  -- One writer per tenant, and the lock the sale VAT trigger waits on (Q-c). FOR NO KEY UPDATE, so foreign-key checks against the tenant row do not wait, and as its
  -- own statement: what follows reads with a fresh snapshot.
  perform 1 from public.tenant t where t.id = v_tenant for no key update;
  select t.default_locale into v_old_locale from public.tenant t where t.id = v_tenant;
  v_old_vat := app.sale_vat_rates(v_tenant);
  v_old_receipt := app.tenant_receipt_types(v_tenant);
  v_old_payment := app.tenant_payment_types(v_tenant);

  if v_locale is not null and v_locale is distinct from v_old_locale then
    update public.tenant set default_locale = v_locale where id = v_tenant;
    v_before := v_before || jsonb_build_object('default_locale', v_old_locale);
    v_after := v_after || jsonb_build_object('default_locale', v_locale);
    v_changed := true;
  end if;

  if v_vat is not null and v_vat is distinct from v_old_vat then
    insert into public.tenant_vat_rate as r (tenant_id, rate, is_active, updated_by)
      select v_tenant, s.rate, s.rate = any (v_vat), v_user from unnest(app.allowed_vat_rates()) s (rate)
    on conflict (tenant_id, rate) do update
      set is_active = excluded.is_active, updated_at = now(), updated_by = excluded.updated_by
      where r.is_active is distinct from excluded.is_active;
    v_before := v_before || jsonb_build_object('sale_vat_rates', to_jsonb(v_old_vat));
    v_after := v_after || jsonb_build_object('sale_vat_rates', to_jsonb(app.sale_vat_rates(v_tenant)));
    v_changed := true;
  end if;

  if v_receipt is not null and v_receipt is distinct from v_old_receipt then
    insert into public.tenant_close_code as c (tenant_id, kind, code, position, is_active, updated_by)
      select v_tenant, 'receipt', k.code, coalesce(array_position(v_receipt, k.code), k.ord)::smallint, k.code = any (v_receipt), v_user
        from unnest(app.receipt_types()) with ordinality k (code, ord)
    on conflict (tenant_id, kind, code) do update
      set is_active = excluded.is_active, position = case when excluded.is_active then excluded.position else c.position end, updated_at = now(), updated_by = excluded.updated_by
      where c.is_active is distinct from excluded.is_active or (excluded.is_active and c.position <> excluded.position);
    v_before := v_before || jsonb_build_object('receipt_types', to_jsonb(v_old_receipt));
    v_after := v_after || jsonb_build_object('receipt_types', to_jsonb(v_receipt));
    v_changed := true;
  end if;

  if v_payment is not null and v_payment is distinct from v_old_payment then
    insert into public.tenant_close_code as c (tenant_id, kind, code, position, is_active, updated_by)
      select v_tenant, 'payment', k.code, coalesce(array_position(v_payment, k.code), k.ord)::smallint, k.code = any (v_payment), v_user
        from unnest(app.payment_type_codes()) with ordinality k (code, ord)
    on conflict (tenant_id, kind, code) do update
      set is_active = excluded.is_active, position = case when excluded.is_active then excluded.position else c.position end, updated_at = now(), updated_by = excluded.updated_by
      where c.is_active is distinct from excluded.is_active or (excluded.is_active and c.position <> excluded.position);
    v_before := v_before || jsonb_build_object('payment_types', to_jsonb(v_old_payment));
    v_after := v_after || jsonb_build_object('payment_types', to_jsonb(v_payment));
    v_changed := true;
  end if;

  if v_changed then
    insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, created_by)
      values (v_tenant, 'tenant', v_tenant, 'tenant.settings_changed', v_before, v_after, v_user);
  end if;
  return jsonb_build_object('changed', v_changed,
    'settings', public.tenant_settings() || jsonb_build_object('saleVatRates', to_jsonb(app.sale_vat_rates(v_tenant))));
end
$$;

revoke all on function public.tenant_settings(), public.set_tenant_settings(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.tenant_settings(), public.set_tenant_settings(jsonb) to authenticated;
