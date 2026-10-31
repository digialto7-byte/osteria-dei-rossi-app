-- M19b step 1 (docs/plans/2026-10-31-m19b-kitchen-done.md §3.2; ADR-024): public.kitchen_event, the append-only record of what the kitchen
-- did on a comanda.
--
--   * Line events (done / undone) reference one order_line. Ticket events (closed / reopened, cause tap or auto) carry the four columns of
--     the M19 ticket key (table_session_id, fired_at, course, segue). kitchen_event_shape_ck keeps the two kinds apart; only ticket events
--     may have cause 'auto'.
--   * Current state is derived: the latest event by seq wins. No state column exists anywhere. seq is an identity column, so an explicit
--     value is refused (428C9); every write of one comanda runs under one advisory lock (a later migration), so seq order is commit order.
--   * Rows are written only by public.kitchen_mark_line and public.kitchen_set_ticket (definers, later migrations): no API role holds a
--     write grant. Only the ADR-018 demo purge may delete (app.append_only honours app.demo_purge_allows).

create table public.kitchen_event (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  tenant_id uuid not null default app.tenant_id() references public.tenant (id),
  subject text not null,
  action text not null,
  cause text not null default 'tap',
  order_line_id uuid,
  table_session_id uuid,
  fired_at timestamptz,
  course public.course,
  segue boolean,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null default app.app_user_id(),
  constraint kitchen_event_shape_ck check (
    (subject = 'line' and action in ('done', 'undone') and cause = 'tap' and order_line_id is not null
       and num_nulls(table_session_id, fired_at, course, segue) = 4)
    or (subject = 'ticket' and action in ('closed', 'reopened') and cause in ('tap', 'auto') and order_line_id is null
       and num_nonnulls(table_session_id, fired_at, course, segue) = 4)),
  constraint kitchen_event_line_fkey foreign key (tenant_id, order_line_id) references public.order_line (tenant_id, id),
  constraint kitchen_event_session_fkey foreign key (tenant_id, table_session_id) references public.table_session (tenant_id, id),
  constraint kitchen_event_created_by_fkey foreign key (tenant_id, created_by) references public.app_user (tenant_id, id)
);

create index kitchen_event_line_idx on public.kitchen_event (tenant_id, order_line_id, seq desc) where subject = 'line';
create index kitchen_event_ticket_idx on public.kitchen_event (tenant_id, table_session_id, fired_at, course, segue, seq desc)
  where subject = 'ticket';

create trigger kitchen_event_append_only before update or delete on public.kitchen_event
  for each row execute function app.append_only();
create trigger kitchen_event_no_truncate before truncate on public.kitchen_event
  for each statement execute function app.append_only_truncate();

alter table public.kitchen_event enable row level security;
-- service_role reads (integration tests); nobody writes through a table grant. The chef and the waiter read the board, not the log.
revoke all on public.kitchen_event from anon, authenticated, service_role;
grant select on public.kitchen_event to authenticated, service_role;
create policy kitchen_event_select on public.kitchen_event for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));
