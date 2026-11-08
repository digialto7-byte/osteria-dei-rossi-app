-- Reservations A1 (docs/plans/2026-11-08-reservations.md §3.2; ADR-032): the data model of table reservations. Nothing is public yet: no
-- function here is granted to an API role, and nobody holds a write grant on any table. The writers are SECURITY DEFINER procedures of the next steps.
--
--   public.reservation_settings    one row per tenant: the switch, the page slug, the capacity rules, the booking times per service, the privacy notice owner.
--   public.dining_table_booking    per table: bookable and seats (a side table: dining_table gets no column).
--   public.table_group (+ _member) named sets of tables with their own seats; members never change.
--   public.reservation             the booking: status, slot, party, source, the privacy acknowledgement. State on the row, history in the ledger.
--   public.reservation_contact     the personal data (name, phone, e-mail, locale), 1:1; deleted by retention or on request, never updated.
--   public.reservation_table       the tables assigned to a booking; released, never deleted.
--   public.reservation_event       append-only ledger (codes, times and ids only; never personal data).
--   public.reservation_email       the e-mail outbox (no address, no personal data).
--   app.reservation_throttle       daily-salted hashes of IP, e-mail and phone for the abuse limits (schema app, no API grant).
--
-- Departures from the plan text, both because the code wins: app.reservation_services_ok is created here (the settings table's check needs it, and a table
-- cannot be created before the function its check calls), and the founder's Q-R5 answer is kept in app.reservation_default_services (the column default and
-- the row-less read share it). reservation_contact.email is nullable (founder Q-R16): the online request still requires it, in request_reservation.

create type public.reservation_status as enum
  ('pending', 'accepted', 'declined', 'cancelled', 'expired', 'arrived', 'seated', 'no_show');

-- The booking times of a tenant that never saved settings (founder, Q-R5): Pranzo 12:00-14:00 and Cena 19:30-22:00, both online, no limits.
create function app.reservation_default_services() returns jsonb
  language sql
  immutable
  security definer
  set search_path = ''
as $$
  select '{"pranzo":{"online":true,"firstSeating":"12:00","lastSeating":"14:00","coversPerSlot":null,"reservationsPerSlot":null,"coversPerService":null},
           "cena":{"online":true,"firstSeating":"19:30","lastSeating":"22:00","coversPerSlot":null,"reservationsPerSlot":null,"coversPerService":null}}'::jsonb
$$;

-- True when p is an object whose keys are service keys and whose values have exactly the six keys: online (boolean), firstSeating and lastSeating (both null or
-- both HH:MM with first <= last) and three limits that are null or whole numbers 1 to 999.
create function app.reservation_services_ok(p jsonb) returns boolean
  language plpgsql
  immutable
  security definer
  set search_path = ''
as $$
declare
  k text;
  v jsonb;
  f text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return false;
  end if;
  for k, v in select e.key, e.value from jsonb_each(p) e loop
    if k !~ '^[a-z][a-z0-9_]{1,31}$' or jsonb_typeof(v) <> 'object' then
      return false;
    end if;
    if (select array_agg(x order by x collate "C") from jsonb_object_keys(v) x)
       is distinct from array['coversPerService', 'coversPerSlot', 'firstSeating', 'lastSeating', 'online', 'reservationsPerSlot'] then
      return false;
    end if;
    if jsonb_typeof(v -> 'online') <> 'boolean' then
      return false;
    end if;
    if jsonb_typeof(v -> 'firstSeating') = 'null' and jsonb_typeof(v -> 'lastSeating') = 'null' then
      null;
    elsif jsonb_typeof(v -> 'firstSeating') = 'string' and jsonb_typeof(v -> 'lastSeating') = 'string'
          and (v ->> 'firstSeating') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and (v ->> 'lastSeating') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          and (v ->> 'firstSeating') <= (v ->> 'lastSeating') then
      null;
    else
      return false;
    end if;
    foreach f in array array['coversPerSlot', 'reservationsPerSlot', 'coversPerService'] loop
      if jsonb_typeof(v -> f) = 'null' then
        continue;
      end if;
      if jsonb_typeof(v -> f) <> 'number' or (v ->> f) !~ '^[0-9]{1,3}$' or (v ->> f)::integer not between 1 and 999 then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end
