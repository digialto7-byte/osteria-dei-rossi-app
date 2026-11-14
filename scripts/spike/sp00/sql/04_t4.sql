select sp0.guard();

-- SP0 scratch 04 (§3.3, §3.7): T4, the RLS cost at SQL level with one tenant and with many.
--  * sp0.t4_tables(): the tables a fill copies: every public table with a tenant_id column except the tenant, its users, devices and the auth
--    and idempotency tables, parents before children;
--  * sp0.t4_fill(source, count, max_mb): "Spike Demo NNN" tenants (VAT IT99 + 9 digits) holding a copy of the source's rows with new ids, foreign
--    keys to cloned tables remapped, tenant_id the clone's, every date and timestamp 28 years back (1998: same weekdays). A table whose insert is
--    refused (a trigger, a constraint) is SKIPPED AND LISTED with the SQLSTATE; the fill stops before the database passes max_mb;
--    The clone also gets its own copy of the source's app_user rows (new ids, fresh fake auth.users rows) and every reference to a tenant-owned
--    table is remapped through the clone's map: nothing in a clone points at the source tenant;
--  * sp0.t4_claims(tenant): the claims of that tenant's owner, built here, no token;
--  * sp0.t4_measure(tenant, fn, runs): times public.<fn>() as that owner (set local role authenticated, jwt claims), 5 warm-ups and `runs` calls,
--    then one EXPLAIN (ANALYZE, BUFFERS);
--  * sp0.t4_snapshot / t4_isolation: the measured tenant's payloads before and after fills; the later ones must equal the first in item counts and
--    hold no "Spike Demo" name and no clone tenant id.
-- Nothing is timed outside the database: no network, PostgREST or Next.js.

create table sp0.t4_snapshot_log (
  id bigserial primary key,
  tenant uuid not null,
  label text not null,
  fn text not null,
  items int not null,
  payload jsonb not null,
  taken_at timestamptz not null default now()
);

-- Number of JSON objects inside a payload at any depth: the "item count" two snapshots must share.
create function sp0.t4_items(p_payload jsonb) returns int
  language sql immutable
  set search_path = ''
as $$
  select count(*)::int from jsonb_path_query(p_payload, 'strict $.**') v where jsonb_typeof(v) = 'object'
$$;

create function sp0.t4_tables() returns table (ord int, tbl text)
  language plpgsql stable
  set search_path = ''
as $$
declare
  c_excluded constant text[] := array['tenant', 'app_user', 'venue_device', 'device_enrolment', 'auth_attempt', 'staff_session', 'audit_event', 'applied_op'];
  v_set text[];
  v_ordered text[] := '{}';
  v_left text[];
  v_progress boolean;
  t text;
begin
  select coalesce(array_agg(c.relname::text order by c.relname), '{}') into v_set
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped and a.attgenerated = ''
   where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> all (c_excluded) and c.relname not like 'sp0\_%';
  v_left := v_set;
  while coalesce(array_length(v_left, 1), 0) > 0 loop
    v_progress := false;
    foreach t in array v_left loop
      -- ready when every foreign-key parent inside the set (itself aside) is already placed
      if not exists (
        select 1 from pg_constraint k join pg_class p on p.oid = k.confrelid
         where k.contype = 'f' and k.conrelid = ('public.' || quote_ident(t))::regclass
           and p.relnamespace = 'public'::regnamespace and p.relname = any (v_set) and p.relname <> t and p.relname <> all (v_ordered)
      ) then
        v_ordered := v_ordered || t;
        v_left := array_remove(v_left, t);
        v_progress := true;
      end if;
    end loop;
    if not v_progress then -- a foreign-key cycle: the rest in name order (the fill lists what it cannot copy)
      v_ordered := v_ordered || v_left;
      v_left := '{}';
    end if;
  end loop;
  return query select o.i::int, o.t from unnest(v_ordered) with ordinality as o(t, i);
end
$$;

create function sp0.t4_fill(p_source uuid, p_count int, p_max_mb int)
  returns table (clone_id uuid, clone_name text, rows_copied bigint, skipped text)
  language plpgsql
  set search_path = ''
as $$
declare
  c_years constant text := '28 years';
  v_tables text[];
  v_new uuid;
  v_n int;
  v_tbl text;
  v_rel regclass;
  v_col record;
  v_ref text;
  v_cols text;
  v_exprs text;
  v_expr text;
  v_rows bigint;
  v_total bigint;
  v_skipped text;
  v_has_id boolean;
  v_is_set boolean;
  v_scoped boolean;
