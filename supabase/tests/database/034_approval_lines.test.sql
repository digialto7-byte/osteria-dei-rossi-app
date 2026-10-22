-- M5 step 5: app.approval_lines, receipt_date, resolve_due_date, resolve_location,
-- approval_blockers and the invoice_line_frozen trigger (M5 plan §3.3, §3.1.4, §3.2).
-- Runs as the migration owner: these helpers are called by the definer procedures, not by users.
-- Fixture 1 is the approvable invoice of 2026-09-29 (supplier A, terms 30 days); invoice 2 holds the
-- lines that cannot be converted; invoices 30 and up are small ones with one change each.
begin;
create extension if not exists pgtap with schema extensions;
select plan(69);

insert into auth.users (id, email) values ('a0000000-0000-4000-8000-00000000000a', 'owner-a@example.test');
insert into public.tenant (id, name, vat_number) values
  ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000'),
  ('22222222-2222-4222-8222-222222222222', 'Osteria Demo B', 'IT11111111115');
insert into public.app_user (id, tenant_id, auth_id, role, display_name) values
  ('a1000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-00000000000a', 'owner', 'Titolare A');

insert into public.ingredient (id, tenant_id, name, base_unit) values
  ('1a000000-0000-4000-8000-00000000001a', '11111111-1111-4111-8111-111111111111', 'Manzo', 'kg'),
  ('1b000000-0000-4000-8000-00000000001b', '11111111-1111-4111-8111-111111111111', 'Pollo', 'kg'),
  ('1c000000-0000-4000-8000-00000000001c', '11111111-1111-4111-8111-111111111111', 'Vitello', 'kg'),
  ('1d000000-0000-4000-8000-00000000001d', '11111111-1111-4111-8111-111111111111', 'Sedano', 'kg');
-- Supplier A: terms 30 days. B: terms 0 (pays on the invoice date). C: no terms.
insert into public.supplier (id, tenant_id, name, vat_number, payment_terms_days) values
  ('5a000000-0000-4000-8000-00000000005a', '11111111-1111-4111-8111-111111111111',
   'Fornitore Demo Srl', 'IT12345678903', 30),
  ('5b000000-0000-4000-8000-00000000005b', '11111111-1111-4111-8111-111111111111',
   'Pronta Cassa Srl', 'IT00000000018', 0),
  ('5c000000-0000-4000-8000-00000000005c', '11111111-1111-4111-8111-111111111111',
   'Senza Termini Srl', 'IT00000000026', null);
-- MAN-1: Manzo in 1 kg packs. POL-1: Pollo in cases of 6 x 1 kg.
insert into public.supplier_item (id, tenant_id, supplier_id, ingredient_id, supplier_code, pack_count,
    pack_qty, pack_unit, invoice_unit) values
  ('51000000-0000-4000-8000-000000000051', '11111111-1111-4111-8111-111111111111',
   '5a000000-0000-4000-8000-00000000005a', '1a000000-0000-4000-8000-00000000001a', 'MAN-1', 1, 1, 'kg', 'kg'),
  ('52000000-0000-4000-8000-000000000052', '11111111-1111-4111-8111-111111111111',
   '5a000000-0000-4000-8000-00000000005a', '1b000000-0000-4000-8000-00000000001b', 'POL-1', 6, 1, 'kg', 'conf');
insert into public.cost_centre (id, tenant_id, name) values
  ('c5000000-0000-4000-8000-0000000000c5', '11111111-1111-4111-8111-111111111111', 'Pulizie');
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'Cella'),
  ('10000000-0000-4000-8000-0000000000b1', '22222222-2222-4222-8222-222222222222', 'Cella B');

