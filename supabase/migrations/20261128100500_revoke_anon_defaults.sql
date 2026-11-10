-- Reservations PR2 (lead's read of #69): the public booking page is the first anon entry point, so no future object may reach anon
-- by default. Supabase's default privileges grant anon ALL on every new table, sequence and function in public; PostgreSQL itself
-- lets PUBLIC (and so anon) execute every new function. Every migration so far revokes both by hand (revoke all ... from public, anon,
-- authenticated, service_role, then explicit grants), so existing objects and the explicit grants to authenticated and service_role do
-- not change. From now on an object a migration (run as postgres) creates and forgets to revoke stays closed to anon:
--   * in public and app, postgres's default privileges no longer give anon anything on tables, sequences or functions;
--   * PostgreSQL's built-in PUBLIC execute on new functions is NOT removed: it is not a schema default, and removing it globally breaks
--     every helper function (tests' pg_temp helpers run as authenticated, for one). The house rule (revoke from public, then grant)
--     covers functions, and pgTAP 301 fails if anon can execute any function in public or app other than the five public wrappers.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;
alter default privileges for role postgres in schema app revoke all on tables from anon;
alter default privileges for role postgres in schema app revoke all on sequences from anon;
alter default privileges for role postgres in schema app revoke all on functions from anon;
