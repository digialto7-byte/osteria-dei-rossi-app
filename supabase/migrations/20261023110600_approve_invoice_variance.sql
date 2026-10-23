-- M8 step 8: the price variance check inside approve_invoice (M8 plan §3.1.9, §3.2; AT5).
--
-- After an approval has written its price rows, each ingredient it priced is compared with the moving
-- average of the last N purchases before this invoice (the PRD's "moving average", whatever basis the
-- ingredient uses). A change of more than price_variance_pct, up or down, raises ONE alert for that
-- ingredient, owner only, naming every active recipe that reaches it (through sub-recipes and
-- batches) with its new cost and, for plates, margin, GP % and status.
-- An alert can never undo an approval: approve_invoice runs the check in its own block (see below).
--
-- Lock order of approve_invoice after this migration: invoice row (FOR NO KEY UPDATE) -> duplicate
-- advisory lock -> supplier_item rows by id -> ingredient cost advisory locks by ingredient id ->
-- M5 inserts and updates -> recipe graph lock (SHARED) -> variance check. Recipe writers take only the
-- graph lock (exclusive) and then recipe_key rows; they never wait for an invoice, item or ingredient
-- cost lock, so there is no wait cycle.

create function app.lock_recipe_graph_shared(p_tenant uuid) returns void
  language plpgsql
  set search_path = ''
as $$
declare
  k record;
begin
  select * into k from app.recipe_graph_lock_key(p_tenant);
  perform pg_advisory_xact_lock_shared(k.class, k.obj);
end
$$;

-- One row per ingredient priced by the invoice: the price row with the largest absolute change from
-- the baseline (ties: the later row). Baseline = mean of the last N purchases (N = avg_cost_n) with
-- effective_on not after that row's date, excluding every row of this invoice. No baseline, or a
-- baseline of 0, gives no row (the first purchase of an ingredient never alerts).
create function app.price_variance_candidates(p_tenant uuid, p_invoice uuid)
  returns table (ingredient_id uuid, price_history_id uuid, new_price numeric, baseline numeric,
                 purchases_in_baseline integer, change_pct numeric)
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_n integer;
begin
  select s.avg_cost_n into v_n from app.cost_settings(p_tenant) s;
  return query
  select distinct on (c.ing) c.ing, c.ph, c.new_price, c.base, c.used, c.chg
    from (
      select ph.ingredient_id as ing, ph.id as ph, ph.seq, ph.unit_price as new_price,
             b.avg_price as base, b.used::integer as used,
             (ph.unit_price - b.avg_price) / b.avg_price * 100 as chg
        from public.price_history ph
        join public.invoice_line il on il.tenant_id = ph.tenant_id and il.id = ph.invoice_line_id
       cross join lateral (
         select avg(x.unit_price) as avg_price, count(*) as used
           from (select p.unit_price
                   from public.price_history p
                   join public.invoice_line pl on pl.tenant_id = p.tenant_id and pl.id = p.invoice_line_id
                  where p.tenant_id = p_tenant and p.ingredient_id = ph.ingredient_id
                    and pl.invoice_id <> p_invoice and p.effective_on <= ph.effective_on
                  order by p.effective_on desc, p.seq desc
                  limit v_n) x
       ) b
       where ph.tenant_id = p_tenant and il.invoice_id = p_invoice and b.used > 0 and b.avg_price > 0
    ) c
   order by c.ing, abs(c.chg) desc, c.seq desc;
end
$$;

-- The active recipes whose CURRENT version reaches the ingredient, directly or through sub-recipe and
-- batch lines. Distinct-node walk upwards (rows (key, depth) joined with UNION, as the M7 walks), depth
-- at most 13: never one row per path.
create function app.affected_recipe_keys(p_tenant uuid, p_ingredient uuid) returns uuid[]
  language sql stable
  security definer
  set search_path = ''
as $$
  with recursive up (key, depth) as (
    select r.recipe_key, 1
      from public.recipe_line l
      join public.recipe r on r.tenant_id = l.tenant_id and r.id = l.recipe_id
      join public.recipe_key k on k.tenant_id = r.tenant_id and k.id = r.recipe_key
       and k.current_version = r.version
     where l.tenant_id = p_tenant and l.ingredient_id = p_ingredient
    union
    select r.recipe_key, u.depth + 1
      from up u
      join public.recipe_line l on l.tenant_id = p_tenant and l.sub_recipe_key = u.key
      join public.recipe r on r.tenant_id = l.tenant_id and r.id = l.recipe_id
      join public.recipe_key k on k.tenant_id = r.tenant_id and k.id = r.recipe_key
       and k.current_version = r.version
     where u.depth <= 13
  )
  select coalesce(array_agg(distinct u.key), '{}'::uuid[])
    from up u
    join public.recipe_key k on k.tenant_id = p_tenant and k.id = u.key and k.is_active
