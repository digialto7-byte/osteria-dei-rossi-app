# ADR-036: A TOTP second factor for the owner and the admin, enforced in Postgres through the membership helpers, with DigiAlto-only reset

- **Status:** proposed
- **Date:** 2026-11-13
- **Decided by:** founder (Q-T1 to Q-T11, 2026-11-12), the lead (T-8, the lock as a permanent `app_user.mfa_locked` action, the actor rules of a single-admin reset on 2026-11-13), architect (the rest), in `docs/plans/2026-11-12-p2-1-totp.md`. The founder accepts it with the plan. The ADR number was re-checked with `git ls-remote` (ADRs 037–040 are drafted on `docs/platform-saas`; 036 was reserved for TOTP and is free on `main`).

## Context

- Phase 2 adds a second factor so that a stolen owner or admin password alone cannot reach a venue's data. Staff sign in with a PIN on an enrolled device (ADR-010) and are out of scope. The security walk accepted "no second factor" as a Phase 1 risk and named TOTP the early Phase 2 fix (RISK-1).
- Supabase Auth offers TOTP enrolment and verification on the Free plan; AAL and `amr` ride in the access-token claims; deleting a factor does not end the user's sessions (confirmed on the real stack). There is no per-account verification rate limit on Free; the hosted challenge/verify limit is shared.
- The project invariants (ADR-002, ADR-003, CLAUDE.md) say roles are enforced in Postgres, not only in the UI; almost every write and many reads go through `security definer` procedures that bypass RLS; the Supabase secret key is used only in `/api/cron/*` and `scripts/` (ADR-010 exception for `privileged.ts`).

## Decision

The twelve design points T-1 to T-12 of the plan:

- **T-1 One gate, in the three membership helpers.** `app.tenant_id()`, `app.role()` and `app.app_user_id()` return null for an owner or admin who owes the second factor, so every definer procedure and RLS policy that reads them refuses, with no per-table change.
- **T-2 Who needs `aal2`:** `app.mfa_needs_aal2(role, tenant, auth_id)` — an owner or admin, under a mode that is not `off`, who has a verified factor (always), or who is an admin under `required` (even with none, so they are forced to enrol).
- **T-3 Enforcement per tenant,** `tenant.mfa_enforcement`: `off` (kill switch, no gate), `enrolled` (default: the code is required once a factor exists), `required` (admins must have a factor). `required` is refused while an active admin is unenrolled (`admins_not_enrolled`, with the count), so nobody is locked out at the switch.
- **T-4 Exempt paths are few and named:** the MFA status/gate/attempt/enrol/record procedures in Postgres, which read `app.membership_ungated`; and the `mfa: "exempt"` API routes. pgTAP 341 scans the catalogue (functions and procedures) so no other function reaches `membership_ungated` or writes `auth.*`.
- **T-5 The API answers early and clearly.** `withApi` calls `public.mfa_gate()` only for an owner/admin request whose token is not `aal2`, before the handler and before body parsing: `challenge` → 403 `mfa_required`, `enrol` → 403 `mfa_enrol_required`. The 30-day cap and PIN checks come first.
- **T-6 Codes are verified server-side in one request** with `challengeAndVerify`, so the challenge and the verify leave from the same egress IP.
- **T-7 Two factor slots, fixed names** (`principale`, `riserva`), so no free-text device name is typed and nothing personal is stored. `MFA_MAX_FACTORS = 2`.
- **T-8 Audit first, then compensate.** The reset writes `app_user.mfa_reset` before the Auth call and `app_user.mfa_reset_failed` if it fails; F13 applies the same to PIN changes (`app_user.pin_set_failed`). A reset can never happen without an audit row.
- **T-9 App lock on wrong codes:** 5 failures in 15 minutes per account → 429 `mfa_locked`, counted from `app.mfa_failure` rows (Q-T2 = V2), which a daily job deletes after 30 days. A lock also writes one permanent `app_user.mfa_locked` audit row (lead 2026-11-12).
- **T-10 Reset rules (Q-T1 = V1):** no in-app reset. DigiAlto runs `scripts/mfa-reset.ts` as the service role, naming an active admin of the target's tenant as the actor (in a single-admin venue, the target's own app_user id; `created_by` then means "requested by"). The break-glass function deletes the target's sessions (its only `auth` write) and factors and records `app_user.mfa_reset` with `after {"sessions_revoked": n}`. A residual window of up to one hour applies to an access token already at `aal2`: with HS256 signing the Auth server refuses it so route handlers fail and only the direct Data API is exposed; with asymmetric signing keys `getClaims()` verifies locally so route handlers may accept it too. Data access stays refused by Postgres (the factors are gone and the gate re-checks). The window is accepted and recorded, not closed; the go-live checklist has the founder confirm the signing algorithm.
- **T-11 The owner is offered, not forced (D2):** after any sign-in of an owner or admin without a factor while not forced, the sign-in goes through `/login/offerta-codice` ("Attiva ora" / "Non ora"). No state is stored, so the offer returns at each sign-in (Q-T5 default).
- **T-12 QR shown as an image from a `data:` URL** on `/login/attiva-codice` and `/doppia-verifica` only; the CSP gains `data:` in `img-src` on those two paths alone. The QR is only ever an `<img src>`, never innerHTML; the secret lives in component state and is dropped on unmount, never in a URL, `localStorage` or the cache.

