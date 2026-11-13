-- P2-1 A6 (docs/plans/2026-11-12-p2-1-totp.md section 3.11, 5 A6; follow-up F16): the money-key rule. app.payload_money_keys now also matches the words eur, euro and
-- euros (and camelCase Eur, Euro), as words only, and no longer flags a broad word (total, valore, amount, importo, imponibile) in a key that ends in a count or identifier
-- suffix. The specific words (cost, price, prezz, margin, _eur, eur, euro, iva, vat) are never exempted. The vectors below are the same as tests/fixtures/money-key-vectors.json
-- (tests/server/alerts/money-key-vectors.test.ts keeps the two in agreement). The value guard app.payload_has_money_value is unchanged on purpose (F17, Keep).
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

create temp table vectors (k text primary key, money boolean not null);
insert into vectors (k, money) values
-- vectors:begin
  ('price_eur', true),
  ('unit_cost', true),
  ('Margin', true),
  ('importo', true),
  ('total', true),
  ('totale', true),
  ('valore', true),
  ('imponibile', true),
  ('iva', true),
  ('vat', true),
  ('IVA', true),
  ('Totale_riga', true),
  ('VAT_rate', true),
  ('vatRate', true),
  ('rateIva', true),
  ('sub_total', true),
  ('total_amount', true),
  ('PREZZO_X', true),
  ('cost', true),
  ('line_price', true),
  ('eur', true),
  ('EUR', true),
  ('Eur', true),
  ('euro', true),
  ('Euro', true),
  ('EURO', true),
  ('euros', true),
  ('EUROS', true),
  ('valueEur', true),
  ('priceEuro', true),
  ('totalEUR', true),
  ('costo_euro', true),
  ('eur_total', true),
  ('euro_total', true),
  ('euroTotal', true),
  ('eurTotal', true),
  ('value_eur', true),
  ('total_eur_count', true),
  ('cost_count', true),
  ('costCount', true),
  ('price_id', true),
  ('priceId', true),
  ('margin_qty', true),
  ('prezzo_key', true),
  ('totalAmount', true),
  ('importo_totale', true),
  ('vat_count', true),
  ('iva_id', true),
  ('valore_eur', true),
  ('amount_eur_qty', true),
  ('needed_qty', false),
  ('unit', false),
  ('attiva', false),
  ('relativa', false),
  ('elevation', false),
  ('ivan', false),
  ('IVAN', false),
  ('vatican', false),
  ('due_date', false),
  ('europe', false),
  ('Europe', false),
  ('EUROPE', false),
  ('eurozone', false),
  ('neuron', false),
  ('Neuron', false),
  ('queue_ref', false),
  ('amateur', false),
  ('amateur_x', false),
  ('Amateur', false),
  ('total_count', false),
  ('totalCount', false),
  ('total_qty', false),
  ('total_hours', false),
  ('total_days', false),
  ('total_date', false),
  ('total_at', false),
  ('total_key', false),
  ('total_id', false),
  ('amount_qty', false),
  ('amountQty', false),
  ('amount_id', false),
  ('importo_id', false),
  ('importoId', false),
  ('valore_date', false),
  ('imponibileKey', false),
  ('valore_hours', false),
  ('amountDays', false),
  ('total_lines_count', false)
-- vectors:end
;
select is((select count(*)::int from vectors), 88, 'the table has 88 vectors');
select is((select string_agg(k, ',' order by k collate "C") from vectors
            where (app.payload_money_keys(jsonb_build_object(k, 1)) = array[k]::text[]) is distinct from money), null,
          'every vector is answered as the table says: a money key is listed, any other key is not');
select is(app.payload_money_keys('{"valueEur":1,"priceEuro":2,"europe":3,"neuron":4,"total_count":5,"totalCount":6,"cost_count":7,"price_id":8}'),
          '{cost_count,priceEuro,price_id,valueEur}'::text[], 'a mixed payload lists exactly the money keys (C order)');
select is(app.payload_money_keys('{"a":{"b":[{"value_eur":1},{"total_qty":2}]}}'), '{value_eur}'::text[], 'nested keys are judged the same way');
select is(app.payload_money_keys('{"x":"EUR 10","total_count":3}'), '{}'::text[], 'values are not looked at by the key rule (the value guard is a separate function)');

-- The earlier vectors of 043 still hold.
select is(app.payload_money_keys('{"Margin":1,"importo":2,"PREZZO_X":3,"total_amount":4,"cost":5}'), '{Margin,PREZZO_X,cost,importo,total_amount}'::text[], 'the old money keys are still money (C order)');
select is(app.payload_money_keys('{"needed_qty":5,"unit":"kg","attiva":1,"relativa":2,"elevation":3,"ivan":4,"vatican":5}'), '{}'::text[], 'the old non-money keys are still not');

-- raise_alert: a chef audience refuses a euro key; an owner-only cost kind is unchanged.
create function pg_temp.err(stmt text) returns text language plpgsql as $$
declare state text; msg text;
begin
  execute stmt;
  return 'ok';
exception when others then
  get stacked diagnostics state = returned_sqlstate, msg = message_text;
  return state || ' ' || msg;
end $$;
insert into public.tenant (id, name, vat_number) values ('11111111-1111-4111-8111-111111111111', 'Osteria Demo A', 'IT00000000000');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert_kitchen', 'test_entity', 'e0000000-0000-4000-8000-000000000001', '{"valueEur":1}', null, '{owner,chef}') $$),
          'P0001 alert_payload_cost_key', 'a chef-audience alert with the key valueEur is refused');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'test_alert_kitchen', 'test_entity', 'e0000000-0000-4000-8000-000000000002', '{"total_count":1,"unit":"kg"}', null, '{owner,chef}') $$),
          'ok', 'and one with total_count is accepted (it is a count, no longer over-matched)');
select is(pg_temp.err($$ select app.raise_alert('11111111-1111-4111-8111-111111111111', 'payable_due_today', 'test_entity', 'e0000000-0000-4000-8000-000000000003', '{"valueEur":1}', null, '{owner}') $$),
          'ok', 'an owner-only cost-bearing kind keeps its money keys');
select is(md5(pg_get_functiondef('app.payload_has_money_value(jsonb)'::regprocedure)), '981c0b371c1db3d69232692b8cf26eb6', 'the value guard app.payload_has_money_value is unchanged (md5)');

select * from finish();
rollback;
