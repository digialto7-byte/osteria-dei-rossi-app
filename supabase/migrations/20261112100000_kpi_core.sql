-- M22 step 1 (docs/plans/2026-10-31-m22-kpi-reporting.md §3.1, §3.2; ADR-025): the storage and the one line-level source of the sales KPIs.
--
--   public.daily_kpi          one immutable row per (tenant, business date): the SALES FACTS of that date, written only by app.rollup_daily_kpi
--                             (a later migration, a definer). Append-only for every role (updates, deletes and truncates are refused; the demo
--                             reset may delete, as for every ledger). Owner and admin read it through RLS; nobody holds a write grant.
--   public.dashboard_open     a weekly counter of the owner opening Oggi (count only, no timestamp). Not a ledger: a counter that is updated.
--                             Written only by public.record_dashboard_open (a definer, a later migration).
--   app.kpi_sales_lines       THE line source: one row per non-voided line of the sessions closed in [from, to] (by closed_business_date, M21).
--                             The rollup, the live fallback, the items report and the dashboard all sum these exact values, so their totals agree
--                             to the last digit (AT2). gross = round(qty x unit_price, 2); net = round(gross / (1 + vat / 100), 4).
--   app.kpi_session_rows      one row per closed session: covers, local hour of opening, frozen total, coperto net of VAT.
--   app.kpi_day_row           the live aggregate of one business date (a public.daily_kpi row that is not stored).
--   app.plates_sold           the M8 stub (return 0, 20261023110300) replaced: the quantity of mapped lines (a plate has a recipe, plan A3).
--   app.tenant_has_operational_data  verbatim from 20261105100000 plus dashboard_open in the skip list: an owner who opened Oggi can still start a demo.
--   job_run_job_check         the current list plus 'kpi-rollup'.
-- Unknown is never zero: a line without a frozen cost has food_cost null (costed = false).

create table public.daily_kpi (
  tenant_id uuid not null references public.tenant (id),
  business_date date not null,
  tables integer not null check (tables >= 0),
  covers integer not null check (covers >= 0),
  -- numeric without a typmod: nothing is rounded before it is summed.
  revenue_gross numeric not null check (revenue_gross >= 0),
  items_net numeric not null check (items_net >= 0),
  coperto_net numeric not null check (coperto_net >= 0),
  plates numeric not null check (plates >= 0),
  costed_net numeric not null check (costed_net >= 0),
  food_cost numeric not null check (food_cost >= 0),
  uncosted_net numeric not null check (uncosted_net >= 0),
  unmapped_plates numeric not null check (unmapped_plates >= 0),
  incomplete_plates numeric not null check (incomplete_plates >= 0),
  -- Element h + 1 holds the covers of local hour h of opened_at.
  covers_by_hour integer[] not null check (cardinality(covers_by_hour) = 24 and 0 <= all (covers_by_hour)),
  finalised_at timestamptz not null default clock_timestamp(),
  job_run_id bigint,
  primary key (tenant_id, business_date)
);

create trigger daily_kpi_append_only before update or delete on public.daily_kpi
  for each row execute function app.append_only();
create trigger daily_kpi_no_truncate before truncate on public.daily_kpi
  for each statement execute function app.append_only_truncate();

alter table public.daily_kpi enable row level security;
revoke all on public.daily_kpi from anon, authenticated, service_role;
grant select on public.daily_kpi to authenticated, service_role;
create policy daily_kpi_select on public.daily_kpi for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));

create table public.dashboard_open (
  tenant_id uuid not null references public.tenant (id),
  app_user_id uuid not null,
  -- The Monday of the venue date's ISO week.
  iso_week date not null check (extract(isodow from iso_week) = 1),
  opens integer not null check (opens >= 1),
  primary key (tenant_id, app_user_id, iso_week),
  constraint dashboard_open_user_fkey foreign key (tenant_id, app_user_id) references public.app_user (tenant_id, id)
);
alter table public.dashboard_open enable row level security;
revoke all on public.dashboard_open from anon, authenticated, service_role;
grant select on public.dashboard_open to authenticated, service_role;
create policy dashboard_open_select on public.dashboard_open for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));

