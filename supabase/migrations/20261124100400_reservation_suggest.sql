-- Reservations A4 (docs/plans/2026-11-08-reservations.md §3.1.7, §3.2, §5 A4): which tables are free for a booking and which one to propose.
--
--   app.reservation_free_tables   the active tables of a tenant that no accepted, arrived or seated booking holds (through an assignment that is not released) during
--                                 [p_from, p_to). Overlap is on half-open ranges, so a booking that ends exactly when another starts does not overlap it. p_except leaves one
--                                 reservation out (the one being placed or moved, so its own hold never blocks it).
--   app.reservation_suggest       {suggested: {kind, tableIds, groupId, seats, tables: [{id, name}], groupName} | null, alternatives: [same, at most 5]}. Candidates in this order:
--                                 bookable single tables with seats >= party (fewest seats, then position, then name), then active groups with seats >= party whose members are
--                                 all free (fewest seats, then name). The first is the suggestion, the next five are the alternatives. A table without seats is never proposed.
-- Neither function is callable by an API role; the staff functions of A5 and the reads of A6 call them.

create function app.reservation_free_tables(p_tenant uuid, p_from timestamptz, p_to timestamptz, p_except uuid)
  returns table (table_id uuid, name text, "position" integer, bookable boolean, seats integer)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select t.id, t.name, t.position, coalesce(b.bookable, false), b.seats::integer
    from public.dining_table t
    left join public.dining_table_booking b on b.tenant_id = t.tenant_id and b.dining_table_id = t.id
   where t.tenant_id = p_tenant and t.is_active
     and not exists (
       select 1
         from public.reservation_table rt
         join public.reservation r on r.tenant_id = rt.tenant_id and r.id = rt.reservation_id
        where rt.tenant_id = p_tenant and rt.dining_table_id = t.id and rt.released_at is null
          and r.status in ('accepted', 'arrived', 'seated')
          and r.id is distinct from p_except
          and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(p_from, p_to, '[)'))
$$;

create function app.reservation_suggest(p_tenant uuid, p_reservation uuid) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  r public.reservation;
  v_all jsonb;
begin
  select x.* into r from public.reservation x where x.tenant_id = p_tenant and x.id = p_reservation;
  if not found then
    raise exception 'reservation_not_found' using errcode = 'P0002';
  end if;
  with free as (
    select f.* from app.reservation_free_tables(p_tenant, r.starts_at, r.ends_at, r.id) f),
  singles as (
    select 1 as grp, f.seats as seats, f.position as pos, f.name as nm, f.table_id as sort_id,
           jsonb_build_object('kind', 'table', 'tableIds', jsonb_build_array(f.table_id), 'groupId', null, 'seats', f.seats,
                              'tables', jsonb_build_array(jsonb_build_object('id', f.table_id, 'name', f.name)), 'groupName', null) as item
      from free f where f.bookable and f.seats is not null and f.seats >= r.party),
  groups as (
    select 2 as grp, g.seats::integer as seats, 0 as pos, g.name as nm, g.id as sort_id,
           jsonb_build_object('kind', 'group', 'tableIds', m.ids, 'groupId', g.id, 'seats', g.seats, 'tables', m.tabs, 'groupName', g.name) as item
      from public.table_group g
     cross join lateral (
       select jsonb_agg(f.table_id order by f.position, f.name collate "C", f.table_id) as ids,
              jsonb_agg(jsonb_build_object('id', f.table_id, 'name', f.name) order by f.position, f.name collate "C", f.table_id) as tabs,
              count(*) as n_free
         from public.table_group_member gm join free f on f.table_id = gm.dining_table_id
        where gm.tenant_id = g.tenant_id and gm.table_group_id = g.id) m
     where g.tenant_id = p_tenant and g.is_active and g.seats >= r.party
       and m.n_free = (select count(*) from public.table_group_member gm2 where gm2.tenant_id = g.tenant_id and gm2.table_group_id = g.id)),
  cand as (
    select * from singles union all select * from groups)
  select coalesce(jsonb_agg(c.item order by c.grp, c.seats, c.pos, c.nm collate "C", c.sort_id), '[]'::jsonb) into v_all from cand c;
  return jsonb_build_object(
    'suggested', case when jsonb_array_length(v_all) = 0 then null else v_all -> 0 end,
    'alternatives', coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(v_all) with ordinality t(e, o) where o between 2 and 6 order by o) x), '[]'::jsonb));
end
$$;

revoke all on function app.reservation_free_tables(uuid, timestamptz, timestamptz, uuid), app.reservation_suggest(uuid, uuid)
  from public, anon, authenticated, service_role;
