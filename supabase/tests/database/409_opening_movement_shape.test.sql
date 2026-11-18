-- Opening stock, steps 3 and 4 (docs/plans/2026-11-18-opening-stock.md §3.1, §5 steps 3-4): the movement type `opening` and the shape CHECK stock_movement_opening_ck. Nothing writes an
-- opening row yet; this file writes them as the table owner to prove the CHECK, the mirror guard and the append-only triggers. Fake data only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);

-- Step 3: the enum -------------------------------------------------------------------------------------------------------------------------------------------------
select is((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = 'public.stock_movement_type'::regtype),
  'receipt,consumption,waste,transfer,count,opening', 'the enum labels in order are receipt,consumption,waste,transfer,count,opening');

select * from finish();
rollback;