-- The line source. A line voided after firing keeps its cost row but is not sold, so it is not here (its cost is waste, plan A5).
create function app.kpi_sales_lines(p_tenant uuid, p_from date, p_to date)
  returns table (business_date date, session_id uuid, menu_item_id uuid, item_name text, course text, qty numeric,
                 gross numeric, net numeric, mapped boolean, costed boolean, food_cost numeric)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select s.closed_business_date, s.id, l.menu_item_id, m.name, l.course::text, l.qty::numeric,
         round(l.qty * l.unit_price, 2),
         round(round(l.qty * l.unit_price, 2) / (1 + l.vat_rate / 100), 4),
         c.recipe_id is not null,
         c.recipe_id is not null and c.total_cost is not null,
         case when c.recipe_id is not null then c.total_cost end
    from public.table_session s
    join public.order_line l on l.tenant_id = s.tenant_id and l.table_session_id = s.id
    join public.menu_item m on m.tenant_id = l.tenant_id and m.id = l.menu_item_id
    left join public.order_line_cost c on c.tenant_id = l.tenant_id and c.order_line_id = l.id
   where s.tenant_id = p_tenant and s.closed_at is not null
     and s.closed_business_date between p_from and p_to
     and l.voided_at is null
$$;

create function app.kpi_session_rows(p_tenant uuid, p_from date, p_to date)
  returns table (business_date date, session_id uuid, covers integer, opened_local_hour integer, total numeric, coperto_net numeric)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select s.closed_business_date, s.id, s.covers::integer,
         extract(hour from s.opened_at at time zone t.timezone)::integer,
         coalesce(s.total, 0),
         coalesce(round(s.coperto_total / (1 + s.coperto_vat_rate / 100), 4), 0)
    from public.table_session s
    join public.tenant t on t.id = s.tenant_id
   where s.tenant_id = p_tenant and s.closed_at is not null
     and s.closed_business_date between p_from and p_to
$$;

-- The live aggregate of one date. finalised_at and job_run_id stay null: the row is not stored (the rollup lists the columns it inserts).
create function app.kpi_day_row(p_tenant uuid, p_date date) returns public.daily_kpi
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  r public.daily_kpi;
begin
  r.tenant_id := p_tenant;
  r.business_date := p_date;
  select count(*)::integer, coalesce(sum(x.covers), 0)::integer, coalesce(sum(x.total), 0), coalesce(sum(x.coperto_net), 0)
    into r.tables, r.covers, r.revenue_gross, r.coperto_net
    from app.kpi_session_rows(p_tenant, p_date, p_date) x;
  select coalesce(sum(x.net), 0), coalesce(sum(x.qty), 0),
         coalesce(sum(x.net) filter (where x.costed), 0), coalesce(sum(x.food_cost) filter (where x.costed), 0),
         coalesce(sum(x.net) filter (where not x.costed), 0),
         coalesce(sum(x.qty) filter (where not x.mapped), 0), coalesce(sum(x.qty) filter (where x.mapped and not x.costed), 0)
    into r.items_net, r.plates, r.costed_net, r.food_cost, r.uncosted_net, r.unmapped_plates, r.incomplete_plates
    from app.kpi_sales_lines(p_tenant, p_date, p_date) x;
  select array_agg(coalesce(h.c, 0)::integer order by g.h) into r.covers_by_hour
    from generate_series(0, 23) g (h)
    left join (select y.opened_local_hour as hh, sum(y.covers) as c
                 from app.kpi_session_rows(p_tenant, p_date, p_date) y group by y.opened_local_hour) h on h.hh = g.h;
  return r;
end
$$;

-- M8's stub (return 0) in force since 20261023110300; same signature. A plate is a line whose item has a recipe (plan A3).
create or replace function app.plates_sold(p_tenant uuid, p_from date, p_to date) returns numeric
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(sum(x.qty), 0) from app.kpi_sales_lines(p_tenant, p_from, p_to) x where x.mapped
$$;

revoke all on function app.kpi_sales_lines(uuid, date, date), app.kpi_session_rows(uuid, date, date), app.kpi_day_row(uuid, date),
  app.plates_sold(uuid, date, date) from public, anon, authenticated, service_role;

-- Verbatim from 20261105100000 except 'dashboard_open' in the skip list.
create or replace function app.tenant_has_operational_data(p_tenant uuid) returns boolean
  language plpgsql stable security definer
  set search_path = ''
as $$
declare
  t text;
  found_row boolean;
begin
  foreach t in array app.demo_purge_tables() loop
    continue when t in ('tenant', 'app_user', 'audit_event', 'alert', 'staff_session', 'auth_attempt', 'venue_device', 'device_enrolment', 'dashboard_open');
    execute format('select exists (select 1 from public.%I where tenant_id = $1)', t) into found_row using p_tenant;
    if found_row then
      return true;
    end if;
  end loop;
  return false;
end
$$;

alter table app.job_run drop constraint job_run_job_check;
alter table app.job_run
  add constraint job_run_job_check check (job in ('extract', 'alert-rules', 'auth-purge', 'ledger-invariants', 'kpi-rollup'));
