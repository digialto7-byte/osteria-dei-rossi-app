-- M17 step 5: the dining table procedures and the coperto settings (M17 plan §3.1.2, §3.1.3, §3.2; ADR-016).
-- Same conventions as 20261031100200_menu_procedures.sql: security definer, empty search_path, role first (owner, admin),
-- tenant from app.tenant_id(), 22023 invalid_request for shape errors, P0002 table_not_found, P0001 business codes,
-- one audit_event per change, nothing written when nothing changed.

-- The manage shape of tables (all of the tenant's when p_ids is null): active first, then position, name, id.
create function app.dining_tables_json(p_tenant uuid, p_ids uuid[]) returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'name', t.name,
           'position', t.position,
           'active', t.is_active,
           'open', exists (select 1 from public.table_session s
                            where s.tenant_id = t.tenant_id and s.dining_table_id = t.id and s.closed_at is null))
         order by t.is_active desc, t.position, t.name collate "C", t.id), '[]'::jsonb)
    from public.dining_table t
   where t.tenant_id = p_tenant and (p_ids is null or t.id = any (p_ids))
$$;
revoke all on function app.dining_tables_json(uuid, uuid[]) from public, anon, authenticated, service_role;

create function public.create_dining_table(p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_name text;
  v_position integer := 0;
  v_id uuid;
  v_con text;
begin
  perform app.require_menu_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();
  perform app.menu_keys_ok(p_body, array['name', 'position'], array['name']);
  v_name := app.menu_text(p_body -> 'name', 40, 'name_invalid');
  if p_body ? 'position' then
    v_position := app.menu_int(p_body -> 'position', 0, 9999, 'position_invalid');
  end if;
  if exists (select 1 from public.dining_table o
              where o.tenant_id = v_tenant and o.is_active and o.name_norm = app.normalise_name(v_name)) then
    raise exception 'table_name_taken' using errcode = 'P0001';
  end if;
  begin
    insert into public.dining_table (tenant_id, name, position, created_by, updated_by)
      values (v_tenant, v_name, v_position, v_user, v_user)
      returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'dining_table_name_uq' then
      raise exception 'table_name_taken' using errcode = 'P0001';
    end if;
    raise;
  end;
  insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
    values (v_tenant, 'dining_table', v_id, 'dining_table.created',
            jsonb_build_object('name', v_name, 'position', v_position, 'is_active', true), v_user);
  return jsonb_build_object('table', (app.dining_tables_json(v_tenant, array[v_id])) -> 0);
end
$$;

create function public.update_dining_table(p_table uuid, p_patch jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  t public.dining_table;
  v_name text;
  v_position integer;
  v_active boolean;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_con text;
begin
  perform app.require_menu_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();
  perform app.menu_keys_ok(p_patch, array['name', 'position', 'active'], null);

  -- The same row lock open_table takes first: a deactivation and an opening of one table are serialised.
  select x.* into t from public.dining_table x
   where x.tenant_id = v_tenant and x.id = p_table
     for update;
  if not found then
    raise exception 'table_not_found' using errcode = 'P0002';
  end if;

  v_name := case when p_patch ? 'name' then app.menu_text(p_patch -> 'name', 40, 'name_invalid') else t.name end;
  v_position := case when p_patch ? 'position' then app.menu_int(p_patch -> 'position', 0, 9999, 'position_invalid')
                     else t.position end;
  v_active := case when p_patch ? 'active' then app.menu_bool(p_patch -> 'active') else t.is_active end;

  if t.is_active and not v_active
     and exists (select 1 from public.table_session s
                  where s.tenant_id = v_tenant and s.dining_table_id = t.id and s.closed_at is null) then
    raise exception 'table_open' using errcode = 'P0001';
  end if;
  if v_active and (app.normalise_name(v_name) <> t.name_norm or not t.is_active)
     and exists (select 1 from public.dining_table o
                  where o.tenant_id = v_tenant and o.is_active and o.name_norm = app.normalise_name(v_name)
                    and o.id <> t.id) then
    raise exception 'table_name_taken' using errcode = 'P0001';
  end if;

  if v_name is distinct from t.name then
    v_before := v_before || jsonb_build_object('name', t.name);
    v_after := v_after || jsonb_build_object('name', v_name);
  end if;
  if v_position is distinct from t.position then
    v_before := v_before || jsonb_build_object('position', t.position);
    v_after := v_after || jsonb_build_object('position', v_position);
  end if;
  if v_active is distinct from t.is_active then
    v_before := v_before || jsonb_build_object('is_active', t.is_active);
    v_after := v_after || jsonb_build_object('is_active', v_active);
  end if;
  if v_before = '{}'::jsonb then
    return jsonb_build_object('changed', false, 'table', (app.dining_tables_json(v_tenant, array[t.id])) -> 0);
  end if;

  begin
    update public.dining_table
       set name = v_name, position = v_position, is_active = v_active, updated_at = now(), updated_by = v_user
     where tenant_id = v_tenant and id = t.id;
  exception when unique_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'dining_table_name_uq' then
      raise exception 'table_name_taken' using errcode = 'P0001';
    end if;
    raise;
  end;
  insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, created_by)
    values (v_tenant, 'dining_table', t.id, 'dining_table.updated', v_before, v_after, v_user);
  return jsonb_build_object('changed', true, 'table', (app.dining_tables_json(v_tenant, array[t.id])) -> 0);
end
$$;

create function public.dining_tables_manage() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_menu_writer();
  return jsonb_build_object('tables', app.dining_tables_json(app.tenant_id(), null));
end
$$;

create function public.sale_settings_read() returns jsonb
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
    'vatRates', to_jsonb(app.allowed_vat_rates()));
