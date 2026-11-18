-- SP1 (docs/plans/2026-11-15-sp01-tenant-config.md §3.1.1, §5 step 3, AT1 last clause): what SP1 keeps true across its migrations.
--   * no CHECK constraint in public or app depends on a function that is not immutable (the rule "a CHECK never reads a table"; the tenant's
--     sale VAT list is a trigger because app.sale_vat_rates is stable and reads one);
--   * no write grant (insert, update, delete, truncate; table or column) to anon, authenticated or service_role on the tables SP1 adds.
-- Each SP1 migration step extends the list of added tables below. The proof that the first rule can fail is the mutation block.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- 1. CHECK constraints and function volatility ---------------------------------------------------------------------------------------------------------------
create function pg_temp.volatile_check_deps() returns text[] language sql as $$
  select coalesce(array_agg(x order by x), '{}') from (select distinct t.relname::text || '.' || c.conname || ' -> ' || p.oid::regprocedure::text as x
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_depend d on d.classid = 'pg_constraint'::regclass and d.objid = c.oid and d.refclassid = 'pg_proc'::regclass
    join pg_proc p on p.oid = d.refobjid
    join pg_namespace n on n.oid = c.connamespace
   where c.contype = 'c' and n.nspname in ('public', 'app') and p.provolatile <> 'i') v
$$;
select is(pg_temp.volatile_check_deps(), '{}'::text[], 'no CHECK constraint in public or app depends on a function that is not immutable');
select is((select count(*)::int from pg_constraint c join pg_depend d on d.classid = 'pg_constraint'::regclass and d.objid = c.oid and d.refclassid = 'pg_proc'::regclass
            where c.conname = 'tenant_vat_rate_rate_check'), 1, 'control: the tenant_vat_rate CHECK does call a function (app.allowed_vat_rates, immutable), so the query sees function dependencies');
select is((select p.provolatile::text from pg_proc p where p.oid = 'app.sale_vat_rates(uuid)'::regprocedure), 's', 'control: app.sale_vat_rates is stable (it reads a table)');

-- Mutation: a CHECK that calls app.sale_vat_rates must be reported by the same query.
alter table public.tenant_vat_rate add constraint sp1_mutation_ck check (cardinality(app.sale_vat_rates(tenant_id)) >= 0);
select is(pg_temp.volatile_check_deps(), array['tenant_vat_rate.sp1_mutation_ck -> app.sale_vat_rates(uuid)'], 'mutation: a CHECK calling app.sale_vat_rates is reported');
alter table public.tenant_vat_rate drop constraint sp1_mutation_ck;
select is(pg_temp.volatile_check_deps(), '{}'::text[], 'and the mutation is gone');

-- 2. No write grant on the tables SP1 adds -------------------------------------------------------------------------------------------------------------------
create temp table sp1_tables (name text primary key);
insert into sp1_tables values ('tenant_vat_rate');
select is((select count(*)::int from sp1_tables s where to_regclass('public.' || s.name) is not null), (select count(*)::int from sp1_tables), 'every table SP1 has added so far exists');
select is((select count(*)::int from sp1_tables s, pg_roles r, unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p (priv)
            where r.rolname in ('anon', 'authenticated', 'service_role') and has_table_privilege(r.rolname, 'public.' || s.name, p.priv))
          + (select count(*)::int from sp1_tables s, pg_roles r, pg_attribute a
              where r.rolname in ('anon', 'authenticated', 'service_role') and a.attrelid = ('public.' || s.name)::regclass and a.attnum > 0 and not a.attisdropped
                and (has_column_privilege(r.rolname, a.attrelid, a.attnum, 'INSERT') or has_column_privilege(r.rolname, a.attrelid, a.attnum, 'UPDATE'))),
  0, 'no write grant (table or column) to anon, authenticated or service_role on them');

select * from finish();
rollback;
