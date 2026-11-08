# ADR-032: Public reservation requests go through anon-granted definer functions behind a route-only HMAC gate; e-mails leave through a DB outbox drained by a cron route; cancel links are HMAC-signed

- **Status:** proposed
- **Date:** 2026-11-08
- **Decided by:** architect, on the reservations plan (`docs/plans/2026-11-08-reservations.md`, §3.1 decisions 9–13, §3.7, §3.9). The founder accepts it with the plan.

## Context

- **Founder's decisions (2026-11-08, through the lead):**
  - a public booking page, mobile-first, Italian with English second, on the app's own origin (`/prenota`), with no login, linked from the website, Google and Instagram;
  - a request, then approval by staff, with the customer told by e-mail on received, accepted and declined;
  - each e-mail carries a signed cancel link;
  - e-mails through Resend (not set up yet), behind a mail-sender abstraction with a dev/test sink (the local Supabase Mailpit, `E2E_MAILPIT_URL` in CI);
  - **scope change:** `docs/prd.md` line 21 (non-goals) and line 68 (out of scope) list "reservations" and "customer data". Both are lifted **for this feature only**, so this is the first customer personal data in the app (GDPR).
- **Existing rules that constrain the design:**
  - Rule 2 (`CLAUDE.md`, ADR-010): the Supabase secret key is used only in `/api/cron/*`, `scripts/` and `src/server/staff-auth/privileged.ts`; never in user-facing routes.
  - Invariants: every table has `tenant_id` and RLS; roles are enforced in Postgres; every screen reads `/api/*`; procedures run as single transactions; ledgers are append-only.
  - ADR-028 (accepted, arriving with M25): a strict nonce CSP with `connect-src 'self'`, `form-action 'self'`, no third-party script and no `'unsafe-inline'` scripts.
- **What exists today (checked on `main`):**
  - No anon-granted function and no public write path. The publishable key is public by design, so **anything granted to `anon` is callable directly through PostgREST**, bypassing our routes.
  - No mail abstraction; auth mail goes through Supabase Auth; `RESEND_API_KEY` is read by no code.
  - No throttle for public endpoints. The one precedent is the per-IP-hash enrolment counter `app.enrol_failure` (M11).
  - pg_cron already calls `/api/cron/*` through `app.call_cron_route` with a bearer from Vault (M3, plus the Vercel bypass header).

## Decision

1. **The public write path is a set of `SECURITY DEFINER` functions in `public`, granted to `anon` only, each gated:**
   - `reservation_page`, `reservation_slots`, `request_reservation`, `reservation_cancel_view`, `cancel_reservation`.
   - Each takes `p_gate_ts` and `p_gate_mac`, where `p_gate_mac = HMAC-SHA256(RESERVATION_GATE_KEY, "resv-gate|v1|<function>|<slug>|<ts>")`. The function verifies it **first**, with `extensions.hmac` (pgcrypto) against Vault `reservation_gate_key` (or `reservation_gate_key_next` during rotation), within ±60 s. Otherwise it raises P0001 `gate_invalid`.
   - Only our Next.js routes hold the key, so a direct PostgREST call fails. The route's own checks therefore cannot be skipped: `Origin`, JSON, size, honeypot, the signed fill-time token, and the client IP passed in.
   - The routes call the RPCs with a cookie-less publishable-key client (`src/lib/supabase/anon.ts`), so the role is always `anon`.
   - **No route uses the Supabase secret key**; rule 2 is unchanged.
   - `anon` holds no table privilege. All validation, capacity rules, locks, the throttle, the inserts and the outbox row happen in one transaction inside the function.
2. **Abuse limits live in the database:**
   - per day, per tenant: an HMAC (pgcrypto, salt in Vault `reservation_hash_salt`, the day in the message) of the client IP, the e-mail and the phone, counted in `app.reservation_throttle`;
   - a cap on open `pending` requests per tenant;
   - raw IPs are never stored or logged, and the hashes are unlinkable across days and deleted after 2 days;
   - no CAPTCHA by default (no third-party script under ADR-028).
3. **Tenant resolution by path slug:** `/prenota/<slug>`, with `reservation_settings.public_slug` globally unique. Unknown, disabled and not-ready slugs give one identical 404. Host mapping is a later option (plan V5).
4. **E-mails leave through an outbox:**
   - the state change and its `reservation_email` row (no address, no personal data) commit together;
   - pg_cron calls `/api/cron/reservation-mail` every minute, only when a row is due, through the existing `app.call_cron_route`;
   - the route (`withCron`; the secret key is allowed there) claims rows with `FOR UPDATE SKIP LOCKED` and a lease, renders it/en text and HTML, and sends through `MailSender`, with the outbox id as the provider idempotency key;
   - failures are retried with backoff (5 attempts).
   - `MailSender` has two implementations: Resend (one `fetch`, no package) and Mailpit (dev/test). `MAIL_TRANSPORT` selects one, and `mailpit` is refused in production.
