-- P2-2 S1 (docs/plans/2026-11-14-p2-2-trace-sell-through.md section 3.2): the core of the trace reads. Read-only: no table, column or trigger is created or changed, and no
-- existing function is replaced (D-P1). What this adds:
--   app.require_trace_reader   owner, admin, chef; 42501 otherwise (a waiter, a signed-out session, an owner or admin the P2-1 gate holds at aal1: app.role() is null).
--   app.lot_code_norm          the supplier lot code as it is searched: upper case, every whitespace character removed. Immutable, so an index can use it (Q-P13: prefix match).
--   app.trace_constants        the six caps of D-P12 in one place (TS twins in src/server/trace/constants.ts, read against this file by a parity test).
--   app.batch_family           the split family of some root batches: the roots (depth 0) and every split child below them, created before p_until (null: no limit).
--                              Depth is guarded at TRACE_SPLIT_DEPTH (D-P5): a chain deeper than that, or a cycle, raises P0001 trace_depth_exceeded.
--   app.batch_root             the root of a batch (itself when it is no split child); null when the batch is not in the tenant.
--   four indexes               lot code prefix search, lots by receipt date, lots by supplier, and the family walk by parent. Plain `create index`, as 20261108100200
--                              (one venue; rerun as `create index concurrently` by hand on a large tenant).
-- The helpers are definers with an empty search_path, executable by nobody outside the owner; the public functions of the later steps call them.

create function app.require_trace_reader() returns void
  language plpgsql
  stable
  set search_path = ''
as $$
begin
  if app.role() is null or app.role() not in ('owner', 'admin', 'chef') then
    raise exception 'permission denied: the trace needs owner, admin or chef' using errcode = '42501';
  end if;
end
$$;

create function app.lot_code_norm(p_code text) returns text
  language sql
  immutable
  strict
  set search_path = ''
as $$
  select upper(regexp_replace(p_code, '\s', '', 'g'))
$$;

create function app.trace_constants() returns jsonb
  language sql
  immutable
  set search_path = ''
as $$
  select jsonb_build_object(
    'TRACE_MAX_LOTS', 50,
    'TRACE_MAX_BATCHES', 200,
    'TRACE_MAX_PLATE_GROUPS', 400,
    'TRACE_MAX_LINES', 200,
    'TRACE_MAX_RANGE_DAYS', 366,
    'TRACE_SPLIT_DEPTH', 50)
$$;

create function app.batch_family(p_tenant uuid, p_roots uuid[], p_until timestamptz)
  returns table (batch_id uuid, root_id uuid, depth integer)
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_max integer := (app.trace_constants() ->> 'TRACE_SPLIT_DEPTH')::integer;
  r record;
begin
  -- The recursion expands rows up to depth v_max only, so a row at depth v_max + 1 is the proof of a too deep chain (or of a cycle).
  for r in
    with recursive fam (fam_id, fam_root, fam_depth) as (
      select b.id, b.id, 0
        from public.batch b
       where b.tenant_id = p_tenant and b.id = any (p_roots)
      union all
      select c.id, f.fam_root, f.fam_depth + 1
        from fam f
        join public.batch c on c.tenant_id = p_tenant and c.split_from_batch_id = f.fam_id
       where f.fam_depth <= v_max and (p_until is null or c.created_at < p_until)
    )
    select fam.fam_id, fam.fam_root, fam.fam_depth from fam
  loop
    if r.fam_depth > v_max then
      raise exception 'trace_depth_exceeded' using errcode = 'P0001';
    end if;
    batch_id := r.fam_id;
    root_id := r.fam_root;
    depth := r.fam_depth;
    return next;
  end loop;
end
$$;

create function app.batch_root(p_tenant uuid, p_batch uuid) returns uuid
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_max integer := (app.trace_constants() ->> 'TRACE_SPLIT_DEPTH')::integer;
  v_cur uuid := p_batch;
  v_parent uuid;
  v_steps integer := 0;
begin
  loop
    select b.split_from_batch_id into v_parent from public.batch b where b.tenant_id = p_tenant and b.id = v_cur;
    if not found then
      return null;
    end if;
    if v_parent is null then
      return v_cur;
    end if;
    v_steps := v_steps + 1;
    if v_steps > v_max then
      raise exception 'trace_depth_exceeded' using errcode = 'P0001';
    end if;
    v_cur := v_parent;
  end loop;
end
$$;

revoke all on function app.require_trace_reader(), app.lot_code_norm(text), app.trace_constants(), app.batch_family(uuid, uuid[], timestamptz), app.batch_root(uuid, uuid)
  from public, anon, authenticated, service_role;

create index raw_lot_lot_code_norm_idx on public.raw_lot (tenant_id, app.lot_code_norm(lot_code) text_pattern_ops) where lot_code is not null;
create index raw_lot_received_idx on public.raw_lot (tenant_id, received_on desc, id);
create index raw_lot_supplier_idx on public.raw_lot (tenant_id, supplier_id, received_on desc);
create index batch_split_from_idx on public.batch (tenant_id, split_from_batch_id) where split_from_batch_id is not null;
