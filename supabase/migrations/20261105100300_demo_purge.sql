-- Demo data step 4 (docs/plans/2026-10-24-demo-data.md §0, §3.1.6, §3.2; ADR-018 revision 1): the reset of a tenant that carries
-- demo data (marker demo_data_since set by begin_demo_data).
--
-- Everything runs in ONE transaction, in a SECURITY DEFINER function, and only while the marker is set:
--   1. lock the tenant row;
--   2. work out the demo users, note their Auth ids and the row counts per table;
--   3. set app.demo_purge to the tenant id (transaction-local; the guards of 20261105100100 read it);
--   4. delete the operational rows, in the order of app.demo_purge_tables(), child tables first (the exact rules are on the
--      core function below). venue_device and device_enrolment reference each other, so they go in one statement (data-modifying
--      CTE): NO ACTION foreign keys are checked at the end of the statement;
--   5. restore tenant.settings, clear the marker, write one row to app.demo_purge_log, and (when the caller survives) one audit
--      row;
--   6. clear the setting.
-- A failure anywhere rolls everything back, the settings included. The tenant row and every non-demo user stay.
--
-- Auth users and Storage objects cannot be removed from SQL: the log row keeps the Auth ids of the demo users until
-- scripts/demo --cleanup has removed them and calls demo_purge_cleanup_done.

-- The record of every reset. No tenant FK, no API privilege, RLS on, like app.job_run.
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
  -- The exact Storage paths of the invoice files this reset deleted rows for. The clean-up removes these and nothing else: the
  -- tenant stays live, so anything uploaded after the reset (a real invoice) is never touched. Emptied once they are gone.
  file_paths text[] not null default '{}',
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
    -- last: the demo users. 'tenant' is listed because it carries a tenant_id (pgTAP 194), but the reset never deletes it
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
    execute format('select count(*) from public.%I where tenant_id = $1', t)
      into n using p_tenant;
    out := out || jsonb_build_object(t, n);
  end loop;
  select count(*) into n from app.alert_refusal r where r.tenant_id = p_tenant;
  return out || jsonb_build_object('alert_refusal', n);
end
$$;
revoke all on function app.demo_tenant_counts(uuid) from public, anon, authenticated, service_role;