$$;

revoke all on function app.reservation_default_services(), app.reservation_services_ok(jsonb) from public, anon, authenticated, service_role;

create table public.reservation_settings (
  tenant_id uuid primary key references public.tenant (id),
  enabled boolean not null default false,
  public_slug text unique check (public_slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  venue_phone text check (venue_phone ~ '^\+?[0-9 ]{6,20}$'),
  slot_minutes smallint not null default 15 check (slot_minutes in (15, 30, 60)),
  stay_minutes smallint not null default 120 check (stay_minutes between 30 and 360),
  lead_minutes smallint not null default 120 check (lead_minutes between 0 and 2880),
  horizon_days smallint not null default 60 check (horizon_days between 1 and 365),
  max_party_online smallint not null default 8 check (max_party_online between 1 and 40),
  cancel_until_minutes smallint not null default 0 check (cancel_until_minutes between 0 and 2880),
  retention_days smallint not null default 30 check (retention_days between 1 and 365),
  closed_weekdays smallint[] not null default '{}' check (closed_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  closed_dates date[] not null default '{}' check (cardinality(closed_dates) <= 366),
  services jsonb not null default app.reservation_default_services() check (app.reservation_services_ok(services)),
  privacy_controller_name text check (char_length(privacy_controller_name) between 2 and 200),
  privacy_contact_email text check (char_length(privacy_contact_email) <= 254),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid,
  constraint reservation_settings_created_by_fkey foreign key (tenant_id, created_by) references public.app_user (tenant_id, id),
  constraint reservation_settings_updated_by_fkey foreign key (tenant_id, updated_by) references public.app_user (tenant_id, id)
);

create table public.dining_table_booking (
  tenant_id uuid not null references public.tenant (id),
  dining_table_id uuid not null,
  bookable boolean not null default false,
  seats smallint check (seats between 1 and 40),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid,
  primary key (tenant_id, dining_table_id),
  constraint dining_table_booking_table_fkey foreign key (tenant_id, dining_table_id) references public.dining_table (tenant_id, id),
  constraint dining_table_booking_user_fkey foreign key (tenant_id, updated_by) references public.app_user (tenant_id, id)
);

create table public.table_group (
  tenant_id uuid not null references public.tenant (id),
  id uuid not null default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  seats smallint not null check (seats between 2 and 99),
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null,
  deactivated_at timestamptz,
  deactivated_by uuid,
  primary key (tenant_id, id),
  constraint table_group_deactivated_ck check ((deactivated_at is null) = (deactivated_by is null) and (is_active = (deactivated_at is null))),
  constraint table_group_created_by_fkey foreign key (tenant_id, created_by) references public.app_user (tenant_id, id),
  constraint table_group_deactivated_by_fkey foreign key (tenant_id, deactivated_by) references public.app_user (tenant_id, id)
);
create unique index table_group_name_uq on public.table_group (tenant_id, lower(btrim(name))) where is_active;

create table public.table_group_member (
  tenant_id uuid not null references public.tenant (id),
  table_group_id uuid not null,
  dining_table_id uuid not null,
  primary key (tenant_id, table_group_id, dining_table_id),
  constraint table_group_member_group_fkey foreign key (tenant_id, table_group_id) references public.table_group (tenant_id, id),
  constraint table_group_member_table_fkey foreign key (tenant_id, dining_table_id) references public.dining_table (tenant_id, id)
);

create table public.reservation (
  tenant_id uuid not null references public.tenant (id),
  id uuid not null default gen_random_uuid(),
  status public.reservation_status not null default 'pending',
  business_date date not null,
  service_key text not null check (service_key ~ '^[a-z][a-z0-9_]{1,31}$'),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  party smallint not null check (party between 1 and 99),
  -- 'staff' is written by create_staff_reservation only (founder Q-R16). Immutable.
  source text not null default 'online' check (source in ('online', 'staff')),
  table_session_id uuid,
  privacy_notice_version text check (char_length(privacy_notice_version) between 1 and 40),
  privacy_ack_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, id),
  constraint reservation_privacy_ck check (source <> 'online' or (privacy_notice_version is not null and privacy_ack_at is not null)),
  constraint reservation_session_fkey foreign key (tenant_id, table_session_id) references public.table_session (tenant_id, id)
);
create index reservation_day_idx on public.reservation (tenant_id, business_date, service_key, starts_at);

create table public.reservation_contact (
  tenant_id uuid not null references public.tenant (id),
  reservation_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  phone text not null check (phone ~ '^\+?[0-9]{6,15}$'),
  -- required for source 'online' (checked in request_reservation); optional for 'staff'
  email text check (char_length(email) between 3 and 254),
  locale text not null check (locale in ('it', 'en')),
  primary key (tenant_id, reservation_id),
  constraint reservation_contact_reservation_fkey foreign key (tenant_id, reservation_id) references public.reservation (tenant_id, id)
);

create table public.reservation_table (
  tenant_id uuid not null references public.tenant (id),
  id uuid not null default gen_random_uuid(),
  reservation_id uuid not null,
  dining_table_id uuid not null,
  table_group_id uuid,
  assigned_at timestamptz not null,
  assigned_by uuid not null,
  released_at timestamptz,
  released_by uuid,
  primary key (tenant_id, id),
  constraint reservation_table_released_ck check ((released_at is null) = (released_by is null)),
  constraint reservation_table_reservation_fkey foreign key (tenant_id, reservation_id) references public.reservation (tenant_id, id),
  constraint reservation_table_table_fkey foreign key (tenant_id, dining_table_id) references public.dining_table (tenant_id, id),
  constraint reservation_table_group_fkey foreign key (tenant_id, table_group_id) references public.table_group (tenant_id, id),
  constraint reservation_table_assigned_by_fkey foreign key (tenant_id, assigned_by) references public.app_user (tenant_id, id),
  constraint reservation_table_released_by_fkey foreign key (tenant_id, released_by) references public.app_user (tenant_id, id)
);
create unique index reservation_table_current_uq on public.reservation_table (tenant_id, reservation_id, dining_table_id) where released_at is null;
create index reservation_table_table_idx on public.reservation_table (tenant_id, dining_table_id) where released_at is null;

create table public.reservation_event (
  tenant_id uuid not null references public.tenant (id),
  id uuid not null default gen_random_uuid(),
  seq bigint generated always as identity,
  reservation_id uuid not null,
  kind text not null check (kind in ('requested', 'accepted', 'declined', 'moved', 'tables_assigned', 'arrived', 'seated', 'no_show',
                                     'cancelled_by_customer', 'expired', 'contact_erased', 'contact_purged', 'created_by_staff', 'tables_split')),
  -- codes, times, party and table ids; never personal data
  data jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp(),
  -- null = the customer or a job
  created_by uuid,
  primary key (tenant_id, id),
  constraint reservation_event_reservation_fkey foreign key (tenant_id, reservation_id) references public.reservation (tenant_id, id),
  constraint reservation_event_user_fkey foreign key (tenant_id, created_by) references public.app_user (tenant_id, id)
);
create index reservation_event_reservation_idx on public.reservation_event (tenant_id, reservation_id, seq);

create table public.reservation_email (
  tenant_id uuid not null references public.tenant (id),
  id uuid not null default gen_random_uuid(),
  reservation_id uuid not null,
  kind text not null check (kind in ('received', 'accepted', 'declined')),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts smallint not null default 0,
  next_attempt_at timestamptz not null default clock_timestamp(),
  lease_until timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, id),
  constraint reservation_email_reservation_fkey foreign key (tenant_id, reservation_id) references public.reservation (tenant_id, id)
);
create index reservation_email_due_idx on public.reservation_email (next_attempt_at) where status in ('queued', 'failed', 'sending');

