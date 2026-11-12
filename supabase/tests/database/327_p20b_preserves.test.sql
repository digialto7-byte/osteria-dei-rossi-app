-- P2-0b A7 (sell by weight, plan §5 "Shared lists changed on purpose", AT-W10): what P2-0b must not touch is byte-identical to the tree it was built on, and what it replaced is pinned
-- at its PR 1 definition. The "unchanged" values are the md5 of every definition of the function (pg_get_functiondef, all overloads, with the count) on the tree before
-- 20261130*, i.e. main with P2-0b's files left out; the "replaced" values are the definitions after A1 to A5 (each was also pinned on purpose by the older test that pins it).
-- Fake data only; nothing is written.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

set local search_path = '';
create temp table fn_pin on commit drop as
select p.sch, p.name, p.want,
       (select count(*)::int || ',' || coalesce(md5(string_agg(pg_get_functiondef(x.oid), E'\n' order by x.oid::regprocedure::text collate "C")), '-')
          from pg_proc x where x.proname = p.name and x.pronamespace = p.sch::regnamespace) as got
  from (values
  ('public', 'void_line', '1,d1c3cfff8a2b7a38baad22ef5fa1260d'),
  ('public', 'remove_order_line', '1,d6c44c8d39bb757783ee8d0fd6077a9f'),
  ('public', 'order_view', '1,5678c095d50f989c42357f86c34793a6'),
  ('public', 'open_table', '1,db9f3287a1a7a398338cbd793355041a'),
  ('public', 'close_table', '1,f9161bb02afe6c8870ef1d89bbeda9d7'),
  ('app', 'close_session_at', '1,de835f1c09830ee8b23c1e5a4fe07641'),
  ('app', 'app_vs_register_json', '1,3abf16eeaba926f671a0fb5872dc79f2'),
  ('public', 'enter_day_close', '1,6075533f69641d9c932290389df8c928'),
  ('app', 'split_cents', '1,d05ade62dbe834bd44f49266e96e4808'),
  ('app', 'bill_split_items', '1,1323afd3c4f53ff05480e1141c8501c6'),
  ('app', 'rollup_daily_kpi', '1,472c875de3ded8c9866edaad1c2c0cba'),
  ('app', 'kpi_day_row', '1,ca43a2d8946b85acdd798129516208bb'),
  ('app', 'kpi_session_rows', '1,538056540983f56622ef6ce000db1a2e'),
  ('app', 'plates_sold', '1,4f62ee6ef0587aea89bf0c629cbeb971'),
  ('app', 'menu_item_price_at', '1,63df8053c16d94a740cfca40cce504bc'),
  ('app', 'menu_item_availability', '1,5c7553402717dac9b2ac976aab094ec7'),
  ('app', 'apply_op_dispatch', '1,7ab161507bd2ead75981540dc0890cd2'),
  ('public', 'apply_op', '1,ab16069b7caaebb82efcac073614dd4d'),
  ('app', 'deplete_line_batches', '1,0c07b8f712c23d6f7c8a742d33ac1807'),
  ('app', 'post_plate_raw_outflow', '1,db726fcfc59579fa2f327a040601de5b'),
  ('app', 'lock_fire_batches', '1,c8538170fd37474800d1ae278920ba88'),
  ('public', 'set_sale_settings', '1,e79b8120c6d5385ef635d32afb5cd828'),
  ('public', 'sale_settings_read', '1,08de8612fab4edd737e5039c0ade5bf6'),
  ('app', 'coperto_settings', '1,5eb270334b7d988d7e42dada2559069f'),
  ('public', 'plate_margins_pct', '1,1385b7b4051023745de14f4d395452f5'),
  ('public', 'recipe_cost_at', '1,1dca622a9df20785952878e69351922f')
  ) p (sch, name, want);
