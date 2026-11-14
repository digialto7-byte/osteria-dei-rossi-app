select sp0.guard();

-- SP0 scratch 03 (§3.3): one login, several memberships (SP2's shape) and tenant selection.
--  * app_user's unique on auth_id alone is replaced by unique (tenant_id, auth_id);
--  * app.sp0_session_tenant: the tenant a session selected; public.sp0_select_tenant(p_tenant) stores it (42501 unless the caller has an
--    ACTIVE membership there);
--  * the wrapper (replaces 02's) for e-mail accounts: a selection of a still-active membership gives that tenant and role; a selection
--    whose membership is no longer active, or no selection with more than one active membership, gives NO tenant claims; one active
--    membership and no selection is today's behaviour. PIN users and console mode are as before.
do $$
declare
  v_name text;
begin
  select c.conname into v_name
    from pg_constraint c
   where c.conrelid = 'public.app_user'::regclass and c.contype = 'u'
     and (select array_agg(a.attname::text) from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['auth_id'];
  if v_name is null then
    raise exception 'SP0 scratch 03: the unique constraint on app_user (auth_id) is not there (already applied?)';
  end if;
  execute format('alter table public.app_user drop constraint %I', v_name);
end
$$;
alter table public.app_user add constraint sp0_app_user_tenant_auth_key unique (tenant_id, auth_id);

create table app.sp0_session_tenant (
  session_id uuid primary key,
  auth_id uuid not null,
  tenant_id uuid not null,
  created_at timestamptz not null default now()
);
alter table app.sp0_session_tenant enable row level security;
revoke all on app.sp0_session_tenant from public, anon, authenticated, service_role;
grant select on app.sp0_session_tenant to supabase_auth_admin;
create policy sp0_session_tenant_read_by_auth_hook on app.sp0_session_tenant for select to supabase_auth_admin using (true);

create function public.sp0_select_tenant(p_tenant uuid) returns void
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_session uuid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'session_id', '')::uuid;
  v_auth uuid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
begin
  if v_session is null or v_auth is null then
    raise exception 'sp0_select_tenant: the token has no session_id or sub';
  end if;
  if not exists (select 1 from public.app_user u where u.auth_id = v_auth and u.tenant_id = p_tenant and u.is_active) then
    raise exception 'sp0_select_tenant: no active membership there' using errcode = '42501';
  end if;
  insert into app.sp0_session_tenant (session_id, auth_id, tenant_id) values (v_session, v_auth, p_tenant)
    on conflict (session_id) do update set tenant_id = excluded.tenant_id, auth_id = excluded.auth_id;
end
$$;
revoke all on function public.sp0_select_tenant(uuid) from public, anon, authenticated, service_role;
grant execute on function public.sp0_select_tenant(uuid) to authenticated;

-- The wrapper, version 3: 02's console branch and probe claim, plus the membership logic for e-mail accounts.
create or replace function app.custom_access_token_hook(event jsonb) returns jsonb
  language plpgsql stable
  set search_path = ''
as $$
declare
  v_out jsonb := app.sp0_real_hook(event);
  v_in jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_claims jsonb := coalesce(v_out -> 'claims', '{}'::jsonb);
  v_user uuid := (event ->> 'user_id')::uuid;
  v_session uuid := nullif(v_in ->> 'session_id', '')::uuid;
  v_selected uuid;
  v_member record;
  v_active int;
  v_probe jsonb;
begin
  -- E-mail accounts only: a PIN user's claims are the real hook's, untouched.
  if not exists (select 1 from public.app_user u where u.auth_id = v_user and u.login_method = 'pin') then
    select t.tenant_id into v_selected
      from app.sp0_session_tenant t
     where t.session_id = v_session and t.auth_id = v_user;
    select count(*) into v_active from public.app_user u where u.auth_id = v_user and u.is_active;

    if v_selected is not null then
      v_claims := v_claims - 'tenant_id' - 'app_role';
      select u.tenant_id, u.role into v_member
        from public.app_user u
       where u.auth_id = v_user and u.tenant_id = v_selected and u.is_active;
      if found then
        v_claims := v_claims || jsonb_build_object('tenant_id', v_member.tenant_id, 'app_role', v_member.role);
      end if;
    elsif v_active > 1 then
      v_claims := v_claims - 'tenant_id' - 'app_role';
    end if;
  end if;

  if exists (select 1 from app.sp0_console_session s where s.session_id = v_session and s.auth_id = v_user) then
    v_claims := (v_claims - 'tenant_id' - 'app_role' - 'login') || jsonb_build_object('role', 'platform_staff');
  end if;

  v_probe := jsonb_build_object(
    'm', event ->> 'authentication_method',
    'sid', coalesce(v_in ->> 'session_id', '') <> '',
    'keys', (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(v_in) as k)
  );
  return jsonb_set(v_out, '{claims}', v_claims || jsonb_build_object('sp0_in', v_probe));
end
$$;

notify pgrst, 'reload schema';
