-- P2-2 S8 (docs/plans/2026-11-14-p2-2-trace-sell-through.md section 5 "Shared lists changed on purpose", "Unchanged on purpose", D-P1): what P2-2 leaves alone. The trace and sell-through reads add
-- functions and four indexes and nothing else: the md5 of pg_get_functiondef of the procedures and helpers the plan keeps unchanged equals its value on main (e5eade0, taken from a database built
-- from main's migrations), the catalogue of public and app functions minus the 22 new ones is main's, and no table, column, constraint, trigger, policy or enum value was added, so the demo purge list
-- (ADR-018), the tenant export and erasure lists (ADR-040) and every ledger stay as they were. The cron jobs and the alert registry are main's. Catalogue hashes are taken over the public and app
-- schemas only. pgTAP 194 and 196 (the purge list and its ledgers) run unchanged in the same suite. Fake data: none needed.
--
-- P2-7 (XML e-invoice upload, docs/plans/2026-11-14-p2-7-xml-invoice-upload.md section 5 "Shared lists changed on purpose") re-pins this file on purpose, step by step. The
-- catalogue pins below keep main's values (taken from a database built from main's migrations, CI-proven on PG17) and leave out the P2-7 additions by name, from the temp table
-- p27_objs; a test then proves every listed addition exists, so an exclusion that matches nothing cannot hide anything. Each P2-7 migration adds its objects to that table.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);


-- 0. What P2-7 adds (kind, name), left out of the catalogue pins of main's values below -------------------------------------------------------------------------------
-- S1 (20261204100000): the six XML columns, the nature and details of a line, their checks, the immutability guard and the exact-file index.
create temp table p27_objs (kind text not null, name text not null);
insert into p27_objs values
  ('app_fn', 'invoice_xml_guard'),
  ('column', 'invoice.document_type'), ('column', 'invoice.xml_format'), ('column', 'invoice.xml_sha256'), ('column', 'invoice.xml_body_index'),
  ('column', 'invoice.xml_body_count'), ('column', 'invoice.xml_notes'), ('column', 'invoice_line.vat_nature'), ('column', 'invoice_line.xml_details'),
  ('constraint', 'invoice.invoice_document_type_ck'), ('constraint', 'invoice.invoice_xml_format_ck'), ('constraint', 'invoice.invoice_xml_sha256_ck'),
  ('constraint', 'invoice.invoice_xml_body_ck'), ('constraint', 'invoice.invoice_xml_notes_ck'), ('constraint', 'invoice.invoice_xml_meta_ck'),
  ('constraint', 'invoice.invoice_xml_mime_ck'), ('constraint', 'invoice_line.invoice_line_vat_nature_ck'), ('constraint', 'invoice_line.invoice_line_xml_details_ck'),
  ('trigger', 'invoice.invoice_xml_guard'),
  ('index', 'invoice_xml_file_uq');
select is((select count(*)::int from p27_objs o where case o.kind
              when 'app_fn' then exists (select 1 from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = o.name)
              when 'public_fn' then exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = o.name)
              when 'table' then exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = o.name and c.relkind = 'r')
              when 'column' then exists (select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid
                                          where c.relnamespace = 'public'::regnamespace and c.relname || '.' || a.attname = o.name and a.attnum > 0 and not a.attisdropped)
              when 'constraint' then exists (select 1 from pg_constraint k join pg_class t on t.oid = k.conrelid
                                              where t.relnamespace = 'public'::regnamespace and t.relname || '.' || k.conname = o.name)
              when 'trigger' then exists (select 1 from pg_trigger g join pg_class t on t.oid = g.tgrelid
                                           where t.relnamespace = 'public'::regnamespace and not g.tgisinternal and t.relname || '.' || g.tgname = o.name)
              when 'policy' then exists (select 1 from pg_policy pol join pg_class t on t.oid = pol.polrelid
                                          where t.relnamespace = 'public'::regnamespace and t.relname || '.' || pol.polname = o.name)
              when 'index' then exists (select 1 from pg_indexes i where i.schemaname = 'public' and i.indexname = o.name)
            end), (select count(*)::int from p27_objs), 'every P2-7 addition left out of the pins below exists (none of the exclusions matches nothing)');

