-- M8 step 6: app.try_raise_alert and app.alert_refusal (M8 plan §3.1.9; M7 plan §8 design note).
--
-- app.raise_alert (M6) raises when a guard refuses an alert (cost audience, bad payload, ...). A
-- caller that has already done real work, such as approve_invoice, must not lose that work because
-- an alert was refused. try_raise_alert calls raise_alert inside a nested block (a savepoint); if
-- the error is one of the six guard codes, the block's work is rolled back, ONE row is written to
-- app.alert_refusal by the handler (which runs in the outer transaction), a warning goes to the
-- database log, and the result is null. Every other error, including P0002 tenant_not_found, is
-- re-raised: a bug in a ledger caller must still surface.
--
-- app.alert_refusal lives in schema `app` like app.job_run (a run record across tenants, outside the
-- `public` checks of pgTAP 001): RLS on, no policy, no privilege for any API role. It holds ids and
-- codes only, never a payload or a message (messages may carry payload text).

create table app.alert_refusal (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  kind text not null,
  entity_type text,
  entity_id uuid,
  caller text not null check (caller ~ '^[a-z_]{1,40}$'),
  code text not null check (code ~ '^[a-z0-9_]{1,40}$'),
  sqlstate text not null check (sqlstate ~ '^[0-9A-Z]{5}$'),
  at timestamptz not null default clock_timestamp()
);
create index alert_refusal_tenant_at_idx on app.alert_refusal (tenant_id, at desc);
alter table app.alert_refusal enable row level security;
revoke all on app.alert_refusal from public, anon, authenticated, service_role;

-- The P0001 messages of app.raise_alert that mean "this alert is refused" (20261022150600).
create function app.alert_guard_codes() returns text[]
  language sql immutable
  set search_path = ''
as $$
  select array['unknown_alert_kind', 'alert_audience_invalid', 'alert_audience_cost',
               'alert_payload_cost_key', 'alert_payload_invalid', 'alert_payload_cost_value']
$$;

create function app.record_alert_refusal(
  p_tenant uuid, p_kind text, p_entity_type text, p_entity_id uuid, p_caller text, p_code text,
  p_sqlstate text
) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into app.alert_refusal (tenant_id, kind, entity_type, entity_id, caller, code, sqlstate)
    values (p_tenant, coalesce(p_kind, ''), p_entity_type, p_entity_id, p_caller, p_code, p_sqlstate);
  raise warning 'alert refused: % %', p_kind, p_code;
end
$$;

create function app.try_raise_alert(
  p_tenant uuid,
  p_kind text,
  p_entity_type text,
  p_entity_id uuid,
  p_payload jsonb default '{}',
  p_severity public.alert_severity default null,
  p_audience public.app_role[] default null,
  p_at timestamptz default now(),
  p_business_date date default null,
  p_caller text default 'unknown'
) returns uuid
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_id uuid;
  v_code text;
begin
  begin
    select r.alert_id into v_id
      from app.raise_alert(p_tenant, p_kind, p_entity_type, p_entity_id, p_payload, p_severity,
                           p_audience, p_at, p_business_date) r;
    return v_id;
  exception when sqlstate 'P0001' then
    -- Here the nested block has been rolled back. Only the guard codes are absorbed.
    get stacked diagnostics v_code = message_text;
    if v_code <> all (app.alert_guard_codes()) then
      raise;
    end if;
    perform app.record_alert_refusal(p_tenant, p_kind, p_entity_type, p_entity_id, p_caller, v_code,
                                     sqlstate);
    return null;
  end;
end
$$;

revoke all on function app.alert_guard_codes(),
  app.record_alert_refusal(uuid, text, text, uuid, text, text, text),
  app.try_raise_alert(uuid, text, text, uuid, jsonb, public.alert_severity, public.app_role[], timestamptz, date, text)
  from public, anon, authenticated, service_role;
