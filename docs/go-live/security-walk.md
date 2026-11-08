# Security walk (M25 step 20, AT5)

Every item of `.claude/skills/security-checklist/SKILL.md`, word for word, with a verdict (`yes`, `no` or `n/a`) and the evidence for it. A `no` is either fixed by a named plan step or listed as an accepted risk. Accepted risks are decisions for the founder: the lines marked *proposed* need his confirmation on the go-live checklist. Walked on the branch `feat/m25-go-live`; the live-host parts are rechecked by the founder's runs (checklist AT2).

Nothing in this file is a secret.


## Secrets

- [ ] No keys, tokens or passwords in code, tests, fixtures, logs or git history.
  - verdict: yes
  - evidence: a scan of every commit on every branch for key shapes (Anthropic, Supabase secret, Resend, PEM private key) found only strings in tests that assert a value is not leaked; `.env.example` holds placeholders (`tests/config/env-example.test.ts`); the runbook, this walk and the checklist are tested against the same patterns (`tests/config/runbook.test.ts`, `tests/config/go-live-docs.test.ts`); the Sentry scrubber redacts credential keys and e-mail addresses (`src/lib/observability/scrub.ts`); backup logs hold names and counts only (`tests/scripts/backup/commands.test.ts`)
- [ ] Secrets come from environment variables or the host's secret store; `.env` is gitignored, `.env.example` has fakes only.
  - verdict: yes
  - evidence: values come from the environment (`src/lib/env/index.ts`) and from GitHub environments and Supabase Vault (`docs/runbook.md`, "Where every secret lives"); `.env` is gitignored and `.env.example` has fakes only (`tests/config/env-example.test.ts`); the Supabase secret key is imported only by the modules the project allows (`tests/guards/admin-client-importers.test.ts`, `tests/guards/privileged-importers.test.ts`)
- [ ] Keys are scoped to the minimum (read-only where possible) and rotatable.
  - verdict: yes
  - evidence: the Drive key is a service account with one folder (Content manager on the Shared Drive); the Supabase publishable key is public by design and RLS protects the data; production secrets are separate from staging's; every secret has a rotation row in `docs/runbook.md` (`tests/config/runbook.test.ts`)

## Input and output

- [ ] Every external input is validated by type, length, format and range, server-side.
  - verdict: yes
  - evidence: every route reads its input through a strict Zod schema in `withApi` before any query, with body-size caps (`tests/lib/api/with-api.test.ts`); the database re-checks (CHECK constraints, pgTAP)
- [ ] SQL uses parameterised queries or the ORM; no string-built queries.
  - verdict: yes
  - evidence: the app reaches Postgres only through supabase-js and `rpc` with bound arguments; test helpers that build SQL for the local stack quote ids through `quoteUuid`, which rejects anything that is not a uuid (`tests/e2e-helpers/invariants.test.ts`)
- [ ] No shell commands built from input; if unavoidable, pass an argument list, never a string.
  - verdict: yes
  - evidence: `src/` starts no process; scripts and tests pass an argument list (`execFileSync`, `psql` arguments), never a shell string (`tests/scripts/backup/commands.test.ts`)
- [ ] HTML output is escaped by the framework; no `innerHTML`/`dangerouslySetInnerHTML` with unsanitised data; no `eval`, `new Function` or string timers (the write hooks flag these).
  - verdict: yes
  - evidence: React escapes output; no raw-HTML sink, no `next/script` and no `eval` in `src/` (`tests/guards/no-raw-html.test.ts`); the page policy forbids inline script without this response's nonce, and script-src has no 'unsafe-inline' (ADR-028; `tests/lib/security/csp.test.ts`, `e2e/security-headers.spec.ts`)
- [ ] File uploads: type and size checked, stored outside the web root, renamed, never executed.
  - verdict: yes
  - evidence: invoice uploads: the real file type is sniffed (a renamed text file is refused, 415), the size is capped (413), an encrypted PDF is refused, and uploads are limited to 60 an hour (`tests/app/api/invoices/upload.test.ts`); stored in a private Storage bucket under a path of tenant and a generated id, not under the web root; the file is shown through a short-lived signed link
- [ ] Redirects only to allow-listed destinations.
  - verdict: yes
  - evidence: the only redirect that takes a value is the sign-in callback's `next`, which goes through `safeNextPath` and falls back to a fixed path (`tests/lib/api/safe-next.test.ts`)

## Auth and access

- [ ] Passwords hashed with a slow algorithm (argon2/bcrypt) or delegated to a provider.
  - verdict: yes
  - evidence: delegated to Supabase Auth (passwords, magic links, e-mail codes); staff PINs are turned into long derived passwords with a server-side pepper and never stored (`src/server/staff-auth/derive.ts`)