### Founder decisions (2026-11-12)

- **Q-T1 = V1:** reset is script-only, run by DigiAlto; there is no eighth privileged function and no in-app reset route (steps A12 and B6 are not built; `privileged.ts` stays at seven exports). The read-only "Altri account" list stays, as status only.
- **Q-T2 = V2:** wrong-code attempts are deleted after 30 days (`app.mfa_failure` + the `mfa-failure-retention` job); enrolment, removal, reset, reset-failed, enforcement-change and lock events are kept permanently in the audit log.
- **Q-T3 to Q-T11:** the defaults stand — the backup factor is strongly offered, not required (Q-T3); the resetter need not have their own factor (Q-T4, moot while reset is script-only); the owner offer repeats at each sign-in (Q-T5); 5 wrong codes in 15 minutes lock the code entry (Q-T6); the hosted challenge/verify limit is read, not changed (Q-T7); passkeys and recovery codes are deferred (Q-T8, Q-T9); the switch to `required` is the founder's call on a quiet day (Q-T10); the backup authenticator lives on a second phone or in a password manager, never in the repo or DigiAlto-Ops (Q-T11).

## Alternatives considered (rejected, §4 of the plan)

- **Restrictive RLS policies on every table** (the Supabase docs pattern) — the definer procedures bypass RLS, so the policies would gate little, and one would have to be added and never forgotten on every table.
- **`require_aal2()` in each procedure** — about two hundred pinned procedures re-pinned, one forgotten call is a hole, RLS reads stay open. Kept only for the MFA procedures.
- **Check only in `withApi`** — anyone with the password can call the Data API directly with the public key; it breaks "roles enforced in Postgres".
- **An `mfa_required` claim in the access-token hook** — stale for up to `jwt_expiry` after a mode change or a reset, and it widens the change to the hook that guards PIN sessions.
- **Gating inside the access-token hook (no tenant claims until `aal2`)** — the claims would be wrong until the next refresh, and the hook's PIN branch would share the risk.
- **Enforcement flag as an environment variable, or an in-app admin switch** — Postgres cannot read an env var and it is per deployment, not per tenant; an in-app switch could be turned off by an attacker in a session. The script keeps enforcement with the founder and the secret key.
- **Reset by deleting `auth.mfa_factors` rows from a definer** — the `auth` schema is managed by Supabase (ADR-010), and it would not end the target's sessions.
- **Recovery codes, phone/SMS factor, passkeys now** — not offered by the documented API for this version, a new processor and new personal data, and still-unverified hosted availability, respectively.

## Consequences

- One extra RPC per request for an owner or admin at `aal1` (in practice, owners without a factor). The kill switch (`--mode off`) restores access at the next query with no deploy if a gate bug locks someone out.
- No new dependency and no new paid service; TOTP is free on Supabase Free. No new processor: the factor secret stays in Supabase Auth.
- New audit rows about owner/admin security events carry no IP, device, code, secret or free text; wrong-code rows (account and time only) are deleted after 30 days (DPA-1).
- The owner guide (`docs/guides/accesso-e-personale.md`) explains the feature in Italian and states no legal rule — being required for admin accounts is a product choice, not a legal one. The runbook holds the rollout steps M-1 to M-7, the kill switch and the "Azzerare la verifica" reset procedure.
