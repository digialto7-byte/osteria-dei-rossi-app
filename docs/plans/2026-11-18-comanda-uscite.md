# Tech plan: Costì / Osteria Digitalization · Comanda per uscita (server side, and the split with the UI)

- **Status:** draft for the lead · **Author:** architect · **Date:** 2026-11-18
- **Repo and branch:** `osteria-dei-rossi-app`. This plan is on `docs/comanda-uscite-plan` (from `main` `372c8ffa`). The build is one
  `/feature` run on `feat/comanda-uscite` from `main`. It ships as **four PRs before go-live** (PR1–PR4) and **one later PR after P0**
  (PR5, the kitchen-side "Via"). Each PR stays a draft until `code-reviewer` passes (§5).
- **Source spec:** `docs/ux/comanda-uscite.md` (designer, merged on main). §8 of the spec lists what the database must learn. §3.0 below
  covers it item by item. The spec owns the screens and the words; this plan owns tables, procedures, tests and the PR split.
- **Lead defaults this plan builds on (2026-11-18):**
  - **Q-U4:** ship before go-live, so P0 observes the final flow.
  - **Q-U1:** voiding a dish of an uscita still "in attesa" reverses its depletion with the reason "Non preparato", not waste. The
    founder may still overturn it (V1).
  - **Q-U3:** the kitchen-side "Via" comes after P0. It is planned here as phase 2 (PR5), out of PR1–PR4.
- **Lead ruling on migration ranges (2026-11-18).** Numbers must follow merge order, because `supabase db push` runs without
  `--include-all`. The merge order is:

  **opening stock (`20261206210000…`) → comanda per uscita (`20261206220000…`) → P2-4 (renumbered later) → SP2 (`20261207100000`)**

  P2-4's former `210000`–`210600` range no longer applies. pgTAP: P2-4 has `397`–`406`, opening stock `407`–`416`, and this plan `417`
  upward.
- **Client slug / internal:** `osteria-dei-rossi` is tenant #1. Internal planning document, in English. Every new Italian string is
  "(da approvare)" and is the copywriter's and the founder's (spec Q-U5).
- **Client facts used:** none. Fixtures are fake: "Osteria Demo A", "Osteria Demo B", the spec's demo dishes ("Bruschetta Demo",
  "Tagliatelle al ragù Demo", "Spezzatino con polenta Demo", "Acqua naturale 75 cl").
- **Inputs read:**
  - this repo's `CLAUDE.md` (rule 6 invariants);
  - the spec `docs/ux/comanda-uscite.md` (all of it);
  - ADR-002, ADR-017, ADR-019, ADR-022, ADR-024; the M19 plan `docs/plans/2026-10-28-m19-firing.md` (Q97, lines 516–517) and the M20
    plan `docs/plans/2026-10-29-m20-offline.md` (§3.5, §3.6);
  - the format models `docs/plans/2026-11-15-sp01-tenant-config.md` and `docs/plans/2026-11-18-p2-4-alert-rules.md`;
  - every migration and file cited in §2, and the pgTAP pins found by grep (§3.15).
- **How main was read:** with file tools only (no shell, no `git log`). Everything below comes from the worktree on `372c8ffa`. The newest
  migration there is `20261206200400_tenant_locale_settings.sql` and the newest pgTAP is `396_sp1_preserves.test.sql`. **Where the spec
  and the code differ, the code wins;** §9 lists every difference.
