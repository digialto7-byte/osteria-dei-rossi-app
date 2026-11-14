-- SP0 scratch SQL (docs/plans/2026-11-14-sp00-spike.md §3.3): the guard. Every other file in this folder starts with `select sp0.guard();`.
-- It refuses any database that is not the marked temporary project or a CI stack. Staging and production never have the marker.
--
-- Before this file, the lead (phase A3) or the CI workflow creates the marker, after `sp00-ref-check.ts` approved the ref:
--   create schema sp0;
--   create table sp0.target_marker (project_ref text not null, production_ref text, created_at timestamptz not null default now());
--   insert into sp0.target_marker (project_ref) values ('<the temporary project ref>');   -- CI: 'local'
-- `production_ref` is filled only when the production ref is known; SQL cannot read the project ref by itself, so the marker is what
-- the run was meant for. The staging ref below is a literal, as in scripts/lib/demo/target.ts (an identifier, not a secret).
create schema if not exists sp0;

create or replace function sp0.guard() returns void
  language plpgsql stable
  set search_path = ''
as $$
declare
  c_staging constant text := 'wjowhjsfpcdykxwgjipq';
  v_rows bigint;
  v_ref text;
  v_production text;
  v_bad bigint;
begin
  if to_regclass('sp0.target_marker') is null then
    raise exception 'sp0.guard: no target marker. This is not the marked temporary project or a CI stack.';
  end if;

  execute 'select count(*), min(project_ref), min(production_ref) from sp0.target_marker'
    into v_rows, v_ref, v_production;
  if v_rows <> 1 then
    raise exception 'sp0.guard: the target marker must hold exactly one row.';
  end if;

  if v_ref is null or v_ref !~ '^([a-z0-9]{10,40}|local)$' then
    raise exception 'sp0.guard: the marker holds not a project ref (or local).';
  end if;
  if v_ref = c_staging then
    raise exception 'sp0.guard: the marker names the staging project. SP0 never touches staging.';
  end if;
  if v_production is not null and v_ref = v_production then
    raise exception 'sp0.guard: the marker names the production project. SP0 never touches production.';
  end if;

  if to_regclass('public.tenant') is not null then
    execute $q$select count(*) from public.tenant
                where not (name = 'Osteria Demo SP0' or name like 'SP0 Test %' or name like 'Spike Demo %')$q$
      into v_bad;
    if v_bad > 0 then
      raise exception 'sp0.guard: a tenant exists whose name is not one of the spike''s fake names. This is not a throwaway database.';
    end if;
  end if;
end
$$;

revoke all on function sp0.guard() from public, anon, authenticated, service_role;
