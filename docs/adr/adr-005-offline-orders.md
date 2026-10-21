# ADR-005 — Offline order queue: IndexedDB outbox, idempotent ordered replay, server-side conflict rule

- **Status:** proposed
- **Date:** 2026-10-21 · **Decided by:** founder

## Context
- The PRD (3.1, 3.5, NFR Offline and Availability, Risks) sets these requirements:
  - "Orders queue in IndexedDB when the phone drops Wi-Fi and sync in order when back; conflicts are resolved server-side by timestamp with a visible warning."
  - "Multiple waiters can edit the same table; last write wins per line, no locking."
  - "Orders must survive a Vercel or Supabase outage of up to 30 minutes through the offline queue."
  - "Read data (menu, table list) cached by service worker."
  - "Kitchen screen shows a stale banner after 60 s without a heartbeat."
- Waiters use their own iOS and Android phones in the browser (PRD; unverified in profile). Background Sync cannot be relied on in Safari.
- Firing a course is the stock depletion event (PRD 2.3, 3.3). An item mapped to an empty batch cannot be ordered (PRD 3.2 acceptance).
- Next.js PWA libraries: next-pwa is reported deprecated. Serwist is the common successor, but its compatibility with Next.js 16's default bundler is not confirmed.

## Decision
- **Hand-written service worker:**
  - cache-first for immutable `/_next/static/*`;
  - network-first with cache fallback for navigations;
  - stale-while-revalidate for the menu and table reads (no cost data in them);
  - the first load must be online.
- **Outbox:** every waiter write (open table, add/edit/move line, fire, void, close) is an op in an IndexedDB outbox: `{op_id, seq, type, payload, client_ts, user_id}`.
  - Entity ids are generated on the client, so offline-created tables and lines can be referenced by later ops.
  - The UI applies ops optimistically and shows a pending-ops badge.
- **Replay:** triggered on `online`, on app focus, and on a 15 s timer while ops are pending.
  - `POST /api/sync` sends ops in `seq` order.
  - The server applies them one at a time, one transaction per op, recording `op_id` in `applied_op` (unique). A repeat returns the stored result.
  - The client stops at the first network or 5xx error, so order is preserved.
- **Conflict rule (server side):**
  - Last write wins per line by `client_ts`.
  - Irreversible states win over any edit: a fired line can only be voided, a voided line stays voided, and a closed table accepts no new lines.
  - Losing ops return `conflict` with the current state, and the waiter sees a warning.
  - `fire` is never rejected for lack of stock. It records a negative balance and raises an alert (ADR-002). Online order entry still rejects items whose batch has 0 portions.
- **User binding:** an op is applied only under the session of the user who queued it.
- **Kitchen screen:** Realtime plus 15 s polling, with a stale banner after 60 s.

## Alternatives
- **Serwist or another PWA library.** Pros: generated precache manifest. Cons: build-tool coupling and unconfirmed Next 16 compatibility; a dependency for about 100 lines of worker. Why not: the runtime caching we need is small. Revisit if precaching becomes necessary.
- **Background Sync API.** Pros: replay without the app open. Cons: Safari support is not assured. Why not: iOS waiters must work too; replay on focus and online covers service conditions.
- **CRDTs or operational transform (e.g. Yjs, Automerge).** Pros: merges without conflicts. Cons: heavy, and it does not express "fired is irreversible". Why not: the PRD specifies last write wins per line with a server-side rule.
- **Optimistic locking with version numbers (reject stale writes).** Pros: no silent overwrite. Cons: contradicts "no locking"; waiters would face frequent rejections. Why not: the PRD rule.
- **Rejecting a replayed fire when stock is short.** Pros: stock never negative. Cons: the plate was already served, so the sale and depletion would be lost and reports would be wrong. Why not: recording reality plus an alert is safer.
- **Client-side timestamps only, no server-side check.** Pros: simple. Cons: clock skew and stale clients could undo kitchen events. Why not: irreversible states are decided on the server.

## Consequences
- Good:
  - Orders survive dead spots and short outages.
  - Replay is safe to repeat.
  - Firing order is preserved.
  - Conflicts are visible, not silent.
  - The same procedures serve online and offline paths.
- Bad / accepted trade-offs:
  - The first load must be online.
  - Clearing browser data during an outage loses queued ops (runbook warns).
  - Client clock skew can decide last-write-wins between two edits of a non-fired line. This is accepted because only unfired lines are affected and a warning is shown.
  - Offline covers waiter writes only in the MVP; owner and kitchen writes need a connection.
- What would make us revisit this:
  - Safari gains reliable Background Sync.
  - Waiters regularly lose ops (seen in the supervised run).
  - The kitchen needs to write offline (for example batch production during an outage).
  - Multi-venue scale shows `applied_op` growth needs pruning (op ids can be pruned after a retention window once confirmed applied).
