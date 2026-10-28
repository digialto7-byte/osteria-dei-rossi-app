-- M13 step 1: count sessions and lines (M13 plan §3.1.2, §3.2; ADR-012). A session is a working record of one
-- count at one location; its lines hold what the app expected and what was counted for each ingredient. Neither
-- table is a balance: stock changes only through `count` rows in stock_movement, posted by count_close (step 3).
-- expected_qty is a recorded fact of the count (the snapshot the difference is computed from), never read as a
-- stock figure.
--
-- Nobody writes these tables directly: no INSERT/UPDATE grant for any API role, rows come from the SECURITY
-- DEFINER procedures. The guards below are the second lock: a closed or cancelled session and its lines never
-- change, for every role, the table owner included. Nothing is deleted.

create table public.count_session (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  location_id uuid not null,
  type text not null check (type in ('daily', 'monthly')),
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  started_at timestamptz not null default now(),
  started_by uuid not null default app.app_user_id(),
  closed_at timestamptz,
  closed_by uuid,
  cancelled_at timestamptz,
  cancelled_by uuid,
  constraint count_session_closed_ck check (
    (status = 'closed') = (closed_at is not null and closed_by is not null)),
  constraint count_session_cancelled_ck check (
    (status = 'cancelled') = (cancelled_at is not null and cancelled_by is not null)),
  constraint count_session_tenant_id_id_uq unique (tenant_id, id),
  constraint count_session_location_fk foreign key (tenant_id, location_id)
    references public.location (tenant_id, id),
  constraint count_session_started_by_fk foreign key (tenant_id, started_by)
    references public.app_user (tenant_id, id),
  constraint count_session_closed_by_fk foreign key (tenant_id, closed_by)
    references public.app_user (tenant_id, id),
  constraint count_session_cancelled_by_fk foreign key (tenant_id, cancelled_by)
    references public.app_user (tenant_id, id)
);
-- One open session per location (A5).
create unique index count_session_open_uq on public.count_session (tenant_id, location_id)
  where status = 'open';
create index count_session_started_idx on public.count_session (tenant_id, started_at desc, id desc);

create table public.count_line (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  session_id uuid not null,
  ingredient_id uuid not null,
  position integer not null check (position > 0),
  -- The entry: all four are null (not counted yet) or all set (ADR-012).
  expected_qty numeric(12, 4),
  counted_qty numeric(12, 4) check (counted_qty >= 0),
  entered_at timestamptz,
  entered_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid not null default app.app_user_id(),
  constraint count_line_entry_ck check (
    (expected_qty is null) = (counted_qty is null)
    and (counted_qty is null) = (entered_at is null)
    and (entered_at is null) = (entered_by is null)),
  unique (session_id, ingredient_id),
  unique (session_id, position),
  constraint count_line_session_fk foreign key (tenant_id, session_id)
    references public.count_session (tenant_id, id),
  constraint count_line_ingredient_fk foreign key (tenant_id, ingredient_id)
    references public.ingredient (tenant_id, id),
  constraint count_line_entered_by_fk foreign key (tenant_id, entered_by)
    references public.app_user (tenant_id, id),
  constraint count_line_created_by_fk foreign key (tenant_id, created_by)
    references public.app_user (tenant_id, id)
);
create index count_line_session_idx on public.count_line (tenant_id, session_id, position);

-- A session only moves open -> closed or open -> cancelled, and only its own end columns are set.
create function app.count_session_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.status <> 'open'
     or new.status not in ('closed', 'cancelled')
     or new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.location_id is distinct from old.location_id
     or new.type is distinct from old.type
     or new.started_at is distinct from old.started_at
     or new.started_by is distinct from old.started_by
     or (new.status = 'closed'
         and (new.cancelled_at is not null or new.cancelled_by is not null))
     or (new.status = 'cancelled'
         and (new.closed_at is not null or new.closed_by is not null)) then
    raise exception 'count_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;

