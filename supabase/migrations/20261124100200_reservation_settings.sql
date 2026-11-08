-- Reservations A2 (docs/plans/2026-11-08-reservations.md §3.2, §5 A2, §5c): reading and saving the reservation settings, the bookable tables and the table groups.
--
--   app.reservation_settings_defaults / _row / _json   the settings of a tenant: the saved row, or the defaults when there is none (founder Q-R5: Pranzo online
--                         12:00-14:00 and Cena online 19:30-22:00, no limits). _json adds readiness: ready, and notReady in the order slug, privacy_name,
--                         privacy_email, seating. The services are listed from the M25c version in force (app.service_periods_at); a saved key that is not in
--                         it is ignored on read.
--   app.set_reservation_settings_at   the writer, with a "now" the tests fix (null = clock_timestamp() after the lock). Order: strict keys (22023) -> the tenant's
--                         advisory lock -> the fields (P0001 reservation_settings_invalid, DETAIL {"reason": field}) -> enabled while not ready (P0001
--                         reservations_not_ready, DETAIL {"reasons": [...]}) -> a slug of another tenant (P0001 slug_taken) -> compare, then write and audit or nothing.
--                         The audit row names the changed fields only, never their values.
--   app.set_table_booking_at, app.create_table_group_at, app.deactivate_table_group_at   the bookable flag and seats per table, and the groups (members never change).
--   public.reservation_settings, set_reservation_settings, table_booking, set_table_booking, create_table_group, deactivate_table_group   thin wrappers:
--                         app.require_day_closer() first (owner, admin; 42501 for anyone else, before the body is read).
-- audit_event: the entity type 'reservation_settings' and the action 'reservation_settings.changed' are added to the two checks (every earlier value stays).
-- Departure from the plan: app.reservation_services_ok is created with the table in 20261124100000 (its check needs it); pgTAP 291 tests it here.

alter table public.audit_event
  drop constraint audit_event_entity_type_check,
  drop constraint audit_event_action_check;
alter table public.audit_event
  add constraint audit_event_entity_type_check
    check (entity_type in ('invoice', 'ingredient', 'recipe', 'tenant', 'payable', 'app_user',
                           'venue_device', 'device_enrolment', 'count_session', 'staff_meal_rule', 'supplier',
                           'menu_item', 'dining_table', 'table_session', 'sale_settings', 'reservation_settings')),
  add constraint audit_event_action_check
    check (action in ('invoice.approved', 'invoice.rejected', 'invoice.duplicate_cleared',
                      'ingredient.allergens_confirmed', 'recipe.deactivated', 'recipe.reactivated',
                      'tenant.settings_changed', 'payable.status_changed', 'payable.payment_reversed',
                      'app_user.created', 'app_user.updated', 'app_user.deactivated',
                      'app_user.reactivated', 'app_user.pin_set', 'device_enrolment.created',
                      'venue_device.enrolled', 'venue_device.revoked', 'venue_device.unlocked',
                      'count_session.closed', 'count_session.cancelled', 'ingredient.critical_changed',
                      'staff_meal_rule.created', 'staff_meal_rule.updated',
                      'ingredient.rules_changed', 'supplier.delivery_changed', 'recipe.rules_changed',
                      'menu_item.created', 'menu_item.updated', 'dining_table.created',
                      'dining_table.updated', 'table_session.covers_changed', 'sale_settings.changed',
                      'tenant.demo_data_loaded', 'tenant.demo_data_removed', 'reservation_settings.changed'));

-- ---------------------------------------------------------------------------------------------------------------------
-- Small helpers: a whole number in a range (null when it is not one), a real calendar date (null when it is not one), the one error of the settings.
create function app.reservation_int(p jsonb, p_lo integer, p_hi integer) returns integer
  language sql
  immutable
  security definer
  set search_path = ''
