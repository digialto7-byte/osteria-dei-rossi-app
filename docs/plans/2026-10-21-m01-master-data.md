# Tech plan — Osteria Digitalization · M1 Master data: suppliers, ingredients, locations, units, pack conversions

- **Client slug / internal:** `osteria-dei-rossi`. No client facts are approved (`docs/client-facts.md`), so fixtures use fake data only: "Osteria Demo", supplier "Fornitore Demo Srl", generic names such as "Cella" and "Manzo".
- **Repo and branch:** `osteria-dei-rossi-app`, branch `feat/m01-master-data`, one draft PR
- **Author:** architect · **Date:** 2026-10-21
- **Sources:** project plan §5a.1 M1, §3.3, §3.5.1, §3.6, §3.11.2, §3.12; `docs/prd.md` 2.1 and 1.3; ADR-002, ADR-003; M0 plan; M0 code on `main`

## 1. Goal and scope
- **Goal:** the tenant-scoped reference data that invoices (M2–M5), recipes (M7) and stock (M12) depend on, with unit and pack conversion that is correct by construction.
- **In scope:**
  - tables `location`, `ingredient`, `supplier` and `supplier_item`. The reorder columns are created now but not exposed by the API.
  - `src/lib/units` and `src/lib/vat` (IT VAT checksum), with an identical SQL check.
  - CRUD endpoints with no DELETE, plus deactivation through `is_active`.
  - JSON and CSV import for suppliers and ingredients.
  - Italian phone-first owner/admin screens.
  - pgTAP and API role tests, and the 5 acceptance tests.
  - The three M0 follow-up nits (step 16).
- **Out of scope:**
  - recipes (M7);
  - the reorder settings UI and API fields (M16);
  - `description_hash` mapping and the review screen (M4); M1 defines the column only;
  - writing `last_price` (M5);
  - `audit_event` for master-data edits (M5);
  - supplier statement (M9);
  - ingredient `cost_basis` (M8).

## 2. Current state
- `supabase/migrations/20261021120000_tenancy_baseline.sql`:
  - `tenant` (`vat_number` checked by regex `^IT[0-9]{11}$` only) and `app_user`;
  - `app.tenant_id()` and `app.role()`, which are SECURITY DEFINER and read the **active** `app_user` row;
  - the hook and `create_tenant_with_owner`.
  - Pattern: RLS on, `(select app.…())` in policies, no DELETE/TRUNCATE for `authenticated` or `service_role`, nothing for `anon`.
- `supabase/tests/database/`:
  - `001` checks RLS, `tenant_id`, a policy, no delete and no anon access on every table (new tables are covered automatically);
  - `002` cross-tenant (tenant B uses VAT `IT00000000001`);
  - `004` fails unless every public table has a fixture row, and checks waiter-readable column names against `(cost|margin|unit_price|total_cost|price_history|gp_pct)`.
- `src/lib/api/with-api.ts`:
  - `withApi({public|authenticated|roles, body}, handler)`; a strict Zod parse gives 400 `invalid_request`;
  - the role gate reads the token claim;
  - it has **no route-params support**: it returns `(request) => …`.
- `src/lib/api/errors.ts`: the `ErrorCode` union, `ApiError`, `errorResponse`.
- `tests/helpers/fake-supabase.ts` supports only `from().select().eq().maybeSingle()`. Tests in `tests/app/api/routes.test.ts`.
- `src/lib/{i18n,money,time,env,supabase}`. There is no `src/lib/units`, no `src/server/` and no `(owner)` route group yet.
- `eslint.config.mjs`: the dynamic-import selector `/(supabase\/|^\.\/)admin(\.ts)?$/` misses `../admin` and `.js`.
- `e2e/helpers/mailbox.ts:40` puts the whole email `Text` into the thrown error.
- `src/app/api/auth/magic-link/route.ts` warns unless the error code is in `UNKNOWN_ADDRESS_CODES`. Only a mocked unit test checks which code real GoTrue returns.
- `e2e/magic-link.spec.ts` creates tenants with random `IT` + 11-digit VATs, and `scripts/lib/create-tenant.ts` uses the regex only.

