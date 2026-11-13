# ADR-040 — Full tenant export at any time; whole-tenant erasure as a second sanctioned exception to append-only; per-tenant backup file packs

- **Status:** proposed
- **Date:** 2026-11-13 · **Decided by:** founder (to accept with `docs/plans/2026-11-13-platform-saas.md`, §6.2; needs a `CLAUDE.md`
  rule 6 amendment)

## Context
- As a SaaS operator DigiAlto processes data for many controllers; at the end of a contract a venue's data must be returned and then
  removed. What the law requires and the retention periods are **for a legal adviser** (plan FD13, FD22); this ADR makes no legal claim.
- `CLAUDE.md` rule 6: ledgers are append-only, nothing is deleted, only reversed. The one sanctioned exception is ADR-018's
  `purge_demo_data`, allowed only while `tenant.demo_data_since` is set and only through that function.
- Invoices are kept for 10 years by the venue (project plan §3.11.8); the export returns them to the venue.
- Backups (ADR-034): a daily encrypted dump of the whole database (14 copies) and incremental invoice-file packs **shared by all
  tenants** and never deleted by code. Supabase restores whole projects only, and Storage objects are not in database backups (Supabase
  docs `.../platform/backups.mdx`, read 2026-11-13 on GitHub).
- No per-tenant restore exists today.

## Decision
- **Export:** the owner can request a full export in any status except `erased`. A platform admin runs `scripts/tenant-export.ts`
  (secret key and database URL, `scripts/` only), which writes one encrypted ZIP (one CSV per tenant table, the tenant's invoice files,
  a checksum manifest) to a private `exports` bucket under the tenant's folder; the owner downloads it with a short-lived signed URL.
- **Erasure:** `platform.erase_tenant(tenant_id, approvals)`, executable by the service role only and run by `scripts/tenant-erase.ts`,
  removes **all** of one tenant's rows, only when the tenant is `cancelled`, the retention window has passed, an export was delivered or
  waived, and the approvals exist (one platform admin plus the owner's recorded request; revisited when DigiAlto has two platform
  admins). It works like ADR-018: a marker (`tenant.erasure_since`) opens the delete path for that tenant only and only inside that
  function; UPDATE and TRUNCATE stay refused; a tombstone (tenant id only) goes to `platform.audit_event`. The script then deletes the
  tenant's Storage objects, its backup file packs and auth users with no other membership.
- **Backups:** invoice-file packs are written per tenant, so one tenant's packs can be deleted. Database copies are not edited; an erased
  tenant ages out with the 14-copy rotation, which the DPA states.
- **Per-tenant restore** is an export from a restored scratch copy (`scripts/backup/tenant-extract.ts`), never an in-place restore into
  the live database.
- `CLAUDE.md` rule 6 gains the second exception in the same words as the first.

## Alternatives
- **Never erase; keep cancelled tenants read-only forever.** Pros: no exception to append-only. Cons: DigiAlto keeps personal data of
  controllers it no longer serves. Why not: not acceptable for a processor (adviser to confirm).
- **Pseudonymise instead of delete.** Pros: ledgers stay. Cons: invoices, supplier and reservation data are personal data in their
  content, not only in names. Why not: incomplete.
- **Crypto-shredding with per-tenant keys for every backup.** Pros: old database copies become unreadable at once. Cons: per-tenant key
  management in a founder-run job; key loss = data loss. Why not now: per-tenant file packs plus rotation are simpler.
- **In-place per-tenant restore.** Cons: rewrites ledgers, collides with rows written since, risks other tenants. Why not: ADR-002.
- **Erasure through an API route.** Why not: it needs the secret key outside the allowed places (rule 2) and should never be one click.

## Consequences
- Good:
  - A venue can always take its data with it.
  - Within a live tenant the append-only rule is unchanged; the exception only removes a whole tenant.
  - One tenant's backup files can be removed without touching others.
- Bad / accepted trade-offs:
  - A second exception to an invariant, guarded by marker, function, service role and script.
  - Erased data survives in database copies until they rotate out.
  - Export and erasure are run by a person (a script), not self-service, until volume justifies automation.
  - ADR-034 changes: file packs per tenant.
- What would make us revisit this:
  - Legal advice requiring faster removal from backups (→ crypto-shredding).
  - A paid Supabase plan with its own backups changing the backup design.
  - Export volume high enough to automate the script.
