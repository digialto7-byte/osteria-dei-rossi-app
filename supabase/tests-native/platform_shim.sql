-- Minimal stand-ins for pg_cron, pg_net and Supabase Vault, for running pgTAP on plain Postgres
-- when the Supabase Docker stack is unavailable (loaded by scripts/test-db-native.sh before the
-- migrations). They mirror only what 20261022120200_cron_extract.sql and its test use:
--   cron.schedule(jobname, schedule, command) -> jobid, cron.unschedule(jobname), cron.alter_job(jobid, ...,
--     active) and the cron.job table;
--   net.http_post(url, body, params, headers, timeout_milliseconds) -> request id, queued in
--     net.http_request_queue (nothing is ever sent);
--   vault.create_secret(secret, name, description) and the vault.decrypted_secrets view
--     (secrets are stored in clear text here).
-- Never applied to a real Supabase project; CI runs the real extensions.
create schema cron;
create table cron.job (
  jobid bigserial primary key,
  schedule text not null,
  command text not null,
  nodename text not null default 'localhost',
  nodeport integer not null default 5432,
  database text not null default current_database(),
  username text not null default current_user,
  active boolean not null default true,
  jobname text unique
);
create function cron.schedule(job_name text, schedule text, command text) returns bigint
  language sql
as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;
create function cron.unschedule(job_name text) returns boolean
  language sql
as $$
  with gone as (delete from cron.job where jobname = job_name returning 1) select exists (select 1 from gone)
$$;
create function cron.alter_job(job_id bigint, schedule text default null, command text default null,
                               database text default null, username text default null,
                               active boolean default null) returns void
  language sql
as $$
  update cron.job j
     set schedule = coalesce(alter_job.schedule, j.schedule), command = coalesce(alter_job.command, j.command),
         database = coalesce(alter_job.database, j.database), username = coalesce(alter_job.username, j.username),
         active = coalesce(alter_job.active, j.active)
   where j.jobid = job_id
$$;

create schema net;
create table net.http_request_queue (
  id bigserial primary key,
  method text not null,
  url text not null,
  headers jsonb,
  body bytea,
  timeout_milliseconds integer not null
);
create function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer default 5000
) returns bigint
  language sql
as $$
  insert into net.http_request_queue (method, url, headers, body, timeout_milliseconds)
  values ('POST', url, headers, convert_to(body::text, 'UTF8'), timeout_milliseconds)
  returning id
$$;

create schema vault;
create table vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  description text not null default '',
  secret text not null,
  created_at timestamptz not null default now()
);
create view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret, created_at from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null,
    new_description text default '') returns uuid
  language sql
as $$
  insert into vault.secrets (name, description, secret)
  values (new_name, new_description, new_secret) returning id
$$;
