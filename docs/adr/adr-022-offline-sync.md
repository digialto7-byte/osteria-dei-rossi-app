# ADR-022 — Offline sync: one SQL dispatcher over the existing procedures, `applied_op` in the same transaction, stop on dead entities, a double-allowlisted read cache

- **Status:** proposed
- **Date:** 2026-10-29 · **Decided by:** founder (on the M20 plan `docs/plans/2026-10-29-m20-offline.md`; defaults Q117–Q125 open)
- **Refines:** ADR-005 (offline orders). Where the two differ, this ADR wins for M20 onwards.

## Context
- ADR-005 fixed the shape of offline orders:
  - an IndexedDB outbox;
  - ordered replay to `POST /api/sync`;
  - `applied_op` for idempotency;
  - a server-side conflict rule;
  - user binding;
  - a hand-written service worker.

  It did not say where the dispatch lives, how a refused op affects the ops queued after it, or exactly what the worker may cache.
- M17–M19 already made every order write safe to replay by entity id:
  - `open_table`, `add_order_line`, `update_order_line`, `remove_order_line`, `fire_course` and `void_line` are single-transaction definer procedures;
  - conflicts come back as results (`{conflict: {reason, line}}`) or coded P0001 errors.

  ADR-017 fixed last-write-wins per line with the `clientStamp` bump, and refuses a replayed add of a sold-out dish.
- `fire_course` refuses a call naming a missing line as a whole (`line_not_found`), on purpose (ADR-019).
- Waiter endpoints return no cost; owner endpoints do. Session cookies are HttpOnly, and screens read only `/api/*`.
- The brief forbids a new runtime dependency and requires that `/api/*` JSON with costs is never cached.

## Decision
- **One SQL dispatcher, no new business rules.**
  - `public.apply_op(p_op jsonb)` is security definer, with an empty `search_path`, and checks the role first.
  - In one transaction it:
    - checks the envelope and that `userId = app.app_user_id()` (user binding in Postgres);
    - takes an advisory lock on `(tenant, op_id)`;
    - returns the stored result as `duplicate` if the op is already in `applied_op`;
    - otherwise calls the existing public procedure for the op's kind, unchanged;
    - records the outcome in `applied_op` (`applied | conflict | rejected`, with `client_ts` and `received_at`).
  - Business errors (P0001, P0002, 22023) are caught in a subtransaction, so the procedure's writes roll back and the refusal is stored. Every other error rolls back the whole op and nothing is stored.
- **Outcome classes.**
  - **`conflict`:** the server's state won — an irreversible state (`fired`, `voided`, `session_closed`, `table_already_open`) or a later stamp (`stale`).
  - **`rejected`:** the op cannot apply (not found, sold out, invalid, clock ahead).
  - **`duplicate`:** a repeat of an op already recorded; it returns the stored result.
- **Stop on dead entities.** `/api/sync` applies 1–20 ops in order, one transaction each. It stops the batch:
  - after an `open_table` or `add_line` that did not apply, because its session or line does not exist and later ops may name it;
  - on an infrastructure error;
  - on a user mismatch.

  Before sending the rest, the phone prunes ops that name the dead entity: a queued fire loses the dead id and is re-issued under a new op id. Other conflicts and refusals do not stop the batch.
- **`applied_op`:**
  - keyed `(tenant_id, op_id)`;
  - append-only;
  - RLS on with no policy, and no API role can read it;
  - holds the reply exactly as the waiter received it (sale prices, never costs);
  - included in the demo purge.
- **Service worker** (`public/sw.js`, hand-written):
  - caches static assets, plus three shell pages network-first;
  - caches four cost-free waiter reads network-first with a 3 s fallback: `/api/me`, `/api/menu`, `/api/tables`, `/api/table-sessions/:id/lines`;
  - a read is cached only if its path is on the worker's allowlist **and** the response carries `x-offline-cache: 1`, which only those four routes may set (lint-tested);
  - nothing else is intercepted;
  - logout and PIN login clear the read cache. The outbox survives, for user binding.
- **The comanda gets a static route** (`/tavoli/comanda?s=<id>`), so one cached page serves sessions opened offline. The old path redirects.

## Alternatives
- **Dispatch in TypeScript, with a separate `applied_op` write.**
  - Pros: no SQL dispatcher.
  - Cons: two transactions, so "applied but not recorded" is possible.
  - Why not: idempotency must be atomic with the write.
- **New sync procedures per kind.**
  - Pros: tailored replies.
  - Cons: they duplicate every M17–M19 rule.
  - Why not: the existing procedures are already replay-safe, and md5 pins keep them unchanged.
- **Apply every op of a batch regardless.**
  - Pros: fewer round trips.
  - Cons: a fire naming a refused add is refused whole, so good dishes never reach the kitchen.
  - Why not: the stop-and-prune rule costs one extra request only when an add fails.
- **Stale-while-revalidate reads (ADR-005).**
  - Pros: instant reads.
  - Cons: shows a stale order first even online.
  - Why not: network-first with a short timeout is honest online and still works offline.
- **Cache any `GET /api/*`.**
  - Pros: simpler worker.
  - Cons: owner endpoints carry costs.
  - Why not: the invariant that waiters never see costs, and shared phones.
- **Serwist, Workbox or next-pwa.**
  - Pros: generated precache.
  - Cons: a dependency and bundler coupling.
  - Why not: about 150 lines of worker cover the need, and the brief forbids a runtime dependency.

## Consequences
- **Good:**
  - Every offline write is applied exactly once, atomically with its record.
  - The online and offline paths share every business rule.
  - Refusals and conflicts are stored and shown, never silent.
  - A sold-out add never blocks the rest of a course.
  - Cost data cannot reach the cache by accident.
- **Bad / accepted trade-offs:**
  - One more lock class, taken first.
  - `applied_op` grows with every op until a retention rule is chosen (Q120).
  - Moving the comanda's URL touches the nav model and links.
  - A rewritten fire gets a new op id, so the phone's outcome history shows the rewrite.
  - iOS storage policies and separate Safari and Home Screen storage remain device-level risks (runbook, Gate 3).
- **What would make us revisit this:**
  - A kind whose procedure is not replay-safe by entity id.
  - Founder answers to Q117 (waiters only), Q118 (record sold-out adds) or Q122 (merge into the open table).
  - Supervised-run evidence of frequent dead-entity stops or held ops.
  - Next.js offering a reliable offline route for dynamic segments, which would let the comanda return to `/tavoli/<id>`.
