-- M11 step 6: the access token hook for PIN accounts (M11 plan §3.1.6; ADR-010).
--
-- Email accounts (owner, admin and every existing fixture) keep the M0 logic exactly. A `pin` account gets
-- tenant claims only through our flow:
--   * a password sign-in while a `pending` attempt for it, started under 30 s ago on a device that is neither
--     revoked nor locked, exists (pin_login_begin made it); or
--   * a token refresh whose session_id belongs to an open staff session (app.staff_session_open).
-- Anything else yields no tenant claims and session_state = 'ended'. A password sign-in that bypasses
-- /api/auth/pin (for example with a leaked pepper) therefore gets a token that RLS answers with nothing.
-- The PIN branch sits in an exception block: a bug there strips the claims instead of blocking logins.

-- True while the session is open: not ended, before ends_at, the user active, the device neither revoked nor
-- locked, and the session is that user's.
create function app.staff_session_open(p_auth_session uuid, p_user uuid, p_at timestamptz) returns boolean
  language sql stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
      from public.staff_session s
      join public.app_user u on u.id = s.app_user_id
      join public.venue_device d on d.id = s.device_id
     where s.auth_session_id = p_auth_session
       and s.app_user_id = p_user
       and s.ended_at is null
       and s.ends_at > p_at
       and u.is_active
       and d.revoked_at is null
       and d.locked_at is null)
$$;

-- True while a pin_login_begin attempt for the user is waiting for its Auth call.
create function app.pin_sign_in_allowed(p_user uuid, p_at timestamptz) returns boolean
  language sql stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
      from public.auth_attempt a
      join public.app_user u on u.id = a.app_user_id
      join public.venue_device d on d.id = a.device_id
     where a.app_user_id = p_user
       and a.outcome = 'pending'
       and a.started_at > p_at - interval '30 seconds'
       and a.started_at <= p_at
       and u.is_active
       and d.revoked_at is null
       and d.locked_at is null)
$$;

revoke all on function app.staff_session_open(uuid, uuid, timestamptz),
  app.pin_sign_in_allowed(uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function app.staff_session_open(uuid, uuid, timestamptz),
  app.pin_sign_in_allowed(uuid, timestamptz) to supabase_auth_admin;

-- Same signature, owner and grants as M0's hook (create or replace keeps them).
create or replace function app.custom_access_token_hook(event jsonb) returns jsonb
  language plpgsql stable
  set search_path = ''
as $$
declare
  -- Incoming tenant, role, login and session_state claims are never trusted.
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb)
                  - 'tenant_id' - 'app_role' - 'login' - 'session_state';
  member record;
  pin_user record;
begin
  select u.id, u.tenant_id, u.role
    into pin_user
    from public.app_user u
   where u.auth_id = (event ->> 'user_id')::uuid
     and u.login_method = 'pin';

  if found then
    begin
      if (event ->> 'authentication_method' = 'password'
          and app.pin_sign_in_allowed(pin_user.id, clock_timestamp()))
         or (event ->> 'authentication_method' = 'token_refresh'
             and app.staff_session_open(nullif(event -> 'claims' ->> 'session_id', '')::uuid, pin_user.id,
                                        clock_timestamp())) then
        claims := claims || jsonb_build_object('tenant_id', pin_user.tenant_id, 'app_role', pin_user.role,
                                               'login', 'pin');
      else
        claims := claims || jsonb_build_object('session_state', 'ended');
      end if;
    exception when others then
      claims := (coalesce(event -> 'claims', '{}'::jsonb)
                 - 'tenant_id' - 'app_role' - 'login' - 'session_state')
                || jsonb_build_object('session_state', 'ended');
    end;
    return jsonb_set(event, '{claims}', claims);
  end if;

  -- Email accounts: the M0 logic.
  select u.tenant_id, u.role
    into member
    from public.app_user u
   where u.auth_id = (event ->> 'user_id')::uuid
     and u.is_active;

  if found then
    claims := claims
      || jsonb_build_object('tenant_id', member.tenant_id, 'app_role', member.role);
  end if;

  return jsonb_set(event, '{claims}', claims);
end
$$;