-- 1. The unchanged procedures and helpers (21 of them) ------------------------------------------------------------------------------------------------
create temp table unchanged (sig text primary key, md5 text not null);
insert into unchanged values
  ('public.approve_invoice(uuid, uuid)', '6b4682a200fa7d7ad6cf848f37556812'),
  ('public.produce_batch(uuid, numeric, jsonb, integer, integer, uuid)', 'beb3cb1d11d08cf5093bf79fe1d4d02e'),
  ('public.split_batch(uuid, integer, integer, uuid)', '2b6b097d7e6089bf47f871e08af7e120'),
  ('public.discard_batch(uuid, numeric, text)', 'ca7a329aa1cc3e74f04d2afebe740c21'),
  ('public.adjust_batch(uuid, numeric)', '183b24bb94f35ce98cab78be9d266f93'),
  ('public.fire_course(uuid, jsonb)', 'd31530c375e143f5b7813c5ffa49e7ee'),
  ('public.void_line(uuid, jsonb)', 'd1c3cfff8a2b7a38baad22ef5fa1260d'),
  ('public.push_menu_item(uuid, jsonb)', 'b6893d6fefa09c2f856212813b31d9da'),
  ('app.push_list_json(uuid, text, timestamp with time zone)', 'c72146f85b64c299cc45052812d9a2d4'),
  ('app.menu_push_periods(uuid, timestamp with time zone, timestamp with time zone)', '9a8ca48215fb1935bf1f208b8eb1feb6'),
  ('app.discards_vs_push_json(uuid, date, timestamp with time zone)', 'c316fc120376c51c1bb3820d5251273b'),
  ('app.forecast_json(uuid, text, date, timestamp with time zone)', 'ac7930444dba421b830ef8901ab6b80e'),
  ('app.reservations_day_json(uuid, text, date, timestamp with time zone)', '1352702ca1e2e04db40103c899829602'),
  ('app.kpi_sales_lines(uuid, date, date)', '062abe6d320266baa73fd790a495bb74'),
  ('app.order_line_portions(numeric, integer, integer)', 'd2aa06dd9d58279d904107b6bf0f9bb4'),
  ('app.demo_purge_tables()', '244dbb02cefe9a6ea25146717a2bcbb4'),
  ('app.tenant_has_operational_data(uuid)', '79f31c13b79b96ff0cecd8b38a3507b5'),
  ('app.payload_money_keys(jsonb)', '028401e1ca05beeced0dc1a7fb66572f'),
  ('app.tenant_id()', '9120a54efc015457eae0667af6f4fe60'),
  ('app.role()', '69915b58e501ac26de0f54d2df409994'),
  ('app.app_user_id()', '1571cf2fb0444cbe443e91eb09cf6045');
select is((select count(*)::int from unchanged u where to_regprocedure(u.sig) is not null), 21, 'all 21 "unchanged on purpose" functions exist (the casts name the exact signatures)');
select is((select string_agg(u.sig, ', ' order by u.sig) from unchanged u where md5(pg_get_functiondef(to_regprocedure(u.sig))) <> u.md5), null,
          'each equals its value on main: approve_invoice, produce_batch, split_batch, discard_batch, adjust_batch, fire_course, void_line, push_menu_item, push_list_json, menu_push_periods, discards_vs_push_json, forecast_json, reservations_day_json, kpi_sales_lines, order_line_portions, demo_purge_tables, tenant_has_operational_data, payload_money_keys, tenant_id, role, app_user_id');
select is(md5(pg_get_functiondef('app.demo_purge_tables()'::regprocedure)), '244dbb02cefe9a6ea25146717a2bcbb4', 'app.demo_purge_tables is unchanged (no new table, ADR-018)');
select is(cardinality(app.demo_purge_tables()), 58, 'and the purge list still holds 58 names');

-- 2. The function catalogue: main's plus the 22 new functions -----------------------------------------------------------------------------------------
select is((select count(*)::int || ',' || md5(string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text collate "C")) from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname not in ('trace_lot_search', 'lot_capture', 'trace_lot', 'trace_batch', 'trace_order_line', 'trace_line_search', 'push_sell_through', 'reservations_covers')
              and p.proname not in (select o.name from p27_objs o where o.kind = 'public_fn')),
          '197,c6198abb810f014217e0bf905304b18d', 'the public functions other than the eight new ones are exactly those of main (197)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('trace_lot_search', 'lot_capture', 'trace_lot', 'trace_batch', 'trace_order_line', 'trace_line_search', 'push_sell_through', 'reservations_covers')), 8, 'and the eight new public functions exist (205 in all)');
