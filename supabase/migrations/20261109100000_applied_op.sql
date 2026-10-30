-- M20 step 1 (docs/plans/2026-10-29-m20-offline.md §3.2; ADR-022): public.applied_op, the record of every offline operation the server
-- decided, and app.sync_op_kinds(), the list of operation kinds.
--
--   applied_op  one row per decided op, keyed (tenant_id, op_id) so one tenant cannot probe another's ids. Written only by
--               public.apply_op (a definer, migration 20261109100100), in the same transaction as the procedure it dispatched.
--               Append-only (app.append_only honours the demo purge, ADR-018). RLS on with no policy: no API role reads it.
--               service_role may select (integration tests read it); nothing else is granted.
--   `result`    holds the procedure reply exactly as the waiter received it (sale prices, staff names; never a cost), or for a
--               refusal {sqlstate, message, detail}.
create function app.sync_op_kinds() returns text[]
  language sql immutable
  set search_path = ''
as $$ select array['open_table', 'add_line', 'edit_line', 'remove_line', 'fire', 'void_line']::text[] $$;
revoke all on function app.sync_op_kinds() from public, anon, authenticated, service_role;

create table public.applied_op (
  tenant_id uuid not null default app.tenant_id(),
  op_id uuid not null,
  user_id uuid not null,
  kind text not null,
  seq bigint not null check (seq >= 1),
  -- The phone's instant (the line stamp for line writes) and the server's receipt time, so any last-write-wins decision can be audited.
  client_ts timestamptz not null,
  received_at timestamptz not null,
  outcome text not null check (outcome in ('applied', 'conflict', 'rejected')),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  constraint applied_op_pkey primary key (tenant_id, op_id),
  constraint applied_op_kind_ck check (kind = any (app.sync_op_kinds())),
  constraint applied_op_created_by_ck check (created_by = user_id),
  constraint applied_op_tenant_fkey foreign key (tenant_id) references public.tenant (id),
  constraint applied_op_user_fkey foreign key (tenant_id, user_id) references public.app_user (tenant_id, id)
);

create trigger applied_op_append_only before update or delete on public.applied_op
  for each row execute function app.append_only();
create trigger applied_op_no_truncate before truncate on public.applied_op
  for each statement execute function app.append_only_truncate();

alter table public.applied_op enable row level security;
revoke all on public.applied_op from public, anon, authenticated, service_role;
grant select on public.applied_op to service_role;