- [ ] Sessions/cookies: `HttpOnly`, `Secure`, `SameSite`; tokens expire.
  - verdict: yes
  - evidence: the session cookies are `HttpOnly`, `Secure` (except on a local http address) and `SameSite=Lax` (`src/lib/supabase/cookies.ts`); the app ends every session after 30 days (ADR-029; `tests/lib/api/with-api-session-age.test.ts`); staff sign-ins end with the day
- [ ] Every endpoint checks authorisation for the specific resource (no IDOR).
  - verdict: yes
  - evidence: every route names its roles in `withApi` (`tests/lib/api/with-api.test.ts`) and Postgres enforces tenant and role again with RLS and role checks in the procedures (pgTAP suites); a waiter never reads costs
- [ ] Rate limiting on login, signup, password reset, contact forms and any costly endpoint.
  - verdict: no
  - evidence: `docs/go-live/rate-limits.md` has one row per sensitive route; the PIN sign-in, enrolment and uploads have limits of our own; the owner's password and e-mail-code sign-in rely on Supabase Auth's limits, which are shared by the server's address, so a flood can lock out those sign-ins for everyone until the window passes (the magic link and the staff PIN stay open) (`tests/config/rate-limits-doc.test.ts`)
  - accepted risk: the owner's password and e-mail-code sign-in have no throttle of our own (Supabase Auth's shared limits; Q203); the founder reads the hosted limits before go-live (checklist S8-4)
- [ ] Admin areas not discoverable by default; MFA where the platform offers it.
  - verdict: no
  - evidence: owner and admin pages and routes are role-gated and the navigation shows each role only its own links; the app itself offers the owner no second factor, while MFA is required on every platform account (`docs/runbook.md`, "Accounts and access")
  - accepted risk: the owner and admin sign in with a password or an e-mail code and no second factor in the app; accepted by the founder on 2026-11-08 (RISK-1, S8-4). TOTP (required for the admin, optional for the owner) is an early Phase 2 item after go-live

## Web

- [ ] HTTPS only; HSTS on production.
  - verdict: yes
  - evidence: `Strict-Transport-Security: max-age=63072000; includeSubDomains` on production (`tests/lib/security-headers.test.ts`); `upgrade-insecure-requests` on production and preview (`tests/lib/security/csp.test.ts`); the live check requires HSTS with `--expect production` (`tests/lib/security/header-check.test.ts`, checklist AT2)
- [ ] Security headers: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `frame-ancestors`/`X-Frame-Options`.
  - verdict: yes
  - evidence: a per-request nonce policy on every page (`script-src 'self' 'nonce-…' 'strict-dynamic'`, script-src has no 'unsafe-inline'), a script-free policy on `/api/*`, `/sw.js` and the manifest, plus nosniff, Referrer-Policy and `X-Frame-Options: DENY`, with exactly one policy per response (ADR-028; `tests/lib/security/csp.test.ts`, `tests/proxy-csp.test.ts`, `tests/config/next-config-headers.test.ts`, `e2e/security-headers.spec.ts`, `e2e/pwa.spec.ts`); `scripts/check-headers.ts` checks a live host
- [ ] CORS limited to known origins; no `*` with credentials.
  - verdict: yes
  - evidence: the app sets no CORS header (`grep Access-Control` finds nothing in `src/` or `next.config.ts`); the browser calls only its own origin (`connect-src 'self'`) and has no Supabase client (`tests/guards/no-browser-supabase.test.ts`)
- [ ] State-changing requests protected against CSRF (SameSite cookies or tokens).
  - verdict: yes
  - evidence: the session cookie is `SameSite=Lax`; routes with a body accept only `application/json` or the named multipart type and answer 415 otherwise (`tests/lib/api/with-api.test.ts`), and an upload from a foreign `Origin` is refused with 403 before the session is read (`tests/app/api/invoices/upload.test.ts`), so a cross-site form cannot post to them; `form-action 'self'`
- [ ] Forms post only to destinations approved in the client profile; spam protection on public forms.
  - verdict: yes
  - evidence: the only public form is the sign-in page; it posts to the app itself (`form-action 'self'`) and its routes are limited as in the rate-limit review; there is no contact form
- [ ] Third-party scripts only when the brief needs them, loaded from the vendor's official domain, with SRI where versioned.
  - verdict: yes
  - evidence: none: the policy admits no script from another origin and `tests/guards/no-raw-html.test.ts` forbids `next/script`; fonts are self-hosted by `next/font`; the only cross-origin content is the signed Supabase Storage link in the invoice panel (`frame-src` and `img-src`)

## Personal data (GDPR for EU clients)

- [ ] Collect only what the feature needs; state why in the privacy text the client supplies.
  - verdict: no
  - evidence: the app stores staff names, the owner's e-mail, supplier data and the table covers; it holds no diner's name, phone or e-mail; the privacy text and the data processing agreement are the client's and are still open
  - accepted risk: the privacy text and the data processing agreement with its sub-processor list (Supabase, Vercel, GitHub for backups, Google Drive, Resend, Anthropic) are not yet supplied (project Q13, Q14); checklist item S8-3 and DPA-1 hold them for the client