select is((select count(*)::int || ',' || md5(string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text collate "C")) from pg_proc p
            where p.pronamespace = 'app'::regnamespace
              and p.proname not in ('require_trace_reader', 'lot_code_norm', 'trace_constants', 'batch_family', 'batch_root', 'trace_lot_search_json', 'lot_capture_json', 'trace_lot_json', 'trace_batch_json',
                                    'trace_line_search_json', 'trace_line_json', 'push_sell_through_json', 'require_covers_reader', 'reservations_covers_json')
              and p.proname not in (select o.name from p27_objs o where o.kind = 'app_fn')),
          '432,842f4e64b6e0508ee30877add21f58c9', 'the app functions other than the 14 new ones are exactly those of main (432)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
              and p.proname in ('require_trace_reader', 'lot_code_norm', 'trace_constants', 'batch_family', 'batch_root', 'trace_lot_search_json', 'lot_capture_json', 'trace_lot_json', 'trace_batch_json',
                                'trace_line_search_json', 'trace_line_json', 'push_sell_through_json', 'require_covers_reader', 'reservations_covers_json')), 14, 'and the 14 new app functions exist (446 in all)');

-- 3. No new table, column, constraint, trigger, policy or enum value (D-P1) ---------------------------------------------------------------------------
select is((select count(*)::int || ',' || md5(string_agg(c.relnamespace::regnamespace::text || '.' || c.relname, ',' order by c.relnamespace::regnamespace::text, c.relname collate "C"))
             from pg_class c where c.relnamespace in ('public'::regnamespace, 'app'::regnamespace) and c.relkind in ('r', 'p', 'v', 'm')
               and c.relname not in (select o.name from p27_objs o where o.kind = 'table')),
          '70,540ac1ec44f4ed942101410e45ba09f1', 'the tables and views of public and app are main''s (70): no new table');
select is((select count(*)::int || ',' || md5(string_agg(c.relnamespace::regnamespace::text || '.' || c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || a.attgenerated::text,
                                                          ',' order by c.relnamespace::regnamespace::text, c.relname, a.attname collate "C"))
             from pg_class c join pg_attribute a on a.attrelid = c.oid
            where c.relnamespace in ('public'::regnamespace, 'app'::regnamespace) and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
              and c.relname not in (select o.name from p27_objs o where o.kind = 'table')
              and c.relname || '.' || a.attname not in (select o.name from p27_objs o where o.kind = 'column')),
          '749,9ed80b28c7e8a568a80ffd7c460ca1d9', 'the columns of those tables, with type, nullability and generation, are main''s (749): no origin column, no new column');
-- The constraints of the schemas our migrations own (public, and app, the only schema they create) are pinned by structure, not by
-- pg_get_constraintdef text or ::regclass text, both of which depend on the server version or the session's search_path: schema, table, name,
-- type, our key columns in order, the referenced table and columns when they are ours (a reference into a Supabase-managed or shim schema such
-- as auth.users counts as 'external', our side only), FK update/delete/match actions and the deferrable/deferred/validated flags. Supabase and
-- shim schemas (auth, storage, realtime, extensions, cron, net, vault) are out of scope. Any constraint added, removed, renamed or re-keyed in
-- our schemas changes the value. CHECK bodies are not hashed; P2-2's migrations are kept free of DDL by tests/config/p2-2-preserves.test.ts.
-- Value from a native build of main's migrations (e5eade0 + docs-only merges): app 30, public 584. P2-2 adds no constraint.
select diag('constraints per owned schema: ' || (select string_agg(x, ', ' order by x) from (
          select n.nspname || ' ' || count(*) as x from pg_constraint c join pg_namespace n on n.oid = c.connamespace
           where n.nspname in ('public', 'app') group by n.nspname) s));
