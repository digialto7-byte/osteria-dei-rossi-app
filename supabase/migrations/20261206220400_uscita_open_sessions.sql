-- Comanda per uscita, step 8, M5 (docs/plans/2026-11-18-comanda-uscite.md section 3.8; ADR-049): the open sessions, placed in place.
--   * app.uscite_backfill_open_sessions() (definer, empty search_path, closed to every API role) is called once below and kept for tests. It
--     is idempotent: it touches only lines whose uscita is null and inserts calls with on conflict do nothing.
--       1. lock table order_line and uscita_call in EXCLUSIVE mode: every write and every FOR UPDATE / FOR SHARE waits for the few
--          milliseconds of the backfill; plain reads go on (T3). The deploy still runs outside service (runbook).
--       2. the one UPDATE: the lines of OPEN sessions with a null uscita get segue -> 2, bevande -> 0, else 1 (the M1 guard admits null ->
--          value on sent and voided lines, nothing else changes; segue is unchanged, so the mirror holds). Closed sessions are excluded by
--          the predicate and keep null for ever.
--       3. one 'migration' call per open session where this run placed a SENT line in the 2nd (voided or not): called_at = the earliest
--          fired_at of those lines, called_by = its fired_by. Every such line then has fired_at >= called_at: today's ticket, not "in attesa".
--       4. a self-check raising P0001 uscite_backfill_failed (the whole migration rolls back): an open-session line still null; a sent
--          open-session line held; or fewer or more call rows than sessions found in 3.
--       5. returns {lines, calls} (counts only).
--   * Then the NOT VALID check order_line_uscita_set_ck (uscita is not null): never validated, so closed sessions keep null (T2).
--   * Lead ruling M5 (option a, 2026-11-18): order_line.uscita gets default 1 and a column comment. SET DEFAULT writes no row and sets no
--     missing value, so every row that exists now keeps its value or its null (pgTAP 423 reads pg_attribute). It is the one sanctioned Rule B
--     exception for this column: every app writer names uscita (pgTAP 423 scans them), INSERT on order_line is granted to no API role, and
--     tests/guards/order-line-writers.test.ts finds no client insert. Only table-owner fixtures and tools that predate the column rely on it.

create function app.uscite_backfill_open_sessions() returns jsonb
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_lines integer;
  v_sessions integer;
  v_calls integer;
begin
  lock table public.order_line, public.uscita_call in exclusive mode;

  -- One statement: the UPDATE, then the calls from the rows it placed (a data-modifying CTE sees the RETURNING rows, not the table).
  with placed as (
    update public.order_line l set uscita = case when l.segue then 2 when l.course = 'bevande' then 0 else 1 end
      from public.table_session s
     where s.tenant_id = l.tenant_id and s.id = l.table_session_id and s.closed_at is null and l.uscita is null
    returning l.tenant_id, l.table_session_id, l.uscita, l.fired_at, l.fired_by, l.id
  ), called as (
    insert into public.uscita_call (tenant_id, table_session_id, uscita, called_at, called_by, cause)
      select distinct on (p.tenant_id, p.table_session_id) p.tenant_id, p.table_session_id, 2, p.fired_at, p.fired_by, 'migration'
        from placed p
       where p.uscita = 2 and p.fired_at is not null
       order by p.tenant_id, p.table_session_id, p.fired_at, p.id
      on conflict on constraint uscita_call_once_uq do nothing
    returning 1
  )
  select (select count(*) from placed)::integer,
         (select count(distinct (p.tenant_id, p.table_session_id)) from placed p where p.uscita = 2 and p.fired_at is not null)::integer,
         (select count(*) from called)::integer
    into v_lines, v_sessions, v_calls;

  if exists (select 1 from public.order_line l join public.table_session s on s.tenant_id = l.tenant_id and s.id = l.table_session_id
              where s.closed_at is null and l.uscita is null)
     or exists (select 1 from public.order_line l join public.table_session s on s.tenant_id = l.tenant_id and s.id = l.table_session_id
                 where s.closed_at is null and app.line_held(l.tenant_id, l))
     or v_calls <> v_sessions then
    raise exception 'uscite_backfill_failed' using errcode = 'P0001';
  end if;

  return jsonb_build_object('lines', v_lines, 'calls', v_calls);
end
$$;
revoke all on function app.uscite_backfill_open_sessions() from public, anon, authenticated, service_role;

select app.uscite_backfill_open_sessions();

alter table public.order_line add constraint order_line_uscita_set_ck check (uscita is not null) not valid;

alter table public.order_line alter column uscita set default 1;
comment on column public.order_line.uscita is
  'Comanda per uscita: 0 = at once (Subito), 1..9 = the uscita. null = a line from before uscite (closed sessions only; the NOT VALID check order_line_uscita_set_ck refuses null for every later write). The default 1 is the one sanctioned Rule B exception (lead ruling M5, 2026-11-18): it exists only for table-owner fixtures and tools that predate the column; every app writer names uscita.';
