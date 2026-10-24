-- Demo data step 4 (docs/plans/2026-10-24-demo-data.md §3.1.6, §3.2; ADR-018): the purge of a demo tenant.
--
-- Everything runs in ONE transaction, in a SECURITY DEFINER function, and only for a tenant with is_demo = true:
--   1. lock the tenant row (an hourly alert insert waits on it, then fails its foreign key inside its own isolated block);
--   2. note the Auth ids of its users and the row counts per table;
--   3. set app.demo_purge to the tenant id (transaction-local; the guards of 20261105100100 read it);
--   4. delete the tenant's rows from every table of app.demo_purge_tables(), in that order, child tables first. The two
--      reference cycles are deleted in one statement each (data-modifying CTEs), because NO ACTION foreign keys are checked
--      at the end of the statement: venue_device <-> device_enrolment, and tenant <-> app_user (created_by);
--   5. write one row to app.demo_purge_log, which outlives the tenant (audit_event cannot: it references app_user);
--   6. clear the setting.
-- A failure anywhere rolls everything back, the setting included.
--
-- Auth users and Storage objects cannot be removed from SQL: the log row keeps the Auth ids until scripts/demo --cleanup
-- has removed them and calls demo_purge_cleanup_done.

-- The record of every purge. No tenant FK (the tenant is gone), no API privilege, RLS on, like app.job_run.
create table app.demo_purge_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  tenant_name text not null,
  via text not null check (via in ('app', 'script')),
  -- The Auth id of the owner who pressed the button (null for the script). Emptied at cleanup.
  actor_auth uuid,
  purged_at timestamptz not null default clock_timestamp(),
  row_counts jsonb not null check (jsonb_typeof(row_counts) = 'object'),
  -- The Auth users still to delete; emptied once they are gone.
  auth_ids uuid[] not null default '{}',
  cleaned_at timestamptz,
  auth_deleted integer check (auth_deleted >= 0),
  objects_deleted integer check (objects_deleted >= 0),
  constraint demo_purge_log_cleaned_ck check ((cleaned_at is null) = (auth_deleted is null and objects_deleted is null))
);
create index demo_purge_log_pending_idx on app.demo_purge_log (id) where cleaned_at is null;
alter table app.demo_purge_log enable row level security;
revoke all on app.demo_purge_log from public, anon, authenticated, service_role;

-- Every table with a tenant_id, in delete order. pgTAP 194 fails while a public tenant table is missing; pgTAP 193 proves the
-- order. A later milestone that adds a table re-creates this function in a migration of its own (plan §3.9).
create function app.demo_purge_tables() returns text[]
  language sql immutable
  set search_path = ''
as $$
  select array[
    -- alerts and audit
    'alert', 'audit_event',
    -- staff meals and batches
    'staff_meal_confirmation', 'staff_meal_rule', 'batch_cost', 'batch_movement', 'batch_input', 'batch',
    -- counts and stock
    'count_line', 'count_session', 'stock_movement', 'raw_lot',
    -- prices, payables and invoices
    'price_history', 'payable', 'invoice_duplicate_decision', 'invoice_line', 'invoice',
    -- cost settings
    'ingredient_cost_basis', 'fixed_cost_period',
    -- recipes
    'recipe_price', 'recipe_line', 'recipe', 'recipe_key',
    -- master data
    'supplier_item', 'supplier', 'ingredient', 'location', 'cost_centre',
    -- staff login; venue_device and device_enrolment reference each other (deleted together)
    'staff_session', 'auth_attempt', 'venue_device', 'device_enrolment',
    -- last: the users and the tenant reference each other (deleted together)
    'app_user', 'tenant'
  ]::text[]
$$;
revoke all on function app.demo_purge_tables() from public, anon, authenticated, service_role;