begin
  perform sp0.guard();
  if p_count < 1 or p_count > 100 then raise exception 'sp0.t4_fill: count must be between 1 and 100'; end if;
  if p_max_mb < 0 then raise exception 'sp0.t4_fill: max_mb must not be negative'; end if;
  if not exists (select 1 from public.tenant where id = p_source) then raise exception 'sp0.t4_fill: unknown source tenant'; end if;

  select array_agg(t.tbl order by t.ord) into v_tables from sp0.t4_tables() t;
  create temp table if not exists t4_map (tbl text not null, old_id uuid not null, new_id uuid not null, primary key (tbl, old_id)) on commit drop;

  for i in 1..p_count loop
    if pg_database_size(current_database()) >= p_max_mb::bigint * 1048576 then
      return query select null::uuid, '(stopped: database size limit reached)'::text, 0::bigint, null::text;
      return;
    end if;

    select coalesce(max(substring(t.name from '[0-9]+$')::int), 0) + 1 into v_n from public.tenant t where t.name like 'Spike Demo %';
    v_new := gen_random_uuid();
    insert into public.tenant (id, name, vat_number, timezone, currency, settings)
      select v_new, format('Spike Demo %s', lpad(v_n::text, 3, '0')), format('IT99%s', lpad(v_n::text, 9, '0')), s.timezone, s.currency, s.settings
        from public.tenant s where s.id = p_source;
    truncate pg_temp.t4_map;
    v_total := 0;

    -- The clone's own users: every reference to app_user is remapped to these, never left on the source's users. A clone needs no login, so each
    -- user gets a fresh fake auth.users row (an example.test address, no password) and its own auth_id.
    insert into pg_temp.t4_map select 'app_user', u.id, gen_random_uuid() from public.app_user u where u.tenant_id = p_source;
    insert into auth.users (id, email)
      select gen_random_uuid(), 'sp0-clone-' || m.new_id::text || '@example.test'
        from pg_temp.t4_map m where m.tbl = 'app_user';
    insert into public.app_user (id, tenant_id, auth_id, role, display_name, is_active, deactivated_at, created_at, created_by, login_method)
      select m.new_id, v_new,
             (select a.id from auth.users a where a.email = 'sp0-clone-' || m.new_id::text || '@example.test'),
             u.role, u.display_name, u.is_active, (u.deactivated_at - interval '28 years'), (u.created_at - interval '28 years'),
             (select c.new_id from pg_temp.t4_map c where c.tbl = 'app_user' and c.old_id = u.created_by), u.login_method
        from public.app_user u join pg_temp.t4_map m on m.tbl = 'app_user' and m.old_id = u.id
       where u.tenant_id = p_source;
    v_skipped := null;

    foreach v_tbl in array v_tables loop
      v_rel := ('public.' || quote_ident(v_tbl))::regclass;
      begin
        v_has_id := exists (select 1 from pg_attribute a where a.attrelid = v_rel and a.attname = 'id' and a.atttypid = 'uuid'::regtype and not a.attisdropped);
        if v_has_id then
          execute format('insert into pg_temp.t4_map select %L, id, gen_random_uuid() from public.%I where tenant_id = $1', v_tbl, v_tbl) using p_source;
        end if;

        v_cols := null;
        v_exprs := null;
        for v_col in
          select a.attname::text as name, a.attnum, a.atttypid, format_type(a.atttypid, a.atttypmod) as typ
            from pg_attribute a
           where a.attrelid = v_rel and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity = ''
           order by a.attnum
        loop
          -- the foreign key (if any) of this column to the id of another table
          select p.relname::text, exists (select 1 from pg_attribute x where x.attrelid = k.confrelid and x.attname = 'tenant_id' and not x.attisdropped)
            into v_ref, v_scoped
            from pg_constraint k
            join pg_class p on p.oid = k.confrelid
            cross join lateral generate_subscripts(k.conkey, 1) g
           where k.contype = 'f' and k.conrelid = v_rel and k.conkey[g] = v_col.attnum
             and (select pa.attname from pg_attribute pa where pa.attrelid = k.confrelid and pa.attnum = k.confkey[g]) = 'id'
           limit 1;
          -- a foreign key to ANY tenant-owned table (the cloned ones, the users, and the ones the fill leaves out) is mapped strictly: never left pointing at the source
          v_is_set := v_ref is not null and v_scoped and v_ref <> 'tenant';

          if v_col.name = 'tenant_id' then
            v_expr := format('%L::uuid', v_new);
          elsif v_col.name = 'id' and v_col.atttypid = 'uuid'::regtype and v_has_id then
            v_expr := format('(select m.new_id from pg_temp.t4_map m where m.tbl = %L and m.old_id = s.id)', v_tbl);
          elsif v_ref = 'tenant' then
            v_expr := format('%L::uuid', v_new);
          elsif v_is_set then -- strict: a missing parent (skipped or left-out table) gives null, so a not-null column refuses the row and the table is listed
            v_expr := format('(select m.new_id from pg_temp.t4_map m where m.tbl = %L and m.old_id = s.%I)', v_ref, v_col.name);
          elsif v_col.atttypid in ('date'::regtype, 'timestamp'::regtype, 'timestamptz'::regtype) then
            v_expr := format('(s.%I - interval %L)::%s', v_col.name, c_years, v_col.typ);
          else
            v_expr := format('s.%I', v_col.name); -- shared references (users, devices) and plain values stay as they are
          end if;
          v_cols := concat_ws(', ', v_cols, quote_ident(v_col.name));
          v_exprs := concat_ws(', ', v_exprs, v_expr);
        end loop;

        execute format('insert into public.%I (%s) select %s from public.%I s where s.tenant_id = $1', v_tbl, v_cols, v_exprs, v_tbl) using p_source;
        get diagnostics v_rows = row_count;
        v_total := v_total + v_rows;
      exception when others then
        -- Reported, not hidden: the table and the SQLSTATE go into `skipped`. The block's inserts (and its map rows) are rolled back.
        v_skipped := concat_ws('; ', v_skipped, format('%s (%s)', v_tbl, sqlstate));
      end;
    end loop;

    return query select v_new, format('Spike Demo %s', lpad(v_n::text, 3, '0')), v_total, v_skipped;
  end loop;
