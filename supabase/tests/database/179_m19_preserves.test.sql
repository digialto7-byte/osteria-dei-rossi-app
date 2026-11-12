-- M19 step 10: what M19 must not touch, and the M19 pins (M19 plan §5 step 10; the technique of 149, 159 and 169).
-- The md5 of the definition of every function below is the one on main 035c648 (M0-M18), computed there with an empty search_path
-- (a chain without the 20261106* migrations gives the same values: checked when this file was written). M19 changes none of them.
-- app.session_fired_lines is the one object M19 replaces on purpose (the M17 stub); it is pinned to its M19 definition here and
-- counts fired lines. The alert registry (15 kinds, the negative_stock row) and both audit_event checks are unchanged: M19 adds no
-- audit entity type, no audit action and no alert kind. If a later milestone changes one of these functions, it re-pins here.
-- The migrations of M19 must not even re-create the protected ones: tests/config/m19-preserves.test.ts greps for it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

set local search_path = '';
create temp table pin_md5 on commit drop as
select p.k, p.sig, p.want, md5(pg_get_functiondef(p.sig::regprocedure)) as got
  from (values
  ('alert_rules_body', 'app.alert_rules_body(timestamp with time zone)', '2ac38ab6a9ae5ef83ccf94d7679ec387'),
  ('batch_settle_state', 'app.batch_settle_state(uuid,uuid,text)', 'b61fbddb11cc1faf457785379aeee9fe'),
  ('chef_payload_allowed', 'app.chef_payload_allowed(jsonb)', '90cfdc224b67c5092a0f34e2d532ca4f'),
  ('lock_batch_rows', 'app.lock_batch_rows(uuid,uuid[])', '18e8a7177076048f7ecccb3eb3bb4502'),
  ('lock_live_batches', 'app.lock_live_batches(uuid,uuid[])', '2eb4745f00cf8cb44d8fa4669c40bae1'),
  ('menu_item_availability', 'app.menu_item_availability(uuid,uuid[],timestamp with time zone)', '5c7553402717dac9b2ac976aab094ec7'),
  -- order_line_guard: re-pinned on purpose by P2-0b A1 (weight columns; the main definition was 4a3b7e7dd2488e7ad5dbf0d15178bf38)
  ('order_line_guard', 'app.order_line_guard()', '2f36b83c7a229b62d17bb56248656cc7'),
-- order_line_json: re-pinned on purpose by P2-0b A3 (was ca3817ad015b0176d52614e037dbb31d)
  ('order_line_json', 'app.order_line_json(public.order_line)', '8e00a06b826ee7d086f6c66cf97aea06'),
  ('plates_sold', 'app.plates_sold(uuid,date,date)', '4f62ee6ef0587aea89bf0c629cbeb971'),
  ('post_stock_outflow', 'app.post_stock_outflow(uuid,uuid,uuid,uuid,numeric,public.stock_movement_type,text,uuid,text,uuid,timestamp with time zone,timestamp with time zone,text)', 'b50e1690b47e3b3f89dd1da533c59463'),
  ('raise_alert', 'app.raise_alert(uuid,text,text,uuid,jsonb,public.alert_severity,public.app_role[],timestamp with time zone,date)', '4cb45fc51c5fefa12eaa9945942ceb23'),
  ('remaining_portions', 'app.remaining_portions(uuid,timestamp with time zone)', '101983b31ef237a52ae5abd08cfc8028'),
  ('try_raise_alert', 'app.try_raise_alert(uuid,text,text,uuid,jsonb,public.alert_severity,public.app_role[],timestamp with time zone,date,text)', '5894b65bd641b328301b72a9bc30b282'),
-- add_order_line: re-pinned on purpose by P2-0b A3 (was 23fdd6661c0658186f3712129f5c58d2)
  ('add_order_line', 'public.add_order_line(uuid,jsonb)', '73bdd6e8fd97544bc7dfc060ab3f8616'),
  ('adjust_batch', 'public.adjust_batch(uuid,numeric)', '183b24bb94f35ce98cab78be9d266f93'),
  ('discard_batch', 'public.discard_batch(uuid,numeric,text)', 'ca7a329aa1cc3e74f04d2afebe740c21'),
  -- menu_list: re-pinned on purpose by P2-0b A2 (weight keys; the main definition was 4cd1832a6da427d9ddee882f85b1b675)
  ('menu_list', 'public.menu_list()', '2fd8eca55d7746d86c705139ed311199'),
  ('order_view', 'public.order_view(uuid)', '5678c095d50f989c42357f86c34793a6'),
  ('produce_batch', 'public.produce_batch(uuid,numeric,jsonb,integer,integer,uuid)', 'beb3cb1d11d08cf5093bf79fe1d4d02e'),
  ('remove_order_line', 'public.remove_order_line(uuid,jsonb)', 'd6c44c8d39bb757783ee8d0fd6077a9f'),
  ('split_batch', 'public.split_batch(uuid,integer,integer,uuid)', '2b6b097d7e6089bf47f871e08af7e120'),
-- update_order_line: re-pinned on purpose by P2-0b A3 (was 4f3ca23557c88533eb4478fceb343b41)
  ('update_order_line', 'public.update_order_line(uuid,jsonb)', '007bba16ae1289cea9be012aa50a74cf')
  , ('session_fired_lines', 'app.session_fired_lines(uuid, uuid[])', 'e7b24b2f6af476958641c076de2de9f5')
  ) p (k, sig, want);
