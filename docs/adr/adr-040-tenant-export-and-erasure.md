# ADR-040 — Full tenant export at any time; whole-tenant erasure as a second sanctioned exception to append-only; per-tenant backup file packs

- **Status:** proposed
- **Date:** 2026-11-13 · **Decided by:** founder (to accept with `docs/plans/2026-11-13-platform-saas.md`, §6.2). The `CLAUDE.md` rule 6
  amendment below was **approved by the founder on 2026-11-13** (plan FD12: "yes, with safeguards"); it is committed in the SP10 pull
  request together with the code it describes, not before.

## Context
- As a SaaS operator DigiAlto processes data for many controllers; at the end of a contract a venue's data must be returned and then
  removed. What the law requires and the retention periods are **for a legal adviser** (plan FD13, FD22); this ADR makes no legal claim.
- `CLAUDE.md` rule 6: ledgers are append-only, nothing is deleted, only reversed. The one sanctioned exception is ADR-018's
  `purge_demo_data`, allowed only while `tenant.demo_data_since` is set and only through that function.
- **Founder decision FD12 (2026-11-13): erasure, yes, with safeguards.** Erasure happens only when all of these hold: after cancellation,
  plus a retention period (FD13, set with a legal adviser; until then nothing is erased); the owner's recorded written request; a
  platform-admin approval, audited. The rule 6 amendment is approved as this ADR describes and goes into the SP10 PR.
- **FD1 (2026-11-13):** DigiAlto owns the platform; Osteria Dei Rossi is customer and tenant #1; both have the same owner. DigiAlto has
  one platform admin today (the founder).
- Invoices are kept for 10 years by the venue (project plan §3.11.8); the export returns them to the venue.
- Backups (ADR-034): a daily encrypted dump of the whole database (14 copies) and incremental invoice-file packs **shared by all
  tenants** and never deleted by code. Supabase restores whole projects only, and Storage objects are not in database backups (Supabase
  docs `.../platform/backups.mdx`, read 2026-11-13 on GitHub).
- No per-tenant restore exists today.

## Decision
- **Export:** the owner can request a full export in any status except `erased`. A platform admin runs `scripts/tenant-export.ts`
  (secret key and database URL, `scripts/` only), which writes one encrypted ZIP (one CSV per tenant table, the tenant's invoice files,
  a checksum manifest) to a private `exports` bucket under the tenant's folder; the owner downloads it with a short-lived signed URL.
- **Erasure:** `platform.erase_tenant(p_tenant, p_request_event, p_approval_event)`, executable by the service role only and run by
  `scripts/tenant-erase.ts`, removes **all** of one tenant's rows, and only when **every** FD12 condition holds:
  1. the tenant is `cancelled` and the retention period has passed since the cancellation: `app.erasure_retention_days()` returns the
     FD13 period and returns **null until it is set, so nothing is erased** (`retention_not_set`);
  2. the owner's written request is recorded: `public.platform_record_erasure_request(p_tenant, p_document_ref)` writes
     `erasure.owner_request_recorded` to `platform.audit_event` (the written request is kept in DigiAlto's records outside the database;
     the reference code carries no personal data);
  3. a platform admin approved it, audited: `public.platform_approve_erasure(p_tenant, p_request_event)` (active `platform_admin`,
     `aal2`) writes `erasure.approved` to `platform.audit_event`.

  Both events must name the tenant and be later than the cancellation. A further plan safeguard (default, founder may revisit): an
  export was delivered or the owner's waiver is recorded. A refused call deletes nothing and names the missing condition. Erasure works
  like ADR-018: a marker (`tenant.erasure_since`) opens the delete path for that tenant only and only inside that function; UPDATE and
  TRUNCATE stay refused; a tombstone (tenant id only) goes to `platform.audit_event`. The script then deletes the tenant's Storage
  objects, its backup file packs and auth users with no other membership.
- **Backups:** invoice-file packs are written per tenant, so one tenant's packs can be deleted. Database copies are not edited; an erased
  tenant ages out with the 14-copy rotation, which the DPA states.
- **Per-tenant restore** is an export from a restored scratch copy (`scripts/backup/tenant-extract.ts`), never an in-place restore into
  the live database.
- **`CLAUDE.md` rule 6 amendment** (approved, FD12): rule 6 gains the second exception in the same form as the first, as a sub-bullet
  after the ADR-018 one. It is written in the **SP10 PR**, not before; `CLAUDE.md` is not edited by the planning PR. The SP10 PR may
  change only the function and marker names to what the migration actually built (plan SP10 test 7). Wording to commit:

  > - second sanctioned exception (ADR-040): `platform.erase_tenant` deletes all rows of one tenant, allowed only while
  >   `tenant.erasure_since` is set (only that function sets it, and only for a `cancelled` tenant whose retention period has passed,
  >   with the owner's recorded written request and an audited platform-admin approval) and only through that function, run by
  >   `scripts/tenant-erase.ts`; UPDATE and TRUNCATE stay refused, and within a live tenant nothing is deleted.

## Alternatives
- **Never erase; keep cancelled tenants read-only forever.** Pros: no exception to append-only. Cons: DigiAlto keeps personal data of
  controllers it no longer serves. Why not: not acceptable for a processor (adviser to confirm); the founder chose erasure with
  safeguards (FD12).
- **Pseudonymise instead of delete.** Pros: ledgers stay. Cons: invoices, supplier and reservation data are personal data in their
  content, not only in names. Why not: incomplete.
- **Crypto-shredding with per-tenant keys for every backup.** Pros: old database copies become unreadable at once. Cons: per-tenant key
  management in a founder-run job; key loss = data loss. Why not now: per-tenant file packs plus rotation are simpler.
- **In-place per-tenant restore.** Cons: rewrites ledgers, collides with rows written since, risks other tenants. Why not: ADR-002.
- **Erasure through an API route.** Why not: it needs the secret key outside the allowed places (rule 2) and should never be one click.
- **A separate table of erasure approvals.** Pros: one obvious place for the FD12 evidence. Cons: a new platform table, while
  `platform.audit_event` is already append-only and per tenant. Why not: the two events are platform audit rows.
- **Amending `CLAUDE.md` now, in the planning PR.** Why not: the rule would describe a function that does not exist yet; the founder
  asked for the amendment to land with the code in SP10.

## Consequences
- Good:
  - A venue can always take its data with it.
  - Within a live tenant the append-only rule is unchanged; the exception only removes a whole tenant.
  - Nothing can be erased until a retention period has been set with a legal adviser.
  - Every erasure has two audited events (the owner's request, the platform approval) and a tombstone.
  - One tenant's backup files can be removed without touching others.
- Bad / accepted trade-offs:
  - A second exception to an invariant, guarded by marker, function, service role, script, retention period and audited approvals.
  - With one platform admin, and at tenant #1 where the owner is also DigiAlto's owner (FD1), the recorded request and the approval can
    come from the same person; the audit still records each role separately.
  - Erased data survives in database copies until they rotate out.
  - Export and erasure are run by a person (a script), not self-service, until volume justifies automation.
  - ADR-034 changes: file packs per tenant.
- What would make us revisit this:
  - Legal advice requiring faster removal from backups (→ crypto-shredding).
  - A second platform admin at DigiAlto (→ the founder may ask for a two-person approval).
  - A paid Supabase plan with its own backups changing the backup design.
  - Export volume high enough to automate the script.