-- Lines are created while the session is open and only their entry columns change, again only while it is open.
create function app.count_line_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  v_status text;
begin
  select s.status into v_status
    from public.count_session s
   where s.tenant_id = new.tenant_id and s.id = new.session_id;
  if tg_op = 'UPDATE'
     and (new.id is distinct from old.id
          or new.tenant_id is distinct from old.tenant_id
          or new.session_id is distinct from old.session_id
          or new.ingredient_id is distinct from old.ingredient_id
          or new.position is distinct from old.position
          or new.created_at is distinct from old.created_at
          or new.created_by is distinct from old.created_by) then
    raise exception 'count_immutable' using errcode = 'P0001';
  end if;
  -- A missing session is left to the foreign key.
  if v_status is not null and v_status <> 'open' then
    raise exception 'count_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all on function app.count_session_guard(), app.count_line_guard() from public, anon;

create trigger count_session_guard
  before update on public.count_session
  for each row execute function app.count_session_guard();
create trigger count_line_guard
  before insert or update on public.count_line
  for each row execute function app.count_line_guard();
create trigger count_session_append_only
  before delete on public.count_session
  for each row execute function app.append_only();
create trigger count_session_no_truncate
  before truncate on public.count_session
  for each statement execute function app.append_only_truncate();
create trigger count_line_append_only
  before delete on public.count_line
  for each row execute function app.append_only();
create trigger count_line_no_truncate
  before truncate on public.count_line
  for each statement execute function app.append_only_truncate();

alter table public.count_session enable row level security;
alter table public.count_line enable row level security;

revoke all on public.count_session, public.count_line from anon, authenticated;
revoke insert, update, delete, truncate on public.count_session, public.count_line from service_role;
grant select on public.count_session, public.count_line to authenticated;

create policy count_session_select on public.count_session
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin', 'chef'));
create policy count_line_select on public.count_line
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin', 'chef'));

-- The audit lists widen (one migration each, see 20261022140000_audit_event.sql). Every earlier value stays.
-- M11's staff and device values were missing here and are restored in place (fix/m13-check-union): a
-- database already holding M11 rows refused the narrower lists, and this file had never been applied.
alter table public.audit_event
  drop constraint audit_event_entity_type_check,
  drop constraint audit_event_action_check;
alter table public.audit_event
  add constraint audit_event_entity_type_check
    check (entity_type in ('invoice', 'ingredient', 'recipe', 'tenant', 'payable', 'app_user',
                           'device_enrolment', 'venue_device', 'count_session')),
  add constraint audit_event_action_check
    check (action in ('invoice.approved', 'invoice.rejected', 'invoice.duplicate_cleared',
                      'ingredient.allergens_confirmed', 'recipe.deactivated', 'recipe.reactivated',
                      'tenant.settings_changed', 'payable.status_changed', 'payable.payment_reversed',
                      'app_user.created', 'app_user.updated', 'app_user.deactivated',
                      'app_user.reactivated', 'app_user.pin_set', 'device_enrolment.created',
                      'venue_device.enrolled', 'venue_device.revoked', 'venue_device.unlocked',
                      'count_session.closed', 'count_session.cancelled', 'ingredient.critical_changed'));

-- The job list widens (see 20261022150000_job_run.sql); M11's auth-purge stays.
alter table app.job_run
  drop constraint job_run_job_check,
  add constraint job_run_job_check check (job in ('extract', 'alert-rules', 'auth-purge', 'ledger-invariants'));

-- Indexes for the activity feed (audit_log) and the reconciliation report.
create index audit_event_tenant_at_idx on public.audit_event (tenant_id, created_at desc, id desc);
create index stock_movement_location_date_idx on public.stock_movement (tenant_id, location_id, effective_on);
create index stock_movement_tenant_at_idx on public.stock_movement (tenant_id, created_at desc, id desc);