end
$$;

-- {copertoAmount: number (0, 100] with two decimals | null, copertoVatRate: allowed rate | null}, both keys required.
-- Both null clears the coperto; exactly one null is coperto_invalid.
create function public.set_sale_settings(p_patch jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  v_amount numeric;
  v_vat numeric;
  s public.sale_settings;
  v_found boolean;
  v_id uuid;
begin
  perform app.require_menu_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();
  perform app.menu_keys_ok(p_patch, array['copertoAmount', 'copertoVatRate'], array['copertoAmount', 'copertoVatRate']);

  if jsonb_typeof(p_patch -> 'copertoAmount') = 'number' then
    v_amount := (p_patch ->> 'copertoAmount')::numeric;
  elsif jsonb_typeof(p_patch -> 'copertoAmount') <> 'null' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if jsonb_typeof(p_patch -> 'copertoVatRate') = 'number' then
    v_vat := (p_patch ->> 'copertoVatRate')::numeric;
  elsif jsonb_typeof(p_patch -> 'copertoVatRate') <> 'null' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if (v_amount is null) <> (v_vat is null) then
    raise exception 'coperto_invalid' using errcode = 'P0001';
  end if;
  if v_amount is not null then
    if v_amount <= 0 or v_amount > 100 or v_amount <> round(v_amount, 2) then
      raise exception 'coperto_invalid' using errcode = 'P0001';
    end if;
    if not (v_vat = any (app.allowed_vat_rates())) then
      raise exception 'vat_rate_invalid' using errcode = 'P0001';
    end if;
  end if;

  -- One writer per tenant at a time: the settings row may not exist yet, so the tenant row is the lock.
  perform 1 from public.tenant t where t.id = v_tenant for no key update;
  select x.* into s from public.sale_settings x where x.tenant_id = v_tenant;
  v_found := found;
  if (not v_found and v_amount is null)
     or (v_found and s.coperto_amount is not distinct from v_amount and s.coperto_vat_rate is not distinct from v_vat) then
    return jsonb_build_object('changed', false, 'coperto',
      case when v_amount is null then null
           else jsonb_build_object('amount', trim_scale(v_amount), 'vatRate', trim_scale(v_vat)) end);
  end if;

  if v_found then
    update public.sale_settings
       set coperto_amount = v_amount, coperto_vat_rate = v_vat, updated_at = now(), updated_by = v_user
     where tenant_id = v_tenant
     returning id into v_id;
  else
    insert into public.sale_settings (tenant_id, coperto_amount, coperto_vat_rate, created_by, updated_by)
      values (v_tenant, v_amount, v_vat, v_user, v_user)
      returning id into v_id;
  end if;
  insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, created_by)
    values (v_tenant, 'sale_settings', v_id, 'sale_settings.changed',
      jsonb_build_object('coperto_amount', trim_scale(s.coperto_amount), 'coperto_vat_rate', trim_scale(s.coperto_vat_rate)),
      jsonb_build_object('coperto_amount', trim_scale(v_amount), 'coperto_vat_rate', trim_scale(v_vat)), v_user);
  return jsonb_build_object('changed', true, 'coperto',
    case when v_amount is null then null
         else jsonb_build_object('amount', trim_scale(v_amount), 'vatRate', trim_scale(v_vat)) end);
end
$$;

revoke all on function public.create_dining_table(jsonb), public.update_dining_table(uuid, jsonb),
  public.dining_tables_manage(), public.sale_settings_read(), public.set_sale_settings(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_dining_table(jsonb), public.update_dining_table(uuid, jsonb),
  public.dining_tables_manage(), public.sale_settings_read(), public.set_sale_settings(jsonb) to authenticated;