$$;

-- The alert payload (plan §3.1.9): the facts of the change and at most 20 affected recipes, plates
-- first (below_target and incomplete before ok, then GP % ascending), then batches, then subs, each by
-- name. recipes_count is the full count, recipes_listed the entries kept. Whatever the names, entries
-- are dropped from the end until the text is at most 7 680 bytes (the table allows 8 192).
create function app.price_variance_payload(
  p_tenant uuid, p_invoice uuid, p_ingredient uuid, p_new_price numeric, p_baseline numeric,
  p_purchases integer, p_change_pct numeric, p_threshold numeric
) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
as $$
declare
  v_keys uuid[] := app.affected_recipe_keys(p_tenant, p_ingredient);
  v_recipes jsonb;
  v_count integer := cardinality(v_keys);
  v_head jsonb;
  v_payload jsonb;
begin
  select jsonb_build_object(
           'ingredient_id', i.id, 'ingredient_name', left(i.name, 80), 'unit', i.base_unit,
           'invoice_id', inv.id, 'invoice_number', left(coalesce(inv.number_raw, ''), 80),
           'supplier_id', s.id, 'supplier_name', left(s.name, 80))
    into v_head
    from public.ingredient i
    join public.invoice inv on inv.tenant_id = i.tenant_id and inv.id = p_invoice
    join public.supplier s on s.tenant_id = inv.tenant_id and s.id = inv.supplier_id
   where i.tenant_id = p_tenant and i.id = p_ingredient;

  if v_head is null then
    raise exception 'variance_input_missing' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(e.entry order by e.rk, e.status_rank, e.gp, e.nm collate "C", e.rkey), '[]'::jsonb)
    into v_recipes
    from (
      select c.type, c.recipe_key as rkey, c.name as nm,
             case c.type when 'plate' then 1 when 'batch' then 2 else 3 end as rk,
             case when pr.status in ('below_target', 'incomplete') then 0 else 1 end as status_rank,
             pr.gp_pct as gp,
             jsonb_build_object('recipe_key', c.recipe_key, 'type', c.type, 'name', left(c.name, 80),
               'unit_cost_eur', round(c.unit_cost, 4), 'cost_unit', c.cost_unit)
             || case when c.type = 'plate' then jsonb_build_object(
                  'margin_eur', round(pr.gross_margin, 4), 'gp_pct', round(pr.gp_pct, 2),
                  'target_gp_pct', pr.target_gp_pct, 'status', pr.status)
                else '{}'::jsonb end as entry
        from app.recipe_costs(p_tenant, v_keys, null) c
        left join app.plate_cost_rows(p_tenant, v_keys, null, false) pr on pr.recipe_key = c.recipe_key
    ) e;
  -- At most 20 entries (PRICE_ALERT_MAX_RECIPES).
  v_recipes := coalesce((select jsonb_agg(x.value order by x.ord)
                           from jsonb_array_elements(v_recipes) with ordinality x (value, ord)
                          where x.ord <= 20), '[]'::jsonb);

  v_payload := v_head || jsonb_build_object(
    'new_price_eur', round(p_new_price, 4), 'baseline_eur', round(p_baseline, 4),
    'change_pct', round(p_change_pct, 2), 'threshold_pct', p_threshold,
    'purchases_in_baseline', p_purchases, 'recipes_count', v_count,
    'recipes_listed', jsonb_array_length(v_recipes), 'recipes', v_recipes);
  while octet_length(v_payload::text) > 7680 and jsonb_array_length(v_payload -> 'recipes') > 0 loop
    v_recipes := v_payload -> 'recipes';
    v_recipes := v_recipes - (jsonb_array_length(v_recipes) - 1);
    v_payload := v_payload || jsonb_build_object('recipes', v_recipes,
      'recipes_listed', jsonb_array_length(v_recipes));
  end loop;
  return v_payload;
end
$$;

-- Raises the alerts of an approved invoice. Returns how many alerts it raised (a refused one counts 0).
create function app.price_variance_check(p_tenant uuid, p_invoice uuid) returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_threshold numeric;
  c record;
  v_raised integer := 0;
  v_id uuid;
