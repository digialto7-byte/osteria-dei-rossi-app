# ADR-029 — Owner and admin sign in with Supabase e-mail/password; e-mail code as fallback; 30-day cap enforced in the app; `/login` as the single entry point

- **Status:** accepted
- **Date:** 2026-11-01 · **Decided by:** founder (accepted 2026-11-01; plan `docs/plans/2026-11-01-m25a-password-login.md`, Q197–Q206)

## Context

- Owners and admins today sign in only by magic link (M0). The founder reports that waiting for an e-mail each time is the main friction on phones, and wants wide adoption by staff.
- On an iPhone, an app installed to the home screen keeps its cookies apart from Safari (M11 Q12). A link tapped in Mail opens in Safari, so the PKCE callback lacks its verifier there, and the sign-in would land in Safari anyway. This is prior knowledge, to be checked on devices (plan T5b, M-3).
- The PRD and the project plan set 30-day sessions. `[auth.sessions] timebox = "720h"` (`supabase/config.toml`) acts only on the local stack. The hosted equivalent appears to be a paid-plan feature (M0 Q-B; plan T6), and production is on Supabase Free (M25 Q187). So hosted sessions currently never expire. M0's variant V1 (an app-enforced cap) was never built.
- Leaked-password protection (HaveIBeenPwned) appears to need Supabase Pro (plan T1).
- Session cookies are HttpOnly and there is no browser Supabase client. Every screen reads `/api/*` (CLAUDE.md invariants; `src/lib/supabase/cookies.ts`).
- Staff sign in with a PIN on enrolled devices (ADR-010). The access-token hook gives tenant claims to a PIN account only after our two-phase PIN flow.
- Supabase Auth's sign-in rate limit (`sign_in_sign_ups`) is per IP and is shared with the server-side PIN logins (`tests/config/integration-suite.test.ts`).

## Decision

1. Owner and admin sign in with **Supabase Auth's own e-mail/password**, called from our server routes (`POST /api/auth/password`), into the existing HttpOnly cookies. No new dependency or provider.
2. The magic-link e-mail stays as the fallback and **also carries a 6-digit code** (`{{ .Token }}`). The code is typed in the app (`POST /api/auth/email-code`, `verifyOtp` type `email`). It is the **only** recovery path: there is no separate reset-password flow. After a code sign-in, owner and admin are offered `/password`.
3. **Setting and changing a password** is one route (`POST /api/me/password`):
   - the current password is needed unless the last authentication is under 10 minutes old;
   - a local policy applies: at least 10 characters, a common-password list, refusing the address and the venue's name, no composition rules. Supabase's minimum length is the second check;
   - after a save the device is signed in again and every other session is ended.
4. **The app enforces a hard 30-day session lifetime**, from the token's `amr` sign-in timestamp, in `withApi` (401 `session_expired`) and the proxy. A missing `amr` counts as expired. This makes the behaviour the same on every Supabase plan.
5. **`/login` is the single entry point.** With the device cookie present it shows the staff PIN flow, with the owner's form one tap away. Otherwise it shows the password form. `/pin` redirects to `/login`.

## Alternatives

- **Magic link only** — pros: no passwords to manage — cons: the friction reported, and it is broken in installed iPhone apps — why not: it is the problem being solved.
- **Supabase reset flow (`resetPasswordForEmail`)** — pros: standard — cons: a second template and link, the same iPhone problem, the same proof as the e-mail code — why not: the code sign-in plus `/password` covers it with one e-mail.
- **Browser Supabase client** — pros: less server code — cons: script-readable session cookies; breaks "screens only call `/api/*`" — why not: security invariant.
- **Passkeys / WebAuthn** — pros: the least friction (Face ID) — cons: hosted availability on Free and the client API not verified; recovery still needs e-mail — why not now: revisit with TOTP (Q204).
- **OAuth (Google)** — pros: no password — cons: a new provider, personal accounts for a business login — why not: scope and privacy.
- **Hosted session time-box** — pros: no app code — cons: apparently paid, and local and hosted would differ — why not: the app cap works on every plan.
- **zxcvbn** — pros: better strength estimate — cons: a large new dependency — why not: length plus rules plus a short list suffice (NIST-style).
- **App-level attempt gate in Postgres by default** — pros: protects the shared Auth bucket — cons: extends the secret-key exception (CLAUDE.md rule 2) to more public routes — why not by default: offered as variant V4 for the founder to decide (Q203).

## Consequences

- Good:
  - one sign-in per phone per 30 days;
  - recovery works inside installed apps;
  - no new dependency, secret, table or migration;
  - behaviour is the same on Free and paid plans;
  - staff land on their PIN screen with no extra tap.
- Bad / accepted trade-offs:
  - every session older than 30 days ends once at deploy;
  - password and PIN sign-ins share Supabase's per-IP sign-in bucket, which a flood could briefly exhaust (accepted unless V4);
  - no HaveIBeenPwned check on Free;
  - the e2e suite keeps signing in by link, to stay off that bucket;
  - a stolen unlocked phone has up to 30 days of access until "Esci" or a password change elsewhere.
- What would make us revisit this:
  - Supabase Pro (enable leaked-password protection and the hosted time-box);
  - evidence of bucket exhaustion (adopt V4);
  - TOTP or passkeys becoming available and wanted (Q204);
  - device tests (M-3) showing that installed apps do not keep the session.
