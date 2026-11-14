# BQ-1 · `session.unsentCount` on `GET /api/tables`

Status: draft for the lead · 2026-11-14 · author: architect · origin: `docs/plans/2026-11-14-ux-p3-sala.md` §9 BQ-1 and lead decisions (`:431-445`).
Its own branch and PR (the lead creates them). No ADR: the change follows the existing `app.session_fired_lines` pattern.

## 1. Goal and scope

**In:** every tile that has a session gets `session.unsentCount`, an integer ≥ 0. It counts the session's order lines that are drafts:
not fired, not voided and not "a seguire". This is QW5's rule. The change covers:
- the SQL read and the Zod schema;
- the tile that a phone builds for a table it opened offline (§3.4);
- the tests and fixtures that pin the payload.

**Out:** any screen, wording or i18n key (W2 and W-c belong to the UX builder: P3-10, P3-11). Also out: `open_table`, `sessionOutput`, the bill,
`close_table`, the service worker.

## 2. Current state

- **Route:** `src/app/api/tables/route.ts:6-8` lets owner, admin and waiter in. It calls `listTables`, which does one RPC,
  `tables_list`, and parses the reply with `tablesListOutput` (`src/server/tables/list.ts:9-13`).
- **SQL:** the live body of `public.tables_list()` is `supabase/migrations/20261124100650_reservation_joined_tables.sql:130-194`.
  - It is security definer with `search_path = ''`. It calls `app.require_service_reader()` and takes the tenant from `app.tenant_id()`.
  - It is set-based. The `shown` CTE picks one session per table. Statuses come from `app.session_statuses(v_tenant, ids)` (`:153-155`),
    which joins `app.session_fired_lines` (`20261106100200_fire_course.sql:166-176`; ACL revoked from every API role in
    `20261031100100_menu_tables_helpers.sql:124-129`).
  - The session object is built at `:162-172`.
- **Zod:** `tileSession` (`src/server/tables/output.ts:43-51`) is a strict object. It holds `id`, `covers`, `openedAt`, `openedToday`, `waiter`,
  `billRequested` and `coperto`, and no line or draft data.
- **The "unsent" rule today:**
  - **QW5's bar and the leave sheet (client only).** The rule is `unsentLines` (`src/lib/orders/order-view.ts:63-72`):
    `state === "draft" && !segue && queue ∉ {fire, void}`. Its users are `sheetSummary` (`:86`) and `unsentGroups` (`src/lib/orders/fire-view.ts:58-61`),
    which feeds `src/app/(owner)/tavoli/comanda/page.tsx:222` and `leave-sheet.tsx`. Its tests are `tests/lib/orders/order-view.test.ts:197-224`.
    **No SQL helper holds this rule.**
  - **The bill uses a different, wider rule.** `app.session_bill_json` collects `unsentLineIds` with `filter (where l.state = 'draft')`
    (`20261110100100_bill.sql:168`). `app.close_session_at` refuses with `unsent_lines` on `l.state = 'draft'` (`20261110100200_close_table.sql:63-70`).
    Both count "a seguire" drafts too, and both are pinned. They stay as they are: a bill must not close while any draft exists.
  - **What `state` means.** `order_line.state` is generated: `voided` if `voided_at` is set, else `fired` if `fired_at` is set, else `draft`
    (`20261101100000_order_core.sql:41-42`). `segue boolean not null` is at `:22`. A line removed before it was sent is voided (`entry_removed`, `:35`),
    so `state = 'draft'` already leaves it out.
- **Pins:**
  - The md5 of `public.tables_list` is pinned in `supabase/tests/database/222_m21_preserves.test.sql:41`, `229_m19b_preserves.test.sql:37`,
    `296_reservations_preserves.test.sql:29` and `301_reservations_public_preserves.test.sql:26`.
  - `365_p27_roles_preserves.test.sql` does not pin it.
  - The filename-scoped guards (`tests/config/m19b-preserves.test.ts`, `tests/config/reservations-preserves.test.ts`) only scan `20261111*` and `20261124*`, so a
    new file does not touch them.
  - These tests pin the newest migration file: `tests/config/m25-preserves.test.ts:20`, `m25a-preserves.test.ts:26`,
    `ux-quick-wins-preserves.test.ts:10`, and the allow-list `m25b-preserves.test.ts:166-171`. `tests/config/p2-7-preserves.test.ts:12-20,117-119` requires every
    `20261204*` file to be a P2-7 step.