as $$
  select case when jsonb_typeof(p) = 'number' and (p #>> '{}') ~ '^-?[0-9]{1,6}$'
                   and (p #>> '{}')::integer between p_lo and p_hi then (p #>> '{}')::integer end
$$;

create function app.reservation_date(p text) returns date
  language plpgsql
  immutable
  security definer
  set search_path = ''
as $$
begin
  if p is null or p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return null;
  end if;
  return p::date;
exception when others then
  return null;
end
$$;

create function app.reservation_settings_fail(p_reason text) returns void
  language plpgsql
  immutable
  security definer
  set search_path = ''
as $$
begin
  raise exception 'reservation_settings_invalid' using errcode = 'P0001', detail = jsonb_build_object('reason', p_reason)::text;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The settings of a tenant as one JSON object with the column names (no audit columns). It is the saved row or, with none, the defaults: the values of the
-- column defaults of public.reservation_settings (pgTAP 291 pins that the two agree).
create function app.reservation_settings_defaults() returns jsonb
  language sql
  immutable
  security definer
  set search_path = ''
as $$
  select jsonb_build_object('enabled', false, 'public_slug', null, 'venue_phone', null, 'slot_minutes', 15, 'stay_minutes', 120, 'lead_minutes', 120,
                            'horizon_days', 60, 'max_party_online', 8, 'cancel_until_minutes', 0, 'retention_days', 30,
                            'closed_weekdays', '[]'::jsonb, 'closed_dates', '[]'::jsonb, 'services', app.reservation_default_services(),
                            'privacy_controller_name', null, 'privacy_contact_email', null)
$$;

create function app.reservation_settings_row(p_tenant uuid) returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce((select to_jsonb(s) - 'tenant_id' - 'created_at' - 'created_by' - 'updated_at' - 'updated_by'
                     from public.reservation_settings s where s.tenant_id = p_tenant),
                  app.reservation_settings_defaults())
$$;

-- Why a page cannot be switched on yet, in a fixed order. p_row is app.reservation_settings_row's shape. 'seating' = no service of the version in force is
-- online with both of its booking times.
create function app.reservation_not_ready(p_tenant uuid, p_row jsonb, p_now timestamptz) returns text[]
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select array_remove(array[
    case when p_row ->> 'public_slug' is null then 'slug' end,
    case when p_row ->> 'privacy_controller_name' is null then 'privacy_name' end,
    case when p_row ->> 'privacy_contact_email' is null then 'privacy_email' end,
    case when not exists (
           select 1 from jsonb_array_elements(app.service_periods_at(p_tenant, p_now)) e
            where (p_row -> 'services' -> (e ->> 'key')) ->> 'online' = 'true'
              and (p_row -> 'services' -> (e ->> 'key')) ->> 'firstSeating' is not null
              and (p_row -> 'services' -> (e ->> 'key')) ->> 'lastSeating' is not null) then 'seating' end
  ]::text[], null)
$$;

create function app.reservation_settings_json(p_tenant uuid, p_now timestamptz) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  r jsonb := app.reservation_settings_row(p_tenant);
  v_nr text[] := app.reservation_not_ready(p_tenant, r, p_now);
begin
  return jsonb_build_object(
    'enabled', r -> 'enabled',
    'ready', cardinality(v_nr) = 0,
    'notReady', to_jsonb(v_nr),
    'publicSlug', r -> 'public_slug',
    'venuePhone', r -> 'venue_phone',
    'slotMinutes', r -> 'slot_minutes',
    'stayMinutes', r -> 'stay_minutes',
    'leadMinutes', r -> 'lead_minutes',
    'horizonDays', r -> 'horizon_days',
    'maxPartyOnline', r -> 'max_party_online',
    'cancelUntilMinutes', r -> 'cancel_until_minutes',
    'retentionDays', r -> 'retention_days',
    'closedWeekdays', r -> 'closed_weekdays',
    'closedDates', r -> 'closed_dates',
    'services', (select coalesce(jsonb_agg(jsonb_build_object(
                          'key', w ->> 'key', 'name', w ->> 'name', 'startsAt', w ->> 'startsAt', 'endsAt', w ->> 'endsAt',
                          'online', coalesce((c.cfg ->> 'online')::boolean, false),
                          'firstSeating', coalesce(c.cfg -> 'firstSeating', 'null'::jsonb),
                          'lastSeating', coalesce(c.cfg -> 'lastSeating', 'null'::jsonb),
                          'coversPerSlot', coalesce(c.cfg -> 'coversPerSlot', 'null'::jsonb),
                          'reservationsPerSlot', coalesce(c.cfg -> 'reservationsPerSlot', 'null'::jsonb),
                          'coversPerService', coalesce(c.cfg -> 'coversPerService', 'null'::jsonb)) order by (w ->> 'position')::integer), '[]'::jsonb)
                   from jsonb_array_elements(app.service_windows(app.service_periods_at(p_tenant, p_now), app.business_day_cutoff(p_tenant))) w
                  cross join lateral (select r -> 'services' -> (w ->> 'key') as cfg) c),
    'privacy', jsonb_build_object('controllerName', r -> 'privacy_controller_name',
                                  'controllerVat', (select to_jsonb(t.vat_number) from public.tenant t where t.id = p_tenant),
                                  'contactEmail', r -> 'privacy_contact_email'));
end
$$;

create function app.set_reservation_settings_at(p_tenant uuid, p_user uuid, p_body jsonb, p_now timestamptz) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_now timestamptz;
  v_cur jsonb;
  v_new jsonb;
  v_periods jsonb;
  v_in jsonb;
  v_map jsonb;
  v_int integer;
  v_text text;
  v_nr text[];
  v_changed text[];
begin
  perform app.menu_keys_ok(p_body, array['enabled', 'publicSlug', 'venuePhone', 'slotMinutes', 'stayMinutes', 'leadMinutes', 'horizonDays', 'maxPartyOnline',
                                         'cancelUntilMinutes', 'retentionDays', 'closedWeekdays', 'closedDates', 'services', 'privacyControllerName',
                                         'privacyContactEmail'], null);
  -- One writer per tenant: a second save waits here and then reads the row the first one wrote.
  perform pg_advisory_xact_lock(hashtextextended('reservation_settings:' || p_tenant::text, 0));
  v_now := coalesce(p_now, clock_timestamp());
  v_cur := app.reservation_settings_row(p_tenant);
  v_new := v_cur;

  if p_body ? 'enabled' then
    if jsonb_typeof(p_body -> 'enabled') <> 'boolean' then
      perform app.reservation_settings_fail('enabled');
    end if;
    v_new := v_new || jsonb_build_object('enabled', p_body -> 'enabled');
  end if;
  if p_body ? 'publicSlug' then
    if jsonb_typeof(p_body -> 'publicSlug') = 'null' then
      v_new := v_new || jsonb_build_object('public_slug', null);
    elsif jsonb_typeof(p_body -> 'publicSlug') = 'string' and (p_body ->> 'publicSlug') ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$' then
      v_new := v_new || jsonb_build_object('public_slug', p_body -> 'publicSlug');
    else
      perform app.reservation_settings_fail('public_slug');
    end if;
  end if;
  if p_body ? 'venuePhone' then
    if jsonb_typeof(p_body -> 'venuePhone') = 'null' then
      v_new := v_new || jsonb_build_object('venue_phone', null);
    elsif jsonb_typeof(p_body -> 'venuePhone') = 'string' and (p_body ->> 'venuePhone') ~ '^\+?[0-9 ]{6,20}$' then
      v_new := v_new || jsonb_build_object('venue_phone', p_body -> 'venuePhone');
    else
      perform app.reservation_settings_fail('venue_phone');
    end if;
  end if;
  -- slot_minutes is one of 15, 30, 60; the others are ranges.
  if p_body ? 'slotMinutes' then
    v_int := app.reservation_int(p_body -> 'slotMinutes', 15, 60);
    if v_int is null or v_int not in (15, 30, 60) then
      perform app.reservation_settings_fail('slot_minutes');
    end if;
    v_new := v_new || jsonb_build_object('slot_minutes', v_int);
  end if;
  if p_body ? 'stayMinutes' then
    v_int := app.reservation_int(p_body -> 'stayMinutes', 30, 360);
    if v_int is null then
      perform app.reservation_settings_fail('stay_minutes');
    end if;
    v_new := v_new || jsonb_build_object('stay_minutes', v_int);
  end if;
  if p_body ? 'leadMinutes' then
    v_int := app.reservation_int(p_body -> 'leadMinutes', 0, 2880);
    if v_int is null then
      perform app.reservation_settings_fail('lead_minutes');
    end if;
    v_new := v_new || jsonb_build_object('lead_minutes', v_int);
  end if;
  if p_body ? 'horizonDays' then
    v_int := app.reservation_int(p_body -> 'horizonDays', 1, 365);
    if v_int is null then
      perform app.reservation_settings_fail('horizon_days');
    end if;
    v_new := v_new || jsonb_build_object('horizon_days', v_int);
  end if;
  if p_body ? 'maxPartyOnline' then
    v_int := app.reservation_int(p_body -> 'maxPartyOnline', 1, 40);
    if v_int is null then
      perform app.reservation_settings_fail('max_party_online');
    end if;
    v_new := v_new || jsonb_build_object('max_party_online', v_int);
  end if;
  if p_body ? 'cancelUntilMinutes' then
    v_int := app.reservation_int(p_body -> 'cancelUntilMinutes', 0, 2880);
    if v_int is null then
      perform app.reservation_settings_fail('cancel_until_minutes');
    end if;
    v_new := v_new || jsonb_build_object('cancel_until_minutes', v_int);
  end if;
  if p_body ? 'retentionDays' then
    v_int := app.reservation_int(p_body -> 'retentionDays', 1, 365);
    if v_int is null then
      perform app.reservation_settings_fail('retention_days');
    end if;
    v_new := v_new || jsonb_build_object('retention_days', v_int);
  end if;
  if p_body ? 'closedWeekdays' then
    v_in := p_body -> 'closedWeekdays';
    if jsonb_typeof(v_in) <> 'array' or jsonb_array_length(v_in) > 7
       or exists (select 1 from jsonb_array_elements(v_in) e where app.reservation_int(e, 1, 7) is null) then
      perform app.reservation_settings_fail('closed_weekdays');
    end if;
    v_new := v_new || jsonb_build_object('closed_weekdays',
      (select coalesce(jsonb_agg(d order by d), '[]'::jsonb) from (select distinct app.reservation_int(e, 1, 7) as d from jsonb_array_elements(v_in) e) x));
  end if;
  if p_body ? 'closedDates' then
    v_in := p_body -> 'closedDates';
    if jsonb_typeof(v_in) <> 'array' or jsonb_array_length(v_in) > 366
       or exists (select 1 from jsonb_array_elements(v_in) e where jsonb_typeof(e) <> 'string' or app.reservation_date(e #>> '{}') is null) then
      perform app.reservation_settings_fail('closed_dates');
    end if;
    v_new := v_new || jsonb_build_object('closed_dates',
      (select coalesce(jsonb_agg(to_jsonb(to_char(d, 'YYYY-MM-DD')) order by d), '[]'::jsonb) from (select distinct app.reservation_date(e #>> '{}') as d from jsonb_array_elements(v_in) e) x));
  end if;
  if p_body ? 'privacyControllerName' then
    if jsonb_typeof(p_body -> 'privacyControllerName') = 'null' then
      v_new := v_new || jsonb_build_object('privacy_controller_name', null);
    else
      v_text := case when jsonb_typeof(p_body -> 'privacyControllerName') = 'string' then btrim(p_body ->> 'privacyControllerName') end;
      if v_text is null or char_length(v_text) not between 2 and 200 then
        perform app.reservation_settings_fail('privacy_controller_name');
      end if;
      v_new := v_new || jsonb_build_object('privacy_controller_name', v_text);
    end if;
  end if;
  if p_body ? 'privacyContactEmail' then
    if jsonb_typeof(p_body -> 'privacyContactEmail') = 'null' then
      v_new := v_new || jsonb_build_object('privacy_contact_email', null);
    else
      v_text := case when jsonb_typeof(p_body -> 'privacyContactEmail') = 'string' then btrim(p_body ->> 'privacyContactEmail') end;
      if v_text is null or char_length(v_text) > 254 or v_text !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
        perform app.reservation_settings_fail('privacy_contact_email');
      end if;
      v_new := v_new || jsonb_build_object('privacy_contact_email', v_text);
    end if;
  end if;
  if p_body ? 'services' then
    v_periods := app.service_periods_at(p_tenant, v_now);
    v_in := p_body -> 'services';
    if jsonb_typeof(v_in) <> 'array' or jsonb_array_length(v_in) > app.service_max_periods()
       or exists (
         select 1 from jsonb_array_elements(v_in) e
          where jsonb_typeof(e) <> 'object'
             or (select array_agg(k order by k collate "C") from jsonb_object_keys(e) k)
                is distinct from array['coversPerService', 'coversPerSlot', 'firstSeating', 'key', 'lastSeating', 'online', 'reservationsPerSlot']
             or jsonb_typeof(e -> 'key') <> 'string'
             or (e ->> 'key') <> all (array(select x ->> 'key' from jsonb_array_elements(v_periods) x)))
       or (select count(e ->> 'key') <> count(distinct e ->> 'key') from jsonb_array_elements(v_in) e) then
      perform app.reservation_settings_fail('services');
    end if;
    select coalesce(jsonb_object_agg(e ->> 'key', e - 'key'), '{}'::jsonb) into v_map from jsonb_array_elements(v_in) e;
    v_map := (v_new -> 'services') || v_map;
    if not app.reservation_services_ok(v_map) then
      perform app.reservation_settings_fail('services');
    end if;
    v_new := v_new || jsonb_build_object('services', v_map);
  end if;

  if (v_new ->> 'enabled')::boolean then
    v_nr := app.reservation_not_ready(p_tenant, v_new, v_now);
    if cardinality(v_nr) > 0 then
      raise exception 'reservations_not_ready' using errcode = 'P0001', detail = jsonb_build_object('reasons', to_jsonb(v_nr))::text;
    end if;
  end if;
  if (v_new ->> 'public_slug') is not null
     and exists (select 1 from public.reservation_settings s where s.public_slug = v_new ->> 'public_slug' and s.tenant_id <> p_tenant) then
    raise exception 'slug_taken' using errcode = 'P0001';
  end if;

  v_changed := array(select k from jsonb_object_keys(v_new) k where v_new -> k is distinct from v_cur -> k order by k collate "C");
  if cardinality(v_changed) > 0 then
    begin
      insert into public.reservation_settings (tenant_id, enabled, public_slug, venue_phone, slot_minutes, stay_minutes, lead_minutes, horizon_days, max_party_online,
                                               cancel_until_minutes, retention_days, closed_weekdays, closed_dates, services, privacy_controller_name,
                                               privacy_contact_email, created_at, created_by, updated_at, updated_by)
        values (p_tenant, (v_new ->> 'enabled')::boolean, v_new ->> 'public_slug', v_new ->> 'venue_phone', (v_new ->> 'slot_minutes')::smallint,
                (v_new ->> 'stay_minutes')::smallint, (v_new ->> 'lead_minutes')::smallint, (v_new ->> 'horizon_days')::smallint,
                (v_new ->> 'max_party_online')::smallint, (v_new ->> 'cancel_until_minutes')::smallint, (v_new ->> 'retention_days')::smallint,
                array(select e::smallint from jsonb_array_elements_text(v_new -> 'closed_weekdays') e),
                array(select e::date from jsonb_array_elements_text(v_new -> 'closed_dates') e),
                v_new -> 'services', v_new ->> 'privacy_controller_name', v_new ->> 'privacy_contact_email', v_now, p_user, v_now, p_user)
      on conflict (tenant_id) do update
        set enabled = excluded.enabled, public_slug = excluded.public_slug, venue_phone = excluded.venue_phone, slot_minutes = excluded.slot_minutes,
            stay_minutes = excluded.stay_minutes, lead_minutes = excluded.lead_minutes, horizon_days = excluded.horizon_days,
            max_party_online = excluded.max_party_online, cancel_until_minutes = excluded.cancel_until_minutes, retention_days = excluded.retention_days,
            closed_weekdays = excluded.closed_weekdays, closed_dates = excluded.closed_dates, services = excluded.services,
            privacy_controller_name = excluded.privacy_controller_name, privacy_contact_email = excluded.privacy_contact_email,
            updated_at = excluded.updated_at, updated_by = excluded.updated_by;
    exception when unique_violation then
      -- Another tenant took the slug between the check and the write (the lock above is per tenant).
      raise exception 'slug_taken' using errcode = 'P0001';
    end;
    insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_at, created_by)
      values (p_tenant, 'reservation_settings', p_tenant, 'reservation_settings.changed', jsonb_build_object('fields', to_jsonb(v_changed)), v_now, p_user);
  end if;
  return app.reservation_settings_json(p_tenant, v_now) || jsonb_build_object('changed', cardinality(v_changed) > 0);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The bookable flag and seats per table, and the groups.
create function app.table_group_json(p_tenant uuid, p_group uuid) returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select jsonb_build_object('id', g.id, 'name', g.name, 'seats', g.seats, 'isActive', g.is_active,
                            'tableIds', coalesce((select jsonb_agg(m.dining_table_id order by t.position, t.name collate "C", t.id)
                                                    from public.table_group_member m
                                                    join public.dining_table t on t.tenant_id = m.tenant_id and t.id = m.dining_table_id
                                                   where m.tenant_id = g.tenant_id and m.table_group_id = g.id), '[]'::jsonb))
    from public.table_group g
   where g.tenant_id = p_tenant and g.id = p_group
$$;

create function app.table_booking_json(p_tenant uuid) returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select jsonb_build_object(
    'tables', coalesce((select jsonb_agg(jsonb_build_object('tableId', t.id, 'name', t.name, 'position', t.position,
                                                            'bookable', coalesce(b.bookable, false), 'seats', b.seats)
                                         order by t.position, t.name collate "C", t.id)
                          from public.dining_table t
                          left join public.dining_table_booking b on b.tenant_id = t.tenant_id and b.dining_table_id = t.id
                         where t.tenant_id = p_tenant and t.is_active), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(app.table_group_json(p_tenant, g.id) order by g.name collate "C", g.id)
                          from public.table_group g where g.tenant_id = p_tenant and g.is_active), '[]'::jsonb))
$$;

create function app.set_table_booking_at(p_tenant uuid, p_user uuid, p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_in jsonb;
  v_changed integer;
begin
  perform app.menu_keys_ok(p_body, array['tables'], array['tables']);
  v_in := p_body -> 'tables';
  if jsonb_typeof(v_in) <> 'array' or jsonb_array_length(v_in) not between 1 and 200 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_in) e
     where jsonb_typeof(e) <> 'object'
        or (select array_agg(k order by k collate "C") from jsonb_object_keys(e) k) is distinct from array['bookable', 'seats', 'tableId']
        or jsonb_typeof(e -> 'tableId') <> 'string'
        or (e ->> 'tableId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(e -> 'bookable') <> 'boolean'
        or jsonb_typeof(e -> 'seats') not in ('number', 'null')) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('reservation_tables:' || p_tenant::text, 0));
  if exists (select 1 from jsonb_array_elements(v_in) e
              where not exists (select 1 from public.dining_table t where t.tenant_id = p_tenant and t.id = (e ->> 'tableId')::uuid and t.is_active)) then
    raise exception 'table_not_found' using errcode = 'P0002';
  end if;
  if (select count(distinct e ->> 'tableId') <> count(*) from jsonb_array_elements(v_in) e) then
    raise exception 'table_booking_invalid' using errcode = 'P0001', detail = '{"reason": "duplicate"}';
  end if;
  if exists (select 1 from jsonb_array_elements(v_in) e where jsonb_typeof(e -> 'seats') = 'number' and app.reservation_int(e -> 'seats', 1, 40) is null) then
    raise exception 'table_booking_invalid' using errcode = 'P0001', detail = '{"reason": "seats"}';
  end if;

  with want as (
    select (e ->> 'tableId')::uuid as table_id, (e ->> 'bookable')::boolean as bookable, app.reservation_int(e -> 'seats', 1, 40) as seats
      from jsonb_array_elements(v_in) e),
  diff as (
    select w.* from want w
      left join public.dining_table_booking b on b.tenant_id = p_tenant and b.dining_table_id = w.table_id
     where coalesce(b.bookable, false) is distinct from w.bookable or b.seats is distinct from w.seats::smallint),
  up as (
    insert into public.dining_table_booking (tenant_id, dining_table_id, bookable, seats, updated_by)
      select p_tenant, d.table_id, d.bookable, d.seats, p_user from diff d
    on conflict (tenant_id, dining_table_id) do update
      set bookable = excluded.bookable, seats = excluded.seats, updated_at = clock_timestamp(), updated_by = excluded.updated_by
    returning 1)
  select count(*)::integer into v_changed from up;
  return app.table_booking_json(p_tenant) || jsonb_build_object('changed', v_changed > 0);
end
$$;

create function app.create_table_group_at(p_tenant uuid, p_user uuid, p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_name text;
  v_seats integer;
  v_ids jsonb;
  v_group uuid := gen_random_uuid();
begin
  perform app.menu_keys_ok(p_body, array['name', 'seats', 'tableIds'], array['name', 'seats', 'tableIds']);
  perform pg_advisory_xact_lock(hashtextextended('reservation_tables:' || p_tenant::text, 0));
  v_name := case when jsonb_typeof(p_body -> 'name') = 'string' then btrim(p_body ->> 'name') end;
  if v_name is null or char_length(v_name) not between 1 and 40 then
    raise exception 'group_invalid' using errcode = 'P0001', detail = '{"reason": "name"}';
  end if;
  v_seats := app.reservation_int(p_body -> 'seats', 2, 99);
  if v_seats is null then
    raise exception 'group_invalid' using errcode = 'P0001', detail = '{"reason": "seats"}';
  end if;
  v_ids := p_body -> 'tableIds';
  if jsonb_typeof(v_ids) <> 'array' or jsonb_array_length(v_ids) not between 2 and 8
     or exists (select 1 from jsonb_array_elements(v_ids) e
                 where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     or (select count(distinct e #>> '{}') <> count(*) from jsonb_array_elements(v_ids) e)
     or exists (select 1 from jsonb_array_elements(v_ids) e
                 where not exists (select 1 from public.dining_table t where t.tenant_id = p_tenant and t.id = (e #>> '{}')::uuid and t.is_active)) then
    raise exception 'group_invalid' using errcode = 'P0001', detail = '{"reason": "tables"}';
  end if;
  if exists (select 1 from public.table_group g where g.tenant_id = p_tenant and g.is_active and lower(btrim(g.name)) = lower(v_name)) then
    raise exception 'group_invalid' using errcode = 'P0001', detail = '{"reason": "name_taken"}';
  end if;
  begin
    insert into public.table_group (tenant_id, id, name, seats, created_by) values (p_tenant, v_group, v_name, v_seats, p_user);
  exception when unique_violation then
    raise exception 'group_invalid' using errcode = 'P0001', detail = '{"reason": "name_taken"}';
  end;
  insert into public.table_group_member (tenant_id, table_group_id, dining_table_id)
    select p_tenant, v_group, (e #>> '{}')::uuid from jsonb_array_elements(v_ids) e;
  return jsonb_build_object('group', app.table_group_json(p_tenant, v_group));
end
$$;

create function app.deactivate_table_group_at(p_tenant uuid, p_user uuid, p_group uuid) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  g public.table_group;
  v_changed boolean := false;
begin
  perform pg_advisory_xact_lock(hashtextextended('reservation_tables:' || p_tenant::text, 0));
  select x.* into g from public.table_group x where x.tenant_id = p_tenant and x.id = p_group for update;
  if not found then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;
  if g.is_active then
    update public.table_group set is_active = false, deactivated_at = clock_timestamp(), deactivated_by = p_user where tenant_id = p_tenant and id = p_group;
    v_changed := true;
  end if;
  return jsonb_build_object('changed', v_changed, 'group', app.table_group_json(p_tenant, p_group));
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
create function public.reservation_settings() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_day_closer();
  return app.reservation_settings_json(app.tenant_id(), clock_timestamp());
end
$$;

create function public.set_reservation_settings(p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform app.require_day_closer();
  return app.set_reservation_settings_at(app.tenant_id(), app.app_user_id(), p_body, null);
end
$$;

create function public.table_booking() returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
begin
  perform app.require_day_closer();
  return app.table_booking_json(app.tenant_id());
end
$$;

create function public.set_table_booking(p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform app.require_day_closer();
  return app.set_table_booking_at(app.tenant_id(), app.app_user_id(), p_body);
end
$$;

create function public.create_table_group(p_body jsonb) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform app.require_day_closer();
  return app.create_table_group_at(app.tenant_id(), app.app_user_id(), p_body);
end
$$;

create function public.deactivate_table_group(p_group uuid) returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  perform app.require_day_closer();
  return app.deactivate_table_group_at(app.tenant_id(), app.app_user_id(), p_group);
end
$$;

revoke all on function app.reservation_int(jsonb, integer, integer), app.reservation_date(text), app.reservation_settings_fail(text),
  app.reservation_settings_defaults(), app.reservation_settings_row(uuid), app.reservation_not_ready(uuid, jsonb, timestamptz),
  app.reservation_settings_json(uuid, timestamptz), app.set_reservation_settings_at(uuid, uuid, jsonb, timestamptz),
  app.table_group_json(uuid, uuid), app.table_booking_json(uuid), app.set_table_booking_at(uuid, uuid, jsonb),
  app.create_table_group_at(uuid, uuid, jsonb), app.deactivate_table_group_at(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.reservation_settings(), public.set_reservation_settings(jsonb), public.table_booking(), public.set_table_booking(jsonb),
  public.create_table_group(jsonb), public.deactivate_table_group(uuid) from public, anon, service_role;
grant execute on function public.reservation_settings(), public.set_reservation_settings(jsonb), public.table_booking(), public.set_table_booking(jsonb),
  public.create_table_group(jsonb), public.deactivate_table_group(uuid) to authenticated;
