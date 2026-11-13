-- P2-1 A6 (docs/plans/2026-11-12-p2-1-totp.md section 3.11, 5 A6; follow-up F16): the money-key rule of app.payload_money_keys, replaced on purpose. The body of
-- 20261022150600 plus:
--   * the words eur, euro and euros, as words: the key is the word, or the word follows a non-letter (euro_total, costo_euro, EUR), or it is camelCase (valueEur, priceEuro,
--     totalEUR, euroTotal, EurTotal). "europe", "eurozone", "EUROPE", "neuron", "amateur" and "queue_ref" are not money: the letters must stand alone or be camel-delimited.
--   * the broad words amount, importo, total, valore and imponibile no longer flag a key that ends in a count or identifier suffix of the M7 allow-list
--     (_id, _key, _qty, _count, _hours, _days, _date, _at, and camel Id, Key, Qty, Count, Hours, Days, Date, At): total_count, totalCount, amount_qty, importo_id.
--   * iva and vat (as words, like eur) end at the end, a non-letter or a camel boundary: the upper-case name IVAN is not the tax word (PR #15's note, lead 2026-11-12).
--   * the specific words cost, price, prezz, margin, _eur, eur, euro, iva and vat are never exempted: cost_count and price_id stay money keys.
-- Output order and the walk are unchanged (C collation, distinct keys, any depth). app.payload_has_money_value (the value guard, "Quartiere EUR") is NOT touched (F17, Keep).
-- tests/server/alerts/templates.test.ts mirrors this rule and shares its vectors with pgTAP 345 (tests/fixtures/money-key-vectors.json).

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
     where
        -- the specific words: never exempted
        k.key ~* '(_eur$|cost|price|prezz|margin)'
        or k.key ~ '(^|[^A-Za-z])([Ii][Vv][Aa]|[Vv][Aa][Tt])([^A-Za-z]|$|[A-Z][a-z])'
        or k.key ~ '[a-z](Iva|IVA|Vat|VAT)([^A-Za-z]|$|[A-Z][a-z])'
        -- eur, euro, euros as a word (after the start or a non-letter), then the end, a non-letter or a camel boundary (a capital followed by a lower-case letter)
        or k.key ~ '(^|[^A-Za-z])[Ee][Uu][Rr]([Oo][Ss]?)?([^A-Za-z]|$|[A-Z][a-z])'
        -- the same word in camelCase: a lower-case letter, a capital E, then the word and the same ending
        or k.key ~ '[a-z]E[Uu][Rr]([Oo][Ss]?)?([^A-Za-z]|$|[A-Z][a-z])'
        -- the broad words, unless the key ends in a count or identifier suffix
        or (k.key ~* '(amount|importo|total|valore|imponibile)'
            and k.key !~* '_(id|key|qty|count|hours|days|date|at)$'
            and k.key !~ '[a-z](Id|Key|Qty|Count|Hours|Days|Date|At)$')
  )
  select coalesce(array_agg(key order by key collate "C"), '{}'::text[]) from keys
$$;
