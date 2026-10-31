-- M22 step 10 (docs/plans/2026-10-31-m22-kpi-reporting.md §3.1.9, §3.10; ADR-025): the perf net (pgTAP 241) showed that the items report of a 366-day range, which asks
-- app.fixed_cost_at for the fixed cost per plate of every date, timed out: fixed_cost_at calls app.plates_sold, and the first version of plates_sold (20261112100000)
-- summed app.kpi_sales_lines over its 30-day window on every call (366 calls x 30 days x every line).
-- app.plates_sold keeps its meaning (the quantity of mapped lines of the sessions closed in [from, to]) and its signature, and reads the frozen daily_kpi rows where they
-- exist (plates - unmapped_plates is exactly the mapped quantity of a date) and the lines only for the dates that have closed sessions and no row yet. A stored row equals the
-- live aggregate of its date (pgTAP 232), so the two paths agree; 241 asserts it on a window that mixes both.
create or replace function app.plates_sold(p_tenant uuid, p_from date, p_to date) returns numeric
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce((select sum(s.plates - s.unmapped_plates)
                     from public.daily_kpi s
                    where s.tenant_id = p_tenant and s.business_date between p_from and p_to), 0)
       + coalesce((select sum(k.p)
                     from (select distinct c.closed_business_date as d
                             from public.table_session c
                            where c.tenant_id = p_tenant and c.closed_at is not null and c.closed_business_date between p_from and p_to
                              and not exists (select 1 from public.daily_kpi e where e.tenant_id = p_tenant and e.business_date = c.closed_business_date)) live,
                          lateral (select sum(x.qty) as p from app.kpi_sales_lines(p_tenant, live.d, live.d) x where x.mapped) k), 0)
$$;