create temp table fn_new on commit drop as
select p.sch, p.name, p.want,
       (select count(*)::int || ',' || coalesce(md5(string_agg(pg_get_functiondef(x.oid), E'\n' order by x.oid::regprocedure::text collate "C")), '-')
          from pg_proc x where x.proname = p.name and x.pronamespace = p.sch::regnamespace) as got
  from (values
  ('app', 'order_line_guard', '1,2f36b83c7a229b62d17bb56248656cc7'),
  ('app', 'menu_items_json', '1,222411150c44a925c33076583c4fe5f6'), -- re-pinned on purpose by the review fix (portionWeightG from the terms row; was 1e616ddc3e30ad04fab00dd52512d14d after A2)
  ('public', 'create_menu_item', '1,8aac30040e9222745c2808bf2c6a9a38'), -- re-pinned on purpose by the review fix (the weight goes on the price row; was 11215c54811bca810a01829e7d1822a2 after A2)
  ('public', 'update_menu_item', '1,ad440f86e5f9bd43f12d4a7b1aa8df35'), -- re-pinned on purpose by the review fix (push_active, then the weight versioned with the terms row; was 85ae2385eec6b809cf7c8a7f856cef50 after A2)
  ('public', 'menu_list', '1,2fd8eca55d7746d86c705139ed311199'),
  ('app', 'plate_cost_rows', '1,74f8698b631b7a24de6161d40a1360af'),
  ('public', 'plate_breakdown', '1,c50146d25eb2acb460b938bab2db32b0'),
  ('app', 'order_line_json', '1,8e00a06b826ee7d086f6c66cf97aea06'),
  ('public', 'add_order_line', '1,73bdd6e8fd97544bc7dfc060ab3f8616'),
  ('public', 'update_order_line', '1,007bba16ae1289cea9be012aa50a74cf'),
  ('app', 'apply_op_check_payload', '1,166ed4f0fda5a6c809b3f46be1100561'),
  ('public', 'fire_course', '1,d31530c375e143f5b7813c5ffa49e7ee'),
  ('app', 'freeze_line_cost', '1,c9aeaf8590e82fdc46869f360469fc85'),
  ('app', 'ledger_checks_body', '1,44bec28a5f61b440cb3eabf0416fea39'),
  ('app', 'forecast_portion_lines', '1,e3fe7129b872f2ee059e77b55a089914'),
  ('app', 'session_bill_json', '1,2818b61a789fcf36bd39e96172bd0b9f'),
  ('app', 'kitchen_ticket_rows', '1,9a98f4f0587d252cb5dbb9f536026a57'),
  ('app', 'kpi_items_json', '1,770a14478f607e9429353d59dbca1696'),
  ('public', 'plate_costs', '1,bd1cd8a9a793335ff6ad6fbb57f6f4ae'),
  ('app', 'kpi_sales_lines', '1,062abe6d320266baa73fd790a495bb74'),
  ('app', 'weight_line_price', '1,756bb0c0a64ffa44429330e2e2ed76f1'),
  ('app', 'order_line_portions', '1,d2aa06dd9d58279d904107b6bf0f9bb4'),
  ('app', 'weight_min_g', '1,2effb1f2b312abc4147c42efe00d6650'),
  ('app', 'weight_step_g', '1,20deb3da62b3945e84fa50866971e6bf'),
  ('app', 'default_weight_max_g', '1,ab29b41a7b15fba674c550746eeef4ac'),
  ('app', 'weight_max_setting_bounds', '1,ffdaebefefc8cb5eb6cbb3aed58cf870'),
  ('app', 'weight_max_g', '1,ad6a10faedf541ee0bbb7dd226eeb080'),
  ('app', 'order_line_weight_price', '1,83e4e68644d8f6eb0b11a6db526a43e8'),
  ('app', 'menu_item_sale_terms_at', '1,812393e7d9febc0216edfa3569979b5c'), -- re-pinned on purpose by the review fix (portion_weight_g from the price row; was 82fa1b48cdaef73f54a986aaf7264b43 after A2)
  ('app', 'order_weight', '1,0f5a9cade4556e205b5e410dc80cd084'),
  ('public', 'weight_settings', '1,d9a1aeb504edd5360b0850f8d8f02cb5'),
  ('public', 'set_weight_settings', '1,3839b57876287f106841773cc0b87923')
  ) p (sch, name, want);
