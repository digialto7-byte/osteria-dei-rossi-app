-- M16 step 8: the expiry rule (plan §3.1.8; AT5; "kitchen audience"). A raw lot whose balance is above 0 and whose expiry is
-- tomorrow or earlier (app.expiry_state: due_soon, expired), and a batch with portions left whose use-by is within 24 hours or
-- past (app.use_by_state, elapsed hours): raw_lot_expiring and batch_expiring, severity warning when due soon and critical when
-- expired. Expired stock keeps alerting once a day until it is used or discarded (Q64). The ledgers are read only for the
-- candidate lots and batches. Closed to every API role. Returns the number of NEW alerts.
create function app.expiry_rule(p_tenant uuid, p_at timestamptz)
  returns integer
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_today date := app.alert_business_date(p_tenant, p_at);
  v_items integer := 0;
  r record;
begin
  for r in
    select c.* from (
      select rl.id as lot_id, rl.ingredient_id, i.base_unit::text as unit, rl.expiry,
             app.expiry_state(rl.expiry, v_today) as state,
             (select sum(m.qty) from public.stock_movement m where m.tenant_id = p_tenant and m.raw_lot_id = rl.id) as remaining
        from public.raw_lot rl
        join public.ingredient i on i.tenant_id = rl.tenant_id and i.id = rl.ingredient_id
       where rl.tenant_id = p_tenant and rl.expiry is not null and rl.expiry <= v_today + 1
    ) c
    where c.remaining > 0
    order by c.lot_id
  loop
    continue when exists (
      select 1 from public.alert a
       where a.tenant_id = p_tenant and a.kind = 'raw_lot_expiring' and a.entity_type = 'raw_lot'
         and a.entity_id = r.lot_id and a.business_date = v_today);
    if app.raise_rule_alert(
         p_tenant, 'raw_lot_expiring', 'raw_lot', r.lot_id,
         jsonb_build_object('raw_lot_id', r.lot_id, 'ingredient_id', r.ingredient_id, 'remaining_qty', trim_scale(r.remaining),
                            'unit', r.unit, 'expiry_date', r.expiry, 'state_key', r.state),
         case when r.state = 'expired' then 'critical'::public.alert_severity else 'warning'::public.alert_severity end,
         p_at, 'expiry_rules') then
      v_items := v_items + 1;
    end if;
  end loop;

  for r in
    select c.* from (
      select b.id as batch_id, b.recipe_key, b.use_by, app.use_by_state(b.use_by, p_at) as state,
             (select sum(bm.portions) from public.batch_movement bm where bm.tenant_id = p_tenant and bm.batch_id = b.id) as remaining
        from public.batch b
       where b.tenant_id = p_tenant and b.use_by <= p_at + make_interval(hours => 24)
    ) c
    where c.remaining > 0
    order by c.batch_id
  loop
    continue when exists (
      select 1 from public.alert a
       where a.tenant_id = p_tenant and a.kind = 'batch_expiring' and a.entity_type = 'batch'
         and a.entity_id = r.batch_id and a.business_date = v_today);
    if app.raise_rule_alert(
         p_tenant, 'batch_expiring', 'batch', r.batch_id,
         jsonb_build_object('batch_id', r.batch_id, 'recipe_key', r.recipe_key, 'remaining_portions_qty', trim_scale(r.remaining),
                            'use_by_at', app.iso_utc(r.use_by), 'state_key', r.state),
         case when r.state = 'expired' then 'critical'::public.alert_severity else 'warning'::public.alert_severity end,
         p_at, 'expiry_rules') then
      v_items := v_items + 1;
    end if;
  end loop;
  return v_items;
end
$$;

revoke all on function app.expiry_rule(uuid, timestamptz) from public, anon, authenticated, service_role;
