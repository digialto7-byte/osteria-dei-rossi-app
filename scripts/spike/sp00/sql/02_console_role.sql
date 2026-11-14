select sp0.guard();

-- SP0 scratch 02 (§3.3): the console role and its probes.
--  * role platform_staff (NOLOGIN), granted to authenticator so PostgREST can switch to it; no privilege on any public table;
--  * app.sp0_console_session: sessions in console mode; sp0_select_console() adds the caller's session, sp0_leave_console() removes it;
--  * the wrapper (replaces 01's) sets role = platform_staff and strips the tenant claims for a session that is in console mode;
--  * sp0_platform_ping() answers only to platform_staff; sp0_rt_probe is the Realtime probe table.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'platform_staff') then
    create role platform_staff nologin;
  end if;
end
$$;
grant platform_staff to authenticator;
grant usage on schema public to platform_staff;

create table app.sp0_console_session (
  session_id uuid primary key,
  auth_id uuid not null,
  created_at timestamptz not null default now()
);
alter table app.sp0_console_session enable row level security;
revoke all on app.sp0_console_session from public, anon, authenticated, service_role;
grant select on app.sp0_console_session to supabase_auth_admin;
create policy sp0_console_session_read_by_auth_hook on app.sp0_console_session for select to supabase_auth_admin using (true);

create function public.sp0_select_console() returns void
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_session uuid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'session_id', '')::uuid;
  v_auth uuid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
begin
  if v_session is null or v_auth is null then
    raise exception 'sp0_select_console: the token has no session_id or sub';
  end if;
  insert into app.sp0_console_session (session_id, auth_id) values (v_session, v_auth) on conflict (session_id) do nothing;
end
$$;

create function public.sp0_leave_console() returns void
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_session uuid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'session_id', '')::uuid;
  v_auth uuid := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
begin
  if v_session is null or v_auth is null then
    raise exception 'sp0_leave_console: the token has no session_id or sub';
  end if;
  delete from app.sp0_console_session where session_id = v_session and auth_id = v_auth;
end
$$;

-- Invoker on purpose: current_user must be the role PostgREST switched to.
create function public.sp0_platform_ping() returns jsonb
  language sql stable
  set search_path = ''
as $$
  select jsonb_build_object(
    'current_user', current_user,
    'tenant_claim', coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ? 'tenant_id', false))
$$;

revoke all on function public.sp0_select_console(), public.sp0_leave_console(), public.sp0_platform_ping()
  from public, anon, authenticated, service_role;
grant execute on function public.sp0_select_console() to authenticated;
grant execute on function public.sp0_leave_console(), public.sp0_platform_ping() to platform_staff;

create table public.sp0_rt_probe (
  id bigserial primary key,
  tenant_id uuid not null,
  note text
);
alter table public.sp0_rt_probe enable row level security;
revoke all on public.sp0_rt_probe from public, anon, authenticated, service_role;
grant select, insert on public.sp0_rt_probe to authenticated;
grant usage on sequence public.sp0_rt_probe_id_seq to authenticated;
create policy sp0_rt_probe_select on public.sp0_rt_probe for select to authenticated using (tenant_id = (select app.tenant_id()));
create policy sp0_rt_probe_insert on public.sp0_rt_probe for insert to authenticated with check (tenant_id = (select app.tenant_id()));

-- Realtime: the publication exists on Supabase; if not, create it. Which case applied is returned by the last query.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    perform set_config('sp0.publication_case', 'supabase_realtime existed', false);
  else
    create publication supabase_realtime;
    perform set_config('sp0.publication_case', 'supabase_realtime created by SP0', false);
  end if;
end
$$;
alter publication supabase_realtime add table public.sp0_rt_probe;

-- The wrapper, version 2: 01's probe claim plus console mode.
create or replace function app.custom_access_token_hook(event jsonb) returns jsonb
  language plpgsql stable
  set search_path = ''
as $$
declare
  v_out jsonb := app.sp0_real_hook(event);
  v_in jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_claims jsonb := coalesce(v_out -> 'claims', '{}'::jsonb);
  v_probe jsonb;
begin
  if exists (
    select 1 from app.sp0_console_session s
     where s.session_id = nullif(v_in ->> 'session_id', '')::uuid
       and s.auth_id = (event ->> 'user_id')::uuid
  ) then
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

select current_setting('sp0.publication_case') as publication_case;
