-- SP3 step 12 (docs/plans/2026-11-15-sp3-console.md §3.1.6, §3.3.3, §3.3.4; AT5, AT9): the platform notices and the console shell's own read.
--  * platform.notice: one row per (kind, version), append-only for every role like the platform audit; the kinds are platform.notice_kinds() (= PLATFORM_NOTICE_KINDS).
--    The text of a notice is not stored: the screen writes it from kind and version. The per-tenant "notified" date is the notice.tenant_notified audit row of that
--    tenant (detail.noticeId), so there is no second table. Who added a notice is in its notice.created audit row, so the table holds no actor column.
--  * public.platform_notices()             Notice[], newest first; pending = the tenants with no notified row, notified = the others with the first notified instant.
--  * public.platform_notice_mark(n, t)     writes one notice.tenant_notified row unless the tenant already has one ({notifiedAt, changed}); unknown notice or tenant: P0002
--                                           notice_not_found / tenant_not_found.
--  * public.platform_me()                  {displayName, unreadNotices}: the staff row's display name and the count of notices with a pending tenant.
--    These three are for platform_staff only and call app.require_console() first.
--  * public.platform_add_notice(kind, v)   the notice-add job of platform-ops (secret key): inserts the notice and writes notice.created (origin script); returns
--                                           {noticeId}. A duplicate (kind, version) is 23505; an unknown kind or a version below 1 is 23514. service_role only.

create table platform.notice (
  id uuid constraint platform_notice_pkey primary key default gen_random_uuid(),
  kind text not null constraint platform_notice_kind_check check (kind = any (platform.notice_kinds())),
  version integer not null constraint platform_notice_version_check check (version >= 1),
  created_at timestamptz not null default now(),
  constraint platform_notice_kind_version_key unique (kind, version)
);
alter table platform.notice enable row level security;
revoke all on platform.notice from public, anon, authenticated, service_role, platform_staff;

create function platform.notice_append_only() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  raise exception 'platform_notice_append_only' using errcode = 'P0001';
end
$$;
revoke all on function platform.notice_append_only() from public, anon, authenticated, service_role, platform_staff;

create trigger platform_notice_no_update_delete before update or delete on platform.notice
  for each row execute function platform.notice_append_only();
create trigger platform_notice_no_truncate before truncate on platform.notice
  for each statement execute function platform.notice_append_only();

create function public.platform_notices() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_console();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', n.id,
             'kind', n.kind,
             'version', n.version,
             'createdAt', to_char(n.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             'pending', coalesce((
               select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name, t.id)
                 from public.tenant t
                where not exists (select 1 from platform.audit_event a
                                   where a.action = 'notice.tenant_notified' and a.tenant_id = t.id and a.detail ->> 'noticeId' = n.id::text)), '[]'::jsonb),
             'notified', coalesce((
               select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name,
                                                   'notifiedAt', to_char(x.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by x.name, x.id)
                 from (select t.id, t.name, min(a.at) as at
                         from public.tenant t
                         join platform.audit_event a on a.action = 'notice.tenant_notified' and a.tenant_id = t.id and a.detail ->> 'noticeId' = n.id::text
                        group by t.id, t.name) x), '[]'::jsonb))
           order by n.created_at desc, n.version desc, n.id)
      from platform.notice n), '[]'::jsonb);
end
$$;

create function public.platform_notice_mark(p_notice uuid, p_tenant uuid) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  perform app.require_console();
  if p_notice is null or not exists (select 1 from platform.notice n where n.id = p_notice) then
    raise exception 'notice_not_found' using errcode = 'P0002';
  end if;
  if p_tenant is null or not exists (select 1 from public.tenant t where t.id = p_tenant) then
    raise exception 'tenant_not_found' using errcode = 'P0002';
  end if;
  -- Two marks of one (notice, tenant) at the same time write one row.
  perform pg_advisory_xact_lock(hashtextextended('platform-notice-mark:' || p_notice::text || ':' || p_tenant::text, 0));
  select min(a.at) into v_at from platform.audit_event a
   where a.action = 'notice.tenant_notified' and a.tenant_id = p_tenant and a.detail ->> 'noticeId' = p_notice::text;
  if v_at is not null then
    return jsonb_build_object('notifiedAt', to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'changed', false);
  end if;
  perform platform.audit_write('console', 'notice.tenant_notified', p_tenant, jsonb_build_object('noticeId', p_notice, 'tenantId', p_tenant));
  return jsonb_build_object('notifiedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'changed', true);
end
$$;

create function public.platform_me() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_console();
  return jsonb_build_object(
    'displayName', (select s.display_name from platform.staff s where s.auth_id = auth.uid()),
    'unreadNotices', (select count(*)::int from platform.notice n
                       where exists (select 1 from public.tenant t
                                      where not exists (select 1 from platform.audit_event a
                                                         where a.action = 'notice.tenant_notified' and a.tenant_id = t.id
                                                           and a.detail ->> 'noticeId' = n.id::text))));
end
$$;

create function public.platform_add_notice(p_kind text, p_version integer) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- The role first: the grant is service_role only, and the token must say so as well (a secret-key call carries role = service_role).
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  insert into platform.notice (kind, version) values (p_kind, p_version) returning id into v_id;
  perform platform.audit_write('script', 'notice.created', null, jsonb_build_object('noticeId', v_id, 'kind', p_kind, 'version', p_version));
  return jsonb_build_object('noticeId', v_id);
end
$$;

revoke all on function public.platform_notices(), public.platform_notice_mark(uuid, uuid), public.platform_me(), public.platform_add_notice(text, integer)
  from public, anon, authenticated, service_role, platform_staff;
grant execute on function public.platform_notices(), public.platform_notice_mark(uuid, uuid), public.platform_me() to platform_staff;
grant execute on function public.platform_add_notice(text, integer) to service_role;
