# ADR-010 — Staff PIN login: peppered Supabase password, enrolled device, two-phase login gate, one audited secret-key exception

- **Status:** proposed
- **Date:** 2026-10-23 · **Decided by:** founder. **D1 = A approved (founder 2026-10-23)**, confirmed by the founder directly in the implementer session, with conditions: one `server-only` module exporting seven fixed functions and no client or key; ESLint allow-list naming only that file; tests failing on any other non-cron import of the admin client and on any change to the module's export list; pre-login attempt limits and lockouts enforced in Postgres (pgTAP `084`, races); CLAUDE.md rule 2 amended to name this module and its four routes. **Q10 decided:** the owner sees no per-person login or logout times; they are kept only for security with minimal retention.

## Context
- PRD: "Everyone logs in with a PIN or magic link"; Auth row "4-digit PIN per staff member on a venue device code"; NFR Security "PINs hashed"; Privacy "staff names and PINs only". Waiters have no email accounts.
- Project plan §3.11.3 chose: a Supabase auth user per staff member with a synthetic, never-mailed email, whose password is `HMAC-SHA256(PIN_PEPPER, user_id + ":" + pin)`; device enrolment by single-use code; lockouts; staff sessions end at the business-day cut-off; T1 spike first.
- Binding rules: no app table holds a PIN or anything derived from it (AT5); roles enforced in Postgres through definer RPCs (role check first, `search_path=''`, tenant from `app.tenant_id()`, execute to `authenticated`); the Supabase secret key only in `/api/cron/*` and `scripts/` (CLAUDE.md rule 2).
- Facts on `main` `7ce60fe`: `app.custom_access_token_hook` adds `tenant_id` and `app_role` for any active `app_user`; `app.tenant_id()` / `app.role()` re-check `is_active` on every statement; session cookies are HttpOnly (`src/lib/supabase/cookies.ts`); chef and waiter fixtures in the test suites sign in by email/password or magic link; the local Auth rate limit for sign-ins is 30 per 5 minutes per IP (`supabase/config.toml`); `[auth.sessions] timebox = 720h` applies to every user.
- Supabase Auth facts relied on (docs): the access token hook receives `user_id`, `claims` (with a required `session_id`) and `authentication_method` (`password`, `token_refresh`, …) ([custom access token hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook)); sign-in rate limits are per IP and configurable in the dashboard ([rate limits](https://supabase.com/docs/guides/auth/rate-limits)). How Supabase determines the client IP for server-originated calls is **not documented** (T1).

## Decision
1. **PIN verification lives in Supabase Auth, never in app tables.** Each PIN account is a Supabase auth user with email `staff-<app_user.id>@<STAFF_EMAIL_DOMAIN>` (default `staff.invalid`, T1) and password `base64url(HMAC-SHA256(PIN_PEPPER, app_user.id + ":" + pin))` (43 characters). Supabase stores only its own slow hash. The pepper lives only in server env, so the 10 000-PIN space cannot be tried against Supabase Auth directly. The PIN and the derived value are never stored, logged or sent to Postgres.
2. **`app_user.login_method` (`email` | `pin`).** Existing users and every chef/waiter fixture stay `email` and behave exactly as before. Only `pin` accounts (created by `create_staff`) get the device and session gates below.
3. **Enrolled device.** The owner (or admin) creates a single-use, 8-character code (15 min, stored as SHA-256). The device redeems it and receives a random 256-bit token in a `__Host-` cookie (`HttpOnly; Secure; SameSite=Strict; Path=/`). Only the token's SHA-256 is stored (`venue_device.token_hash`). Revocation is a state change (`revoked_at`), and a revoked or missing token gets 401 before any call to Supabase Auth.
4. **Two-phase login gate in Postgres.**
   - `pin_login_begin` runs before Auth. It checks the device (known, not revoked, not locked) and the user lock, refuses a second in-flight attempt per user or device, and inserts a `pending` `auth_attempt`.
   - `pin_login_finish` runs after Auth. It records the outcome, applies the lockouts, and on success opens a `staff_session` that ends at the next business-day cut-off.
   - The access token hook adds the tenant claims to a `pin` user's token only when one of two conditions holds:
     - a password sign-in has a pending attempt for that user started within 30 s;
     - a refresh carries a `session_id` that matches an open `staff_session` on a device that is not revoked and not locked.
     Otherwise the hook strips the claims and adds `session_state: 'ended'`.
   - A password sign-in that bypasses our route (for example, with a leaked pepper) therefore yields a token with no tenant.
5. **Lockouts are derived from the attempt log.**
   - A user is locked for 15 min when their 5 most recent verified attempts are failures. A PIN reset breaks the streak.
   - A device is locked when it records 20 failures in 60 minutes (counted since its last unlock). The lock raises one owner alert `device_locked` through `app.try_raise_alert`.
   - Thresholds live in SQL only.
6. **Session end.** `withApi` asks Postgres (`staff_session_active()`) on every request from a `pin` session and answers 401 `session_ended` once the session is past its cut-off, logged out, or ended by revocation, lock, PIN reset or deactivation. The hook enforces the same at the next refresh for direct Data API use.
7. **Retention.** `auth_attempt`, `staff_session`, unused enrolment codes and the IP-hash failure log are security logs of personal data, not ledgers. A daily pg_cron job deletes them after their retention period (project Q14: 30 days by default; the IP log after 1 day). Only that job, running as the table owner, can delete; no API role can. Every run is recorded in `app.job_run`.
8. **D1 — one audited secret-key exception (default, needs the founder/lead OK).** Creating a staff auth user and setting its password need Supabase's admin API, and the pre-login steps run before any user session exists. All of these go through exactly one server-only module, `src/server/staff-auth/privileged.ts`:
   - it is the only `src/` file outside cron that the ESLint allow-list lets import the admin client;
   - it exports a fixed list of seven functions, each validating its input and calling exactly one RPC or one admin method;
   - it never returns the client;
   - every admin call behind an owner route is preceded by an RLS-checked RPC in the owner's own session and followed by an `audit_event`.

   The alternatives (V1, V2 in the plan) keep rule 2 intact at a cost in surface or features.

## Alternatives
- **Custom JWTs signed by the app** — pros: no Supabase Auth user per staff member — cons: needs the project's JWT signing secret in the app and re-implements session refresh and revocation — why not: rejected in the project plan §4; a bigger secret than the one D1 uses.
- **`admin.generateLink` + `verifyOtp`** — cons: an open report of failures on repeated use (project plan §4) — why not: reliability.
- **PIN hash in an app table (bcrypt/argon2 in Postgres or TS)** — pros: no Auth user per staff member — cons: violates AT5, so app tables would hold PIN-derived data — why not: AT5.
- **Writing `auth.users` from a Postgres definer function** — pros: no secret key — cons: Supabase manages the `auth` schema; columns and identities change between versions; the derived password would pass through Postgres — why not: unsupported and fragile.
- **Pre-login checks callable by `anon` (capability RPCs taking the device token)** — pros: no secret key on unauthenticated routes — cons: new public internet surface and two more anon-callable definer functions; the "finish" step must be split so anon cannot forge a success — why not as default: D1 keeps a single choke point. Kept as variant V1.
- **Session end enforced inside `app.tenant_id()`** — pros: immediate for direct Data API use — cons: changes the helper every policy uses, and breaks every existing chef/waiter fixture that has no `staff_session` — why not: blast radius; the hook bounds the direct-API window to one token lifetime.
- **One global Auth session timebox** — cons: one value for every user; owners need 30 days — why not: staff sessions must end at the cut-off.

## Consequences
- Good:
  - no app table holds anything derived from a PIN (pgTAP column scan plus an integration data scan);
  - brute force needs both an enrolled device and the pepper, and the lockouts bound it;
  - a revoked device, a deactivated user, a PIN reset or the cut-off ends access at the next API call;
  - email users (owner, admin, existing fixtures) are unchanged.
- Bad / accepted trade-offs:
  - **D1 widens the secret key to four user-facing routes** (`/api/auth/pin`, `/api/auth/device`, `/api/devices/enrol`, `/api/users*`), through one module. This needs an explicit founder/lead OK.
  - After revocation or the cut-off, a stolen access token (HttpOnly, so hard to extract) can still reach the Data API directly until it expires (`jwt_expiry` 3600 s), because only `withApi` checks immediately.
  - All server-originated sign-ins share Vercel's egress IPs as seen by Supabase, so the per-IP sign-in limit is shared venue-wide (T1). Our lockouts run before Auth, which bounds what one device can consume.
  - Rotating `PIN_PEPPER` invalidates every PIN (every staff PIN must be reset; runbook M25).
  - The `device_locked` alert deduplicates per device per business date, so a second lock on the same day after an unlock raises no new alert (the device screen still shows it).
- Open notes:
  - the T1 staging check (manual, founder OK);
  - the IP header seen on Vercel for the enrolment limit;
  - TOTP MFA for admin (M0 Q-C), not part of this decision.
