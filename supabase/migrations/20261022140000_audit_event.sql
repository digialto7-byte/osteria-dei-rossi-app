-- M5 step 1: append-only trigger functions and audit_event (M5 plan §3.3; project plan §3.5.2).
-- The append-only rule is enforced twice: API roles have no UPDATE/DELETE/TRUNCATE grant, and a
-- trigger raises for every role, the table owner and service_role included, so a wrong grant or
-- a bug in a procedure cannot rewrite history. (A superuser can still disable triggers; no API
-- role can. Whether the hosted `postgres` role can is plan T3, not tested.) The ledger tables of
-- the next steps reuse these two functions.

-- Row trigger: UPDATE and DELETE.
create function app.append_only() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception 'append_only' using errcode = 'P0001';
end
$$;

-- Statement trigger: TRUNCATE (row triggers do not fire for it).
create function app.append_only_truncate() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception 'append_only' using errcode = 'P0001';
end
$$;

-- Trigger functions are only executed by the trigger machinery; nobody calls them directly.
revoke all on function app.append_only(), app.append_only_truncate() from public, anon;

-- Who did what to which record. Rows are written only by the SECURITY DEFINER procedures
-- (approve_invoice, reject_invoice, review_clear_duplicate); `created_by` has no default
-- fallback to null: a missing caller is an error (23502), never an anonymous event.
-- The check lists widen in later milestones (one migration each).
create table public.audit_event (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  entity_type text not null check (entity_type in ('invoice')),
  entity_id uuid not null,
  action text not null
    check (action in ('invoice.approved', 'invoice.rejected', 'invoice.duplicate_cleared')),
  before jsonb,
  after jsonb,
  -- Free text typed by the owner (rejection). Capped; the form tells the owner to type no
  -- personal data. Never logged.
  reason text check (reason is null or length(btrim(reason)) between 1 and 200),
  created_at timestamptz not null default now(),
  created_by uuid not null default app.app_user_id() references public.app_user (id)
);
create index audit_event_entity_idx
  on public.audit_event (tenant_id, entity_type, entity_id, created_at desc);

alter table public.audit_event enable row level security;

revoke all on public.audit_event from anon, authenticated;
revoke insert, update, delete, truncate on public.audit_event from service_role;
grant select on public.audit_event to authenticated;

create policy audit_event_select on public.audit_event
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));

create trigger audit_event_append_only
  before update or delete on public.audit_event
  for each row execute function app.append_only();
create trigger audit_event_no_truncate
  before truncate on public.audit_event
  for each statement execute function app.append_only_truncate();
