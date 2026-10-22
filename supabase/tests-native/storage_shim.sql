-- Minimal stand-in for Supabase Storage's `storage` schema, for running pgTAP on plain Postgres
-- when the Supabase Docker stack is unavailable (loaded by scripts/test-db-native.sh right after
-- auth_shim.sql). Columns, the unique index, RLS-on-objects, storage.foldername and the default
-- grants mirror the real schema, so the same pgTAP files run unchanged in CI under
-- `supabase test db` against real Storage. What it does NOT have: Storage's triggers (for example
-- the one that blocks direct deletes), the Storage API and signed URLs. CI is the gate.
-- Never applied to a real Supabase project.
create schema storage;

create table storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  owner_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create unique index bname on storage.buckets (name);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text,
  user_metadata jsonb
);
create unique index bucketid_objname on storage.objects (bucket_id, name);
create index name_prefix_search on storage.objects (name text_pattern_ops);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;

-- The folders of an object path, without the file name: 't/2026/x.pdf' -> {t,2026}.
create function storage.foldername(name text) returns text[]
  language plpgsql
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;

create function storage.filename(name text) returns text
  language plpgsql
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end
$$;

grant usage on schema storage to anon, authenticated, service_role;
alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;
alter default privileges in schema storage grant all on functions to anon, authenticated, service_role;
alter default privileges in schema storage grant all on sequences to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
grant all on all functions in schema storage to anon, authenticated, service_role;
