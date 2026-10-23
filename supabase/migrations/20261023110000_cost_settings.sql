-- M8 step 1: cost settings, the ingredient cost basis history and fixed costs (M8 plan §3.1.3,
-- §3.1.7, §3.1.8, §3.2; ADR-008).
--
-- Q16 = V6 (founder 2026-10-23): costs are for the owner and the admin. Every table and procedure
-- below refuses the chef and the waiter in Postgres (42501, or 0 rows under RLS). Tenant settings
-- hold no euro value (every member of the tenant reads the tenant row); euro figures live in
-- fixed_cost_period, which only owner and admin read.

-- Role helpers. Not callable by any API role: only the definer procedures call them, and they run
-- as the migration owner. The role comes from app.role() (the live app_user row), never the token.
create function app.require_cost_reader() returns void
  language plpgsql stable
  set search_path = ''
as $$
begin
  if app.role() is null or app.role() not in ('owner', 'admin') then
    raise exception 'permission denied: costs need owner or admin' using errcode = '42501';
  end if;
end
$$;

-- The chef reads percentages only (plate_margins_pct, step 4).
create function app.require_margin_reader() returns void
  language plpgsql stable
  set search_path = ''
as $$
begin
  if app.role() is null or app.role() not in ('owner', 'admin', 'chef') then
    raise exception 'permission denied: margins need owner, admin or chef' using errcode = '42501';
  end if;
end
$$;

-- A numeric setting from tenant.settings, or the default when it is missing, not a number, not an
-- integer where one is needed, or out of range. A bad stored value never breaks a cost read.
create function app.setting_number(
  p_settings jsonb, p_key text, p_default numeric, p_min numeric, p_max numeric, p_integer boolean
) returns numeric
  language sql immutable
  set search_path = ''
as $$
  select case when jsonb_typeof(p_settings -> p_key) = 'number' then
           case when (p_settings ->> p_key)::numeric between p_min and p_max
                     and (not p_integer or (p_settings ->> p_key)::numeric = trunc((p_settings ->> p_key)::numeric))
                then (p_settings ->> p_key)::numeric
                else p_default end
         else p_default end
$$;

-- The three cost settings of a tenant, with their defaults (the one place the defaults live).
create function app.cost_settings(p_tenant uuid)
  returns table (avg_cost_n integer, price_variance_pct numeric, sale_vat_pct numeric)
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_settings jsonb;
begin
  select t.settings into v_settings from public.tenant t where t.id = p_tenant;
  if not found then
    raise exception 'tenant_not_found' using errcode = 'P0002';
  end if;
  return query select
    app.setting_number(v_settings, 'avg_cost_n', 3, 1, 10, true)::integer,
    app.setting_number(v_settings, 'price_variance_pct', 10, 1, 100, false),
    app.setting_number(v_settings, 'sale_vat_pct', 10, 0, 30, false);
end
$$;

-- One transaction advisory lock per ingredient, in id order, so two sessions that share ingredients
-- take them in the same order and cannot deadlock. A hash collision only adds a wait.
create function app.lock_ingredient_costs(p_tenant uuid, p_ids uuid[]) returns void
  language plpgsql
  set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in
    select x from unnest(p_ids) x where x is not null group by x order by x
  loop
    perform pg_advisory_xact_lock(hashtext('ingredient_cost'), hashtext(p_tenant::text || v_id::text));
  end loop;
end
$$;

revoke all on function app.require_cost_reader(), app.require_margin_reader(),
  app.setting_number(jsonb, text, numeric, numeric, numeric, boolean), app.cost_settings(uuid),
  app.lock_ingredient_costs(uuid, uuid[])
  from public, anon, authenticated, service_role;

-- The audit lists widen (one migration each, see 20261023100000).
alter table public.audit_event
  drop constraint audit_event_entity_type_check,
  drop constraint audit_event_action_check;