begin
  select s.price_variance_pct into v_threshold from app.cost_settings(p_tenant) s;
  for c in
    select * from app.price_variance_candidates(p_tenant, p_invoice) k
     where abs(k.change_pct) > v_threshold
     order by k.price_history_id
  loop
    v_id := app.try_raise_alert(p_tenant, 'price_variance', 'price_history', c.price_history_id,
      app.price_variance_payload(p_tenant, p_invoice, c.ingredient_id, c.new_price, c.baseline,
                                 c.purchases_in_baseline, c.change_pct, v_threshold),
      null, null, now(), null, 'approve_invoice');
    if v_id is not null then
      v_raised := v_raised + 1;
    end if;
  end loop;
  return v_raised;
end
$$;

revoke all on function app.lock_recipe_graph_shared(uuid), app.price_variance_candidates(uuid, uuid),
  app.affected_recipe_keys(uuid, uuid),
  app.price_variance_payload(uuid, uuid, uuid, numeric, numeric, integer, numeric, numeric),
  app.price_variance_check(uuid, uuid)
  from public, anon, authenticated, service_role;

-- approve_invoice: the body of 20261022140700 unchanged, plus the ingredient cost locks after the item
-- locks and the contained variance check after the audit event. Same signature, same return value;
-- `create or replace` keeps the privileges.
create or replace function public.approve_invoice(p_invoice uuid, p_location uuid default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v public.invoice;
  v_lock bigint;
  v_blockers jsonb;
  v_lines app.approval_line[];
  v_date date;
  v_loc uuid;
  v_due record;
  v_user uuid := app.app_user_id();
  v_gross numeric;
  v_credited numeric;
  v_payable public.payable;
  v_receipts int;
begin
  perform app.require_invoice_approver();

  -- The invoice first, as every review procedure does: one lock order everywhere. FOR NO KEY UPDATE,
  -- not FOR UPDATE: the advisory lock below can be held by an extraction of a copy that then needs a
  -- KEY SHARE lock on this row (its duplicate_of foreign key); FOR UPDATE would deadlock with it.
  select * into v
    from public.invoice i
   where i.id = p_invoice and i.tenant_id = (select app.tenant_id())
     for no key update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v.status = 'approved' then
    raise exception 'invoice_already_approved' using errcode = 'P0001';
  elsif v.status = 'rejected' then
    raise exception 'invoice_rejected' using errcode = 'P0001';
  elsif v.status = 'duplicate' then
    raise exception 'duplicate_invoice' using errcode = 'P0001';
  elsif v.status <> 'review' then
    raise exception 'invoice_not_in_review' using errcode = 'P0001';
  end if;

  -- The duplicate key's lock, so a concurrent extraction of the same document cannot slip past the
  -- live-duplicate check below.
  v_lock := app.invoice_dup_lock_key(
    v.tenant_id, v.supplier_vat, v.supplier_name, v.number_raw, v.invoice_date);
  if v_lock is not null then
    perform pg_advisory_xact_lock(v_lock);
  end if;

  v_blockers := app.approval_blockers(p_invoice, p_location);
  if jsonb_array_length(v_blockers) > 0 then
    raise exception '%', v_blockers -> 0 ->> 'code' using errcode = 'P0001';
  end if;

  -- One read of the lines, after the invoice lock: every insert below uses this same view.
  v_lines := array(select a from app.approval_lines(p_invoice) a);
  v_date := app.receipt_date(p_invoice);
  v_loc := app.resolve_location(v.tenant_id, p_location);
  select * into v_due from app.resolve_due_date(p_invoice);

  -- The supplier items this invoice uses, in id order (two approvals sharing items lock them in the
  -- same order, so they cannot deadlock).
  perform 1
    from public.supplier_item si
   where si.tenant_id = v.tenant_id
     and si.id = any (array(select l.supplier_item_id from unnest(v_lines) l
                             where l.supplier_item_id is not null))
   order by si.id
     for update;

  -- M8: one cost lock per ingredient priced by this invoice, in id order, so two approvals that move the
  -- same ingredient see each other's price rows (the later one waits, then reads the earlier one's).
  -- After the item locks, outside the contained block below (a rolled-back check must not release it).
  perform app.lock_ingredient_costs(v.tenant_id,
    array(select l.ingredient_id from unnest(v_lines) l
           where l.is_stock and l.received_qty > 0 and l.ingredient_id is not null));

  -- Receipts: a lot and its movement per received stock line, in line order.
  with src as (
    select l.* from unnest(v_lines) l where l.is_stock and l.received_qty > 0
  ), lots as (
    insert into public.raw_lot (tenant_id, ingredient_id, location_id, supplier_id, invoice_line_id,
        lot_code, expiry, received_on, qty_received, base_unit, source_qty, source_unit, base_factor,
        created_by)
      select v.tenant_id, s.ingredient_id, v_loc, v.supplier_id, s.line_id, s.lot_code, s.expiry,
             v_date, s.received_qty, s.base_unit, s.qty - s.credit_qty, s.unit, s.base_factor, v_user
        from src s
       order by s.position, s.sub_position
      returning id, invoice_line_id, ingredient_id, qty_received
  )
  insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty,
      unit_cost, ref_type, ref_id, effective_on, created_by)
    select v.tenant_id, t.ingredient_id, t.id, v_loc, 'receipt', t.qty_received, s.unit_price,
           'invoice_line', t.invoice_line_id, v_date, v_user
      from lots t
      join src s on s.line_id = t.invoice_line_id;
  get diagnostics v_receipts = row_count;

  -- Price history, EUR per base unit, in line order (so seq follows the invoice).
  insert into public.price_history (tenant_id, ingredient_id, supplier_id, supplier_item_id,
      invoice_line_id, unit_price, base_unit, effective_on, created_by)
    select v.tenant_id, s.ingredient_id, v.supplier_id, s.supplier_item_id, s.line_id, s.unit_price,
           s.base_unit, v_date, v_user
      from unnest(v_lines) s
     where s.is_stock and s.received_qty > 0
     order by s.position, s.sub_position;

  -- last_price: the newest price row of each item, by invoice date then seq. Recomputed from the
  -- ledger after the item locks, so an older invoice approved late never overwrites a newer price.
  update public.supplier_item si
     set last_price = (select p.unit_price
                         from public.price_history p
                        where p.tenant_id = si.tenant_id and p.supplier_item_id = si.id
                        order by p.effective_on desc, p.seq desc
                        limit 1)
   where si.tenant_id = v.tenant_id
     and si.id = any (array(select l.supplier_item_id from unnest(v_lines) l
                             where l.is_stock and l.received_qty > 0
                               and l.supplier_item_id is not null));

  -- The payable: the gross total less the value of the credits (the supplier is paid the VAT too).
  v_gross := round(v.gross_total, 2);
  select coalesce(sum(l.credited_amount), 0) into v_credited from unnest(v_lines) l;
  insert into public.payable (tenant_id, invoice_id, supplier_id, gross_amount, credited_amount,
      amount, due_date, due_date_source, created_by)
    values (v.tenant_id, v.id, v.supplier_id, v_gross, v_credited, v_gross - v_credited,
            v_due.due_date, v_due.source, v_user)
    returning * into v_payable;

  update public.invoice set status = 'approved' where id = v.id;

  insert into public.audit_event (tenant_id, entity_type, entity_id, action, before, after, created_by)
    values (v.tenant_id, 'invoice', v.id, 'invoice.approved',
            jsonb_build_object('status', 'review'),
            jsonb_build_object('status', 'approved', 'payable_id', v_payable.id,
              'amount', v_payable.amount, 'due_date', v_payable.due_date,
              'due_date_source', v_payable.due_date_source, 'receipt_date', v_date,
              'location_id', v_loc, 'receipts', v_receipts),
            v_user);

  -- M8: the price variance check. The graph lock is shared: approvals do not block each other, a recipe
  -- version in progress makes the approval wait (and the reverse), so the affected recipes and their new
  -- margins come from one stable graph. The check is advice: if it fails for any reason other than a
  -- refused alert (which try_raise_alert already absorbed), the block rolls back to its savepoint, the
  -- failure is recorded in app.alert_refusal and the approval commits. query_canceled (a statement
  -- timeout) is not caught by `others`, so it still aborts the whole approval.
  perform app.lock_recipe_graph_shared(v.tenant_id);
  begin
    perform app.price_variance_check(v.tenant_id, p_invoice);
  exception when others then
    perform app.record_alert_refusal(v.tenant_id, 'price_variance', 'invoice', p_invoice,
      'approve_invoice', 'check_failed', sqlstate);
  end;

  return jsonb_build_object('payableId', v_payable.id, 'amount', v_payable.amount,
    'dueDate', v_payable.due_date, 'receipts', v_receipts);
end
$$;
