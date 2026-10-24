-- M15 step 8: the batch checks in the nightly invariant check (M15 plan §3.1.10; ADR-014; M13 plan §3.1.10).
-- app.ledger_checks_body is replaced (create or replace keeps the owner and the closed grants) with EVERY check of
-- 20261027100700_ledger_invariants.sql kept verbatim, plus three:
--   batch_origin      a batch without exactly one origin movement equal to portions_initial (this wires the M14 contract)
--   split_unbalanced  a batch_split operation that is not two rows summing to 0 from a parent to the child it names
--   batch_state       finished/discarded that does not match remaining <= 0, or a fresh batch with more than its origin
-- "Portions never negative" is not a check: M19 firing may go below 0 on purpose (plan rule 8, alerted there).
-- Still ONE SQL statement (pgTAP 117 counts the semicolons: comments in this body carry none).
-- If another milestone replaces this body too, the second one must keep every check of both.

create or replace function app.ledger_checks_body(p_tenant uuid, p_at timestamptz)
  returns table (check_key text, rows_count integer, sample_ids uuid[])
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with
  -- a lot without exactly one receipt that matches it (lot, ingredient, location, invoice line, quantity)
  lot_missing as (
    select l.id
      from public.raw_lot l
     where l.tenant_id = p_tenant
       and (select count(*)
              from public.stock_movement m
             where m.tenant_id = l.tenant_id and m.type::text = 'receipt' and m.raw_lot_id = l.id
               and m.ingredient_id = l.ingredient_id and m.location_id = l.location_id
               and m.ref_id = l.invoice_line_id and m.qty = l.qty_received) <> 1),
  -- a receipt whose lot is missing or differs
  receipt_bad as (
    select m.id
      from public.stock_movement m
     where m.tenant_id = p_tenant and m.type::text = 'receipt'
       and not exists (select 1 from public.raw_lot l
                        where l.tenant_id = m.tenant_id and l.id = m.raw_lot_id and l.ingredient_id = m.ingredient_id
                          and l.location_id = m.location_id and l.invoice_line_id = m.ref_id
                          and l.qty_received = m.qty)),
  -- every user reference must be a user of the same tenant (the foreign keys of the ledgers are not tenant-composite)
  user_bad as (
    select m.id from public.stock_movement m
     where m.tenant_id = p_tenant
       and not exists (select 1 from public.app_user u where u.id = m.created_by and u.tenant_id = m.tenant_id)
    union all
    select l.id from public.raw_lot l
     where l.tenant_id = p_tenant
       and not exists (select 1 from public.app_user u where u.id = l.created_by and u.tenant_id = l.tenant_id)
    union all
    select e.id from public.audit_event e
     where e.tenant_id = p_tenant
       and not exists (select 1 from public.app_user u where u.id = e.created_by and u.tenant_id = e.tenant_id)
    union all
    select c.id from public.count_session c
     where c.tenant_id = p_tenant
       and (not exists (select 1 from public.app_user u where u.id = c.started_by and u.tenant_id = c.tenant_id)
            or (c.closed_by is not null
                and not exists (select 1 from public.app_user u where u.id = c.closed_by and u.tenant_id = c.tenant_id))
            or (c.cancelled_by is not null
                and not exists (select 1 from public.app_user u where u.id = c.cancelled_by and u.tenant_id = c.tenant_id)))),
  -- a lot bucket (ingredient, location, lot) below zero
  lot_neg as (
    select b.raw_lot_id as id
      from (select m.raw_lot_id, m.ingredient_id, m.location_id, sum(m.qty) as q
              from public.stock_movement m
             where m.tenant_id = p_tenant and m.raw_lot_id is not null
             group by m.raw_lot_id, m.ingredient_id, m.location_id) b
     where b.q < 0),
  -- a reversal that does not mirror its original
  rev_bad as (
    select m.id
      from public.stock_movement m
      left join public.stock_movement o on o.tenant_id = m.tenant_id and o.id = m.reverses_id
     where m.tenant_id = p_tenant and m.reverses_id is not null
       and (o.id is null or o.reverses_id is not null or o.ingredient_id <> m.ingredient_id
            or o.location_id <> m.location_id or o.raw_lot_id is distinct from m.raw_lot_id or o.type <> m.type
            or o.reason_code is distinct from m.reason_code or o.unit_cost is distinct from m.unit_cost
            or o.qty <> -m.qty)),
  -- a transfer operation (reversals included) whose rows do not sum to zero, per ingredient
  transfer_bad as (
    select (array_agg(m.id order by m.id))[1] as id
      from public.stock_movement m
     where m.tenant_id = p_tenant and m.type::text = 'transfer'
     group by m.ref_type, m.ref_id, m.ingredient_id
    having sum(m.qty) <> 0),
  -- a closed line whose posted rows differ from counted minus expected (zero for an uncounted line), or a count row
  -- whose session is missing, at another location, not closed, or without a line for the ingredient
  count_bad as (
    select l.id
      from public.count_line l
      join public.count_session s on s.tenant_id = l.tenant_id and s.id = l.session_id
     where l.tenant_id = p_tenant and s.status = 'closed'
       and coalesce((select sum(m.qty) from public.stock_movement m
                      where m.tenant_id = l.tenant_id and m.type::text = 'count' and m.ref_type = 'count_session'
                        and m.ref_id = l.session_id and m.ingredient_id = l.ingredient_id
                        and m.location_id = s.location_id), 0)
           <> coalesce(l.counted_qty - l.expected_qty, 0)
    union all
    select m.id
      from public.stock_movement m
     where m.tenant_id = p_tenant and m.type::text = 'count' and m.ref_type = 'count_session'
       and not exists (select 1
                         from public.count_session s
                         join public.count_line l on l.tenant_id = s.tenant_id and l.session_id = s.id
                        where s.tenant_id = m.tenant_id and s.id = m.ref_id and s.status = 'closed'
                          and s.location_id = m.location_id and l.ingredient_id = m.ingredient_id)),
  -- a batch without exactly one origin movement (a produce for a root batch, the inbound split for a split part), or
  -- whose origin differs from the portions it was made with
  batch_origin_bad as (
    select b.id
      from public.batch b
     where b.tenant_id = p_tenant
       and ((select count(*)
               from public.batch_movement m
              where m.tenant_id = b.tenant_id and m.batch_id = b.id
                and (m.type::text = 'produce' or (m.type::text = 'split' and m.portions > 0))) <> 1
            or (select count(*)
                  from public.batch_movement m
                 where m.tenant_id = b.tenant_id and m.batch_id = b.id and m.portions = b.portions_initial
                   and ((b.split_from_batch_id is null and m.type::text = 'produce')
                        or (b.split_from_batch_id is not null and m.type::text = 'split' and m.ref_id = b.id))) <> 1)),
  -- one row per split operation with what it moved and between which batches
  split_ops as (
    select m.ref_id, count(*) as n, sum(m.portions) as s, (array_agg(m.id order by m.id))[1] as id,
           min(m.batch_id::text) filter (where m.portions < 0) as src,
           min(m.batch_id::text) filter (where m.portions > 0) as dst
      from public.batch_movement m
     where m.tenant_id = p_tenant and m.ref_type = 'batch_split'
     group by m.ref_id),
  -- a split operation that is not exactly two rows summing to zero from a parent to the child it names
  split_bad as (
    select o.id
      from split_ops o
     where o.n <> 2 or o.s <> 0 or o.dst is distinct from o.ref_id::text
        or not exists (select 1 from public.batch c
                        where c.tenant_id = p_tenant and c.id = o.ref_id and c.split_from_batch_id::text = o.src)),
  -- the state must match the ledger (finished or discarded exactly when nothing is left) and a fresh batch is untouched
  state_bad as (
    select b.id
      from public.batch b
      cross join lateral (select coalesce(sum(m.portions), 0) as rem, count(*) as n
                            from public.batch_movement m
                           where m.tenant_id = b.tenant_id and m.batch_id = b.id) r
     where b.tenant_id = p_tenant
       and ((b.state::text in ('finished', 'discarded')) <> (r.rem <= 0)
            or (b.state::text = 'fresh' and r.n > 1)))
  select 'lot_receipt_missing'::text, count(*)::integer, (array_agg(x.id order by x.id))[1:5] from lot_missing x having count(*) > 0
  union all
  select 'receipt_lot_mismatch', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from receipt_bad x having count(*) > 0
  union all
  select 'movement_user', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from user_bad x having count(*) > 0
  union all
  select 'lot_negative', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from lot_neg x having count(*) > 0
  union all
  select 'reversal_mirror', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from rev_bad x having count(*) > 0
  union all
  select 'transfer_unbalanced', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from transfer_bad x having count(*) > 0
  union all
  select 'count_mismatch', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from count_bad x having count(*) > 0
  union all
  select 'batch_origin', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from batch_origin_bad x having count(*) > 0
  union all
  select 'split_unbalanced', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from split_bad x having count(*) > 0
  union all
  select 'batch_state', count(*)::integer, (array_agg(x.id order by x.id))[1:5] from state_bad x having count(*) > 0;
end
$$;
