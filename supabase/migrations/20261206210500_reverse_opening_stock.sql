-- Opening stock, step 9 (docs/plans/2026-11-18-opening-stock.md §3.6, §5 step 9): the correction of a carico, by reversal of the whole operation.
--
--   app.opening_reversal_reasons()           the four reason codes of spec §5: qty_wrong, cost_wrong, ingredient_wrong, location_wrong.
--   public.reverse_opening_stock(opening, reason) -> {openingId, reversalOperationId, restoredLineIds}, one transaction:
--      1. app.require_opening_writer() (owner and admin; the chef and the waiter get 42501).
--      2. A null argument -> 22023; a reason outside the list -> P0001 opening_reason_invalid.
--      3. The operation row, locked (for update); not the tenant's or unknown -> P0002 opening_not_found.
--      4. The draft advisory lock of the location (the one opening_draft_put takes), then the stock locks of the operation's ingredients; then, after the locks,
--         app.opening_check_bookable: after the location's first closed monthly count, or during an open count, a carico is no longer corrected by reversal (Q5): stock is
--         corrected by a count, the cost by the next invoice.
--      5. Any row of the operation already mirrored -> P0001 already_reversed (the unique index stock_movement_reverses_uq is the backstop, as in reverse_movement).
--      6. The location's draft must be empty, else P0001 opening_draft_not_empty (Q9): the restored rows would mix with rows the owner is still writing.
--      7. One mirror per original row, in id order: same ingredient, location, null lot, type 'opening', the same unit_cost, the opposite qty, ref_type 'reversal', one fresh ref_id
--         for the whole reversal, reverses_id = the original, effective_on = the ORIGINAL's (Q6: the correction restates the carico on its own date, so the reconciliation of the
--         carico's period nets to the corrected figure). The mirror guard and stock_movement_opening_ck check the rest.
--      8. The rows go back into the draft (spec §5): one opening_draft_line per original row, new ids, same ingredient, qty and unit cost, written by the caller.
--      9. One audit row stock.opening_reversed: {reason_code, lines, total_value_eur}.
-- public.reverse_movement is NOT re-created: it already refuses ref_type 'opening' (movement_not_reversible), so the generic Magazzino path cannot reverse a carico without a reason.
-- Lock order: the stock_opening row, the location's draft advisory lock, the stock locks in id order. post_opening_stock takes draft row locks then stock locks and never this
-- operation's row; opening_draft_put takes only the draft advisory lock; no count procedure takes either. No cycle.

create function app.opening_reversal_reasons() returns text[] language sql immutable set search_path = ''
  as $$ select array['qty_wrong', 'cost_wrong', 'ingredient_wrong', 'location_wrong']::text[] $$;
revoke all on function app.opening_reversal_reasons() from public, anon, authenticated, service_role;

create function public.reverse_opening_stock(p_opening uuid, p_reason text) returns jsonb
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user uuid;
  o public.stock_opening;
  v_op uuid := gen_random_uuid();
  v_n integer;
  v_total numeric;
  v_restored jsonb;
begin
  perform app.require_opening_writer();
  v_tenant := app.tenant_id();
  v_user := app.app_user_id();

  if p_opening is null or p_reason is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if not (p_reason = any (app.opening_reversal_reasons())) then
    raise exception 'opening_reason_invalid' using errcode = 'P0001';
  end if;

  select * into o from public.stock_opening s where s.tenant_id = v_tenant and s.id = p_opening for update;
  if not found then
    raise exception 'opening_not_found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtext('opening_draft'), hashtext(v_tenant::text || o.location_id::text));
  perform app.lock_ingredient_stock(v_tenant, (select array_agg(m.ingredient_id) from public.stock_movement m
                                                where m.tenant_id = v_tenant and m.ref_type = 'opening' and m.ref_id = o.id));

  -- After the locks, in new statements.
  perform app.opening_check_bookable(v_tenant, o.location_id);
  if exists (select 1 from public.stock_movement m
               join public.stock_movement x on x.tenant_id = m.tenant_id and x.reverses_id = m.id
              where m.tenant_id = v_tenant and m.ref_type = 'opening' and m.ref_id = o.id) then
    raise exception 'already_reversed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.opening_draft_line d where d.tenant_id = v_tenant and d.location_id = o.location_id) then
    raise exception 'opening_draft_not_empty' using errcode = 'P0001';
  end if;

  begin
    insert into public.stock_movement (tenant_id, ingredient_id, raw_lot_id, location_id, type, qty, unit_cost, reason_code, ref_type, ref_id, reverses_id, effective_on, created_by)
      select v_tenant, m.ingredient_id, null, m.location_id, m.type, -m.qty, m.unit_cost, null, 'reversal', v_op, m.id, m.effective_on, v_user
        from public.stock_movement m
       where m.tenant_id = v_tenant and m.ref_type = 'opening' and m.ref_id = o.id
       order by m.id;
  exception when unique_violation then
    raise exception 'already_reversed' using errcode = 'P0001';
  end;

  with restored as (
    insert into public.opening_draft_line (id, tenant_id, location_id, ingredient_id, qty, unit_cost, created_by, updated_by)
      select gen_random_uuid(), v_tenant, m.location_id, m.ingredient_id, m.qty, m.unit_cost, v_user, v_user
        from public.stock_movement m
       where m.tenant_id = v_tenant and m.ref_type = 'opening' and m.ref_id = o.id
       order by m.id
    returning id
  )
  select coalesce(jsonb_agg(r.id order by r.id), '[]'::jsonb) into v_restored from restored r;

  select count(*)::int, coalesce(sum(round(m.qty * m.unit_cost, 2)), 0.00) into v_n, v_total
    from public.stock_movement m
   where m.tenant_id = v_tenant and m.ref_type = 'opening' and m.ref_id = o.id;
  insert into public.audit_event (tenant_id, entity_type, entity_id, action, after, created_by)
    values (v_tenant, 'stock_opening', o.id, 'stock.opening_reversed',
            jsonb_build_object('reason_code', p_reason, 'lines', v_n, 'total_value_eur', v_total), v_user);

  return jsonb_build_object('openingId', o.id, 'reversalOperationId', v_op, 'restoredLineIds', v_restored);
end
$$;

revoke all on function public.reverse_opening_stock(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.reverse_opening_stock(uuid, text) to authenticated;