-- Row counts per table of the list, plus app.alert_refusal, for any tenant: a count, never a row.
create function app.demo_tenant_counts(p_tenant uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  t text;
  n bigint;
  out jsonb := '{}'::jsonb;
begin
  foreach t in array app.demo_purge_tables() loop
    execute format('select count(*) from public.%I where %I = $1', t, case when t = 'tenant' then 'id' else 'tenant_id' end)
      into n using p_tenant;
    out := out || jsonb_build_object(t, n);
  end loop;
  select count(*) into n from app.alert_refusal r where r.tenant_id = p_tenant;
  return out || jsonb_build_object('alert_refusal', n);
end
$$;
revoke all on function app.demo_tenant_counts(uuid) from public, anon, authenticated, service_role;

-- The purge itself. Called only by the two entry points below, which check who may purge what.
create function app.purge_demo_tenant_core(p_tenant uuid, p_via text, p_actor_auth uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_name text;
  v_is_demo boolean;
  v_auth uuid[];
  v_counts jsonb;
  v_table text;
  v_done integer;
begin
  -- The lock first, then the check: a flag read before the lock could be stale (it cannot change, but the row could go).
  select t.name, t.is_demo into v_name, v_is_demo from public.tenant t where t.id = p_tenant for update;
  if not found or not v_is_demo then
    raise exception 'not_demo_tenant' using errcode = '42501';
  end if;
  if p_via not in ('app', 'script') then
    raise exception 'invalid_purge_source' using errcode = 'P0001';
  end if;

  v_auth := array(select u.auth_id from public.app_user u where u.tenant_id = p_tenant order by u.created_at, u.id);
  v_counts := app.demo_tenant_counts(p_tenant);

  perform set_config('app.demo_purge', p_tenant::text, true);

  foreach v_table in array app.demo_purge_tables() loop
    if v_table = 'venue_device' then
      with e as (delete from public.device_enrolment where tenant_id = p_tenant),
           v as (delete from public.venue_device where tenant_id = p_tenant)
      select 1 into v_done;
    elsif v_table = 'app_user' then
      with u as (delete from public.app_user where tenant_id = p_tenant),
           t as (delete from public.tenant where id = p_tenant)
      select 1 into v_done;
    elsif v_table not in ('device_enrolment', 'tenant') then
      execute format('delete from public.%I where tenant_id = $1', v_table) using p_tenant;
    end if;
  end loop;
  delete from app.alert_refusal r where r.tenant_id = p_tenant;

  insert into app.demo_purge_log (tenant_id, tenant_name, via, actor_auth, row_counts, auth_ids)
    values (p_tenant, v_name, p_via, p_actor_auth, v_counts, v_auth);

  perform set_config('app.demo_purge', '', true);
  return jsonb_build_object('tenantId', p_tenant, 'rowCounts', v_counts);
end
$$;
revoke all on function app.purge_demo_tenant_core(uuid, text, uuid) from public, anon, authenticated, service_role;

-- From the app: the owner of the demo tenant, who must type its exact name. The role is checked first; the tenant comes from
-- the caller's own token (app.tenant_id()), never from an argument.
create function public.purge_demo_tenant(p_confirm_name text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_name text;
begin
  if (select app.role()) is distinct from 'owner' then
    raise exception 'permission denied: the demo purge needs the owner' using errcode = '42501';
  end if;
  v_tenant := (select app.tenant_id());
  if not app.tenant_is_demo(v_tenant) then
    raise exception 'not_demo_tenant' using errcode = '42501';
  end if;
  select t.name into v_name from public.tenant t where t.id = v_tenant;
  if p_confirm_name is distinct from v_name then
    raise exception 'confirm_name_mismatch' using errcode = 'P0001';
  end if;
  return app.purge_demo_tenant_core(v_tenant, 'app', (select auth.uid()));
end
$$;
revoke all on function public.purge_demo_tenant(text) from public, anon, authenticated, service_role;
grant execute on function public.purge_demo_tenant(text) to authenticated;

-- From the script (secret key): the same checks except the role. The grant is the role gate.
create function public.purge_demo_tenant_by_id(p_tenant uuid, p_confirm_name text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_name text;
begin
  if not app.tenant_is_demo(p_tenant) then
    raise exception 'not_demo_tenant' using errcode = '42501';
  end if;
  select t.name into v_name from public.tenant t where t.id = p_tenant;
  if p_confirm_name is distinct from v_name then
    raise exception 'confirm_name_mismatch' using errcode = 'P0001';
  end if;
  return app.purge_demo_tenant_core(p_tenant, 'script', null);
end
$$;
revoke all on function public.purge_demo_tenant_by_id(uuid, text) from public, anon, authenticated;
grant execute on function public.purge_demo_tenant_by_id(uuid, text) to service_role;

-- The purges whose Auth users and Storage objects are not removed yet.
create function public.demo_purge_pending()
  returns table (id bigint, tenant_id uuid, tenant_name text, auth_ids uuid[], purged_at timestamptz)
  language sql
  security definer
  set search_path = ''
as $$
  select l.id, l.tenant_id, l.tenant_name, l.auth_ids, l.purged_at
    from app.demo_purge_log l
   where l.cleaned_at is null
   order by l.id
$$;
revoke all on function public.demo_purge_pending() from public, anon, authenticated;
grant execute on function public.demo_purge_pending() to service_role;

-- The script reports the cleanup: the Auth users and Storage objects are gone. Empties the ids and the actor (nothing
-- personal stays), and deletes any app.alert_refusal row an hourly run wrote for the tenant after the purge.
create function public.demo_purge_cleanup_done(p_log bigint, p_auth_deleted integer, p_objects_deleted integer)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  update app.demo_purge_log l
     set cleaned_at = clock_timestamp(), auth_ids = '{}', actor_auth = null,
         auth_deleted = p_auth_deleted, objects_deleted = p_objects_deleted
   where l.id = p_log and l.cleaned_at is null
  returning l.tenant_id into v_tenant;
  if not found then
    raise exception 'purge_log_not_found' using errcode = 'P0001';
  end if;
  -- Only for a tenant that is really gone.
  delete from app.alert_refusal r
   where r.tenant_id = v_tenant and not exists (select 1 from public.tenant t where t.id = v_tenant);
end
$$;
revoke all on function public.demo_purge_cleanup_done(bigint, integer, integer) from public, anon, authenticated;
grant execute on function public.demo_purge_cleanup_done(bigint, integer, integer) to service_role;