-- The reset itself. Called only by the two entry points below, which check who may reset what.
-- What it deletes (everything below happens in this one transaction):
--   * every row of the tenant in the data tables of app.demo_purge_tables(), child tables first;
--   * the audit rows written since the marker;
--   * the demo users' staff sessions and login attempts, and the devices the demo users enrolled with their codes
--     (venue_device and device_enrolment reference each other: one statement);
--   * the demo users: the owner and admin begin_demo_data made, and every user created by a demo user (create_staff).
-- What it keeps: the tenant row, every other user (the founder's account, staff added by anyone else), everything dated before
-- the marker. It restores tenant.settings, deletes app.demo_state, clears the marker, and writes a log row.
create function app.purge_demo_data_core(p_tenant uuid, p_via text, p_actor_auth uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_name text;
  v_since timestamptz;
  v_settings jsonb;
  v_users uuid[];
  v_auth uuid[];
  v_paths text[];
  v_devices uuid[];
  v_counts jsonb;
  v_table text;
  v_done integer;
  v_actor uuid;
begin
  -- The lock first, then the check: a marker read before the lock could be stale.
  select t.name, t.demo_data_since into v_name, v_since from public.tenant t where t.id = p_tenant for update;
  if not found or v_since is null then
    raise exception 'not_demo_tenant' using errcode = '42501';
  end if;
  if p_via not in ('app', 'script') then
    raise exception 'invalid_purge_source' using errcode = 'P0001';
  end if;

  select s.settings_before into v_settings from app.demo_state s where s.tenant_id = p_tenant;
  if not found then
    raise exception 'demo_state_missing' using errcode = 'P0001';
  end if;
  -- The demo users: the two from begin_demo_data and, recursively, everyone they created.
  v_users := array(
    with recursive d(id) as (
      select s.owner_user from app.demo_state s where s.tenant_id = p_tenant
      union
      select s.admin_user from app.demo_state s where s.tenant_id = p_tenant
      union
      select u.id from public.app_user u join d on u.created_by = d.id where u.tenant_id = p_tenant
    )
    select d.id from d);
  v_auth := array(select u.auth_id from public.app_user u where u.id = any (v_users) order by u.created_at, u.id);
  v_paths := array(select i.file_path from public.invoice i where i.tenant_id = p_tenant order by i.file_path);
  -- The demo's devices are the ones the demo users enrolled. A real device enrolled after the marker by a real user stays.
  v_devices := array(select d.id from public.venue_device d where d.tenant_id = p_tenant and d.created_by = any (v_users));
  v_counts := app.demo_tenant_counts(p_tenant);
  -- The caller, if the caller survives (the owner who pressed the button): the audit row of the reset is theirs.
  select u.id into v_actor from public.app_user u
   where u.tenant_id = p_tenant and u.auth_id = p_actor_auth and u.id <> all (v_users);

  perform set_config('app.demo_purge', p_tenant::text, true);

  foreach v_table in array app.demo_purge_tables() loop
    if v_table = 'audit_event' then
      delete from public.audit_event where tenant_id = p_tenant and created_at >= v_since;
    elsif v_table in ('staff_session', 'auth_attempt') then
      -- Only the demo users' sessions and attempts, and those on a demo device (the device cannot go while they point at it).
      execute format('delete from public.%I where tenant_id = $1 and (app_user_id = any ($2) or device_id = any ($3))', v_table)
        using p_tenant, v_users, v_devices;
    elsif v_table = 'venue_device' then
      -- A code made by a demo user, or redeemed for a demo device (even one from before the marker), goes with the device.
      with e as (delete from public.device_enrolment where tenant_id = p_tenant and (created_by = any (v_users) or device_id = any (v_devices))),
           v as (delete from public.venue_device where tenant_id = p_tenant and id = any (v_devices))
      select 1 into v_done;
    elsif v_table = 'app_user' then
      delete from public.app_user where tenant_id = p_tenant and id = any (v_users);
    elsif v_table not in ('device_enrolment', 'tenant') then
      execute format('delete from public.%I where tenant_id = $1', v_table) using p_tenant;
    end if;
  end loop;
  delete from app.alert_refusal r where r.tenant_id = p_tenant;
  delete from app.demo_state s where s.tenant_id = p_tenant;

  -- Settings back to what they were, then the marker off (the guard needs the setting that names this tenant).
  perform set_config('app.demo_marker_write', p_tenant::text, true);
  update public.tenant set settings = v_settings, demo_data_since = null where id = p_tenant;
  perform set_config('app.demo_marker_write', '', true);

  insert into app.demo_purge_log (tenant_id, tenant_name, via, actor_auth, row_counts, auth_ids, file_paths)
    values (p_tenant, v_name, p_via, p_actor_auth, v_counts, v_auth, v_paths);
  if v_actor is not null then
    insert into public.audit_event (tenant_id, entity_type, entity_id, action, created_by)
      values (p_tenant, 'tenant', p_tenant, 'tenant.demo_data_removed', v_actor);
  end if;

  perform set_config('app.demo_purge', '', true);
  return jsonb_build_object('tenantId', p_tenant, 'rowCounts', v_counts);
end
$$;
revoke all on function app.purge_demo_data_core(uuid, text, uuid) from public, anon, authenticated, service_role;

-- From the app: an owner of the tenant that carries demo data, who must type its exact name. The role is checked first; the
-- tenant comes from the caller's own token (app.tenant_id()), never from an argument.
create function public.purge_demo_data(p_confirm_name text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_name text;
begin
  if (select app.role()) is distinct from 'owner' then
    raise exception 'permission denied: the demo reset needs the owner' using errcode = '42501';
  end if;
  v_tenant := (select app.tenant_id());
  if not app.tenant_is_demo(v_tenant) then
    raise exception 'not_demo_tenant' using errcode = '42501';
  end if;
  select t.name into v_name from public.tenant t where t.id = v_tenant;
  if p_confirm_name is distinct from v_name then
    raise exception 'confirm_name_mismatch' using errcode = 'P0001';
  end if;
  return app.purge_demo_data_core(v_tenant, 'app', (select auth.uid()));
end
$$;
revoke all on function public.purge_demo_data(text) from public, anon, authenticated, service_role;
grant execute on function public.purge_demo_data(text) to authenticated;

-- From the script (secret key): the same checks except the role. The grant is the role gate.
create function public.purge_demo_data_by_id(p_tenant uuid, p_confirm_name text) returns jsonb
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
  return app.purge_demo_data_core(p_tenant, 'script', null);
end
$$;
revoke all on function public.purge_demo_data_by_id(uuid, text) from public, anon, authenticated;
grant execute on function public.purge_demo_data_by_id(uuid, text) to service_role;

-- The purges whose Auth users and Storage objects are not removed yet.
create function public.demo_purge_pending()
  returns table (id bigint, tenant_id uuid, tenant_name text, auth_ids uuid[], file_paths text[], purged_at timestamptz)
  language sql
  security definer
  set search_path = ''
as $$
  select l.id, l.tenant_id, l.tenant_name, l.auth_ids, l.file_paths, l.purged_at
    from app.demo_purge_log l
   where l.cleaned_at is null
   order by l.id
$$;
revoke all on function public.demo_purge_pending() from public, anon, authenticated;
grant execute on function public.demo_purge_pending() to service_role;

-- The script reports the cleanup: the Auth users and the logged Storage objects are gone. Empties the ids, the paths and the
-- actor (nothing personal stays), and deletes the app.alert_refusal rows of the tenant written up to the reset (an hourly run
-- racing it). A refusal written AFTER the reset is the live tenant's own and stays.
create function public.demo_purge_cleanup_done(p_log bigint, p_auth_deleted integer, p_objects_deleted integer)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_purged_at timestamptz;
begin
  update app.demo_purge_log l
     set cleaned_at = clock_timestamp(), auth_ids = '{}', file_paths = '{}', actor_auth = null,
         auth_deleted = p_auth_deleted, objects_deleted = p_objects_deleted
   where l.id = p_log and l.cleaned_at is null
  returning l.tenant_id, l.purged_at into v_tenant, v_purged_at;
  if not found then
    raise exception 'purge_log_not_found' using errcode = 'P0001';
  end if;
  delete from app.alert_refusal r where r.tenant_id = v_tenant and r.at <= v_purged_at;
end
$$;
revoke all on function public.demo_purge_cleanup_done(bigint, integer, integer) from public, anon, authenticated;
grant execute on function public.demo_purge_cleanup_done(bigint, integer, integer) to service_role;
