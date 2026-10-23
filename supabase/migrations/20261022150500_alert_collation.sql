-- M6 follow-up: text ordering must not depend on the database collation. CI's Supabase Postgres uses
-- en_US, a plain local Postgres uses C; en_US sorts "cost" before "Margin", C the other way round.
-- 20261022150100 and 20261022150200 are already pushed, so this replaces the two functions that sort text
-- (same signatures, same bodies except for `collate "C"`).

create or replace function app.payload_money_keys(p_payload jsonb) returns text[]
  language sql immutable
  set search_path = ''
as $$
  with recursive walk (node) as (
    select p_payload
    union all
    select c.child
      from walk w
      cross join lateral (
        select e.value as child
          from jsonb_each(case when jsonb_typeof(w.node) = 'object' then w.node else '{}'::jsonb end) e
        union all
        select a.value
          from jsonb_array_elements(case when jsonb_typeof(w.node) = 'array' then w.node else '[]'::jsonb end) a
      ) c
  ),
  keys as (
    select distinct k.key
      from walk w
      cross join lateral jsonb_object_keys(case when jsonb_typeof(w.node) = 'object' then w.node else '{}'::jsonb end) k (key)
     where k.key ~* '(_eur$|cost|price|prezz|margin|amount|importo)'
  )
  select coalesce(array_agg(key order by key collate "C"), '{}'::text[]) from keys
$$;

create or replace function public.alert_kind_list() returns table (kind text, cost_bearing boolean)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select k.kind, k.cost_bearing from app.alert_kind k order by k.kind collate "C"
$$;