## 3. Design
**Components**
- `src/lib/units/`:
  - `units.ts`: `MEASURE_UNITS = kg,g,l,ml,pz`; `BASE_UNITS = kg,l,pz`; `dimensionOf` (mass, volume, count).
  - `convert.ts`:
    - `convert(qty, from, to)`;
    - `toBase(qty, unit, packSpec?) → {qty, unit: BaseUnit}`, where `unit` is a measure unit or `"conf"` (one purchase pack), and `PackSpec = {count, size, unit}` (1 cassa = `count` 6 × `size` 1 `unit` kg);
    - `toIngredientBase(qty, unit, baseUnit, packSpec?)`.
    - Results are rounded half-up to 4 dp, matching `numeric(12,4)`.
    - A different dimension throws `UnitError("incompatible_units")`. A non-finite or ≤ 0 pack count or size throws `UnitError("invalid_pack")`.
  - `format.ts`: `formatQty(0.5,"kg")` → `0,5 kg` (it-IT, up to 3 decimals).
- `src/lib/vat/it-vat.ts`: `normaliseItVat` (trim, remove inner spaces, upper-case), `itVatCheckDigit(first10)`, `isValidItVat(s)`.
- **IT VAT algorithm**, on the 11 digits after `IT` (positions 1–11, left to right):
  - add digits 1, 3, 5, 7, 9 and 11 as they are;
  - double digits 2, 4, 6, 8 and 10, subtracting 9 when the result is above 9, and add those;
  - the number is valid when the total ≡ 0 (mod 10). Equivalently, the check digit = (10 − (sum of positions 1–10) mod 10) mod 10.
  - Source: the secondary reference [pasqualepillitteri.it](https://pasqualepillitteri.it/en/tools/verifica-partita-iva). No Agenzia delle Entrate text was found, so the vectors below are the contract.
  - Test vectors. Valid: `IT00000000000`, `IT12345678903`, `IT01234567897`, `IT11111111115`, `IT99999999990`, and ` it 1234567890 3 ` (normalised). Invalid checksum: `IT12345678901`, `IT00000000001`, `IT01234567890`. Invalid format: `IT1234567890` (10 digits), `IT123456789012`, `12345678903` (no prefix), `FR12345678903`, `IT1234567890A`.
  - The tenant fixture `IT00000000000` passes. Tenant VATs are **not** checksum-checked in M1, so `002`'s `IT00000000001` and the random E2E VATs keep working (V3 changes that).
- `src/server/master/`:
  - `{locations,ingredients,suppliers,supplier-items,import}.ts`: services that use the user's Supabase client, so RLS applies;
  - `db-errors.ts`: `mapDbError(err)`:
    - `23505` with the constraint `supplier_tenant_vat_uq` → 409 `duplicate_vat_number`;
    - `*_name_uq` → 409 `duplicate_name`;
    - `supplier_item_code_uq` → 409 `duplicate_supplier_code`;
    - `supplier_item_preferred_uq` → 409 `preferred_conflict`;
    - any other `23505` → 409 `conflict`;
    - `23503` → 422 `invalid_reference`;
    - `23514` or `incompatible_units` → 422;
    - the import exceptions `ambiguous_match` and `base_unit_conflict` → 422 `import_invalid` with `details`;
    - `42501` → 403 `forbidden`;
    - anything else is rethrown (500).
- **Rule for every endpoint:** a shape or type error, or an unknown key, gives 400 `invalid_request` (`withApi`). A domain rule (VAT checksum, pack > 0, unit compatibility) gives **422**, raised by the service.
- `src/lib/csv/parse.ts`: `parseCsv(text) → string[][]`, hand-written RFC 4180 subset (§4):
  - BOM stripped; CRLF and LF;
  - the delimiter (`;` or `,`) is detected from the header line;
  - fields in `"…"` with `""` escapes and embedded newlines;
  - an unterminated quote throws `CsvError(line)`.
- `src/lib/api/client.ts`: `apiJson<T>(path, {method, body})`. It sets the JSON content type and returns `{ok:true,data}` or `{ok:false,error}`. Components only render.
- `src/lib/api/with-api.ts` (extended):
  - option `params: z.object({id: z.uuid()})`, read from Next 16's `ctx.params` promise. An invalid id gives 404 `not_found`, so it says nothing about whether the row exists.
  - `ApiError` gets an optional `details` (import row errors), serialised as `error.details`.
- **Screens** (`src/app/(owner)/anagrafiche/…`): Italian, 360 px first, `min-h-tap`, data only from `/api/*`.
  - `fornitori` (list and form) and `fornitori/[id]`, which includes the "Articoli del fornitore" list and a pack preview such as "1 cassa = 6 × 1 kg = 6 kg";
  - `ingredienti`;
  - `ubicazioni`;
  - `importa`, where a file is read in the browser and its text is POSTed as JSON.

**Data model** (migrations after `20261021120000`, one per step)
- **Common columns:**
  - `id uuid pk default gen_random_uuid()`;
  - `tenant_id uuid not null default app.tenant_id() references tenant(id)`, with `unique (tenant_id, id)` as the composite FK target; it also serves as the tenant index;
  - `created_at timestamptz not null default now()`;
  - `created_by uuid default app.app_user_id() references app_user(id)` (null only for script inserts);
  - `is_active boolean not null default true`.
- **New SQL helpers:**
  - `app.app_user_id()`: SECURITY DEFINER, active row, same lookup as `app.tenant_id()`;
  - `app.normalise_name(text)` (immutable): lower-case, trim, collapse whitespace;
  - `app.is_valid_it_vat(text)` (immutable, same algorithm and vectors as TS);
  - `app.unit_dimension(measure_unit)`.
- **New types:**
  - `measure_unit` enum: `kg,g,l,ml,pz`;
  - `base_unit` enum: `kg,l,pz`;
  - `allergen` enum: the 14 EU Reg. 1169/2011 Annex II groups `glutine, crostacei, uova, pesce, arachidi, soia, latte, frutta_a_guscio, sedano, senape, sesamo, solfiti, lupini, molluschi`.
- **`location`:** `name` (1–80 chars). Unique index `location_name_uq (tenant_id, app.normalise_name(name))`.
- **`ingredient`:**
  - `name` (1–120 chars), with unique index `ingredient_name_uq` (normalised);
  - `base_unit base_unit not null`, **not updatable**: changing the unit would corrupt later ledgers, so the user makes a new ingredient instead;
  - `category text null` (≤ 60), `is_stock bool default true`, `allergens allergen[] default '{}'`, `default_shelf_life_days smallint null > 0`;
  - reorder columns: `min_level`, `target_level numeric(12,4) null ≥ 0` (check target ≥ min), `is_critical bool default false`.
- **`supplier`:**
  - `name` (1–200 chars, not unique);
  - `vat_number text null`, check `vat_number is null or app.is_valid_it_vat(vat_number)`, with unique `supplier_tenant_vat_uq (tenant_id, vat_number)`;
  - `payment_terms_days smallint null 0–365`;
  - reorder columns: `lead_time_days smallint null 0–365`, `delivery_weekdays smallint[] not null default '{}'` (check `<@ '{1..7}'`, ISO weekdays), `order_cutoff_time time null` (Europe/Rome wall time).
- **`supplier_item`** (cost table):
  - `supplier_id` and `ingredient_id`, with **composite FKs** `(tenant_id, supplier_id) → supplier(tenant_id, id)` and `(tenant_id, ingredient_id) → ingredient(tenant_id, id)`, because FK checks bypass RLS;
  - `supplier_code text null` (1–64), `description_hash text null ~ '^[0-9a-f]{64}$'` (M4), with check that at least one is set;
  - `pack_count numeric(12,4) not null default 1 > 0`, `pack_qty numeric(12,4) not null > 0`, `pack_unit measure_unit not null`, `pack_label text null` (≤ 30, e.g. "cassa");
  - `last_price numeric(12,4) null`, which no API role can insert or update (M5 procedure);
  - `is_preferred bool default false`;
  - unique indexes `supplier_item_code_uq (tenant_id, supplier_id, supplier_code)` and `(tenant_id, supplier_id, description_hash)`, plus partial unique `supplier_item_preferred_uq (tenant_id, ingredient_id) where is_preferred and is_active`;
  - trigger `supplier_item_units_ck`: the dimension of `pack_unit` must equal the ingredient's `base_unit` dimension, otherwise it raises `incompatible_units` (SQLSTATE 22023).
- **Grants and policies** (M0 pattern):
  - `revoke all … from anon, authenticated`;
  - `revoke delete, truncate … from service_role`;
  - `grant select` plus column-listed `insert`/`update` to `authenticated`, never including `id, tenant_id, created_at, created_by`, `ingredient.base_unit` (update), `supplier_item.supplier_id` (update) or `last_price`;
  - policies `*_select`: tenant match and role in (owner, admin, chef). For `supplier_item`: (owner, admin) only;
  - `*_insert` and `*_update`: tenant match and role in (owner, admin), with the same `with check`;
  - the waiter matches no policy on any of the four tables.
- **Functions** (SECURITY INVOKER, so RLS applies; each one transaction; execute only for `authenticated`):
  - `set_preferred_supplier_item(item_id)` unsets the ingredient's other preferred items and sets this one;
  - `import_suppliers(rows jsonb)` and `import_ingredients(rows jsonb)` return `{created, updated, unchanged}`;
  - **matching:** a supplier row with a VAT matches only on VAT. A row without a VAT matches on the normalised name among suppliers that have no VAT; more than one match raises `ambiguous_match`. Ingredients match on normalised name. An existing ingredient with a different `base_unit` raises `base_unit_conflict`.
  - Fields are compared with `is distinct from`, so re-importing the same file gives `{0, 0, n}`.

**API** (`roles`: W = owner, admin; R = owner, admin, chef; responses camelCase; lists sorted by name, capped at `MAX_LIST_ROWS` = 1000, filter `?active=true|false|all`, default true)

| Endpoint | Roles | Body (strict) | Success | Errors |
|---|---|---|---|---|
| `GET /api/locations`, `GET /api/locations/:id` | R | — | 200 `{locations:[{id,name,isActive}]}` / `{location}` | 401, 403, 404 |
| `POST /api/locations`, `PATCH /api/locations/:id` | W | `{name}` / `{name?, isActive?}` (≥ 1 key) | 201 / 200 | 400, 403, 404, 409 `duplicate_name` |
| `GET /api/ingredients[/:id]` | R | — | `{id,name,baseUnit,category,isStock,allergens,defaultShelfLifeDays,isActive}` | 401, 403, 404 |
| `POST /api/ingredients`, `PATCH …/:id` | W | `{name, baseUnit, category?, isStock?, allergens?, defaultShelfLifeDays?}`; PATCH the same without `baseUnit`, plus `isActive` | 201 / 200 | 400 (incl. `baseUnit` on PATCH), 409 `duplicate_name` |
| `GET /api/suppliers[/:id]` | R | — | `{id,name,vatNumber,paymentTermsDays,isActive}` | 401, 403, 404 |
| `POST /api/suppliers`, `PATCH …/:id` | W | `{name, vatNumber?: string\|null, paymentTermsDays?}` (+ `isActive` on PATCH) | 201 / 200 | 400, **422 `invalid_vat_number`**, **409 `duplicate_vat_number`** |
| `GET /api/supplier-items?supplierId=&ingredientId=` | W | — | `{items:[{id,supplierId,ingredientId,supplierCode,packCount,packQty,packUnit,packLabel,baseQtyPerPack,isPreferred,isActive}]}` (no `lastPrice` in M1) | 403 for chef/waiter |
| `POST /api/supplier-items`, `PATCH …/:id` | W | `{supplierId, ingredientId, supplierCode, packCount?, packQty, packUnit, packLabel?, isPreferred?}`; PATCH has no `supplierId`, plus `isActive` | 201 / 200 | 400, **422 `invalid_pack`**, 422 `incompatible_units`, 422 `invalid_reference`, 409 `duplicate_supplier_code` |
| `POST /api/admin/import/{suppliers,ingredients}` | W | `{format:"csv", csv: string ≤ MAX_IMPORT_CHARS}` or `{format:"json", rows:[…] ≤ MAX_IMPORT_ROWS}` | 200 `{created,updated,unchanged}` | 400, 413 `payload_too_large` (Content-Length check first), 422 `import_invalid` with `details:[{row,field,code}]` (≤ 50, **nothing written**) |

- Constants: `MAX_IMPORT_ROWS` = 1000 and `MAX_IMPORT_CHARS` = 512 000.
- CSV headers are Italian:
  - suppliers: `nome;partita_iva;giorni_pagamento`;
  - ingredients: `nome;unita_base;categoria;a_magazzino(si/no);allergeni(a|b);giorni_conservazione`.
- No DELETE handler is exported, so Next answers 405.
- New `ErrorCode`s: `conflict, duplicate_vat_number, duplicate_name, duplicate_supplier_code, preferred_conflict, invalid_vat_number, invalid_pack, incompatible_units, invalid_reference, import_invalid, payload_too_large`.

**Flows**
- **Create supplier:** screen → `apiJson POST /api/suppliers` → `withApi`: JSON check, role from claim, strict body → `suppliers.create`: `normaliseItVat`, `isValidItVat` (422 if invalid) → insert through RLS → `mapDbError` (409) → 201.
- **Supplier item:** the service loads the ingredient (RLS) → `toIngredientBase(1, "conf", baseUnit, pack)`, where a `UnitError` gives 422 → insert, with the SQL trigger as a backstop → the response carries `baseQtyPerPack`.
- **Import:** `parseCsv` → map the Italian headers → Zod per row, plus VAT, unit and allergen checks. On any error: 422 with details and no RPC call. Otherwise RPC `import_*` (one transaction) → counts. Logs carry counts only, never row contents.

## 4. Alternatives considered
- **`papaparse` (MIT) for CSV:** rejected. The input is our own small template, and a ~60-line parser with tests for quotes, BOM, `;` and embedded newlines covers it without a runtime dependency. Revisit if real Excel exports break it (Q5).
- **Multipart CSV upload:** rejected. It would break the JSON-only CSRF rule in `withApi`. The browser sends the file text inside JSON instead.
- **Single-column FKs relying on RLS:** rejected. FK checks bypass RLS, so tenant A could reference tenant B's ingredient id. Composite `(tenant_id, id)` FKs block that.
- **A `unit` lookup table:** rejected. The units are fixed by the PRD, and a table would need `tenant_id` and RLS for no gain. Enums are used instead.
- **VAT checksum in TypeScript only:** rejected. Imports and scripts would bypass it. The DB check is the backstop, and both are tested on the same vectors.
- **Pack size on `ingredient`:** rejected. PRD 2.1 puts packs on the supplier item.
- **`deleted_at` soft delete or a DELETE endpoint:** rejected. Plan §3.6 rule 5 allows deactivation through `is_active` only.
- **Making supplier names unique:** rejected. Two real suppliers can share a trading name. VAT is the key, and the name is used only for suppliers without a VAT.

## 5. Build plan (test first; one commit per step; `tdd-guide` follows the order)
| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| 1 | Chainable fake client (`from/insert/update/select/eq/order/limit/single/maybeSingle/rpc`, scripted results). `withApi` gets the `params` option and passes the Next 16 route context; `ApiError.details`; new `ErrorCode`s | `tests/helpers/fake-supabase.ts`, `src/lib/api/{with-api,errors}.ts` | `tests/lib/api/with-api.test.ts`: `params` `{id:"x"}` → 404 `not_found`, handler not called; a valid uuid reaches `ctx.params.id`; `details` serialised under `error.details`; existing M0 cases still pass |
| 2 | Units library | `src/lib/units/{units,convert,format,index}.ts` | `tests/lib/units/convert.test.ts` (**AT1**): `toBase(1,"conf",{count:6,size:1,unit:"kg"})` = `{6,"kg"}`; `toBase(500,"g")` = `{0.5,"kg"}`; `convert(1,"kg","pz")` throws `incompatible_units`; 250 ml → 0.25 l; 2 conf of 12 × 500 g → 12 kg; `toIngredientBase(1,"conf","pz",{6,1,"kg"})` → `incompatible_units`; pack count/size 0, −1, NaN → `invalid_pack`; 0.1 g → 0.0001 kg (4 dp half-up). `tests/lib/units/format.test.ts`: `0,5 kg`, `1.234,5 kg`, `3 pz` |
| 3 | IT VAT library | `src/lib/vat/it-vat.ts` | `tests/lib/vat/it-vat.test.ts`: every vector in §3 (valid, bad checksum, bad format, normalisation); `itVatCheckDigit("1234567890")` = 3 |
| 4 | Migration: enums, `app.app_user_id`, `app.normalise_name`, `app.is_valid_it_vat`, `app.unit_dimension` | `supabase/migrations/<ts>_master_types.sql` | `supabase/tests/database/006_master_functions.test.sql`: the same VAT vectors through `app.is_valid_it_vat`; `normalise_name('  Pomodoro   San ')` = `pomodoro san`; `app_user_id()` is the caller's id when active and null when deactivated; `has_function_privilege` is false for anon |
| 5 | Migration: `location`, `ingredient` (RLS, column grants, unique names, reorder columns); `004` fixture rows | `<ts>_location_ingredient.sql`, `004_waiter_cost_columns.test.sql`, `007_master_roles.test.sql` | `007` (part 1, two tenants): owner and admin insert, update and read; chef reads and gets 42501 on insert and update; waiter reads 0 rows and gets 42501 on insert; owner A reads 0 rows of tenant B; DELETE → 42501; inserting `tenant_id` or `created_by` → 42501; `update ingredient set base_unit` → 42501; `created_by` = caller; `'Manzo'` vs `' manzo'` → 23505. `004` passes with the new fixtures |
| 6 | Migration: `supplier`, `supplier_item` (composite FKs, unit trigger, preferred index, `set_preferred_supplier_item`); `004` fixture rows and regex extended with `last_price` | `<ts>_supplier.sql`, `004_…`, `007_…`, `008_master_constraints.test.sql` | `007` part 2 (**AT4**): waiter sees 0 rows of `supplier` and `supplier_item` (fixture rows exist); chef reads `supplier` and `ingredient` but 0 rows of `supplier_item`, and gets 42501 on insert into it; `update … set last_price` → 42501 for owner. `008` (**AT2/AT3 DB half**): VAT `IT12345678901` → 23514; same VAT twice in one tenant → 23505 and in two tenants → ok; `pack_qty` 0 and −1 → 23514; kg pack on a `pz` ingredient → `incompatible_units`; `ingredient_id` of tenant B → 23503; a second preferred item → 23505; `set_preferred_supplier_item` swaps in one call |
| 7 | `mapDbError` + locations service and routes | `src/server/master/{db-errors,locations}.ts`, `src/app/api/locations/{route.ts,[id]/route.ts}` | `tests/server/master/db-errors.test.ts`: each mapping in §3, including the `conflict` fallback and `ambiguous_match` → 422 `import_invalid`. `tests/app/api/master/locations.test.ts`: role table (owner/admin write 201/200; chef GET 200, POST 403; waiter GET 403; no session 401); strict body (`tenantId` extra → 400); empty PATCH → 400; 23505 → 409; DELETE not exported |
| 8 | Ingredients service and routes | `src/server/master/ingredients.ts`, `src/app/api/ingredients/{route.ts,[id]/route.ts}` | `tests/app/api/master/ingredients.test.ts`: role table as in step 7; strict body (`createdBy` → 400; `baseUnit` on PATCH → 400); unknown allergen → 400; deactivate via `isActive:false` → 200 and `?active=false` lists it |
| 9 | Suppliers service and routes | `src/server/master/suppliers.ts`, `src/app/api/suppliers/{route.ts,[id]/route.ts}` | `tests/app/api/master/suppliers.test.ts` (**AT2**): `IT12345678901` and `IT1234567890` → 422 `invalid_vat_number`, insert not called; `" it12345678903"` stored as `IT12345678903`; 23505 on `supplier_tenant_vat_uq` → 409 `duplicate_vat_number`; `vatNumber:null` → 201; role table; strict body (`tenantId` → 400) |
| 10 | Supplier-items service and routes (incl. preferred through the RPC) | `src/server/master/supplier-items.ts`, `src/app/api/supplier-items/{route.ts,[id]/route.ts}` | `tests/app/api/master/supplier-items.test.ts` (**AT3**): `packQty` 0 and −2 → 422 `invalid_pack`; `packCount` 0 → 422; kg pack on a `pz` ingredient → 422 `incompatible_units`; `baseQtyPerPack` 6 for 6 × 1 kg; chef and waiter → 403 on GET and POST; strict body (`lastPrice` → 400); `isPreferred:true` calls `set_preferred_supplier_item` |
| 11 | CSV parser | `src/lib/csv/parse.ts` | `tests/lib/csv/parse.test.ts`: `;` and `,` detection; quoted delimiter; `""` escape; embedded newline; BOM; CRLF; trailing empty line ignored; unterminated quote → `CsvError` with the line number |
| 12 | Import RPCs + service + routes | `<ts>_master_import.sql`, `src/server/master/import.ts`, `src/app/api/admin/import/{suppliers,ingredients}/route.ts`, `009_master_import.test.sql`, `tests/fixtures/import/{fornitori,ingredienti}-demo.csv` | `009` (**AT5 DB half**): first import → created n; same rows again → `{0,0,n}`; one changed field → updated 1; VAT-less row matches by name; two VAT-less namesakes → `ambiguous_match` and nothing written; different `base_unit` → `base_unit_conflict`; chef → 42501. `tests/server/master/import.test.ts` (**AT5**): fixture CSV → RPC rows mapped from Italian headers; a bad VAT on row 3 → 422 `import_invalid` with `details[0]={row:3,field:"partita_iva",code:"invalid_vat_number"}` and no RPC call; duplicate VAT in the file → `duplicate_in_file`; RPC raising `ambiguous_match` → 422 `import_invalid`; > `MAX_IMPORT_ROWS` → 400; Content-Length > limit → 413; role table and strict body for both routes |
| 13 | `apiJson` client, `(owner)` layout with nav, `ubicazioni` and `ingredienti` screens, it/en keys | `src/lib/api/client.ts`, `src/app/(owner)/layout.tsx`, `src/app/(owner)/anagrafiche/{ubicazioni,ingredienti}/page.tsx`, `src/lib/i18n/messages/{it,en}.ts`, `e2e/helpers/session.ts` (moves `signInWithMagicLink`, `fakeVat` and owner creation out of `magic-link.spec.ts`) | `tests/lib/api/client.test.ts` (fetch mocked): JSON header sent; the error body is passed through. `tests/lib/i18n.test.ts` key parity (existing). `e2e/master-data.spec.ts` part 1 at 360×740: create location and ingredient; a duplicate name shows the Italian 409 message; deactivate hides it from the default list; every button and input ≥ 44 px; `scrollWidth ≤ clientWidth` |
| 14 | `fornitori` list, form and detail with supplier items and pack preview | `src/app/(owner)/anagrafiche/fornitori/{page.tsx,[id]/page.tsx}` | `e2e/master-data.spec.ts` part 2 (real stack): VAT `IT12345678901` → inline 422 message; `IT12345678903` saved; the same VAT again → 409 message (proves the constraint-name mapping on real PostgREST); item 6 × 1 kg "cassa" shows `1 cassa = 6 kg`; `packQty` 0 → message; 44 px and no horizontal scroll |
| 15 | `importa` screen | `src/app/(owner)/anagrafiche/importa/page.tsx` | `e2e/master-import.spec.ts` (**AT5 E2E**): upload `fornitori-demo.csv` → "3 creati"; upload again → "0 creati, 0 aggiornati, 3 invariati"; then `GET /api/suppliers` has 3 rows |
| 16 | M0 follow-ups: (a) the lint dynamic-import selector and the static regex also cover `../admin` and `.js`; (b) `classifyOtpError(error)` moved to `src/lib/auth/otp-error.ts` and used by the magic-link route; a real-GoTrue smoke test; (c) the mailbox error no longer contains the mail text | `eslint.config.mjs`, `src/lib/auth/otp-error.ts`, `src/app/api/auth/magic-link/route.ts`, `e2e/magic-link-unknown.spec.ts`, `e2e/helpers/mailbox.ts` | (a) `tests/lint/admin-client-import.test.ts`: `import("../admin")` in `src/lib/supabase/x/y.ts`, `import("@/lib/supabase/admin.js")` and static `"./admin.js"` → errors. (b) `tests/lib/auth/otp-error.test.ts` (each class); `routes.test.ts` unchanged and green; `e2e/magic-link-unknown.spec.ts`: real local `signInWithOtp` for an unknown address with `shouldCreateUser:false` → `classifyOtpError` ≠ `"warn"`. (c) `tests/e2e-helpers/mailbox.test.ts` (fetch mocked, mail without a link): the thrown message contains the message ID but not the mail text |

**Acceptance tests → proof**
| AT | Files | Command |
|---|---|---|
| 1 toBase / incompatible | `tests/lib/units/convert.test.ts` | `npm test` |
| 2 VAT 422 / duplicate 409 | `tests/lib/vat/it-vat.test.ts`, `tests/app/api/master/suppliers.test.ts`, `supabase/tests/database/008_master_constraints.test.sql`, `e2e/master-data.spec.ts` | `npm test`; `npx supabase test db`; `npx playwright test` |
| 3 pack_qty ≤ 0 → 422 | `tests/app/api/master/supplier-items.test.ts`, `008_master_constraints.test.sql` | `npm test`; `npx supabase test db` |
| 4 waiter/chef access | `supabase/tests/database/007_master_roles.test.sql` (+ `004` extended) | `npx supabase test db` (CI job `supabase`) |
| 5 idempotent import | `tests/lib/csv/parse.test.ts`, `tests/server/master/import.test.ts`, `009_master_import.test.sql`, `e2e/master-import.spec.ts` | `npm test`; `npx supabase test db`; `npx playwright test` |

### 5b. Variants
**V1 — Bare 11-digit VAT accepted** · Trigger: Q1 = yes · Replaces steps: none (adds to 3, 9, 12)
| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | `normaliseItVat` prefixes `IT` when the input is exactly 11 digits; the API and import use it | `src/lib/vat/it-vat.ts` | `tests/lib/vat/it-vat.test.ts`: `12345678903` → `IT12345678903` (valid); `12345678901` → invalid checksum; `tests/server/master/import.test.ts`: a CSV row `12345678903` stored with `IT` |

**V2 — Non-Italian EU VAT numbers** · Trigger: Q2 = foreign suppliers must carry their VAT · Replaces steps: none (adds to 4, 6, 9)
| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V2.1 | `isValidSupplierVat`: `IT` → checksum; other EU prefixes → format `^[A-Z]{2}[0-9A-Z]{2,12}$` only; SQL check updated to match | `src/lib/vat/supplier-vat.ts`, `<ts>_supplier_vat_eu.sql` | `tests/lib/vat/supplier-vat.test.ts`: `ATU12345678` valid, `IT12345678901` invalid, `XX1` invalid; `008`: `ATU12345678` inserts, `IT12345678901` → 23514 |

**V3 — Checksum on the tenant VAT too** · Trigger: Q3 = yes · Replaces steps: none (adds after 13, which creates `e2e/helpers/session.ts`)
| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V3.1 | `tenant.vat_number` check uses `app.is_valid_it_vat`; `create-tenant` args use `isValidItVat`; the E2E `fakeVat` computes the check digit; `002` tenant B becomes `IT11111111115` | `<ts>_tenant_vat_checksum.sql`, `scripts/lib/create-tenant.ts`, `e2e/helpers/session.ts`, `002_cross_tenant.test.sql` | `005_create_tenant.test.sql`: `IT00000000001` → 23514; `tests/scripts/create-tenant.test.ts`: `--vat IT12345678901` → exit 1 with a named error, and 100 values from `fakeVat()` all pass `isValidItVat`; `002` green with the new tenant B VAT |

**V4 — Chef sees supplier names and delivery settings only** · Trigger: Q4 = VAT and payment terms hidden from chef · Replaces steps: none (adds after 9)
| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V4.1 | Chef removed from `supplier_select`. View `supplier_directory` (id, name, delivery columns, is_active), filtered on `app.tenant_id()` and role in (owner, admin, chef), owned by the migration role and granted select to `authenticated` | `<ts>_supplier_directory.sql`, `007_master_roles.test.sql` | `007`: chef reads 0 rows of `supplier` and n rows of `supplier_directory`, whose columns exclude `vat_number` and `payment_terms_days`; waiter reads 0 rows of the view; `001` still passes |
| V4.2 | `GET /api/suppliers` reads the view for chef | `src/server/master/suppliers.ts` | `tests/app/api/master/suppliers.test.ts`: chef GET → items without `vatNumber` and `paymentTermsDays`; owner GET unchanged |

## 6. Risks and mitigations
- **Security / privacy:**
  - *Cross-tenant references:* composite FKs, tested in `008`.
  - *Role leakage:* RLS plus column grants, tested in `007`. The `withApi` gate reads the claim while RLS reads the row, so a stale claim gets at most an empty result or 42501 → 403.
  - *Mass assignment:* strict bodies (step 7–12 tests inject `tenantId`, `createdBy`, `lastPrice`) plus column grants that exclude those columns.
  - *Cost exposure:* `supplier_item` is owner/admin only. `004`'s regex gains `last_price`, which it did not catch before.
  - *Import abuse:* row and size limits, 413, one transaction. CSV cells are stored as text and rendered escaped. Formula escaping on export is M24.
  - *Personal data:* sole-trader supplier names and VATs can be personal data (plan Q13). There is no delete path, only deactivation; retention per plan Q13/Q14. Logs carry ids and counts only.
  - *Secrets:* **no new secrets or env vars in M1**. Everything runs on the user's session through RLS, and the secret key is not used.
- **Correctness:**
  - Float error in `toBase`: 4-dp rounding and explicit tests.
  - Ingredient `base_unit` is immutable (column grant) so later ledgers stay consistent.
- **Unverified:**
  - The constraint name in PostgREST's 23505 `message`/`details`: `mapDbError` falls back to 409 `conflict` and step 14's E2E proves it on the real stack.
  - The Next 16 route-context type for `params`: checked by `npm run build` at step 1.
- **Performance / cost:** small lists (cap 1000, indexed by `(tenant_id, normalised name)`). No figures promised.
- **Dependencies:** none added (CSV hand-written, §4).

## 7. Open questions for the founder
- **Q1** Should a VAT typed without `IT` (11 digits) be accepted and prefixed? Until then it is rejected with a hint (→ V1).
- **Q2** Are there foreign suppliers? Until answered they are stored with no VAT and matched by name (→ V2).
- **Q3** Should the tenant VAT also be checksum-checked? This changes fixtures and the E2E generator (→ V3).
- **Q4** Plan §3.11.2 gives the chef "names, delivery settings". Should the chef also see supplier VAT and payment terms? The base plan shows the full row (→ V4).
- **Q5** Is our CSV template (Italian headers, `;`, allergens separated by `|`) fine, or will you import an existing spreadsheet? If so, please share an anonymised sample.
- **Assumptions (confirm):**
  - supplier VAT is optional;
  - allergens are the 14 EU groups;
  - ingredient category is free text;
  - one preferred supplier item per ingredient;
  - M1 manual supplier items need a supplier code (description-based items come with M4);
  - owner and admin may both import;
  - reorder columns are not exposed by the API until M16.
