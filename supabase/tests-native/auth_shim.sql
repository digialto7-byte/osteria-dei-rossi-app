-- Minimal stand-in for the Supabase platform objects the migrations rely on, for running
-- pgTAP on plain Postgres when the Supabase Docker stack is unavailable. Never applied to a real Supabase project; CI runs the real stack.
do $$ begin create role anon nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin noinherit bypassrls; exception when duplicate_object then null; end $$;
do $$ begin create role supabase_auth_admin nologin noinherit; exception when duplicate_object then null; end $$;
create schema extensions;
create extension pgtap with schema extensions;
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz default now()
);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role, supabase_auth_admin;
-- Supabase grants table privileges in public to the API roles by default.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