select is((select count(*)::int || ',' || md5(string_agg(
             n.nspname || '.' || t.relname || '.' || c.conname || ':' || c.contype::text
             || ':' || coalesce((select string_agg(a.attname, ',' order by k.ord) from unnest(c.conkey) with ordinality k(n, ord)
                                   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n), '')
             || ':' || case when rn.nspname in ('public', 'app') then rn.nspname || '.' || rt.relname || '(' ||
                              coalesce((select string_agg(a.attname, ',' order by k.ord) from unnest(c.confkey) with ordinality k(n, ord)
                                         join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n), '') || ')'
                            when c.contype = 'f' then 'external' else '' end
             || ':' || c.confupdtype::text || c.confdeltype::text || c.confmatchtype::text
             || ':' || c.condeferrable::text || c.condeferred::text || c.convalidated::text,
             ',' order by n.nspname, t.relname, c.conname collate "C"))
             from pg_constraint c
             join pg_namespace n on n.oid = c.connamespace
             join pg_class t on t.oid = c.conrelid
             left join pg_class rt on rt.oid = c.confrelid
             left join pg_namespace rn on rn.oid = rt.relnamespace
            where n.nspname in ('public', 'app')
              and t.relname not in (select o.name from p27_objs o where o.kind = 'table')
              and t.relname || '.' || c.conname not in (select o.name from p27_objs o where o.kind = 'constraint')),
          '614,46cfcd4ce5b529bb3557d02974fd813f', 'the constraints of public and app are main''s by structure (614): none added, removed, renamed or re-keyed');
select is((select count(*)::int || ',' || md5(string_agg(t.tgrelid::regclass::text || '.' || t.tgname, ',' order by t.tgrelid::regclass::text, t.tgname collate "C"))
             from pg_trigger t join pg_class tc on tc.oid = t.tgrelid where not t.tgisinternal and tc.relnamespace in ('public'::regnamespace, 'app'::regnamespace)
               and tc.relname not in (select o.name from p27_objs o where o.kind = 'table')
               and tc.relname || '.' || t.tgname not in (select o.name from p27_objs o where o.kind = 'trigger')),
          '124,9ca96081df348da6fa79feafb8f45e5d', 'the triggers are main''s (124): no new trigger');
select is((select count(*)::int || ',' || md5(string_agg(pol.polrelid::regclass::text || '.' || pol.polname, ',' order by pol.polrelid::regclass::text, pol.polname collate "C"))
             from pg_policy pol join pg_class pc on pc.oid = pol.polrelid where pc.relnamespace in ('public'::regnamespace, 'app'::regnamespace)
               and pc.relname not in (select o.name from p27_objs o where o.kind = 'table')
               and pc.relname || '.' || pol.polname not in (select o.name from p27_objs o where o.kind = 'policy')),
          '71,c246f155f708cebe2d69133c8f1e1ae9', 'the row-level security policies are main''s (71)');
select is((select count(*)::int || ',' || md5(string_agg(e.enumtypid::regtype::text || '.' || e.enumlabel, ',' order by e.enumtypid::regtype::text, e.enumsortorder))
             from pg_enum e join pg_type et on et.oid = e.enumtypid where et.typnamespace in ('public'::regnamespace, 'app'::regnamespace)),
          '92,5e4c067f10066e0feb287bbfaeb3c636', 'the enum values are main''s (92)');
select is((select count(*)::int || ',' || md5(string_agg(i.indexname, ',' order by i.indexname collate "C")) from pg_indexes i
            where i.schemaname in ('public', 'app') and i.indexname not in ('raw_lot_lot_code_norm_idx', 'raw_lot_received_idx', 'raw_lot_supplier_idx', 'batch_split_from_idx')
              and i.tablename not in (select o.name from p27_objs o where o.kind = 'table')
              and i.indexname not in (select o.name from p27_objs o where o.kind = 'index')),
          '205,3526abba8c1553df5a2fda0c5db9ff70', 'the indexes other than the four P2-2 adds are main''s (205)');
select is((select count(*)::int from pg_indexes i where i.indexname in ('raw_lot_lot_code_norm_idx', 'raw_lot_received_idx', 'raw_lot_supplier_idx', 'batch_split_from_idx')), 4, 'and the four are there');

-- 4. The cron jobs and the alert registry --------------------------------------------------------------------------------------------------------
select is((select string_agg(jobname, ',' order by jobname collate "C") from cron.job), 'alert-rules,auth-purge,extract-invoices,kpi-rollup,ledger-invariants,mfa-failure-retention,reservation-mail,reservation-retention',
          'the cron jobs are main''s (eight, no new job)');
select is((select count(*)::int || ',' || md5(string_agg(k::text, '|' order by k.kind collate "C")) from app.alert_kind k), '15,09b9c6302f3c9c7c4265a70f73212d40', 'the alert registry is main''s (15 kinds, every row unchanged)');

select * from finish();
rollback;