- **ID scheme:**
  - steps **0–25**, in PRs **PR1–PR5**; migrations **M1–M9**;
  - variants **V1–V6**; open questions **Q1–Q12**; risks **R1–R12**; unverified technical assumptions **T1–T3**;
  - acceptance tests **AT1–AT9** (§1), this plan's own, server side; the spec's §10 UI checks are the UI steps' tests;
  - **G** = tenant #1 golden test, **X** = cross-tenant suite (platform plan §6.5 rules 4–5; SP1 built them as pgTAP `389`/`390`);
  - **B1** = builder 1 (server, this plan's default owner); **B2** = builder 2, the UX builder, who may own the steps marked
    **[UI-only]**.

---

## 0. Summary

An **uscita** is one wave of service, whatever the menu category. The waiter writes the comanda top to bottom, draws "segue" lines, and
sends everything with one "Invia comanda". The 1ª uscita (and drinks) is made at once; later uscite reach the kitchen **in attesa** until
the waiter taps "Via la 2ª". The per-category send and the per-line "Segue" toggle go.

1. **Data.**
   - `order_line.uscita smallint` (0–9). **0 = "subito"** (the drinks default); 1–9 are uscite. `course` stays: menu category, kitchen
     sorting inside an uscita, and every report.
   - A new append-only table `public.uscita_call (session, uscita 2–9, called_at, called_by, cause)`, one row per called uscita.
   - **"Held" is derived, never stored:** a fired line is held when its uscita is ≥ 2 and its session has no call row for that uscita.
     Uscite 0 and 1 are never held (that is the spec's "the 1ª is called implicitly").
2. **Depletion happens at send** (recommended, §3.2). Held lines are fired as today: stock moves, `negative_stock` is raised and the cost
   is frozen at the send, which is the sale (`fire = sale`, spec §8.2). The call writes one row and moves no stock.
3. **Procedures, all single-transaction:**
   - `fire_course` gains `hold`. With `hold: true` (the new "Invia comanda"), lines of uncalled uscite ≥ 2 stay held. Without it (every op
     already queued on a phone today), it behaves as today: everything it fires is called.
   - New `call_uscita(session, {uscita})`: one row, idempotent, refuses nothing silently.
   - `void_line` gains the reason **`not_prepared`** ("Non preparato"). It applies to held lines only, writes **reversals only** (stock
     goes back), and never writes waste. A line already called is voided as today (reversal + waste).
   - `add_order_line` and `update_order_line` take `uscita`. The legacy `segue` key is still accepted and mapped (segue → 2).
4. **Kitchen.** A ticket is keyed by `(session, ticket instant, uscita)`. The ticket instant is `greatest(fired_at, called_at)`, so a called
   uscita becomes one ticket at its call time, and a late dish is its own "aggiunta" ticket. Held lines come back in a separate read-only
   `waiting` list and cannot be marked done.
5. **Reads.** `/api/tables` gains a per-session uscite summary. `order_view` gains a per-uscita state. `unsentCount` counts every draft.
6. **Offline.** There is a new op kind `call_uscita`. `add_line` and `edit_line` carry `uscita`, and `fire` carries `hold`.
   - **Old queued ops replay with their old meaning:** `segue` is mapped, and a `fire` without `hold` fires and calls.
   - A version header lets old app bundles still parse the sync replies.
   - Stored replies from before the deploy are upgraded before the strict parse.
7. **Open sessions are migrated in place** by one idempotent, locked, self-checking function:
   - segue false → 1, drinks → 0, segue true → 2;
   - already-fired segue lines get a call row at their first fire time, so nothing that is already in the kitchen becomes "in attesa".
   - **Closed sessions are not written at all:** their new column stays null, and G proves every output is byte-identical.

**PR split.**
- **PR1:** baseline G and X (tests only).
- **PR2:** write path and sync. It is backward compatible: the current UI keeps working unchanged.
- **PR3:** kitchen board by uscita, with B2's kitchen card.
- **PR4:** waiter reads, the close guard, and B2's comanda sheet.
- **PR5 (after P0):** the kitchen-side "Via".

**Nine migrations: eight in PR2–PR4 (M1–M8, `20261206220000`–`220700`) and one in PR5 (M9, `220800`).** `220900` is free for review
fixes. pgTAP `417`–`430`. The range follows the lead's ruling: it comes after opening stock and before P2-4 and SP2 (§3.17).

**Flags for the lead (read first).**
1. **Depletion at send, with a reversal for "Non preparato".** This is an exception to ADR-019's rule "a void after firing becomes waste"
   (`docs/adr/adr-019-firing-and-voids.md:22`). It is consistent with PRD 2.3 ("voids restore stock if the item was not yet fired"),
   because a held dish was never cooked. It needs ADR-049 (step 12) and the founder's confirmation of Q-U1 (Q1; V1 otherwise).
2. **A live hazard for every change to the line shape, found on the way (pre-existing; this plan fixes it for its own change).**
   - An old app bundle strict-parses the `/api/sync` reply (`src/pwa/send.ts:33–36`). Any new key in a line makes it treat applied ops as a
     server failure. It retries them as duplicates (nothing doubles), and the phone shows "stuck" until it reloads.
   - The server strict-parses **stored** replies of duplicates too (`src/server/sync/results.ts:78–85`). A replay of an op applied
     before the deploy would therefore answer 500.
   - P2-0b's `weightG` had the same exposure. Step 10 adds `X-Sync-Version` down-shaping and a stored-reply upgrade (§3.12).
3. **Closing a table while an uscita still waits is refused by default** (`uscita_waiting`, M8). Otherwise the bill would charge dishes
   the kitchen never started, and their stock would stay booked. The spec does not mention it (Q4; V4 otherwise).
4. **The spec's ticket key `(session, fired_at, uscita)` (§8.4) is refined** to `(session, greatest(fired_at, called_at), uscita)`.
   - With `fired_at`, a 2ª that gained a dish while waiting would show as two tickets once called, and a called uscita would sort at its
     send time, not its call time.
   - `kitchen_event` stores the old four-column ticket key in an append-only table. It gains an `uscita` column, and the open tickets are
     remapped by appending events, never by updating them (§3.9).
5. **The spec's "audit row" for the call (§8.3) is the `uscita_call` row itself.** No procedure of this area writes `audit_event` (fire,
   void and the kitchen marks keep their own ledgers), so no audit action is added and no audit CHECK pin moves.
6. **`segue` cannot be dropped yet.** Old bundles read it, closed history uses it, and legacy kitchen events are keyed by it. It is kept
   and mirrored (`segue = uscita >= 2`) with no reader left. Its removal is a follow-up after go-live (Q9).

---

## 1. Goal and scope

**Goal:** the waiter takes the comanda like a handwritten pad. One send puts the 1ª (and the drinks) in the kitchen at once and holds the
later uscite. One tap calls the next one. Stock, cost, the bill and the reports stay exactly as truthful as today. Tenant #1's closed
history does not change by one byte.

**In scope**
- `order_line.uscita`, `public.uscita_call`, `kitchen_event.uscita`, and the guards, RLS, grants and demo-purge entries they need.
- `add_order_line`, `update_order_line`, `order_line_json`, `fire_course` (`hold`), the new `call_uscita`, and `void_line`
  (`not_prepared`).
- The in-place migration of open sessions and of their open kitchen tickets.
- The kitchen board by uscita, `kitchen_mark_line` and `kitchen_set_ticket` on the new key.
- `tables_list` (uscite summary, `unsentCount`), `order_view` (uscite states), and `close_table` (`uscita_waiting`).
- Sync: the `call_uscita` kind, the `uscita` and `hold` keys, the legacy mapping, the version header and the stored-reply upgrade.
- TS domain, routes, the integration suite, G, X, race cases, ADR-049 and the runbook.
- The PR split with B2's UI steps (spec §2–§7 and §10).
- Phase 2 (PR5, after P0): `call_uscita` by the chef, and the kitchen "Via" button.

**Out of scope**
- Reports: they keep using `course` (spec §8.8). No KPI, AvT, forecast, trace or export function is re-created (§3.15 "must stay").
- Removing `segue` (column, legacy keys, mirror): a follow-up after go-live (Q9).
- Timed drinks beyond the spec's escape hatch (V2), reordering uscite, and a swipe or row chip to move lines (spec §9).
- Any change to `session_bill_json`, `freeze_line_cost`, `deplete_line_batches`, `post_plate_raw_outflow`, `post_stock_outflow` or
  `ledger_checks_body`.
- New audit actions, alert kinds, cron jobs, secrets or dependencies.

**Acceptance tests (this plan's own, server side)**
- **AT1 The founder's example.**
  - Four drafts: Bruschetta (antipasti) and Tagliatelle (primi) in uscita 1, and two Spezzatino (secondi) in uscita 2. One fire with
    `hold: true`.
  - Every line is fired, depleted and costed.
  - The board shows one 1ª ticket (antipasti line before primi line, each with its `course`) and a `waiting` 2ª with 2 lines.
  - `remaining` is 2 and `waitingCount` is 2.
- **AT2 The call.**
  - `call_uscita(2)` writes one row.
  - The 2ª becomes its own ticket at `called_at`, with `calledAt` set.
  - The tables summary goes from `{cooking: 1, waiting: 2}` to `{cooking: 2, waiting: null}`.
  - A second call by the same user answers `changed: false`; by another user, the conflict `already_called`.
- **AT3 Additions.** A dish added to uscita 1 after its send fires at once, as a separate ticket with `addition: true`. A dish added to a
  waiting uscita is held with it and joins its ticket when called.
- **AT4 Drinks.** A `bevande` line defaults to uscita 0 and is never held, whatever `hold` says.
- **AT5 Offline.**
  - `add_line` (uscita), `fire` (hold) and `call_uscita` replay once each, in order.
  - A replayed call writes no second row.
  - Old-format ops (`segue` key, `fire` without `hold`) apply with today's meaning.
  - An old bundle (no `X-Sync-Version`) gets replies it can parse.
  - A duplicate of an op stored before the deploy answers 200.
- **AT6 Voids.**
  - A held line voided `not_prepared` puts every portion and raw quantity back (reversals only, no waste) and drops out of the KPI.
  - A called line is voided as today (reversal + waste).
  - `not_prepared` on a called line is the conflict `uscita_called`; a waste reason on a held line is the conflict `held`.
- **AT7 Migration.**
  - Open sessions: segue false → 1, drinks → 0, segue true → 2. Fired segue lines are not held, and a closed ticket stays closed.
  - Closed sessions: no row is written, and G is unchanged.
- **AT8 Close.** A session with a held line cannot close (`uscita_waiting`, with the line ids). After the call or the void, it closes and
  its bill equals the one it would have had today.
- **AT9 Tenancy.** B can neither call, void, read nor see on the board anything of A's. A's `uscita_call` rows are invisible to B.

---

## 2. Current state (what exists today)

Line numbers are on the worktree at `372c8ffa`.

### 2.1 Lines, firing, voids, cost

| What | Where (file:line) | Fact that matters |
|---|---|---|
| `order_line` | `supabase/migrations/20261101100000_order_core.sql:14–62` | `course` `:19`; `segue boolean not null default false` `:22`; `fired_*`, `voided_*`, `void_reason` `:36–40`; `state` generated `draft`/`fired`/`voided` `:41–42`; `void_reason ~ '^[a-z_]{1,40}$'` `:48`. Append-only (`:110–113`); RLS owner/admin only (`:116–120`) |
| Line guard | latest `20261130100000_weight_core.sql:94` (first `20261101100000:71–105`) | a fired line may change only by being voided; `course`, `qty`, `segue`, `note`… frozen (`:90–101` of the original) |
| `fire_course` (current) | `20261130100300_weight_fire.sql:10–156` (earlier `20261106100200_fire_course.sql:13`, `20261106100700_fire_locked_batches_only.sql:133`) | body `{lineIds}` only, 1–50 distinct (`:43–51`); session `FOR SHARE` (`:54`), lines `FOR UPDATE` by id (`:61–70`); already fired/voided → skipped (`:72–82`); one `fired_at = clock_timestamp()` for the call (`:85–87`); locks then FEFO batch depletion and raw outflow (`:89–142`); `freeze_line_cost` per line (`:143`); reply `{lines, fired, skipped}` (`:148–154`). **The client names the lines; the server never computes "all drafts"** (M19 §3.1, item 1) |
| Batch depletion | `20261106100700_fire_locked_batches_only.sql:37–127` | FEFO over locked live batches; a shortage is booked on the last/fallback batch and raises `negative_stock` in a contained block (`:110–123`) |
| Raw depletion | `20261106100100_fire_helpers.sql:262–362` | FEFO lots across active locations through `app.post_stock_outflow` (`20261026100400_stock_core.sql:177`), which raises its own `negative_stock` |
| Frozen cost | `20261130100300_weight_fire.sql:158–240` (`app.freeze_line_cost`); table `20261106100000_fire_core.sql:14–46` | cost = the line's **unreversed** movements × frozen unit costs (`:188–203`); `order_line_cost` is append-only, owner/admin only |
| `void_line` | `20261106100300_void_line.sql:21–161` | reasons from `app.order_void_reason_codes()` (`:55–57`); draft → no movement (`:79–94`); fired → per movement a **reversal + a waste row** (`:96–144`), batches settled (`:147–149`); replay/conflict rules (`:69–77`) |
| Void reasons | `20261106100100_fire_helpers.sql:13–18` (`order_error, customer_changed, kitchen_error, returned, comp, breakage`), mapping to waste codes `:22–34`; TS `src/server/orders/constants.ts:25–32` | no reason means "not cooked" |
| Stock reasons and shapes | `20261026100100_stock_movement_shapes.sql:7–13` (8 waste codes), reason CHECK `:23–25`, reversal guard `:41–70` (a reversal mirrors type, reason, lot, unit cost) | a pure reversal row needs **no** reason code |
| Batch shapes | `20261106100000_fire_core.sql:62–82` | `consume` (`order_line`), its reversal (`order_void`, `:80–81`), and void waste (`order_void`, `:76–77`) already exist; reversal guard `:86–112` |
| Batch state | `20261029100100_batch_action_helpers.sql:68–101` | remaining > 0 → `open` (`:87–88`): **a reversal into a discarded batch would re-open it** (§3.7) |
| Nightly check | `20261130100300_weight_fire.sql:371–397` (`fire_bad`) | compares the **original** consume rows with the plate's need; reversals do not affect it |
| Readers of voids | AvT `20261112100400_avt_report.sql:56`; push sell-through `20261203100400_push_sell_through.sql:98`; trace forward `20261203100200_trace_forward.sql:156–166`; KPI lines `20261130100400_weight_reads.sql:186–208` (`voided_at is null`) | a `not_prepared` void (reversals, no waste) nets the plate out of consumption, is not a discard, shows as "voided after the send" in the trace, and leaves the KPI |

### 2.2 Kitchen, tables, bill, close

| What | Where (file:line) | Fact that matters |
|---|---|---|
| `kitchen_event` | `20261111100000_kitchen_event_core.sql:12–50` | line events (done/undone) and **ticket events keyed by `(table_session_id, fired_at, course, segue)`** (shape `:26–30`, index `:37–38`); append-only; RLS owner/admin |
| Kitchen helpers | `20261111100100_kitchen_event_helpers.sql:26–116` | `kitchen_ticket_key` parses `{sessionId, firedAt, course, segue}` (`:26–62`); advisory lock on the four fields (`:64–73`); state and open-lines by the key (`:87–116`) |
| Board | `20261130100400_weight_reads.sql:94–182` (`app.kitchen_ticket_rows`); wrapper `20261111100200_kitchen_board.sql:103–122` | candidates: fired, same business date, ≤ 30 h, open sessions (`:100–107`); group by `(session, fired_at, course, segue)` (`:117, :133`); key string `:136–137`; ticket event lookup `:140–144`; order `fired_at, table, course, segue` (`:177`); `remaining` (`:176`) |
| Marks | `20261111100300_kitchen_marks.sql:17–80` (`kitchen_mark_line`), `:82–126` (`kitchen_set_ticket`) | the mark finds the ticket by `l.fired_at, l.course, l.segue` (`:54, :66–74`) |
| Kitchen TS | `src/server/kitchen/output.ts:24–42` (`course`, `segue` per ticket); `src/server/kitchen/schemas.ts:10–16` | strict, chef-safe |
| Tables read | `20261205100000_tables_unsent_count.sql:23–91` (`tables_list`); `app.session_unsent_lines` `:9–20` counts drafts **`and not l.segue`** (`:18`); status `20261031100100_menu_tables_helpers.sql:48–62` (`courses_sent` from fired lines, `20261106100200_fire_course.sql:166–176`) | the tile has no uscite information |
| Order view | `20261206100000_order_view_opener_coperto.sql:14–57` | lines via `app.order_line_json`, hides drafts voided before fire (`:55`) |
| Line JSON, add, edit | `20261130100200_weight_order_entry.sql:35–58` (`'segue'` `:47`), `:60–217` (`segue` key `:110–112`, insert `:194–202`), `:219–367` (`segue` `:266–268`; fired → conflict `:287–289`) | the waiter-safe line shape |
| Bill | `20261130100400_weight_reads.sql:12–92` | every non-voided line is billed (`:54`); drafts are `unsentLineIds` (`:47`); token from id, state, qty, price (`:48–50`) |
| Close | `20261206200300_close_with_tenant_codes.sql:9–92` (`app.close_session_at`) | refuses drafts with `unsent_lines` + ids (`:70–77`, Q129: "dishes never sent would never come off stock"); bill-token check (`:80–83`) |
| Day close report | same file `:94–194` | closed totals; open tables at their provisional bill (`:177–181`) |
| Demo purge list | latest `20261204100200_invoice_vat_summary.sql:58` | every operational table, children first |

### 2.3 Sync and outbox

| What | Where (file:line) | Fact that matters |
|---|---|---|
| Kinds | `20261109100000_applied_op.sql:10–13` (`open_table, add_line, edit_line, remove_line, fire, void_line`); `applied_op` `:16–35` (kind CHECK `:31`) | TS mirror `src/server/sync/constants.ts:5–12` |
| Dispatcher | `20261109100100_apply_op.sql:90–193` (`public.apply_op`): kind check `:126`, idempotency by `(tenant, op_id)` with a payload hash (`:151–164`), stop on a failed create (`:187–191`); `apply_op_dispatch` `:51–87` (fire `:77–80`, void `:81–82`); payload keys, latest `20261130100200_weight_order_entry.sql:369–392` | conflicts are results (`v_reply ? 'conflict'`, `:170`) or the raised codes of `app.sync_conflict_codes()` (`:17–20`) |
| Route and TS | `src/app/api/sync/route.ts:8–14`; `src/server/sync/schemas.ts:19–53`, `output.ts:23–68`, `results.ts:44–51` (`REPLY_OF`), `:78–85` (**strict parse of stored replies**), `apply.ts:74–108` (one RPC per op, stop rules) | a stored reply that no longer parses throws → 500 |
| Phone | `src/pwa/send.ts:33–36` (**strict `syncOutput.safeParse` in the browser**); `src/pwa/outbox.ts:12–18, 52–64` (IndexedDB `osteria-sync` v1, ops kept with their payload); `src/lib/sync/ops.ts:33–148` (`addLineDraft` sends no `segue`; `editLineDraft` may; `fireDrafts` chunks 50); `src/lib/sync/overlay.ts:40` (`FIELDS` incl. `segue`) | ops queued today carry `segue` (edit) and `fire {sessionId, lineIds}` |
| Versions | `public/sw.js:16` | a new worker waits until the old tabs close: **an old bundle can run against the new server during service** |

### 2.4 Today's "Segue"

- M19 Q97 default (`docs/plans/2026-10-28-m19-firing.md:516–517`): a segue dish **stays a draft** until "Invia a seguire". That tap is the
  call and the depletion.
- So in an open session today:
  - segue lines are either drafts (not yet called) or fired (called at their `fired_at`);
  - a fired segue ticket is `(session, fired_at, course, true)`.
- UI: `src/lib/orders/fire-view.ts:18–76` (per-course `normalIds`/`segueIds`), `src/lib/orders/order-view.ts:103` (unsent excludes segue),
  `src/app/(owner)/tavoli/comanda/send-buttons.tsx`, `line-editor.tsx`, `src/app/(owner)/cucina/ticket-card.tsx`,
  `src/lib/kitchen/kitchen-view.ts:41, 58` ("A seguire" badge).

---

## 3. Design

### 3.0 Spec §8, item by item

| §8 item | Where in this plan | Note |
|---|---|---|
| 1 Lines carry an uscita; `course` stays; `segue` retired; open sessions migrate false → 1, true → 2 | §3.3 (M1), §3.4 (M2), §3.8 (M5) | drinks are `0` ("subito"), not null (§9.3); `segue` kept as a mirror with no reader (flag 6) |
| 2 One send; held lines; stock and cost at fire unchanged | §3.5 (M3), §3.2 | `hold: true`; depletion at send recommended |
| 3 The call: append-only record, own procedure, single transaction, audit, idempotent; 1ª implicit | §3.6 (M3) | the row is the audit (flag 5); "1ª implicit" = uscite 0–1 never held |
| 4 Ticket key `(session, fired_at, uscita)`; held lines readable but not markable | §3.9 (M6) | key refined to the ticket instant (flag 4) |
| 5 `/api/tables` uscite summary | §3.10 (M7) | `{cooking, waiting, cookingDone}` |
| 6 Sync: uscita in add/edit, a call kind, idempotent replay, call never before its send | §3.12 (M2, M3, step 10) | ordering comes from the outbox (§9.6) |
| 7 Voiding a held line (Q-U1) | §3.7 (M4) | `not_prepared`, reversals only (lead default); V1 otherwise |
| 8 Reports keep `course` | §3.15 "must stay" | nothing re-created |

Not in §8, added because the code needs it: the close guard (§3.11, M8), `unsentCount` on all drafts (§3.10), `order_view` uscite
states (§3.10), the version header and stored-reply upgrade (§3.12), and remapping the open kitchen tickets (§3.9).

### 3.1 The model and its rules

- **Line:** `uscita ∈ 0..9`. Default at add: `0` for course `bevande`, else `1`. The client may set any value (the spec's Uscita control,
  including "Subito" for drinks, Q2).
- **Held (derived):** `fired_at is not null and voided_at is null and uscita >= 2 and not exists uscita_call (tenant, session, uscita)`.
  Calls are monotonic (a row is never removed), so a line moves at most once from held to called.
- **Ticket instant (derived):** `fired_at` for uscite 0–1; `greatest(fired_at, called_at)` for uscite ≥ 2 once called.
  - Lines fired before the call share `called_at`, so the called uscita is one ticket at its call time.
  - Lines fired after the call keep their own `fired_at`, so they form an "aggiunta" ticket.
- **Addition:** a ticket of uscita ≥ 1 whose instant is later than the earliest ticket instant of the same `(session, uscita)`.
- **"Via la n" is allowed on any uncalled uscita 2–9 that has a held, non-voided line.** The UI offers only the lowest one (spec §2.3).
- **Why derived, not stored:**
  - nothing to keep in step, and no update of a fired line (the guard forbids it);
  - a fire and a call racing each other always end consistent (§3.6, race cases in step 6).

### 3.2 Depletion: at send or at call (the decision)

| Consequence | **A. Deplete at send (recommended)** | B. Deplete at call |
|---|---|---|
| What the send does to held lines | fires them: `fired_at`, FEFO batch and raw movements, `order_line_cost`, exactly as today | marks them sent but not fired (a new held state, or a `held_at` column); no movement |
| When the cost is frozen | at the send, which is the sale (invariant "costs frozen at sale", spec §8.2) | at the call, minutes later and not at the sale; a batch produced in between may be used |
| What the kitchen sees | held lines are fired rows; the board shows them folded "in attesa" (§3.9) until the call row exists | the board must also read unfired lines of a new state; marks must ignore them |
| Portions availability (menu "Ne restano") | the held portions are deducted at once: no other table can be sold the last spezzatino promised to table 2 | not deducted until the call: **two tables can be promised the last portion**; the second call books a shortage |
| `negative_stock` alert | at the send: the chef and the owner learn about the shortage while there is time to prep or warn the table | at the call, in the middle of service, when the dish is due |
| Void **before** the call | `not_prepared`: reversal rows only, so stock goes back; no waste; the cost row stays (append-only) but the KPI drops the voided line. A held portion in a batch discarded since is kept as waste with the discard's reason (§3.7) | like a draft void: no movement at all (simplest) |
| Void **after** the call | as today: reversal + waste with the mapped reason (ADR-019) | as today |
| The bill | unchanged: held lines are `fired`, billed, not "unsent"; the bill token is the same text as today | the bill must show the new state; the token text changes for held lines; `session_bill_json` (G pin) moves |
| Close and day close | close refuses while a held line exists (M8, Q4); after a call or a void the day close, KPI rollup, AvT and forecast read exactly what they read today | close must refuse held lines too (they would never be depleted, as Q129's drafts); the forecast and KPI read only fired lines, so they are unchanged once called |
| Nightly ledger check | unchanged (`fire_bad` reads the original consumes) | unchanged |
| Code impact | `fire_course` (one flag), `void_line` (one branch), a call that writes one row; `freeze_line_cost`, depletion helpers and the bill **not re-created** | a new line state (generated column, guard, bill, order view, kitchen, close); `call_uscita` becomes a depletion procedure with every fire lock; a heavier offline op |

**Recommendation: A.**
1. It keeps "fire = sale" and "cost frozen at sale" literally true.
2. It is the only option that protects the last portions: held dishes are promised food.
3. Shortages surface at the send, when the kitchen can still react.
4. It re-creates the fewest pinned functions: the bill, the cost engine and the depletion helpers stay byte-identical.
5. The call stays a one-row write, which is cheap and safe to replay offline.

The price of A is the `not_prepared` reversal path (Q-U1), and it is small. Option B stays a written variant (V3) in case the founder
prefers it.

### 3.3 Data model **[M1, step 3]**

**`order_line.uscita`**

```
alter table public.order_line add column uscita smallint;          -- no default: every existing row stays null (T1)
alter table public.order_line add constraint order_line_uscita_ck check (uscita between 0 and 9);
```

- Null means "a line from before uscite". After M5, only closed sessions' lines are null. The NOT VALID constraint added in M5 (§3.8)
  refuses null for every later insert or update (T2).
- **Lead ruling M5 (option a, 2026-11-18):** M5 (not M1) also sets `alter table public.order_line alter column uscita set default 1`.
  `SET DEFAULT` on an existing column rewrites no row and stores no missing value, so every row that exists before M5 keeps its null
  (§3.8). It is the one sanctioned Rule B exception for this column; the guard in §3.8 proves no app writer relies on it.
- The TS output allows `null` for those historical lines (a closed session of today still shows on the tile), and screens treat it as 1.

**`public.uscita_call`**

```
id               uuid primary key default gen_random_uuid()
tenant_id        uuid not null default app.tenant_id() references public.tenant (id)
table_session_id uuid not null
uscita           smallint not null check (uscita between 2 and 9)
called_at        timestamptz not null
called_by        uuid not null
cause            text not null check (cause in ('call', 'fire_now', 'migration'))
created_at       timestamptz not null default now()
constraint uscita_call_once_uq unique (tenant_id, table_session_id, uscita)
constraint uscita_call_session_fkey foreign key (tenant_id, table_session_id) references public.table_session (tenant_id, id)
constraint uscita_call_called_by_fkey foreign key (tenant_id, called_by) references public.app_user (tenant_id, id)
```

- **Causes:**
  - `call`: "Via la n";
  - `fire_now`: a `fire` without `hold`, i.e. every op an old bundle sends (§3.5);
  - `migration`: M5.

  PR5 adds `kitchen` (M9).
- **Append-only:** `app.append_only` (update and delete; it honours the ADR-018 demo purge) and `app.append_only_truncate`.
- **RLS:** on. The policy `uscita_call_select` is `for select to authenticated using (tenant_id = (select app.tenant_id()) and (select
  app.role()) in ('owner', 'admin'))`, as `order_line`.
  - `select` is granted to `authenticated` and `service_role` (lesson 2), with no insert, update or delete grant.
  - Waiters and the chef read calls only through the definer reads (board, tables, order view).
- **Demo purge:** `app.demo_purge_tables()` is re-created with `uscita_call` immediately before `kitchen_event`. It is a child of
  `table_session` and `app_user`. Pin 229:22 requires `kitchen_event` immediately before `order_line_cost`, which this keeps.
- **Not configuration:** it is operational data, so `app.tenant_has_operational_data` counts it through the purge list.

**The guard** `app.order_line_guard` is re-created from `20261130100000:94` verbatim, plus one rule:
- `uscita` may change freely on a draft;
- on a fired line, it may change only from null to a value (the M5 backfill), never from one value to another.

**Helpers (M1), all `app.`, `search_path = ''`, closed to every API role:**
- `app.uscita_default(p_course public.course) returns smallint`, immutable: `0` for `bevande`, else `1`.
- `app.order_uscita(p_val jsonb) returns smallint`, immutable: a JSON integer from 0 to 9, else `invalid_request` (22023).
- `app.held_lines(p_tenant uuid, p_session uuid, p_uscita smallint) returns setof uuid`, stable: the held, non-voided line ids of one
  uscita, by id. It is used by `call_uscita` and the close guard.
- `app.line_held(p_tenant uuid, p_line public.order_line) returns boolean`, stable: the §3.1 rule for one row. It is used by `void_line`
  and `kitchen_mark_line`.

### 3.4 Order entry **[M2, step 4]**

- **`add_order_line`** (re-created from `20261130100200:60–217`):
  - The allowed keys gain `uscita`. It is optional; `uscita` together with `segue` → 22023.
  - Value:
    - `uscita` given → it;
    - else legacy `segue: true` → 2;
    - else `app.uscita_default(final course)`.
  - **Mirror:** `segue := (uscita >= 2)`, written in the same insert. Old bundles and every legacy reader keep seeing the truth.
  - The replay answer (`order_add_replay`) stays first, unchanged.
- **`update_order_line`** (re-created from `:219–367`):
  - `uscita` joins the patchable keys.
  - Legacy `segue` maps as above (`false` → the default of the line's course after the patch).
  - `segue` is mirrored. `v_same` includes `uscita`.
  - A fired line still answers the conflict `fired` (unchanged).
- **`app.order_line_json`** (re-created from `:35–58`): gains `'uscita', p_line.uscita`. `segue` stays.
- **`app.apply_op_check_payload`** (re-created from `:369–392`) — the new and changed keys and kinds are in §3.12.

### 3.5 One send: `fire_course` with `hold` **[M3, step 5]**

`public.fire_course(p_session, p_body)` is re-created from `20261130100300:10–156`, with the same signature, locks, order and
depletion. The changes:
1. **Body:** `menu_keys_ok(p_body, array['lineIds', 'hold'], array['lineIds'])`. `hold` must be a JSON boolean (22023 otherwise); absent =
   `false`. The 1–50 bound stays: the client chunks, and the derived rule gives the same result whatever the chunking (§9.5).
2. **Depletion and cost:** unchanged, for every line it fires, held or not (§3.2 A).
3. **After depletion:**
   - with `hold = false`, it inserts one `uscita_call (cause 'fire_now', called_at = v_now, called_by = v_user)` for every distinct uscita ≥ 2
     among the fired lines that has no call yet (`on conflict do nothing`). This is today's meaning of "send" for every op queued by an
     old bundle, where "Invia a seguire" was the call.
   - with `hold = true`, it writes nothing more.
4. **Reply:** `{lines, fired, skipped, held}`. `held` is the ids of the fired lines that are held after this call (the §3.1 rule, read in a
   new statement).

**Single transaction:** unchanged. The call rows are inserted in the same transaction, after the depletion. They take no new lock
beyond the unique index.

### 3.6 The call: `public.call_uscita(p_session uuid, p_body jsonb)` **[M3, step 5]**

Definer, `search_path = ''`, `volatile`, executable by `authenticated` only.
1. `app.require_table_operator()` (owner, admin, waiter; the chef gets 42501 until PR5). Tenant from `app.tenant_id()`, user from
   `app.app_user_id()`.
2. `menu_keys_ok(p_body, array['uscita'], array['uscita'])`. `uscita` is a JSON integer from 2 to 9, else 22023.
3. Session `FOR SHARE`: none → P0002 `session_not_found`; closed → P0001 `session_closed`. The latter is already a sync conflict code,
   as for fire.
4. The held lines of `(session, uscita)` `FOR UPDATE`, in id order. **Lock order:** session SHARE, then lines UPDATE, the same as fire and
   void. That serialises a call with a concurrent `not_prepared` void of the same line.
5. If a call row exists (read in a new statement):
   - by the same user → `{changed: false, call, lines}`;
   - else `{conflict: {reason: 'already_called', uscita, calledAt}}`.
6. If no held, non-voided line exists → `{conflict: {reason: 'nothing_waiting', uscita}}`. This covers every dish voided, or a send that
   was rejected; nothing is written.
7. Else `insert … (cause 'call', called_at = clock_timestamp()) on conflict do nothing`. If that inserts nothing (a concurrent call won),
   go to 5.
8. **Reply:** `{changed: true, call: {uscita, calledAt, calledBy: {id, displayName}}, lines: [order_line_json of the uscita's lines]}`.
   There is no cost key.

**Errors:** 42501; 22023 `invalid_request`; P0002 `session_not_found`; P0001 `session_closed`. Conflicts are results, never raised, so no
DETAIL reaches the logs (ADR-019 rule).

### 3.7 Voids: `not_prepared` **[M4, step 7]**

- `app.order_void_reason_codes()` gains `'not_prepared'` (last, so the order of the six existing codes is kept).
  `app.void_waste_reason('not_prepared')` returns null.
- **No new stock or batch reason code is needed:**
  - a reversal row carries the reason of its original, which is null for `consume` and `consumption` (`stock_movement_shapes.sql:41–70`,
    `fire_core.sql:80–81`);
  - the shapes for `order_void` reversals already exist.
- **`void_line`** is re-created from `20261106100300:21–161`. After the line lock, in a new statement, it computes
  `v_held := app.line_held(...)`.
  - **Draft:** unchanged; any reason is accepted, `not_prepared` included, and no movement is written.
  - **Fired and held:**
    - reason ≠ `not_prepared` → `app.order_conflict('held', x)`;
    - else, for each unreversed `consume` row: the reversal (as today);
      - **if that batch's state is `discarded`**, also a `waste` row of the same portions (ref `order_void`) with the `reason_code` of
        the batch's latest `batch_discard` waste row;
      - otherwise no waste;
    - for each unreversed `consumption` row: the reversal only;
    - then settle the batches, as today.
  - **Fired and called:**
    - reason = `not_prepared` → `app.order_conflict('uscita_called', x)`;
    - else today's reversal + waste, unchanged.
- **Why the discarded-batch rule:**
  - `batch_settle_state` re-opens any batch whose remaining becomes positive (`batch_action_helpers.sql:87–88`). A plain reversal would
    resurrect a batch the chef threw away, with portions that no longer exist, and break the nightly `state` check.
  - Physically the portion went with the discard, so it stays waste, for the discard's own reason.
  - A `finished` batch that gets its portion back correctly becomes `open`: the portion was set aside and is still there.
- **Replay and conflicts:**
  - `{changed: false}` for the same reason by the same caller, as today.
  - `held` and `uscita_called` join `CONFLICT_REASONS`.
- **What stays:** the cost row (`order_line_cost`, append-only). The KPI, the forecast and AvT ignore voided lines and reversed
  consumption, so the plate leaves food cost and stock usage (§2.1 "Readers of voids").

### 3.8 Migrating open sessions in place **[M5, step 8]**

`app.uscite_backfill_open_sessions() returns jsonb` (definer, `search_path = ''`, closed to every API role) is called once by M5 and kept
for tests. It is idempotent: it touches only rows whose `uscita` is null, and calls `on conflict do nothing`.
1. `lock table public.order_line, public.uscita_call in exclusive mode`.
   - This blocks every write and every `FOR UPDATE`/`FOR SHARE` (fire, add, edit, void, call) for the few milliseconds of the backfill.
     Plain reads continue (T3).
   - The runbook still schedules the deploy outside service (step 12).
2. `update public.order_line l set uscita = case when l.segue then 2 when l.course = 'bevande' then 0 else 1 end from
   public.table_session s where s.tenant_id = l.tenant_id and s.id = l.table_session_id and s.closed_at is null and l.uscita is null`.
   - Every tenant is covered; closed sessions are excluded by the predicate.
   - The M1 guard allows null → value on fired lines, and `segue` is unchanged, so the mirror holds.
   - **A drink with `segue` true → 2:** it was held by its waiter, and stays held until called.
3. One call row per open session that has a **fired** (voided or not) uscita-2 line:
   - `called_at = min(fired_at)` of those lines, `called_by` = the `fired_by` of the earliest one, `cause 'migration'`;
   - every such line then has `fired_at >= called_at`, so its ticket instant is its `fired_at`: today's ticket, not "in attesa".
4. **Self-check, raising P0001 `uscite_backfill_failed` (the whole migration rolls back):**
   - any open-session line still has a null `uscita`;
   - any fired open-session line is held (none can be: segue drafts are unfired, and fired segue lines were just called);
   - the number of call rows written differs from the number of sessions found in 3.
5. Returns `{lines, calls}` (counts only).

Then M5 adds `alter table public.order_line add constraint order_line_uscita_set_ck check (uscita is not null) not valid` (T2). It is
**never validated**: closed sessions keep null by design, and pgTAP `423` pins `convalidated = false`.

**Default 1 (lead ruling M5, option a, 2026-11-18).** After the constraint, M5 runs
`alter table public.order_line alter column uscita set default 1` and
`comment on column public.order_line.uscita is '…'` (null = a line from before uscite; 0–9 = the uscita; the default 1 exists only so
that table-owner fixtures and tools that predate the column keep inserting; every app writer names `uscita` explicitly).
- The NOT VALID check stays: an explicit null is still 23514.
- `SET DEFAULT` writes no row and sets no `attmissingval`, so the rows that exist before M5 keep their null (proved in `423` from
  `pg_attribute`: `atthasmissing` false for `uscita`).
- **Rule B:** this is the one sanctioned exception for this column (a silent default). A new pgTAP guard (in `423`) proves no app
  writer relies on it:
  - `has_table_privilege(r, 'public.order_line', 'INSERT')` is false for `authenticated` and `anon`;
  - `service_role` keeps Supabase's table grant, so `tests/guards/` (Vitest) greps `src/` and `scripts/` and finds no direct
    `order_line` insert or upsert through the client (every write goes through the procedures);
  - a `pg_proc` scan of every function in `public` and `app` whose body inserts into `public.order_line` asserts, **per insert
    statement**, that each names `uscita`; a function whose body builds SQL with `execute` and mentions `order_line` fails the scan; a
    positive control (the scan finds `public.add_order_line`, so the set is non-empty) keeps an empty scan from passing;
  - each writer the scan finds refuses a null `uscita` (called with an explicit null where its payload admits the key, else with a
    payload that resolves to null), and no row is written.

**What is not touched:**
- every row of a closed session (no UPDATE; the column was added without a default, and M5's later `set default 1` rewrites no row);
- `segue`, `fired_*`, `voided_*`, every ledger row and every `order_line_cost` row.

G (`417`) proves the closed-session outputs (lines over today's columns, bills, KPI, ledgers, trace) do not move; that closed rows keep
null after M5 is proved by `423` (`atthasmissing` false, see above). The open kitchen tickets are remapped in M6 (§3.9), together with the board that reads them.

### 3.9 Kitchen board by uscita **[M6, step 13]**

**`kitchen_event`:**
- `add column uscita smallint check (uscita between 0 and 9)`.
- `kitchen_event_shape_ck` is re-created with three branches:
  - line events: unchanged, with `uscita` null;
  - legacy ticket events: unchanged, with `uscita` null;
  - **uscita ticket events:** `subject = 'ticket'`, `num_nonnulls(table_session_id, fired_at, uscita) = 3`, `course is null`,
    `segue is null`.

  Every existing row satisfies the first two, so the CHECK validates on add.
- New index `kitchen_event_uscita_ticket_idx (tenant_id, table_session_id, fired_at, uscita, seq desc) where subject = 'ticket' and uscita
  is not null`.

**Helpers:** the four keyed helpers are dropped (no cascade; their only callers are re-created in the same file) and created on the new key:
- `app.kitchen_ticket_key(jsonb)` returns `(session_id, fired_at, uscita)`. It parses `{sessionId, firedAt, uscita}`, with the same
  six-decimal UTC rule (`FIRED_AT_RE` parity).
- `app.kitchen_ticket_lock(tenant, session, at, uscita)` locks on `'kitchen:u:' || tenant || ':' || session || ':' || <instant text> ||
  ':' || uscita`.
- `app.kitchen_ticket_state(...)` and `app.kitchen_ticket_open_lines(...)` work on the new key.
- New `app.line_ticket_at(p_tenant, p_line public.order_line) returns timestamptz`, stable: the §3.1 instant, or null when the line is held.

**`app.kitchen_ticket_rows(p_tenant, p_at)`** is re-created with the same signature and ACL. It keeps M19 and M19b's candidate filter,
the done rule, the 200 cap, `truncated`, and "events after the instant are ignored".
- **Join and split:**
  - candidates are left-joined to `uscita_call` (`called_at <= p_at`);
  - held lines go to `waiting`, the others to tickets grouped by `(session, ticket_at, uscita)`.
- **Ticket JSON:**
  - key `"<sessionId>|<ticketAt>|u<uscita>"`; `sessionId`, `tableName`, `covers`;
  - `uscita` (0–9); `addition` (§3.1); `firedAt` (the ticket instant, the six-decimal text the mark body sends back);
  - `calledAt` (uscita ≥ 2, else null); `firedBy` (first line by id, as today);
  - `lineCount`, `doneCount`, `closedAt`, `closedBy`, `autoClosed`, `lines`.
  - Lines are ordered by `course` (enum order), then the existing status order (to make, voided, done), then `created_at` and id.
  - Each line gains `course`. There is **no `course` and no `segue` at ticket level.**
- **`waiting`:** `[{sessionId, tableName, uscita, lineCount, lines: [{id, name, qty, weightG, note, isShared, course}]}]`.
  - Held, non-voided lines only: a voided held line leaves the folded list (spec §7).
  - Ordered by table, then uscita. There is no `done` and no mark target.
- **Top level:** `remaining` (unchanged meaning: open lines of active tickets), new `waitingCount`, `tickets` (ordered by ticket instant,
  table, uscita, session), `closedTickets`.
- **No euro value;** every new key passes pgTAP `059`'s chef regex.

**`kitchen_mark_line`:** re-created on `app.line_ticket_at`. A held line → P0001 `line_held` (TS 409); nothing is written. Auto-close
and auto-reopen work on the new key.

**`kitchen_set_ticket`:** re-created. The body is `{sessionId, firedAt, uscita, closed}`. The legacy body (`course`, `segue`) is now 22023.
Kitchen screens are online-only and reload after the deploy (runbook, R6).

**Open tickets remap:** `app.uscite_kitchen_remap_open_sessions() returns jsonb`, idempotent, is called once by M6.
- For each open session and each new key whose lines' **legacy** keys all have `closed` as their latest event, it appends one uscita
  ticket event `closed`, with the `cause`, `created_by` and `created_at` of the latest of those closes.
- It skips any key that already has an uscita event.
- Legacy events are never updated. Closed sessions are not read.

`public.kitchen_tickets` and `app.kitchen_board_json` are **not** re-created (pins 222:37, 229:53 stay).

### 3.10 Waiter reads **[M7, step 17]**

- **`app.session_uscite(p_tenant, p_session_ids)`** (new, stable, closed to API roles) returns `(table_session_id, cooking smallint,
  waiting smallint, cooking_done boolean)` over fired, non-voided lines with uscita ≥ 1:
  - `cooking` = the highest uscita among the non-held ones;
  - `waiting` = the lowest held uscita;
  - `cooking_done` = every non-held line of `cooking` is done (`app.kitchen_line_done`).
- **`public.tables_list`** (re-created from `20261205100000:23–91`): every session object gains `'uscite'`, which is `{cooking, waiting,
  cookingDone}` or null when nothing of uscita ≥ 1 is fired.
  - `status` is unchanged (`courses_sent` stays in the API; retiring the word "Portate inviate" is the UI's, spec §4).
- **`app.session_unsent_lines`** (re-created from `:9–20`): `l.state = 'draft'` without `and not l.segue`. Every draft goes with the one
  send (spec §2.3, §4 row 1).
- **`public.order_view`** (re-created from `20261206100000:14–57`): it gains `'uscite'`, an array of `{uscita, state, calledAt, lineCount}`
  for every uscita ≥ 1 with fired, non-voided lines.
  - `state` is `waiting` (held), `done` (every line done), else `cooking`.
  - The order is by uscita.
  - Drinks and drafts are not in it: the sheet builds "Bevande · n inviate" and "da inviare" from the lines (spec §2.3).

### 3.11 Close guard **[M8, step 18]**

`app.close_session_at` is re-created from `20261206200300:9–92` verbatim, plus one block after the `unsent_lines` refusal (`:70–77`):
- held, non-voided lines (at most 50 ids, by `created_at`, id) → P0001 `uscita_waiting`, detail `{lineIds}`;
- nothing is written.

`public.close_table` is not re-created. A session without held lines closes exactly as today: G's `bill_closed` and `day_report` are
unchanged.

### 3.12 Sync and outbox

**Kinds and payloads (M3, step 5; TS step 10)**

| Kind | Status | Payload keys (required **bold**) | Dispatch |
|---|---|---|---|
| `add_line` | changed | **sessionId, lineId, menuItemId**, qty, course, `uscita` (new), segue (legacy), note, isShared, weightG | `add_order_line` (§3.4) |
| `edit_line` | changed | **lineId**, qty, course, `uscita` (new), segue (legacy), note, isShared, weightG | `update_order_line` |
| `fire` | changed | **sessionId, lineIds**, `hold` (new, boolean) | `fire_course(sessionId, {lineIds, hold?})` |
| `call_uscita` | **new** | **sessionId, uscita** | `call_uscita(sessionId, {uscita})`; the 120 s future bound is enforced with `parse_client_time`, as for fire |
| `open_table`, `remove_line`, `void_line` | unchanged | as today (`void_line`'s `reason` now admits `not_prepared` through the reason list) | unchanged |

- `app.sync_op_kinds()` appends `call_uscita`, last, so the order is kept. The TS mirror `SYNC_KINDS` and the parity test follow.
- `applied_op_kind_ck` reads the function, and every stored kind is still in the list.
- `public.apply_op` is **not** re-created: it reads the kind list, and `stop` stays `open_table`/`add_line` only. A failed call creates
  nothing later ops depend on.

**Replay guarantees**
- **Exactly once:** `applied_op` deduplicates by op id (`apply_op.sql:151–164`). A different op for the same call meets the unique
  `(session, uscita)` and answers `changed: false` or the conflict `already_called` (§3.6).
- **A call never runs before its own send:**
  - the outbox replays in `seq` order (`syncBody` refuses a non-increasing `seq`, `src/server/sync/schemas.ts:70–72`);
  - an infrastructure failure stops the batch (`apply.ts:92–97`);
  - if the send was refused, the call answers `nothing_waiting`.

  That is a client and route property: the server cannot see "its own send" (§9.6).
- **Old queued ops keep their meaning:**
  - `edit_line {segue}` → uscita 2/default;
  - `fire` without `hold` → fire and call, exactly as "Invia a seguire" did;
  - `add_line` never carried `segue` (`src/lib/sync/ops.ts:50–60`) and gets the default.

  Nothing queued today is refused because of this change.

**Versions (step 10)**
- **`X-Sync-Version`:** the new bundle sends `2` from `src/pwa/send.ts`. A request without the header is version 1, and `applyOps` then
  **down-shapes** each result before the strict output parse:
  - lines lose `uscita`; the fire reply loses `held`;
  - the conflict reasons `held`, `uscita_called`, `already_called` and `nothing_waiting` become `stale` (an old bundle shows its generic
    "changed by someone else" notice and refetches).

  `call_uscita` cannot come from version 1. The v1 output schema is today's schema, frozen in `src/server/sync/output-v1.ts`.
- **Stored-reply upgrade:** `storedOf` (`results.ts:78–85`) runs `upgradeStored(kind, result)` before the strict parse:
  - a line without `uscita` gains `uscita: null` (it predates uscite; no value is invented);
  - a fire reply without `held` gains `held: []`.

  Everything else stays strict: an unknown key still throws.
- **IndexedDB:** no schema change. `osteria-sync` stays version 1, because ops are stored with free payloads.

**Client sync logic (B1, step 10; not UI):**
- `src/lib/sync/ops.ts`: `addLineDraft` and `editLineDraft` carry `uscita`; `fireDrafts` gains `hold`; new `callUscitaDraft`, labelled for
  the "Chiamata in coda" notice.
- `src/lib/sync/overlay.ts`: `FIELDS` gains `uscita`, and a queued call marks its uscita "in coda".
- `src/lib/sync/prune.ts`: a queued call whose session died is dropped with the session's other ops, as today.

### 3.13 API shapes

- `POST /api/table-sessions/:id/fire` body `{lineIds, hold?}` → 200 `{lines, fired, skipped, held}`.
- **New** `POST /api/table-sessions/:id/call` body `{uscita}`:
  - 200 `{changed, call, lines}`;
  - 409 `conflict` with `{reason: already_called | nothing_waiting, uscita}` (the void route's conflict pattern, `src/server/orders/void.ts`);
  - 404, 403 or 422 as the order routes.

  `withApi({roles: ["owner","admin","waiter"]})`; strict Zod; 1 KiB body; not offline-cacheable.
- `POST /api/order-lines/:id/void` reasons gain `not_prepared`; new 409 reasons `held`, `uscita_called`.
- Line shape: `+ uscita: 0..9 | null`. `segue` stays in the TS shape until Q9's cleanup.
- `GET /api/table-sessions/:id/lines` (order view): `+ uscite[]`. `GET /api/tables`: `session.uscite`.
- `GET /api/kitchen/tickets` and the two mark replies: §3.9 shape. `POST /api/kitchen/tickets/mark` body `{sessionId, firedAt, uscita,
  closed}`. `POST /api/kitchen/lines/:id/mark`: new 409 `line_held`.
- Close: new 422 `uscita_waiting` with `details.lineIds`, mapped like `unsent_lines`.

### 3.14 The UI side (B2), spec sections → steps

| Spec | What B2 builds | Step |
|---|---|---|
| §3 kitchen card, §3.2 count, §6 kitchen rows, §10 checks 1–3 | `ticket-card.tsx` by uscita: category labels when an uscita mixes courses; folded "poi · 2ª uscita · in attesa" from `waiting`; "Chiamata 21:02" for one minute from `calledAt` vs `asOf`; "aggiunta"; "Da fare: 7 · in attesa: 4"; accessible names | 15, 16 |
| §2.1–§2.4, §2.6, §6 sheet rows, §7, §10 checks 1, 6, 7 | sheet grouped by uscita, current uscita, "+ Segue", the editor's Uscita control (and "Subito" for drinks), one "Invia comanda · n" (`hold: true`, every draft, chunked), "Via la 2ª", folded rows and their states, the leave sheet's one line | 20, 22 |
| §2.3 "Storna", §8.7 dialog | void dialog: a held line offers only "Non preparato" (and says the dish goes back to stock); a called line shows today's reasons | 21 |
| §4 tile | progress line from `session.uscite` | 21 |
| §5 offline states | "in coda", "Chiamata in coda", the conflict wording, reading the overlay of step 10 | 21, 22 |

Presentation helpers stay pure and compute no stock and no price: `src/lib/orders/{order-view,fire-view,line-form}.ts`,
`src/lib/kitchen/{kitchen-view,kitchen-done}.ts`, `src/lib/tables/table-view.ts`. Every screen reads `/api/*` JSON.

### 3.15 Pins that move (each commented "re-pinned on purpose by comanda-uscite (step N; was <old>)")

Found by grep on `supabase/tests` (md5 pins and function names). The builder re-greps in step 0 and adds any pin found then, including
those opening stock adds when it merges first.

| File:line (main) | Object | Step |
|---|---|---|
| `179:56`, `229:43` | `app.order_line_guard` | 3 |
| `222:8`, `229:8`, `240:16`, `255:54`, `359:102`, `:112`–`113` (`demo_purge_tables` md5 and cardinality; lead 2026-11-18, cited as `359:94`); `193`/`194` purge lists | `app.demo_purge_tables` (+ `uscita_call`) | 3 |
| public table lists `229:66–67`, `286:51–52`, `207` t16, `214` t14, `229` t27, `296` t25; `365` table/trigger/policy counts; `359` `p27_objs` (a **separate** insert) | `uscita_call` | 3 |
| `179:65`, `222:33`, `255:30` | `public.add_order_line` | 4 |
| `179:73`, `222:43` | `public.update_order_line` | 4 |
| `179:57`, `214:467`, `229:42` | `app.order_line_json` | 4 |
| `214:461` and `:480`, `222:36`, `229:32`, `240:49`, `255:34` | **`public.fire_course`** | 5 |
| `222:31`, `229:46`, `327:116` ("no new op kind") | `app.sync_op_kinds` | 5 |
| `222:25`, `229:39`, `286:31`, `296:19`, `301:19` | `app.apply_op_dispatch` | 5 |
| `327:125–128`, `346:64–68`, `229:72–73` (public catalogue left-outs) | + `call_uscita` | 5 |
| `214:474`, `222:45`, `229:33`, `240:53`, `255:39` | **`public.void_line`** | 7 |
| `tests/parity/fire-sql-parity.test.ts` | `VOID_REASONS` + `not_prepared` | 7 |
| `229:52` | `app.kitchen_ticket_rows` | 13 |
| `222:41`, `229:37`, `296:29` | `public.tables_list` | 17 |
| `367:127` | `app.session_unsent_lines` | 17 |
| `179:69`, `222:39`, `229:36` | `public.order_view` | 17 |
| `389:130` (SP1 **G**: `tables_list` payload md5) | gains `session.uscite` (null for G's sessions with no uscita ≥ 1 fired; the md5 moves because the key exists) | 17 |
| `229:40`, `240:33`, `286:11`, `296:11`, `301:11` | `app.close_session_at` | 18 |
| `tests/config/m25-preserves.test.ts:23`, `m25a-preserves.test.ts:29`, `ux-quick-wins-preserves.test.ts:13`, `m25b-preserves.test.ts:177` | newest migration / `ALLOWED_NEW_MIGRATIONS` | every migration step |
| `tests/guards/waiter-weight-no-cost.test.ts` route list | `POST /api/table-sessions/:id/call` | 9 |
| `tests/parity/sync-sql-parity.test.ts` | `SYNC_KINDS` + `call_uscita` | 10 |

**Pins outside the list above, found by the full runs and re-pinned on purpose with the lead's approval (2026-11-19).** Each is a direct
consequence of an object this plan re-creates, and each carries a "re-pinned on purpose by comanda-uscite (step N; was …)" comment:

| File:test | Object | Step |
|---|---|---|
| `280:79`, `290:109`, `296:27`, `362:41`, `359:113` | purge-list count 61 → 62 (`uscita_call`) | 3 |
| `327` t4 and t7 | `app.order_line_guard`, `app.demo_purge_tables` md5 | 3 |
| `346` t1–t2 | `app.demo_purge_tables` in its "must stay twelve" | 3 |
| `004`, `059`, `193` fixtures | a `uscita_call` row (every public table / every purge-list table has rows) | 3 |
| `161:39`, `163:14`, `166:10`, `172:13`, `322:60` | the line JSON key set gains `uscita` | 4 |
| `327` t4 | `add_order_line`, `update_order_line`, `order_line_json`, `apply_op_check_payload` | 4 |
| `172:14` | the fire reply gains `held` | 5 |
| `208:31`, `218:24`, `222:21`, `229:22` | the kind list gains `call_uscita` | 5 |
| `327` t2, t4, t8, t13; `346` catalogue; `359:3` (`fire_course`) | the M3 objects and the public catalogue (`call_uscita` left out) | 5 |
| `171` t1, t3 | the void reason list gains `not_prepared` (no waste code) | 7 |
| `359:3` (`void_line`); `327` t2 | `public.void_line` | 7 |
| `418` | the step-5 rows move into a savepoint (the default 1 of M5 refuses the old value → value update) | 8 |
| `tests/config/m19b-preserves.test.ts` | `SYNC_KINDS` + `call_uscita` | 10 |
| `tests/server/sync/output.test.ts` | main's snapshot now pins `syncOutputV1` (unchanged); v2 has its own | 10 |
| `175`, `224`, `225`, `226`, `227`, `228`, `230` (the M19 and M19b kitchen files; step 13 first named them `231`–`233`, corrected by the lead 2026-11-19) | the ticket key `(course, segue)` → `(instant, uscita)`: fixture lines placed as M5 places old lines (segue → uscita 2 with a `migration` call; where one table sends several courses at one instant, one uscita per legacy comanda), bodies and events carry `uscita`, the key sets gain the new keys | 13 |
| `324` t9, t12 | one ticket per uscita (was per course); the kitchen line gains `course` | 13 |
| `327` t4 | `app.kitchen_ticket_rows` | 13 |
| `359` t8, t12; `p27_objs` (a separate insert) | the four keyed kitchen helpers re-keyed, `kitchen_event_shape_ck` re-created; `kitchen_event.uscita`, its CHECK, `kitchen_event_uscita_ticket_idx`, `app.line_ticket_at`, the remap | 13 |
| `scripts/test-db-races.sh` (`kitchen-close-twice`) | the ticket body carries `uscita` | 13 |
| `tests/integration/firing.int.ts` | the ticket key text | 13 |
| `tests/server/kitchen/*`, `tests/app/api/kitchen-*.test.ts`, `tests/lib/kitchen/*`, `tests/components/{ticket-card,kitchen-page,closed-section}.test.ts`, `tests/helpers/kitchen-data.ts` | the board, body and heading shapes (step 14; the `src/lib/kitchen` heading and body only, no `.tsx` change: lead 2026-11-19) | 14 |
| `e2e/kitchen.spec.ts`, `e2e/simulation/service.spec.ts` (PR 3) | a ticket is one uscita: found by the course of its line (was `ticket.course` and the key text `\|primi\|`); the close notice names the uscita ("1ª uscita", was "Primi") | 13 |
| `157` t4, `367` t7 | the session key set gains `uscite` | 17 |
| `166` t8 | the order view's top-level keys gain `uscite` | 17 |
| `179` t2, t20; `214` t7; `327` t2 | `public.order_view` (md5 of the definition) | 17 |
| `367` t2, t3, t8, t17, t20–t22 (+ one new case: a session whose only draft is a segue draft shows 1) | `app.session_unsent_lines` counts every draft: "a segue draft counts in unsentCount" | 17 |
| `389` t7 (+ one new check: the payload without `session.uscite` is the old pin byte for byte) | SP1 G's sessions have fired uscita-1 lines, so `uscite` is an object there, not null | 17 |
| `359` `p27_objs` (a step-17 insert) | `app.session_uscite` | 17 |
| `301` t2; `327` t2 | `app.close_session_at` | 18 |
| `301` t17 | `public.tables_list` | 17 |
| `tests/integration/menu-tables.int.ts` ("BQ-1: the unsent count of a tile", lead 2026-11-19) | a segue draft counts in unsentCount: 1 → 2, and the one send fires both drafts | 17 |

**Must stay unchanged (asserted again by `424`):**
- `app.freeze_line_cost` (`240:36`);
- `app.ledger_checks_body` (`196:51`, `222:29`, `229:48`, `240:38`);
- `app.session_bill_json` (`240:44`);
- `public.apply_op` (`222:34`, `229:38`, `296:20`, `301:20`);
- `public.kitchen_tickets` (`222:37`, `229:53`);
- `public.remove_order_line` (`165:242`, `222:40`);
- `app.session_fired_lines` (`159:64`, `169:99`, `179:77`);
- `app.deplete_line_batches`, `app.post_plate_raw_outflow`, `app.post_stock_outflow` (`093`, `098`), `app.batch_settle_state`;
- `app.kpi_sales_lines`, `app.forecast_portion_lines`, `public.trace_order_line`, `app.app_vs_register_json`, `public.close_table`;
- SP1 G `389` `bill_open`, `bill_closed`, `day_report`; SP1 X `390`; opening stock's pgTAP `407`–`416` once merged.

**Any other failing pin is a stop. Report it to the lead; do not re-pin it silently.**

### 3.16 Security, privacy, RLS, secrets

- **Tenant boundary:**
  - `uscita_call` and `kitchen_event.uscita` carry `tenant_id`, with RLS owner/admin and no write grant.
  - Every procedure takes the tenant from `app.tenant_id()` and filters every statement by it.
  - X (`418`) covers calls, voids, the board, the tables summary and sync ops across Demo A and Demo B.
- **Roles in Postgres:**
  - `call_uscita`: `require_table_operator` (chef 42501 until PR5).
  - Marks: `require_kitchen_marker`; reads: `require_kitchen_reader` and `require_service_reader`, as today.
  - The route roles mirror them and answer 403 before any RPC.
- **Waiters never see costs:**
  - no new key is a cost;
  - `uscita_call` holds no money;
  - the `not_prepared` path reads `order_line_cost` nowhere;
  - the new route joins `waiter-weight-no-cost.test.ts`;
  - the kitchen keys pass `059`.
- **Ledgers append-only:**
  - `uscita_call` and `kitchen_event` are insert-only;
  - `not_prepared` writes reversals (and, for a discarded batch, waste), never an update or delete;
  - M5's only UPDATE sets a null column on open-session lines through the guard's single sanctioned transition;
  - the preserves test refuses any other `update`, `delete`, `truncate`, `disable trigger` or `drop … cascade` in the range.
- **Single transaction:** `fire_course`, `call_uscita`, `void_line`, the marks and `close_session_at` are each one function call.
  - Lock order everywhere: session, then lines by id, then stock locks, then batch rows. The call takes the first two only.
  - Races in step 6.
- **Input validation:** strict Zod, and SQL repeats every check: uscita range, hold type, key lists. The bodies are 1–4 KiB.
- **Personal data:** `uscita_call.called_by` is a staff id, like `fired_by`, with the same retention as order lines (project Q14) and the
  same demo purge. No customer data. Logs carry codes only.
- **Secrets:** none new.
  - No `src/` code of this plan uses the Supabase secret key.
  - The integration and e2e helpers keep using the local stack's `SUPABASE_SECRET_KEY` (in `.env` locally, gitignored; in the Vercel
    environment otherwise), as the existing suites do.
  - No third-party key or login.
- **SP6 later:** `call_uscita` is volatile and executable by `authenticated`, so SP6's write gate will require `app.require_writable()`
  there, as in the other order procedures.

### 3.17 Multi-tenant compatibility, the migration range and the merge order

- **No tenant-#1 literal:** every rule is per tenant, and the preserves scanner refuses a uuid literal in the range.
- **Range (lead ruling, 2026-11-18): `20261206220000`–`20261206220900`.**
  - M1–M8 are `220000`–`220700`, M9 (PR5) is `220800`, and `220900` is free for review fixes.
  - It sorts after main's newest (`20261206200400`) and after opening stock's `2026120621*`.
  - It sorts before SP2's `20261207100000` and SP3's `2026120810*`. P2-4 is renumbered later, after this range.
- **Merge order (lead ruling): opening stock → comanda uscite → P2-4 → SP2 (`20261207100000`).**
  - `supabase db push` runs without `--include-all`, so our files must reach `main` after every opening-stock file and before any P2-4 or
    SP2 file.
  - Within this plan: PR2 → PR3 → PR4, because M5 < M6 < M7.
  - **PR5 (M9, after P0) comes later than P2-4 and SP2 by its date.** Its `220800` file would then be older than files already on main,
    so it is renumbered at that time (V5).
- **Guards:** `sp1-preserves` claims `20261206200*`, `ds-bq2-preserves` claims `2026120610*`, and P2-4's old `p24-preserves` claimed
  `2026120621*` (now opening stock's, and P2-4 will move). None claims `2026120622*`.
- **pgTAP `417`–`430`** (P2-4 `397`–`406`, opening stock `407`–`416`).

---

## 4. Alternatives considered

- **Deplete at the call (B).** Rejected for the base plan (§3.2): cost not frozen at sale, the last portions can be sold twice, shortages
  surface mid-service, and the bill, state and order view all move. It is kept as **V3**.
- **A stored `held` flag or state on `order_line`.** Rejected: it changes the generated `state` used by the bill token, needs an update
  of fired lines at every call (the guard forbids it), and must be kept in step. The derived rule needs one indexed lookup.
- **An uscita table with its own lifecycle (`uscita (session, n, status)`).** Rejected: it would duplicate what lines and calls already
  say, add a second idempotency key offline, and need a row per uscita created by the client.
- **Ticket key `(session, fired_at, uscita)` as the spec suggests.** Rejected: it splits a called uscita that gained a dish while waiting,
  and sorts the call at send time (§9.1).
- **A new op kind `send_comanda` instead of `fire + hold`.** Rejected: two procedures sharing the depletion body (one more pinned copy).
  One optional key keeps every old op exact.
- **Refusing old queued ops (dropping `segue` and `fire` without `hold`).** Rejected: the waiter's queued dishes would be lost and
  re-typed mid-service. Mapping them is a few lines and is tested.
- **Disabling the line guard (`alter table … disable trigger`) for the backfill.** Rejected: it takes an ACCESS EXCLUSIVE lock and
  leaves a window with no guard. The one-way null → value rule is narrower and testable.
- **A default on the ADD COLUMN, or a backfill of every row.** Rejected (M1's column is added without a default; M5's later `set default 1`, the lead's M5 ruling in §3.8, is not this: `SET DEFAULT` invents no value for an existing row): it writes or invents values for tenant #1's closed history. Null
  plus a NOT VALID check keeps history untouched.
- **A new waste or stock reason "not_prepared".** Rejected: a dish not cooked is not waste. Reversals already carry no reason, and the
  void reason on the line records why.
- **`audit_event` rows for calls.** Rejected (flag 5): it moves the audit CHECK pins for a fact the call row already records, with who
  and when.

---

## 5. Build plan

**Rules for every step:**
- Test first: write the named test, see it fail for the stated reason, then change the code. One commit per step.
- A test-only step names its **proof**: a mutation case that must fail, or the tree on which it fails.
- Every step ends with `npm run lint`, `npx tsc --noEmit`, `npm test` and `npx supabase test db` green. Migration steps also run
  `scripts/test-db-native.sh`.
- **[MIGRATION]** marks a step that adds a migration file; the lead reads it line by line.
- **[UI-only]** marks a step B2 may own.
- Each migration step adds its file to `tests/config/uscite-preserves.test.ts` (created in step 3). That test asserts that:
  - the `2026120622*` files are exactly the steps built so far, sorted, after every opening-stock file (`2026120621*`) and before
    `20261207100000`;
  - they contain no `delete from`, `truncate`, `drop … cascade` or `disable trigger`;
  - they contain no `update` except M5's one statement on `public.order_line` with the `closed_at is null and l.uscita is null` predicate,
    and the guard function body;
  - they contain no uuid literal outside comments, no `cron.schedule`, and no new public name matching `cost|margin|price|service`;
  - they re-create none of the §3.15 "must stay" objects.

**PR split**

| PR | Steps | What | Owner | Size |
|---|---|---|---|---|
| **PR1** Baseline | 0–2 | G and X on main, tests only | B1 | S |
| **PR2** Write path and sync | 3–12 | M1–M5; TS domain and the call route; sync kinds, legacy mapping, version header, stored upgrade; integration suite; ADR-049 and runbook. **Backward compatible:** today's UI and every queued op keep working, and no held line can exist until PR4's UI sends `hold: true` | B1 | L |
| **PR3** Kitchen | 13–16 | M6, kitchen TS, the kitchen card (B2), Playwright kitchen (B2) | B1 + **B2** (15, 16) | M |
| **PR4** Waiter sheet | 17–23 | M7, M8, waiter TS, the sheet, rows, dialog and tile (B2), Playwright waiter and offline (B2), verification and hand-off | B1 + **B2** (20–22) | L |
| **PR5** Kitchen "Via" (**after P0**, Q-U3) | 24–25 | M9 (chef may call), the kitchen button (B2) | B1 + **B2** (25) | S |

**Order:** opening stock's PRs → PR1 → PR2 → PR3 → PR4 → (P2-4, then SP2) → PR5 after P0. PR1 holds no migration, so it may merge at
any time. PR4 completes the feature and must merge before go-live (Q-U4).

| # | Step (one commit) | Files | Test that proves it (the first one fails first) |
|---|---|---|---|
| 0 | **Base check (no commit).** Confirm main's newest migration (opening stock's last `2026120621*` file once merged) and pgTAP; check that no `2026120622*` file and no pgTAP 417–430 exists on any branch the lead knows of; re-grep the pins of §3.15; read whether ADR-040's tenant export uses a fixed table list (if it does, step 3 adds `uscita_call` to it and to its test) | — | All suites green; the newest migration is opening stock's last file, or `20261206200400_tenant_locale_settings.sql` while opening stock has not merged (then PR2 waits for it, per the merge order) |
| 1 | **G: tenant #1 golden outputs** (characterization, before any change) | `supabase/tests/database/417_uscite_golden_tenant1.test.sql` | Built on `main`. **Fixture:** tenant-#1-shaped and fake, inserted as table owner. <br>• Closed sessions: lines in four courses, fired; one segue line fired by "Invia a seguire"; one voided after fire (`returned`); one draft voided `entry_removed`; done and closed kitchen events. <br>• One open session: drafts with segue false and true, a fired antipasto, a fired segue secondo, a fired drink, a closed ticket. <br>**Pins (md5):** <br>• the closed-session `order_line` rows over an **explicit list of today's columns**; <br>• `session_bill_json` of a closed and of the open session; <br>• `app_vs_register_json` without `asOf`; <br>• `kpi_sales_lines` and `kpi_items_json('owner', …)` for the day; <br>• `forecast_portion_lines`; <br>• the fixture tenant's `stock_movement`, `batch_movement`, `order_line_cost` and `kitchen_event` rows; <br>• `trace_order_line` of one closed line as owner; <br>• `ledger_checks_body` empty. <br>**Passes on main by design.** Proof: a mutation case in the same file (one closed line's qty changed by the table owner) makes the line md5 differ. The file stays unchanged through step 25 |
| 2 | **X: cross-tenant suite on Demo A/B** | `418_uscite_cross_tenant.test.sql` | On main: B's waiter `fire_course` on A's session → P0002; `void_line` on A's line → P0002; B's board and `tables_list` hold nothing of A's. **Passes on main by design.** Proof: a temporary policy letting B read A's `order_line` makes it fail. Steps 3, 5, 7, 13 and 17 add their B rows |
| 3 | **[MIGRATION M1] Uscita core** (§3.3) | `supabase/migrations/20261206220000_uscita_core.sql`; `419_uscita_core.test.sql`; `424_uscite_preserves.test.sql` (new); `tests/config/uscite-preserves.test.ts` (new); `tests/parity/uscite-sql-parity.test.ts` (new); the step-3 pins of §3.15; `418` (B rows) | **419 first test: "`public.uscita_call` exists with RLS on, and an insert of uscita 1 is refused with 23514" (fails: table missing).** Then: <br>• uscita 10 → 23514; <br>• a second row for the same `(session, uscita)` → 23505; <br>• update and delete → refused (append-only); <br>• owner and admin read their rows, waiter and chef read 0, B reads 0 of A's (X); <br>• no write grant to any API role; <br>• `order_line.uscita` exists and is null for **every** closed-session line of G's fixture (T1; holds until M5, re-pinned in step 8); <br>• the guard: on a draft 1 → 2 is allowed; on a fired line null → 1 is allowed and 1 → 2 is `order_line_fired`; **on a voided line null → 1 is allowed too (lead 2026-11-19): only `uscita`, only null → value, every other column unchanged, because M5's UPDATE covers voided open-session lines; any other change of a voided line is still `order_line_voided` (pinned in `419`)**; <br>• `app.order_uscita` refuses `"2"`, 1.5, −1, 10; <br>• `uscita_default('bevande') = 0`, else 1; <br>• the demo purge deletes `uscita_call` rows and keeps working (`193`); <br>• G (`417`) unchanged. <br>**424 first test:** "every §3.15 'must stay' function keeps the md5 computed in step 0". **Parity:** TS `USCITA_MIN/MAX`, `HELD_FROM = 2` and the causes equal the SQL literals |
| 4 | **[MIGRATION M2] Order entry with uscita** (§3.4) | `…20261206220100_uscita_order_entry.sql`; `420_uscita_order_entry.test.sql`; step-4 pins | **420 first test: "`add_order_line` with `{uscita: 2}` stores uscita 2 and segue true, and the reply line has `uscita: 2`" (fails: unknown key → 22023).** Then: <br>• no uscita, course primi → 1; course bevande → 0; <br>• legacy `{segue: true}` → 2; <br>• `uscita` + `segue` → 22023; <br>• `update_order_line {uscita: 3}` on a draft → 3 and segue true; `{uscita: 0}` → segue false; <br>• legacy edit `{segue: false}` on a drink → 0; <br>• on a fired line → conflict `fired`, unchanged; <br>• a same-stamp replay with the same uscita → `changed: false`; <br>• `apply_op_check_payload` accepts `uscita` for add/edit and still refuses an unknown key; <br>• `164`–`166` (M18 entry tests) green unchanged; G unchanged |
| 5 | **[MIGRATION M3] One send and the call** (§3.5, §3.6, §3.12) | `…20261206220200_uscita_fire_call.sql`; `421_uscita_fire_call.test.sql`; `425_uscita_sync_ops.test.sql`; step-5 pins; `418` (B rows) | **421 first test (AT1): "a fire of the founder's four lines with `hold: true` fires and depletes all four, freezes four cost rows, and `held` = the two secondi" (fails: `hold` → 22023).** Then: <br>• with `hold` absent the same fire inserts one `uscita_call (2, 'fire_now')` and `held` = []; <br>• `hold: "yes"` → 22023; <br>• a drink with `hold: true` is never held (AT4); <br>• a line added to uscita 1 after the send fires unheld (AT3); <br>• a line added to the waiting 2ª is held; <br>• `call_uscita(2)` → `changed: true`, one row, the reply lines are the 2ª's; the same user again → `changed: false`; another waiter → conflict `already_called` with `calledAt` (AT2); <br>• uscita 1 or 10 → 22023; <br>• all held lines voided → `nothing_waiting`, no row; <br>• closed session → P0001 `session_closed`; chef → 42501; B's waiter on A's session → P0002 (X); <br>• `freeze_line_cost` and the movements of held lines equal those of an unheld fire of the same lines (A: depletion at send). <br>**425 first test: "`apply_op` of a `call_uscita` op calls once, and the same op again answers `duplicate` with no second row" (fails: unknown kind).** Then: <br>• a second op id for the same call → applied `changed: false`; <br>• a legacy `fire` op without `hold` on segue lines → called (`fire_now`); <br>• a legacy `edit_line {segue: true}` op → uscita 2; <br>• a `call_uscita` with `uscita: 1` → stored `rejected invalid_request`; <br>• `214`'s perf case (10-line fire under 5 s) green |
| 6 | **Race cases** | `scripts/test-db-races.sh` (three cases appended) | CI `db-races`, existing cases unchanged. <br>• **`call-vs-not-prepared`:** s1 voids a held line `not_prepared` and parks; s2 calls the uscita and blocks on the line; after the gate, either the void committed and the call answers `nothing_waiting` (one line) or, in the reverse order, the void answers `uscita_called`; never both writes. <br>• **`two-calls`:** two waiters call the same uscita at once → one row, one `changed: true`, one `already_called`/`changed: false`, `no_deadlock`. <br>• **`fire-hold-vs-call`:** a fire with `hold` of a 2ª line and a call of the 2ª commit in either order → the line is not held afterwards, and its ticket instant is `greatest(fired_at, called_at)`. <br>**Proof:** in a scratch copy without the held-lines `FOR UPDATE` of §3.6 step 4, the first case lets both writes through and fails |
| 7 | **[MIGRATION M4] `not_prepared`** (§3.7) | `…20261206220300_uscita_void.sql`; `422_uscita_void.test.sql`; step-7 pins; `418` (B rows) | **422 first test (AT6): "voiding a held spezzatino `not_prepared` writes one consume reversal per original and no waste, and the batch remaining equals its value before the send" (fails: `void_reason_invalid`).** Then: <br>• raw lots back to their pre-send balance, reversal rows mirroring unit cost and lot; <br>• `reversal_mirror` and `fire_depletion` of `ledger_checks_body` stay empty; <br>• the line leaves `kpi_sales_lines` after the close; its `order_line_cost` row still exists; <br>• a held line whose batch was **discarded** since → reversal + waste with the discard's reason, and the batch stays `discarded` (`batch_state` check empty); <br>• a `finished` batch gets its portion back and is `open`; <br>• `not_prepared` on a called line → conflict `uscita_called`, nothing written; <br>• `returned` on a held line → conflict `held`; <br>• after the call, `returned` → today's reversal + waste (`175`–`177` green unchanged); <br>• replay → `changed: false`; <br>• B voiding A's line → P0002 (X) |
| 8 | **[MIGRATION M5] Open sessions in place** (§3.8) | `…20261206220400_uscita_open_sessions.sql`; `423_uscita_open_sessions.test.sql`; `419` (one assertion re-pinned); `tests/guards/` (the `order_line` client-write grep) | **423 first test (AT7): "on G's open session, after `app.uscite_backfill_open_sessions()`, the segue draft has uscita 2, the drink 0, the antipasto 1, and the fired segue secondo has a `migration` call at its own `fired_at`" (fails: function missing).** Then: <br>• no fired open-session line is held; <br>• a second run writes nothing and returns `{lines: 0, calls: 0}`; <br>• rows that existed before M5 keep null: `pg_attribute.atthasmissing` is false for `order_line.uscita` (the lasting proof of T1); G (`417`) unchanged (see the note below the table); <br>• **`419` re-pinned on purpose** (commented): its step-3 "null for every closed-session line of G's fixture" cannot hold once M5 is merged (fixture rows inserted after the migrations get the default), so it becomes "a fixture line inserted without `uscita` stores 1" and the T1 proof moves to `423`; <br>• an insert with an explicit null uscita now → 23514, and `order_line_uscita_set_ck.convalidated` is false (T2); <br>• **default 1 (lead ruling M5, option a):** `order_line.uscita` has default `1` and a column comment; a table-owner insert that omits `uscita` stores 1; <br>• **Rule B guard for the default:** INSERT on `order_line` is false for `authenticated` and `anon`; the `pg_proc` scan of `public`/`app` writers of `order_line` finds every one naming `uscita`, with the positive control (`public.add_order_line` found); each writer found refuses a null `uscita` and writes nothing; <br>• the self-check raises `uscite_backfill_failed` when a fixture fired open-session line would be held (built by inserting a 2ª line as table owner without a call); <br>• in a second connection, a `select … for share` on `order_line` waits while the function holds its lock, and a plain `select` does not (T3, native runner); <br>• the old UI path still works on the migrated session: a legacy fire of the segue draft calls 2 and depletes it |
| 9 | **TS write domain and the call route** | `src/server/orders/{constants,schemas,output,errors,fire,call}.ts`; `src/app/api/table-sessions/[id]/call/route.ts` (new); `tests/server/orders/*.test.ts`; `tests/app/api/table-session-call.test.ts` (new); `tests/guards/waiter-weight-no-cost.test.ts`; `docs/go-live/rate-limits.md` if `tests/config/rate-limits-doc.test.ts` asks for a row | **First test: "`callBody` refuses `{uscita: 1}` and `{uscita: 2, extra: 1}`" (fails: schema missing).** Then: <br>• `addLineBody` accepts `uscita` 0–9 and refuses it with `segue`; <br>• `fireBody` accepts `hold`; <br>• `orderLine` requires `uscita` (nullable); `fireOutput` requires `held`; <br>• `CONFLICT_REASONS` gains `held`, `uscita_called`; `VOID_REASONS` gains `not_prepared` (parity); <br>• the call route: waiter 200 with one RPC; chef 403 before any RPC; `already_called` → 409 with `uscita`; `session_closed` → its existing mapping; no money key (cost guard) |
| 10 | **Sync TS: kind, legacy, versions, client ops** (§3.12) | `src/server/sync/{constants,schemas,output,output-v1,results,apply}.ts`; `src/app/api/sync/route.ts`; `src/pwa/send.ts`; `src/lib/sync/{ops,overlay,prune}.ts`; `tests/server/sync/*.test.ts`; `tests/lib/sync/*.test.ts`; `tests/parity/sync-sql-parity.test.ts` | **First test: "a duplicate whose stored `add_line` reply is the exact pre-deploy line shape (no `uscita`) parses to 200 with `uscita: null`" (fails: strict parse throws).** Then: <br>• a request without `X-Sync-Version` gets lines without `uscita` and a fire reply without `held`, and the result passes the **v1 schema frozen from main**; a `held` conflict reaches v1 as `stale`; <br>• with `X-Sync-Version: 2` the full shape; <br>• `call_uscita` payload: `{sessionId, uscita}` strict; <br>• `sendOps` sends the header; <br>• `callUscitaDraft` builds the op with the "Chiamata" label; `fireDrafts({hold: true})` chunks 50 and keeps `hold` on every chunk; <br>• the overlay marks a queued call "in coda" and applies a queued `uscita` edit; <br>• `prune` drops a queued call of a dead session |
| 11 | **Integration suite (write path)** | `tests/integration/comanda-uscite.int.ts` (new) | **First test: "over the real routes, the founder's four lines fired with `hold: true` answer `held` = the two secondi, and `uscita_call` (read with the service role) has no row yet".** It is an end-to-end check of steps 3–10, so it passes once written. **Proof:** a mutation case in the same file (the helper sends `hold: false`) makes the `held` assertion fail. Then: <br>• `call` → 200, then 409 `already_called` for a second waiter; <br>• void `not_prepared` → the stock balances (through the existing stock read) are back to their values before the send; <br>• `/api/sync` v1 and v2 batches with a legacy fire and a call, replayed twice: one call row, the same results |
| 12 | **ADR-049 and runbook** | `docs/adr/adr-049-comanda-per-uscita.md` (status "proposed"; Q8); `docs/adr/adr-019-firing-and-voids.md` (a dated note: held lines are fired and `not_prepared` reverses; see ADR-049); `docs/runbook.md` ("Comanda per uscita": deploy outside service; then every phone and the kitchen screen closes the app and reopens it; how to read `uscita_call`; what `uscita_waiting` means) | `tests/config/runbook.test.ts` green; the ADR template's fields present; the ADR states the decision (§3.2 A, held derived, `not_prepared`), the rejected alternatives (§4) and when to revisit it: P0 shows frequent `not_prepared` voids, a founder answer to Q1/Q3/Q4 |
| 13 | **[MIGRATION M6] Kitchen board by uscita** (§3.9) | `…20261206220500_uscita_kitchen.sql`; `426_uscita_kitchen_board.test.sql`; `427_uscita_kitchen_marks.test.sql`; `229:52`; `418` (B rows) | **426 first test (AT1): "after the founder's send, `kitchen_ticket_rows` has one 1ª ticket with the Bruschetta (antipasti) line before the Tagliatelle (primi) line, and `waiting` has the 2ª with 2 lines" (fails: grouped by course).** Then: <br>• after the call: the 2ª is a ticket with `firedAt` = `calledAt` = the call instant, sorted after an earlier-sent table's ticket; <br>• a dish added to the 2ª while waiting joins that one ticket; one added after the call is a second ticket with `addition: true` (AT3); <br>• a drink ticket has uscita 0; <br>• `remaining` counts in-kitchen lines only, `waitingCount` = 2; <br>• a voided held line leaves `waiting`; <br>• the remap: G's open closed-ticket is closed under its new key, with the original `created_at` and `created_by`, and a second run appends nothing; <br>• legacy events unchanged; <br>• every key passes `059`; <br>• B's board has nothing of A's (X). <br>**427 first test: "`kitchen_mark_line` on a held line → P0001 `line_held`, no event" (fails: marks by course).** Then: <br>• marking every line of the called 2ª auto-closes it on the uscita key; undone reopens it; <br>• `kitchen_set_ticket {sessionId, firedAt, uscita, closed}` closes and reopens; the legacy body → 22023; <br>• `175`, `224`–`228`, `230` (M19 and M19b; this row first said `231`–`233`, which are KPI files: corrected 2026-11-19) adapted only in their key fields, each change commented |
| 14 | **TS kitchen domain** | `src/server/kitchen/{output,schemas,constants,marks,errors}.ts`; `tests/server/kitchen/*.test.ts`; `tests/app/api/kitchen-*.test.ts` | **First test: "`kitchenTicketsOutput` refuses a ticket with `course` or `segue` and accepts `uscita`, `addition`, `calledAt`" (fails: old shape).** Then: <br>• `markTicketBody` requires `uscita` and refuses `course`; <br>• `line_held` → 409; <br>• snapshot of a board fixture; no euro key |
| 15 | **[UI-only] Kitchen card by uscita** (spec §3, §6) | `src/app/(owner)/cucina/ticket-card.tsx` and the board page; `src/lib/kitchen/{kitchen-view,kitchen-done}.ts`; i18n keys (da approvare); `tests/lib/kitchen/*.test.ts`; `tests/components/ticket-card.test.ts` | `renderToStaticMarkup` with board fixtures. **First test: "a 1ª ticket mixing antipasti and primi renders the 'Antipasti' label, its line, then 'Primi' and its line" (fails: course header).** Then: <br>• the folded "poi · 2ª uscita · in attesa · 2 piatti" with `aria-expanded` and no "Fatto"; <br>• "Chiamata 21:02" while `asOf − calledAt < 60 s`, plain after; <br>• "1ª uscita · aggiunta"; <br>• "Da fare: 7 · in attesa: 4"; <br>• accessible names "Chiudi comanda: Tavolo 2, 1ª uscita"; <br>• no "A seguire" anywhere |
| 16 | **[UI-only] Playwright kitchen** | `e2e/kitchen-uscite.spec.ts` (new) | Test-only commit. **Proof:** fails on `main`. At 1280 × 800 and 360 × 740: seed the founder's send through the API, then the 1ª card with both dishes and the folded 2ª; a call through the API → "Chiamata …" then its own card; mark and close as today; high contrast. `e2e/kitchen*.spec.ts` green |
| 17 | **[MIGRATION M7] Waiter reads** (§3.10) | `…20261206220600_uscita_tables_order_view.sql`; `428_uscita_reads.test.sql`; the step-17 pins (incl. `389:130`, commented) | **428 first test (AT2): "`tables_list` for the founder's table after the send has `session.uscite = {cooking: 1, waiting: 2, cookingDone: false}`" (fails: no key).** Then: <br>• with both 1ª lines done → `cookingDone: true`; <br>• after the call → `{cooking: 2, waiting: null, …}`; <br>• a table with only drinks sent → `uscite` null; <br>• `unsentCount` counts a migrated segue draft too; <br>• `order_view.uscite` = `[{1, cooking}, {2, waiting}]`, then `done` when all are marked; <br>• no cost key on either payload (`004`/`059` role scans green); <br>• B sees only B's (X); <br>• SP1 `389`'s other pins unchanged |
| 18 | **[MIGRATION M8] Close guard** (§3.11) | `…20261206220700_uscita_close.sql`; `429_uscita_close.test.sql`; step-18 pins | **429 first test (AT8): "closing the founder's table with the 2ª waiting → P0001 `uscita_waiting` with the two line ids, and nothing written" (fails: the close succeeds).** Then: <br>• after the call it closes, and its bill equals the bill an all-at-once fire of the same lines gives; <br>• after voiding both `not_prepared` it closes, and the total excludes them; <br>• drafts still win first (`unsent_lines`); <br>• `394` (SP1 close codes) green; G (`417`) and `389` `bill_closed`/`day_report` unchanged |
| 19 | **TS waiter reads and close** | `src/server/tables/output.ts`; `src/server/orders/output.ts` (`orderViewOutput.uscite`); `src/server/bill/errors.ts`; tests | **First test: "`tablesOutput` refuses a session without `uscite`" (fails).** Then: <br>• `uscite` cooking/waiting 1–9 or null; <br>• `orderViewOutput.uscite` states enum; <br>• `uscita_waiting` → 422 with `lineIds` and the Italian message (da approvare) |
| 20 | **[UI-only] The sheet by uscita** (spec §2.1–§2.4, §2.6) | `src/lib/orders/{order-view,fire-view,line-form}.ts`; `src/app/(owner)/tavoli/comanda/*` (sheet, line row, line editor, send bar replacing `send-buttons.tsx`); i18n (da approvare); `tests/lib/orders/*.test.ts`; component tests | **First test: "`sheetUscite(lines, current)` groups the founder's drafts into 1ª [A, B], 2ª [C×2] and Bevande, with the 1ª current" (fails: helper missing).** Then: <br>• adding to the current uscita; "+ Segue" makes a new empty current one; an empty uscita disappears at send; <br>• **renumbering: the lowest sent uscita is always 1**; <br>• `sendAll` = every confirmed draft, `hold: true`, chunked 50; <br>• the bar primary order (Invia comanda · n, else Via la n, else none); <br>• the editor's Uscita control (1ª · 2ª · … · + nuova, "Subito" for drinks); <br>• no "Segue" toggle, no per-category send, no "Invia a seguire" |
| 21 | **[UI-only] Rows, call, void dialog, tile, leave sheet** (spec §2.3, §2.5, §4, §5, §6, §7) | `src/app/(owner)/tavoli/comanda/*`; the void dialog; `src/lib/tables/table-view.ts`; the tile; the leave sheet; i18n; tests | **First test: "the folded rows read '1ª uscita · in cucina · 2 piatti' and '2ª uscita · in attesa · 2 piatti' with a 'Via la 2ª' button" (fails).** Then: <br>• "pronta", "in coda", "Chiamata in coda" from the overlay; <br>• a held line's void offers only "Non preparato"; a called one offers today's reasons; <br>• the conflict "La 2ª uscita era già stata chiamata."; <br>• the tile lines of spec §4, with "2ª da chiamare" in `<strong>`; <br>• the leave sheet's one line |
| 22 | **[UI-only] Playwright waiter and offline** (spec §10) | `e2e/comanda-uscite.spec.ts` (new); `e2e/offline*.spec.ts` (extended) | Test-only commit. **Proof:** fails on `main`. At 360 × 740: <br>• the founder's example with "+ Segue" and "Invia comanda" as the only structure taps; <br>• the kitchen (second context) shows the 1ª and the folded 2ª; "Via la 2ª" → the tile "Ultima uscita in cucina"; <br>• an addition to the 1ª → "aggiunta"; <br>• offline: "Invia comanda" and "Via la 2ª" show "in coda" / "Chiamata in coda" and replay once each, in order; <br>• one primary in every state; targets ≥ 44 px; `expectPhoneFriendly` light and dark |
| 23 | **Verification and hand-off** | the PR descriptions | Full suites green; new TS coverage ≥ 80 %; `code-reviewer` PASS on each PR; AT1–AT9, G and X mapped to passing tests. **Staging:** before each migration PR, a `supabase db push --dry-run` lists only that PR's files, all newer than staging's newest; after PR2 deploys, `select app.uscite_backfill_open_sessions()` returns `{lines: 0, calls: 0}` (already run); one open test session on staging, created before the deploy with a segue draft, shows uscita 2 |
| 24 | **[MIGRATION M9] The chef may call (PR5, after P0)** | `…20261206220800_uscita_kitchen_call.sql` (renamed per V5 if newer files are on main by then); `430_uscita_kitchen_call.test.sql`; the `call_uscita` pins of step 5 re-pinned on purpose; `src/app/api/table-sessions/[id]/call/route.ts` roles; tests | **430 first test: "the chef's `call_uscita(2)` writes one row with cause `kitchen`" (fails: 42501).** Then: <br>• the `cause` CHECK gains `kitchen`; <br>• the chef's reply carries **kitchen-shaped lines** (no `unitPrice`), and passes `059`; <br>• the waiter's reply is unchanged; <br>• the route admits `chef`; a chef's call through `/api/sync` is still 403 (sync stays table-operator only) |
| 25 | **[UI-only] Kitchen "Via" button (PR5)** | the kitchen card; i18n; component test; `e2e/kitchen-uscite.spec.ts` (extended) | **First test: "the folded 2ª on the chef's board has a 'Via la 2ª' button (44 px) that posts `{uscita: 2}`" (fails).** Then: <br>• the waiter's tile updates on the next read; <br>• a conflict shows the spec's wording |

**G (`417`) through M5 (note, 2026-11-18).** G's fixture inserts `order_line` rows as table owner without naming `uscita`. Without a default, M5's NOT VALID check would refuse them (23514) and break G, which contradicted "G unchanged through step 25" and "closed-session lines are still null" in step 8. With the lead's M5 ruling (default 1), G's fixture rows get 1 after M5, G's pins (an explicit list of today's columns, without `uscita`) do not move, and the file stays unchanged. G no longer proves that closed rows stay null after M5, and neither can `419` (its fixture is inserted after every migration, so it is re-pinned on purpose in step 8): the lasting proof is `423`'s `atthasmissing` check.

**Acceptance tests → steps**

| Test | Steps |
|---|---|
| AT1 | 5, 13, 11, 22 |
| AT2 | 5, 17, 11, 22 |
| AT3 | 5, 13, 22 |
| AT4 | 5, 13 |
| AT5 | 5 (`425`), 6, 10, 11, 22 |
| AT6 | 7, 6, 11, 21 |
| AT7 | 8, 13 (remap) |
| AT8 | 18 |
| AT9 | 2, extended in 3, 5, 7, 13, 17 |
| G | 1, kept unchanged by 3–25 |
| X | 2, extended as above |

**Order that keeps tenant #1 working at every commit:**
- Steps 1–2 add tests only.
- Steps 3–8 add a column, a table and procedure options that today's UI never uses; old ops keep their meaning, and no held line can exist.
- Steps 9–12 add API and sync code that answers old bundles in their own shape.
- Steps 13–16 change the board and its card together.
- Steps 17–22 change the waiter reads, the close guard and the sheet together.
- PR5 only widens a role.

### 5b. Variants

**V1 — A held dish voided stays waste** · Trigger: Q1 (= Q-U1) answered "waste as today" · Replaces: step 7 (M4) and the `not_prepared`
parts of steps 9, 21 and 11.

| # | Step | Files | Test |
|---|---|---|---|
| V1.1 | **[MIGRATION]** No new reason. `void_line` is re-created only to answer, for a held line, exactly as for a called one (reversal + waste with the mapped reason); M4 is dropped from the range | `…220300_uscita_void.sql` (this content instead); `422` rewritten | pgTAP: voiding a held line `customer_changed` writes reversal + waste `over_production`, as `176` does for a fired line; `not_prepared` → `void_reason_invalid`; the KPI drops the line; the stock does not come back |
| V1.2 | The UI dialog shows today's reasons for held lines too | the void dialog; its test | component test: a held line's dialog lists the six reasons and no "Non preparato" |

**V2 — Drinks are always "subito"** · Trigger: Q2 (= Q-U2) answered "no escape hatch" · Replaces: the free uscita of drinks in steps 4,
9 and 20.

| # | Step | Files | Test |
|---|---|---|---|
| V2.1 | **[MIGRATION]** `add_order_line` and `update_order_line` refuse uscita ≠ 0 for `bevande` and uscita 0 for other courses (P0001 `uscita_invalid`) | new migration; `420` | pgTAP: a drink with uscita 2 → `uscita_invalid`; a primo with 0 → `uscita_invalid`; a course change on a draft re-defaults the uscita |
| V2.2 | The editor hides the Uscita control for drinks | `line-editor.tsx`; its test | component test: a drink's editor has no Uscita control |

**V3 — Deplete at the call** · Trigger: Q3 answered "deplete at the call" (option B, §3.2) · Replaces: steps 5 and 7, the close guard's
reason in step 18, and the bill pins.

| # | Step | Files | Test |
|---|---|---|---|
| V3.1 | **[MIGRATION]** `order_line.held_at timestamptz`, a guard rule (held lines frozen except `held_at` → `fired_at`), and `state` re-created with `held`. `fire_course` with `hold` writes `held_at` and no movement for held lines | new migration; `421` rewritten; `session_bill_json` and the bill-token G pins re-pinned on purpose | pgTAP: a held line has no movement and no cost row; its bill line has state `held`; the open bill total is unchanged |
| V3.2 | **[MIGRATION]** `call_uscita` fires the held lines through the existing depletion and cost body (a shared `app.fire_lines` helper extracted from `fire_course`), with every fire lock | new migration; `421`; the `fire_course` pins | pgTAP: the call depletes FEFO and freezes the cost at the call instant; a shortage at the call raises `negative_stock`; a race of two calls fires once |
| V3.3 | **[MIGRATION]** `void_line` on a held line writes no movement (like a draft), and `not_prepared` is not needed | new migration; `422` | pgTAP: a held void writes nothing in either ledger; stock is unchanged |

**V4 — A table may close with an uscita waiting** · Trigger: Q4 answered "allow the close" · Replaces: step 18 (M8) and step 19's
`uscita_waiting` mapping.

| # | Step | Files | Test |
|---|---|---|---|
| V4.1 | No M8; the runbook says that a waiting uscita is billed and stays depleted unless voided `not_prepared` before the close | `docs/runbook.md`; `429` rewritten | pgTAP: the founder's table closes with the 2ª waiting; the bill includes it; `close_session_at`'s pins stay unchanged |

**V5 — Migration order collision** · Trigger:
- opening stock has not merged when PR2 is ready (PR2 then waits, per the ruling); or
- a file newer than `2026120622*` (P2-4's new range, SP2's `20261207*`, SP3's `2026120810*`) reaches `main` while a migration of this
  plan is still unmerged — always the case for M9 (PR5, after P0).

Replaces: the file names of the unmerged migration steps (3, 4, 5, 7, 8, 13, 17, 18, 24) and the range rule of `uscite-preserves`.

| # | Step | Files | Test |
|---|---|---|---|
| V5.1 | Rename the unmerged files to the first free slot the lead assigns after main's newest, keeping their order and suffixes | those files; the newest-migration pins; `uscite-preserves.test.ts` | `uscite-preserves`: the unmerged files sort after every file on `main`; merged ones keep their names; `supabase db push --dry-run` on staging lists only our files |

**V6 — A send with nothing waiting calls its lowest uscita** · **Adopted by the lead (Q5, 2026-11-18), folded into step 5 and step 20.** The
lead's rule: the call happens when **no uscita of the table is waiting** (every earlier uscita has been called), whether or not its dishes
are done; it replaces the "every non-held line is done" condition of V6.1 below. Trigger as first written: Q5 answered "yes" (a dessert ordered after everything was
served should go at once) · Replaces: the hold rule of step 5 for that case, and step 20's bar logic.

| # | Step | Files | Test |
|---|---|---|---|
| V6.1 | **[MIGRATION]** `fire_course` with `hold: true` inserts a `call` row for the lowest uscita ≥ 2 among its lines when the session has no held line and every non-held, non-voided line of uscita ≥ 1 is done | new migration; `421`; the `fire_course` pins | pgTAP: after the 1ª is all done, a send of a dessert in uscita 2 → called at once, not in `waiting`; with the 1ª not done → held |
| V6.2 | **[UI-only]** The bar does not offer "Via la n" right after such a send | `src/lib/orders/fire-view.ts`; its test | unit test: after a send answered with `held: []`, the bar's primary is none |

---

## 6. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | Closed history changes (tenant #1) | no default on the ADD COLUMN (M5's later `set default 1`, lead ruling M5 option a, rewrites no row: `423`), no UPDATE outside open sessions, a NOT VALID check, and the Rule B guard that no app writer relies on the default (`423`); G (`417`) over explicit columns, bills, day report, KPI, ledgers and trace, unchanged through step 25 |
| R2 | The backfill misses or mis-maps a line, or runs while a waiter fires | an exclusive table lock, an idempotent function, a self-check that rolls back the migration, the deploy outside service (runbook); `423` |
| R3 | An old bundle cannot parse sync replies, or a pre-deploy duplicate answers 500 (§2.3) | `X-Sync-Version` down-shaping and the stored-reply upgrade (step 10); the runbook asks everyone to reopen the app after the deploy |
| R4 | An old queued op changes meaning (a held 2ª never called) | `fire` without `hold` = fire and call; `segue` mapped; tested in `425` and step 11 |
| R5 | A held dish is billed but never made | the close guard (M8); the tile's "2ª da chiamare"; Q4/V4 |
| R6 | An old kitchen tab sends the legacy mark body after PR3 | 22023 → a visible error; the runbook asks to reload the kitchen screen after the deploy; PR3 ships outside service |
| R7 | `not_prepared` used to hide waste (a cooked dish voided as "not prepared") | only held lines accept it (SQL), held lines cannot be marked done, and the call is monotonic; every void keeps its user and reason on the line, as today |
| R8 | A reversal into a discarded or expired batch | discarded → reversal + waste (§3.7); an expired-but-not-discarded batch reopens with its portion and is caught by the existing expiry alerts and discard flow |
| R9 | A `negative_stock` alert raised at the send stays after a `not_prepared` void | alerts are immutable (ADR-006); the reversal fixes the balance; the runbook says so |
| R10 | Rebase conflicts on shared pins (`179`, `214`, `222`, `229`, `240`, `255`, `359`, `365`, `389`) with opening stock (merging first) and P2-4 | SP1's union rules (add, never overwrite), written into each PR description; separate `p27_objs` insert; step 0 re-greps after opening stock merges |
| R11 | The merge order breaks `db push` | the lead's order (opening stock → comanda uscite → P2-4 → SP2); `uscite-preserves` checks the range against main; V5 for PR5 and any slip |
| R12 | Security: a waiter calls another tenant's uscita, or the chef calls before PR5 | tenant from the token; `require_table_operator`; route roles; X; `421` |

**Unverified technical assumptions (each proved in the named step):**
- **T1:** `ALTER TABLE … ADD COLUMN` without a default leaves existing rows null, fires no row trigger and writes no row. Source S1 (not
  fetched). Proved in `419` (closed rows null) and G (`417`, row md5 over the old columns unchanged). M5's
  later `SET DEFAULT` sets no missing value (`423`, `atthasmissing` false).
- **T2:** a `CHECK … NOT VALID` constraint is not checked against existing rows but is enforced on later inserts and updates, and
  `pg_constraint.convalidated` is false. Source S1 (not fetched). Proved in `423`.
- **T3:** `LOCK TABLE … IN EXCLUSIVE MODE` blocks `SELECT … FOR UPDATE/SHARE` and writes but not plain `SELECT`. Source S2 (not fetched).
  Proved in `423` with two connections on the native runner.

**Secrets:** none added or moved (§3.16).

---

## 7. Open questions for the lead / founder

| # | For | Question | Recommended default (applies unless answered) |
|---|---|---|---|
| Q1 (= Q-U1) | Founder via lead | A dish of an uscita still "in attesa" is voided: back into stock as "Non preparato", or waste as today? | **Ruled (lead, 2026-11-18):** back into stock ("Non preparato"): reversals only, no waste, no new stock code. The founder has the default and has not objected; ADR-049 records it |
| Q2 (= Q-U2) | Lead | Drinks are "subito" by default, with the editor's Uscita control as the escape hatch? | **Ruled (lead, 2026-11-18):** yes. The server accepts any uscita for any course; drinks default to 0 |
| Q3 | Lead, then founder | Deplete at the send (A) or at the call (B)? | **Ruled (lead, 2026-11-18):** **A**, deplete at the send (§3.2) |
| Q4 | Founder via lead | May a table close while an uscita still waits? | **Ruled (lead, 2026-11-18):** no. `uscita_waiting`; its message tells the waiter to call the uscita or void "Non preparato" first |
| Q5 | Lead | A send made when nothing is cooking or waiting (a dessert after everything was served): does its new uscita still wait for "Via"? | **Ruled (lead, 2026-11-18):** **changed to V6.** If no uscita of the table is waiting when a send happens (everything earlier has been called), the lowest new uscita is called automatically at the send: a dessert at the end goes straight to the kitchen and nobody has to remember "Via". Only a later uscita behind a still-waiting one waits. Folded into step 5 (no separate migration; see V6) and pinned in pgTAP `421` and in e2e step 22, both cases. The designer updates spec §2.3 |
| Q6 (= Q-U3) | Lead | The kitchen-side "Via" | **Ruled (lead, 2026-11-18): after P0** → PR5 (steps 24–25) |
| Q7 | Lead | Migration range, pgTAP numbers and merge order | **Ruled (lead, 2026-11-18):** `20261206220000…` (`220000`–`220900`), pgTAP from `417` (`417`–`430`); merge order opening stock → comanda uscite → P2-4 → SP2. PR5's M9 is renamed when it comes (V5) |
| Q8 | Lead | ADR number and status | **Ruled (lead, 2026-11-18):** ADR-049, "proposed", plus the dated note in ADR-019 |
| Q9 | Lead | When can `segue` (column mirror, legacy keys, the v1 sync shape, `fire` without `hold` meaning "call") be removed? | **Ruled (lead, 2026-11-18):** after go-live, at least 30 days on, in its own cleanup PR (not in this plan) |
| Q10 (= Q-U5) | Founder | Wording: "uscita", "segue", "Via la 2ª", "in attesa", "da chiamare", "Non preparato", "Chiamata in coda", the conflict texts, `uscita_waiting`'s message | **Ruled (lead, 2026-11-18):** copy "(da approvare)": the copywriter drafts, the founder approves |
| Q11 | Lead | Who may call before PR5? | **Ruled (lead, 2026-11-18):** owner, admin, waiter |
| Q12 (= Q-U4) | Lead | When to ship | **Ruled (lead, 2026-11-18): before go-live**, deployed outside service, PR3 and PR4 in the same window |

---

**Lead review, 2026-11-18 (PR #205): plan accepted.** Every row above reads "Ruled". The sync strict-parse fix (step 10) stays in PR 2,
so it lands before any line-shape change. Build order: opening stock PR 1 → comanda PR 1 (G/X) → the two series alternate as each PR goes
green; one review round per PR; the lead reads every migration.

**V6 in step 5 (pgTAP `421`, both cases):** (a) a table whose 1ª has been called (or sent with nothing waiting) sends a dessert at uscita
3 → the send inserts `uscita_call (3, 'fire_now')`, `held` is empty, the kitchen board shows it at once; (b) a table whose 2ª is still
waiting sends a dessert at uscita 3 → no call row for 3, `held` lists it behind the 2ª. **Step 22 (e2e):** the same two cases at 360 px.
**Step 20:** the bar offers no "Via" after a send answered with `held: []`.

## 8. Sources

| ID | URL | Used for |
|---|---|---|
| S1 | https://www.postgresql.org/docs/current/sql-altertable.html | T1 (ADD COLUMN without default), T2 (`NOT VALID` check constraints). **Not fetched in this session** (the host does not resolve from the sandbox; it must be allowed in the session's network settings to fetch it). Proved by tests in steps 3 and 8 |
| S2 | https://www.postgresql.org/docs/current/explicit-locking.html | T3 (`EXCLUSIVE` table lock conflicts). **Not fetched** (same reason). Proved in step 8 |
| S3 | `docs/ux/comanda-uscite.md` (main) | the spec, §1–§10 |
| S4 | `docs/plans/2026-10-28-m19-firing.md:516–517`; `docs/adr/adr-019-firing-and-voids.md:19–23` | today's segue and void rules |
| S5 | `docs/plans/2026-10-29-m20-offline.md` §3.5–§3.6; `public/sw.js:16` | sync wire format, outbox, version skew |

---

## 9. Differences found between the spec and the code or the invariants

1. **Ticket key (§8.4).** `(session, fired_at, uscita)` would split a called uscita that gained a dish while waiting into two tickets, and
   sort a called uscita at its send time. Spec §3.1 wants it at the front at its call time. This plan keys by the ticket instant
   `greatest(fired_at, called_at)`. `kitchen_event` stores the old four-column key in an append-only table
   (`20261111100000:26–30`), so the change needs a new column, a third shape and appended remap events, not a key swap.
2. **Audit (§8.3).** "audit row": no fire, void or kitchen procedure writes `audit_event`. The call row is the record (who, when, cause).
   Adding an audit action would move the audit CHECK pins for no new information.
3. **Drinks (§8.1) "none".** Modelled as `0` ("subito"), because null is reserved for closed history that must stay untouched, and keys
   and unique constraints need a value.
4. **`segue` retired (§8.1).**
   - The column cannot go: it is append-only history, and legacy kitchen events reference it.
   - The `segue` key cannot be refused while old bundles and queued ops exist.
   - So it is kept, mirrored, and unread (Q9).
5. **"The drafts of the whole sheet in one transaction" (§8.2).**
   - `fire_course` takes 1–50 **named** lines (`20261130100300:43–51`), on purpose: the server never computes "all drafts", so a replay
     is exact (M19).
   - A sheet over 50 drafts goes in chunks, each its own transaction.
   - Because held is derived per line, chunking gives the same result. The limit is kept.
6. **"A call queued behind its own send never runs first" (§8.6).** The server cannot know which send a call belongs to. The guarantee
   comes from the outbox's `seq` order and the route's stop-on-failure (`src/server/sync/schemas.ts:70–72`, `apply.ts:92–97`). A call
   whose send was refused answers `nothing_waiting`.
7. **Q-U1 vs ADR-019.** ADR-019 says a void after firing becomes waste (`adr-019:22`). Under the recommended option A, held lines are
   fired, so `not_prepared` is a deliberate exception. It follows PRD 2.3's intent (not cooked → stock back) and needs ADR-049 and the
   founder's confirmation.
8. **"The 1ª is called implicitly" and "an empty uscita disappears" (§8.3, §2.1).** The server rule is "uscite 0 and 1 are never held". If
   a client sent a sheet whose lowest uscita is 2, it would be held. The UI renumbers so the first uscita sent is always the 1ª (step 20's
   test).
9. **Close (not in the spec).** `close_table` refuses drafts today (Q129). Held lines need the same protection (M8, Q4).
10. **`unsentCount` (§4 row 1).** The server excluded segue drafts (`20261205100000:18`). Every draft now goes with the one send, so it
    counts them all.
11. **"Portate inviate" retired (§4).** It is retired as a UI word only. The API `status` keeps `courses_sent`, so no status enum or pin
    moves.
12. **Pre-existing, found on the way (flag 2).**
    - The browser strict-parses sync replies (`src/pwa/send.ts:33`), and the server strict-parses stored duplicates
      (`results.ts:78–85`).
    - Any change to the line shape (P2-0b's `weightG` included) leaves old bundles "stuck", and would answer 500 to a duplicate of a
      pre-deploy op.
    - Step 10 fixes it for this change. The same pattern (version header and stored-reply upgrade) should be reused by any later change to
      the line shape.