alter table public.audit_event
  add constraint audit_event_entity_type_check
    check (entity_type in ('invoice', 'ingredient', 'recipe', 'tenant')),
  add constraint audit_event_action_check
    check (action in ('invoice.approved', 'invoice.rejected', 'invoice.duplicate_cleared',
                      'ingredient.allergens_confirmed', 'recipe.deactivated', 'recipe.reactivated',
                      'tenant.settings_changed'));

create function public.cost_settings() returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  s record;
begin
  perform app.require_cost_reader();
  select * into s from app.cost_settings(app.tenant_id());
  return jsonb_build_object('avgCostN', s.avg_cost_n,
    'priceVariancePct', trim_scale(s.price_variance_pct), 'saleVatPct', trim_scale(s.sale_vat_pct));
end
$$;

-- Patch some of the three settings. Unknown keys, wrong types and out-of-range values are refused
-- together as settings_invalid with a JSON detail [{field, code}] (unknown_field, invalid_value,
-- out_of_range). A patch that changes nothing writes nothing and is not audited.
create function public.update_cost_settings(p_patch jsonb) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_errors jsonb := '[]';
  v_before jsonb;
  v_after jsonb;
  v_old record;
  e record;
  v_num numeric;
  v_lo numeric;
  v_hi numeric;
  v_current numeric;
begin
  perform app.require_cost_reader();
  v_tenant := app.tenant_id();

  if jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'settings_invalid' using errcode = 'P0001',
      detail = jsonb_build_array(jsonb_build_object('field', '', 'code', 'invalid_value'))::text;
  end if;
  for e in select k.key, k.value from jsonb_each(p_patch) k order by k.key collate "C" loop
    if e.key not in ('avg_cost_n', 'price_variance_pct', 'sale_vat_pct') then
      v_errors := v_errors || jsonb_build_object('field', e.key, 'code', 'unknown_field');
    elsif jsonb_typeof(e.value) <> 'number' then
      v_errors := v_errors || jsonb_build_object('field', e.key, 'code', 'invalid_value');
    else
      v_num := (e.value #>> '{}')::numeric;
      select r.lo, r.hi into v_lo, v_hi
        from (values ('avg_cost_n', 1, 10), ('price_variance_pct', 1, 100), ('sale_vat_pct', 0, 30)) r (k, lo, hi)
       where r.k = e.key;
      if (e.key = 'avg_cost_n' and v_num <> trunc(v_num))
         or (e.key <> 'avg_cost_n' and round(v_num, 2) <> v_num) then
        v_errors := v_errors || jsonb_build_object('field', e.key, 'code', 'invalid_value');
      elsif v_num < v_lo or v_num > v_hi then
        v_errors := v_errors || jsonb_build_object('field', e.key, 'code', 'out_of_range');
      end if;
    end if;
  end loop;
  if jsonb_array_length(v_errors) > 0 then
    raise exception 'settings_invalid' using errcode = 'P0001', detail = v_errors::text;
  end if;

  -- The tenant row, then the effective values under the lock.
  perform 1 from public.tenant t where t.id = v_tenant for no key update;
  select * into v_old from app.cost_settings(v_tenant);

  v_before := '{}';
  v_after := '{}';
  for e in select k.key, trim_scale((k.value #>> '{}')::numeric) as num
             from jsonb_each(p_patch) k order by k.key collate "C"
  loop
    v_current := case e.key when 'avg_cost_n' then v_old.avg_cost_n
                            when 'price_variance_pct' then v_old.price_variance_pct
                            else v_old.sale_vat_pct end;
    if e.num <> v_current then
      v_before := v_before || jsonb_build_object(e.key, trim_scale(v_current));
      v_after := v_after || jsonb_build_object(e.key, e.num);
    end if;
  end loop;

  if v_after <> '{}'::jsonb then
    update public.tenant set settings = settings || v_after where id = v_tenant;
    insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, created_by)
      values (v_tenant, 'tenant', v_tenant, 'tenant.settings_changed', v_before, v_after,
              app.app_user_id());
  end if;
  return public.cost_settings();
end
$$;

-- How an ingredient's unit cost is taken from its purchases (PRD 1.4).
create type public.cost_basis as enum ('moving_average', 'last_price');

-- The basis setting of an ingredient as an append-only history, not a column on ingredient (the
-- chef reads ingredient): the newest row in force wins, no row means moving_average, and a cost
-- "as of" a date uses the basis then in force. Written by set_ingredient_cost_basis only.
create table public.ingredient_cost_basis (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id),
  ingredient_id uuid not null,
  basis public.cost_basis not null,
  valid_from timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  constraint ingredient_cost_basis_ingredient_fkey foreign key (tenant_id, ingredient_id)
    references public.ingredient (tenant_id, id),
  constraint ingredient_cost_basis_created_by_fkey foreign key (tenant_id, created_by)
    references public.app_user (tenant_id, id)
);
create index ingredient_cost_basis_idx
  on public.ingredient_cost_basis (tenant_id, ingredient_id, valid_from desc);

-- Monthly business totals in EUR, net of VAT (M8 Q5). Append-only: a correction is a new row for
-- the same month and the newest row of a month wins. Totals only, never per person.
create table public.fixed_cost_period (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id),
  month date not null check (month = date_trunc('month', month)::date),
  rent numeric(12, 2) not null check (rent between 0 and 1000000),
  labour numeric(12, 2) not null check (labour between 0 and 1000000),
  utilities numeric(12, 2) not null check (utilities between 0 and 1000000),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null,
  constraint fixed_cost_period_created_by_fkey foreign key (tenant_id, created_by)
    references public.app_user (tenant_id, id)
);
create index fixed_cost_period_idx on public.fixed_cost_period (tenant_id, month desc, created_at desc);
comment on table public.fixed_cost_period is
  'EUR per month, net of VAT (M8 Q5); monthly totals only, never per person';