- **Cost-key tests:**
  - pgTAP `157_tables_list.test.sql:116-117` checks the exact session keys (seven of them) and `:156` runs the recursive scan for `cost|margin|gp|food|eur$|recipe`.
  - Vitest `tests/server/tables/output.test.ts`: `WAITER_FORBIDDEN` (`:34`), the AT4 key scan (`:138-149`), the strict refusals (`:79-97`) and the
    JSON Schema snapshot (`:99-101`).
  - `tests/app/api/tables.test.ts:51-62`: an injected cost key gives a 500.
  - `tests/guards/waiter-weight-no-cost.test.ts:144-148`: `/api/tables` has `poisoned: null`.
- **Fixtures and code that build tile sessions:**
  - `tests/helpers/menu-tables-data.ts:140-175` (`TABLES_LIST`);
  - `tests/server/tables/output.test.ts:48-56`;
  - `tests/lib/sync/overlay-tables.test.ts:31-39`;
  - `src/lib/sync/overlay-tables.ts:23-31`, the tile of a table opened offline. This is production code and must set the field once it is required.
  - The e2e specs do not mock the `/api/tables` body (`e2e/pwa.spec.ts`, `e2e/helpers/services.ts:51` read the real reply).
  - `scripts/lib/sp00/t4-seed.ts:111-113` reads only `tables[].id`.

## 3. Design

1. **One SQL definition: a new helper `app.session_unsent_lines(p_tenant uuid, p_session_ids uuid[]) returns table (table_session_id uuid, unsent_lines integer)`.**
   It copies the shape and ACL of `app.session_fired_lines`: `language sql stable`, `set search_path = ''`, not security definer, and revoked from
   public, anon, authenticated and service_role.
   ```sql
   select l.table_session_id, count(*)::integer from public.order_line l
    where l.tenant_id = p_tenant and l.table_session_id = any (p_session_ids)
      and l.state = 'draft' and not l.segue
    group by l.table_session_id
   ```
   It is the server half of `unsentLines`. The queue flags exist only on the phone. Pinned procedures are not touched: the bill and
   `close_table` keep their wider rule on purpose (§2).
2. **`public.tables_list()` is replaced** with `create or replace` in a new migration. It keeps the same signature, security, grants (restated) and
   every other line, plus two changes:
   - a CTE `un as (select * from app.session_unsent_lines(v_tenant, array(select h.id from shown h)))` with `left join un on un.table_session_id = h.id`;
   - `'unsentCount', coalesce(un.unsent_lines, 0)` in the session object.

   This is one aggregate over the `shown` sessions, served by `order_line_session_idx (tenant_id, table_session_id, …)`, so there is no N+1.
   - **Visibility:** the same as the rest of the payload. The role gate is `require_service_reader`, and every row is filtered by `tenant_id = app.tenant_id()`.
     No grant is added.
   - **Edge cases:** a closed session always counts 0, because `close_table` refuses while drafts exist. A joined or free tile has `session: null`, so it has no field.
3. **Zod:** `tileSession` gains `unsentCount: z.number().int().nonnegative()`, required. `sessionOutput` and `openTableOutput` are unchanged.
4. **Offline tile (lead decision: no placeholder value):** `overlay-tables.ts` sets
   `unsentCount: unsentLines(overlayOrder(null, ops, open.scope.sessionId)?.lines ?? []).length`. This is the real count, from P3 D12.
   The required field would otherwise break `tsc`. P3-10 then only reads the field.
5. **Copy:** none. No Italian string, no i18n key.

**Migration: yes.** The file is `supabase/migrations/20261205100000_tables_unsent_count.sql`. It sorts after `20261204100500_automap_statistics_independent.sql`.
It does not use `20261204100600`, because that name would fall under P2-7's `20261204*` exact list (`p2-7-preserves.test.ts:117-119`) and
make BQ-1 look like a P2-7 step. If the lead wants `20261204100600` anyway, see V1.

## 4. Alternatives considered

