-- P2-7 S3 (docs/plans/2026-11-14-p2-7-xml-invoice-upload.md section 3.2, 5 S3): invoice_vat_summary, the per-rate rows (DatiRiepilogo) of a FatturaPA file.
--
-- One row per rate and nature of an XML invoice: taxable, tax, optional rounding, accessory costs, chargeability and legal reference. The legal per-rate amounts can differ from
-- the line sums (rounding), and P2-5 reads them, so they are typed rows with checks, not a jsonb blob. Append-only by trigger (as raw_lot), tenant_id (no default: the import
-- definer of S4 sets it) and RLS: owner and admin of the tenant read; no API role has insert, update or delete, and TRUNCATE is refused. No ledger, no stored balance.
-- The table joins the ADR-018 purge list in this same migration, right before invoice (the foreign key points at it): the list of 20261124100100 plus that one name (59 names).
-- ADR-040's tenant export (not built on main) must list it when built (noted in ADR-044).

create table public.invoice_vat_summary (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  invoice_id uuid not null,
  position smallint not null,
  vat_rate numeric(5, 2) not null,
  vat_nature text,
  taxable numeric(12, 2) not null,
  tax numeric(12, 2) not null,
  rounding numeric(12, 2),
  accessory_costs numeric(12, 2),
  vat_chargeability text,
  legal_reference text,
  created_at timestamptz not null default now(),
  created_by uuid default app.app_user_id() references public.app_user (id),
  constraint invoice_vat_summary_invoice_fk foreign key (tenant_id, invoice_id) references public.invoice (tenant_id, id),
  constraint invoice_vat_summary_position_uq unique (tenant_id, invoice_id, position),
  constraint invoice_vat_summary_position_ck check (position >= 1),
  constraint invoice_vat_summary_vat_rate_ck check (vat_rate between 0 and 100),
  constraint invoice_vat_summary_vat_nature_ck check (vat_nature in (
    'N1', 'N2.1', 'N2.2', 'N3.1', 'N3.2', 'N3.3', 'N3.4', 'N3.5', 'N3.6', 'N4', 'N5',
    'N6.1', 'N6.2', 'N6.3', 'N6.4', 'N6.5', 'N6.6', 'N6.7', 'N6.8', 'N6.9', 'N7')),
  constraint invoice_vat_summary_nature_ck check ((vat_rate = 0) = (vat_nature is not null)),
  constraint invoice_vat_summary_taxable_ck check (taxable >= 0),
  constraint invoice_vat_summary_tax_ck check (tax >= 0),
  constraint invoice_vat_summary_accessory_costs_ck check (accessory_costs >= 0),
  constraint invoice_vat_summary_chargeability_ck check (vat_chargeability in ('I', 'D')),
  constraint invoice_vat_summary_legal_reference_ck check (length(legal_reference) between 1 and 100)
);

alter table public.invoice_vat_summary enable row level security;

revoke all on public.invoice_vat_summary from anon, authenticated;
revoke insert, update, delete, truncate on public.invoice_vat_summary from service_role;
grant select on public.invoice_vat_summary to authenticated, service_role;

create policy invoice_vat_summary_select on public.invoice_vat_summary
  for select to authenticated
  using (tenant_id = (select app.tenant_id()) and (select app.role()) in ('owner', 'admin'));

create trigger invoice_vat_summary_append_only
  before update or delete on public.invoice_vat_summary
  for each row execute function app.append_only();
create trigger invoice_vat_summary_no_truncate
  before truncate on public.invoice_vat_summary
  for each statement execute function app.append_only_truncate();

-- The purge list of 20261124100100 plus invoice_vat_summary. create or replace keeps the owner and the grants (closed to every API role).
-- app.tenant_has_operational_data is not replaced: it reads this list.
create or replace function app.demo_purge_tables() returns text[]
  language sql immutable
  set search_path = ''
as $$
  select array[
    -- alerts and audit
    'alert', 'audit_event',
    -- staff meals and batches
    'staff_meal_confirmation', 'staff_meal_rule', 'batch_cost', 'batch_movement', 'batch_input', 'batch',
    -- counts and stock
    'count_line', 'count_session', 'stock_movement', 'raw_lot',
    -- prices, payables and invoices (P2-7: the VAT summary rows of an XML invoice point at it, so they go right before it)
    'price_history', 'payable', 'invoice_duplicate_decision', 'invoice_line', 'invoice_vat_summary', 'invoice',
    -- cost settings
    'ingredient_cost_basis', 'fixed_cost_period',
    -- M17/M18/M19/M20 tables and menu: the record of the offline operations first (it points at the users only), the frozen cost of a
    -- sent line and the order lines before the sessions and menu items they point at (the cost row also points at a recipe),
    -- sessions before tables, prices before items, items before the recipe keys
    'applied_op', 'kitchen_event', 'order_line_cost', 'order_line',
    -- reservations: the e-mail outbox, the ledger, the assignments and the contact before the reservation; all before the sessions, tables and groups they point at
    'reservation_email', 'reservation_event', 'reservation_table', 'reservation_contact', 'reservation',
    'service_override', 'table_session',
    -- reservations: group members, groups and bookable flags before the tables they point at
    'table_group_member', 'table_group', 'dining_table_booking',
    'dining_table', 'sale_settings', 'menu_push', 'menu_item_price', 'menu_item',
    -- recipes
    'recipe_price', 'recipe_line', 'recipe', 'recipe_key',
    -- master data
    'supplier_item', 'supplier', 'ingredient', 'location', 'cost_centre',
    -- staff login; venue_device and device_enrolment reference each other (deleted together)
    'staff_session', 'auth_attempt', 'venue_device', 'device_enrolment',
    -- M21: the register entries of the end of the day (they point at the users only)
    'day_close',
    -- M22: the frozen daily sales facts (tenant only) and the weekly dashboard opens (they point at the users)
    'daily_kpi', 'dashboard_open',
    -- M25c: the saved service periods (they point at the users only); reservations: the settings (the users only)
    'service_schedule', 'reservation_settings',
    -- last: the demo users. 'tenant' is listed because it carries a tenant_id (pgTAP 194), but the reset never deletes it
    'app_user', 'tenant'
  ]::text[]
$$;