alter table public.ingredient_cost_basis enable row level security;
alter table public.fixed_cost_period enable row level security;

revoke all on public.ingredient_cost_basis, public.fixed_cost_period from anon, authenticated, service_role;
grant select on public.ingredient_cost_basis, public.fixed_cost_period to authenticated;

create policy ingredient_cost_basis_select on public.ingredient_cost_basis
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
create policy fixed_cost_period_select on public.fixed_cost_period
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));

create trigger ingredient_cost_basis_append_only
  before update or delete on public.ingredient_cost_basis
  for each row execute function app.append_only();
create trigger ingredient_cost_basis_no_truncate
  before truncate on public.ingredient_cost_basis
  for each statement execute function app.append_only_truncate();
create trigger fixed_cost_period_append_only
  before update or delete on public.fixed_cost_period
  for each row execute function app.append_only();
create trigger fixed_cost_period_no_truncate
  before truncate on public.fixed_cost_period
  for each statement execute function app.append_only_truncate();

-- Change the basis of an ingredient. The same basis again returns the row in force.
create function public.set_ingredient_cost_basis(p_ingredient uuid, p_basis public.cost_basis)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_cur record;
  v_current public.cost_basis;
  v_from timestamptz;
begin
  perform app.require_cost_reader();
  v_tenant := app.tenant_id();
  if p_basis is null then
    raise exception 'basis_invalid' using errcode = 'P0001';
  end if;
  perform 1 from public.ingredient i where i.tenant_id = v_tenant and i.id = p_ingredient;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- The ingredient cost lock alone (approve_invoice takes the same lock before its price rows).
  perform app.lock_ingredient_costs(v_tenant, array[p_ingredient]);

  select b.basis, b.valid_from into v_cur
    from public.ingredient_cost_basis b
   where b.tenant_id = v_tenant and b.ingredient_id = p_ingredient
   order by b.valid_from desc
   limit 1;
  v_current := coalesce(v_cur.basis, 'moving_average');
  if v_current = p_basis then
    return jsonb_build_object('ingredientId', p_ingredient, 'basis', v_current,
      'validFrom', v_cur.valid_from);
  end if;

  -- Strictly later than the newest row, even if a clock ran ahead.
  v_from := greatest(clock_timestamp(), v_cur.valid_from + interval '1 microsecond');
  insert into public.ingredient_cost_basis (tenant_id, ingredient_id, basis, valid_from, created_by)
    values (v_tenant, p_ingredient, p_basis, v_from, app.app_user_id());
  return jsonb_build_object('ingredientId', p_ingredient, 'basis', p_basis, 'validFrom', v_from);
