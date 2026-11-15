-- SP3 step 2 (docs/plans/2026-11-15-sp3-console.md §3.1.2, §3.1.3): platform.staff and the append-only platform audit.
-- platform.staff holds DigiAlto's own accounts. A row alone grants nothing (the console needs a verified factor and an aal2 session, steps 10 and 13); at most one
-- active platform_admin exists (FD28). platform.audit_event records every console write and every state-changing script with codes and ids only, never an address;
-- it is append-only for every role, the migration owner included, and carries no foreign key on tenant_id so an erased tenant's rows survive (ADR-040). Both
-- tables are closed to every API role: no grant, RLS on, no policy yet (the access-token hook's read policy comes with step 14).
-- The action registry platform.audit_actions() equals PLATFORM_AUDIT_ACTIONS in src/lib/platform/codes.ts, and platform.notice_kinds() equals
-- PLATFORM_NOTICE_KINDS; tests/config/sp3-preserves.test.ts compares them. Later milestones add theirs to both lists.

create function platform.audit_actions() returns text[]
  language sql immutable
  set search_path = ''
as $$
  select array[
    'platform_admin.bootstrapped', 'platform_admin.factor_enrolled', 'console.entered', 'console.left', 'console.tenant_opened',
    'notice.created', 'notice.tenant_notified', 'script.create_tenant', 'script.mfa_reset', 'script.set_mfa_enforcement'
  ]::text[]
$$;

create function platform.notice_kinds() returns text[]
  language sql immutable
  set search_path = ''
as $$
  select array['subprocessor']::text[]
$$;

create function platform.audit_detail_keys() returns text[]
  language sql immutable
  set search_path = ''
as $$
  select array['tenantId', 'appUserId', 'authId', 'noticeId', 'kind', 'version', 'mode', 'slot', 'changed', 'sessionsRevoked', 'outcome']::text[]
$$;

-- A flat object; keys from the list; values are ids and codes (strings of [a-z0-9_.:-], 1 to 64 characters, so never an @), integers, booleans or null.
create function platform.audit_detail_ok(p_detail jsonb) returns boolean
  language sql immutable
  set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_detail), '') = 'object'
     and not exists (
       select 1 from jsonb_each(p_detail) e
        where not (e.key = any (platform.audit_detail_keys()))
           or not coalesce(case jsonb_typeof(e.value)
                when 'null' then true
                when 'boolean' then true
                when 'number' then e.value::text ~ '^-?[0-9]{1,15}$'
                when 'string' then (e.value #>> '{}') ~ '^[a-z0-9_.:-]{1,64}$'
                else false
              end, false))
$$;
revoke all on function platform.audit_actions(), platform.notice_kinds(), platform.audit_detail_keys(), platform.audit_detail_ok(jsonb)
  from public, anon, authenticated, service_role;

-- Constraint names carry the platform_ prefix: pgTAP pins of the venue audit look constraints up by name alone (audit_event_action_check).
create table platform.staff (
  auth_id uuid primary key references auth.users (id),
  role text not null constraint staff_role_check check (role in ('platform_admin', 'platform_support')),
  display_name text not null default 'DigiAlto' constraint staff_display_name_check check (length(display_name) between 1 and 60),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);
create unique index staff_one_active_admin on platform.staff ((true)) where role = 'platform_admin' and is_active;
alter table platform.staff enable row level security;
revoke all on platform.staff from public, anon, authenticated, service_role;

create table platform.audit_event (
  id bigint generated always as identity constraint platform_audit_event_pkey primary key,
  at timestamptz not null default now(),
  actor_auth_id uuid,
  origin text not null constraint platform_audit_event_origin_check check (origin in ('console', 'script')),
  action text not null constraint platform_audit_event_action_check check (action = any (platform.audit_actions())),
  tenant_id uuid,
  detail jsonb not null default '{}' constraint platform_audit_event_detail_check check (platform.audit_detail_ok(detail))
);
alter table platform.audit_event enable row level security;
revoke all on platform.audit_event from public, anon, authenticated, service_role;
revoke all on sequence platform.audit_event_id_seq from public, anon, authenticated, service_role;

create function platform.audit_event_append_only() returns trigger
  language plpgsql security definer
  set search_path = ''
as $$
begin
  raise exception 'platform_audit_append_only' using errcode = 'P0001';
end
$$;
revoke all on function platform.audit_event_append_only() from public, anon, authenticated, service_role;

create trigger platform_audit_event_no_update_delete before update or delete on platform.audit_event
  for each row execute function platform.audit_event_append_only();
create trigger platform_audit_event_no_truncate before truncate on platform.audit_event
  for each statement execute function platform.audit_event_append_only();

-- The one writer every platform function uses. A null detail is refused (not null), as a direct insert refuses it: no silent default. The actor is the caller's auth user when there is one (a console call), null for a script run with the secret key.
create function platform.audit_write(p_origin text, p_action text, p_tenant uuid, p_detail jsonb) returns bigint
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into platform.audit_event (actor_auth_id, origin, action, tenant_id, detail)
    values (auth.uid(), p_origin, p_action, p_tenant, p_detail)
    returning id into v_id;
  return v_id;
end
$$;
revoke all on function platform.audit_write(text, text, uuid, jsonb) from public, anon, authenticated, service_role;
