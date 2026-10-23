-- M11 step 3: device enrolment (M11 plan §3.1.3, §3.2; ADR-010).
-- The owner or admin creates a single-use code (only its SHA-256 is stored, valid 15 minutes). The staff
-- device redeems it; the redemption runs before any session exists, so it is executable by service_role
-- only (decision D1) and is rate limited per hashed client IP inside the procedure.

alter table public.venue_device
  add constraint venue_device_enrolment_fk foreign key (enrolment_id)
    references public.device_enrolment (id);

-- Owner and admin manage staff and devices; chef, waiter and no claims get 42501.
create function app.require_staff_manager() returns void
  language plpgsql stable
  set search_path = ''
as $$
begin
  if coalesce((select app.role())::text, '') not in ('owner', 'admin') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
end
$$;
revoke all on function app.require_staff_manager() from public, anon, authenticated, service_role;

create function public.create_enrolment_code(p_code_hash text, p_label text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_label text := btrim(coalesce(p_label, ''));
  v_id uuid;
  v_expires timestamptz;
begin
  perform app.require_staff_manager();
  v_tenant := app.tenant_id();
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_hash' using errcode = '22023';
  end if;
  if length(v_label) not between 1 and 60 then
    raise exception 'label_invalid' using errcode = 'P0001';
  end if;

  insert into public.device_enrolment (tenant_id, label, code_hash, expires_at, created_by)
    values (v_tenant, v_label, p_code_hash, clock_timestamp() + interval '15 minutes', app.app_user_id())
    returning id, expires_at into v_id, v_expires;

  insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
    values (v_tenant, 'device_enrolment', v_id, 'device_enrolment.created',
            jsonb_build_object('label', v_label), app.app_user_id());

  return jsonb_build_object('id', v_id, 'label', v_label, 'expiresAt', v_expires);
end
$$;
revoke all on function public.create_enrolment_code(text, text) from public, anon, service_role;
grant execute on function public.create_enrolment_code(text, text) to authenticated;

-- Redemption. Failures are returned as statuses (not raised) so that the failure row commits.
create function app.redeem_enrolment_code_at(
  p_code_hash text, p_token_hash text, p_ip_hash text, p_at timestamptz
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_code public.device_enrolment;
  v_device uuid;
begin
  if p_code_hash !~ '^[0-9a-f]{64}$' or p_token_hash !~ '^[0-9a-f]{64}$' or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_hash' using errcode = '22023';
  end if;

  -- 1. The IP limit comes first and looks nothing up: a limited caller cannot probe codes.
  if (select count(*) from app.enrol_failure f
       where f.ip_hash = p_ip_hash and f.at > p_at - interval '15 minutes' and f.at <= p_at) >= 10 then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  -- 2. The code row is locked, so two redemptions of one code serialise (race redeem-twice).
  select * into v_code from public.device_enrolment e where e.code_hash = p_code_hash for update;
  if not found then
    insert into app.enrol_failure (ip_hash, at) values (p_ip_hash, p_at);
    return jsonb_build_object('status', 'code_invalid');
  end if;
  if v_code.used_at is not null then
    insert into app.enrol_failure (ip_hash, at) values (p_ip_hash, p_at);
    return jsonb_build_object('status', 'code_used');
  end if;
  if v_code.expires_at <= p_at then
    insert into app.enrol_failure (ip_hash, at) values (p_ip_hash, p_at);
    return jsonb_build_object('status', 'code_expired');
  end if;

  insert into public.venue_device (tenant_id, label, token_hash, enrolment_id, enrolled_at, created_by)
    values (v_code.tenant_id, v_code.label, p_token_hash, v_code.id, p_at, v_code.created_by)
    returning id into v_device;
  update public.device_enrolment set used_at = p_at, device_id = v_device where id = v_code.id;
  insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
    values (v_code.tenant_id, 'venue_device', v_device, 'venue_device.enrolled',
            jsonb_build_object('label', v_code.label), v_code.created_by);

  return jsonb_build_object('status', 'ok', 'deviceId', v_device, 'label', v_code.label);
end
$$;
revoke all on function app.redeem_enrolment_code_at(text, text, text, timestamptz)
  from public, anon, authenticated, service_role;

create function public.redeem_enrolment_code(p_code_hash text, p_token_hash text, p_ip_hash text)
  returns jsonb
  language sql
  security definer
  set search_path = ''
as $$
  select app.redeem_enrolment_code_at(p_code_hash, p_token_hash, p_ip_hash, clock_timestamp())
$$;

-- The staff a device offers on its PIN screen: active PIN chefs and waiters of the device's tenant.
create function public.device_staff_list(p_token_hash text) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_device public.venue_device;
begin
  select * into v_device from public.venue_device d where d.token_hash = p_token_hash;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  if v_device.revoked_at is not null then
    return jsonb_build_object('status', 'revoked');
  end if;
  return jsonb_build_object(
    'status', 'ok',
    'label', v_device.label,
    'locked', v_device.locked_at is not null,
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'displayName', u.display_name, 'role', u.role)
                       order by u.display_name, u.id)
        from public.app_user u
       where u.tenant_id = v_device.tenant_id and u.is_active and u.login_method = 'pin'
         and u.role in ('chef', 'waiter')), '[]'::jsonb));
end
$$;

revoke all on function public.redeem_enrolment_code(text, text, text), public.device_staff_list(text)
  from public, anon, authenticated, service_role;
grant execute on function public.redeem_enrolment_code(text, text, text), public.device_staff_list(text)
  to service_role;