- [ ] No tracking or non-essential cookies before consent (and only if the profile says tracking is approved).
  - verdict: yes
  - evidence: no analytics, no tracking and no non-essential cookie in the app; the client profile approves no tracking (`docs/client-facts.md`)
- [ ] Personal data never in logs, URLs or error messages; deletion is possible on request.
  - verdict: no
  - evidence: logs and error reports hold ids, names of checks and counts: the Sentry scrubber redacts credential keys, e-mail addresses and query strings (`src/lib/observability/scrub.ts`), backup logs never carry a URL, key or passphrase, URLs hold only uuids; there is no screen that erases a person
  - accepted risk: a request to erase a staff member's data is handled by hand by DigiAlto with the founder; append-only ledgers keep what they recorded (ADR-002); to be settled with the data processing agreement (Q13, Q14)

## Dependencies and deploy

- [ ] `npm audit` / `pip-audit` (or equivalent) has no high/critical issues, or each is explained.
  - verdict: yes
  - evidence: `scripts/audit-check.ts` runs in the `checks` job: a high or critical advisory fails unless `docs/go-live/audit-exceptions.json` excepts it with a reason and a review date; stale and expired exceptions fail (`tests/scripts/audit-check.test.ts`, `tests/config/ci-audit.test.ts`)
- [ ] Error pages and API errors don't expose stack traces or versions.
  - verdict: yes
  - evidence: `poweredByHeader` is off (`next.config.ts`); API errors are coded, translated messages parsed through strict schemas (`tests/lib/api/with-api.test.ts`); the error page is a static Italian message with no detail (`src/app/global-error.tsx`)
- [ ] Backups exist for anything holding client or customer data.
  - verdict: no
  - evidence: the daily encrypted dump (14 copies on a Shared Drive), the weekly restore check and the self-test cover the database (`tests/config/backup-daily-workflow.test.ts`, `tests/config/backup-restore-workflow.test.ts`, `tests/config/backup-selftest-workflow.test.ts`); the Free plan has no Supabase-side backup and no point-in-time recovery, so the recovery point is up to about a day; invoice PDFs in Storage are in no backup
  - accepted risk: invoice files not backed up, until `feat/backup-invoice-files` (founder 2026-11-08: they will be backed up before go-live; this acceptance is temporary)

## Accepted risks

Each is a known residual risk with the reason it is acceptable now. None concerns scripts.

- accepted risk: style-src 'unsafe-inline' (ADR-028). Inline `style=""` attributes and `<style>` elements are allowed on every page, because a nonce in `style-src` would make browsers ignore `'unsafe-inline'` and block the one inline width in `src/components/cost/plate-breakdown.tsx`. A style cannot run code; it can change how a page looks and, through CSS `url()`, request only what `img-src` and `font-src` allow (self and the Supabase origin). Decided by the founder and the lead on 2026-11-03 (Q234); variant V2 of the plan is the way to tighten it later.
- accepted risk: an offline shell page replays its cached nonce (ADR-028). A page the service worker stored keeps the nonce of the render it came from, and shows it again offline, together with the header it was stored with, so the page and its policy agree. The page is our server's own output with nothing added afterwards, and every network response gets a new nonce. WebKit's service worker is not driven by our tests, so the offline reload on a real iPhone is a checklist item (IPHONE-1).
- accepted risk: invoice files not backed up. **Reversed by the founder on 2026-11-08:** the `invoices` bucket joins the encrypted daily backup before go-live (`feat/backup-invoice-files`), and the weekly restore check verifies a sample of files; this line stays until that change lands. Supabase Storage objects (the invoice PDFs and photos) are in no backup: the daily dump holds the database only (Q186), and the Free plan has none of its own. Losing the project loses the files, while the invoice data stays in the database. The 10-year retention of invoices relies on Storage's durability alone.
- accepted risk: the owner's password and e-mail-code sign-in have no throttle of our own (item 13). Accepted by the founder on 2026-11-08 (RISK-1).
- accepted risk: no second factor for the owner and admin inside the app (item 14). Accepted by the founder on 2026-11-08 (RISK-1); TOTP (admin required, owner optional) is an early Phase 2 item after go-live.
- accepted risk: the privacy text and the data processing agreement are still open (item 21). For the client.
- accepted risk: no self-service erasure of a staff member's data (item 23). Accepted by the founder on 2026-11-08 (RISK-1); erasure is done on request.

## Walked and rejected

No line of this walk accepts an inline-script policy: script-src has no 'unsafe-inline' in any served build, and 'unsafe-eval' is allowed only under `next dev` (ADR-028).