end
$$;

create function sp0.t4_claims(p_tenant uuid) returns jsonb
  language plpgsql stable
  set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select u.auth_id into v_owner
    from public.app_user u
   where u.tenant_id = p_tenant and u.role = 'owner' and u.is_active
   order by u.created_at, u.id
   limit 1;
  if v_owner is null then raise exception 'sp0.t4_claims: the tenant has no active owner'; end if;
  return jsonb_build_object('sub', v_owner, 'role', 'authenticated', 'tenant_id', p_tenant, 'app_role', 'owner',
                            'aal', 'aal1', 'session_id', gen_random_uuid());
end
$$;

create function sp0.t4_measure(p_tenant uuid, p_fn text, p_runs int default 100)
  returns table (fn text, n int, p50_ms numeric, p95_ms numeric, max_ms numeric, explain_exec_ms numeric,
                 shared_hit bigint, shared_read bigint, items int)
  language plpgsql
  set search_path = ''
as $$
declare
  c_warmups constant int := 5;
  v_times numeric[] := '{}';
  v_t0 timestamptz;
  v_payload jsonb;
  v_plan json;
  v_claims jsonb;
  v_prev_claims text := current_setting('request.jwt.claims', true);
  v_prev_role text := current_user;
begin
  perform sp0.guard();
  if p_fn is null or p_fn <> all (array['mfa_gate', 'dashboard_summary', 'menu_list', 'kitchen_tickets']) then
    raise exception 'sp0.t4_measure: unknown function';
  end if;
  if p_runs is null or p_runs < 1 or p_runs > 1000 then raise exception 'sp0.t4_measure: runs must be between 1 and 1000'; end if;
  v_claims := sp0.t4_claims(p_tenant);

  perform set_config('request.jwt.claims', v_claims::text, true);
  set local role authenticated;
  for i in 1..c_warmups loop
    execute format('select to_jsonb(public.%I())', p_fn) into v_payload;
  end loop;
  for i in 1..p_runs loop
    v_t0 := clock_timestamp();
    execute format('select to_jsonb(public.%I())', p_fn) into v_payload;
    v_times := v_times || (extract(epoch from clock_timestamp() - v_t0) * 1000)::numeric;
  end loop;
  execute format('explain (analyze, buffers, format json) select public.%I()', p_fn) into v_plan;
  -- Back to what the caller had: its role and its claims (an unset setting comes back as the empty text, the closest to unset).
  if v_prev_role = session_user then reset role; else execute format('set local role %I', v_prev_role); end if;
  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);

  return query
    select p_fn, p_runs,
           round((select percentile_disc(0.5) within group (order by d) from unnest(v_times) d), 3),
           round((select percentile_disc(0.95) within group (order by d) from unnest(v_times) d), 3),
           round((select max(d) from unnest(v_times) d), 3),
           ((v_plan::jsonb) -> 0 ->> 'Execution Time')::numeric,
           coalesce(((v_plan::jsonb) -> 0 -> 'Plan' ->> 'Shared Hit Blocks')::bigint, 0),
           coalesce(((v_plan::jsonb) -> 0 -> 'Plan' ->> 'Shared Read Blocks')::bigint, 0),
           sp0.t4_items(v_payload);
end
$$;

