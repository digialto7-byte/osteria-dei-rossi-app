-- M7 step 1: ingredient allergen state (M7 plan §3.1.6, §3.2; ADR-007).
-- Before this, `allergens` was `not null default '{}'`, so a blank read as allergen-free. Now null
-- means "not stated" and '{}' only means "declared: none". A confirmation (who, when) is a separate
-- fact, written only by confirm_ingredient_allergens and cleared by any change of the list.

alter table public.ingredient
  alter column allergens drop not null,
  alter column allergens drop default;

alter table public.ingredient
  add column allergens_confirmed_at timestamptz,
  add column allergens_confirmed_by uuid;

-- app_user (tenant_id, id) is unique since M6 (20261022150100); the FK keeps the person in the tenant.
alter table public.ingredient
  add constraint ingredient_allergens_confirmed_by_fkey
    foreign key (tenant_id, allergens_confirmed_by) references public.app_user (tenant_id, id),
  add constraint ingredient_allergen_confirm_ck
    check ((allergens_confirmed_at is null) = (allergens_confirmed_by is null)),
  add constraint ingredient_allergen_confirmed_list_ck
    check (allergens_confirmed_at is null or allergens is not null);

-- confirmed: a person confirmed the list; unknown: nothing stated; declared: a list, not confirmed.
-- Screens show "da confermare" for unknown and declared.
alter table public.ingredient
  add column allergen_status text generated always as (
    case when allergens_confirmed_at is not null then 'confirmed'
         when allergens is null then 'unknown'
         else 'declared' end) stored;

-- Only the definer procedure writes the confirmation: no insert/update grant on these columns
-- (the table-level SELECT grant of M1 covers reading them).

-- A list as a set: distinct, in enum order. Null stays null.
create function app.allergen_set(p_list public.allergen[]) returns public.allergen[]
  language sql immutable
  set search_path = ''
as $$
  select case when p_list is null then null
              else coalesce((select array_agg(distinct a order by a) from unnest(p_list) a), '{}') end
$$;
revoke all on function app.allergen_set(public.allergen[]) from public, anon;
grant execute on function app.allergen_set(public.allergen[]) to authenticated, service_role;

-- Editing the list clears the confirmation, unless the same statement sets a new confirmation.
create function app.ingredient_allergen_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if app.allergen_set(new.allergens) is distinct from app.allergen_set(old.allergens)
     and new.allergens_confirmed_at is not distinct from old.allergens_confirmed_at then
    new.allergens_confirmed_at := null;
    new.allergens_confirmed_by := null;
  end if;
  return new;
end
$$;
revoke all on function app.ingredient_allergen_guard() from public, anon;

create trigger ingredient_allergen_guard
  before update on public.ingredient
  for each row execute function app.ingredient_allergen_guard();

-- One-off conversion of the rows that exist before M7: no row was ever confirmed, so an empty
-- list was never a statement. Kept as a function so it can be tested on fixture rows.
create function app.allergens_blank_to_unknown() returns integer
  language plpgsql
  set search_path = ''
as $$
declare
  changed integer;
begin
  update public.ingredient
     set allergens = null
   where allergens = '{}' and allergens_confirmed_at is null;
  get diagnostics changed = row_count;
  return changed;
end
$$;
revoke all on function app.allergens_blank_to_unknown() from public, anon, authenticated, service_role;

do $$
begin
  raise notice 'M7: % ingredient(s) with an empty allergen list are now "not stated"',
    app.allergens_blank_to_unknown();
end
$$;

-- The audit lists widen (one migration each, see 20261022140000_audit_event.sql).
alter table public.audit_event
  drop constraint audit_event_entity_type_check,
  drop constraint audit_event_action_check;
alter table public.audit_event
  add constraint audit_event_entity_type_check
    check (entity_type in ('invoice', 'ingredient', 'recipe')),
  add constraint audit_event_action_check
    check (action in ('invoice.approved', 'invoice.rejected', 'invoice.duplicate_cleared',
                      'ingredient.allergens_confirmed', 'recipe.deactivated', 'recipe.reactivated'));

create function app.require_allergen_confirmer() returns void
  language plpgsql stable
  set search_path = ''
as $$
begin
  -- Q6 default: owner and admin. Pending the founder's answer (variant V6: owner only).
  if app.role() is null or app.role() not in ('owner', 'admin') then
    raise exception 'permission denied: confirming allergens needs owner or admin'
      using errcode = '42501';
  end if;
end
$$;
revoke all on function app.require_allergen_confirmer() from public, anon, authenticated, service_role;

-- Confirms an ingredient's allergen list: owner/admin, one transaction, idempotent for the same set.
-- An empty array is the valid "none"; null is refused so a missing value can never confirm.
create function public.confirm_ingredient_allergens(p_ingredient uuid, p_allergens public.allergen[])
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v public.ingredient;
  v_old public.ingredient;
  v_list public.allergen[];
  v_by uuid := app.app_user_id();
begin
  perform app.require_allergen_confirmer();
  if p_allergens is null then
    raise exception 'allergens_required' using errcode = 'P0001';
  end if;
  v_list := app.allergen_set(p_allergens);

  -- FOR NO KEY UPDATE: a recipe line referencing the ingredient takes KEY SHARE, which this allows.
  select * into v
    from public.ingredient i
   where i.id = p_ingredient and i.tenant_id = (select app.tenant_id())
     for no key update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v.allergens_confirmed_at is null or app.allergen_set(v.allergens) is distinct from v_list then
    v_old := v;
    update public.ingredient
       set allergens = v_list,
           allergens_confirmed_at = clock_timestamp(),
           allergens_confirmed_by = v_by
     where id = v.id
     returning * into v;
    insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, created_by)
      values (v.tenant_id, 'ingredient', v.id, 'ingredient.allergens_confirmed',
              jsonb_build_object('allergens', to_jsonb(v_old.allergens), 'status', v_old.allergen_status),
              jsonb_build_object('allergens', to_jsonb(v.allergens)), v_by);
  end if;

  return jsonb_build_object('allergens', to_jsonb(v.allergens), 'status', v.allergen_status,
                            'confirmedAt', v.allergens_confirmed_at, 'confirmedBy', v.allergens_confirmed_by);
end
$$;

revoke all on function public.confirm_ingredient_allergens(uuid, public.allergen[])
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_ingredient_allergens(uuid, public.allergen[]) to authenticated;
