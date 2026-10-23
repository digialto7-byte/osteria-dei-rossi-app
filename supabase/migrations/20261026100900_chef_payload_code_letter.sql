-- M12 review fix 3: a chef-payload code must start with a letter.
-- The code pattern [a-z0-9_]{1,40} accepted digit-only strings such as "1250", which can hide an amount.
-- app.chef_payload_allowed (where the rule lives; raise_alert only calls it) is re-created from its 20261026100200
-- definition, verbatim except the code pattern: ^[a-z][a-z0-9_]{0,39}$ (still at most 40 characters).
-- create or replace keeps the ACL (no API role). src/server/alerts/chef-payload.ts mirrors the change.

create or replace function app.chef_payload_allowed(p_payload jsonb) returns boolean
  language sql immutable
  set search_path = ''
as $$
  with recursive walk (node) as (
    select p_payload
    union all
    select c.value
      from walk w
     cross join lateral (
        select o.value
          from jsonb_each(case when jsonb_typeof(w.node) = 'object' then w.node else '{}'::jsonb end) o
        union all
        select a.value
          from jsonb_array_elements(case when jsonb_typeof(w.node) = 'array' then w.node else '[]'::jsonb end) a
     ) c
  ),
  bad_keys as (
    select 1
      from walk w
     cross join lateral jsonb_object_keys(case when jsonb_typeof(w.node) = 'object' then w.node else '{}'::jsonb end) k (key)
     where not (k.key ~ '^[a-z][a-z0-9_]{0,40}(_id|_key|_qty|_count|_hours|_days|_date|_at)$' or k.key = 'unit')
  ),
  bad_values as (
    select 1
      from walk w
     where jsonb_typeof(w.node) = 'string'
       and not (
         (w.node #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or (w.node #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         or (w.node #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
         or (w.node #>> '{}') ~ '^[a-z][a-z0-9_]{0,39}$')
  )
  select p_payload is not null
     and not exists (select 1 from bad_keys)
     and not exists (select 1 from bad_values)
$$;
