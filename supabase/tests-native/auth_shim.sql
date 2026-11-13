-- Minimal stand-in for the Supabase platform objects the migrations rely on, for running
-- pgTAP on plain Postgres when the Supabase Docker stack is unavailable. Never applied to a real Supabase project; CI runs the real stack.
do $$ begin create role anon nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin noinherit bypassrls; exception when duplicate_object then null; end $$;
do $$ begin create role supabase_auth_admin nologin noinherit; exception when duplicate_object then null; end $$;
create schema extensions;
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz default now()
);
-- Supabase Auth's MFA factor table (P2-1, plan section 2.2), with the real column types, the two enums and the unique friendly name per
-- user. Only the owner role reads it, as on Supabase: API roles have no grant, the definer functions of the app read it.
create type auth.factor_type as enum ('totp', 'webauthn', 'phone');
create type auth.factor_status as enum ('unverified', 'verified');
create table auth.mfa_factors (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  friendly_name text,
  factor_type auth.factor_type not null,
  status auth.factor_status not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  secret text,
  phone text,
  last_challenged_at timestamptz unique,
  web_authn_credential jsonb,
  web_authn_aaguid uuid,
  last_webauthn_challenge_data jsonb
);
create unique index mfa_factors_user_friendly_name_unique on auth.mfa_factors (friendly_name, user_id) where trim(friendly_name) <> '';
create index factor_id_created_at_idx on auth.mfa_factors (user_id, created_at);
-- Supabase Auth's session and refresh-token tables (P2-1 reset sign-out, plan T-8), with the real column types. refresh_tokens.session_id references sessions(id) on
-- delete cascade, as on Supabase, so deleting a session deletes its refresh tokens. Only the owner role writes them; API roles have no grant.
create type auth.aal_level as enum ('aal1', 'aal2', 'aal3');
create table auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz,
  updated_at timestamptz,
  factor_id uuid,
  aal auth.aal_level,
  not_after timestamptz,
  refreshed_at timestamp,
  user_agent text,
  ip inet,
  tag text
);
create index sessions_user_id_idx on auth.sessions (user_id);
create table auth.refresh_tokens (
  instance_id uuid,
  id bigserial primary key,
  token varchar(255) unique,
  user_id varchar(255),
  revoked boolean,
  created_at timestamptz,
  updated_at timestamptz,
  parent varchar(255),
  session_id uuid references auth.sessions (id) on delete cascade
);
create index refresh_tokens_session_id_revoked_idx on auth.refresh_tokens (session_id, revoked);
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
-- Supabase also grants anon ALL on new sequences in public (for the role the migrations run as); migration 20261128100400 removes it and pgTAP 301 checks it.
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
