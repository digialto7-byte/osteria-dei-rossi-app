-- M14 step 2: the helpers in schema app (M14 plan §3.2, §3.1.4-5, §3.1.7-8, §3.1.12; AT2, AT6, ADR-013): the lot
-- recipe code, the use-by in elapsed hours (T1: independent of the session time zone), the use-by state, the
-- portions rule, the operator initials and the requirement expansion app.batch_requirements. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test'),
  ('b0000000-0000-4000-8000-00000000000b', 'owner-b@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare Demo'),
  ('b1000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   'b0000000-0000-4000-8000-00000000000b', 'owner', 'Titolare B Demo');

-- Registry of fixture ids: ingredients 'i:<name>', recipe keys 'k:<name>', recipe versions 'r:<name>#<version>'.
create temporary table reg (k text primary key, id uuid not null);
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from reg where k = p_k $$;
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
  detail text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text, detail = pg_exception_detail;
  return state || ' ' || msg || coalesce(' / ' || nullif(detail, ''), '');
end
$$;
create function pg_temp.mk_ing(p_name text, p_unit text default 'kg', p_stock boolean default true) returns void language plpgsql as $$
begin
  insert into reg values ('i:' || p_name, gen_random_uuid());
  insert into public.ingredient (id, tenant_id, name, base_unit, is_stock)
    values (pg_temp.id('i:' || p_name), '11111111-1111-4111-8111-111111111111', p_name || ' (demo)', p_unit::public.base_unit, p_stock);
end
$$;
-- A recipe key with its version 1. batch: output 6 kg, 30 portions, 72 h; sub: output 1 kg.
create function pg_temp.mk_rec(p_name text, p_type text, p_valid_from timestamptz default '2026-10-01T00:00Z',
    p_tenant uuid default '11111111-1111-4111-8111-111111111111') returns void language plpgsql as $$
declare
  v_user uuid := case when p_tenant = '11111111-1111-4111-8111-111111111111'
                      then 'a1000000-0000-4000-8000-00000000000a' else 'b1000000-0000-4000-8000-00000000000b' end;
begin
  insert into reg values ('k:' || p_name, gen_random_uuid()), ('r:' || p_name || '#1', gen_random_uuid());
  insert into public.recipe_key (id, tenant_id, type, current_version, name_norm, created_by)
    values (pg_temp.id('k:' || p_name), p_tenant, p_type::public.recipe_type, 1, p_name, v_user);
  insert into public.recipe (id, tenant_id, recipe_key, version, valid_from, name, output_qty, output_unit,
      portions_per_batch, shelf_life_hours, created_by)
    values (pg_temp.id('r:' || p_name || '#1'), p_tenant, pg_temp.id('k:' || p_name), 1, p_valid_from, p_name || ' (demo)',
      case p_type when 'plate' then null when 'batch' then 6 else 1 end,
      case p_type when 'plate' then null else 'kg'::public.base_unit end,
      case p_type when 'batch' then 30 end, case p_type when 'batch' then 72 end, v_user);
end
$$;
-- A line of version 1 of a recipe: an ingredient or a sub-recipe (by name).
create function pg_temp.ln(p_rec text, p_pos int, p_target text, p_qty numeric, p_unit text default 'kg',
    p_yield numeric default 1) returns void language plpgsql as $$
begin
  insert into public.recipe_line (tenant_id, recipe_id, position, ingredient_id, sub_recipe_key, qty, unit, yield_factor,
      created_by)
    values ('11111111-1111-4111-8111-111111111111', pg_temp.id('r:' || p_rec || '#1'), p_pos,
      (select id from reg where k = 'i:' || p_target), (select id from reg where k = 'k:' || p_target), p_qty,
      p_unit::public.recipe_unit, p_yield, 'a1000000-0000-4000-8000-00000000000a');
end
$$;
-- 'name=qty; name=qty' of the requirements of a recipe, sorted by name.
create function pg_temp.req(p_rec text, p_at timestamptz default '2026-10-23T10:00Z') returns text language sql as $$
  select coalesce(string_agg(i.name || '=' || trim_scale(r.qty_per_batch)::text, '; ' order by i.name collate "C"), '-')
    from app.batch_requirements('11111111-1111-4111-8111-111111111111', pg_temp.id('r:' || p_rec || '#1'), p_at) r
    join public.ingredient i on i.id = r.ingredient_id
$$;

-- lot_recipe_code ---------------------------------------------------------------------------------------
select is(app.lot_recipe_code('Spezzatino (demo)'), 'SPEZZA', 'Spezzatino (demo) -> SPEZZA');
select is(app.lot_recipe_code('Ragù'), 'RAGU', 'accents are folded: Ragù -> RAGU');
select is(app.lot_recipe_code('Caffè è'), 'CAFFEE', 'Caffè è -> CAFFEE (spaces dropped, 6 characters)');
select is(app.lot_recipe_code('(*)'), 'RIC', 'no letter or digit -> RIC');
select is(app.lot_recipe_code('Brodo (demo)'), 'BRODOD', 'Brodo (demo) -> BRODOD');
select is(app.lot_recipe_code('Spezzatino di manzo (demo)'), 'SPEZZA', 'a longer name with the same start shares the code');
select is(app.lot_recipe_code('ÀÈÌÒÙ 12'), 'AEIOU1', 'upper-case accents are folded too');

-- batch_use_by (AT6, T1) ----------------------------------------------------------------------------------
-- Three vectors around the 2026-10-25 and 2027-03-28 clock changes, rendered in UTC and in Rome.
create function pg_temp.vectors(p_tz text default 'UTC') returns text language sql as $$
  select string_agg(to_char(app.batch_use_by(v.at, v.h) at time zone p_tz, 'YYYY-MM-DD HH24:MI'), ' | ' order by v.n)
    from (values (1, '2027-03-26T19:00Z'::timestamptz, 72), (2, '2027-03-27T23:30Z', 24), (3, '2026-10-24T22:30Z', 24)) v (n, at, h)
$$;
select is(pg_temp.vectors(), '2027-03-29 19:00 | 2027-03-28 23:30 | 2026-10-25 22:30',
  'AT6: use_by = produced_at + elapsed hours (UTC rendering)');
select is(pg_temp.vectors('Europe/Rome'), '2027-03-29 21:00 | 2027-03-29 01:30 | 2026-10-25 23:30',
  'AT6: the same instants in Europe/Rome (72 h from Fri 20:00 is Mon 21:00 after the change)');
set local timezone = 'Europe/Rome';
select is(pg_temp.vectors(), '2027-03-29 19:00 | 2027-03-28 23:30 | 2026-10-25 22:30',
  'T1: the same instants under a Europe/Rome session');
set local timezone = 'America/New_York';
select is(pg_temp.vectors(), '2027-03-29 19:00 | 2027-03-28 23:30 | 2026-10-25 22:30',
  'T1: the same instants under an America/New_York session');
set local timezone = 'Europe/Rome';
-- The control that shows why make_interval(hours) is used: a days field is calendar days in the session zone.
select is(to_char(('2027-03-26T19:00Z'::timestamptz + interval '3 days') at time zone 'UTC', 'YYYY-MM-DD HH24:MI'),
  '2027-03-29 18:00', 'control: + interval ''3 days'' under a Rome session lands an hour earlier (not used)');
reset timezone;
select is(app.batch_use_by('2027-03-26T19:00Z', 72) - '2027-03-26T19:00Z'::timestamptz, interval '3 days',
  'the difference is exactly 72 elapsed hours');

-- use_by_state --------------------------------------------------------------------------------------------
select is(app.use_by_state('2026-10-23T10:00Z', '2026-10-23T10:00Z'), 'expired', 'use_by = now -> expired');
select is(app.use_by_state('2026-10-23T09:00Z', '2026-10-23T10:00Z'), 'expired', 'use_by in the past -> expired');
select is(app.use_by_state('2026-10-24T09:00Z', '2026-10-23T10:00Z'), 'due_soon', 'now + 23 h -> due_soon');
select is(app.use_by_state('2026-10-24T10:00Z', '2026-10-23T10:00Z'), 'due_soon', 'now + 24 h -> due_soon');
select is(app.use_by_state('2026-10-24T11:00Z', '2026-10-23T10:00Z'), 'ok', 'now + 25 h -> ok');

-- batch_portions (AT2, project Q19 default: rounded down) ---------------------------------------------------
select is(app.batch_portions(6.2, 6, 30), 31, '6,2 kg of a 6 kg / 30 portion batch -> 31');
select is(app.batch_portions(6.19, 6, 30), 30, '6,19 kg -> 30 (rounded down)');
select is(app.batch_portions(0.1, 6, 30), 0, '0,1 kg -> 0');
select is(app.batch_portions(6, 6, 30), 30, 'the recipe output -> the recipe portions');
select is(app.batch_portions(0.7, 0.1, 3), 21, 'no float rounding: 0,7 x 3 / 0,1 = 21');

-- initials ------------------------------------------------------------------------------------------------
select is(app.initials('Chef Demo'), 'CD', 'Chef Demo -> CD');
select is(app.initials('anna maria rossi bianchi'), 'AMR', 'at most three letters, upper case');
select is(app.initials(''), '?', 'an empty name -> ?');
select is(app.initials(null), '?', 'a null name -> ?');
select is(app.initials('  Luca   Verdi '), 'LV', 'extra spaces are ignored');

-- batch_requirements (AT2) ----------------------------------------------------------------------------------
select pg_temp.mk_ing('Manzo muscolo'); select pg_temp.mk_ing('Cipolla'); select pg_temp.mk_ing('Carota');
select pg_temp.mk_ing('Acqua', 'l', false); select pg_temp.mk_ing('Sale grosso');
select pg_temp.mk_rec('Soffritto', 'sub');
select pg_temp.ln('Soffritto', 1, 'Cipolla', 0.6); select pg_temp.ln('Soffritto', 2, 'Carota', 0.4);
select pg_temp.mk_rec('Spezzatino', 'batch');
select pg_temp.ln('Spezzatino', 1, 'Manzo muscolo', 5); select pg_temp.ln('Spezzatino', 2, 'Soffritto', 0.5);
select pg_temp.ln('Spezzatino', 3, 'Acqua', 1, 'l');
select is(pg_temp.req('Spezzatino'),
  'Acqua (demo)=1; Carota (demo)=0.2; Cipolla (demo)=0.3; Manzo muscolo (demo)=5',
  'AT2: the stew needs beef 5, onion 0,3 and carrot 0,2 (through the sub), water 1 per batch');
select is(round((select r.qty_per_batch from app.batch_requirements('11111111-1111-4111-8111-111111111111',
    pg_temp.id('r:Spezzatino#1'), '2026-10-23T10:00Z') r where r.ingredient_id = pg_temp.id('i:Manzo muscolo')) * 6.2 / 6, 4),
  5.1667, 'AT2: the proposal for 6,2 kg is round(5 x 6,2 / 6, 4) = 5,1667 kg of beef');

select pg_temp.mk_rec('Brodo', 'batch');
select pg_temp.ln('Brodo', 1, 'Sale grosso', 500, 'g');
select is(pg_temp.req('Brodo'), 'Sale grosso (demo)=0.5', 'a line of 500 g is 0,5 kg');

select pg_temp.mk_rec('Resa', 'batch');
select pg_temp.ln('Resa', 1, 'Manzo muscolo', 5, 'kg', 0.82);
select is(round((select r.qty_per_batch from app.batch_requirements('11111111-1111-4111-8111-111111111111',
    pg_temp.id('r:Resa#1'), '2026-10-23T10:00Z') r), 6), 6.097561, 'a yield of 0,82 on 5 kg is 5 / 0,82 = 6,097561 raw');

select pg_temp.mk_rec('Doppio', 'batch');
select pg_temp.ln('Doppio', 1, 'Cipolla', 1); select pg_temp.ln('Doppio', 2, 'Soffritto', 1);
select is(pg_temp.req('Doppio'), 'Carota (demo)=0.4; Cipolla (demo)=1.6',
  'the same ingredient direct and through a sub is summed (one row)');

select pg_temp.mk_rec('Mezzo', 'batch');
select pg_temp.ln('Mezzo', 1, 'Soffritto', 500, 'g');
select is(pg_temp.req('Mezzo'), 'Carota (demo)=0.2; Cipolla (demo)=0.3', 'a sub used in grams is scaled by its output (500 g of 1 kg)');

-- A diamond: batch -> S1, S2 (1 kg each) -> both use S3 (1 kg) -> onion 1 kg: the onion is counted twice.
select pg_temp.mk_rec('S3', 'sub'); select pg_temp.ln('S3', 1, 'Cipolla', 1);
select pg_temp.mk_rec('S1', 'sub'); select pg_temp.ln('S1', 1, 'S3', 1);
select pg_temp.mk_rec('S2', 'sub'); select pg_temp.ln('S2', 1, 'S3', 1);
select pg_temp.mk_rec('Diamante', 'batch');
select pg_temp.ln('Diamante', 1, 'S1', 1); select pg_temp.ln('Diamante', 2, 'S2', 1);
select is(pg_temp.req('Diamante'), 'Cipolla (demo)=2', 'a diamond counts the shared sub twice, in one row');

-- Failures: a chain of 13 nested subs; a sub with no version in force.
select pg_temp.mk_rec('C' || n, 'sub') from generate_series(1, 13) n;
select pg_temp.ln('C' || n, 1, 'C' || (n + 1), 1) from generate_series(1, 12) n;
select pg_temp.ln('C13', 1, 'Cipolla', 1);
select pg_temp.mk_rec('Catena', 'batch'); select pg_temp.ln('Catena', 1, 'C1', 1);
select is(pg_temp.err($$ select * from app.batch_requirements('11111111-1111-4111-8111-111111111111',
    pg_temp.id('r:Catena#1'), '2026-10-23T10:00Z') $$),
  'P0001 recipe_not_producible / graph_too_deep', 'a chain of 13 nested subs is refused: graph_too_deep');
select pg_temp.mk_rec('Futuro', 'sub', '2026-11-01T00:00Z'); select pg_temp.ln('Futuro', 1, 'Cipolla', 1);
select pg_temp.mk_rec('ConFuturo', 'batch'); select pg_temp.ln('ConFuturo', 1, 'Futuro', 1);
select is(pg_temp.err($$ select * from app.batch_requirements('11111111-1111-4111-8111-111111111111',
    pg_temp.id('r:ConFuturo#1'), '2026-10-23T10:00Z') $$),
  'P0001 recipe_not_producible / sub_not_in_force', 'a sub whose only version starts after p_at: sub_not_in_force');
select is(pg_temp.req('ConFuturo', '2026-11-02T00:00Z'), 'Cipolla (demo)=1', 'the same recipe at a later instant resolves');

-- A sub that loops back to its parent fails closed instead of running forever.
select pg_temp.mk_rec('Ciclo1', 'sub'); select pg_temp.mk_rec('Ciclo2', 'sub');
select pg_temp.ln('Ciclo1', 1, 'Ciclo2', 1); select pg_temp.ln('Ciclo2', 1, 'Ciclo1', 1);
select is(pg_temp.err($$ select * from app.batch_requirements('11111111-1111-4111-8111-111111111111',
    pg_temp.id('r:Ciclo1#1'), '2026-10-23T10:00Z') $$),
  'P0001 recipe_not_producible / graph_too_deep', 'a loop in the graph fails closed: graph_too_deep');

-- Not found / tenancy.
select is(pg_temp.err($$ select * from app.batch_requirements('11111111-1111-4111-8111-111111111111', gen_random_uuid(), now()) $$),
  'P0002 recipe_not_found', 'an unknown recipe id: recipe_not_found');
select is(pg_temp.err($$ select * from app.batch_requirements('22222222-2222-4222-8222-222222222222',
    pg_temp.id('r:Spezzatino#1'), now()) $$),
  'P0002 recipe_not_found', 'tenant B asking for tenant A''s recipe: recipe_not_found');

-- A 11-level ladder of 12 subs per level (the deepest path M7 allows), each sub using all 12 subs of the next level
-- (1 kg each) and 0,01 kg of onion: 12^11 paths. The expansion is one row per key per round.
select pg_temp.mk_rec('L' || l || '_' || w, 'sub') from generate_series(1, 11) l, generate_series(1, 12) w;
select pg_temp.ln('L' || l || '_' || w, 1, 'Cipolla', 0.01) from generate_series(1, 11) l, generate_series(1, 12) w;
insert into public.recipe_line (tenant_id, recipe_id, position, sub_recipe_key, qty, unit, yield_factor, created_by)
  select '11111111-1111-4111-8111-111111111111', pg_temp.id('r:L' || l || '_' || w || '#1'), 1 + v, pg_temp.id('k:L' || (l + 1) || '_' || v), 1,
         'kg', 1, 'a1000000-0000-4000-8000-00000000000a'
    from generate_series(1, 10) l, generate_series(1, 12) w, generate_series(1, 12) v;
select pg_temp.mk_rec('Scala', 'batch');
select pg_temp.ln('Scala', w, 'L1_' || w, 1) from generate_series(1, 12) w;
create temporary table ladder (t0 timestamptz, t1 timestamptz, n int, total numeric);
insert into ladder (t0) values (clock_timestamp());
update ladder set total = (select sum(r.qty_per_batch) from app.batch_requirements('11111111-1111-4111-8111-111111111111',
    pg_temp.id('r:Scala#1'), '2026-10-23T10:00Z') r),
  n = (select count(*) from app.batch_requirements('11111111-1111-4111-8111-111111111111', pg_temp.id('r:Scala#1'),
    '2026-10-23T10:00Z') r), t1 = clock_timestamp();
-- c(11) = 0,01; c(j) = 0,01 + 12 c(j+1); the root uses the 12 subs of level 1: 12 c(1).
select is((select total from ladder),
  (select 12 * c from (with recursive c (j, c) as (select 11, 0.01::numeric union all select j - 1, 0.01 + 12 * c from c where j > 1)
                       select c from c where j = 1) x),
  'the ladder completes with the exact total (no path explosion)');
select is((select n from ladder), 1, 'the ladder yields one row per ingredient');
select ok((select t1 - t0 from ladder) < interval '2 seconds', 'the ladder expands in under 2 seconds');

-- Closed to every API role ------------------------------------------------------------------------------
select is_empty(
  $$ select p.proname || ':' || r from pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
      where p.pronamespace = 'app'::regnamespace
        and p.proname in ('lot_recipe_code', 'batch_use_by', 'use_by_state', 'batch_portions', 'initials',
                          'batch_requirements')
        and has_function_privilege(r, p.oid, 'execute') $$,
  'no API role can execute any helper of this migration');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
            and p.proname in ('lot_recipe_code', 'batch_use_by', 'use_by_state', 'batch_portions', 'initials',
                              'batch_requirements')), 6, 'the six helpers exist, once each');

select * from finish();
rollback;