- **Inline the predicate in `tables_list`:** rejected. A named helper gives one definition that pgTAP can pin and test on its own. This is the
  same pattern as `session_fired_lines`.
- **Count on the client from `/api/table-sessions/:id/lines` for each tile:** rejected in P3 D5. It means N requests every 15 s, and it puts data
  logic in a screen.
- **Reuse the bill's `state = 'draft'` rule:** rejected. It counts "a seguire" drafts, which contradicts QW5 and the lead's answer to Q-L3.
- **Make the field optional, or set 0 offline:** rejected. The lead ruled out a fake value, and an optional field weakens the contract.

## 5. Build plan (test first; each step is one commit, red then green)

| # | Change | Test that proves it |
|---|---|---|
| S1 | **Database.** Write the tests first:<br>• new `supabase/tests/database/367_tables_unsent_count.test.sql`, which seeds lines the way `216_bill.test.sql:77-78` does;<br>• in `157_tables_list.test.sql:116-117`, eight keys (`unsentCount` added) and a new `plan` count.<br>Then add the migration (§3.1-3.2). Re-pin `tables_list` on purpose in 222:41, 229:37, 296:29 and 301:26, each with a comment citing BQ-1. Move the newest-migration pins in `m25-preserves.test.ts:20`, `m25a-preserves.test.ts:26` and `ux-quick-wins-preserves.test.ts:10`, and append the file to `m25b-preserves.test.ts:171` | `npx supabase test db`. `367` checks:<br>• a session with 2 non-segue drafts, 1 segue draft, 1 fired, 1 fired-then-voided and 1 voided-before-send (`entry_removed`) line gives `2`;<br>• a session with no lines gives `0`;<br>• a closed session today gives `0`;<br>• a draft that is then fired drops the count by 1;<br>• tenant B's drafts on its own session are not counted for tenant A, and owner B sees only B's count;<br>• waiter, owner and admin get the same number, and chef gets 42501;<br>• the helper exists once, its `prosrc` matches `state = 'draft'` and `not l.segue`, and no API role executes it (pattern of `179_m19_preserves.test.sql:77-81`);<br>• the `157:156` cost-key scan stays 0, and `296b:194-195` stay green.<br>`npm test -- tests/config` is green |
| S2 | **Contract, offline tile, fixtures** (one commit, because `tsc` needs all of it):<br>• `output.ts` `tileSession.unsentCount`;<br>• `overlay-tables.ts` (§3.4);<br>• `menu-tables-data.ts` `TABLES_LIST`: session1 `unsentCount: 2`, session2 `0`;<br>• the `TILE_SESSION` in `output.test.ts` and the `overlay-tables.test.ts` fixture gain the field;<br>• `tests/guards/waiter-weight-no-cost.test.ts:147` gets a `poisoned` case for `/api/tables` (`session.unitCost`) | `npx tsc --noEmit`, `npm test`:<br>• `output.test.ts`: `-1`, `1.5`, `"2"` and a missing `unsentCount` are refused. The snapshot is updated on purpose for `tablesListOutput` only. AT4 asserts that `propertyNames` includes `unsentCount` and that the `WAITER_FORBIDDEN` hits stay `[]`;<br>• `tests/app/api/tables.test.ts`: the waiter gets `unsentCount` passed through, and a session key `unsentCost` gives a 500 with no leak;<br>• the poisoned `/api/tables` guard gives a 500;<br>• `overlay-tables.test.ts`: open + queued non-segue add → 1; open + queued segue add → 0; open + add + queued fire → 0; open alone → 0; a server tile is left as it is (`toEqual`) |
| S3 | **End to end** in `tests/integration/menu-tables.int.ts` (AT1 block `:599-615`) | Against the local stack:<br>• the tile shows `unsentCount: 0` after open;<br>• it shows `1` after one normal and one segue line are added through the API;<br>• it shows `0` after `fire_course`;<br>• `tablesListOutput.safeParse` stays true |

### 5b. Variants

**V1 · Migration named `20261204100600_tables_unsent_count.sql`**
- **Trigger:** the lead keeps the number from the request (Q-B2).
- **Replaces:** the file name in S1.
- **V1.1:** S1 as written. In addition, `p2-7-preserves.test.ts` adds the file to `XML_MIGRATIONS` (`:12-20`), `public.tables_list` to `REPLACED_FUNCTIONS` (`:37`)
  and `app.session_unsent_lines` to `NEW_FUNCTIONS` (`:39-58`), each with a BQ-1 comment.
