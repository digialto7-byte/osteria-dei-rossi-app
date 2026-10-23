-- M6 step 1: run records for scheduled jobs (M6 plan §3.1.8, §3.2; ADR-006; project plan §3.9).
-- Every authorised run of the extract route (written by withCron) and every run of the hourly
-- alert-rules job leaves one row, so a scheduler that silently stopped can be seen (M13 reads it).
--
-- A run spans tenants (extraction claims the oldest invoice of any tenant), so it has no tenant_id.
-- That is why the table lives in schema `app`, outside `public`: pgTAP 001 requires a non-null
-- tenant_id on every public table. It holds no tenant data (job name, times, an outcome, an error
-- code, an item count). RLS is on with no policy, and no API role has any privilege on it: only the
-- definer functions below touch it. This is a deliberate exception to "every table has tenant_id".

create table app.job_run (
  id bigint generated always as identity primary key,
  -- The job list widens in later milestones (M10 and after), one migration each.
  job text not null check (job in ('extract', 'alert-rules')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  -- A code, never a message: no stack traces, no payloads, no personal data.
  error_code text check (error_code ~ '^[a-z_]{1,40}$'),
  items integer check (items >= 0),
  constraint job_run_finished_ck check ((finished_at is null) = (ok is null))
);
create index job_run_job_started_idx on app.job_run (job, started_at desc);

alter table app.job_run enable row level security;
revoke all on app.job_run from public, anon, authenticated, service_role;

-- Begin a run. Returns its id.
create function app.job_run_begin(p_job text) returns bigint
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into app.job_run (job) values (p_job) returning id into v_id;
  return v_id;
end
$$;

-- End a run once. A second end is an error: the first outcome stands.
create function app.job_run_end(p_id bigint, p_ok boolean, p_error_code text, p_items integer)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v app.job_run;
begin
  select * into v from app.job_run r where r.id = p_id for update;
  if not found then
    raise exception 'job_run_not_found' using errcode = 'P0002';
  end if;
  if v.finished_at is not null then
    raise exception 'job_run_finished' using errcode = 'P0001';
  end if;
  update app.job_run
     set finished_at = now(), ok = p_ok, error_code = p_error_code, items = p_items
   where id = p_id;
end
$$;

revoke all on function app.job_run_begin(text), app.job_run_end(bigint, boolean, text, integer)
  from public, anon, authenticated, service_role;

-- Wrappers for withCron and the integration suite (the Next.js cron route calls them with the secret
-- key). service_role only: a user session gets permission denied.
create function public.job_run_start(p_job text) returns bigint
  language sql
  security definer
  set search_path = ''
as $$
  select app.job_run_begin(p_job)
$$;

create function public.job_run_finish(p_id bigint, p_ok boolean, p_error_code text, p_items integer)
  returns void
  language sql
  security definer
  set search_path = ''
as $$
  select app.job_run_end(p_id, p_ok, p_error_code, p_items)
$$;

-- The newest run of a job (ties on started_at broken by id), zero rows when the job never ran.
create function public.job_run_latest(p_job text)
  returns table (started_at timestamptz, finished_at timestamptz, ok boolean, error_code text,
                 items integer)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select r.started_at, r.finished_at, r.ok, r.error_code, r.items
    from app.job_run r
   where r.job = p_job
   order by r.started_at desc, r.id desc
   limit 1
$$;

revoke all on function public.job_run_start(text),
  public.job_run_finish(bigint, boolean, text, integer),
  public.job_run_latest(text)
  from public, anon, authenticated, service_role;
grant execute on function public.job_run_start(text),
  public.job_run_finish(bigint, boolean, text, integer),
  public.job_run_latest(text)
  to service_role;
