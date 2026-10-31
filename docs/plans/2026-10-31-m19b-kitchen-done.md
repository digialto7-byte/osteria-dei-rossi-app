# Tech plan — Osteria Digitalization · M19b Kitchen "Fatto" and "Chiudi comanda" on /cucina

- **Client slug / internal:** `osteria-dei-rossi`.
  - The approved client facts in `docs/client-facts.md` are the trading name, the brand colours and the fonts. **M19b uses none of them.**
  - **The drafts in `docs/client/` are not used** in any fixture, seed or UI text. The repo is public, so every fixture is fake and reuses the M19–M21 set:
    - tenants "Osteria Demo A/B"; users "Titolare Demo", "Admin Demo", "Chef Demo", "Cameriere Demo", "Cameriere Due Demo";
    - tables "Tavolo 1 (demo)" … "Tavolo 3 (demo)";
    - menu items "Spezzatino con polenta (demo)", "Tagliatelle al ragù (demo)", "Bruschetta (demo)", "Acqua (demo)" (unmapped).
- **Origin:** a new founder request (2026-10-31, through the lead), part of the MVP. It is brought forward from M40's KDS idea ("a bump marks the ticket done", project plan §5 row M40). **It overrides M19's Q105** ("no done button"). The printer and the bump bar stay in M40.
- **Repo and branch:** `osteria-dei-rossi-app`, worktree `/home/user/osteria-m19b`, branch `feat/m19b-kitchen-done`. It is **stacked on M21** (`feat/m21-bill-close`, PR #39, ready for review, not merged), which already contains M19, M20 and M21. If PR #39 changes in review, `tdd-guide` rebases first and re-reads `close_table`, pgTAP `222` and `20261110100400_demo_purge_tables_m21.sql`. One draft PR, based on PR #39's branch until it merges.
- **Numbering:**
  - migrations `20261111100000`–`20261111100400`, with `…100500`–`…100900` kept for review fixes. Nothing here edits an existing migration;
  - pgTAP `223`–`230` (checked free on this worktree: the highest is `222`);
  - ADR-024 (`docs/adr/adr-024-kitchen-done-events.md`, proposed); questions from **Q136** (M21 ended at Q135); variants V1–V5 belong to this plan ("M19 V2" names M19's Realtime variant);
  - e2e: new cases in the existing `e2e/kitchen.spec.ts`, so the `laptop` project's `testMatch` and `tests/config/playwright-projects.test.ts` stay as they are.
- **Shared check constraints:** M19b adds **no** audit entity type, audit action, alert kind or sync op kind. It widens no existing check. `audit_event_*_check`, `app.alert_kind` and `app.sync_op_kinds()` are untouched, and `229` pins them. `app.demo_purge_tables()` gains `kitchen_event` (the `194` rule).
- **Author:** architect · **Date:** 2026-10-31
- **Sources:**
  - `docs/prd.md`: §1 users table (the chef uses a phone or kitchen tablet), §3.3 (sending and kitchen), Scope "Kitchen display (KDS) Optional", NFR Offline, Accessibility;
  - project plan §3.6, §3.11.2, §5 row M40;
  - M19 plan (`docs/plans/2026-10-28-m19-firing.md`) §3.1.8–§3.1.12, §3.3, §3.4 ("M40 may add a done state; the ticket key is the natural id"), Q98, Q105; ADR-019;
  - M20 plan §1 (kitchen writes are online-only), ADR-022; M21 plan §3.1.3, §3.3, ADR-023;
  - the merged SQL and TS listed in §2. **Where code and a plan differ, the code wins.**

> **Flags for the founder (read first)**
> - **The chef taps a dish once to mark it "Fatto" and taps again to undo it.** There are no "are you sure?" questions. Every mistake is undone with one tap or with "Annulla".
> - **A comanda closes by itself when its last dish is marked "Fatto".** It then moves to "Chiuse oggi", where "Riapri" brings it back. "Chiudi comanda" closes it at once, even with dishes still open.
> - **If a waiter sends more dishes of the same course after the comanda was closed, the kitchen gets a new comanda.** The closed one stays closed (Q137).
> - **Closing a table at the till is never blocked by the kitchen.** When a table is closed, its comande leave the kitchen screen, as they do today (Q138).
> - **Waiters do not see "pronto" on their phone in this build.** This is a small add-on if you want it (Q136 → V1, where its cost is listed).
> - **The kitchen screen still refreshes every 5 seconds, not every 15.** The request said "the same 15 s poll as today", but the kitchen has polled every 5 s since M19 (your Q98). The 15 s refresh is the waiter's comanda. This plan keeps 5 s (Q143).
> - **Without a connection the kitchen buttons are greyed out.** Nothing is queued on the kitchen device (as in M20).
> - **The app records who tapped "Fatto" and when.** No screen or report measures how fast anyone works. Please confirm this with whoever advises you on staff privacy (Q144).
> - **No new dependency, provider, scheduled job, alert kind or secret.**
> - Q136–Q144 have **defaults in force for this build**. They go in the PR body.

## 1. Goal and scope

- **Goal:** the chef can see at a glance what is left to cook. One tap marks a dish done and one tap undoes it. A comanda leaves the active list when everything on it is done, or when the chef closes it. Everything is recorded as append-only events, enforced in Postgres, and has no euro value.
- **In scope:**
  - **`public.kitchen_event`:** an append-only table of events. Line events are `done` and `undone`. Ticket events are `closed` and `reopened`. Current state is derived from the latest event by `seq`, never stored.
  - **`public.kitchen_mark_line(p_line, {done})`:** sets a fired line to a target state. It is idempotent, auto-closes the comanda when the last open line is marked done, and reopens it when a line of a closed comanda is undone. Single transaction.
  - **`public.kitchen_set_ticket({sessionId, firedAt, course, segue, closed})`:** closes or reopens a comanda. Idempotent, single transaction.
  - **The kitchen read is replaced in place** (`app.kitchen_ticket_rows`, `public.kitchen_tickets`), with the same signatures. Lines gain `done`. Comande gain counts and their closed state. The board gains `remaining` (still to make) and `closedTickets` (closed today).
  - **API:** `POST /api/kitchen/lines/:id/mark`, `POST /api/kitchen/tickets/mark`; `GET /api/kitchen/tickets` keeps its path and gains the new keys.
  - **Screen `/cucina`:**
    - tappable dish rows (≥ 44 px), done rows struck and moved down;
    - "2 di 5 fatti" per comanda and "Chiudi comanda";
    - the header total "Da fare: 7";
    - an "Annulla" notice after a comanda closes;
    - a collapsed "Chiuse oggi (n)" section with "Riapri";
    - an online-only block;
    - phone, tablet and laptop layouts.
  - **Tests:** pgTAP `223`–`230`, eight race cases, Vitest, an integration suite, and Playwright (`phone`, `laptop`) in `e2e/kitchen.spec.ts`.
- **Out of scope:**
  - a "pronto" state on the waiter's phone (Q136 → V1) and a kitchen warning in the close sheet (Q138 → V2);
  - comande of tables already closed in "Chiuse oggi" (Q139 → V3); auto-closing a comanda through a void (Q140 → V4); counting portions instead of rows (Q141 → V5);
  - the ticket printer and the bump bar (M40); Supabase Realtime (M19 V2); kitchen timing reports of any kind (Q144);
  - any change to `fire_course`, `void_line`, `close_table`, `apply_op`, the outbox or the service worker.

## 2. Current state (branch `feat/m19b-kitchen-done` = PR #39 head: M0–M21)

### 2.1 Kitchen read, procedures and pins (read in the merged SQL)

| Object | State on this branch | M19b uses it how |
|---|---|---|
| `app.require_kitchen_reader()` (`20261106100400`) | owner, admin, chef; 42501 otherwise | Unchanged. The read keeps it. M19b adds a separate `app.require_kitchen_marker()` (§3.1.8) |
| `app.kitchen_ticket_rows(p_tenant, p_at)` (`20261106100400`) | One SQL statement: fired lines of the business day of `p_at`, of sessions with `closed_at is null`; grouped by `(table_session_id, fired_at, course, segue)`; ordered by `fired_at`, table name `collate "C"`, course, segue; newest 200 tickets returned ascending; `{truncated, tickets}` | **Replaced in place** (step 3), same signature, with every M19 rule kept and the new keys of §3.2 |
| `public.kitchen_tickets()` | Role check, `clock_timestamp()`, `{asOf, truncated, tickets}` | **Replaced in place** (step 3) to return the whole board |
| Ticket key | `"<sessionId>\|<firedAt UTC, 6 decimals>\|<course>\|<segue>"`, e.g. `…\|2026-11-04T20:10:00.000000Z\|primi\|true` (pgTAP `175` line 140) | The identity of a comanda for events and API bodies (§3.1.1) |
| `public.fire_course` (`20261106100700`) | One `clock_timestamp()` per call → every line of the call shares `fired_at`. md5-pinned in `214` (`pg_get_functiondef`) and `222` (`prosrc`) | **Not changed.** A later fire therefore always makes a new ticket (§3.1.6) |
| `public.void_line` (`20261106100300`) | After firing: reversal + waste rows per consumption row; the line keeps `fired_at`, gets `voided_*`; takes session SHARE → line UPDATE → stock → batch. Pinned in `214`, `222` | **Not changed.** The kitchen reads `voided_at` (§3.1.5) |
| `public.close_table` (`20261110100200`, M21) | Session FOR UPDATE; refuses drafts (`unsent_lines`); closed sessions leave the kitchen list (M19 filter) | **Not changed**, and not blocked by kitchen state (§3.1.7) |
| pgTAP `175` | Asserts the rows keys `{tickets, truncated}`, the nine ticket keys and the seven line keys | Three key-set assertions updated **on purpose** (step 3). The rest is unchanged |
| pgTAP `176` | No API role executes the eleven M19 `app.*` functions, `kitchen_ticket_rows` included | Unchanged and green (the replaced function keeps its ACL) |
| pgTAP `222` | Line 8: the purge list "minus `day_close`" equals M20's list; line 34: `public.kitchen_tickets` md5 `58b9818e…` | Line 8 also excludes `kitchen_event` (step 7); line 34 is re-pinned to the M19b text (step 3). Both **on purpose** |
| pgTAP `207`, `214` | Pin the full list of public tables (line 28 / line 487) | `kitchen_event` added **on purpose** (step 1) |
| pgTAP `004`, `059` | "Every public table has a fixture row" | One `kitchen_event` fixture row each (step 1), assertions unchanged |
| pgTAP `193`, `194` | `193` fills two rows in every purge-list table; `194` checks every tenant table is listed once | `193` fixture gains `kitchen_event` rows (step 7); `194` green unchanged |
| `app.demo_purge_tables()` (`20261110100400`) | M20 list + `day_close` before `app_user` | Re-created with `kitchen_event` before `order_line_cost` (step 7) |
| Locks | Global order (M19 §3.3, M21 §3.3): `applied_op` advisory → `table_session` SHARE/UPDATE → `order_line` UPDATE → stock advisory → `batch` rows → batch lot; M21 `day_close:<tenant>:<date>` advisory | Kitchen writes add a per-ticket advisory lock and an `order_line` FOR SHARE (§3.3) |

### 2.2 TS and screens

- **Services:** `src/server/kitchen/constants.ts` (`KITCHEN_POLL_MS = 5_000`, `KITCHEN_STALE_MS = 60_000`, `KITCHEN_MAX_TICKETS = 200`), `output.ts` (strict `kitchenTicketsOutput`, snapshot `tests/server/kitchen/__snapshots__/output.test.ts.snap`), `tickets.ts` (`getKitchenTickets`), `errors.ts` (`mapKitchenDbError`: 42501 → 403 only).
- **Route:** `src/app/api/kitchen/tickets/route.ts`, `withApi({ roles: ["chef", "owner", "admin"] })`, `cache-control: no-store`.
- **Screen:** `src/app/(owner)/cucina/page.tsx` (client component: polls every `KITCHEN_POLL_MS` while visible, refreshes on `visibilitychange`/`focus`, `latestOnly()`, stale banner after 60 s, 403 role message), `ticket-card.tsx` (read-only `article` per ticket, voided lines struck with "Stornato · …"), `stale-banner.tsx`, `contrast-toggle.tsx`. Helpers `src/lib/kitchen/kitchen-view.ts` (`canReadKitchen`, `isStale`, `asOfLabel`, `voidLabel`, `ticketHeading`, `firedLine`).
- **Waiter side:** the comanda is `src/app/(owner)/tavoli/comanda/page.tsx` (M20), refreshing every `ORDER_REFRESH_MS = 15_000`. **The 15 s in the request is this interval, not the kitchen's.**
- **Offline (M20):** `public/sw.js` caches the shell pages `/`, `/tavoli`, `/tavoli/comanda` and four waiter reads (`/api/me`, `/api/menu`, `/api/tables`, `/api/table-sessions/:id/lines`). **`/cucina` and `/api/kitchen/*` are not cached**, and the outbox (`src/pwa/*`) carries only the six M20 op kinds.
- **Tests infra:**
  - `tests/helpers/kitchen-data.ts` (fixture board);
  - component tests `tests/components/{kitchen-page,ticket-card,stale-banner,contrast-toggle}.test.ts`, `tests/design/kitchen-contrast.test.ts`;
  - `tests/integration/helpers/firing.ts` (`seedFiringTenant`), `tests/integration/helpers/closing.ts` (M21);
  - `scripts/test-db-races.sh`;
  - Playwright projects `phone` (all), `phone-webkit` (`order-entry|firing|offline|bill-close`), `laptop` (`kitchen\.spec\.ts$`).
- **Missing:** every M19b table, procedure, route and control. No kitchen write exists today.

## 3. Design

### 3.1 Decisions

1. **Comanda identity stays derived** (M19 §3.1.8, §3.4). A comanda is the set of lines fired in one `fire_course` call for one table, course and `segue` value: `(table_session_id, fired_at, course, segue)`. Its id on screen remains the M19 key string.
   - Ticket events store these four columns. API bodies send them as structured fields: `firedAt` is the M19 UTC text with exactly six decimals, which round-trips to the stored `timestamptz` (T3).
   - No `kitchen_ticket` table is added. `fire_course` would have to write it, and that function is pinned (`214`, `222`) and shared with M20's replay path (§4).
2. **One append-only event table** (ADR-024). `public.kitchen_event` rows are `subject` `line` (`done`/`undone`, with `order_line_id`) or `ticket` (`closed`/`reopened`, with the key columns), plus `cause` (`tap` or `auto`) and `created_*`.
   - No UPDATE, DELETE or TRUNCATE (`app.append_only`, `app.append_only_truncate`; only the ADR-018 demo purge may delete).
   - **Derivation:** a line is done when it is not voided and its latest line event (highest `seq`) is `done`. A comanda is closed when its latest ticket event is `closed`. No event means "not done" or "open".
   - `seq` is a `bigint generated always as identity`. Every write for one comanda is serialised by its advisory lock (decision 4), so `seq` order is the commit order for every subject (T2). `created_at` is display only.
3. **Taps are "set to", not "toggle"** (idempotency). The client sends the state it wants (`{done: true}`, `{closed: false}`), computed from the state it shows. When the stored state already equals the target, nothing is written and the reply is `changed: false`.
   - A double-tap therefore writes once (AT3).
   - A stale device asking for a state another device already set writes nothing (AT6).
   - A lost reply can be retried.
   - The screen also ignores taps on a row while its request is pending, and for `KITCHEN_TAP_GUARD_MS` = 600 ms after its last change. Without this, a fast double-tap whose first reply arrived in time would be read as "tap, then undo" (pure helper `markIntent`, §3.6).
4. **Writes are single transactions, serialised per comanda** (AT6, AT13). Every kitchen write takes `pg_advisory_xact_lock(hashtextextended('kitchen:' || tenant || ':' || session || ':' || firedAt || ':' || course || ':' || segue, 0))`, the M21 `day_close` pattern.
   - A line mark then takes that line `FOR SHARE`, so a void in flight on the same line finishes first, or waits (§3.3).
   - Two devices marking the last two open lines at the same moment are serialised on the comanda lock. The second one sees nothing left and writes the one auto-close (race `kitchen-mark-last-two`).
   - A hash collision only adds waiting, never a wrong result.
5. **Done lines, voided lines and counts** (AT1, AT8, AT15).
   - **Line order on a card:** lines to make (creation, id), then voided lines, then done lines (creation, id). The SQL orders them; React renders the order it gets.
   - `lineCount` = non-voided lines; `doneCount` = done lines; "2 di 5 fatti". `remaining` (header "Da fare: 7") = Σ `lineCount − doneCount` over the active comande. All counts are computed in SQL; React does no arithmetic.
   - **Voiding a line keeps M19's void flow** (`void_line` unchanged: reversal + waste after firing). The kitchen sees the line struck with "Stornato · Errore in cucina" whether or not it was done. A voided line is never `done`, is not counted in either number and cannot be tapped. Its earlier `done` event stays in history (append-only).
   - A void never closes or reopens a comanda: the chef sees "Stornato" and closes the comanda (Q140 → V4).
   - A mark on a line that is voided by then writes nothing and replies `changed: false` with the board.
6. **Auto-close, undo and reopen** (AT4, AT5).
   - When `done` leaves a comanda with no open line and the comanda is open, the same transaction writes `closed` with `cause 'auto'`. The reply says `autoClosed: true`.
   - When `undone` hits a line of a closed comanda, the same transaction writes `reopened` with `cause 'auto'` (`reopened: true`). So the "Annulla" that follows an auto-close is simply "undo the last line".
   - "Chiudi comanda" writes `closed` (`cause 'tap'`). It does **not** mark lines done, so the count stays "2 di 5 fatti" in "Chiuse oggi" (A2). "Riapri" writes `reopened`. The comanda returns to its oldest-first place, because the order is by `fired_at`.
   - A `done` on a line of a closed comanda (from a device that has not refreshed yet) records the line only. The comanda stays closed.
   - **Fire after close → a new comanda (Q137).** `fire_course` gives every call its own `fired_at`, so the new dishes form a new key and a new active card at the end of the list. The closed one stays closed. This needs no code, and stays true whatever the kitchen does. Accepted edge case (§6): two separate `fire_course` commits for the same table, course and segue with the same microsecond `clock_timestamp()` would share a key.
7. **`close_table` is not blocked by kitchen state** (Q138).
   - The bill is a till fact. The kitchen state is a work-in-progress view and moves no stock or money.
   - M21 already refuses unsent dishes, so every dish of a closed table reached the kitchen.
   - Blocking would put a kitchen tap on the critical path of payment, and would need `close_table` (pinned) and the M20 conflict rules to change.
   - Closed tables keep leaving both kitchen lists (the M19 filter `s.closed_at is null` is kept; Q139 → V3).
   - Kitchen writes on a closed table are refused with `session_closed` (409). A write that races a close and commits first is recorded and invisible (race `kitchen-mark-vs-close-table`).
8. **Roles, enforced in Postgres** (AT7; project §3.11.2).

   | Object / action | owner | admin | chef | waiter | DB enforcement | API |
   |---|---|---|---|---|---|---|
   | `kitchen_mark_line` | ✓ | ✓ | ✓ | 42501 | new `app.require_kitchen_marker()` (owner, admin, chef), first statement | `POST /api/kitchen/lines/:id/mark` (403 before any RPC) |
   | `kitchen_set_ticket` | ✓ | ✓ | ✓ | 42501 | `app.require_kitchen_marker()` | `POST /api/kitchen/tickets/mark` |
   | `kitchen_tickets` (board) | ✓ | ✓ | ✓ | 42501 | `app.require_kitchen_reader()` (M19, unchanged) | `GET /api/kitchen/tickets` |
   | `kitchen_event` SELECT | ✓ | ✓ | 0 rows | 0 rows | RLS policy owner, admin (as `order_line`) | none (reads go through the board) |
   | `kitchen_event` INSERT/UPDATE/DELETE | — | — | — | — | no grant to any API role; append-only triggers | — |

   - Every public function is `security definer` with `set search_path = ''`. It checks the role **first**, takes the tenant from `app.tenant_id()` and the user from `app.app_user_id()`, filters every statement by tenant, and is executable by `authenticated` only. Every `app.*` helper is revoked from every API role.
   - `app.require_kitchen_marker()` is a separate function with today's reader set, so a later "waiter reads, chef writes" change touches one function.
   - No public function name matches `cost|margin|price` (the `059`/`214` list stays as it is).
9. **No euro value (V6, Q16).** The board and both write replies carry names, quantities, notes, counts, instants and staff display names only. Every key passes `059`'s chef regex (`cost|margin|price|prezz|gp_pct|_eur$|amount|total|importo`): the new keys are `remaining`, `closedTickets`, `lineCount`, `doneCount`, `closedAt`, `closedBy`, `autoClosed`, `done`, `changed`, `reopened`, `board`. **No key is named `total`.**
10. **Refresh: polling stays** (M19 Q98; Q143).
    - The kitchen page keeps `KITCHEN_POLL_MS` = 5 000 ms. Each write reply carries the whole board, so the tapping device updates at once. Other kitchen devices see the change on their next read (≤ 5 s while visible).
    - Realtime is still M19 V2: the browser holds no Supabase token (HttpOnly cookies), and a tap does not need sub-second sync across devices.
    - The stale banner rule (60 s, client clock) is unchanged.
11. **Waiter "pronto": proposed, not built (Q136).** In this build the waiter's screen, `order_view`, `app.order_line_json` and the waiter line snapshot are unchanged. The proposal, its behaviour and its cost are in V1 (§5b). The waiter never gets a kitchen write in any case (decision 8).
12. **Offline: kitchen writes are online-only** (M20 §1; AT12).
    - The kitchen screen is not in the service worker and has no outbox; `app.sync_op_kinds()` stays M20's six.
    - **Before a tap:** the dish rows, "Chiudi comanda", "Riapri" and "Annulla" are `disabled` while the screen is offline. "Offline" means `navigator.onLine` is false or the stale banner is showing (pure `kitchenWriteBlock({online, stale})`). The hint reads "Serve la connessione per segnare i piatti."
    - **When a write fails:** if it fails by network or 5xx, nothing changes on screen (no optimistic state, so nothing to roll back), and `ErrorAlert` says "Non salvato: controlla la connessione e riprova." Nothing is retried by itself.
13. **No confirm dialogs; undo instead** (AT14).
    - After a comanda closes (auto or "Chiudi comanda"), a notice (`role="status"`) reads "Tavolo 1 (demo) · Primi: comanda chiusa" with an "Annulla" button.
    - It stays for `KITCHEN_UNDO_MS` = 8 000 ms or until the next close replaces it.
    - "Annulla" sends `{done: false}` for the tapped line (auto) or `{closed: false}` for the comanda (tap).
    - "Chiuse oggi" keeps "Riapri" for the rest of the business day.
14. **Personal data.**
    - Events carry the staff user id (`created_by`) and an instant, like every other table's `created_*`. "Chiuse oggi" shows "Chiusa alle 20:41 · Chef Demo".
    - No guest data and no new processor; nothing leaves Supabase (EU).
    - No screen, API or report computes per-person or per-dish timings (Q144). Retention follows project Q14.
    - Logs carry codes and SQLSTATEs only.
15. **Implicit defaults, each tested with ≥ 2 candidates (lesson 1):**
    - two comande of one table (two courses), and a segue and a non-segue comanda of the same course;
    - two lines on one comanda; two kitchen devices (chef and owner); two tenants; two sessions;
    - two events with the same `created_at` (`seq` decides);
    - an auto-close vs a manual close, and a done vs a voided last line;
    - the business day of a closed comanda (01:30 vs 02:30 Rome with cut-off 02:00).

### 3.2 Data model and procedures

**`20261111100000_kitchen_event_core.sql`** (step 1)
- **Columns of `public.kitchen_event`:**
  - `id uuid primary key default gen_random_uuid()`;
  - `seq bigint generated always as identity`;
  - `tenant_id uuid not null default app.tenant_id()` (FK tenant);
  - `subject text not null`, `action text not null`;
  - `cause text not null default 'tap'`;
  - `order_line_id uuid null`;
  - `table_session_id uuid null`, `fired_at timestamptz null`, `course public.course null`, `segue boolean null`;
  - `created_at timestamptz not null default clock_timestamp()`;
  - `created_by uuid not null default app.app_user_id()`.
- **`kitchen_event_shape_ck`:**
  - `(subject = 'line' and action in ('done','undone') and cause = 'tap' and order_line_id is not null and num_nulls(table_session_id, fired_at, course, segue) = 4)`
  - `or (subject = 'ticket' and action in ('closed','reopened') and cause in ('tap','auto') and order_line_id is null and num_nonnulls(table_session_id, fired_at, course, segue) = 4)`.
  - Line events have no `auto` cause; only ticket events do.
- **FKs:**
  - `kitchen_event_line_fkey (tenant_id, order_line_id) → order_line (tenant_id, id)`;
  - `kitchen_event_session_fkey (tenant_id, table_session_id) → table_session (tenant_id, id)`;
  - `kitchen_event_created_by_fkey (tenant_id, created_by) → app_user (tenant_id, id)`.
- **Indexes:**
  - `kitchen_event_line_idx (tenant_id, order_line_id, seq desc) where subject = 'line'`;
  - `kitchen_event_ticket_idx (tenant_id, table_session_id, fired_at, course, segue, seq desc) where subject = 'ticket'`.
- **Append-only:** `app.append_only` on update/delete and `app.append_only_truncate`; both honour `app.demo_purge_allows`.
- **RLS and grants:** RLS on, with policy `kitchen_event_select` for owner and admin of the tenant. `revoke all … from anon, authenticated, service_role; grant select … to authenticated, service_role`.

**`20261111100100_kitchen_event_helpers.sql`** (step 2). Schema `app`, `search_path = ''`, revoked from every API role.
- `app.require_kitchen_marker()`: owner, admin, chef; else 42501 `permission denied: kitchen marks need owner, admin or chef`.
- `app.kitchen_ticket_key(p_body jsonb) returns table (session_id uuid, fired_at timestamptz, course public.course, segue boolean)`:
  - `sessionId` through `app.order_uuid`;
  - `firedAt` must match `^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$` and cast;
  - `course` must be in `enum_range(null::public.course)`; `segue` must be a JSON boolean;
  - anything else → 22023 `invalid_request`.
- `app.kitchen_ticket_lock(p_tenant, p_session, p_fired_at, p_course, p_segue) returns void`: the advisory lock of §3.1.4. The key text uses the same `to_char(… at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` as the ticket key.
- `app.kitchen_line_done(p_tenant, p_line) returns boolean`: the latest line event by `seq` is `done` (false when there is none). It ignores `voided_at`; callers check it.
- `app.kitchen_ticket_state(p_tenant, p_session, p_fired_at, p_course, p_segue) returns table (closed boolean, closed_at timestamptz, closed_by uuid, auto boolean)`: from the latest ticket event; `(false, null, null, false)` when there is none.
- `app.kitchen_ticket_open_lines(p_tenant, p_session, p_fired_at, p_course, p_segue) returns integer`: the fired, non-voided lines of the key that are not done.

**`20261111100200_kitchen_board.sql`** (step 3)
- `create or replace function app.kitchen_ticket_rows(p_tenant uuid, p_at timestamptz) returns jsonb` (same signature, ACL kept). **Every M19 rule is kept verbatim:** the candidate filter (business day of `p_at`, `fired_at > p_at − 30 h`, sessions not closed, tenant), the grouping, the ordering, the 200 cap and the key format. Added:
  - per line `done` = `voided_at is null` and latest line event (`created_at ≤ p_at`) is `done`; line order: not done and not voided, then voided, then done; within each, `created_at`, `id`;
  - per ticket `lineCount`, `doneCount`, `closedAt` (instant of the latest ticket event when it is `closed`, else null), `closedBy {id, displayName}` (or null), `autoClosed` (that event's cause is `auto`);
  - the active tickets (`closedAt` null) in `tickets`, M19 order, newest 200 returned ascending; the closed tickets in `closedTickets`, ordered by `closedAt desc`, then key, at most 200; `truncated` when either list was cut;
  - `remaining` = Σ `lineCount − doneCount` over **all** active tickets of the day (before the cap);
  - events with `created_at > p_at` are ignored, so pgTAP can read the board at a fixed instant.
- `app.kitchen_board_json(p_tenant uuid, p_at timestamptz) returns jsonb` = `{asOf: p_at} || app.kitchen_ticket_rows(p_tenant, p_at)`.
- `create or replace function public.kitchen_tickets() returns jsonb` = `app.require_kitchen_reader()`, then `app.kitchen_board_json(app.tenant_id(), clock_timestamp())`.
- **Board keys:**
  - `{asOf, truncated, remaining, tickets, closedTickets}`;
  - ticket keys `{key, sessionId, tableName, covers, course, segue, firedAt, firedBy: {id, displayName}, lineCount, doneCount, closedAt, closedBy, autoClosed, lines}`;
  - line keys `{id, name, qty, note, isShared, voided, voidReason, done}`.

**`20261111100300_kitchen_marks.sql`** (step 4)
- `public.kitchen_mark_line(p_line uuid, p_body jsonb) returns jsonb`:
  1. `app.require_kitchen_marker()`; tenant; user.
  2. `p_line` null, or `app.menu_keys_ok(p_body, {done}, {done})` false, or `done` not a JSON boolean → 22023 `invalid_request`.
  3. Line by id and tenant (no lock): missing, or `fired_at is null` → P0002 `line_not_found`.
  4. Its session closed → P0001 `session_closed`.
  5. `app.kitchen_ticket_lock(key of the line)`; then the line `FOR SHARE`.
  6. Voided → `{changed: false, autoClosed: false, reopened: false, board}`.
  7. `app.kitchen_line_done` = target → the same with `changed: false`.
  8. Insert the line event (`done`/`undone`, `tap`).
  9. Target `done`, comanda open, `app.kitchen_ticket_open_lines` = 0 → insert ticket `closed` `auto`; `autoClosed: true`. Target `undone`, comanda closed → insert ticket `reopened` `auto`; `reopened: true`.
  10. Return `{changed: true, autoClosed, reopened, board: app.kitchen_board_json(v_tenant, clock_timestamp())}`.
- `public.kitchen_set_ticket(p_body jsonb) returns jsonb`:
  1. Role; parse keys `{sessionId, firedAt, course, segue, closed}` (all required) through `app.kitchen_ticket_key` and a boolean `closed` → else 22023.
  2. No fired line of tenant with that key → P0002 `ticket_not_found`.
  3. Session closed → P0001 `session_closed`.
  4. Lock; `app.kitchen_ticket_state`; same as target → `{changed: false, board}`.
  5. Insert `closed`/`reopened` (`tap`).
  6. Return `{changed: true, board}`.
- Errors of both: 42501; 22023 `invalid_request`; P0002 `line_not_found`, `ticket_not_found`; P0001 `session_closed`. Nothing else is expected. DETAILs are never set.

**`20261111100400_demo_purge_tables_m19b.sql`** (step 7). `create or replace function app.demo_purge_tables()`: the M21 list exactly as merged, with `'kitchen_event'` inserted immediately **before `'order_line_cost'`**. It points at `order_line`, `table_session` and `app_user`, all deleted later. Its delete guard is `app.append_only`, which already honours `app.demo_purge_allows`, so no guard changes.

**Not replaced:** `fire_course`, `void_line`, `close_table`, `app.close_session_at`, `session_bill`, `order_view`, `app.order_line_json`, `app.order_line_guard`, `tables_list`, `apply_op`, `app.apply_op_dispatch`, `app.sync_op_kinds`, `app.business_date`, `app.require_kitchen_reader`, `app.ledger_checks_body` (`229` pins them).

### 3.3 Lock order (no deadlocks)

Global order, extending M19 §3.3 and M21 §3.3 (each class in id order):

`applied_op` advisory (M20) → `table_session` SHARE/UPDATE → **kitchen ticket advisory** → `order_line` UPDATE/SHARE → stock advisory → `batch` rows → batch lot

| Procedure | Takes (in this order) | Source |
|---|---|---|
| `fire_course` | session SHARE → its lines UPDATE → stock → batches | M19 |
| `void_line` | session SHARE → one line UPDATE → stock → batches | M19 |
| `close_table` | session UPDATE (no line lock) | M21 |
| **`kitchen_mark_line`** | ticket advisory → one line SHARE | M19b |
| **`kitchen_set_ticket`** | ticket advisory only | M19b |
| `kitchen_tickets` | none (a read) | M19 |

- Kitchen writes take no session lock and nothing after the line SHARE. Waiter procedures never take the kitchen advisory lock. So a kitchen write can wait on a waiter's line lock, but a waiter procedure never waits on a kitchen lock, and no cycle exists.
- `mark` vs `void` on one line: whoever locks the line first finishes first (races `kitchen-mark-vs-void`, `kitchen-void-vs-mark`).
- `mark` vs `close_table`: neither waits on the other (§3.1.7, race `kitchen-mark-vs-close-table`).
- A replayed `fire_course` of a fired line takes it FOR UPDATE and so waits on a kitchen SHARE for a moment, then skips it (`already_fired`).

### 3.4 Contracts for later milestones

- **M22:** kitchen events are not a sales or stock fact. No KPI reads them without a founder decision (Q144).
- **M40:** a bump bar or printer marks a comanda done through `kitchen_set_ticket({…, closed: true})`; the ticket key stays the natural id.
- **M19 V2 (Realtime):** if it is ever triggered, its plan must also cover the two M19b write procedures.

### 3.5 API (Zod 4; all routes use `withApi`, strict bodies → 400, JSON only → 415, malformed ids → 404 before any RPC, `{"error":{"code","message","details?"}}`, `Cache-Control: no-store`, `Server-Timing` as M19)

```ts
// src/server/kitchen/constants.ts (added)
export const KITCHEN_TAP_GUARD_MS = 600;           // ignore a second tap on one row for this long (§3.1.3)
export const KITCHEN_UNDO_MS = 8_000;              // how long "Annulla" stays after a comanda closes (§3.1.13)
export const MAX_KITCHEN_BODY_BYTES = 512;
export const FIRED_AT_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/; // = app.kitchen_ticket_key

// src/server/kitchen/schemas.ts (new)
export const markLineBody = z.strictObject({ done: z.boolean() });
export const markTicketBody = z.strictObject({
  sessionId: z.uuid(), firedAt: z.string().regex(FIRED_AT_RE), course: z.enum(COURSES), segue: z.boolean(), closed: z.boolean(),
});

// src/server/kitchen/output.ts (changed: new keys, strict as before)
const kitchenLine = z.strictObject({ id: z.uuid(), name: z.string(), qty: z.number(), note: z.string().nullable(),
  isShared: z.boolean(), voided: z.boolean(), voidReason: z.enum(VOID_REASONS).nullable(), done: z.boolean() });
const kitchenTicket = z.strictObject({ key: z.string(), sessionId: z.uuid(), tableName: z.string(), covers: z.number().int(),
  course: z.enum(COURSES), segue: z.boolean(), firedAt: z.string(), firedBy: staffRef,
  lineCount: z.number().int().min(0), doneCount: z.number().int().min(0),
  closedAt: z.string().nullable(), closedBy: staffRef.nullable(), autoClosed: z.boolean(), lines: z.array(kitchenLine) });
export const kitchenTicketsOutput = z.strictObject({ asOf: z.string(), truncated: z.boolean(),
  remaining: z.number().int().min(0), tickets: z.array(kitchenTicket), closedTickets: z.array(kitchenTicket) });
export const markLineOutput = z.strictObject({ changed: z.boolean(), autoClosed: z.boolean(), reopened: z.boolean(),
  board: kitchenTicketsOutput });
export const markTicketOutput = z.strictObject({ changed: z.boolean(), board: kitchenTicketsOutput });
// staffRef = z.strictObject({ id: z.uuid(), displayName: z.string() })
```

| Endpoint | Roles | Body | Success | Errors |
|---|---|---|---|---|
| `GET /api/kitchen/tickets` (changed output) | chef, owner, admin | — | 200 `kitchenTicketsOutput` | 401; 403 (waiter, before any RPC) |
| `POST /api/kitchen/lines/:id/mark` | chef, owner, admin | `markLineBody` (≤ 512 B) | 200 `markLineOutput` (also when nothing changed) | 400 `invalid_request`; 401; 403 (waiter, before any RPC); 404 `line_not_found` (also a malformed id, without RPC); 409 `session_closed`; 413; 415 |
| `POST /api/kitchen/tickets/mark` | chef, owner, admin | `markTicketBody` (≤ 512 B) | 200 `markTicketOutput` | 400; 401; 403; 404 `ticket_not_found`; 409 `session_closed`; 413; 415 |

- **Services:** `src/server/kitchen/{schemas,marks}.ts` (new: `markKitchenLine`, `markKitchenTicket`); `errors.ts` gains P0002 `line_not_found`/`ticket_not_found` → 404 and P0001 `session_closed` → 409, with Italian messages; `src/lib/api/errors.ts` `ErrorCode` gains `ticket_not_found`.
- **Routes:** `src/app/api/kitchen/lines/[id]/mark/route.ts`, `src/app/api/kitchen/tickets/mark/route.ts`.

### 3.6 Screen `/cucina` (Italian first, English second; 360 px first; targets ≥ 44 px; every value from `/api/*`; no arithmetic in React)

- **Files:**
  - `src/app/(owner)/cucina/{kitchen-line,closed-section,undo-notice,remaining-count}.tsx` (new), `{page,ticket-card}.tsx` (changed);
  - helpers `src/lib/kitchen/kitchen-done.ts` (new): `markIntent`, `ticketMarkBody`, `doneCountLabel`, `remainingLabel`, `closedLabel`, `kitchenWriteBlock`, `undoFor`, `lineAccessibleName`;
  - `src/lib/kitchen/kitchen-view.ts`: `firedLine` gains `done`.
- **Header:** `Heading` "Cucina"; `remaining-count`, "Da fare: 7" in large type (`data-remaining`), or "Tutto fatto" at 0; "Aggiornato alle 20:31"; the contrast toggle; the stale banner (unchanged); the offline hint when `kitchenWriteBlock` is set.
- **Active comande** (`tickets`, oldest first; the M19 grid `repeat(auto-fill, minmax(18rem, 1fr))`, one column at 360 px):
  - M19 header, plus "2 di 5 fatti" (`data-done-count`);
  - **dish rows** (`kitchen-line.tsx`):
    - each non-voided line is one full-width `<button>` (`min-h-tap`, padding so the row is ≥ 56 px), with `aria-pressed={done}`;
    - accessible name "Segna fatto: 2 × Spezzatino con polenta (demo)" or "Annulla fatto: …";
    - done rows: `line-through`, a "Fatto" text badge, `text-ink-muted` (plain `ink` in high-contrast mode), placed after the open rows by the server order;
    - pending rows: `aria-busy="true"`, ignore taps;
    - voided rows: not buttons, struck, "Stornato · <motivo>";
  - **"Chiudi comanda"** button (full width, `min-h-tap`, `variant secondary`), accessible name "Chiudi comanda: Tavolo 1 (demo), Primi".
- **Undo notice** (`undo-notice.tsx`, fixed at the bottom of `main`, `role="status"`): "Tavolo 1 (demo) · Primi: comanda chiusa" and "Annulla" (`min-h-tap`), for `KITCHEN_UNDO_MS`.
- **"Chiuse oggi (n)"** (`closed-section.tsx`):
  - a toggle button (`aria-expanded`, `min-h-tap`), collapsed by default; the expanded state is UI-only, kept in `localStorage` (`kitchen.closedOpen`);
  - each closed comanda shows a compact card: table, course, "5 di 5 fatti", "Tutto fatto alle 20:41" (`autoClosed`) or "Chiusa alle 20:41 · Chef Demo", read-only lines (done struck), and "Riapri" (`min-h-tap`).
- **Errors** (`ErrorAlert` in `main`):
  - network or 5xx: "Non salvato: controlla la connessione e riprova.";
  - `session_closed`: "Il tavolo è stato chiuso: la comanda non è più in cucina.", then a board reload;
  - `line_not_found`/`ticket_not_found`: "Questa comanda non c'è più: aggiorno la lista.", then a reload.
- **No confirm dialog anywhere** (AT14). The waiter's 403 page is unchanged.
- **Tablet:** the same grid gives two or three columns at 768–1280 px. Rows and buttons keep ≥ 44 px.

### 3.7 Flows

1. **Mark and undo:** chef taps "2 × Spezzatino…" → `POST /api/kitchen/lines/L1/mark {done: true}` → ticket lock → L1 SHARE → event `done` → reply board: L1 at the bottom, struck, "1 di 3 fatti", "Da fare: 6". Second tap after 600 ms → `{done: false}` → `undone` → L1 back in place.
2. **Last dish:** L3 is the last open line → `done` + ticket `closed auto` → the card leaves the grid → notice "…: comanda chiusa · Annulla" → "Annulla" → `{done: false}` on L3 → `undone` + `reopened auto` → the card returns in its place.
3. **Close early:** "Chiudi comanda" → `POST /api/kitchen/tickets/mark {…, closed: true}` → "Chiuse oggi (1)" → expand → "Riapri" → `{…, closed: false}`.
4. **Two devices:** the phone at the pass and the laptop mark the last two lines together → both serialised on the ticket lock → two `done` events, one `closed auto` → both devices show the comanda in "Chiuse oggi" (the tapper at once, the other within 5 s).
5. **Void after done:** the waiter voids L1 (done) → M19 reversal + waste → the kitchen's next read shows L1 "Stornato · Errore in cucina", not counted.
6. **More primi after close:** the waiter sends another Tagliatelle → a new comanda "Tavolo 1 · Primi" at the end of the active list; the closed one stays in "Chiuse oggi".
7. **Offline kitchen:** Wi-Fi drops → `navigator.onLine` false (or 60 s stale) → the controls are disabled with the hint → back online → the next read clears it.

### 3.8 Secrets and configuration

| Name | Public? | Where it lives | Used by M19b |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public by design (existing) | Vercel env | the session client of every M19b route |
| `SUPABASE_SECRET_KEY` | **private** (existing) | Vercel env (server-only); locally `.env` (gitignored) | **not used by M19b `src/` code**; integration/e2e helpers create staff and read `kitchen_event` (select-granted to `service_role`) |
| `PIN_PEPPER`, `CRON_SECRET`, Vault values, `ANTHROPIC_API_KEY`, `EXTRACTION_MODEL_ID`, `RESEND_API_KEY`, `NEXT_PUBLIC_APP_VERSION` | existing | Vercel env / Supabase Vault | not touched |
| Account logins (Vercel, Supabase, GitHub) | private | the account owner's password manager with MFA (project Q26); never in the repo or DigiAlto-Ops | humans only |

No new secret, provider, paid service or scheduled job.

### 3.9 Invariants check (CLAUDE.md rule 6)

| Invariant | How M19b keeps it | Proved in |
|---|---|---|
| Balances only derived from ledgers | Kitchen state is derived from `kitchen_event` (latest by `seq`); no state column anywhere; stock and portion ledgers untouched | `225` (3), `229` (9) |
| Ledgers append-only; nothing deleted, only reversed | `kitchen_event` has append-only triggers; "undo" and "reopen" are new rows | `223` (1), `226` (4) |
| Procedures are single transactions | `kitchen_mark_line` writes line + auto ticket event in one transaction | `227` (5) |
| Recipes immutable, costs frozen | Not touched (no cost read or write) | `229` (9) |
| `tenant_id` + RLS on every table; roles in Postgres; waiters never see costs | `kitchen_event.tenant_id`, RLS owner/admin, no write grant, `app.require_kitchen_marker()` first; no € key | `223` (1), `228` (6), `225` (3) |
| Every screen reads `/api/*`; no data logic in React | Counts, order and state come from SQL; `src/lib/kitchen/kitchen-done.ts` only words and builds bodies | `kitchen-done.test.ts` (11), components (14) |
| `EXTRACTION_MODEL_ID` | Not touched | existing lint test |
| Secret key only in cron/scripts/`privileged.ts` | Not used by M19b `src/` | existing `tests/lint/admin-client-import.test.ts` |

### 3.10 Tests convention

- pgTAP as M19/M21: claims via `set_config('request.jwt.claims', …)`. Fixtures no procedure can write (fired and voided lines at fixed instants, closed sessions, events with fixed `created_at`, fault triggers) are inserted as the migration owner inside the rolled-back test. Errors are asserted as `SQLSTATE message`.
- **Rows, comande and lines are found by id or key, never by index** (`data-ticket-key`, `data-line-id`; SQL by uuid).
- **Two of everything** (§3.1.15).
- Playwright:
  - rows by `getByRole("button", { name: /^Segna fatto: 2 × Spezzatino/ })`;
  - alerts as `page.getByRole("main").getByRole("alert")`, the notice as `getByRole("status")`;
  - fake time with `page.clock` (as M19);
  - "no €" scoped to the kitchen `main`.

### 3.11 Performance (no figure promised)

- One RPC per tap; the reply carries the board, so there is no follow-up read.
- The board read adds two index lookups per comanda: `kitchen_event_line_idx` for its lines and `kitchen_event_ticket_idx` for its state. It is still bounded by M19's `order_line_fired_idx` (last 30 h).
- CI net `230`: 5 s statement limit on a big fixture (step 8). A regression net, not a latency claim.

## 4. Alternatives considered

- **A `kitchen_ticket` table written by `fire_course` (M19 §3.4, ADR-019):** rejected. It changes a pinned, offline-replayed procedure (`214`, `222`, M20's `apply_op`) for an id that the derived key already gives. Events reference the key instead.
- **State columns on `order_line` (`done_at`, `done_by`) updated in place:** rejected. It is an UPDATE of history (request: "never an UPDATE"), and `app.order_line_guard` forbids changing a fired line except by voiding (M18/M19).
- **Two event tables (line, ticket):** rejected. One table with a shape check needs half the fixture rows, list updates and pins (`004`, `059`, `193`, `207`, `214`, `222`, `229`) and one purge-list entry. The derivation is the same.
- **Toggle endpoints ("tap = flip"):** rejected. A double-tap or a retried request would flip twice. Target-state bodies make every write idempotent.
- **Derived auto-close (no `closed auto` row; "all done ⇒ closed"):** rejected. Reopening a fully done comanda then needs extra rules, and history would not show when it closed. A written `auto` event keeps "latest event wins" as the only rule.
- **Optimistic UI:** rejected for this build. Counts, order and auto-close are server decisions; showing a local guess and rolling it back on a 409 costs more than the round trip on the venue Wi-Fi saves. Each reply carries the board.
- **Fire after close reopens the closed comanda:** rejected. It needs `fire_course` to write kitchen events, or a fuzzy "same table and course" merge that would mix a forgotten dish into a finished card (Q137).
- **Block `close_table` while the kitchen has open dishes:** rejected (§3.1.7; Q138). A non-blocking warning is V2.
- **Supabase Realtime now:** rejected for the same reasons as M19 (M19 V2): no browser token; polling every 5 s plus the write reply is enough.
- **Row locks on `table_session` for kitchen writes:** rejected. They would couple every tap to waiter writes and closes for no gain; the per-ticket advisory lock serialises exactly the writes that conflict.
- **Queue kitchen writes offline (M20 outbox):** rejected. Kitchen writes are online-only by M20 §1; a queued "done" from a dead spot would replay after other devices moved on.

## 5. Build plan (test first: each step's named test is written and seen failing, then the code; one commit per step; `tdd-guide` follows the order)

| # | Step (one commit) | Files | Test that proves it (written first, must fail first) |
|---|---|---|---|
| 1 | Migration: `kitchen_event` table, shape check, FKs, indexes, append-only, RLS, grants; role-scan fixtures; public table lists updated on purpose | `supabase/migrations/20261111100000_kitchen_event_core.sql`, `supabase/tests/database/223_kitchen_event_core.test.sql`, `supabase/tests/database/{004_waiter_cost_columns,059_cost_roles_v6}.test.sql` (one `kitchen_event` fixture row each; assertions unchanged), `supabase/tests/database/207_dashboard_preserves.test.sql` (line 28 list + `kitchen_event`, description names M19b), `supabase/tests/database/214_m20_preserves.test.sql` (line 487 list + `kitchen_event`, description names M19b) | `223`. **Shape:** line `done` with a line id ok; line `undone` ok; line with `cause 'auto'` → 23514; line with a session id → 23514; line `closed` → 23514; ticket `closed` with all four key columns ok, `auto` ok; ticket missing `segue` → 23514; ticket with a line id → 23514; subject `x` → 23514. **FKs:** a line of tenant B → 23503; a session of tenant B → 23503; `created_by` of tenant B → 23503. **`seq`:** two inserts get increasing `seq`; an explicit `seq` → 428C9. **Append-only:** UPDATE, DELETE, TRUNCATE → `append_only`. **RLS:** owner A, admin A read A's rows; chef A, waiter A read 0; owner B 0. **Privileges:** `authenticated` insert/update/delete false; `service_role` select true, insert false; anon none. **Indexes:** both partial indexes with their columns. `004`, `059`, `207`, `214` green |
| 2 | Migration: helpers (marker role, key parser, ticket lock, line done, ticket state, open lines) | `supabase/migrations/20261111100100_kitchen_event_helpers.sql`, `supabase/tests/database/224_kitchen_event_helpers.test.sql` | `224`. **Role:** `require_kitchen_marker` passes owner, admin, chef; waiter and no claims → 42501. **Key parser (T3):** `firedAt` `2026-11-04T20:10:00.123456Z` round-trips equal to the fixture's `fired_at`; 3 decimals, no `Z`, `+01:00`, `"x"` → 22023; course `"pizze"` → 22023; `segue: "true"` → 22023; bad uuid → 22023. **Line done:** no event → false; `done` → true; `done`, `undone` → false; `done`, `undone`, `done` → true; two events with the **same `created_at`** → the higher `seq` wins. **Ticket state:** none → open; `closed` → closed with its instant, user and `auto` flag; `closed`, `reopened` → open; events of the **segue** comanda of the same course do not change the non-segue one; tenant B's event ignored. **Open lines:** three lines (one done, one voided, one open) → 1. **Lock:** the lock function runs and returns for a valid key (its serialisation is proved by the races of step 10). No API role executes any of the six |
| 3 | Migration: the board (`kitchen_ticket_rows`, `kitchen_board_json`, `kitchen_tickets` replaced); `175` key sets and the `222` kitchen pin updated on purpose | `supabase/migrations/20261111100200_kitchen_board.sql`, `supabase/tests/database/225_kitchen_board.test.sql`, `supabase/tests/database/175_kitchen_tickets.test.sql` (lines 127–128 rows keys become `{closedTickets, remaining, tickets, truncated}`; lines 132–133 ticket keys become the fourteen of §3.2; lines 134–135 line keys become the eight; every other assertion unchanged), `supabase/tests/database/222_m21_preserves.test.sql` (line 34: `public.kitchen_tickets` re-pinned to its M19b `md5(prosrc)`, description "re-pinned by M19b step 3") | `225` (`app.kitchen_ticket_rows` at fixed instants; then `kitchen_tickets()` as chef). Fixture: T1 antipasti 20:00 (3 lines), T1 primi 20:10 and T1 primi segue 20:10, T2 secondi 20:15 (2 lines), tenant B. **AT1:** a `done` event on one T1 antipasti line at 20:20 → at 20:21 that line `done: true` and **last** in `lines`, `doneCount` 1, `lineCount` 3; at 20:19 (before the event) `done: false`. **AT2:** `done` then `undone` → `done: false`, back in creation order. **AT8:** a done line later voided → `done: false`, `voided: true`, placed between open and done lines, `lineCount` 2, `doneCount` 0. **Counts / AT15:** `remaining` = Σ open lines of active tickets (6 → 5 after one done); a closed ticket's open lines are **not** in `remaining`. **AT4/AT5:** a ticket with `closed auto` → in `closedTickets` with `autoClosed: true`, `closedBy` the chef, absent from `tickets`; `closed tap` → `autoClosed: false`; `closed` then `reopened` → back in `tickets` at its `fired_at` place (between the 20:00 and 20:15 tickets, by key); `closedTickets` ordered by `closedAt` desc (two closed tickets, by key). **Segue:** closing the T1 primi ticket leaves the T1 primi **segue** ticket active. **AT9:** a T1 primi line fired at 20:30 after the 20:10 ticket was closed → a new active ticket with key `…T20:30…`; the 20:10 one still closed. **AT10:** T2's session closed (owner fixture) → T2's tickets in neither list and their lines not in `remaining`. **Business day (cut-off 02:00):** a ticket fired at 00:30Z and closed → in `closedTickets` when read at 00:50Z, absent at 01:40Z. **Determinism:** an event with `created_at > p_at` is ignored. **AT11:** recursive key scan finds no key matching `059`'s chef regex; key sets exactly §3.2. **Cap:** 201 closed tickets → 200 in `closedTickets`, `truncated` true. Owner and admin get the same JSON as the chef; waiter → 42501. `175` green with its three updated key sets; `176` green unchanged; `222` green with the re-pin |
| 4 | Migration: `kitchen_mark_line` and `kitchen_set_ticket` | `supabase/migrations/20261111100300_kitchen_marks.sql`, `supabase/tests/database/226_kitchen_marks.test.sql` | `226` (as chef A unless named). **AT1:** `{done: true}` on L1 → `changed: true`, one `kitchen_event` (`line`, `done`, `tap`, `created_by` chef); the reply's `board` has L1 `done: true`. **AT2:** `{done: false}` → `changed: true`, a second row; the first row unchanged (compared as JSON). **AT3:** `{done: true}` twice → second `changed: false`, still one `done` row. **AT4:** marking the last open line → `autoClosed: true`, rows `done` + ticket `closed auto` (in that `seq` order), the ticket in `board.closedTickets`; then `{done: false}` on it → `reopened: true`, rows `undone` + `reopened auto`, ticket back in `board.tickets`. **Auto-close needs the last open line:** marking 2 of 3 → `autoClosed: false`. **AT5:** `kitchen_set_ticket({…, closed: true})` with 2 of 5 done → `changed: true`, `doneCount` still 2 in `closedTickets`; again → `changed: false`; `{closed: false}` → `changed: true`, active. **Done on a closed ticket:** `{done: true}` on an open line of a manually closed ticket → one line row, no ticket row, still closed. **AT8:** L1 voided (owner fixture) → `{done: true}` → `changed: false`, no row. **T1:** the reply's board (read in the same function) already contains the new event. **AT10 (writes):** closed session (owner fixture) → `P0001 session_closed` for both procedures, nothing written. **Errors:** draft line → `P0002 line_not_found`; tenant B's line → `P0002 line_not_found`; ticket key with no fired line → `P0002 ticket_not_found`; tenant B's key → `P0002 ticket_not_found`; `{}`, `{done: 1}`, extra key, null line → `22023 invalid_request`; ticket body missing `segue`, `firedAt` with 3 decimals → 22023; waiter → 42501 and nothing written. No error carries a DETAIL |
| 5 | pgTAP atomicity (AT13) | `supabase/tests/database/227_kitchen_marks_atomic.test.sql` | A test-only trigger on `kitchen_event` insert raising when `set_config('test.fail', 'ticket', true)` and `new.subject = 'ticket'` → `kitchen_mark_line` on the last open line raises; afterwards **no** `done` row for that line, the ticket open. The same fault on `undone` of a line of an auto-closed ticket → no `undone` row, the ticket still closed. A fault on `kitchen_set_ticket` → no row. Without the flag, the same calls succeed (the fixture is valid) |
| 6 | pgTAP role and tenancy matrix (AT7) | `supabase/tests/database/228_kitchen_marks_roles.test.sql` | `kitchen_mark_line`, `kitchen_set_ticket`: owner A, admin A, chef A allowed; waiter A and waiter A2 → 42501 and 0 new rows; no claims → 42501; tenant B owner and chef → P0002 on A's line and key, A's rows unchanged. `kitchen_tickets`: waiter → 42501 (unchanged). Waiter A and chef A `select` on `kitchen_event` → 0 rows (rows exist). `has_function_privilege('anon', …, 'execute')` false for the three public functions; no API role executes any M19b `app.*` function; the cost-named public function list equals `214`'s |
| 7 | Migration: `kitchen_event` in the demo purge list; `222` and `193` updated on purpose | `supabase/migrations/20261111100400_demo_purge_tables_m19b.sql`, `supabase/tests/database/222_m21_preserves.test.sql` (line 8: `where n not in ('day_close', 'kitchen_event')`, description "minus day_close and kitchen_event"), `supabase/tests/database/193_purge_demo_tenant.test.sql` (fixture: two `kitchen_event` rows per tenant; plan count raised by the per-table assertions it generates), `supabase/tests/database/229_m19b_preserves.test.sql` (the purge-order assertions only; the rest in step 9) | `194` green (every tenant table listed once, `kitchen_event` included); `193` purges D's `kitchen_event` rows and leaves R1/R2's byte for byte; `229`: `kitchen_event` precedes `order_line_cost`, `order_line`, `table_session` and `app_user`, is listed once, and the list minus `kitchen_event` equals the M21 list; `222` green with its updated line 8 |
| 8 | pgTAP performance net | `supabase/tests/database/230_kitchen_marks_perf.test.sql` | Under `statement_timeout = '5s'`: M19's `178` fixture shape (300 lines fired today on 30 sessions, 5 000 older), plus 3 000 kitchen events today and 50 000 older: `kitchen_tickets` answers; `kitchen_mark_line` and `kitchen_set_ticket` answer; `explain (format json)` of the line-state lookup mentions `kitchen_event_line_idx` and of the ticket-state lookup `kitchen_event_ticket_idx`. A regression net, not a latency claim |
| 9 | Guard: what M19b must not touch, and its pins | `supabase/tests/database/229_m19b_preserves.test.sql` (completed), `tests/config/m19b-preserves.test.ts` | `229`: `md5(prosrc)` (values on the branch before M19b's migrations, written in the test) of `public.fire_course`, `void_line`, `close_table`, `session_bill`, `order_view`, `tables_list`, `apply_op`, `app.apply_op_dispatch`, `app.close_session_at`, `app.order_line_json`, `app.order_line_guard`, `app.require_kitchen_reader`, `app.business_date`, `app.sync_op_kinds`, `app.ledger_checks_body` unchanged; `app.kitchen_ticket_rows` and `public.kitchen_tickets` pinned to their M19b text; `app.sync_op_kinds()` = M20's six (**AT12**: kitchen writes are not op kinds); `app.alert_kind` rows and both `audit_event` check definitions identical; the public tables are M21's plus `kitchen_event`; the public functions added by M19b are exactly `kitchen_mark_line`, `kitchen_set_ticket`. `m19b-preserves.test.ts`: no `supabase/migrations/20261111*` file contains `create or replace function public.(fire_course\|void_line\|close_table\|apply_op\|order_view)` or `app.(order_line_json\|order_line_guard\|sync_op_kinds)`; `public/sw.js` and `src/pwa/*` are not touched by the M19b diff (their `API_PATHS`/`SYNC_KINDS` equal the values on the base commit) |
| 10 | Race cases (AT6) | `scripts/test-db-races.sh` (eight cases appended; header lists them) | CI job `db-races`, existing cases unchanged; `no_deadlock` in all. **`kitchen-mark-twice`:** chef and owner mark L1 done, first parked → second blocked on the ticket lock → `changed: false`; one `done` row. **`kitchen-mark-last-two`:** L2 and L3 the last open lines; chef marks L2 (parked), owner marks L3 → blocked → after commit: two `done` rows and **exactly one** `closed auto`. **`kitchen-close-twice`:** two `kitchen_set_ticket closed` → one row. **`kitchen-mark-vs-close`:** mark of the last line parked; `kitchen_set_ticket closed` → blocked → `changed: false` (already auto-closed). **`kitchen-void-vs-mark`:** `void_line` of L1 parked (line UPDATE) → mark L1 → blocked on the SHARE → `changed: false`, no row. **`kitchen-mark-vs-void`:** mark parked (line SHARE) → `void_line` → blocked → voided after; the board shows L1 voided, not done. **`kitchen-mark-vs-close-table`:** `close_table` parked (session UPDATE) → mark → **not** blocked, commits; after the close, the board has no ticket of that session. **`kitchen-mark-vs-fire-replay`:** mark parked (L1 SHARE) → `fire_course` replay of L1 → blocked → `skipped already_fired`. Each case inserts its own fixture |
| 11 | TS domain: constants, schemas, outputs (snapshots updated on purpose), errors, view helpers, i18n, parity | `src/server/kitchen/{constants,schemas,output,errors}.ts`, `src/lib/kitchen/{kitchen-done,kitchen-view}.ts`, `src/lib/api/errors.ts`, `src/lib/i18n/messages/{it,en,keys}.ts`, `tests/server/kitchen/{schemas,output,errors}.test.ts`, `tests/server/kitchen/__snapshots__/output.test.ts.snap` (updated on purpose), `tests/helpers/kitchen-data.ts` (fixture board with the new keys), `tests/lib/kitchen/{kitchen-done,kitchen-view}.test.ts`, `tests/parity/kitchen-done-sql-parity.test.ts` | `schemas.test.ts`: `markLineBody` accepts `{done: true}`, rejects `{}`, `{done: "true"}`, extra key; `markTicketBody` accepts the fixture key, rejects 3-decimal `firedAt`, unknown course, missing `segue`. `output.test.ts`: `toJSONSchema` of `kitchenTicketsOutput`, `markLineOutput`, `markTicketOutput` `toMatchSnapshot()`; a walk finds no `059`-regex property; an injected `unitPrice` or `total` key fails the strict parse. `errors.test.ts`: `line_not_found`, `ticket_not_found` → 404; `session_closed` → 409; 42501 → 403; Italian messages. `kitchen-done.test.ts`: `markIntent` → `{done: true}` for an open idle line, `{done: false}` for a done one, `null` while pending, `null` at +599 ms after the last change and `{…}` at +600 ms, `null` for a voided line; `ticketMarkBody(ticket, true)` builds the five fields from the ticket (by key); `doneCountLabel(2, 5)` "2 di 5 fatti" and English "2 of 5 done"; `remainingLabel(7)` "Da fare: 7", `(0)` "Tutto fatto"; `closedLabel` "Chiusa alle 20:41 · Chef Demo" / "Tutto fatto alle 20:41" (Europe/Rome), and across the DST change (`2026-10-25T01:30:00Z` → "02:30"); `kitchenWriteBlock({online: false, stale: false})` and `({online: true, stale: true})` → blocked, `({true, false})` → null; `undoFor(reply, lineId, ticket)` → a line undo after `autoClosed`, a ticket reopen after a manual close; `lineAccessibleName` "Segna fatto: …" / "Annulla fatto: …". `kitchen-view.test.ts`: `firedLine` passes `done`. `kitchen-done-sql-parity.test.ts`: `FIRED_AT_RE` equals the regex in `app.kitchen_ticket_key`; `KITCHEN_MAX_TICKETS` equals both caps of `app.kitchen_ticket_rows` |
| 12 | API routes | `src/server/kitchen/marks.ts`, `src/app/api/kitchen/lines/[id]/mark/route.ts`, `src/app/api/kitchen/tickets/mark/route.ts`, `tests/app/api/{kitchen-line-mark,kitchen-ticket-mark,kitchen-tickets}.test.ts` | Fake session client. Mark routes: chef/owner/admin → one RPC (`kitchen_mark_line {p_line, p_body}`, `kitchen_set_ticket {p_body}`); waiter → 403 **before any RPC** (spy called 0 times); no session → 401; `text/plain` → 415; > 512 B → 413; malformed line id → 404 without RPC; `{done: "yes"}` → 400 without RPC; P0002 → 404; `session_closed` → 409; `Cache-Control: no-store`; `Server-Timing` present. **An injected `unitPrice` key in a fake board reply → 500, never in the JSON.** `kitchen-tickets.test.ts` (existing, updated fixture): 200 with `remaining` and `closedTickets` |
| 13 | Real-stack integration suite | `tests/integration/kitchen-done.int.ts` (reuses `tests/integration/helpers/firing.ts` `seedFiringTenant` and `tests/integration/helpers/closing.ts`) | Through the APIs: the waiter sends primi (2 lines) and secondi (1). **AT1/AT2:** chef marks a primi line → reply board `doneCount` 1; again `{done: false}` → 0; secret-key read of `kitchen_event` → 2 rows. **AT3:** `Promise.all` of two identical `{done: true}` → one `changed: true`, one `false`; one row. **AT4:** mark both primi → `autoClosed: true`; the ticket in `closedTickets`; undo → `reopened: true`. **AT5:** "Chiudi" secondi → closed; repeat → `changed: false`; reopen. **AT6:** chef and owner sessions mark the two primi lines in `Promise.all` → exactly one `closed auto` row. **AT7:** waiter → 403 on both routes; waiter session client `from('kitchen_event').select()` → 0 rows. **AT8:** waiter voids a done line via `POST /api/order-lines/:id/void` → 200 with M19's reversal + waste rows (secret-key read of `batch_movement` by `ref_id`); the board shows it voided, `done: false`. **AT9:** waiter sends another primi after the close → `GET /api/kitchen/tickets` has a second primi ticket (new key), the old one closed. **AT10:** waiter closes the table through M21's `POST …/close` with open kitchen dishes → 200; the board has no ticket of that session; a later mark → 409 `session_closed`. **AT11:** board JSON contains no `€`, `unitPrice` or cost key. Tenant B → 404 on A's line and key |
| 14 | Kitchen components: dish row, card, closed section, undo notice, remaining count | `src/app/(owner)/cucina/{kitchen-line,closed-section,undo-notice,remaining-count}.tsx`, `src/app/(owner)/cucina/ticket-card.tsx`, `tests/components/{kitchen-line,closed-section,undo-notice,remaining-count,ticket-card}.test.ts` | `renderToStaticMarkup` with fixture props. Dish row: an open line is a `button` with `aria-pressed="false"` and the name "Segna fatto: 2 × Spezzatino con polenta (demo)"; a done line `aria-pressed="true"`, `line-through`, the "Fatto" text; a pending line `aria-busy="true"`; a voided line is **not** a button and shows "Stornato · Errore in cucina"; `disabled` with the block; `min-h-tap` on every button. Card: "2 di 5 fatti", lines in the given order (by `data-line-id`), "Chiudi comanda" with its accessible name and `min-h-tap`; a `<script>` note rendered as text; **no "€"**. Closed section: "Chiuse oggi (2)" toggle with `aria-expanded="false"`, no card markup when collapsed; expanded: "Tutto fatto alle 20:41" and "Chiusa alle 20:41 · Chef Demo", a "Riapri" button per card, no dish buttons. Undo notice: `role="status"` text and "Annulla" (`min-h-tap`). Remaining: "Da fare: 7" with `data-remaining="7"`; "Tutto fatto" at 0. No component renders a number it did not receive (counts passed through the `kitchen-done.ts` labels only; source scan finds no `.reduce(` or `.length` over ticket data) |
| 15 | Kitchen page wiring: writes, tap guard, undo notice, offline block, errors | `src/app/(owner)/cucina/page.tsx`, `tests/components/kitchen-page.test.ts` (extended) | Fake timers, fake `apiJson`, fake `navigator.onLine`. A tap posts `{done: true}` to `/api/kitchen/lines/<id>/mark` (by id) and the reply's `board` replaces the screen (no extra GET); a second tap within 600 ms posts nothing; after 600 ms posts `{done: false}`; while pending, taps post nothing. `autoClosed` reply → the notice shows; "Annulla" posts `{done: false}` for that line; after 8 000 ms the notice is gone. "Chiudi comanda" posts the five-field body; "Riapri" posts `closed: false`. Offline (`onLine` false) or stale → every dish button and "Chiudi"/"Riapri" `disabled` with "Serve la connessione per segnare i piatti."; a rejected fetch → "Non salvato: controlla la connessione e riprova." and the board unchanged; 409 `session_closed` → its message and one GET. Polling still every 5 000 ms while visible. No `confirm(` and no `role="dialog"` in the page or its components (source scan + markup) |
| 16 | Playwright: kitchen done flows; UI note | `e2e/kitchen.spec.ts` (new `describe` "Fatto e chiusura", phone + laptop), `e2e/helpers/seed-firing.ts` (reused), `docs/design/ui-foundation.md` (§8 line for M19b: done row, notice, closed section) | Seeded through the API helpers: the waiter sends primi (2) and secondi (1). Chef on `/cucina`: tap "Segna fatto: … Tagliatelle" → that row (by `data-line-id`) is pressed and struck, card "1 di 2 fatti", header `data-remaining` 2 (**AT1, AT15**); tap again after `clock.fastForward(600)` → "0 di 2" (**AT2**); a quick double tap → one POST (request counter) (**AT3**); mark both primi → the card leaves the grid, `getByRole("status")` "comanda chiusa", "Annulla" → the card is back, by `data-ticket-key` (**AT4**); "Chiudi comanda" on secondi → "Chiuse oggi (1)" → expand → "Riapri" → back (**AT5**). Second context (owner, laptop project) sees the closed state after `fastForward(5_000)` (**AT6**, UI). Waiter sends another primi after the close → a new card with a new `data-ticket-key` (**AT9**). `context.setOffline(true)` → dish buttons disabled with the hint; online → enabled (**AT12**). Every dish, "Chiudi comanda", "Annulla" and "Riapri" control has `boundingBox().height ≥ 44`; no `dialog` role appears in the whole flow; at 360 px `expectPhoneFriendly`; on laptop at 1280 px and at 768 × 1024 (`setViewportSize`) no horizontal overflow and ≥ 2 cards share a row at 1280 (**AT14**). Chef `main` contains no "€" (**AT11**). The waiter on `/cucina` still gets the 403 message and no dish button (**AT7**, UI) |

**Acceptance tests (defined by this plan) → proof**

| AT | Statement | Proved in (step) | Command |
|---|---|---|---|
| AT1 | One tap marks a dish done: struck, moved down, "1 di 3 fatti", one `done` event | `225` (3), `226` (4), `kitchen-done.int.ts` (13), `kitchen-line.test.ts` (14), `kitchen.spec.ts` (16) | `npx supabase test db`; `npm run test:integration`; `npm test`; `npx playwright test` |
| AT2 | A second tap or "Annulla" undoes it; history has both rows, none updated | `223` (1, append-only), `225` (3), `226` (4), `kitchen-done.int.ts` (13), `kitchen-page.test.ts` (15, "Annulla"), `kitchen.spec.ts` (16) | as AT1 |
| AT3 | A double tap writes once | `226` (4), `kitchen-done.test.ts` (11, guard), `kitchen-page.test.ts` (15), `kitchen-done.int.ts` (13), `kitchen.spec.ts` (16), race `kitchen-mark-twice` (10) | as AT1; `scripts/test-db-races.sh` |
| AT4 | Marking the last open dish closes the comanda; "Annulla" reopens it | `225` (3), `226` (4), `kitchen-page.test.ts` (15), `kitchen-done.int.ts` (13), `kitchen.spec.ts` (16) | as AT1 |
| AT5 | "Chiudi comanda" closes at once into "Chiuse oggi"; "Riapri" puts it back in its oldest-first place; a repeat changes nothing | `225` (3), `226` (4), `closed-section.test.ts` (14), `kitchen-done.int.ts` (13), `kitchen.spec.ts` (16) | as AT1 |
| AT6 | Two kitchen devices at once: one event per intent, exactly one auto-close, no deadlock | races (10), `kitchen-done.int.ts` (13), `kitchen.spec.ts` (16) | `scripts/test-db-races.sh`; `npm run test:integration`; `npx playwright test` |
| AT7 | Chef, owner, admin mark and close; the waiter cannot (Postgres 42501, API 403 before any RPC); the waiter reads no event | `223` (1), `224` (2), `228` (6), route tests (12), `kitchen-done.int.ts` (13), `kitchen.spec.ts` (16) | `npx supabase test db`; `npm test`; `npm run test:integration`; `npx playwright test` |
| AT8 | Voiding a done dish keeps M19's void rows; the kitchen shows "Stornato", not counted, not tappable | `225` (3), `226` (4), races `kitchen-void-vs-mark`, `kitchen-mark-vs-void` (10), `kitchen-done.int.ts` (13), `kitchen-line.test.ts` (14) | as AT1; `scripts/test-db-races.sh` |
| AT9 | Dishes fired after a comanda closed form a new active comanda | `225` (3), `kitchen-done.int.ts` (13), `kitchen.spec.ts` (16) | as AT1 |
| AT10 | `close_table` is not blocked by kitchen state; the table's comande leave both lists; later marks → `session_closed` | `225` (3), `226` (4), race `kitchen-mark-vs-close-table` (10), `kitchen-done.int.ts` (13) | `npx supabase test db`; `scripts/test-db-races.sh`; `npm run test:integration` |
| AT11 | No € anywhere on the kitchen screen | `225` (3), `output.test.ts` (11), route tests (12), `kitchen-done.int.ts` (13), `ticket-card.test.ts` (14), `kitchen.spec.ts` (16) | all of the above |
| AT12 | Offline: controls disabled with the hint; a failed write changes nothing; nothing is queued | `kitchen-done.test.ts` (11), `kitchen-page.test.ts` (15), `kitchen.spec.ts` (16), `229` and `m19b-preserves.test.ts` (9) | `npm test`; `npx playwright test`; `npx supabase test db` |
| AT13 | Single transaction: a fault on the auto-close or auto-reopen leaves no line event | `227` (5) | `npx supabase test db` |
| AT14 | ≥ 44 px targets, no confirm dialog, phone 360 px, tablet 768 px and laptop 1280 px without horizontal scroll | components (14), `kitchen-page.test.ts` (15), `kitchen.spec.ts` (16) | `npm test`; `npx playwright test` |
| AT15 | "Da fare" equals the open dishes of active comande, computed by the server | `225` (3), `remaining-count.test.ts` (14), `kitchen.spec.ts` (16) | as AT1 |
| Invariants | §3.9 | `223` (1), `227` (5), `228` (6), `229` (9), components (14), existing `tests/lint/admin-client-import.test.ts` | `npx supabase test db`; `npm test`; `npm run lint` |

**CI implications:**
- pgTAP `223`–`230` run in the `supabase` job and in `scripts/test-db-native.sh`.
- Fixture rows only: `004` and `059` gain a fixture row and `193` gains fixture rows.
- **Assertions changed on purpose, each named in its step:** `175` (three key sets, step 3); `207` and `214` (public table list, step 1); `222` (line 34 re-pin in step 3, line 8 purge filter in step 7). Every other existing test is unchanged.
- Eight race cases. No Playwright config change: the cases live in `kitchen.spec.ts`, which already runs on `phone` and `laptop`.
- Updated Vitest snapshot (`kitchenTicketsOutput`) and new ones (`markLineOutput`, `markTicketOutput`). No new CI secret. Coverage ≥ 80 % on new TS.

### 5b. Variants

**V1 — The waiter sees "Pronto"** · Trigger: Q136 answered "yes, show the waiter when the kitchen has marked a dish done" · Replaces steps: none (adds after 16) · **Cost:**
- one new read for table operators (`public.session_kitchen_status`) and its route;
- one more RPC per open comanda every 15 s, riding the comanda's existing refresh;
- a badge and its i18n keys; three commits.

It leaves `order_view`, `app.order_line_json`, the waiter line snapshot, the service worker's four cached reads and the outbox untouched. Offline the badge shows nothing, because the read is not cached.

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | `public.session_kitchen_status(p_session uuid) returns jsonb`: `app.require_table_operator()` first; `{sessionId, asOf, readyLineIds, openLineIds}`. `readyLineIds` = fired, non-voided lines whose latest line event is `done`; `openLineIds` = fired, non-voided, not done, on a comanda that is not closed. Ids only | `supabase/migrations/<ts>_session_kitchen_status.sql`, `supabase/tests/database/<n>_session_kitchen_status.test.sql` (next free block) | Waiter A gets the done line in `readyLineIds` and the other in `openLineIds`; a voided done line in neither; a line of a manually closed comanda in neither list; chef → 42501; tenant B's session → P0002 `session_not_found`; key scan finds no `059`-regex key |
| V1.2 | `GET /api/table-sessions/:id/kitchen-status` (owner, admin, waiter), strict output, snapshot | `src/server/orders/kitchen-status.ts`, `src/server/orders/output.ts`, `src/app/api/table-sessions/[id]/kitchen-status/route.ts`, `tests/app/api/session-kitchen-status.test.ts`, `tests/server/orders/output.test.ts` | Chef → 403 before any RPC; waiter → 200 with exactly `{sessionId, asOf, readyLineIds, openLineIds}`; an injected key → 500; snapshot added |
| V1.3 | The comanda reads it with its 15 s refresh (online only, not added to the service worker); `readyBadge(lineId, status)` in `src/lib/orders/ready-view.ts`; a "Pronto" badge on the line row | `src/app/(owner)/tavoli/comanda/page.tsx`, `src/app/(owner)/tavoli/[sessionId]/line-row.tsx`, `src/lib/orders/ready-view.ts`, `src/lib/i18n/messages/{it,en,keys}.ts`, `tests/lib/orders/ready-view.test.ts`, `tests/components/{line-row,order-page}.test.ts`, `e2e/firing.spec.ts` | Badge for ids in `readyLineIds` only; no badge when the status read fails (offline); e2e: the chef marks a dish, after the waiter's next refresh the line shows "Pronto"; `public/sw.js` `API_PATHS` unchanged (existing SW parity test) |

**V2 — The close sheet warns about dishes still open in the kitchen** · Trigger: Q138 answered "warn the waiter, but do not block the close" · Requires V1.1 and V1.2 (built first if V1 is not built) · Replaces steps: none (adds to M21's close sheet)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V2.1 | The close sheet reads `GET /api/table-sessions/:id/kitchen-status` when it opens and shows "La cucina ha ancora 2 piatti aperti per questo tavolo." when `openLineIds` is not empty; the close button stays enabled | `src/app/(owner)/tavoli/comanda/close-sheet.tsx`, `src/lib/bill/close-form.ts` (`kitchenWarning(status)`), `tests/lib/bill/close-form.test.ts`, `tests/components/close-sheet.test.ts`, `e2e/bill-close.spec.ts` | `kitchenWarning` → text for 2 open ids, null for 0, null when the read failed; the button is not disabled by it; e2e closes a table with the warning shown and gets 200 |

**V3 — "Chiuse oggi" also lists comande of tables already closed** · Trigger: Q139 answered "keep them visible in the kitchen until the end of the day" · Replaces steps: the closed-session filter of step 3 (`app.kitchen_ticket_rows`) and its AT10 cases in 3, 13; the closed card of 14

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V3.1 | `app.kitchen_ticket_rows` replaced again: tickets of sessions closed in the business day go to `closedTickets` only (whatever their events), with `tableClosed: true` on every ticket key set; they never count in `remaining`; both write procedures still refuse them (`session_closed`) | `supabase/migrations/<ts>_kitchen_closed_tables.sql`, `supabase/tests/database/<n>_kitchen_closed_tables.test.sql`, `src/server/kitchen/output.ts`, `tests/server/kitchen/output.test.ts` | A closed table's open comanda appears in `closedTickets` with `tableClosed: true` and not in `tickets`; `remaining` excludes it; `kitchen_set_ticket` on it → `session_closed`; snapshot updated |
| V3.2 | The closed card shows "Tavolo chiuso" and no "Riapri" when `tableClosed` | `src/app/(owner)/cucina/closed-section.tsx`, `tests/components/closed-section.test.ts` | The label renders and the button is absent for `tableClosed: true`; present otherwise |

**V4 — A void that leaves nothing to cook closes the comanda** · Trigger: Q140 answered "if the waiter cancels the last dish still to make, close the comanda by itself" · Replaces steps: the "latest ticket event only" rule of `app.kitchen_ticket_state` (2) and its use in 3 and 4, with their cases

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V4.1 | Derived rule (no change to `void_line`): a comanda with **no** ticket event, at least one done line and no open line reads as closed with `autoClosed: true` and `closedAt` = the latest void or done instant; `kitchen_set_ticket` and `kitchen_mark_line` use the same rule for "current state"; "Riapri" writes `reopened` as usual | `supabase/migrations/<ts>_kitchen_close_on_void.sql`, `supabase/tests/database/<n>_kitchen_close_on_void.test.sql` | 2 done + the last open line voided → closed, `autoClosed: true`; all lines voided, none done → stays active; after "Riapri" → active even with nothing open; `{closed: true}` on such a comanda → `changed: false`; `void_line` md5 unchanged |

**V5 — Counts are in portions, not rows** · Trigger: Q141 answered "count plates: 2 × Spezzatino is two" · Replaces steps: the count rules of 3 and their cases in 3; the labels of 11 and 14

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V5.1 | `lineCount`, `doneCount`, `remaining` become Σ `qty` (numeric, 0,5 steps) of the same lines; output types `z.number()`; auto-close rule unchanged (still "no open line") | `supabase/migrations/<ts>_kitchen_counts_qty.sql`, `supabase/tests/database/<n>_kitchen_counts_qty.test.sql`, `src/server/kitchen/output.ts`, `tests/server/kitchen/output.test.ts` | A ticket of 2 × Spezzatino (done) + 0,5 × Zuppa → `doneCount` 2, `lineCount` 2.5; `remaining` 0.5; snapshot updated |
| V5.2 | Labels "2 di 2,5 porzioni fatte" and "Da fare: 0,5 porzioni" (Italian decimal comma) | `src/lib/kitchen/kitchen-done.ts`, `src/lib/i18n/messages/{it,en,keys}.ts`, `tests/lib/kitchen/kitchen-done.test.ts` | `doneCountLabel(2, 2.5)` and `remainingLabel(0.5)` render with a comma; English "2 of 2.5 portions done" |

## 6. Risks and mitigations

- **Security / privacy**
  - *Definer functions bypass RLS:* role check first, empty `search_path`, tenant from `app.tenant_id()`, every statement tenant-filtered, `app.*` without API grants (steps 2–6, `228`).
  - *Waiter marking:* `app.require_kitchen_marker()` in Postgres and 403 before any RPC (steps 4, 6, 12); no write grant on `kitchen_event` (1).
  - *Costs reaching the chef:* strict outputs that 500 on injected keys (11, 12), SQL key scans (3), components and e2e "no €" (14, 16).
  - *IDOR:* a foreign line or key → P0002/404 (4, 6); the ticket key is validated against fired lines of the caller's tenant before any write.
  - *Input validation:* strict Zod + strict SQL (`firedAt` regex, enum course, booleans only), 512 B bodies, JSON only (CSRF via `withApi`).
  - *Event spam:* a scripted client could add many rows. Mitigations: idempotent no-ops write nothing; roles are limited to staff accounts; rows are small. Retention follows project Q14 (Q144).
  - *Personal data:* staff ids and instants only; no guest data; codes-only logs; no timing report (Q144). GDPR register: no new category.
- **Correctness**
  - *Lost or double toggles:* target-state bodies, the per-ticket lock, the 600 ms guard (3, 4, 10, 11, 15).
  - *Two devices closing different ways:* one lock per comanda; `seq` order equals commit order (T2; races 10).
  - *Same-microsecond fires merging two comande (§3.1.6):* this needs two `fire_course` commits for one table, course and segue sharing one `clock_timestamp()` microsecond. Accepted. If it ever happened, both sets of lines show on one card, and a closed state would cover both; the chef reopens it.
  - *Breaking M19–M21:* only `app.kitchen_ticket_rows`, `public.kitchen_tickets` and the purge list are replaced, with the named test changes; `229` md5-pins the rest; no waiter screen, outbox or service worker file changes.
  - *Review changes to PR #39:* the branch is stacked; a rebase may shift `222`'s line numbers or md5 values. `tdd-guide` re-reads them before steps 3 and 7.
- **Unverified (proved in the named step):**
  - **T1:** a `stable` SQL function called in a later statement of the same PL/pgSQL function sees the rows inserted earlier in that transaction (command counter; <https://www.postgresql.org/docs/current/xfunc-volatility.html>). Proved in `226` (4).
  - **T2:** with every write of one comanda under one advisory transaction lock, identity `seq` values are assigned in lock order, so "highest `seq`" is the last committed event (<https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS>). Proved by `kitchen-mark-last-two` and `kitchen-mark-twice` (10).
  - **T3:** a `timestamptz` printed with `to_char(… 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` casts back to the identical value. Proved in `224` (2).
  - **T4:** `SELECT … FOR SHARE` on an `order_line` row waits for a concurrent `FOR UPDATE` by `void_line` and then sees `voided_at` (<https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS>). Proved by `kitchen-void-vs-mark` (10).
- **Performance / cost:** §3.11; `230` net; no figure promised. The only running cost is one RPC per tap; the poll is unchanged.
- **Dependencies:** none added.
- **Plan changes to record in DigiAlto-Ops `clients/osteria-dei-rossi/context.md`:**
  - M19 Q105 overridden (founder, 2026-10-31): the kitchen marks dishes done and closes comande (M19b). M40 keeps the printer and the bump bar only;
  - new table `kitchen_event` (append-only, derived kitchen state); new endpoints `POST /api/kitchen/lines/:id/mark`, `POST /api/kitchen/tickets/mark`; `GET /api/kitchen/tickets` gains `remaining`, `closedTickets` and per-comanda counts;
  - the kitchen poll stays 5 s (Q143; the brief's 15 s is the waiter's refresh).

## 7. Open questions for the founder (defaults in force for this build)

**Already decided and applied:** project Q16 = V6 (the chef never sees €); M19 Q98 (polling, 5 s); M20: kitchen writes are online-only; M21 Q129 (a table with unsent dishes cannot be closed).

**Overridden by this request:** M19 Q105 ("no done button").

**Still open from earlier plans:** project Q14 (retention); M19 Q97 (segue: the segue comanda is its own card either way).

**New:**
- **Q136 Should the waiter see "Pronto" on a dish once the kitchen marks it done?**
  - **Default:** no, not in this build. The waiter's screen is unchanged.
  - **Alternative:** yes (→ V1). Cost: one extra read per open table every 15 s, three small changes; nothing shows while the phone is offline.
- **Q137 More dishes of a course sent after its comanda was closed: new comanda or reopen the old one?**
  - **Default:** a new comanda at the end of the list; the closed one stays closed.
  - A different answer means a re-plan: the sending procedure would have to change (§4).
- **Q138 Should closing a table at the till care about dishes still open in the kitchen?**
  - **Default:** no; the close works as today, and the table's comande leave the kitchen screen.
  - **Alternative:** warn the waiter but allow the close (→ V2). Blocking the close would be a re-plan of M21.
- **Q139 Should comande of tables already closed stay in "Chiuse oggi"?**
  - **Default:** no; a closed table disappears from the kitchen screen, as today.
  - **Alternative:** keep them in "Chiuse oggi" marked "Tavolo chiuso" (→ V3).
- **Q140 If the waiter cancels the last dish still to make, should the comanda close by itself?**
  - **Default:** no; the kitchen sees "Stornato" and the chef taps "Chiudi comanda".
  - **Alternative:** close it automatically when at least one dish was done (→ V4).
- **Q141 "2 di 5 fatti" and "Da fare": count rows or portions?**
  - **Default:** rows, one per tap ("2 × Spezzatino" is one row).
  - **Alternative:** portions (→ V5).
- **Q142 How long should "Annulla" stay after a comanda closes, and how fast may a second tap undo?**
  - **Default:** 8 seconds for "Annulla"; a second tap on the same dish within 0,6 seconds is ignored (so a double tap never undoes).
  - Other values are a constant change (`KITCHEN_UNDO_MS`, `KITCHEN_TAP_GUARD_MS`), not a variant.
- **Q143 Kitchen refresh: 5 or 15 seconds?** The request said "the same 15 s as today"; the kitchen has refreshed every 5 s since M19 (your Q98), and 15 s is the waiters' screen.
  - **Default:** keep 5 s. The device that taps updates at once in either case.
  - 15 s is a constant change (`KITCHEN_POLL_MS`), not a variant.
- **Q144 Staff data in the kitchen record.** The app stores who marked each dish done or closed each comanda, and when, as it already does for every other action. "Chiuse oggi" shows "Chiusa alle 20:41 · Chef Demo".
  - **Default:** keep it, and build no report that times or compares staff. Please check with whoever advises you on staff privacy that this is fine for your kitchen.
  - A "no names" answer is a constant change (drop `closedBy` from the screen); stopping the recording itself is a re-plan.

**Assumptions (confirm; a different answer means a re-plan, not a variant):**
- **A1:** "Fatto" means the dish has left the pass. It is not a stock, cost or sales event, and no ledger or report other than the kitchen screen reads it.
- **A2:** "Chiudi comanda" does not mark the remaining dishes done. The count stays as it was ("2 di 5 fatti").
- **A3:** one or more kitchen devices (phone, tablet, laptop) may be open at once. Each sees the others' taps on its next refresh.

**Technical, resolved inside the build:** T1–T4 (§6).

## 8. Manual steps for the founder

- None are needed to build, test or merge M19b. Migrations reach staging through the existing deploy job after PR #39 and this PR merge.
- Answer Q136–Q144 when convenient. A different answer to Q136, Q138, Q139, Q140 or Q141 triggers its variant as a follow-up PR.
- At Gate 3 (supervised run): use "Fatto", "Chiudi comanda", "Annulla" and "Riapri" for one service on the kitchen device, in normal and high-contrast mode, at the pass.

## 9. Sources

- Worktree `/home/user/osteria-m19b` (branch `feat/m19b-kitchen-done`, PR #39 head):
  - SQL: `supabase/migrations/20261106100400_kitchen_tickets.sql`, `20261106100700_fire_locked_batches_only.sql`, `20261110100400_demo_purge_tables_m21.sql`;
  - pgTAP: `supabase/tests/database/{004,059,175,176,193,194,207,214,222}`;
  - TS: `src/app/(owner)/cucina/{page,ticket-card}.tsx`, `src/lib/kitchen/kitchen-view.ts`, `src/server/kitchen/*`, `src/app/api/kitchen/tickets/route.ts`, `src/server/orders/constants.ts`;
  - config: `public/sw.js`, `playwright.config.ts`;
  - docs: `docs/prd.md`; the project plan; the M19, M20 and M21 plans; ADR-019, ADR-022, ADR-023.
- PostgreSQL: advisory locks <https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS> (T2); row locks <https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS> (T4); function volatility and visibility <https://www.postgresql.org/docs/current/xfunc-volatility.html> (T1). Not re-read in this session.
- Zod 4 JSON Schema: <https://zod.dev/json-schema>.
