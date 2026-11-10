-- Reservations PR2 (review of the first CI run): anon may run only the five public wrappers and holds no privilege on any table,
-- view or sequence (pgTAP 301). Supabase's default privileges grant anon ALL on every new sequence in public, and the identity/serial
-- sequences created so far (kitchen_event, price_history, reservation_event, service_override, service_schedule) kept that grant.
-- anon cannot reach them today (it can only call the definer wrappers, which run as their owner), but the public booking page is the
-- first anon entry point, so the grant is removed, now and for every sequence the migrations (run as postgres) create later.
revoke all on all sequences in schema public from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