create table app.reservation_throttle (
  tenant_id uuid not null references public.tenant (id),
  day date not null,
  kind text not null check (kind in ('ip', 'email', 'phone')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  hits integer not null default 0,
  primary key (tenant_id, day, kind, key_hash)
);

-- ---------------------------------------------------------------------------------------------------------------------
-- Guards. All SECURITY DEFINER with an empty search_path, like every function of this feature; none is executable by an API role.
create function app.reservation_guard() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.created_at is distinct from old.created_at
     or new.source is distinct from old.source
     or new.privacy_notice_version is distinct from old.privacy_notice_version
     or new.privacy_ack_at is distinct from old.privacy_ack_at
     or (old.table_session_id is not null and new.table_session_id is distinct from old.table_session_id) then
    raise exception 'reservation_immutable' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status
     and not ((old.status = 'pending' and new.status in ('accepted', 'declined', 'cancelled', 'expired'))
              or (old.status = 'accepted' and new.status in ('arrived', 'seated', 'no_show', 'declined', 'cancelled'))
              or (old.status = 'arrived' and new.status in ('seated', 'no_show'))) then
    raise exception 'status_invalid' using errcode = 'P0001';
  end if;
  return new;
end
$$;

-- An assignment is released once (released_at and released_by), and nothing else about it changes.
create function app.reservation_table_guard() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if old.released_at is not null
     or new.released_at is null
     or (new.id, new.tenant_id, new.reservation_id, new.dining_table_id, new.table_group_id, new.assigned_at, new.assigned_by)
        is distinct from (old.id, old.tenant_id, old.reservation_id, old.dining_table_id, old.table_group_id, old.assigned_at, old.assigned_by) then
    raise exception 'reservation_table_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;

-- A group is edited by deactivating it and creating another: only the one-way switch is allowed.
create function app.table_group_guard() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if old.is_active is not true
     or (new.id, new.tenant_id, new.name, new.seats, new.created_at, new.created_by)
        is distinct from (old.id, old.tenant_id, old.name, old.seats, old.created_at, old.created_by) then
    raise exception 'table_group_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;

-- The personal data is never updated. It is deleted only inside the two definers that set app.contact_delete locally (erase on request, retention),
-- or by the demo reset of a tenant that carries demo data (the same exception as app.append_only).
create function app.reservation_contact_guard() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'reservation_contact_immutable' using errcode = 'P0001';
  end if;
  if coalesce(current_setting('app.contact_delete', true), '') = 'on' then
    return old;
  end if;
  if coalesce(current_setting('app.demo_purge', true), '') <> '' and app.demo_purge_allows(old.tenant_id) then
    return old;
  end if;
  raise exception 'append_only' using errcode = 'P0001';
end
$$;

-- Throttle rows are deleted only by the retention function (it sets app.throttle_delete locally).
create function app.reservation_throttle_guard() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if coalesce(current_setting('app.throttle_delete', true), '') = 'on' then
    return old;
  end if;
  raise exception 'append_only' using errcode = 'P0001';
end
$$;

revoke all on function app.reservation_guard(), app.reservation_table_guard(), app.table_group_guard(), app.reservation_contact_guard(),
  app.reservation_throttle_guard() from public, anon, authenticated, service_role;

create trigger reservation_guard before update on public.reservation for each row execute function app.reservation_guard();
create trigger reservation_table_guard before update on public.reservation_table for each row execute function app.reservation_table_guard();
create trigger table_group_guard before update on public.table_group for each row execute function app.table_group_guard();
create trigger reservation_contact_guard before update or delete on public.reservation_contact for each row execute function app.reservation_contact_guard();
create trigger reservation_throttle_guard before delete on app.reservation_throttle for each row execute function app.reservation_throttle_guard();

-- Append-only for every role (the demo reset may delete): the ledger and the group members. Delete refused on every other table.
create trigger reservation_event_append_only before update or delete on public.reservation_event for each row execute function app.append_only();
create trigger table_group_member_append_only before update or delete on public.table_group_member for each row execute function app.append_only();
create trigger reservation_append_only before delete on public.reservation for each row execute function app.append_only();
create trigger reservation_table_append_only before delete on public.reservation_table for each row execute function app.append_only();
create trigger reservation_email_append_only before delete on public.reservation_email for each row execute function app.append_only();
create trigger reservation_settings_append_only before delete on public.reservation_settings for each row execute function app.append_only();
create trigger dining_table_booking_append_only before delete on public.dining_table_booking for each row execute function app.append_only();
create trigger table_group_append_only before delete on public.table_group for each row execute function app.append_only();

create trigger reservation_event_no_truncate before truncate on public.reservation_event for each statement execute function app.append_only_truncate();
create trigger table_group_member_no_truncate before truncate on public.table_group_member for each statement execute function app.append_only_truncate();
create trigger reservation_no_truncate before truncate on public.reservation for each statement execute function app.append_only_truncate();
create trigger reservation_table_no_truncate before truncate on public.reservation_table for each statement execute function app.append_only_truncate();
create trigger reservation_email_no_truncate before truncate on public.reservation_email for each statement execute function app.append_only_truncate();
create trigger reservation_settings_no_truncate before truncate on public.reservation_settings for each statement execute function app.append_only_truncate();
create trigger dining_table_booking_no_truncate before truncate on public.dining_table_booking for each statement execute function app.append_only_truncate();
create trigger table_group_no_truncate before truncate on public.table_group for each statement execute function app.append_only_truncate();
create trigger reservation_contact_no_truncate before truncate on public.reservation_contact for each statement execute function app.append_only_truncate();
create trigger reservation_throttle_no_truncate before truncate on app.reservation_throttle for each statement execute function app.append_only_truncate();

-- ---------------------------------------------------------------------------------------------------------------------
-- RLS and grants: select for authenticated and service_role, no write grant and no write policy. anon holds nothing.
alter table public.reservation_settings enable row level security;
alter table public.dining_table_booking enable row level security;
alter table public.table_group enable row level security;
alter table public.table_group_member enable row level security;
alter table public.reservation enable row level security;
alter table public.reservation_contact enable row level security;
alter table public.reservation_table enable row level security;
alter table public.reservation_event enable row level security;
alter table public.reservation_email enable row level security;
alter table app.reservation_throttle enable row level security;

revoke all on public.reservation_settings, public.dining_table_booking, public.table_group, public.table_group_member, public.reservation,
  public.reservation_contact, public.reservation_table, public.reservation_event, public.reservation_email from anon, authenticated, service_role;
revoke all on app.reservation_throttle from public, anon, authenticated, service_role;
grant select on public.reservation_settings, public.dining_table_booking, public.table_group, public.table_group_member, public.reservation,
  public.reservation_contact, public.reservation_table, public.reservation_event, public.reservation_email to authenticated, service_role;

create policy reservation_select on public.reservation for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin', 'waiter'));
create policy reservation_contact_select on public.reservation_contact for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin', 'waiter'));
create policy reservation_table_select on public.reservation_table for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin', 'waiter'));
create policy reservation_event_select on public.reservation_event for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin', 'waiter'));
create policy reservation_settings_select on public.reservation_settings for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
create policy dining_table_booking_select on public.dining_table_booking for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
create policy table_group_select on public.table_group for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
create policy table_group_member_select on public.table_group_member for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
create policy reservation_email_select on public.reservation_email for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