-- Values of the replaced functions on the tree before P2-0b (they must all differ from the new ones: each one was changed on purpose).
create temp table fn_old (sch text, name text, was text);
insert into fn_old values
  ('app', 'order_line_guard', '1,4a3b7e7dd2488e7ad5dbf0d15178bf38'),
  ('app', 'menu_items_json', '1,d385b7585ad26e87051e4e4b2a0897f7'),
  ('public', 'create_menu_item', '1,9422d491e8b4dde6980f59147e15a23a'),
  ('public', 'update_menu_item', '1,e4528132ddf5468ead1e366edca9fd0a'),
  ('public', 'menu_list', '1,4cd1832a6da427d9ddee882f85b1b675'),
  ('app', 'plate_cost_rows', '1,d0ab109a22ff019c7c1cf71e49b2fced'),
  ('public', 'plate_breakdown', '1,dfb99a1bd3955507b237fafe224fee20'),
  ('app', 'order_line_json', '1,ca3817ad015b0176d52614e037dbb31d'),
  ('public', 'add_order_line', '1,23fdd6661c0658186f3712129f5c58d2'),
  ('public', 'update_order_line', '1,4f3ca23557c88533eb4478fceb343b41'),
  ('app', 'apply_op_check_payload', '1,81c2603a71538bb3e5ffbef4d28e184a'),
  ('public', 'fire_course', '1,03a53c26d8e86ff418c020bc700d18d9'),
  ('app', 'freeze_line_cost', '1,480f61591c22c34c7c56bfad014f776a'),
  ('app', 'ledger_checks_body', '1,f875c5643047d78b5e3a3093443e8338'),
  ('app', 'forecast_portion_lines', '1,eb7ed14e9679b9754d47e9dacde1a06c'),
  ('app', 'session_bill_json', '1,0122138a83e01f0e593ef3e9ded006e1'),
  ('app', 'kitchen_ticket_rows', '1,f2b6dcb3db23b5f33477d54cc0be081e'),
  ('app', 'kpi_items_json', '1,9d5cbf3b4a16020f2e7dbd724b0e05f0'),
  ('public', 'plate_costs', '1,046453b6cd8338a34a61e50e830d54c4'),
  ('app', 'kpi_sales_lines', '1,c769c518b126cf43a1b2c525d3c22751');
set local search_path = "$user", public, extensions;

select is((select count(*)::int from fn_pin), 26, '26 functions are on the unchanged list');
select is_empty($$ select sch || '.' || name from fn_pin where got <> want $$,
  'every "unchanged on purpose" function has exactly its definition from before P2-0b: void_line, remove_order_line, order_view, open_table, close_table, close_session_at, app_vs_register_json, enter_day_close, split_cents, bill_split_items, rollup_daily_kpi, kpi_day_row, kpi_session_rows, plates_sold, menu_item_price_at, menu_item_availability, apply_op_dispatch, apply_op, deplete_line_batches, post_plate_raw_outflow, lock_fire_batches, set_sale_settings, sale_settings_read, coperto_settings, plate_margins_pct, recipe_cost_at');
select is((select count(*)::int from fn_new), 32, '32 functions are on the PR 1 list (18 replaced, 2 dropped and created again, 12 new)');
select is_empty($$ select sch || '.' || name from fn_new where got <> want $$, 'every replaced or new function has its PR 1 definition (A1 to A5)');
select is_empty($$ select n.sch || '.' || n.name from fn_new n join fn_old o on o.sch = n.sch and o.name = n.name where o.was = n.got $$,
  'and every replaced function really differs from its definition before P2-0b');
