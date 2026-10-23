-- M11 review fix: create_staff accepted an auth user named staff-<id>@ with ANY domain. The route always
-- creates staff-<id>@staff.invalid (an RFC 2606 reserved TLD that can never receive mail), so the
-- procedure now requires exactly that address. Same body as in 20261025100600_staff_management.sql except for
-- the email test; create or replace keeps the owner and the grants (authenticated only).

create or replace function public.create_staff(
  p_id uuid, p_auth_id uuid, p_display_name text, p_role public.app_role
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_name text := btrim(coalesce(p_display_name, ''));
  v_actor uuid;
begin
  perform app.require_staff_manager();
  v_tenant := app.tenant_id();
  v_actor := app.app_user_id();
  if p_role is null or p_role not in ('chef', 'waiter') then
    raise exception 'staff_role_invalid' using errcode = 'P0001';
  end if;
  if length(v_name) not between 1 and 60 then
    raise exception 'display_name_invalid' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users au
                  where au.id = p_auth_id and au.email = 'staff-' || v_id::text || '@staff.invalid')
     or exists (select 1 from public.app_user u where u.auth_id = p_auth_id) then
    raise exception 'auth_user_invalid' using errcode = 'P0001';
  end if;

  insert into public.app_user (id, tenant_id, auth_id, role, display_name, login_method, created_by)
    values (v_id, v_tenant, p_auth_id, p_role, v_name, 'pin', v_actor);
  insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
    values (v_tenant, 'app_user', v_id, 'app_user.created',
            jsonb_build_object('display_name', v_name, 'role', p_role), v_actor);

  return jsonb_build_object('id', v_id, 'displayName', v_name, 'role', p_role, 'active', true);
end
$$;