create function sp0.t4_snapshot(p_tenant uuid, p_label text) returns table (fn text, items int, payload_md5 text)
  language plpgsql
  set search_path = ''
as $$
declare
  v_fns constant text[] := array['dashboard_summary', 'menu_list', 'kitchen_tickets'];
  v_payloads jsonb[] := '{}';
  v_payload jsonb;
  v_fn text;
  v_claims jsonb;
  v_prev_claims text := current_setting('request.jwt.claims', true);
  v_prev_role text := current_user;
begin
  perform sp0.guard();
  if p_label is null or p_label = '' then raise exception 'sp0.t4_snapshot: a label is required'; end if;
  v_claims := sp0.t4_claims(p_tenant);
  perform set_config('request.jwt.claims', v_claims::text, true);
  set local role authenticated;
  foreach v_fn in array v_fns loop
    execute format('select to_jsonb(public.%I())', v_fn) into v_payload;
    v_payloads := v_payloads || coalesce(v_payload, 'null'::jsonb);
  end loop;
  if v_prev_role = session_user then reset role; else execute format('set local role %I', v_prev_role); end if;
  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);

  for i in 1..array_length(v_fns, 1) loop
    insert into sp0.t4_snapshot_log (tenant, label, fn, items, payload)
      values (p_tenant, p_label, v_fns[i], sp0.t4_items(v_payloads[i]), v_payloads[i]);
  end loop;
  return query select l.fn, l.items, md5(l.payload::text) from sp0.t4_snapshot_log l where l.tenant = p_tenant and l.label = p_label order by l.id;
end
$$;

create function sp0.t4_isolation(p_tenant uuid) returns table (pass boolean, snapshots bigint, detail text)
  language plpgsql stable
  set search_path = ''
as $$
declare
  v_problems text[] := '{}';
  v_count bigint;
  v_uuids text[];
  v_tbl text;
  v_hits bigint;
begin
  perform sp0.guard();
  select count(*) into v_count from sp0.t4_snapshot_log l where l.tenant = p_tenant;
  if v_count = 0 then
    return query select false, 0::bigint, 'no snapshot: nothing was compared'::text;
    return;
  end if;
  -- the first snapshot of each function is the reference: every later one has the same item count
  v_problems := v_problems || coalesce((
    select array_agg(format('%s items differ in %s: %s vs %s', l.fn, l.label, l.items, f.items))
      from sp0.t4_snapshot_log l
      join (select distinct on (s.fn) s.fn, s.items from sp0.t4_snapshot_log s where s.tenant = p_tenant order by s.fn, s.id) f on f.fn = l.fn
     where l.tenant = p_tenant and l.items <> f.items), '{}');
  -- no payload holds a clone's name or id
  v_problems := v_problems || coalesce((
    select array_agg(format('%s payload in %s holds a Spike Demo name or a clone id', l.fn, l.label))
      from sp0.t4_snapshot_log l
     where l.tenant = p_tenant
       and (l.payload::text like '%Spike Demo%'
            or exists (select 1 from public.tenant t where t.name like 'Spike Demo %' and l.payload::text like '%' || t.id::text || '%'))), '{}');
  -- no payload holds the id of a cloned row (the clones' users included): every uuid in the payloads, looked up in each tenant-owned table
  select array_agg(distinct m[1]) into v_uuids
    from sp0.t4_snapshot_log l, regexp_matches(l.payload::text, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'g') m
   where l.tenant = p_tenant;
  if v_uuids is not null then
    for v_tbl in select tbl from sp0.t4_tables() union select 'app_user' loop
      if exists (select 1 from pg_attribute a where a.attrelid = ('public.' || quote_ident(v_tbl))::regclass and a.attname = 'id' and a.atttypid = 'uuid'::regtype and not a.attisdropped) then
        execute format('select count(*) from public.%I c join public.tenant t on t.id = c.tenant_id where t.name like %L and c.id::text = any ($1)', v_tbl, 'Spike Demo %')
          into v_hits using v_uuids;
        if v_hits > 0 then v_problems := v_problems || format('%s payload ids belong to cloned %s rows', v_hits, v_tbl); end if;
      end if;
    end loop;
  end if;
  return query select cardinality(v_problems) = 0, v_count,
    case when cardinality(v_problems) = 0 then 'same item counts, no clone name, tenant id or row id'
         else array_to_string(v_problems, '; ') end;
end
$$;

revoke all on function sp0.t4_items(jsonb), sp0.t4_tables(), sp0.t4_fill(uuid, int, int), sp0.t4_claims(uuid),
  sp0.t4_measure(uuid, text, int), sp0.t4_snapshot(uuid, text), sp0.t4_isolation(uuid) from public, anon, authenticated, service_role;
