-- SP0 self-check, section D: the T4 fill and measurement (04). Run it AFTER the seed (sp00-t4-seed.ts) has made "Osteria Demo SP0" and BEFORE the
-- first real fill: it clones into the measured tenant's rows twice and rolls everything back inside the DO block. A broken expectation raises.
-- It also reports whether this database user may SET ROLE authenticated (SV9 applies if not), and which tables the fill skipped.
select sp0.guard();

do $selfcheck$
declare
  v_checks int := 0;
  v_src uuid;
  v_can_set boolean := pg_has_role(current_user, 'authenticated', 'set');
  v_user text := current_user;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_tbl text;
  v_rows bigint;
  v_cols text;
  v_fill record;
  v_clones uuid[];
  v_skipped text;
  v_bad bigint;
  v_cross bigint;
  v_note text;
  v_before_tenants bigint;
  v_m record;
  v_iso record;
  v_fn text;
  v_clone uuid;
  v_core constant text[] := array['menu_item', 'dining_table', 'table_session', 'order_line', 'kitchen_event'];
  v_src_n bigint;
  v_clone_n bigint;
  v_counts text := '';
  v_claims0 text;
begin
  select t.id into v_src from public.tenant t where t.name = 'Osteria Demo SP0';
  if v_src is null then
    raise exception 'D0: the measured tenant "Osteria Demo SP0" is not there: run sp00-t4-seed.ts first';
  end if;

  -- D1: the table list leaves out the tenant and its users, and puts every parent before its children.
  if exists (select 1 from sp0.t4_tables() where tbl in ('tenant', 'app_user')) then raise exception 'D1: t4_tables lists tenant or app_user'; end if;
  if not exists (select 1 from sp0.t4_tables()) then raise exception 'D1: t4_tables is empty'; end if;
  select count(*) into v_bad
    from pg_constraint k
    join sp0.t4_tables() child on ('public.' || quote_ident(child.tbl))::regclass = k.conrelid
    join sp0.t4_tables() parent on ('public.' || quote_ident(parent.tbl))::regclass = k.confrelid
   where k.contype = 'f' and child.tbl <> parent.tbl and parent.ord > child.ord;
  if v_bad > 0 then raise exception 'D1: % foreign keys point at a table that comes later in the order', v_bad; end if;
  v_checks := v_checks + 1;

  -- D1b: the measured tenant has rows in every core table, or the seed did not do its job.
  foreach v_tbl in array v_core loop
    execute format('select count(*) from public.%I where tenant_id = $1', v_tbl) into v_src_n using v_src;
    if v_src_n = 0 then raise exception 'D1b: the measured tenant has no % rows: the seed must create them', v_tbl; end if;
  end loop;

  -- Row counts of the measured tenant, per table, before anything.
  for v_tbl in select tbl from sp0.t4_tables() order by ord loop
    execute format('select count(*) from public.%I where tenant_id = $1', v_tbl) into v_rows using v_src;
    v_before := v_before || jsonb_build_object(v_tbl, v_rows);
  end loop;
  select count(*) into v_before_tenants from public.tenant;

  begin
    -- D2: a fill of two clones.
    v_clones := '{}';
    v_skipped := null;
    for v_fill in select * from sp0.t4_fill(v_src, 2, 1000000) loop
      if v_fill.clone_id is not null then v_clones := v_clones || v_fill.clone_id; end if;
      v_skipped := nullif(concat_ws('; ', v_skipped, v_fill.skipped), '');
    end loop;
    if coalesce(array_length(v_clones, 1), 0) <> 2 then raise exception 'D2: t4_fill(…, 2, …) made % clones', coalesce(array_length(v_clones, 1), 0); end if;
    if (select count(*) from public.tenant where id = any (v_clones) and name ~ '^Spike Demo [0-9]{3}$' and vat_number ~ '^IT99[0-9]{9}$') <> 2 then
      raise exception 'D2: the clones are not named "Spike Demo NNN" with an IT99 VAT'; end if;
    if (select count(*) from public.tenant) <> v_before_tenants + 2 then raise exception 'D2: the tenant count did not grow by two'; end if;
    -- D2c: a clone's fake auth users have no NULL in the text columns GoTrue scans (a NULL there makes its admin listUsers fail), and aud/role are set.
    for v_tbl in
      select c.column_name from information_schema.columns c
       where c.table_schema = 'auth' and c.table_name = 'users'
         and c.column_name in ('confirmation_token', 'recovery_token', 'email_change', 'email_change_token_new', 'email_change_token_current',
                               'phone_change', 'phone_change_token', 'reauthentication_token', 'aud', 'role')
    loop
      execute format('select count(*) from auth.users u join public.app_user a on a.auth_id = u.id where a.tenant_id = any ($1) and u.%I is null', v_tbl)
        into v_bad using v_clones;
      if v_bad > 0 then raise exception 'D2c: % cloned auth users have a NULL %', v_bad, v_tbl; end if;
    end loop;
    v_checks := v_checks + 1;

    -- D3: the source is unchanged; every copied row carries its clone's tenant_id and no date after 2000-01-01; no row points across tenants.
    for v_tbl in select tbl from sp0.t4_tables() order by ord loop
      execute format('select count(*) from public.%I where tenant_id = $1', v_tbl) into v_rows using v_src;
      v_after := v_after || jsonb_build_object(v_tbl, v_rows);
    end loop;
    if v_after is distinct from v_before then raise exception 'D3: the source tenant''s row counts changed'; end if;

    for v_tbl in select tbl from sp0.t4_tables() order by ord loop
      -- no date or timestamp after 2000-01-01 in a clone's rows
      select string_agg(format('c.%I > date ''2000-01-01''', a.attname), ' or ') into v_cols
        from pg_attribute a
       where a.attrelid = ('public.' || quote_ident(v_tbl))::regclass and a.attnum > 0 and not a.attisdropped
         and a.atttypid in ('date'::regtype, 'timestamp'::regtype, 'timestamptz'::regtype);
      if v_cols is not null then
        execute format('select count(*) from public.%I c where c.tenant_id = any ($1) and (%s)', v_tbl, v_cols) into v_bad using v_clones;
        if v_bad > 0 then raise exception 'D3: % copied rows of % have a date after 2000-01-01', v_bad, v_tbl; end if;
      end if;
    end loop;

    -- No foreign key of a copied row, to ANY table with a tenant_id (users and tables outside the fill included), points at a row of another tenant.
    v_cross := 0;
    for v_fill in
      select k.conrelid::regclass::text as child, k.confrelid::regclass::text as parent,
             (select string_agg(format('c.%I = p.%I', ca.attname, pa.attname), ' and ' order by u.ord)
                from unnest(k.conkey, k.confkey) with ordinality as u(ck, fk, ord)
                join pg_attribute ca on ca.attrelid = k.conrelid and ca.attnum = u.ck
                join pg_attribute pa on pa.attrelid = k.confrelid and pa.attnum = u.fk) as cond
        from pg_constraint k
        join sp0.t4_tables() ct on ('public.' || quote_ident(ct.tbl))::regclass = k.conrelid
       where k.contype = 'f'
         and exists (select 1 from pg_attribute x where x.attrelid = k.confrelid and x.attname = 'tenant_id' and not x.attisdropped)
    loop
      execute format('select count(*) from %s c join %s p on %s where c.tenant_id = any ($1) and p.tenant_id is distinct from c.tenant_id',
                     v_fill.child, v_fill.parent, v_fill.cond) into v_bad using v_clones;
      v_cross := v_cross + v_bad;
    end loop;
    if v_cross > 0 then raise exception 'D3: % copied rows point at a row of another tenant', v_cross; end if;

    -- D3b: no core table was skipped, and every clone holds exactly the source's (non-zero) row count of each.
    foreach v_tbl in array v_core loop
      if coalesce(v_skipped, '') ~ ('(^|; )' || v_tbl || ' \(') then raise exception 'D3b: the fill skipped the core table % (%)', v_tbl, v_skipped; end if;
      execute format('select count(*) from public.%I where tenant_id = $1', v_tbl) into v_src_n using v_src;
      foreach v_clone in array v_clones loop
        execute format('select count(*) from public.%I where tenant_id = $1', v_tbl) into v_clone_n using v_clone;
        if v_clone_n = 0 or v_clone_n <> v_src_n then raise exception 'D3b: a clone holds % % rows, the source holds %', v_clone_n, v_tbl, v_src_n; end if;
      end loop;
      v_counts := concat_ws(', ', nullif(v_counts, ''), format('%s=%s', v_tbl, v_src_n));
    end loop;
    v_checks := v_checks + 1;
    v_note := concat_ws('; ', v_note, format('rows per clone and core table: %s; cross-tenant foreign keys: %s; tables skipped by the fill: %s', v_counts, v_cross, coalesce(v_skipped, 'none')));

    -- D4: a size limit below the current size creates no tenant.
    select count(*) into v_bad from sp0.t4_fill(v_src, 2, 0) f where f.clone_id is not null;
    if v_bad <> 0 then raise exception 'D4: t4_fill made % tenants with a size limit of 0 MB', v_bad; end if;
    if (select count(*) from public.tenant) <> v_before_tenants + 2 then raise exception 'D4: a limit of 0 MB changed the tenant count'; end if;
    v_checks := v_checks + 1;

    -- D4b: a nullable foreign key whose parent the fill leaves out (venue_device) is not silently nulled: the table is skipped and listed. A probe table
    -- (rolled back with the rest) has one row pointing at a device of the source and one with no device.
    declare
      v_owner uuid;
      v_dev uuid := gen_random_uuid();
      v_listed text;
      v_probe_rows bigint;
    begin
      select u.id into v_owner from public.app_user u where u.tenant_id = v_src and u.role = 'owner' and u.is_active order by u.created_at limit 1;
      insert into public.venue_device (id, tenant_id, label, token_hash, created_by) values (v_dev, v_src, 'probe', repeat('a', 64), v_owner);
      create table public.t4_probe (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenant (id),
                                    device_id uuid references public.venue_device (id));
      insert into public.t4_probe (tenant_id, device_id) values (v_src, v_dev), (v_src, null);
      select f.skipped into v_listed from sp0.t4_fill(v_src, 1, 1000000) f where f.clone_id is not null;
      if coalesce(v_listed, '') !~ '(^|; )t4_probe \(' then raise exception 'D4b: a row with an unmapped foreign key was not skipped and listed (skipped: %)', v_listed; end if;
      select count(*) into v_probe_rows from public.t4_probe where tenant_id <> v_src;
      if v_probe_rows <> 0 then raise exception 'D4b: % probe rows were copied with a nulled foreign key', v_probe_rows; end if;
      -- with only the row that has no device, the table is copied
      delete from public.t4_probe where device_id is not null;
      select f.skipped into v_listed from sp0.t4_fill(v_src, 1, 1000000) f where f.clone_id is not null;
      if coalesce(v_listed, '') ~ '(^|; )t4_probe \(' then raise exception 'D4b: a null foreign key must not skip the table (skipped: %)', v_listed; end if;
      select count(*) into v_probe_rows from public.t4_probe where tenant_id <> v_src;
      if v_probe_rows <> 1 then raise exception 'D4b: expected 1 copied probe row, got %', v_probe_rows; end if;
    end;
    v_checks := v_checks + 1;

    -- D5: the measurement and the snapshots need SET ROLE authenticated; if the current user cannot, SV9 applies and this is reported.
    begin
      perform * from sp0.t4_measure(v_src, 'not_a_function', 3);
      raise exception 'D5: t4_measure accepted an unknown function';
    exception when others then
      if sqlerrm like 'D5:%' then raise; end if;
      if sqlerrm not like '%unknown function%' then raise exception 'D5: an unknown p_fn must raise "unknown function", got: %', sqlerrm; end if;
    end;
    v_checks := v_checks + 1;

    if v_can_set then
      foreach v_fn in array array['mfa_gate', 'dashboard_summary', 'menu_list', 'kitchen_tickets'] loop
        select * into v_m from sp0.t4_measure(v_src, v_fn, 3);
        if v_m.fn is distinct from v_fn or v_m.n <> 3 or v_m.p50_ms is null or v_m.p95_ms is null or v_m.max_ms is null or v_m.explain_exec_ms is null then
          raise exception 'D5: t4_measure(%) returned an incomplete row', v_fn; end if;
        if current_user is distinct from v_user then raise exception 'D5: t4_measure left the role %, not %', current_user, v_user; end if;
      end loop;
      if (select count(*) from sp0.t4_measure(v_src, 'menu_list', 2)) <> 1 then raise exception 'D5: t4_measure must return one row'; end if;

      -- D5b: the caller's jwt claims are restored after a measurement and after a snapshot (not blanked).
      perform set_config('request.jwt.claims', '{"sub":"sp0-keep-me"}', true);
      perform * from sp0.t4_measure(v_src, 'menu_list', 2);
      if current_setting('request.jwt.claims', true) is distinct from '{"sub":"sp0-keep-me"}' then raise exception 'D5b: t4_measure did not restore the caller''s jwt claims'; end if;
      perform * from sp0.t4_snapshot(v_src, 'sp0-selfcheck-claims');
      if current_setting('request.jwt.claims', true) is distinct from '{"sub":"sp0-keep-me"}' then raise exception 'D5b: t4_snapshot did not restore the caller''s jwt claims'; end if;
      delete from sp0.t4_snapshot_log where label = 'sp0-selfcheck-claims';
      if current_user is distinct from v_user then raise exception 'D5b: the role changed'; end if;
      v_checks := v_checks + 1;

      -- D6: isolation: a snapshot before the fill (taken on a rolled-back copy of the state is not possible; take one now, with the clones in), then one more.
      perform * from sp0.t4_snapshot(v_src, 'sp0-selfcheck-1');
      perform * from sp0.t4_snapshot(v_src, 'sp0-selfcheck-2');
      select * into v_iso from sp0.t4_isolation(v_src);
      if not v_iso.pass then raise exception 'D6: t4_isolation failed on clean snapshots: %', v_iso.detail; end if;
      if coalesce(v_iso.detail, '') = '' then raise exception 'D6: a passing t4_isolation must say what it checked, not return an empty text'; end if;
      -- a planted id of a cloned ROW (not a clone tenant) in a payload must fail it too
      execute format('select id from public.%I where tenant_id = any ($1) limit 1', 'dining_table') into v_clone using v_clones;
      insert into sp0.t4_snapshot_log (tenant, label, fn, items, payload)
        values (v_src, 'sp0-selfcheck-planted', 'menu_list', 0, jsonb_build_object('row', v_clone));
      select * into v_iso from sp0.t4_isolation(v_src);
      if v_iso.pass then raise exception 'D6: t4_isolation missed a planted cloned row id'; end if;
      delete from sp0.t4_snapshot_log where label = 'sp0-selfcheck-planted';
      -- a planted clone id in a payload, and a planted "Spike Demo" name, must each fail it
      foreach v_clone in array v_clones loop
        insert into sp0.t4_snapshot_log (tenant, label, fn, items, payload)
          values (v_src, 'sp0-selfcheck-planted', 'menu_list', sp0.t4_items('{"x": [{"y": 1}]}'), jsonb_build_object('leak', v_clone));
        select * into v_iso from sp0.t4_isolation(v_src);
        if v_iso.pass then raise exception 'D6: t4_isolation missed a planted clone id'; end if;
        delete from sp0.t4_snapshot_log where label = 'sp0-selfcheck-planted';
        exit;
      end loop;
      insert into sp0.t4_snapshot_log (tenant, label, fn, items, payload)
        values (v_src, 'sp0-selfcheck-planted', 'menu_list', 0, jsonb_build_object('name', 'Spike Demo 001'));
      select * into v_iso from sp0.t4_isolation(v_src);
      if v_iso.pass then raise exception 'D6: t4_isolation missed a planted "Spike Demo" name'; end if;
      delete from sp0.t4_snapshot_log where label = 'sp0-selfcheck-planted';
      -- differing item counts between snapshots fail it too
      insert into sp0.t4_snapshot_log (tenant, label, fn, items, payload)
        select v_src, 'sp0-selfcheck-planted', fn, items + 1, payload from sp0.t4_snapshot_log where label = 'sp0-selfcheck-2' limit 1;
      select * into v_iso from sp0.t4_isolation(v_src);
      if v_iso.pass then raise exception 'D6: t4_isolation missed a changed item count'; end if;
      v_checks := v_checks + 1;
    else
      v_note := concat_ws('; ', v_note, 'D5/D6 measure, snapshot and isolation NOT RUN: the current user cannot SET ROLE authenticated, so SV9 applies');
    end if;

    raise exception 'sp0 rollback' using errcode = 'SP099';
  exception when sqlstate 'SP099' then
    null;
  end;

  perform set_config('sp0.selfcheck_result', format('SP0 self-check D: %s groups ok; can SET ROLE authenticated: %s%s', v_checks, v_can_set,
                       coalesce(' (' || v_note || ')', '')), false);
end
$selfcheck$;

-- execute_sql returns the last statement's rows, not notices: the result is a row.
select current_setting('sp0.selfcheck_result') as result;