set local search_path = "$user", public, extensions;

select is((select count(*)::int from pin_md5), 23, 'twenty-three functions are pinned: twenty-two untouched ones and the replaced session_fired_lines');
select is_empty($$ select k from pin_md5 where got <> want $$,
  'every pinned function still has its main 035c648 definition (md5): produce/discard/adjust/split_batch, add/update/remove_order_line, order_view, menu_list, the stock engine, the alert path, the batch helpers, the M18 helpers and the plates_sold stub');
select is((select got from pin_md5 where k = 'alert_rules_body'), '2ac38ab6a9ae5ef83ccf94d7679ec387', 'app.alert_rules_body is the main 035c648 definition (md5)');
select is((select got from pin_md5 where k = 'batch_settle_state'), 'b61fbddb11cc1faf457785379aeee9fe', 'app.batch_settle_state is the main 035c648 definition (md5)');
select is((select got from pin_md5 where k = 'chef_payload_allowed'), '90cfdc224b67c5092a0f34e2d532ca4f', 'app.chef_payload_allowed is the main 035c648 definition (md5)');
select is((select got from pin_md5 where k = 'lock_batch_rows'), '18e8a7177076048f7ecccb3eb3bb4502', 'app.lock_batch_rows is the main 035c648 definition (md5)');
select is((select got from pin_md5 where k = 'lock_live_batches'), '2eb4745f00cf8cb44d8fa4669c40bae1', 'app.lock_live_batches is the main 035c648 definition (md5)');
select is((select got from pin_md5 where k = 'menu_item_availability'), '5c7553402717dac9b2ac976aab094ec7', 'app.menu_item_availability is the main 035c648 definition (md5)');
select is((select got from pin_md5 where k = 'order_line_guard'), '2f36b83c7a229b62d17bb56248656cc7', 'app.order_line_guard is the P2-0b A1 definition (md5; re-pinned on purpose, main 035c648 was 4a3b7e7dd2488e7ad5dbf0d15178bf38)');
select is((select got from pin_md5 where k = 'order_line_json'), '8e00a06b826ee7d086f6c66cf97aea06', 'app.order_line_json is the P2-0b A3 definition (md5; re-pinned on purpose, main 035c648 was ca3817ad015b0176d52614e037dbb31d)');
-- M22 re-pins plates_sold on purpose: the M8 stub (md5 8dc7d68d260d08cfbe42a03092da28d2, return 0) is replaced in step 1 by the sum of mapped sold lines (md5 6dcf23182e47a7f42278a93a69339822)
-- and, in step 10, by the same sum read from the stored daily_kpi rows where they exist (20261112100800).
select is((select got from pin_md5 where k = 'plates_sold'), '4f62ee6ef0587aea89bf0c629cbeb971', 'app.plates_sold is the M22 step 10 definition (md5; the M8 stub was 8dc7d68d260d08cfbe42a03092da28d2)');
select is((select got from pin_md5 where k = 'post_stock_outflow'), 'b50e1690b47e3b3f89dd1da533c59463', 'app.post_stock_outflow is the main 035c648 definition (md5)');
select is((select got from pin_md5 where k = 'raise_alert'), '4cb45fc51c5fefa12eaa9945942ceb23', 'app.raise_alert is the main 035c648 definition (md5)');
select is((select got from pin_md5 where k = 'remaining_portions'), '101983b31ef237a52ae5abd08cfc8028', 'app.remaining_portions is the main 035c648 definition (md5)');
select is((select got from pin_md5 where k = 'try_raise_alert'), '5894b65bd641b328301b72a9bc30b282', 'app.try_raise_alert is the main 035c648 definition (md5)');
select is((select got from pin_md5 where k = 'add_order_line'), '73bdd6e8fd97544bc7dfc060ab3f8616', 'public.add_order_line is the P2-0b A3 definition (md5; re-pinned on purpose, main 035c648 was 23fdd6661c0658186f3712129f5c58d2)');
select is((select got from pin_md5 where k = 'adjust_batch'), '183b24bb94f35ce98cab78be9d266f93', 'public.adjust_batch is the main 035c648 definition (md5)');
select is((select got from pin_md5 where k = 'discard_batch'), 'ca7a329aa1cc3e74f04d2afebe740c21', 'public.discard_batch is the main 035c648 definition (md5)');
select is((select got from pin_md5 where k = 'menu_list'), '2fd8eca55d7746d86c705139ed311199', 'public.menu_list is the P2-0b A2 definition (md5; re-pinned on purpose, main 035c648 was 4cd1832a6da427d9ddee882f85b1b675)');
select is((select got from pin_md5 where k = 'order_view'), '5678c095d50f989c42357f86c34793a6', 'public.order_view is the main 035c648 definition (md5)');
select is((select got from pin_md5 where k = 'produce_batch'), 'beb3cb1d11d08cf5093bf79fe1d4d02e', 'public.produce_batch is the main 035c648 definition (md5)');
select is((select got from pin_md5 where k = 'remove_order_line'), 'd6c44c8d39bb757783ee8d0fd6077a9f', 'public.remove_order_line is the main 035c648 definition (md5)');
select is((select got from pin_md5 where k = 'split_batch'), '2b6b097d7e6089bf47f871e08af7e120', 'public.split_batch is the main 035c648 definition (md5)');
select is((select got from pin_md5 where k = 'update_order_line'), '007bba16ae1289cea9be012aa50a74cf', 'public.update_order_line is the P2-0b A3 definition (md5; re-pinned on purpose, main 035c648 was 4f3ca23557c88533eb4478fceb343b41)');

