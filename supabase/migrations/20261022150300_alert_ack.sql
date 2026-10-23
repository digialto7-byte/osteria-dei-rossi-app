-- M6 step 5: one-tap acknowledgement and the owner's test alerts (M6 plan §3.1.6, §3.2).
-- Both follow the project's definer rules: the role is checked first, search_path is empty, the tenant
-- comes from app.tenant_id(), execute goes to authenticated only.

-- Who can acknowledge: whoever can read the alert. The owner reads every alert of the tenant; the chef
-- only the non-cost alerts meant for the kitchen. Admin (DigiAlto support) and waiter are refused.
-- One acknowledgement counts for everyone: a second call changes nothing and returns the first.
-- A hidden alert is "not found" (P0002), so the chef cannot learn that an owner-only alert exists.
create function public.acknowledge_alert(p_alert uuid) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v public.alert;
  v_role public.app_role := (select app.role());
begin
  if coalesce(v_role::text, '') not in ('owner', 'chef') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  -- FOR UPDATE: two taps at once queue; the second then sees the first's acknowledgement.
  select * into v
    from public.alert a
   where a.id = p_alert
     and a.tenant_id = (select app.tenant_id())
     and (v_role = 'owner'
          or ('chef'::public.app_role = any (a.audience_roles) and not a.cost_bearing))
     for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v.acknowledged_at is null then
    v.acknowledged_at := now();
    v.acknowledged_by := (select app.app_user_id());
    update public.alert
       set acknowledged_at = v.acknowledged_at, acknowledged_by = v.acknowledged_by
     where id = v.id;
  end if;
  return jsonb_build_object('acknowledgedAt', v.acknowledged_at, 'acknowledgedBy', v.acknowledged_by);
end
$$;

-- The owner's "check that alerts work" button, and the way end-to-end tests raise a real alert. One per
-- kind per tenant per day (dedup). Returns {alertId, inserted}.
create function public.raise_test_alert(p_include_kitchen boolean default false) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_tenant uuid := (select app.tenant_id());
  v_id uuid;
  v_inserted boolean;
begin
  if coalesce((select app.role())::text, '') <> 'owner' then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  select r.alert_id, r.inserted into v_id, v_inserted
    from app.raise_alert(v_tenant,
           case when coalesce(p_include_kitchen, false) then 'test_alert_kitchen' else 'test_alert' end,
           'tenant', v_tenant, '{}') r;
  return jsonb_build_object('alertId', v_id, 'inserted', v_inserted);
end
$$;

revoke all on function public.acknowledge_alert(uuid), public.raise_test_alert(boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.acknowledge_alert(uuid), public.raise_test_alert(boolean)
  to authenticated;
