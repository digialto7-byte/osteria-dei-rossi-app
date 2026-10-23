-- Q6 = owner only (founder 2026-10-23): only the owner confirms an ingredient's allergens. Admin
-- (DigiAlto support), chef and waiter may edit or import allergen lists but can never confirm.
-- 20261023100000 allowed owner and admin; it is already pushed, so this replaces the role check
-- and adds a second guard that holds for every role, the migration owner included.

-- The role check of confirm_ingredient_allergens (it calls this first, before anything else).
create or replace function app.require_allergen_confirmer() returns void
  language plpgsql stable
  set search_path = ''
as $$
begin
  if app.role() is distinct from 'owner' then
    raise exception 'permission denied: only the owner confirms allergens' using errcode = '42501';
  end if;
end
$$;

-- A confirmation can only name an owner of the same tenant, however it is written. Checked when the
-- person is new on the row (insert, or a changed allergens_confirmed_by), so editing another column
-- is not blocked if that owner is later demoted. A person from another tenant is not found here and
-- is refused by the composite foreign key (23503).
create function app.ingredient_confirmer_owner() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_role public.app_role;
begin
  if new.allergens_confirmed_by is not null
     and (tg_op = 'INSERT' or new.allergens_confirmed_by is distinct from old.allergens_confirmed_by) then
    select u.role into v_role from public.app_user u
     where u.tenant_id = new.tenant_id and u.id = new.allergens_confirmed_by;
    if found and v_role <> 'owner' then
      raise exception 'confirmer_not_owner' using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.ingredient_confirmer_owner() from public, anon, authenticated, service_role;

create trigger ingredient_confirmer_owner
  before insert or update on public.ingredient
  for each row execute function app.ingredient_confirmer_owner();
