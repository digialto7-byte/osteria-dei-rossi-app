-- M11 step 8: the staff session check and logout (M11 plan §3.1.7).
-- withApi calls staff_session_active() on every request that carries a PIN login; false means 401
-- session_ended. Email sessions (no `login` claim) are never affected.

create function public.staff_session_active() returns boolean
  language sql stable
  security definer
  set search_path = ''
as $$
  select case
    when auth.jwt() ->> 'login' is distinct from 'pin' then true
    else coalesce(app.staff_session_open(nullif(auth.jwt() ->> 'session_id', '')::uuid, app.app_user_id(),
                                         clock_timestamp()), false)
  end
$$;

-- Ends the caller's own staff session (logout). A no-op for an email session.
create function public.end_my_staff_session() returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if auth.jwt() ->> 'login' is distinct from 'pin' then
    return;
  end if;
  update public.staff_session s
     set ended_at = clock_timestamp(), end_reason = 'logout'
   where s.auth_session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
     and s.app_user_id = app.app_user_id()
     and s.ended_at is null;
end
$$;

revoke all on function public.staff_session_active(), public.end_my_staff_session()
  from public, anon, authenticated, service_role;
grant execute on function public.staff_session_active(), public.end_my_staff_session() to authenticated;