select is((select count(*)::int from fn_new where want like '0,%'), 0, 'no function on the list is missing');

-- Registry, purge list, audit checks, jobs, op kinds -----------------------------------------------------------------------------------------------
select is((select md5(pg_get_functiondef('app.demo_purge_tables()'::regprocedure))), '244dbb02cefe9a6ea25146717a2bcbb4', 'app.demo_purge_tables is unchanged (no new table)');
select is((select md5(pg_get_functiondef('app.sync_op_kinds()'::regprocedure))), 'e5dc43795b439b56a1a17c5d59a9d564', 'app.sync_op_kinds is unchanged (no new op kind)');
select is((select count(*)::int from app.alert_kind), 15, 'the alert registry still has 15 kinds');
select is((select md5(string_agg(k::text, '|' order by k.kind collate "C")) from app.alert_kind k), '09b9c6302f3c9c7c4265a70f73212d40', 'and every row is unchanged');
select is((select string_agg(conname || ':' || md5(pg_get_constraintdef(oid)), ',' order by conname collate "C") from pg_constraint where conrelid = 'public.audit_event'::regclass and contype = 'c'),
  'audit_event_action_check:411933f9b791f868814a7cfbea85f03a,audit_event_entity_type_check:72e5b28132df039351b652a126ed03a3,audit_event_reason_check:995aca422790ad65f85a6515909fb21d', -- md5 re-pinned on purpose by P2-1 A3 (six MFA audit actions)
  'the three audit_event checks are unchanged (no new action or entity type)');
select is((select string_agg(jobname, ',' order by jobname collate "C") from cron.job), 'alert-rules,auth-purge,extract-invoices,kpi-rollup,ledger-invariants,reservation-mail,reservation-retention', 'the cron jobs are unchanged');

-- The public surface -----------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int || ',' || md5(string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text collate "C")) from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname not in ('weight_settings', 'set_weight_settings', 'mfa_accounts', 'set_mfa_enforcement', 'mfa_reset_service_begin', 'mfa_reset_service_failed', 'mfa_gate', 'mfa_status', 'mfa_attempt_allowed', 'mfa_record_failure', 'mfa_enrol_check', 'mfa_record_enrolled', 'mfa_unenrol_check', 'mfa_record_unenrolled')),
  '182,2f77316efe3cc05186e67da794abc0b6', 'the public functions other than the two new ones are exactly those of before P2-0b (catalogue md5)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('weight_settings', 'set_weight_settings')), 2, 'and weight_settings and set_weight_settings are the only new ones');
select is_empty($$ select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('weight_settings', 'set_weight_settings')
                    and not (p.prosecdef and p.proconfig = array['search_path=""']
                             and has_function_privilege('authenticated', p.oid, 'execute')
                             and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')) $$,
  'both are security definer with an empty search_path, executable by authenticated only');

-- Grants ----------------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int || ',' || md5(string_agg(c.relname || ':' || r, ',' order by c.relname, r)) from pg_class c cross join unnest(array['anon', 'authenticated', 'service_role']) r
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
              and (has_table_privilege(r, c.oid, 'INSERT') or has_table_privilege(r, c.oid, 'UPDATE') or has_table_privilege(r, c.oid, 'DELETE') or has_table_privilege(r, c.oid, 'TRUNCATE'))),
  '9,2a803829d8655f5ddd299eacfa36919a', 'no public table has a new write grant for anon, authenticated or service_role');
select is((select count(*)::int from unnest(array['menu_item', 'menu_item_price', 'sale_settings', 'order_line']) t cross join unnest(array['anon', 'authenticated', 'service_role']) r
            where has_table_privilege(r, ('public.' || t)::regclass, 'INSERT') or has_table_privilege(r, ('public.' || t)::regclass, 'UPDATE')
               or has_table_privilege(r, ('public.' || t)::regclass, 'DELETE')), 0, 'and the four altered tables have none at all');

select * from finish();
rollback;
