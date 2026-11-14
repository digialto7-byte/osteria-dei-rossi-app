# Tech plan: Osteria Dei Rossi app · DS-BQ-2, the order session gains its opener and coperto

- **Status:** draft for the lead · **Author:** architect · **Date:** 2026-11-14
- **Branch:** `feat/ds-bq2-order-session-opener-coperto`, cut from `origin/main` f7c794d6.
  - **Precondition:** merge `origin/main` with BQ-1 (#121) before step 1 (see "Base" below).
  - One `/feature` run, one draft PR.
- **Item:** DS-BQ-2, from the backend queue of the direct comanda (`docs/ux/p3-sala-waiter.md` §10, merged in #116).
- **Lead's assignment:** "orderSession gains the opener (display name only) and the coperto. Waiters may see both; the coperto is a sale
  price, not a cost; if the cost-key tests disagree, tell the lead."
  - **They disagree.** Three guards would fail on `coperto.vatRate` (§2).
  - The lead's leaning is a narrow exception pinned by exact key path. This plan recommends it: option (a), Q-D1. Option (b), which
    omits `vatRate`, is Variant V1.
- **Base:** BQ-1 (#121) was merged to main while this plan was written. It brings migration `20261205100000` and pgTAP 367.
  - This architect run has no shell. It could not run `git merge origin/main`, and the worktree (f7c794d6) does not contain BQ-1's files.
  - So **BQ-1's plan and pgTAP 367 were not read.** The format follows `templates/tech-plan.md` and the merged
    `docs/plans/2026-11-14-ux-p3-sala.md`.
  - Everything below that depends on BQ-1 is marked **[after merge]**. The builder checks it after merging (R3).

## 0. Summary

`public.order_view` is the RPC behind `GET /api/table-sessions/:id/lines`. It gains four session keys:
- `openedAt` and `openedToday`, the same values as on the tile;
- `openedBy: { displayName }`, with no id;
- `coperto: { perPerson, vatRate, total } | null`, the tile's coperto.

The values come from the existing helper `app.table_session_json`, so the order read and the tile cannot drift.

Zod `orderSession` gains the same keys. It reuses the tile's coperto schema, which is exported for that.

The coperto's `vatRate` is a sale fact. Each of the three cost-key guards gets **one exemption for the exact path
`session.coperto.vatRate` on the order read, and nothing else**:
- the Vitest route guard;
- the Vitest schema guard;
- pgTAP 326.

Every other key that matches the cost pattern stays forbidden on that route. New tests prove that an injected cost key elsewhere on the
same route still fails, and so does a second `vatRate` at another path.

The offline overlay's stub for a session opened offline becomes an explicit `source: "queued"` variant. It carries only what the phone
really knows.

Scope:
- one migration (`20261206100000`) and one new pgTAP file (368);
- the re-pins listed in §3.4, in five commits;
- no new dependency, no new secret, no new route, no UI change. The UX builder wires the header later (§8).

## 1. Goal and scope

**Goal:** the comanda's header can show the meta line from the order API alone. It uses the same helpers as the panel:
`coversLine`, `openedLine` and `copertoLine` (`docs/ux/p3-sala-waiter.md` §10.2 line 200, §10.3 line 230).

**In scope**
- The SQL read `public.order_view`: four new session keys.
- The strict Zod schema `orderSession` and the type `OrderView`.
- The three cost-key guards: exact-path exemptions and their negative tests.
- The fixtures and tests that build or pin an order view: unit, route, guard, snapshot, integration, pgTAP and the migration pins.
- The offline overlay `src/lib/sync/overlay.ts`, whose stub must stay type-correct and honest.

**Out of scope**
- The header markup, its copy and its e2e test. These belong to the UX builder (§8).
- `/api/tables` and `tables_list`. They are unchanged, and the tile's exemption stays as it is.
- The tile overlay's stub defaults (`src/lib/sync/overlay-tables.ts:26-30`). R6 reports them; this item does not change them.
- The write replies (`add_order_line`, `fire_course`, …). They carry lines, not the session.
- An ADR. This is a payload extension under existing decisions (ADR-016/017, plan §3.6). The Q-D1 decision is recorded in this plan,
  in the guard comments and in the PR.

## 2. Current state

| What | Where | Fact |
|---|---|---|
| Order read RPC | `supabase/migrations/20261101100500_order_view.sql:9-45` | `public.order_view(p_session uuid)`: plpgsql, `stable`, `security definer`, `search_path = ''`. Role gate `app.require_table_operator()`: owner, admin and waiter pass; the chef gets 42501 (`20261031100100_menu_tables_helpers.sql:24-34`). The tenant comes from `app.tenant_id()`; another tenant's session gives P0002. Session keys today: `id, tableId, tableName, covers, status, billRequested, closed`. **No `openedAt`, no opener, no coperto.** Never replaced on f7c794d6. Only `authenticated` has the grant (`:44-45`). Checked after the merge (0f62deec): BQ-1 does not replace it |
| Tile read | `supabase/migrations/20261124100650_reservation_joined_tables.sql:130-194` (`create or replace public.tables_list`) | Waiter: `{id: u.id, displayName: u.display_name}` (`:167`), joined on `app_user` by `(tenant_id, opened_by)` (`:179`). Coperto: `null` when `coperto_amount is null`; otherwise `{perPerson: trim_scale(coperto_amount), vatRate: trim_scale(coperto_vat_rate), total: trim_scale(coperto_total)}` (`:169-172`). `openedToday`: `h.business_date = app.business_date(v_tenant, clock_timestamp())` (`:144`, `:166`). Checked after the merge (0f62deec): BQ-1's `20261205100000_tables_unsent_count.sql` replaces `tables_list` and keeps the waiter (`:62`) and coperto (`:66`) expressions unchanged |
| Shared session helper | `supabase/migrations/20261031100500_table_sessions.sql:13-40` `app.table_session_json(p_tenant, p_id, p_with_status)` | Builds `openedAt`, `waiter {id, displayName}` and `coperto {perPerson, vatRate, total}` with **the same expressions** as `tables_list` (`:24-31`). Used by `open_table` and `update_table_session`. Revoked from every API role (`:40`) |
| Coperto total | `supabase/migrations/20261031100000_menu_tables_core.sql:116-118` | `coperto_amount` and `coperto_vat_rate` are frozen at opening. `coperto_total` is `generated always as (covers * coperto_amount) stored`, so **total = covers × perPerson**, computed by Postgres |
| Bill precedent | `supabase/migrations/20261130100400_weight_reads.sql:60` | The waiter's bill shows the coperto as `{perPerson, covers, amount}` |
| Zod | `src/server/orders/output.ts:37-45` | `orderSession` is a `z.strictObject` with the seven keys. The header comment (`:6-9`) promises "no VAT, cost, margin, GP, food cost or recipe key anywhere". The service `src/server/orders/view.ts:6-10` parses every reply, so an unknown key gives a 500 |
| Tile Zod | `src/server/tables/output.ts:21-22, 43-51, 98` | `waiter = {id, displayName}`, `coperto = {perPerson, vatRate, total}` (a module-private `const`), `coperto.nullable()`. `SessionCoperto` is the type `copertoLine` takes |
| Route | `src/app/api/table-sessions/[id]/lines/route.ts:12-18` | GET for owner, admin and waiter. `offlineCacheable`: a waiter's reply is stored by the service worker. It is the **only** route that returns `orderSession` (the POST returns `addLineOutput`; `/api/sync` returns op results) |
| Helpers | `src/lib/tables/table-view.ts:43-45, 70-80, 83-90` | `coversLine(covers)`, `openedLine(waiter, openedAt, openedToday)`, and `copertoLine(coperto: SessionCoperto \| null)`, which reads only `total` ("Coperto 10,00 €", `it.ts:1833`). `openedLine` renders "{waiter} · {when}" (`it.ts:1832`) |
| Consumers of `OrderView` | `src/app/(owner)/tavoli/comanda/page.tsx:74,136,167` (`apiJson<OrderView>`, no client parse); `src/lib/sync/overlay.ts:20-23` (`session: OrderView["session"]`) | The page reads `session.id/tableName/covers/status/closed` (`:168-170, 220, 443-470`) |
| Offline stub | `src/lib/sync/overlay.ts:40-53` | With no server view and a queued `open_table`, it builds `{id, tableId, tableName, covers, status: "open", billRequested: false, closed: false}` |
| Tile stub (precedent) | `src/lib/sync/overlay-tables.ts:20-31` | For a queued open: `openedAt: open.clientTs`, `openedToday: true`, `waiter: queuedBy`, `coperto: null` |
| Opener = queuer | `supabase/migrations/20261109100100_apply_op.sql:146-149` | `apply_op` refuses (42501 `user_mismatch`) an op whose `userId` is not the caller. A queued `open_table` that applies is therefore opened by the person who queued it (`OutboxOp.queuedBy`, `src/lib/sync/types.ts:25-29, 41`) |
| Offline cache | `src/lib/api/offline-cache.ts`, `public/sw.js:8-11, 24, 48` | Four cached waiter reads, including `/api/table-sessions/:id/lines`. The read cache `api-user` is **not versioned** by build. It is cleared at logout and when a new worker activates |

### Cost-key guards that see the order read

| Guard | Where | What it does | Effect of `session.coperto.vatRate` |
|---|---|---|---|
| Vitest route guard | `tests/guards/waiter-weight-no-cost.test.ts:33-39, 55-58, 149-166, 190-228` | Applies `COST_KEY = /cost\|margin\|food\|gp\|vat\|recipe/i` to the last key of every dotted path. Exempt paths are listed per route in `KNOWN_SALE_PATHS`; today the only entry is `"/api/tables": ["tables.session.coperto.vatRate"]`. Tests already prove that the exemption is the exact path, not the key name (`:201-228`) | **Fails** `GET /api/table-sessions/:id/lines as a waiter … has no key naming a cost…` |
| Vitest schema guard | `tests/server/orders/output.test.ts:23-41, 52-60` | Applies `WAITER_FORBIDDEN = /cost\|margin\|gp\|food\|eur$\|recipe\|vat/i` to every property **name** in `orderViewOutput`'s JSON Schema. It has **no allowlist**, and the walker sees names, not paths | **Fails** `orderViewOutput has no cost, margin, GP, food, EUR, recipe or VAT key` |
| pgTAP waiter scan | `supabase/tests/database/326_weight_waiter_no_cost.test.sql:47-50, 76, 90` | `pg_temp.bad_keys` walks every key (`$.**`) of the waiter's `order_view` and matches it against `cost\|margin\|food\|gp\|vat\|recipe`. The fixture session has `coperto_vat_rate = 10` (`:19-22`). It has **no allowlist** | **Fails** `order_view: no cost-like key` |
| BQ-1 pgTAP 367 | main after #121 | Read after the merge (0f62deec) | Does not reference `order_view`: no exemption and no pin to move |
| Offline cache allowlist | `tests/guards/waiter-weight-no-cost.test.ts:173-188`, `src/lib/api/offline-cache.ts` | Checks paths and roles only, not keys | None. The path list does not change |

None of the other new keys matches either pattern: `openedAt`, `openedToday`, `openedBy`, `displayName`, `coperto`, `perPerson` and
`total`.

## 3. Design

### 3.1 The SQL source

**One migration:** `supabase/migrations/20261206100000_order_view_opener_coperto.sql`. It contains
`create or replace function public.order_view(p_session uuid) returns jsonb`:
- with the same signature, language, volatility (`stable`), `security definer` and `set search_path = ''`;
- `create or replace` keeps the grants, which pgTAP 166:236-237 and 167:223-240 pin. So the migration does not restate them (precedent:
  `20261124100650:130`).

The body keeps everything it has today, in the same order, and adds four keys to `session`:

| Key | Value | Source (reuse, no copy) |
|---|---|---|
| `openedAt` | the session's `opened_at` as jsonb text | `app.table_session_json(v_tenant, s.id, false) -> 'openedAt'` |
| `openedToday` | `s.business_date = app.business_date(v_tenant, clock_timestamp())` | The same expression as `tables_list:144,166`; the helper does not have it |
| `openedBy` | `jsonb_build_object('displayName', <helper> -> 'waiter' -> 'displayName')` | The helper's `waiter.displayName` |
| `coperto` | `null` when the helper's `coperto` is JSON null; otherwise `jsonb_build_object('perPerson', c -> 'perPerson', 'vatRate', c -> 'vatRate', 'total', c -> 'total')` | The helper's `coperto`. The three keys are **picked by name** (an allowlist), so a key the helper gains later never reaches the waiter unseen |

- The helper is called once per `order_view` call, reading one row by primary key.
- The migration's header comment states:
  - the new keys;
  - that `coperto.vatRate` is a sale fact allowed at that exact path (lead decision Q-D1);
  - that the payload still carries no cost, margin, GP, food or recipe key, and no other VAT key.

**Why reuse `app.table_session_json`:** it already holds the one definition of `openedAt`, the opener's name and the coperto numbers.
Calling it makes the order read and the tile agree by construction. pgTAP 368 proves this in the test "order_view and tables_list
agree".

**Opener without the id** (the lead's "display name only", Q-D2):
- Data minimisation: the header needs a name, not a staff id.
- Nothing in `src/` reads `waiter.id`; a search for `waiter.id` finds no hit.
- A staff UUID stored in the phone's offline cache would be a stable identifier with no use there.
- It is named `openedBy`, not `waiter`, so it is never confused with the tile's `waiter {id, displayName}`.
- It stays an object, like `updatedBy` on lines.

**`openedAt` and `openedToday` are included** although the assignment names only the opener and the coperto. `openedLine` needs both,
and the meta line shows the time ("Giulia alle 20:14", §10.2:200). `orderSession` has neither today (`output.ts:37-45`). The spec
settles this (Q-D4 asks the lead to confirm).

**Roles and leakage:**
- The role gate, the tenant filter and the P0002 for a foreign session are unchanged. The waiter can call `order_view`
  (pgTAP 166:222, 167:204).
- The new keys contain only:
  - a staff display name, already shown on every tile to every waiter;
  - the coperto's sale amounts (VAT included) and its sale VAT rate, all already on the tile for the same session.
- No cost table is joined. `app_user` is joined only for `display_name`, inside the tenant.

**Migration timestamp:**
- On f7c794d6 the newest migration is `20261204100500_automap_statistics_independent.sql`. BQ-1, now on main, adds `20261205100000`.
- DS-BQ-2 takes **`20261206100000`**. It sorts after both, and it has its own day prefix, as the preserves tests expect
  (`tests/config/p2-7-preserves.test.ts:77-80`).
- With BQ-1 already merged, no ordering risk remains. If a later merge brings another `2026120[6-9]*` file first, renumber before
  merging (R4).

### 3.2 The Zod schema

In `src/server/tables/output.ts`, export the existing coperto schema (`:22`) as `sessionCoperto`. The tile schemas use it unchanged, and
`SessionCoperto` stays its type.

In `src/server/orders/output.ts`, which already imports from `@/server/tables/output`:

```
orderSession = z.strictObject({
  id, tableId, tableName, covers, status, billRequested, closed,        // unchanged
  openedAt: z.string(),                                                  // the database's text, as on tiles
  openedToday: z.boolean(),
  openedBy: z.strictObject({ displayName: z.string() }),
  coperto: sessionCoperto.nullable(),                                    // {perPerson, vatRate, total}, as on tiles
})
```

- All four keys are required. `coperto` is nullable, as on tiles: `null` means the session has no coperto.
- Export `OrderSessionOpener`.
- The order coperto's type **is** `SessionCoperto`, so `copertoLine(session.coperto)` compiles with no change to the helper.
- Header comment (`:6-9`) becomes: "… there is no cost, margin, GP, food cost or recipe key anywhere. The one VAT key is the coperto's
  sale VAT rate at `session.coperto.vatRate` (lead decision DS-BQ-2 Q-D1). The cost-key guards exempt exactly that path."

**Every consumer of the type and what happens to it**

| Consumer | Change |
|---|---|
| `src/server/orders/view.ts` | None: it parses with the new schema |
| `src/app/(owner)/tavoli/comanda/page.tsx` | None in this item. It compiles unchanged, because it reads only keys that both overlay variants keep |
| `src/lib/sync/overlay.ts` | `OverlaidOrder.session` becomes `OverlaidSession` (below) |
| `src/lib/tables/table-view.ts` | None: `copertoLine` already takes `SessionCoperto \| null` |
| Offline cache / `public/sw.js` | None: same path, same header. Old-shape cached copies are covered by R2 |
| `tests/helpers/orders-data.ts:63-74` `ORDER_VIEW` | Gains the four keys, with a coperto `{perPerson: 2.5, vatRate: 10, total: 10}`. New `ORDER_VIEW_NO_COPERTO` with `coperto: null`. Tests that spread `ORDER_VIEW` follow automatically: `tests/components/order-page.test.ts:193-195, 926-928`, the guard's `WEIGHTED_VIEW` and `offline-cache-headers.test.ts:59` |
| `tests/server/orders/__snapshots__/output.test.ts.snap` | The `orderViewOutput` JSON Schema snapshot changes on purpose. The other five snapshots must not move |

**The overlay stub (Rule B: no default that hides bad data).** In `src/lib/sync/overlay.ts`:

```
type OverlaidSession =
  | (OrderView["session"] & { source: "server" })
  | (Omit<OrderView["session"], "openedAt" | "openedToday" | "coperto"> & { source: "queued"; queuedAt: string })
```

- **Server view:** `{ ...view.session, source: "server" }`.
- **Only a queued `open_table`:** `{ id, tableId, tableName, covers, status: "open", billRequested: false, closed: false,
  openedBy: { displayName: open.queuedBy.displayName }, source: "queued", queuedAt: open.clientTs }`. The first seven keys are as they
  are today.
- **Why these keys:**
  - `covers` and the opener's name are real data: `apply_op` applies only the queuer's own ops.
  - `openedAt` is unknown. The server stamps `opened_at` with `clock_timestamp()` when the op is applied (`20261124100650:109`), not
    when the waiter tapped.
  - `openedToday` is unknown, because it follows from `openedAt`.
  - The coperto is unknown. It is frozen from `sale_settings` at apply time, and a waiter cannot read `sale_settings` (pgTAP 326:114).
  - So the queued variant has none of these three keys. `coperto: null` would claim "no coperto".
  - TypeScript forces the screen to narrow on `source` before it reads them.
  - `queuedAt` is the tap time, named for what it is.
- Mirroring the tile stub's defaults is Variant V3.

### 3.3 The guard exemptions (one exact path, three guards)

The exempt path in every guard is exactly `session.coperto.vatRate` on the order read (`GET /api/table-sessions/:id/lines`,
`public.order_view`, `orderViewOutput`).
- It is **not** a key-name exemption. A `vatRate` anywhere else in the same reply still fails.
- `perPerson` and `total` match neither pattern and need no exemption.

| Guard | Change | Must still fail (new negative tests) |
|---|---|---|
| Vitest route guard `waiter-weight-no-cost.test.ts:37-39` | `KNOWN_SALE_PATHS["/api/table-sessions/:id/lines"] = ["session.coperto.vatRate"]`. The comment explains it as the tile's: a sale fact, DS-BQ-2 Q-D1 | A second `vatRate` at `session.vatRate` or `session.coperto.nested.vatRate`. A cost key elsewhere on the same route: `session.unitCost`, `session.coperto.cost` and `lines.unitCost` are each flagged by `flagged()`, **and** a 500 comes from the strict schema |
| Vitest schema guard `output.test.ts:23-60` | Add `propertyPaths(schema)`: like `propertyNames`, but it returns dotted paths through `properties`, ignoring `anyOf`/`items` wrappers. Add `SCHEMA_SALE_PATHS = { orderViewOutput: ["session.coperto.vatRate"] }`. The forbidden test checks paths minus that schema's exempt list. The other five schemas have none | A self-test: `propertyPaths` on `orderViewOutput` finds `session.coperto.vatRate` (so the exemption is real), and a schema with `vatRate` on the line, or `session.unitCost`, is flagged. The existing line-level "refuses a line with a VAT rate" (`:113`) stays |
| pgTAP 326 `:90` | The `view` assertion scans `j #- '{session,coperto,vatRate}'`: that one path is removed and every other key at any depth is scanned. The description says so | A new test checks that the path exists in `j` before removal, so the exemption is not vacuous. New tests show that the same scan of `j` with `jsonb_set(j, '{session,vatRate}', '10')` added is flagged `{vatRate}`, and that `j` with `{session,coperto,unitCost}` added is flagged `{unitCost}`. `plan(20)` becomes `plan(23)` |

**This is a deliberate, lead-approved narrowing, not a weakened test.** Each guard keeps its full pattern, and each exemption is pinned
by an exact path and a negative test. The PR description lists the three edits under "guards changed on purpose".

### 3.4 Sequence (unchanged flow)

1. Comanda → `GET /api/table-sessions/:id/lines` → `withApi` (roles) → `getOrderView` → `rpc("order_view")` → `orderViewOutput.parse`
   → JSON (`offlineCacheable`).
2. Phone: `overlayOrder(view, ops, id)` → `{ session: OverlaidSession, lines }`.
3. Header (UX builder):
   - always: `coversLine(session.covers)`;
   - when `source === "server"`: `openedLine(session.openedBy.displayName, session.openedAt, session.openedToday)` and
     `copertoLine(session.coperto)`;
   - when `source === "queued"`: the queued wording (Q-D6).

### 3.5 Pins that move

Each moved pin gets the comment "re-pinned on purpose by DS-BQ-2".

| File:line (f7c794d6) | Kind | Today | After |
|---|---|---|---|
| `supabase/tests/database/179_m19_preserves.test.sql:37`, `:69` | md5 of `pg_get_functiondef` | `5678c095d50f989c42357f86c34793a6` | The new value, computed by the builder after step 1 |
| `supabase/tests/database/214_m20_preserves.test.sql:468` | Same | Same | Same |
| `supabase/tests/database/327_p20b_preserves.test.sql:17` | `count,md5(functiondef)` | `1,5678c095…` | `1,<new>` |
| `supabase/tests/database/222_m21_preserves.test.sql:39` | `count,md5(prosrc)` | `1,44a075d2755ea0a66cb585eb0fd401b0` | `1,<new>` |
| `supabase/tests/database/229_m19b_preserves.test.sql:36` | Same | Same | Same |
| `supabase/tests/database/166_order_view.test.sql:200-201` | Session key set | Seven keys | Eleven keys, described as "exactly eleven keys (DS-BQ-2 adds openedAt, openedToday, openedBy, coperto)" |
| `supabase/tests/database/326_weight_waiter_no_cost.test.sql:90` | Cost-key scan | Whole reply | The exact-path exemption of §3.3 |
| `tests/config/m25-preserves.test.ts:21` `LAST_MIGRATION` | Newest migration | `20261205100000_tables_unsent_count.sql` (BQ-1) | `20261206100000_order_view_opener_coperto.sql` |
| `tests/config/m25a-preserves.test.ts:26` `LAST_MIGRATION` | Same | Same | Same |
| `tests/config/ux-quick-wins-preserves.test.ts:10` `NEWEST_MIGRATION` | Same | Same | Same, plus a comment line like those at `:8-9` |
| `tests/config/m25b-preserves.test.ts:105-172` `ALLOWED_NEW_MIGRATIONS` | Allowlist | Ends with `20261205100000_tables_unsent_count.sql` (BQ-1) | Append `20261206100000_order_view_opener_coperto.sql` |
| [after merge] any newest-migration or `order_view` pin that BQ-1 added (its preserves test, pgTAP 367) | ? | ? | Move it the same way if it exists |

**Not moved:**
- The `PROTECTED` lists that name `public.order_view` each scan only their own date prefix: `m19-preserves.test.ts:36`,
  `m19b-preserves.test.ts:31`, `m20-preserves.test.ts:28` and `p2-0b-preserves.test.ts:99`.
- pgTAP 169:75 only checks that the function exists.

## 4. Alternatives considered

- **(b) Omit `vatRate` from the order's coperto:** this was the architect's first draft. It is now Variant V1, rejected as the default.
  - It needs no guard change, and `copertoLine` reads only `total`.
  - But the lead ruled the VAT rate a sale fact the waiter may see.
  - (a) keeps one coperto shape and one type (`SessionCoperto`) for tile and order. The narrow exemption keeps every other key guarded.
  - (b) would also need a second coperto type and a widened `copertoLine` signature.
- **(c) Rename `vatRate` (e.g. `taxPct`):** rejected. It defeats a name-based guard by choosing a name the guard does not know. That is
  exactly the leak pattern the guard exists to catch.
- **A key-name exemption (`vatRate` allowed anywhere on the order route):** rejected. A VAT field that slipped onto a line would pass.
  The lead asked for exact paths.
- **Inline copies of the helper's expressions in `order_view`:** rejected. There would be two definitions that could drift, while
  reusing the helper costs one indexed row read.
- **Join `/api/tables` data on the client:** rejected.
  - It puts data logic in a screen, against the invariant.
  - It needs a second request.
  - A closed session from yesterday may have no tile.
- **Keep the opener's id:** rejected as the default. This is Q-D2 and Variant V4.
- **An offline stub that mirrors the tile stub (`openedAt: clientTs`, `openedToday: true`, `coperto: null`):** rejected as the default,
  because `coperto: null` falsely means "no coperto". This is Q-D3 and Variant V3.

## 5. Build plan

**Step 0 (precondition, no commit):** merge `origin/main` (with BQ-1 #121) into the branch, then run every test command. The tree must
be green. Then:
- read BQ-1's migration, its preserves test and pgTAP 367;
- update the [after merge] rows of §2 and §3.5 in this plan, in the same PR. In particular: does 367 scan or pin `order_view`, or pin
  the newest migration?
- **Test that proves it:** the full suite is green on the merged base before step 1, and `20261205100000_*.sql` and `367_*.test.sql`
  are present.

**Rules for all steps:**
- Test first: write the named test, see it fail for the stated reason, then change the code.
- **Steps 1 and 3 are pushed together.** After step 1 alone, the strict schema refuses the new keys and returns a 500. The integration
  test `tests/integration/order-entry.int.ts:478` stays red until step 3.
- **Step 2 comes before step 3**, so the overlay is type-safe ahead of the schema change.

| # | Step (one commit) | Files | Test that proves it (fails first) |
|---|---|---|---|
| 1 | `order_view` gains `openedAt`, `openedToday`, `openedBy {displayName}` and `coperto {perPerson, vatRate, total} \| null`, built from `app.table_session_json` with the keys picked by name. pgTAP 326 gets its exact-path exemption and negatives. Every SQL and migration pin of §3.5 moves on purpose. Adds a preserves test for this feature | `supabase/migrations/20261206100000_order_view_opener_coperto.sql` (new); `supabase/tests/database/368_order_view_opener_coperto.test.sql` (new); `166_order_view.test.sql:200-201`; `326_weight_waiter_no_cost.test.sql:6, 90` (+3 tests); `179:37,69`; `214:468`; `327:17`; `222:39`; `229:36`; `tests/config/m25-preserves.test.ts:20`; `m25a-preserves.test.ts:26`; `ux-quick-wins-preserves.test.ts:10`; `m25b-preserves.test.ts` (`ALLOWED_NEW_MIGRATIONS`); any BQ-1 pin found in step 0; `tests/config/ds-bq2-preserves.test.ts` (new) | **pgTAP 368** (fake data, two tenants; the session is opened by waiter A and read by waiter B): (1) the session has exactly the eleven keys; (2) `openedBy` is exactly `{displayName}`, equal to waiter A's `app_user.display_name`, and waiter B can read it; (3) `openedAt` = `to_jsonb(opened_at)`; (4) `openedToday` is true for today's business date and false for an open session whose `business_date` is yesterday; (5) no coperto gives JSON `null`; (6) 4 covers at 2,50 with VAT 10 gives exactly `{perPerson: 2.5, vatRate: 10, total: 10}`; (7) after `update_table_session` to 6 covers, `total` is 15; (8) after `set_sale_settings` changes the amount and the rate, the open session's coperto is unchanged (frozen); (9) **"order_view and tables_list agree"**: for the same session, `openedBy.displayName` = `tile.waiter.displayName`, and `openedAt`, `openedToday` and `coperto` are equal; (10) the scan of `order_view #- '{session,coperto,vatRate}'` finds no cost-like key, the removed path existed, and an added `{session,vatRate}` or `{lines,0,unitCost}` is flagged; (11) the chef gets 42501, tenant B's waiter P0002, no claims 42501; (12) still one definition, a definer with `search_path=""`, executable only by `authenticated`. **pgTAP 326**: "order_view: no cost-like key outside the exact path session.coperto.vatRate", plus the three new tests of §3.3. **pgTAP 166**: "exactly eleven keys". **pgTAP 179/214/327/222/229**: the re-pinned values. **Vitest `tests/config/ds-bq2-preserves.test.ts`**: "the 20261206* migrations are exactly `20261206100000_order_view_opener_coperto.sql`", "sort after main's newest at the branch (BQ-1's 20261205100000)", "replace only `public.order_view` and create no function, table, trigger or policy", "never drop, never cascade", and a listing self-test (the pattern of `p2-7-preserves.test.ts:125-147`). **Vitest m25/m25a/ux-quick-wins/m25b**: the newest-migration pins |
| 2 | The overlay's session becomes `OverlaidSession`. With a server view it is `source: "server"`, spreading the view. The offline stub is `source: "queued"`, with `openedBy` from `queuedBy`, `queuedAt` from the op, and no `openedAt`, `openedToday` or `coperto` | `src/lib/sync/overlay.ts:20-23, 40-53`; `tests/lib/sync/overlay.test.ts:56-60, 199-213` | `overlay.test.ts`: "no ops: the view as it is, marked source server" (`toEqual({...ORDER_VIEW.session, source: "server"})`); "a queued open_table gives a queued session stub with the table name, covers, the queuer as opener and the queue time" (exact `toEqual`); **new** "the queued stub has no openedAt, openedToday or coperto key (unknown until the server applies it, Rule B)"; **new** `expectTypeOf` test: on `source: "queued"`, `session.coperto` is a type error. The other overlay tests stay green |
| 3 | Strict Zod `orderSession` with the four keys, reusing the exported `sessionCoperto`; type `OrderSessionOpener`; header comment. Also updates the fixtures, the snapshot, the schema guard with its exact-path exemption, and the route and integration tests | `src/server/tables/output.ts:22` (export only); `src/server/orders/output.ts:6-9, 37-45, 91-97`; `tests/helpers/orders-data.ts:63-74`; `tests/server/orders/output.test.ts:23-60, 127-143`; `tests/server/orders/__snapshots__/output.test.ts.snap`; `tests/app/api/session-lines.test.ts:49-104`; `tests/integration/order-entry.int.ts:478-483` | `output.test.ts`: "has exactly the eleven session keys" (was seven); **new** "parses a session with a coperto and one without"; **new** "refuses an opener with an id, a coperto with an extra key (`cost`), and a missing openedAt"; "orderViewOutput has no cost, margin, GP, food, EUR, recipe or VAT key **outside its exempt path session.coperto.vatRate**" (the path walker); **new** "the exempt path exists in orderViewOutput's schema"; **new** "a vatRate or unitCost at any other path of a waiter schema is flagged" (a schema built with `orderSession.extend({vatRate})` and one with `unitCost` on the line); the snapshot of `orderViewOutput` is updated on purpose and the other five are unchanged; `tests/server/tables/output.test.ts` stays green after the export. `session-lines.test.ts`: "%s reads the order with one RPC" (`toEqual(ORDER_VIEW)` now includes the four keys); **new** "an injected session.unitCost or coperto.cost never reaches the JSON (500, reported once)". `order-entry.int.ts`: also asserts `openedBy.displayName` and the coperto shape |
| 4 | The route guard gets the exact-path exemption on the order route and its negative tests | `tests/guards/waiter-weight-no-cost.test.ts:33-39, 149-166, 201-228` | `KNOWN_SALE_PATHS["/api/table-sessions/:id/lines"] = ["session.coperto.vatRate"]`. **New:** "the order route as it is: the coperto's vatRate is the only flagged path, and it is exempt"; "a second, nested vatRate in the order reply fails the guard" (`session.vatRate`, `session.coperto.nested.vatRate`); "an injected cost key elsewhere on the order route still fails" (`session.unitCost`, `session.coperto.cost`, `lines.unitCost` are each listed by `flagged()`); "the order route's exempt path is not exempt on another route" (`flagged("/api/menu", {session: {coperto: {vatRate: 10}}})`). **New** poisoned read: the order reply with `session.unitCost` injected gives 500 and no `unitCost` in the text. The existing tile tests (`:201-228`) are unchanged and green |
| 5 | Hand-off for the UX builder in the PR description (§8). Update the [after merge] notes in this plan | PR description; this plan | `npm run lint`, `npx tsc --noEmit`, `npm test`, `npx supabase test db` and `npx playwright test` all green; `code-reviewer` PASS |

No e2e test in this item. Nothing user-visible changes until the UX builder wires the header, and their e2e test covers it (§8).

### 5b. Variants

**V1: omit `vatRate` from the order's coperto (option b)** · Trigger: Q-D1 answered "(b)" · Replaces steps 1 (the coperto pick, tests
368 (6), (9) and (10), and the 326 edits), 3 (the schema and the schema guard) and 4 (the route guard)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | `order_view`'s coperto picks only `perPerson` and `total`. pgTAP 326 is **not** edited | Migration of step 1; `368_…test.sql` | 368: "coperto has exactly {perPerson, total}", "equals the tile's coperto minus vatRate", "bad_keys of order_view is empty"; 326 unchanged and green |
| V1.2 | Zod coperto is `z.strictObject({perPerson, total}).nullable()`, typed `OrderSessionCoperto`. The schema guard is **not** changed | `src/server/orders/output.ts`; `tests/server/orders/output.test.ts` | "refuses a coperto with vatRate"; "orderViewOutput has no … VAT key" unchanged and green |
| V1.3 | The route guard is not exempted; only negatives are added | `tests/guards/waiter-weight-no-cost.test.ts` | "the order route carries the opener and the coperto, and no flagged path"; "the tile's exempt path is not exempt on the order route"; a poisoned reply with `coperto.vatRate` gives 500 |
| V1.4 | `copertoLine` takes `Pick<SessionCoperto, "total"> \| null` | `src/lib/tables/table-view.ts:82-90`; `tests/lib/tables/table-view.test.ts:97-106` | "copertoLine words the order's coperto (no vatRate) like the tile's", with an `expectTypeOf` check that assignment works |

**V2: name the opener `waiter` (as on tiles)** · Trigger: Q-D2 answered "waiter" · Replaces steps 1 to 4 (key name only)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V2.1 | Steps 1 to 4 with `waiter: {displayName}` instead of `openedBy` | Same as steps 1 to 4 | The same tests with the key renamed; **new** "the order's waiter has no id (unlike the tile's)" |

**V3: the offline stub mirrors the tile stub** · Trigger: Q-D3 answered "mirror the tile" · Replaces step 2

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V3.1 | No `source` union. The stub is a full `OrderView["session"]` with `openedAt: open.clientTs`, `openedToday: true`, `openedBy: {displayName}` and `coperto: null` | `src/lib/sync/overlay.ts:40-53`; `tests/lib/sync/overlay.test.ts:199-213` | Exact `toEqual` of the stub; **new** "the order stub and the tile stub agree" (`overlayTables` gives equal `openedAt`, `openedToday` and `coperto`) |

**V4: keep the opener's id** · Trigger: Q-D2 answered "keep the id" · Replaces steps 1 (test 2), 2 and 3

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V4.1 | `openedBy: {id, displayName}` in the SQL (the helper's `waiter` as is), in Zod and in the overlay stub (`queuedBy.id`) | As steps 1 to 3 | 368: "openedBy is exactly {id, displayName} and id = opened_by"; `output.test.ts`: "refuses an opener without an id"; `overlay.test.ts`: the stub's `openedBy` equals `queuedBy` |

## 6. Risks and mitigations

- **R1. Security / cost leak (guards narrowed).** Three guards now accept one VAT key on the order read.
  - Each exemption is one exact path, pinned by a test that the path exists, plus negative tests: a `vatRate` elsewhere and a cost key
    elsewhere on the same route still fail (§3.3).
  - The strict Zod schema returns a 500 on any undeclared key.
  - The SQL picks the coperto's keys by name.
  - The role gate, the tenant filter and the grants are unchanged (pgTAP 166, 167, 368 (11)-(12)).
  - No secret is added or touched. The route uses the user's session client as today; the Supabase secret key is not involved.
- **R2. Old-shape cached replies.** The SW read cache `api-user` is not versioned (`public/sw.js:24`).
  - Between a deploy and the new worker's activation, an offline phone can serve a pre-DS-BQ-2 reply without the four keys. The page
    casts with `apiJson<OrderView>` (`page.tsx:136`).
  - Mitigation, for the UX builder (§8): render the meta line only when `openedBy` is present. Never fill a missing field with a
    default.
  - The window closes when the new worker activates (which clears the cache, `sw.js:11`) or at the next online read.
- **R3. BQ-1 unread.** The merged BQ-1 files could not be read in this run.
  - Mitigation: step 0 merges main, runs the suite and fills in the [after merge] rows.
  - If 367 scans `order_view` for cost keys, it gets the same exact-path exemption and negatives as 326, in step 1.
- **R4. Migration order.** `20261206100000` sorts after BQ-1's `20261205100000`.
  - Another branch could land a file in `20261206*` or later before this PR.
  - Mitigation: `ds-bq2-preserves.test.ts` pins "exactly this file" for the prefix, and the m25 pins name the newest file, so a
    collision turns CI red. If that happens, renumber before merging.
- **R5. Performance.** One extra primary-key read (the helper) per order read. pgTAP 168 ("order_view answers within 5 s") still runs.
  No number is promised beyond that test.
- **R6. The tile stub has the default this plan avoids.** `overlay-tables.ts:26-30` sets `openedToday: true` and `coperto: null` for a
  queued open.
  - After §10 the tile shows no coperto (`table-tile.tsx:46-48`), so the visible effect is only the time.
  - Reported, not changed here. Q-D3 asks the lead.
- **R7. Privacy (GDPR).** The opener's display name is staff personal data that the tile and the offline cache already process, for
  the same purpose and the same people.
  - No new category, no new recipient, no new retention.
  - Logout and PIN login clear the read cache (`sw.js:11`).
  - Leaving out the id reduces what is cached.
- **Dependencies:** none added.

## 7. Lead decisions

| ID | Question | Recommended default |
|---|---|---|
| **Q-D1** | The cost-key tests **disagree** with `coperto.vatRate` on the order read: the Vitest route guard, the Vitest schema guard and pgTAP 326 all fail (§2). The options: (a) one exemption per guard for the exact path `session.coperto.vatRate`, with negative tests; (b) omit `vatRate` (V1); (c) rename it | **(a)**, as the lead leaned: the coperto's VAT rate is a sale fact. The exemption is the exact path in all three guards, every other cost-like key stays forbidden, and new tests prove that a cost key or a second `vatRate` elsewhere on the same route still fails (§3.3) |
| **Q-D2** | The opener's shape: `openedBy: {displayName}` (no id), `waiter: {displayName}` (V2), or `{id, displayName}` (V4)? | **`openedBy: {displayName}`**: the lead's "display name only", data minimisation, nothing reads the id, and it cannot be confused with the tile's `waiter` |
| **Q-D3** | A session opened offline: an explicit `source: "queued"` variant without `openedAt`, `openedToday` or `coperto` (opener from `queuedBy`, plus `queuedAt`), or mirror the tile stub (V3)? And should the tile stub's `coperto: null` / `openedToday: true` (R6) get its own item? | **The `source: "queued"` variant** (Rule B). A separate small item for the tile stub only if the lead wants the two stubs aligned |
| **Q-D4** | `openedAt` and `openedToday` are added, although the assignment names only the opener and the coperto. Confirm? | **Yes**: §10.2 and §10.3 need the time, and `openedLine` needs both |
| **Q-D5** | BQ-1 is merged. Does its pgTAP 367, or its preserves test, scan or pin `order_view` or the newest migration? | **Answered in step 0 (0f62deec): no.** Neither 367 nor `20261205100000` references `order_view`. Only the newest-migration pins move, as listed in §3.5 (the builder re-greps for `20261205100000` in step 1) |
| **Q-D6** | (For the designer / UX builder, not this item.) The header wording for a queued session (no time, no coperto yet). Also, the spec's sample "Giulia alle 20:14 · Coperto 4 × 2,50 €" (§10.2:200) differs from what the helpers print, "Giulia · 20:14" and "Coperto 10,00 €", while §10.3:230 says "same helpers" | **Use the helpers as they are** (§10.3 wins). Queued: the covers plus the opener's name, with the existing "In coda" wording. `perPerson` and `covers` are in the payload if the designer wants "4 × 2,50 €" |

## 8. Hand-off to the UX builder (header of the direct comanda)

**What the API gives.** `GET /api/table-sessions/:id/lines`, type `OrderView` from `@/server/orders/output`, on `session`:

| Field | Type | Meaning |
|---|---|---|
| `covers` | `number` (int) | Unchanged |
| `openedAt` | `string` (ISO instant, database text) | When the session was opened (server time) |
| `openedToday` | `boolean` | Whether it was opened in today's business day. The server decides; do not compute it |
| `openedBy` | `{ displayName: string }` | Who opened the table. No id |
| `coperto` | `{ perPerson: number; vatRate: number; total: number } \| null` (= `SessionCoperto`) | Sale amounts, VAT included. `total` = covers × perPerson, computed by Postgres. `null` means no coperto. `vatRate` is a sale fact; the header does not need it |

**What the screen gets.** After `overlayOrder(...)` (`@/lib/sync/overlay`), `session.source` is either:
- `"server"`: all the fields above;
- `"queued"`: the table was opened offline and not yet applied. The session has `covers`, `openedBy.displayName` and `queuedAt` (the
  tap time), and **no** `openedAt`, `openedToday` or `coperto`. Narrow on `source` before reading them.

**Render:**
- **server:** `coversLine(session.covers)` · `openedLine(session.openedBy.displayName, session.openedAt, session.openedToday)` ·
  `copertoLine(session.coperto)`. Skip the coperto part when `copertoLine` returns null.
- **queued:** see Q-D6.
- Show the meta line only when `openedBy` is present (R2). Never fill a missing field with a default.

**Forbidden paths for the UX builder:**
- `supabase/**`, `src/server/**`, `src/app/api/**`;
- `public/sw.js`, `src/proxy.ts`, `next.config.ts`;
- CI (`.github/**`);
- dependencies (`package.json`, the lockfile).

Everything the header needs from those paths is delivered by this item. If something is missing, ask the lead; do not work around it.

**Their tests:**
- a component test in `tests/components/order-page.test.ts` for both `source` values and for `coperto: null`;
- an e2e check of the meta line on an occupied table (`e2e/order-entry.spec.ts`).