create function pg_temp.iid(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.lid(n int) returns uuid language sql immutable as $$
  select ('a2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
-- A review invoice of supplier A dated 2026-09-29 with a printed due date; totals are set by fix_totals.
create function pg_temp.mk_inv(n int, p_status public.invoice_status default 'review',
    p_supplier uuid default '5a000000-0000-4000-8000-00000000005a', p_date date default '2026-09-29',
    p_due date default '2026-10-31', p_number text default null, p_override boolean default false,
    p_warn uuid default null, p_dup_of uuid default null) returns void language sql as $$
  insert into public.invoice (id, tenant_id, file_path, file_mime, file_size_bytes, status,
      supplier_vat, supplier_name, number_raw, invoice_date, due_date, net_total, vat_total,
      gross_total, supplier_id, duplicate_of, duplicate_override, duplicate_warning_of)
  values (pg_temp.iid(n), '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111/2026/' || pg_temp.iid(n) || '.pdf', 'application/pdf', 100,
      p_status, 'IT12345678903', 'Fornitore Demo Srl', coalesce(p_number, 'FT ' || n), p_date, p_due,
      0, 0, 0, p_supplier, p_dup_of, p_override, p_warn)
$$;
create function pg_temp.mk_line(n int, inv int, pos int, p_qty numeric, p_unit text, p_amount numeric,
    p_ing uuid default null, p_item uuid default null, p_vat numeric default 10,
    p_credit numeric default 0, p_sub int default 0, p_parent int default null,
    p_stock boolean default true, p_split boolean default false, p_superseded boolean default false,
    p_lot text default null, p_expiry date default null) returns void language sql as $$
  insert into public.invoice_line (id, tenant_id, invoice_id, position, sub_position, parent_line_id,
      raw_description, qty, line_amount, vat_rate, unit, ingredient_id, supplier_item_id,
      mapping_source, is_stock, cost_centre_id, credit_qty, split_at, superseded_at, lot_code, expiry,
      field_confidence, extracted)
  values (pg_temp.lid(n), '11111111-1111-4111-8111-111111111111', pg_temp.iid(inv), pos, p_sub,
      case when p_parent is not null then pg_temp.lid(p_parent) end, 'Prodotto', p_qty, p_amount,
      p_vat, p_unit, p_ing, p_item, case when p_ing is not null then 'manual' end, p_stock,
      case when not p_stock then 'c5000000-0000-4000-8000-0000000000c5'::uuid end, p_credit,
      case when p_split then now() end, case when p_superseded then now() end, p_lot, p_expiry,
      '{}', '{}')
$$;
-- Header totals that match the active lines: net, 10% VAT, gross.
create function pg_temp.fix_totals(n int) returns void language sql as $$
  update public.invoice i
     set net_total = s.total, vat_total = round(s.total * 0.1, 2),
         gross_total = s.total + round(s.total * 0.1, 2)
    from (select coalesce(sum(line_amount), 0) as total from public.invoice_line
           where invoice_id = pg_temp.iid(n) and split_at is null and superseded_at is null) s
   where i.id = pg_temp.iid(n)
$$;
-- An approvable invoice: one 2 kg Manzo line of 10.00 (lines n*10+1).
create function pg_temp.mk_clean(n int, p_status public.invoice_status default 'review',
    p_supplier uuid default '5a000000-0000-4000-8000-00000000005a', p_date date default '2026-09-29',
    p_due date default '2026-10-31', p_number text default null) returns void language plpgsql as $$
begin
  perform pg_temp.mk_inv(n, p_status, p_supplier, p_date, p_due, p_number);
  perform pg_temp.mk_line(n * 10 + 1, n, 1, 2, 'kg', 10, '1a000000-0000-4000-8000-00000000001a',
    '51000000-0000-4000-8000-000000000051');
  perform pg_temp.fix_totals(n);
end
$$;
create function pg_temp.codes(n int, loc uuid default null) returns text language sql as $$
  select coalesce(string_agg(e.value ->> 'code', ',' order by e.ordinality), '-')
    from jsonb_array_elements(app.approval_blockers(pg_temp.iid(n), loc)) with ordinality e
$$;
create function pg_temp.line_ids(n int, p_code text) returns jsonb language sql as $$
  select e.value -> 'lineIds' from jsonb_array_elements(app.approval_blockers(pg_temp.iid(n), null)) e
   where e.value ->> 'code' = p_code
$$;
-- One text per line: position.sub received price credited ('-' = null).
create function pg_temp.lines_text(n int) returns text language sql as $$
  select string_agg(format('%s.%s %s %s %s', position, sub_position,
           coalesce(trim_scale(received_qty)::text, '-'), coalesce(trim_scale(unit_price)::text, '-'),
           coalesce(trim_scale(credited_amount)::text, '-')), '|' order by position, sub_position)
    from app.approval_lines(pg_temp.iid(n))
$$;
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare
  state text;
  msg text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end
$$;

-- Fixture 1: a=2 kg Manzo, b=500 g Manzo, c=2 conf (6 x 1 kg) Pollo, d=3 kg split into 1 kg Vitello
-- and 2 kg Sedano (plus a superseded child), e=non-stock, f=2 kg with a credit of 0.5, g=fully credited.
select pg_temp.mk_inv(1, p_due => null);
select pg_temp.mk_line(101, 1, 1, 2, 'kg', 25.5, '1a000000-0000-4000-8000-00000000001a',
  '51000000-0000-4000-8000-000000000051', p_lot => 'L-A', p_expiry => '2026-12-01');
select pg_temp.mk_line(102, 1, 2, 500, 'g', 4, '1a000000-0000-4000-8000-00000000001a',
  '51000000-0000-4000-8000-000000000051');
select pg_temp.mk_line(103, 1, 3, 2, 'conf', 30, '1b000000-0000-4000-8000-00000000001b',
  '52000000-0000-4000-8000-000000000052');
select pg_temp.mk_line(104, 1, 4, 3, 'kg', 30, p_split => true);
select pg_temp.mk_line(105, 1, 4, 1, 'kg', 10, '1c000000-0000-4000-8000-00000000001c', p_sub => 1, p_parent => 104);
select pg_temp.mk_line(106, 1, 4, 2, 'kg', 20, '1d000000-0000-4000-8000-00000000001d', p_sub => 2, p_parent => 104);
select pg_temp.mk_line(107, 1, 4, 1, 'kg', 10, '1c000000-0000-4000-8000-00000000001c', p_sub => 3, p_parent => 104,
  p_superseded => true);
select pg_temp.mk_line(108, 1, 5, 1, 'pz', 8, p_stock => false, p_vat => 22);
select pg_temp.mk_line(109, 1, 6, 2, 'kg', 20, '1a000000-0000-4000-8000-00000000001a',
  '51000000-0000-4000-8000-000000000051', p_credit => 0.5);
select pg_temp.mk_line(110, 1, 7, 1, 'kg', 4, '1a000000-0000-4000-8000-00000000001a',
  '51000000-0000-4000-8000-000000000051', p_credit => 1);
select pg_temp.fix_totals(1);

-- Fixture 2: a child changed to conf (no pack, it has no supplier item) and pz on a kg ingredient.
select pg_temp.mk_inv(2);
select pg_temp.mk_line(201, 2, 1, 2, 'kg', 10, '1a000000-0000-4000-8000-00000000001a',
  '51000000-0000-4000-8000-000000000051');
select pg_temp.mk_line(202, 2, 2, 3, 'kg', 10, p_split => true);
select pg_temp.mk_line(203, 2, 2, 1, 'conf', 10, '1c000000-0000-4000-8000-00000000001c', p_sub => 1, p_parent => 202);
select pg_temp.mk_line(204, 2, 3, 5, 'pz', 5, '1a000000-0000-4000-8000-00000000001a',
  '51000000-0000-4000-8000-000000000051');
select pg_temp.fix_totals(2);

-- approval_lines (§3.2).
select is(pg_temp.lines_text(1),
  '1.0 2 12.75 0|2.0 0.5 8 0|3.0 12 2.5 0|4.1 1 10 0|4.2 2 10 0|5.0 - - 0|6.0 1.5 10 5.5|7.0 0 - 4.4',
  'received base quantity, price per base unit and credited value of every active line');
select is((select count(*)::int from app.approval_lines(pg_temp.iid(1))), 8,
  'the split parent and the superseded child are not lines');
select is((select count(*)::int from app.approval_lines(pg_temp.iid(1))
            where line_id in (pg_temp.lid(104), pg_temp.lid(107))), 0, 'neither of them appears');
select is((select count(*)::int from app.approval_lines(pg_temp.iid(1))
            where position = 4 and supplier_item_id is null and received_qty > 0), 2,
  'the two active children have no supplier item');
select is((select base_factor from app.approval_lines(pg_temp.iid(1)) where line_id = pg_temp.lid(103)),
  6::numeric, '2 conf of 6 x 1 kg: the factor is the pack (AT3, pack conversion)');
select is((select base_factor from app.approval_lines(pg_temp.iid(1)) where line_id = pg_temp.lid(102)),
  0.001, '500 g on a kg ingredient: the factor is 0.001');
select is((select lot_code || ' ' || expiry from app.approval_lines(pg_temp.iid(1)) where line_id = pg_temp.lid(101)),
  'L-A 2026-12-01', 'lot code and expiry are carried');
select is((select base_unit::text || ' ' || unit || ' ' || is_stock::text from app.approval_lines(pg_temp.iid(1))
            where line_id = pg_temp.lid(103)), 'kg conf true', 'base unit, line unit and stock flag are carried');
select is((select is_stock from app.approval_lines(pg_temp.iid(1)) where line_id = pg_temp.lid(108)), false,
  'the non-stock line is marked');
select is((select ingredient_id from app.approval_lines(pg_temp.iid(1)) where line_id = pg_temp.lid(108)), null,
  'and has no ingredient');
select is((select count(*)::int from app.approval_lines(pg_temp.iid(99))), 0, 'an unknown invoice has no lines');
select is(app.receipt_date(pg_temp.iid(1)), '2026-09-29'::date, 'the receipt date is the invoice date');

-- Blockers: nothing on the approvable fixture, the unconvertible lines, and one change at a time.
select is(pg_temp.codes(1), '-', 'the approvable invoice has no blocker (gross 133.65 balances)');
select is(pg_temp.codes(2), 'line_base_qty_unavailable', 'a conf child and pz on kg are not convertible');
select is(pg_temp.line_ids(2, 'line_base_qty_unavailable'), jsonb_build_array(pg_temp.lid(203), pg_temp.lid(204)),
  'both lines are named, in line order');
select pg_temp.mk_clean(30);
select is(pg_temp.codes(30), '-', 'the clean invoice has no blocker');

select pg_temp.mk_clean(31);
select pg_temp.mk_line(316, 31, 2, 1, 'kg', 5);
select pg_temp.fix_totals(31);
select is(pg_temp.codes(31), 'lines_unmapped', 'an unmapped stock line blocks');
select is(pg_temp.line_ids(31, 'lines_unmapped'), jsonb_build_array(pg_temp.lid(316)), 'and is named');

select pg_temp.mk_clean(32);
update public.invoice set supplier_id = null where id = pg_temp.iid(32);
select is(pg_temp.codes(32), 'supplier_required', 'no supplier blocks');

select pg_temp.mk_clean(33);
update public.invoice set invoice_date = null where id = pg_temp.iid(33);
select is(pg_temp.codes(33), 'invoice_date_required', 'no invoice date blocks');

select pg_temp.mk_clean(34, p_date => app.venue_date(now(), 'Europe/Rome') + 1);
select is(pg_temp.codes(34), 'invoice_date_in_future', 'tomorrow blocks');
select pg_temp.mk_clean(35, p_date => app.venue_date(now(), 'Europe/Rome'));
select is(pg_temp.codes(35), '-', 'today does not');

-- Due date.
select is((select due_date::text || ' ' || source from app.resolve_due_date(pg_temp.iid(30))),
  '2026-10-31 invoice', 'the printed due date wins over the supplier terms');
select pg_temp.mk_clean(36, p_due => null);
select is((select due_date::text || ' ' || source from app.resolve_due_date(pg_temp.iid(36))),
  '2026-10-29 supplier_terms', 'no printed date: invoice date + 30 days');
select pg_temp.mk_clean(37, p_supplier => '5b000000-0000-4000-8000-00000000005b', p_due => null);
select is((select due_date::text || ' ' || source from app.resolve_due_date(pg_temp.iid(37))),
  '2026-09-29 supplier_terms', 'terms of 0 days: the invoice date');
select pg_temp.mk_clean(38, p_supplier => '5c000000-0000-4000-8000-00000000005c', p_due => null);
select is((select due_date from app.resolve_due_date(pg_temp.iid(38))), null, 'no date and no terms: unresolved');
select is((select source from app.resolve_due_date(pg_temp.iid(38))), null, 'with no source either');
select is(pg_temp.codes(38), 'due_date_required', 'and the invoice is blocked');
select is(pg_temp.codes(36), '-', 'terms are enough to approve');
select is((select count(*)::int from app.resolve_due_date(pg_temp.iid(99))), 0, 'an unknown invoice has no due date');

-- Credits.
select pg_temp.mk_clean(40);
update public.invoice_line set credit_qty = 0.5, vat_rate = null where id = pg_temp.lid(401);
select is(pg_temp.codes(40), 'credit_vat_rate_missing', 'a credit without a VAT rate blocks');
select is(pg_temp.line_ids(40, 'credit_vat_rate_missing'), jsonb_build_array(pg_temp.lid(401)), 'and names the line');
select pg_temp.mk_clean(41);
update public.invoice_line set credit_qty = 2, vat_rate = 22 where id = pg_temp.lid(411);
select is(pg_temp.codes(41), 'payable_negative', 'credits above the gross total (12.20 > 11.00) block');
select pg_temp.mk_clean(42);
update public.invoice_line set credit_qty = 2, vat_rate = 10 where id = pg_temp.lid(421);
select is(pg_temp.codes(42), '-', 'credits equal to the gross total (11.00) do not');

-- Duplicates.
select pg_temp.mk_clean(50, p_number => 'FT 100');
select pg_temp.mk_clean(51, p_status => 'approved', p_number => 'FT 100');
select is(pg_temp.codes(50), 'duplicate_invoice', 'an approved invoice with the same VAT, number and date');
update public.invoice set duplicate_override = true where id = pg_temp.iid(50);
select is(pg_temp.codes(50), 'duplicate_invoice', 'is not ignored by a bare override flag (it names no pair)');
update public.invoice set duplicate_override_of = pg_temp.iid(51) where id = pg_temp.iid(50);
select is(pg_temp.codes(50), '-', 'is ignored once the owner said it is not a duplicate of that invoice');
select pg_temp.mk_clean(52);
update public.invoice set status = 'duplicate', duplicate_of = pg_temp.iid(51) where id = pg_temp.iid(52);
select is(pg_temp.codes(52), 'duplicate_invoice', 'a duplicate-status invoice is blocked');
select pg_temp.mk_clean(53, p_status => 'rejected', p_number => 'FT 100');
select pg_temp.mk_clean(54, p_number => 'FT 101');
select pg_temp.mk_clean(55, p_number => 'FT 101', p_date => '2026-09-30');
select is(pg_temp.codes(54), '-', 'the same number on another date is not a duplicate');
select pg_temp.mk_clean(57, p_number => 'FT 102', p_status => 'rejected');
select pg_temp.mk_clean(58, p_number => 'FT 102');
select is(pg_temp.codes(58), '-', 'a rejected invoice with the same key is not live');
select pg_temp.mk_clean(59, p_number => 'FT 103');
update public.invoice set duplicate_warning_of = pg_temp.iid(51) where id = pg_temp.iid(59);
select is(pg_temp.codes(59), 'duplicate_warning', 'an open name-match warning blocks');
update public.invoice set duplicate_override = true where id = pg_temp.iid(59);
select is(pg_temp.codes(59), 'duplicate_warning', 'and a bare override flag does not dismiss it');
update public.invoice set duplicate_override_of = pg_temp.iid(51) where id = pg_temp.iid(59);
select is(pg_temp.codes(59), '-', 'unless it was overridden against that very invoice');

-- Other statuses.
select pg_temp.mk_clean(60, p_status => 'approved');
select is(pg_temp.codes(60), 'invoice_already_approved', 'approved');
select pg_temp.mk_clean(61, p_status => 'rejected');
select is(pg_temp.codes(61), 'invoice_rejected', 'rejected');
select pg_temp.mk_clean(62, p_status => 'extraction_failed');
select is(pg_temp.codes(62), 'invoice_not_in_review', 'extraction_failed');
select pg_temp.mk_clean(63, p_status => 'received');
select is(pg_temp.codes(63), 'invoice_not_in_review', 'received');
select is(pg_temp.codes(52), 'duplicate_invoice', 'and a duplicate is reported as one (not as not-in-review)');

-- Totals: 10.00 + 20.00, VAT 3.00 against the gross.
select pg_temp.mk_clean(70);
select pg_temp.mk_line(702, 70, 2, 1, 'kg', 20, '1a000000-0000-4000-8000-00000000001a',
  '51000000-0000-4000-8000-000000000051');
update public.invoice set net_total = 30, vat_total = 3, gross_total = 33.06 where id = pg_temp.iid(70);
select is(pg_temp.codes(70), 'total_mismatch', 'a gross 6 cents off blocks');
update public.invoice set gross_total = 33.05 where id = pg_temp.iid(70);
select is(pg_temp.codes(70), '-', '5 cents off is within the tolerance');
update public.invoice set gross_total = null where id = pg_temp.iid(70);
select is(pg_temp.codes(70), 'total_mismatch', 'a missing gross blocks');
select pg_temp.mk_clean(71);
update public.invoice set gate_flags = array['total_mismatch'] where id = pg_temp.iid(71);
select is(pg_temp.codes(71), '-', 'a stale stored flag does not block: the gate is computed now');

-- The order follows the gates, every blocker at once.
select pg_temp.mk_inv(80, p_due => null, p_number => 'FT 100', p_warn => pg_temp.iid(51));
update public.invoice set supplier_id = null where id = pg_temp.iid(80);
select pg_temp.mk_line(801, 80, 1, 2, 'kg', 10, '1a000000-0000-4000-8000-00000000001a',
  '51000000-0000-4000-8000-000000000051', p_vat => 22, p_credit => 2);
select pg_temp.mk_line(802, 80, 2, 1, 'kg', 5);
select pg_temp.mk_line(803, 80, 3, 1, 'pz', 5, '1a000000-0000-4000-8000-00000000001a',
  '51000000-0000-4000-8000-000000000051');
select pg_temp.mk_line(804, 80, 4, 1, 'kg', 5, '1a000000-0000-4000-8000-00000000001a',
  '51000000-0000-4000-8000-000000000051', p_vat => null, p_credit => 0.5);
update public.invoice set net_total = 25, vat_total = 2.5, gross_total = 5 where id = pg_temp.iid(80);
select is(pg_temp.codes(80),
  'duplicate_invoice,duplicate_warning,total_mismatch,supplier_required,due_date_required,lines_unmapped,line_base_qty_unavailable,credit_vat_rate_missing,payable_negative',
  'blockers come in the order of the gates');

-- Location.
select is(app.resolve_location('11111111-1111-4111-8111-111111111111', null),
  '10000000-0000-4000-8000-0000000000a1'::uuid, 'the only active location is chosen');
select is(app.resolve_location('11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a1'),
  '10000000-0000-4000-8000-0000000000a1'::uuid, 'a chosen active location is accepted');
select is(pg_temp.err($$ select app.resolve_location('11111111-1111-4111-8111-111111111111',
  '10000000-0000-4000-8000-0000000000b1') $$), 'P0001 location_not_found', 'tenant B''s location is refused');
select is(pg_temp.codes(30, '10000000-0000-4000-8000-0000000000b1'), 'location_not_found',
  'and blocks the approval');
update public.location set is_active = false where id = '10000000-0000-4000-8000-0000000000a1';
select is(pg_temp.err($$ select app.resolve_location('11111111-1111-4111-8111-111111111111',
  '10000000-0000-4000-8000-0000000000a1') $$), 'P0001 location_not_found', 'an inactive location is refused');
select is(pg_temp.err($$ select app.resolve_location('11111111-1111-4111-8111-111111111111', null) $$),
  'P0001 no_location', 'no active location');
select is(pg_temp.codes(30), 'no_location', 'blocks the approval');
update public.location set is_active = true where id = '10000000-0000-4000-8000-0000000000a1';
insert into public.location (id, tenant_id, name) values
  ('10000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'Dispensa');
select is(pg_temp.err($$ select app.resolve_location('11111111-1111-4111-8111-111111111111', null) $$),
  'P0001 location_required', 'two active locations and none chosen');
select is(pg_temp.codes(30), 'location_required', 'blocks the approval');
select is(pg_temp.codes(30, '10000000-0000-4000-8000-0000000000a2'), '-', 'until one is chosen');
select is(app.resolve_location('11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-0000000000a2'),
  '10000000-0000-4000-8000-0000000000a2'::uuid, 'Dispensa can be chosen');

-- Frozen lines.
select pg_temp.mk_clean(90);
select is(pg_temp.err(format('update public.invoice_line set raw_description = %L where id = %L', 'Manzo', pg_temp.lid(901))),
  'ok', 'a line of an invoice in review can be updated');
update public.invoice set status = 'approved' where id = pg_temp.iid(90);
select is(pg_temp.err(format('update public.invoice_line set raw_description = %L where id = %L', 'Altro', pg_temp.lid(901))),
  'P0001 invoice_line_frozen', 'a line of an approved invoice cannot');
select pg_temp.mk_clean(91);
update public.invoice set status = 'rejected' where id = pg_temp.iid(91);
select is(pg_temp.err(format('update public.invoice_line set credit_qty = 1 where id = %L', pg_temp.lid(911))),
  'P0001 invoice_line_frozen', 'nor can a line of a rejected invoice');
select is(pg_temp.err(format('update public.invoice_line set raw_description = %L where id = %L', 'Altro', pg_temp.lid(311))),
  'ok', 'other invoices are not affected');

-- Privileges: helpers are for the definer procedures only.
select ok((select not bool_or(has_function_privilege('authenticated', f, 'execute')
                              or has_function_privilege('anon', f, 'execute'))
             from unnest(array[
               'app.approval_lines(uuid)', 'app.receipt_date(uuid)', 'app.resolve_due_date(uuid)',
               'app.resolve_location(uuid, uuid)', 'app.approval_blockers(uuid, uuid)',
               'app.invoice_line_frozen()']) f),
  'authenticated and anon cannot execute the approval helpers');

select * from finish();
rollback;