end
$$;

-- Enter (or correct) the fixed costs of a month. Errors are fixed_cost_invalid with a JSON detail
-- [{field, code}] (month_not_first_day, month_too_far, invalid_value, out_of_range). The same
-- figures as the month's newest row (a double tap) return that row.
create function public.enter_fixed_costs(
  p_month date, p_rent numeric, p_labour numeric, p_utilities numeric
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_tz text;
  v_errors jsonb := '[]';
  v_field text;
  v_value numeric;
  v_row public.fixed_cost_period;
begin
  perform app.require_cost_reader();
  v_tenant := app.tenant_id();
  select t.timezone into v_tz from public.tenant t where t.id = v_tenant;

  if p_month is null or p_month <> date_trunc('month', p_month)::date then
    v_errors := v_errors || jsonb_build_object('field', 'month', 'code', 'month_not_first_day');
  elsif p_month > (date_trunc('month', app.venue_date(now(), v_tz)) + interval '1 month')::date then
    v_errors := v_errors || jsonb_build_object('field', 'month', 'code', 'month_too_far');
  end if;
  for v_field, v_value in
    select * from (values ('rent', p_rent), ('labour', p_labour), ('utilities', p_utilities)) f (n, v)
  loop
    if v_value is null or round(v_value, 2) <> v_value then
      v_errors := v_errors || jsonb_build_object('field', v_field, 'code', 'invalid_value');
    elsif v_value not between 0 and 1000000 then
      v_errors := v_errors || jsonb_build_object('field', v_field, 'code', 'out_of_range');
    end if;
  end loop;
  if jsonb_array_length(v_errors) > 0 then
    raise exception 'fixed_cost_invalid' using errcode = 'P0001', detail = v_errors::text;
  end if;

  -- Two taps at once: the second finds the first's row.
  perform pg_advisory_xact_lock(hashtext('fixed_cost'), hashtext(v_tenant::text || p_month::text));
  select * into v_row
    from public.fixed_cost_period f
   where f.tenant_id = v_tenant and f.month = p_month
   order by f.created_at desc, f.id desc
   limit 1;
  if not found or (v_row.rent, v_row.labour, v_row.utilities) is distinct from (p_rent, p_labour, p_utilities)
  then
    insert into public.fixed_cost_period (tenant_id, month, rent, labour, utilities, created_by)
      values (v_tenant, p_month, p_rent, p_labour, p_utilities, app.app_user_id())
      returning * into v_row;
  end if;
  return jsonb_build_object('id', v_row.id, 'month', v_row.month, 'rent', v_row.rent,
    'labour', v_row.labour, 'utilities', v_row.utilities,
    'total', v_row.rent + v_row.labour + v_row.utilities);
end
$$;

revoke all on function public.cost_settings(), public.update_cost_settings(jsonb),
  public.set_ingredient_cost_basis(uuid, public.cost_basis),
  public.enter_fixed_costs(date, numeric, numeric, numeric)
  from public, anon, authenticated, service_role;
grant execute on function public.cost_settings(), public.update_cost_settings(jsonb),
  public.set_ingredient_cost_basis(uuid, public.cost_basis),
  public.enter_fixed_costs(date, numeric, numeric, numeric)
  to authenticated;