5. **Cancel links are HMAC-signed with an app key, not stored tokens:**
   - token `c1.<kid>.<reservationId>.<exp>.<mac>`, where `mac = HMAC-SHA256(RESERVATION_LINK_KEY, "resv-cancel|c1|<reservationId>|<exp>")` and `exp` = the booked start minus `cancel_until_minutes`;
   - the route verifies the MAC before any database call;
   - every invalid case gives the same 404 `link_invalid`, so nothing can be enumerated;
   - GET only shows the booking; POST cancels (mail scanners prefetch GETs);
   - **single use** follows from the status change: a second use answers "already cancelled";
   - the key lives in the Vercel env. `kid` = the first 8 hex of the key's SHA-256, so `RESERVATION_LINK_KEY_PREVIOUS` keeps old links valid during a rotation, until `horizon_days` have passed;
   - the same key, with the purpose prefix `resv-form|`, signs the form token that enforces the minimum fill time.
6. **Personal data is isolated and short-lived:**
   - name, phone, e-mail and locale live in `reservation_contact`, readable by owner, admin and waiter only (RLS; the chef gets 0 rows);
   - a SQL-only pg_cron job deletes them `retention_days` (default 30) after the booked date; staff can erase them on request;
   - the anonymous `reservation` row stays;
   - the lawful basis is Art. 6(1)(b) (pre-contractual steps at the customer's request). The form's checkbox records that the notice was read; it is not consent.

## Alternatives

- **The secret key in the public route** (a second `privileged.ts`-style exception to rule 2).
  - Pros: no gate, no anon grants; the route does everything.
  - Cons: the only unauthenticated write route would hold a key that bypasses RLS on every table. A bug or SSRF there exposes the whole database.
  - Why not: the gate gives the same "only our route can write" property at a fraction of the blast radius.
- **Anon-granted functions without a gate.**
  - Pros: simplest.
  - Cons: anyone with the public key calls them directly, skipping the honeypot, fill time and Origin checks, and choosing any "IP".
  - Why not: it makes every route-side protection decorative.
- **Anon INSERT on the tables with an RLS `with check` policy.**
  - Why not: no place for slot rules, locks, throttling, the event or the outbox in one transaction, and anon would gain table privileges.
- **A Supabase Edge Function (Deno) for the public write.**
  - Why not: a second runtime, deploy path and secret store for one endpoint. The Next.js route already has `withApi`, Zod, the guards and the tests.
- **Supabase Auth anonymous sign-ins for customers.**
  - Why not: it creates auth users for strangers, adds cookies to a public page, and still needs every abuse control.
- **Sending e-mail inline from the routes** (public request, staff accept and decline).
  - Pros: no cron, no delay.
  - Cons: customers and staff wait on the provider; a provider failure either loses the e-mail or forces a rollback of the state change; retries and idempotency are duplicated in four routes; the Resend key would reach staff routes.
  - Why not: the outbox is atomic with the state change and has one sender. The accepted cost is up to about one minute of delay.
- **CAPTCHA (Turnstile, hCaptcha) by default.**
  - Why not as default: a third-party script and origin in the ADR-028 policy, a new sub-processor and notice change, for requests that staff approve by hand anyway. Plan variant V3.
- **Random cancel tokens stored hashed.**
  - Equivalent strength, but every garbage token costs a database read, and each e-mail needs a stored value. Revocation is the one gain, and the status change already covers it.
- **Tenant by host name now.**
  - Why not now: no custom domain exists yet, and staging and preview need a path. Plan V5 adds it later.

## Consequences

- **Good:**
  - rule 2 is unchanged;
  - the database refuses any public call that did not pass through our route;
  - capacity and throttling are race-safe inside one transaction;
  - e-mails are durable, retried and idempotent;
  - no new npm dependency and no third-party script;
  - the personal data has one table, one retention job and one erasure path.
- **Bad / accepted trade-offs:**
  - **Three new secrets.** `RESERVATION_GATE_KEY` must match in the Vercel env and in Vault; the link key and the hash salt are new too. Each has a documented rotation (plan §3.7). A missing Vault value makes the public routes answer 503, so the failure is visible, not silent.
  - **pgcrypto** is enabled in `extensions` for `hmac` (`create extension if not exists`).
  - **The IP limit is only as good as `x-forwarded-for` on Vercel** (open item T-R4, as in M11). The e-mail, phone and tenant caps still hold if it is spoofable.
  - **Up to about one minute of e-mail delay** (the cron period).
  - **The public page renders per request** (as all pages under ADR-028).
  - **Backups keep deleted contacts until they rotate out** (14 days, M25); the privacy notice says so.
  - **Staff can read contacts directly.** Waiters (with owner and admin) can read the tenant's reservation contacts directly through PostgREST, not only via the day view. This is the widest personal-data surface of the feature, plan-sanctioned and bounded by the 30-day retention and by erasure on request.
  - **Resend becomes a sub-processor.** Its data location, retention and prices are open questions for the founder, not assumed.
- **What would make us revisit this:**
  - a need for third-party scripts on the page (CAPTCHA, analytics): CSP and notice changes, plan V3;
  - a booking domain per tenant (plan V5);
  - abuse that gets past the DB limits (then a CAPTCHA or a Vercel firewall rule);
  - Supabase offering custom JWT roles that make a dedicated low-privilege role simpler than the gate;
  - a second public write feature: the gate should then become a shared helper.
