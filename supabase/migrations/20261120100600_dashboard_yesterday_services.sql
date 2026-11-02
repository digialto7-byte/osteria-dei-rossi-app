-- M25c step 6 (docs/plans/2026-11-01-m25c-services.md §3.1.9, §3.2; ADR-031): the "Ieri" block of the dashboard gains byService.
-- app.dashboard_yesterday is the body of 20261112100600 (M22) verbatim plus one key:
--   byService   [{key, name, covers, tables, revenueNetEur}] per service, from app.kpi_service_split(D, D) (the one source of the report and the day close), in the split's order
--               (the current version's business-clock order, removed keys last). Covers and net revenue only (Q227).
-- app.dashboard_summary_at and public.dashboard_summary are not touched: they call this function, so both roles get the key; the gate (owner, admin) is unchanged.
-- create or replace keeps the owner and the grants (closed to every API role).
create or replace function app.dashboard_yesterday(p_tenant uuid, p_now timestamptz) returns jsonb
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_d date := app.business_date(p_tenant, p_now) - 1;
  v_cur jsonb := app.kpi_range_agg(p_tenant, v_d, v_d);
  v_prev jsonb := app.kpi_range_agg(p_tenant, v_d - 7, v_d - 7);
  v_delta jsonb;
begin
  select jsonb_object_agg(x.k, case when x.c is null or x.p is null then null
                                    else jsonb_build_object('abs', round(x.c - x.p, 4),
                                                            'pct', case when x.p = 0 then null else round((x.c - x.p) / x.p * 100, 1) end) end)
    into v_delta
    from (select k.key as k, (v_cur ->> k.key)::numeric as c, (v_prev ->> k.key)::numeric as p
            from (values ('covers'), ('revenueNetEur'), ('avgSpendPerCoverEur'), ('avgTicketEur'), ('foodCostPct')) k (key)) x;
  return jsonb_build_object(
    'businessDate', v_d, 'final', v_cur -> 'final', 'covers', v_cur -> 'covers', 'tables', v_cur -> 'tables',
    'revenueNetEur', v_cur -> 'revenueNetEur', 'avgSpendPerCoverEur', v_cur -> 'avgSpendPerCoverEur', 'avgTicketEur', v_cur -> 'avgTicketEur',
    'foodCostPct', v_cur -> 'foodCostPct', 'costedSharePct', v_cur -> 'costedSharePct', 'costedRevenueNetEur', v_cur -> 'costedRevenueNetEur',
    'compare', jsonb_build_object('businessDate', v_d - 7, 'covers', v_prev -> 'covers', 'revenueNetEur', v_prev -> 'revenueNetEur',
                                  'avgSpendPerCoverEur', v_prev -> 'avgSpendPerCoverEur', 'avgTicketEur', v_prev -> 'avgTicketEur', 'foodCostPct', v_prev -> 'foodCostPct'),
    'delta', v_delta,
    'byService', (select coalesce(jsonb_agg(jsonb_build_object('key', s.e ->> 'key', 'name', s.e ->> 'name', 'covers', s.e -> 'covers', 'tables', s.e -> 'tables',
                                                               'revenueNetEur', s.e -> 'revenueNetEur') order by s.o), '[]'::jsonb)
                    from jsonb_array_elements(app.kpi_service_split(p_tenant, v_d, v_d) -> 'services') with ordinality s (e, o)));
end
$$;
