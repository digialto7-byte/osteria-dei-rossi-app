-- M15 step 2: the helpers behind the batch actions (M15 plan §3.1.5, §3.1.8, §3.1.12, §3.2; ADR-014). All in schema
-- app with an empty search_path; none is executable by an API role.
--   business_date      the venue's business day of an instant (cut-off from tenant settings, default 02:00)
--   lock_batch_rows    row locks on batches, in id order (lock order: stock locks, batch rows, batch lot)
--   batch_remaining    portions left, summed from the ledger (volatile: a fresh snapshot after the row lock)
--   batch_settle_state the one writer of batch.state, from the ledger, in the caller's transaction

-- The business date: the calendar date (venue time zone) of the cut-off that ends the instant's business day, minus
-- one day. 23:00 -> the same day; 01:30 -> the previous day; exactly at the cut-off -> the same day. It reuses M11's
-- DST-safe next_cutoff, so it does not depend on the session time zone.
create function app.business_date(p_tenant uuid, p_at timestamptz) returns date
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_tz text;
begin
  select t.timezone into v_tz from public.tenant t where t.id = p_tenant;
  if not found then
    raise exception 'tenant_not_found' using errcode = 'P0002';
  end if;
  return (app.next_cutoff(p_at, v_tz, app.business_day_cutoff(p_tenant)) at time zone v_tz)::date - 1;
end
$$;

-- Row locks on the tenant's batches among p_ids, in id order. A single unknown id is a P0002 (the caller asked for
-- one batch and it is not there); several ids may include unknown ones.
create function app.lock_batch_rows(p_tenant uuid, p_ids uuid[]) returns void
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_n integer;
begin
  perform 1
    from public.batch b
   where b.tenant_id = p_tenant and b.id = any (p_ids)
   order by b.id
     for update;
  get diagnostics v_n = row_count;
  if v_n = 0 and cardinality(p_ids) = 1 then
    raise exception 'batch_not_found' using errcode = 'P0002';
  end if;
end
$$;

-- Portions left in a batch: the sum of its ledger. VOLATILE on purpose, like next_lot_seq: called in a new statement
-- after the row lock, it sees what the previous lock holder committed (plan T2).
create function app.batch_remaining(p_tenant uuid, p_batch uuid) returns numeric
  language sql
  volatile
  security definer
  set search_path = ''
as $$
  select coalesce(sum(m.portions), 0)
    from public.batch_movement m
   where m.tenant_id = p_tenant and m.batch_id = p_batch
$$;

-- The state of a batch after a write, from the ledger (ADR-014): remaining <= 0 -> discarded when the cause is a
-- discard, else finished; remaining > 0 -> open. A batch that is already finished or discarded and still empty keeps
-- its state (a repeated settle must not relabel "Scartato" as "Finito"). The row is updated only when the state
-- changes. M19 calls this with the cause 'consume'. The caller holds the batch row lock.
create function app.batch_settle_state(p_tenant uuid, p_batch uuid, p_cause text) returns public.batch_state
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_old public.batch_state;
  v_new public.batch_state;
  v_remaining numeric;
begin
  if p_cause is null or p_cause not in ('discard', 'adjust', 'split', 'staff_meal', 'consume') then
    raise exception 'cause_invalid' using errcode = 'P0001';
  end if;
  select b.state into v_old from public.batch b where b.tenant_id = p_tenant and b.id = p_batch;
  if not found then
    raise exception 'batch_not_found' using errcode = 'P0002';
  end if;
  v_remaining := app.batch_remaining(p_tenant, p_batch);
  if v_remaining > 0 then
    v_new := 'open';
  elsif v_old in ('finished', 'discarded') then
    v_new := v_old;
  elsif p_cause = 'discard' then
    v_new := 'discarded';
  else
    v_new := 'finished';
  end if;
  if v_new <> v_old then
    update public.batch set state = v_new where tenant_id = p_tenant and id = p_batch;
  end if;
  return v_new;
end
$$;

revoke all on function app.business_date(uuid, timestamptz), app.lock_batch_rows(uuid, uuid[]),
  app.batch_remaining(uuid, uuid), app.batch_settle_state(uuid, uuid, text)
  from public, anon, authenticated, service_role;