- **Test:** `npm test -- tests/config/p2-7-preserves.test.ts` is green, and so is the whole `367` file.

**V2 · BQ-1 and P3-10 ship as one PR**
- **Trigger:** the lead wants `overlay-tables.ts` to stay with the UX builder (Q-B1).
- **Replaces:** the `overlay-tables.ts` part of S2.
- **V2.1:** S1 and S2 land without the `overlay-tables.ts` change, on a branch that P3-10 joins before the PR leaves draft. The UX builder writes D12 there.
- **Test:** the `overlay-tables.test.ts` cases listed in S2 are written by P3-10, and `npx tsc --noEmit` is green only on the merged branch.

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| The SQL rule and `unsentLines` drift apart | The case lists match: S1's pgTAP cases and `order-view.test.ts:197-224` cover the same draft, segue, fired and voided cases. The helper's `prosrc` is pinned in `367`. Comments in both places cite each other |
| A cost key leaks to waiters | Strict Zod (a 500, never a leak), the AT4 key scan, the pgTAP recursive scan and the new poisoned guard. The field is a bare integer |
| Cross-tenant count | The helper filters on `p_tenant` from `app.tenant_id()`. pgTAP checks tenant isolation. The helper cannot be executed by any API role |
| A re-pin hides an unintended change | The new md5 is pinned only after `157`, `296b`, `172:477-480` and `217:141` pass. Each pin comment names BQ-1 |
| Stale offline copy | The service worker may hold a `/api/tables` reply from before the deploy, without the field, and the client casts the reply without parsing it (`tavoli/page.tsx:55`). Its consumers (P3-10, P3-11) must handle that for one poll. See Q-B3 |
| Security | No new secret, environment variable, endpoint, grant or dependency. No personal data is added. The Supabase keys stay where `CLAUDE.md` rule 2 puts them |

## 7. Lead decisions (open questions)

| # | Question | Default |
|---|---|---|
| Q-B1 | May BQ-1 write the real offline count in `src/lib/sync/overlay-tables.ts` (P3 D12), or must it merge with P3-10 (V2)? A required field with no placeholder leaves only these two options | BQ-1 writes it (S2) |
| Q-B2 | Migration name `20261205100000_…` (outside P2-7's `20261204*` guard) or `20261204100600_…` as requested (V1)? | `20261205100000` |
| Q-B3 | The P3 plan's `unsentLines` comment says the leave sheet counts queued adds. The server count cannot see a queued fire or void, so after a replay the tile may lag one 15 s poll behind the comanda. Is that acceptable as advisory (P3 §8 already says so)? And what should P3-10 show for a cached tile without `unsentCount`: nothing, or wait for the next read? | Advisory. A missing field shows no count (no fake 0) |
| Q-B4 | Confirmed already by Q-L3: "a seguire" drafts are **not** counted, but the bill's `unsentLineIds` and `close_table` still count them. The "Da inviare" tile can say 0 while the bill warns. Is that acceptable? | Yes. The bill is stricter on purpose (Q129) |

### Lead decisions (decided 2026-11-14)

| # | Decision |
|---|---|
| Q-B1 | Decided: default. BQ-1 writes the real outbox count in `src/lib/sync/overlay-tables.ts`, using `unsentLines` from `src/lib/orders/order-view.ts`. The file belongs to the UX builder's area, so the change stays minimal: only what the now-required field needs. |
| Q-B2 | Decided: the migration is `20261205100000_tables_unsent_count.sql`. |
| Q-B3 | Decided: the count is advisory. A reply missing the field shows nothing in the UI, never 0. A tiny pure client helper `unsentCountOf(session: unknown): number | null` returns the integer when it is a valid non-negative integer and null otherwise, with Vitest cases (missing, negative, float, string give null; 0 gives 0; 3 gives 3). It is not wired into screens: the UX builder does that (P3-10, P3-11). |
| Q-B4 | Decided: "a seguire" drafts are not counted (same rule as QW5 and the leave sheet). The bill and `close_table` keep their wider rule. |