select is((select got from pin_md5 where k = 'session_fired_lines'), 'e7b24b2f6af476958641c076de2de9f5', 'app.session_fired_lines is the M19 definition (md5; the M17 stub was e2b66c8a53638580f7e085e668431450)');
-- app.session_fired_lines: what it does (its definition is pinned above, in the table)
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'session_fired_lines'
              and pg_get_function_identity_arguments(p.oid) = 'p_tenant uuid, p_session_ids uuid[]'), 1, 'app.session_fired_lines(uuid, uuid[]) exists once, with the M17 signature');
select is((select prosrc ~* 'fired_at is not null' from pg_proc where oid = 'app.session_fired_lines(uuid, uuid[])'::regprocedure), true, 'and it counts the lines with fired_at');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r
            where has_function_privilege(r, 'app.session_fired_lines(uuid, uuid[])', 'execute')), 0, 'no API role can execute it');

-- the alert registry
select is((select count(*)::int from app.alert_kind), 15, 'the alert registry still has 15 kinds (M19 adds none)');
select is((select md5(string_agg(k::text, '|' order by k.kind collate "C")) from app.alert_kind k), '09b9c6302f3c9c7c4265a70f73212d40', 'and every row is the one on 035c648 (md5)');
select is((select cost_bearing::text || ' ' || default_severity::text || ' ' || default_audience::text from app.alert_kind where kind = 'negative_stock'), 'false warning {owner,chef}',
  'negative_stock is not cost-bearing, a warning for owner and chef (the batch shortage reuses it)');

-- the audit checks
select is((select md5(pg_get_constraintdef(oid)) from pg_constraint where conname = 'audit_event_entity_type_check'), '72e5b28132df039351b652a126ed03a3', 'audit_event_entity_type_check is the definition on main 7233edc (md5; same as on 035c648, M19 adds no entity type; re-pinned on purpose by reservations (A2))');
select is((select md5(pg_get_constraintdef(oid)) from pg_constraint where conname = 'audit_event_action_check'), '411933f9b791f868814a7cfbea85f03a', 'audit_event_action_check is the definition on main 7233edc (md5; the demo-data PR widened it, M19 adds no action; re-pinned on purpose by reservations (A2))'); -- md5 re-pinned on purpose by P2-1 A3 (six MFA audit actions)
select is((select count(*)::int from pg_constraint where conname in ('audit_event_entity_type_check', 'audit_event_action_check')), 2, 'each exists once');

-- Demo data (ADR-018): M19's one new tenant table joins the purge list, before the order lines and the recipes it points at
select is((select array_position(app.demo_purge_tables(), 'order_line_cost') < array_position(app.demo_purge_tables(), 'order_line')
             and array_position(app.demo_purge_tables(), 'order_line_cost') < array_position(app.demo_purge_tables(), 'recipe')
             and array_position(app.demo_purge_tables(), 'order_line_cost') < array_position(app.demo_purge_tables(), 'app_user')),
  true, 'order_line_cost is in the demo purge list before order_line, recipe and app_user');
select is((select count(*)::int from pg_trigger t where t.tgrelid = 'public.order_line_cost'::regclass and not t.tgisinternal
             and t.tgfoid = 'app.append_only()'::regprocedure and (t.tgtype & 8) = 8), 1,
  'its delete guard is app.append_only (it honours the demo purge, no new branch needed)');

select * from finish();
rollback;
