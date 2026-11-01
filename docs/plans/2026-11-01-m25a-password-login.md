# Tech plan — Osteria Digitalization · M25a Sign-in without an e-mail link every time (owner/admin password, staff PIN by default on enrolled devices)

- **Client slug / internal:** `osteria-dei-rossi`.
  - **Client facts used:** the trading name "Osteria Dei Rossi" only (approved, `docs/client-facts.md`), in the Auth e-mail subject and body and in the password rule that refuses the venue's name. No address, sender domain, phone or other client fact appears anywhere.
  - **Fixtures follow the M21–M25 conventions:** tenant "Osteria Demo"; users "Titolare Demo", "Admin Demo", "Cameriere Demo"; device "Telefono sala (demo)"; PINs `4827`, `7046`. Every e-mail address is `…@example.test` (`fakeEmail`), every password a fixture value made at run time, never a real one.
- **Repo and branch:** `osteria-dei-rossi-app`, worktree `/home/user/osteria-m25a`, branch `feat/m25a-password-login`, from `main` `0f1df68` (M0–M24 merged, M10 deferred). M25 (`feat/m25-go-live`) is planned on the same base and is not merged. M25a is a founder priority to be merged before M25 completes.
- **Numbering:**
  - **Migrations: none.** `main`'s latest stays `20261116100000`. Only variant V4 adds one (`20261118100000`, after M24's reserved `20261117*`).
  - **pgTAP: none new.** Only V4 adds `267` (M24 reserved `265`–`266` for its unbuilt variants).
  - **ADR-029:** `docs/adr/adr-029-owner-password-sign-in.md`, status proposed (ADR-028 is M25's CSP).
  - **Questions from Q197** (M25 ended at Q196). Variants V1–V6 belong to this plan.
  - **E2E files:** `e2e/password-login.spec.ts` (phone) and `e2e/session-persistence.spec.ts` (phone and phone-webkit).
- **Shared lists (house lesson):**
  - **M25a adds no nav link, no dashboard tile, no public function and no table.** These lists stay unchanged on purpose:
    - pgTAP `207`, `214`, `222`, `229`, `240`;
    - `tests/integration/dashboard.int.ts`;
    - `tests/components/app-shell.test.ts`;
    - the nav lists of `e2e/app-shell.spec.ts` (`OWNER_HREFS`, `SIDEBAR_HREFS`, `ROW_HREFS`);
    - the section list of `tests/lib/nav/nav-model.test.ts`.
  - Step 0's guard proves it: no new migration, `src/lib/nav/nav-model.ts` byte-identical to `0f1df68`, `package.json` dependency names unchanged.
  - M25a **does** add one signed-in page, `/password`. That changes two lists, each on purpose in a named step:
    - the B5 back-link `routes` list of `e2e/app-shell.spec.ts` gains `["/password", "/"]` (step 17);
    - `tests/lib/nav/nav-model.test.ts` gains one `currentSection` case: `/password` belongs to no section (step 13).
  - M25a also changes where an enrolled device is sent (`/pin` → `/login`). The lists that spell `/pin` are updated on purpose:
    - `tests/lib/api/client.test.ts` (step 2);
    - `tests/lib/supabase/proxy.test.ts` (step 3);
    - `e2e/staff-pin.spec.ts` (step 17).

    `tests/config/proxy-matcher.test.ts`, `public/sw.js` (`isShellPage`) and the A3 loop of `e2e/app-shell.spec.ts` keep `/pin` unchanged: the path still exists and now redirects.
  - `tests/config/playwright-projects.test.ts` changes on purpose (step 16): the `phone-webkit` project's `testMatch` gains `session-persistence`.
- **Shared check constraints:** no audit entity type or action, alert kind or `job_run` job is added. `tests/config/check-constraint-union.test.ts` is unaffected.
- **Author:** architect · **Date:** 2026-11-01
- **Sources:** §9. **Where merged code and a plan differ, the code wins.**

> **Flags for the founder (read first)**
> - **Owners and admins sign in with e-mail and password on `/login`.** The e-mail link stays as the fallback, under "Password dimenticata o non ancora impostata?". The same e-mail now also carries a **6-digit code**, which is typed into the app.
>   - **Why the code matters on phones:** on an iPhone the installed app (home screen) keeps its cookies apart from Safari. A link tapped in Mail opens in Safari, so the sign-in lands in Safari and not in the app (M11 Q12). The code works in the app itself, on any phone (§3.1.4).
> - **"Forgot password", "first password" and "set a password for existing owners" are one flow:** sign in with the e-mail code, then choose a password on the new `/password` page. On Oggi, an owner or admin who came in by link sees "Imposta una password" (§3.1.6). No separate reset e-mail is needed.
> - **Sessions: the planned 30 days is not in force today.**
>   - The 30-day limit is `[auth.sessions] timebox = "720h"` in `supabase/config.toml` line 281. That setting acts **only on the local stack**.
>   - On hosted Supabase the same setting is "Time-box user sessions" in the Auth settings, and it is a paid-plan feature as far as we know (M0 Q-B and the comment on line 278; not re-checked here, T6). Production is on **Free** (M25 Q187). Hosted sessions therefore currently **never expire** until someone signs out.
>   - M0's variant V1 (the app enforces 30 days) was never built.
>   - **M25a builds it:** a session ends 30 days after its sign-in, whatever the plan (Q199). Inside those 30 days nobody signs in again on the same phone.
>   - **At deploy, every owner or admin session that is already older than 30 days ends once** (§8 M-4).
> - **Staying signed in on installed phones:**
>   - The session cookies are HttpOnly, set by our own server, and persistent. The tests check their expiry on Chromium and WebKit, and that a "relaunched" browser is still signed in (step 16).
>   - **A real installed iPhone and Android app cannot be automated here.** Your 10-minute check on two phones is manual step M-3.
> - **Leaked-password protection (HaveIBeenPwned) appears to need Supabase Pro** (a search summary of Supabase's page; the page itself was not readable from this session, T1). The fallback is built anyway:
>   - at least **10 characters**, no other composition rules (Q197);
>   - a local list of common passwords;
>   - refusing the e-mail address and the venue's name.
> - **Staff:**
>   - on an enrolled phone, `/login` now opens straight on "Chi sei?" and the PIN pad. The owner's e-mail form is one tap away ("Sei il titolare? Accedi con email");
>   - after enrolment the phone goes straight to "Chi sei?";
>   - `/personale` gets an Italian step-by-step guide card, and the same guide is in `docs/guides/accesso-e-personale.md` for you to hand over.
> - **The QR code for enrolment is not in the default build** (Q202 → V3):
>   - it needs a new dependency;
>   - on iPhones a scanned QR opens Safari, so the enrolment cookie lands outside the installed app.
>   The 8-character code typed in the installed app works the same on both platforms.
> - **PIN login needs four environment variables and two Supabase settings per environment.** The exact list and how to make each value is in §3.7.1. No value goes in the repo.
> - **No new dependency, provider, secret, table, migration or paid feature.** Supabase Auth's own e-mail/password is used. Rate limits stay Supabase's own (§3.1.8). An app-level gate in front of them is V4 (Q203). It would extend the CLAUDE.md rule-2 exception, so it needs your OK.
> - **TOTP (authenticator app) for owner and admin:** proposed as an optional follow-up after go-live, not in M25a (Q204, which carries M11 Q9 and M0 Q-C).
> - **E2E sign-ins stay on the e-mail link.** Password sign-ins draw from the same Auth bucket as the PIN logins (`sign_in_sign_ups`, 30 per 5 minutes per IP), as the repo's own CI test notes. Moving about 135 e-mail-link sign-ins onto it would risk 429s in the heavy job (§3.1.11).
> - Q197–Q206: **answered by the founder on 2026-11-01; every default stands** (§7).

## 1. Goal and scope

- **Goal:** the owner and the admin open the installed app and are in. They sign in once per phone with e-mail and password and stay signed in for 30 days. When they forget the password, an e-mail code typed in the app gets them in and lets them choose a new one. Chef and waiter open an enrolled phone and see their names and the PIN pad. The owner can enrol a phone and set staff up from a guide, without help.
- **In scope**
  - **Owner/admin password sign-in:** `POST /api/auth/password` and the redesigned `/login` (§3.5).
  - **E-mail code sign-in:** `POST /api/auth/email-code` (verifies the 6-digit code from the existing magic-link e-mail). The magic-link route and callback are unchanged.
  - **Set and change password:** `GET`/`POST /api/me/password` and the page `/password`. This one page covers the first password, the reset after a forgotten one and the change. Oggi gets a link to it in the account card.
  - **Password policy** (`src/lib/auth/password-policy.ts`) with a local common-password list, enforced on set and change. Supabase's own minimum length is the second check.
  - **30-day session cap** in `withApi` and the proxy (M0 V1, built now), from the token's `amr` timestamp.
  - **Auth e-mail templates in Italian** (`supabase/templates/magic-link.html`, `recovery.html`), wired in `supabase/config.toml` for the local stack. You paste them into staging and production (§8 M-1).
  - **Staff:**
    - `/login` shows the PIN flow by default on a device with the device cookie; `/pin` redirects to `/login`;
    - enrolment success goes straight to the PIN screen;
    - a setup guide card on `/personale`;
    - `pinLoginReady` in `GET /api/devices`;
    - the Italian owner guide `docs/guides/accesso-e-personale.md`.
  - **Tests:** Vitest (unit, route, config, guards), one real-stack integration suite, two Playwright specs, plus updates to `staff-pin.spec.ts` and `app-shell.spec.ts`.
- **Out of scope**
  - TOTP or passkeys (Q204; a follow-up);
  - an app-level rate-limit gate (Q203 → V4);
  - enrolment by QR (Q202 → V3);
  - Supabase's separate "reset password" flow (`resetPasswordForEmail`): the code sign-in replaces it (§4). The `recovery` template is translated only so that a reset sent from the Supabase dashboard is Italian;
  - "password changed" notification e-mails (Q205);
  - any change to PIN rules, lockouts, enrolment codes, the access-token hook or any SQL;
  - navigation changes (M25b) and service periods (M25c).

## 2. Current state (`main` `0f1df68`)

### 2.1 Auth configuration (`supabase/config.toml`, local stack; hosted values live in the dashboard)

| Setting (line) | Value | Meaning for M25a |
|---|---|---|
| `jwt_expiry` (168) | 3600 | An access token lasts an hour; the proxy refreshes it |
| `enable_refresh_token_rotation` (174), `refresh_token_reuse_interval` (177) | true, 10 | Unchanged |
| `enable_signup` (180) | false | Admin `createUser` still works; no self-signup |
| `minimum_password_length` (186) | 6 | **Raised to 10 (step 9)**. The PIN-derived passwords are 43 characters (M11), and the integration fixtures use `randomUUID()` (36), so neither is affected |
| `password_requirements` (189) | `""` | Kept: no composition rules |
| `[auth.rate_limit]` `email_sent` 30/h (204), `token_refresh` 150 (210), `sign_in_sign_ups` 30 per 5 min per IP (212), `token_verifications` 30 per 5 min per IP (214) | — | §3.1.8 |
| `[auth.email]` `secure_password_change` (234) | false | **Kept false** on purpose: our route decides when the current password is needed (§3.1.6) |
| `max_frequency` (236), `otp_length` (238), `otp_expiry` (240) | `1s`, 6, 3600 | The e-mail carries a 6-digit code (`{{ .Token }}`) |
| Template blocks (253–261) | commented out | **Step 9** adds `magic_link` and `recovery` |
| `[auth.sessions] timebox` (281) | `"720h"` | **The 30-day limit, local stack only.** The comment on line 278 says hosted needs a paid plan. `tests/config/deploy-config.test.ts` line 55 pins it |
| `[auth.hook.custom_access_token]` (291) | enabled, `app.custom_access_token_hook` | The PIN gate (ADR-010). Unchanged |
| `[auth.mfa.totp]` (309) | enroll and verify off | Q204 |
| `[auth.passkey]` (192) | commented out | §4 |

### 2.2 Code reused or changed

| Object (file) | State | M25a |
|---|---|---|
| `/login` (`src/app/(public)/login/{page,login-form}.tsx`) | One e-mail field, "Inviami il link" → `POST /api/auth/magic-link` (202). `?errore=link` alert. A link "Abilita questo telefono per il personale" → `/dispositivo` | Redesigned (steps 11, 12) |
| `POST /api/auth/magic-link` (`src/app/api/auth/magic-link/route.ts`) | `signInWithOtp({shouldCreateUser:false, emailRedirectTo: /api/auth/callback?next=})`, always 202 (no enumeration), `classifyOtpError` (`src/lib/auth/otp-error.ts`) | **Unchanged**; its e-mail gains the code (template, step 9) |
| `GET /api/auth/callback` | PKCE `exchangeCodeForSession` only (no bare `token_hash`, login-CSRF note), redirect to `safeNextPath(next)` | **Unchanged** |
| `safeNextPath` (`src/lib/api/safe-next.ts`) | Same-origin relative paths only | Reused for `next` and `dopo` |
| `withApi` (`src/lib/api/with-api.ts`) | JSON-only writes → `getClaims()` → staff-session gate (`login: 'pin'`, `session_state`) → tenant and role → strict body | Gains the 30-day cap (step 2); `claimsSchema` gains `amr` |
| Proxy (`src/lib/supabase/proxy.ts`) | Refreshes the session; a signed-out page visit goes to `/pin` when the device cookie is present, else to `/login?next=` | Step 3: cap + enrolled → `/login` |
| Cookies (`src/lib/supabase/cookies.ts`) | `HttpOnly; Secure` (except plain-http loopback); `SameSite=Lax`; no `maxAge` of ours, so `@supabase/ssr`'s default lifetime applies (T4). No browser Supabase client exists | Unchanged; persistence proved in step 16 |
| Device cookie (`src/server/staff-auth/device-cookie.ts`, `constants.ts`) | `__Host-odr_device`, HttpOnly, Secure, `SameSite=Strict`, `Max-Age` 400 days | Read by `/login` to pick its first view (presence only) |
| PIN flow (`src/app/(public)/pin/{page,pin-flow,staff-picker,pin-pad}.tsx`) | Reads `GET /api/auth/device`, posts `POST /api/auth/pin`; on success `forgetUser()` and `landingFor(role)` | Reused inside `/login`; `/pin` becomes a redirect (step 12) |
| Enrolment (`src/app/(public)/dispositivo/enrol-form.tsx`, `POST /api/devices/enrol`) | Success shows "Dispositivo abilitato: X" and a link to `/pin` | Success goes to `/login?abilitato=1` (step 12) |
| `/dispositivi` (`src/app/(owner)/dispositivi/*`) | "Nuovo dispositivo" → label → "Crea codice" → `CodeCard`: the code large, the expiry, and where to type it **as text, never a link** | Unchanged (V3 adds a QR) |
| `GET /api/devices` (`src/server/staff-auth/devices.ts` `listDevices`) | `{devices, pendingCodes}`, field by field | Gains `pinLoginReady` (step 14) |
| `/personale` (`src/app/(owner)/personale/*`) | "Aggiungi persona" `Card`, staff list, link to Dispositivi | Gains the guide card (step 14) |
| Oggi (`src/app/(owner)/page.tsx`) | Account `Card` (tenant name, role), "Primi passi" with `staff` and `device` from `/api/today`, `LogoutButton` | Account card gains the password link (step 13) |
| API client (`src/lib/api/client.ts`) | 401 `session_ended` → `/pin` (line 49 `PIN_PAGE`) | → `/login`; 401 `session_expired` → `/login?errore=sessione` (step 2) |
| Privileged module (`src/server/staff-auth/privileged.ts`) | Seven fixed functions; importers pinned to four files (`tests/guards/privileged-importers.test.ts`) | **Not touched** (V4 only) |
| Env (`src/lib/env/index.ts`) | `readPinEnv` (`PIN_PEPPER` ≥ 32 chars, `MIN_PIN_PEPPER_CHARS`) | Gains `isPinPepperConfigured()` (step 14) |
| E2E helpers (`e2e/helpers/session.ts`, `mailbox.ts`) | `createOwner()` (runs `scripts/create-tenant.ts`, prints the tenant id), `createStaff()`, `signInWithMagicLink()` (≥ 2 s apart per address), `latestLinkFor()` reads Mailpit's `Text` for `/auth/v1/verify` | Kept; gain `signInWithPassword`, `setFixturePassword`, `latestCodeFor` (step 16) |
| CI (`.github/workflows/ci.yml`) | `checks` on drafts; heavy `supabase` (30 min: start → pgTAP → integration → build → Playwright, 1 worker), `db-races`, `t1-spike` (own stack, so it gets a full `sign_in_sign_ups` bucket: `tests/config/integration-suite.test.ts` line 59) | No workflow change |
| `scripts/lib/perf-dashboard.ts` | Gives the **demo owner** a fresh random password through the secret key on every perf run | Risk §6 (staging only) |

### 2.3 Missing

- No password sign-in, set, change or policy. No code entry for the e-mail OTP. No session cap in the app. No Italian Auth e-mail templates. No setup guide. `/login` never shows the PIN flow.

## 3. Design

### 3.1 Decisions

1. **Supabase Auth's own e-mail/password, called from our server (ADR-029).**
   - `POST /api/auth/password` calls `signInWithPassword` on the cookie-bound server client (publishable key). The session lands in the same HttpOnly cookies as today. No browser Supabase client is added.
   - Errors:
     - Auth `invalid_credentials` → **401 `login_invalid`** "Email o password non corretti." This is the same for an unknown address and a wrong password, so it reveals no accounts;
     - 429 → `rate_limited`;
     - 5xx or a 10 s timeout → 502 `upstream_error`.
   - On success the server reads the new claims and answers `{ redirect }`:
     - `safeNextPath(next)` when `next` is given and is not `/`;
     - otherwise `landingFor(role)` (the waiter → `/tavoli`);
     - `/` when there is no tenant claim (Oggi then shows the existing "non è abilitato" message).
   - The policy is **not** applied at sign-in: an existing password always works.
   - **PIN accounts gain nothing:** their address is `staff-<id>@staff.invalid` and their password is an HMAC with the server pepper. Even a correct guess gets a token with no tenant from the hook (ADR-010 decision 6), so `withApi` answers 401 `session_ended`. Step 10 proves it.
2. **The e-mail link stays the fallback, and its e-mail also carries a 6-digit code.**
   - The template (step 9) prints `{{ .ConfirmationURL }}` (as a button and as plain text) and `{{ .Token }}`.
   - `POST /api/auth/email-code {email, code, next?}` calls `verifyOtp({ email, token: code, type: "email" })` on the cookie client:
     - invalid or expired → 422 `code_invalid` "Codice non valido o scaduto. Chiedine uno nuovo.";
     - 429 → `rate_limited`;
     - 5xx → 502.
   - The code is typed by the person into their own app, so it does not reopen the login-CSRF hole that the callback closes for bare `token_hash` links. The route is JSON-only, so a cross-site form cannot post it.
   - `{ redirect }` after a code sign-in:
     - **owner or admin** → `/password?dopo=<safe next>` (the next screen offers "Scegli una password" and "Non ora"). When `next` itself starts with `/password`, it is used as is;
     - others → as in 1.
   - **T3:** a PKCE-flow `signInWithOtp` e-mail carries a token that `verifyOtp` type `email` accepts. Proved on the real stack in step 10.
3. **Password policy (Q197, Q198), `src/lib/auth/password-policy.ts`.** `checkNewPassword(password, { email })` returns `{ ok: true } | { ok: false, reason }`:
   - `too_short`: fewer than `PASSWORD_MIN_LENGTH` = **10** Unicode code points;
   - `too_long`: more than 72 UTF-8 bytes (bcrypt's limit);
   - `like_email`: equal (case-insensitive) to the address or its local part, or containing a local part of 4 or more characters;
   - `like_venue`: after lower-casing and removing everything but letters, one of `osteria`, `rossi`, `deirossi`, `osteriadeirossi` (the approved trading name);
   - `repetitive`: two or fewer distinct characters;
   - `sequence`: the whole lower-cased password is a substring of `01234567890`, `09876543210`, `abcdefghijklmnopqrstuvwxyz` or `qwertyuiopasdfghjklzxcvbnm`;
   - `common`: the lower-cased password is in `COMMON_PASSWORDS` (`src/lib/auth/common-passwords.ts`).
     - That list is a sorted, de-duplicated `ReadonlySet` built from SecLists' `Passwords/Common-Credentials/10k-most-common.txt`, keeping only entries of 10 or more characters.
     - The file header records the source URL, the commit it was taken from and the licence. SecLists is MIT as far as known.
     - **T5:** the licence is confirmed from the repository's `LICENSE` when the file is copied, and recorded in the header. If it is not MIT-compatible, step 4 stops and the founder is asked before any list is committed.
   - Spaces are allowed and nothing is trimmed: a sentence is a good password.
   - Messages (it/en) per reason, e.g. "La password deve avere almeno 10 caratteri." and "Questa password è troppo comune: scegline un'altra."
   - **Supabase is the second check:**
     - hosted "Minimum password length" set to 10 by you (M-1); local `minimum_password_length = 10` (step 9);
     - Auth `weak_password` (any reason, including HaveIBeenPwned if Pro is ever enabled) → 422 `password_weak`.
4. **Why the code matters on installed phones (T5b).**
   - **iPhone:** an app added to the home screen has its own cookie storage, separate from Safari (M11 Q12, already relied on for enrolment). A link tapped in Mail opens in Safari, which:
     - lacks the PKCE verifier cookie, so the callback answers "link non valido" there;
     - and even if it worked, would sign in Safari and not the app.
     The code is typed into the app, so it works.
   - **Android:** an installed Chrome app shares Chrome's cookies, so a link opened in Chrome also signs in the app. The code works there too.
   - The plan relies on the code path only. The link stays for laptops.
5. **30-day session cap (Q199; M0 V1 built), `src/lib/auth/session-age.ts`.**
   - `signedInAt(claims)` = the earliest `amr[].timestamp` (epoch seconds). `lastAuthAt(claims)` = the latest.
   - `isSessionExpired(claims, nowMs)`: true when `nowMs ≥ (signedInAt + SESSION_MAX_AGE_DAYS × 86 400) × 1000`, with `SESSION_MAX_AGE_DAYS = 30`. **A missing or empty `amr` counts as expired** (fail closed). Epoch arithmetic makes DST irrelevant (tested in step 1).
   - **`withApi`:** after `getClaims()` and before the staff gate, an expired session → `signOut({scope:"local"})` → **401 `session_expired`** "La sessione è scaduta: accedi di nuovo."
   - **Proxy:** an expired session on a non-public page → `signOut` → redirect `/login?errore=sessione`, with the cleared cookies copied to the redirect.
   - **Client:** `apiJson` on 401 `session_expired` → `location.assign("/login?errore=sessione")`.
   - **PIN sessions** are covered by the same check. They always end earlier (cut-off), so nothing changes for staff.
   - **T2:** `amr[].timestamp` is the sign-in time and survives refresh unchanged. Proved in step 10.
   - The local `timebox = "720h"` stays, so local and hosted behave alike.
6. **Set and change password: one page, one route (Q200, Q201).**
   - **`GET /api/me/password`** (owner, admin) answers from the claims alone, with no RPC:

     ```
     { signInMethod, recentSignIn, recentUntil, minLength: 10 }
     ```

     - `signInMethod` is the method of the latest `amr` entry: `password` → `"password"`; `otp`, `magiclink`, `email`, `recovery`, `invite` → `"link"`; anything else → `"other"` (T2 records the real values);
     - `recentSignIn` is true when the latest `amr` timestamp is within `RECENT_SIGN_IN_MINUTES` = **10**; `recentUntil` is that time + 10 minutes, or null.
   - **`POST /api/me/password {newPassword, currentPassword?}`** (owner, admin; a `login: 'pin'` claim → 403), in this order:
     1. policy (3) → 422 `password_weak {reason}`;
     2. if not `recentSignIn`: no `currentPassword` → 422 `current_password_required`. Otherwise the current password is verified with `signInWithPassword` on a **throwaway client** (`src/lib/supabase/verifier.ts`: publishable key, `persistSession: false`, `autoRefreshToken: false`, no cookies), whose session is then ended with `signOut({scope:"local"})`. Wrong → 422 `current_password_invalid` (not 401, so the client never mistakes it for a lost session);
     3. `supabase.auth.updateUser({ password })` on the cookie client. `weak_password` → 422 `password_weak`; `same_password` → 422 `password_same`; 429 → `rate_limited`; 5xx → 502;
     4. **re-sign-in** with the new password on the cookie client. This device's session is now a `password` session (the Oggi prompt goes away, and the 30 days restart);
     5. **`signOut({scope:"others"})`** ends every other session of the account (Q201 → V2 keeps them). **T8** is proved in step 10;
     6. 200 `{ status: "saved" }`.
   - **`secure_password_change` stays off** (local and hosted, M-1): with it on, Auth would ask an e-mailed nonce for old sessions. Our route already asks for the current password then.
   - **First password, forgotten password, existing owner without a password: all the same path.** E-mail code (2) → `/password` with a recent sign-in → new password only.
   - **Oggi prompt:** the account `Card` reads `GET /api/me/password` once, for owner and admin:
     - `signInMethod` `"link"` → a link "Imposta una password" → `/password`;
     - otherwise "Cambia password".
     `src/lib/auth/password-view.ts` maps the reply to the label key (pure).
7. **`/login` is the one entry point (staff by default on enrolled devices).**
   - `page.tsx` (server) reads only whether the `__Host-odr_device` cookie is **present** (`readDeviceCookieValue`) to pick the first view. `LoginScreen` then works only from API replies:
     - **cookie present:** `PinFlow` ("Chi sei?", the M11 screen). Under it, a quiet button "Sei il titolare? Accedi con email" (`aria-expanded`, `aria-controls="owner-login"`) opens the password form in place. If `GET /api/auth/device` says `enrolled: false`, PinFlow calls `onNotEnrolled` and the screen switches to the password view (the cookie is already cleared by that route);
     - **no cookie:** the password view (§3.5).
   - `?abilitato=1` (set by the enrolment page) adds `SuccessNote` "Telefono abilitato: {label}." with the label from `GET /api/auth/device`.
   - `/pin` (`src/app/(public)/pin/page.tsx`) becomes `redirect("/login")`, so old bookmarks and home-screen starts still work.
   - The proxy sends a signed-out page visit to `/login` in both cases, with `next` only when no device cookie is present (as today). The client's 401 `session_ended` → `/login`.
8. **Rate limits ("per the existing auth design").**
   - **Supabase Auth, per IP as Supabase sees it:**
     - `sign_in_sign_ups`: password sign-ins, the current-password check, the re-sign-in after a save, **and every PIN login**;
     - `token_verifications`: the e-mail code;
     - `email_sent` (through Resend SMTP, M25 Q189) and `max_frequency` per address: the link/code e-mails.
     Our routes map Auth's 429 to `rate_limited` "Troppi tentativi. Riprova tra qualche minuto."
   - **App level, unchanged:** PIN lockouts (5 per person, 20 per device per hour) and the enrolment limit (10 failures per IP hash in 15 minutes), both in SQL (M11).
   - **The shared-bucket caveat (M11 §6, unverified):** server-side calls reach Supabase from Vercel's addresses. Someone hammering `/api/auth/password` could exhaust `sign_in_sign_ups` and briefly block PIN logins. Fallbacks that stay open:
     - the e-mail **link** is verified by the browser directly at Supabase, so it does not share our server's bucket;
     - lockouts still bound PIN guessing.
     An app-level gate in front of Auth is V4 (Q203).
9. **Enrolment in a few taps (default: the short code, Q202).**
   - Owner: Personale → "Dispositivi" → "Nuovo dispositivo" → name → "Crea codice". The code is shown large for 15 minutes.
   - Staff phone: open the installed app → `/login` → "Abilita questo telefono per il personale" → type the code (case, spaces and `-` ignored, as today) → "Abilita" → **straight to "Chi sei?"** (`router.replace("/login?abilitato=1")`; the old extra "Vai all'accesso con PIN" tap is gone).
   - The guide card (10) walks the owner through it.
10. **First-run guide for the owner (Italian).**
    - **In the app:** on `/personale`, a `Card` "Come far entrare il personale", built by `setupGuide({ staffCount, deviceCount, pinLoginReady })` (`src/lib/staff-auth/setup-guide.ts`, pure). The counts come from the two replies the page reads (`GET /api/users`, `GET /api/devices`). Four numbered steps, each with a `Badge` "Fatto"/"Da fare" where it applies:
      1. "Aggiungi le persone": nome, ruolo e un PIN di 4 cifre (done when staff ≥ 1);
      2. "Installa l'app sui telefoni di sala e cucina": "Su iPhone: Safari → Condividi → Aggiungi alla schermata Home. Su Android: Chrome → menu → Installa app." (no state);
      3. "Abilita ogni telefono": "Apri l'app installata, tocca «Abilita questo telefono per il personale» e scrivi il codice che crei in Dispositivi. Il codice vale 15 minuti." (done when devices ≥ 1);
      4. "Ogni persona entra con nome e PIN": "L'accesso dura fino a fine giornata. Dopo 5 PIN sbagliati la persona aspetta 15 minuti; puoi cambiarle il PIN da qui." (no state).
    - When `pinLoginReady` is false, a `warning` note comes first: "L'accesso con PIN non è ancora attivo su questo server. Contatta l'assistenza." (no DigiAlto name on screen, ui-foundation §7).
    - When steps 1 and 3 are done, the card collapses to a quiet button "Guida: come far entrare il personale" (`aria-expanded`).
    - **On paper:** `docs/guides/accesso-e-personale.md` (Italian; step 15) says the same, plus the owner's own sign-in (password, code, 30 days) and what to do when a phone is lost (Revoca). Every quoted UI label is tested against `it.ts`.
    - `pinLoginReady` = `isPinPepperConfigured()`: `PIN_PEPPER` present and at least 32 characters. The secret key is not checked here: only `admin.ts` may read it (ESLint), and the founder's checklist covers it (§3.7.1).
11. **E2E sign-in helper: stays on the e-mail link (decision asked by the lead).**
    - **Facts:**
      - about 135 calls in 31 specs;
      - the repo's own CI test says the `sign_in_sign_ups` bucket is per IP, refills slowly and is already drawn on by Playwright's PIN logins (`tests/config/integration-suite.test.ts` lines 59–61);
      - a password sign-in is a `grant_type=password` token call, which falls in that bucket. A link sign-in falls in `email_sent` and `token_verifications` (the mapping of `/otp` and `/verify` to those buckets is from the config comments, T9).
    - **Decision:** `signInWithMagicLink` stays the helper of every existing spec and keeps working **unchanged**, because `/login` keeps the "Email" field and the visible "Inviami il link" button.
    - New `signInWithPassword(page, email)` and `setFixturePassword(email)` are used only by the two new specs, at most 4 password sign-ins per project per run. A password sign-in is not proved faster here, and no time is promised.
    - **If T9 shows 429s** in the ready run → V5.
12. **No data logic in React.** Sign-in method, recency, redirects, guide steps and error texts come from the API or from pure `src/lib/*` helpers. Components render.
13. **Implicit defaults, each tested with at least two candidates:**
    - unknown address vs wrong password (same 401);
    - owner vs waiter redirect;
    - a session 30 d − 1 s vs 30 d old, and a sign-in across the 25 October DST change;
    - recent vs old sign-in (current password needed or not);
    - `link` vs `password` method;
    - device cookie present vs absent vs stale;
    - `pinLoginReady` true vs false;
    - a PIN account vs an e-mail account at `/api/auth/password`;
    - Chromium vs WebKit cookie persistence.

### 3.2 Data model and SQL

**None.** No table, column, view, function, index, grant or policy changes. Passwords live only in Supabase Auth (bcrypt, Auth's own storage). The common-password list is a TS constant. `tenant_id` + RLS, the hook and every procedure are untouched. Step 0's guard proves there is no new migration.

### 3.3 Sequence of calls

1. **Owner, password:** `/login` → `POST /api/auth/password` → `signInWithPassword` (cookie client; the hook adds `tenant_id`, `app_role`) → claims → `{redirect:"/"}` → `forgetUser()` → `router.replace("/")`.
2. **Forgotten / first password:**
   1. `/login` "Inviami il link" → `POST /api/auth/magic-link` (202) → e-mail with link + code;
   2. the code is typed → `POST /api/auth/email-code` → `verifyOtp` → `{redirect:"/password?dopo=/"}`;
   3. `/password` → `GET /api/me/password` (`recentSignIn: true`) → new password → `POST /api/me/password` → `updateUser` → re-sign-in → `signOut(others)` → "Password salvata." → `/`.
3. **Change after weeks:** Oggi "Cambia password" → `/password` (`recentSignIn: false`) → current + new → verifier sign-in + `signOut(local)` → `updateUser` → re-sign-in → `signOut(others)`.
4. **Day 30:** any `/api/*` → `withApi` → `session_expired` 401 + sign-out → client → `/login?errore=sessione`. A page visit → proxy → the same redirect.
5. **Staff phone:**
   - "/" → proxy (no session, device cookie) → `/login` → `PinFlow` → `GET /api/auth/device` → name → PIN → `POST /api/auth/pin` (M11, unchanged) → `/tavoli`;
   - enrolment: `/dispositivo` → `POST /api/devices/enrol` → `/login?abilitato=1` → "Chi sei?".

### 3.4 API (Zod 4; `withApi`; strict body → 400 listing field names only; errors `{"error":{"code","message","details?"}}`; `Cache-Control: no-store`)

```ts
// src/server/auth/schemas.ts
export const passwordSignInBody = z.strictObject({
  email: z.email().max(254), password: z.string().min(1).max(200), next: z.string().max(512).optional() });
export const emailCodeBody = z.strictObject({
  email: z.email().max(254), code: z.string().regex(/^\d{6}$/), next: z.string().max(512).optional() });
export const passwordChangeBody = z.strictObject({
  newPassword: z.string().min(1).max(200), currentPassword: z.string().min(1).max(200).optional() });
export const passwordStatusOutput = z.strictObject({
  signInMethod: z.enum(["password", "link", "other"]), recentSignIn: z.boolean(),
  recentUntil: z.iso.datetime().nullable(), minLength: z.literal(10) });
// src/lib/auth/password-policy.ts
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_BYTES = 72;
export type PasswordRejection = "too_short" | "too_long" | "like_email" | "like_venue" | "repetitive" | "sequence" | "common";
export function checkNewPassword(password: string, ctx: { email: string }): { ok: true } | { ok: false; reason: PasswordRejection };
// src/lib/auth/session-age.ts
export const SESSION_MAX_AGE_DAYS = 30;
export const RECENT_SIGN_IN_MINUTES = 10;
export function signedInAt(claims: { amr?: { method: string; timestamp: number }[] }): number | null; // epoch s
export function lastAuthAt(claims: …): number | null;
export function isSessionExpired(claims: …, nowMs: number): boolean;
export function isRecentSignIn(claims: …, nowMs: number): boolean;
export function signInMethod(claims: …): "password" | "link" | "other";
```

| Endpoint | Access | Body | Success | Errors |
|---|---|---|---|---|
| `POST /api/auth/password` (new) | public | `passwordSignInBody` | 200 `{redirect}` + session cookies | 400; 401 `login_invalid`; 415; 429 `rate_limited`; 502 `upstream_error` |
| `POST /api/auth/email-code` (new) | public | `emailCodeBody` | 200 `{redirect}` + session cookies | 400; 415; 422 `code_invalid`; 429; 502 |
| `GET /api/me/password` (new) | owner, admin | — | 200 `passwordStatusOutput` | 401 (incl. `session_expired`, `session_ended`); 403 |
| `POST /api/me/password` (new) | owner, admin; not `login: 'pin'` | `passwordChangeBody` | 200 `{status:"saved"}` + new session cookies | 400; 401; 403; 422 `password_weak {reason}`, `current_password_required`, `current_password_invalid`, `password_same`; 429; 502 |
| `GET /api/devices` (changed) | owner, admin | — | adds `pinLoginReady: boolean` | unchanged |
| every `withApi` route (changed) | — | — | unchanged | adds 401 `session_expired` |
| `POST /api/auth/magic-link`, `GET /api/auth/callback`, `/api/auth/{pin,device,logout}`, `/api/devices/*` | unchanged | | | |

- **`ErrorCode`** (`src/lib/api/errors.ts`) gains `login_invalid`, `code_invalid`, `session_expired`, `password_weak`, `current_password_required`, `current_password_invalid`, `password_same`.
- **Files:**
  - `src/server/auth/{schemas,password-sign-in,email-code,password-change,redirect}.ts`;
  - `src/lib/auth/{password-policy,common-passwords,session-age,auth-errors,password-view,login-view}.ts`;
  - `src/lib/supabase/verifier.ts`;
  - `src/app/api/auth/password/route.ts`, `src/app/api/auth/email-code/route.ts`, `src/app/api/me/password/route.ts`.
- **Logs:** routes log status and code only, never an address, password or code. `scrubEvent` already redacts `password` and `code` keys (`tests/lib/scrub.test.ts`). Auth errors are reduced to `{status, code}` (`auth-errors.ts`), as in `pin-login.ts`.

### 3.5 Screens (Italian first, English second; 360 px first; targets ≥ 44 px; `docs/design/ui-foundation.md`; every value from `/api/*`)

- **`/login`, password view** (no device cookie, or a stale one), inside the existing gold-ruled `Card`:
  - `h1` "Accedi" (unchanged). Intro: "Entra con la tua email e la password."
  - `?errore=link` → the existing `ErrorAlert`. `?errore=sessione` → `Muted` "La sessione è scaduta dopo 30 giorni: accedi di nuovo."
  - `Field` "Email" (`type="email"`, `autocomplete="username"`, `name="email"`).
  - `Field` "Password" (`type="password"`, `autocomplete="current-password"`). A 44 px quiet button "Mostra" / "Nascondi" (`aria-pressed`, `aria-controls`) toggles the type.
  - Primary `Button` "Accedi con la password". `ErrorAlert` with the server's message.
  - `Muted` "Password dimenticata o non ancora impostata?", then a secondary `Button` **"Inviami il link"** (same name as today). It uses the e-mail above, and if that is empty says "Scrivi prima la tua email."
  - After sending: `SuccessNote` `role="status"` "Se l'indirizzo è registrato, riceverai un'email con un link e un codice di 6 cifre." The password field and its button are replaced by:
    - `Field` "Codice di 6 cifre" (`inputmode="numeric"`, `autocomplete="one-time-code"`, `maxlength=6`, `pattern="[0-9]{6}"`);
    - primary "Entra con il codice";
    - quiet "Torna alla password".
  - The link "Abilita questo telefono per il personale" (unchanged).
  - Password managers (iCloud Keychain, Google) offer to save and fill thanks to the `autocomplete` values.
- **`/login`, staff view** (device cookie present):
  - the M11 `PinFlow` unchanged ("Chi sei?", names, PIN pad, "Entra");
  - `?abilitato=1` → `SuccessNote` "Telefono abilitato: Telefono sala (demo).";
  - under it, quiet button "Sei il titolare? Accedi con email" (`aria-expanded`). Opened, it shows `SubHeading` "Accesso titolare" and the password view's form (no second `h1`).
- **`/password`** (owner, admin; `src/app/(owner)/password/{page,password-form}.tsx`):
  - `BackLink` "‹ Oggi" → `/` first (house B5); `h1` "Password";
  - intro by `signInMethod`: `"link"` → "Imposta una password: la prossima volta entri senza aspettare l'email."; else "Cambia la password di accesso.";
  - `Field` "Password attuale" (`autocomplete="current-password"`) only when `recentSignIn` is false;
  - `Field` "Nuova password" (`autocomplete="new-password"`, hint "Almeno 10 caratteri. Una frase facile da ricordare va benissimo."), "Mostra" toggle;
  - primary "Salva password";
  - `?dopo=` → quiet link "Non ora" → `dopo`;
  - not recent → `linkClass` "Non ricordi la password attuale? Entra con un codice via email" → `/login?next=/password`;
  - success → `SuccessNote` `role="status"` "Password salvata. Sugli altri dispositivi dovrai accedere di nuovo.", then `router.replace(dopo)` when given;
  - chef or waiter → the reserved `ErrorAlert` (403).
- **Oggi:** in the account `Card`, for owner and admin, one `linkClass` link: "Imposta una password" or "Cambia password".
- **`/personale`:** the guide `Card` (§3.1.10) above the staff list; the page keeps its two-`Card` limit ("Aggiungi persona" + guide).
- **`/dispositivo`:** unchanged except success → `/login?abilitato=1`.
- **English** strings for every new key (key-parity test).

### 3.6 Who calls what

| Object | owner | admin | chef | waiter | anon | Enforcement |
|---|---|---|---|---|---|---|
| `POST /api/auth/password`, `POST /api/auth/email-code` | ✓ | ✓ | ✓ (e-mail accounts only; PIN accounts get no tenant) | same | ✓ | Supabase Auth; the hook decides the claims; JSON-only |
| `GET`/`POST /api/me/password` | ✓ | ✓ | 403 | 403 | 401 | `withApi({roles:["owner","admin"]})` + a `login: 'pin'` claim → 403 |
| 30-day cap | ✓ | ✓ | ✓ | ✓ | — | `withApi` + proxy, from the signed token's `amr` |
| Data access after sign-in | unchanged RLS and Postgres roles (ADR-003) | | | | | Postgres |

### 3.7 Secrets and configuration

| Name | Public? | Where it lives | Used by M25a |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public by design | Vercel env per environment | Password and code sign-in, `updateUser`, the verifier client |
| `SUPABASE_SECRET_KEY` | **private** | Vercel env (server-only), local `.env`, GitHub `staging` environment | **Not used by M25a code.** Unchanged users: cron, `privileged.ts` (ADR-010), scripts, test helpers. The e2e `setFixturePassword` uses the local stack's key, as `createStaff` does |
| `PIN_PEPPER` | **private** | Vercel env | Read by M11 code; M25a only checks it is present (`isPinPepperConfigured`) |
| Resend SMTP credentials | **private** | **Only** in Supabase → Authentication → SMTP (M25 §8.3). The app never sees them | The link/code e-mails |
| `RESEND_API_KEY` | private | `.env.example` placeholder | Not used by any code |
| Supabase Auth settings (minimum length, templates, `secure_password_change`, notifications, hook, sign-ups) | — | Supabase dashboard (founder's account) | §8 M-1 |
| Account logins (Vercel, Supabase, GitHub, Resend) | private | The account owner's password manager, with MFA (project Q26); never in the repo or DigiAlto-Ops | Humans |

No new secret, no new environment variable, no third-party key.

#### 3.7.1 What PIN login needs, per environment (founder checklist)

"Staging" today means **Vercel Preview and Production** (Production points at the staging project until M25, M0 Q-E). "Production" means the new production project (M25 §8.5). Never reuse a staging value in production.

| # | Name / setting | Where | How to obtain or generate | Check |
|---|---|---|---|---|
| E1 | `NEXT_PUBLIC_SUPABASE_URL` | Vercel env (Preview + Production for staging; Production for production) | Supabase project → Project Settings → API: the project URL | The app loads; `/api/health` answers |
| E2 | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | as E1 | Supabase project → API Keys → publishable key | Owner sign-in works |
| E3 | `SUPABASE_SECRET_KEY` (server-only; mark "Sensitive" in Vercel) | as E1 | Supabase project → API Keys → create a secret key for Vercel. Never the staging key in production | Adding a person on `/personale` works (it creates the Auth user) |
| E4 | `PIN_PEPPER` (server-only, "Sensitive") | as E1, **a different value per environment** | `openssl rand -hex 32` (64 hex characters; the app refuses fewer than 32). Keep it in the password manager. **Changing it later means resetting every staff PIN** | `/personale` → the guide shows no "non è ancora attivo" note (`pinLoginReady`) |
| S1 | Access Token hook = Postgres `app.custom_access_token_hook` | Supabase → Authentication → Hooks | Select the function after the migrations are applied | A staff PIN sign-in reaches `/tavoli` (without it there is no tenant claim and PIN login cannot work) |
| S2 | Sign-ups off; e-mail provider on; security notifications ("password changed", "email changed") off | Supabase → Authentication | As M11 M-3/M-5 | `/personale` PIN reset sends no e-mail |
| S3 | Migrations applied (PIN tables, `auth-purge` cron) | CI deploy (staging), `deploy-production.yml` (production, M25) | — | `/dispositivi` opens without error |
| CI | `PIN_PEPPER` fake | `.github/workflows/ci.yml` (`supabase` job env) | Already there, not a secret (`test-pepper-not-a-secret-…`) | `integration-suite.test.ts` |
| Local | `PIN_PEPPER` | `.env` (gitignored) | `openssl rand -hex 32` | `npm run dev` |

After setting E1–E4, redeploy (Vercel applies env changes on the next deployment).

### 3.8 Fixtures

- **Unit and route:** fake claims with `amr` `[{method:"password", timestamp: T}]`, `[{method:"otp", …}]`, `[]`, and none, with T relative to a fixed clock:
  - 2026-10-20T10:00:00Z, which expires exactly at 2026-11-19T10:00:00Z across the 25 October change;
  - "9 minutes ago" vs "11 minutes ago" for recency.
- **Auth fakes:** `invalid_credentials` (400), `over_request_rate_limit` (429), `weak_password` (422), `same_password` (422), `otp_expired` (403), and a network error.
- **Passwords:** `"una frase lunga per il locale"` (ok), `"Corta1!"` (too_short), 73 × `"a"` (too_long), `"titolare.demo2026"` for `titolare.demo@example.test` (like_email), `"OsteriaDeiRossi!!"` (like_venue), `"aaaaaaaaaaaa"` and `"abababababab"` (repetitive), `"1234567890"` and `"qwertyuiop"` (sequence), and the list's first entry in upper case (common).
- **Real stack and e2e:** `createOwner()` (Titolare Demo), `createStaff(…, "admin")`, the M11 staff and device flow, `fakeEmail`. Passwords come from `randomUUID()`-based strings made at run time and are never stored.

## 4. Alternatives considered

- **Keep the e-mail link only:** rejected. It is the friction the founder reports, and on an installed iPhone app the link opens Safari, not the app (§3.1.4).
- **Supabase's reset flow (`resetPasswordForEmail` → recovery link):** rejected as a separate path. It proves the same thing as the e-mail code (control of the mailbox), needs a second template and link handling, and its link has the same iPhone problem. The code sign-in plus `/password` covers it with one e-mail.
- **A browser Supabase client (`createBrowserClient`) for sign-in:** rejected. The session cookies would have to become script-readable, against the HttpOnly design (`cookies.ts`) and the "screens only call `/api/*`" invariant.
- **Passkeys / WebAuthn** (`[auth.passkey]` exists commented in `config.toml`): the least friction of all (Face ID), but hosted availability on Free and the supabase-js API were not verifiable here, and recovery still needs the e-mail path. Revisit with Q204.
- **Google sign-in (OAuth):** a new provider and console project, and personal Google accounts for a business login. Rejected.
- **zxcvbn or another strength library:** a new dependency of a few hundred kB of dictionaries. Rejected for length + rules + a short list (§3.1.3, founder's suggestion).
- **Supabase's hosted time-box:** not available on Free as far as known (T6), and it would differ between local and hosted. The app cap behaves the same everywhere.
- **A sliding 30-day inactivity limit:** needs the previous refresh time, which the proxy does not see once `getClaims` has refreshed. Not built. The hard cap was what was planned (PRD "sessions 30 days", `timebox = 720h`).
- **Asking the current password always:** rejected. Right after an e-mail-code sign-in there is no current password, and that is exactly the reset case. The 10-minute recency window (Q200) covers it.
- **Asking an e-mailed nonce for changes (`secure_password_change = true`):** an e-mail round-trip for every change on an old session. Rejected for the current-password check.
- **Switching every e2e spec to password sign-in:** rejected (§3.1.11): it moves about 135 sign-ins into the bucket that PIN logins use.
- **QR by default:** rejected (V3). It needs a dependency, and on iPhone the camera opens Safari, not the installed app.
- **An app-level login gate by default:** it needs the secret key on two more public routes (a CLAUDE.md rule-2 change) or an `anon` RPC that anyone could flood. Offered as V4.

## 5. Build plan (test first: each step's named test is written and seen failing, then the code; one commit per step; `tdd-guide` follows the order)

| # | Step (one commit) | Files | Test that proves it (written first, must fail first) |
|---|---|---|---|
| 0 | **Guard:** no migration, no dependency, no nav change | `tests/config/m25a-preserves.test.ts` | The sorted names in `supabase/migrations/` end with `20261116100000_push_menu_price_missing.sql`. The `dependencies` + `devDependencies` names of `package.json` equal the inline list of `tests/config/no-new-deps.test.ts` (imported, not copied). The md5 of `src/lib/nav/nav-model.ts` equals its `0f1df68` value (written into the test). `tests/guards/privileged-importers.test.ts`'s importer list still has four files (read from that file's source). The listing helper's self-test fails on a temp dir holding an extra `20261117000000_x.sql` |
| 1 | **Session age helpers** | `src/lib/auth/session-age.ts`, `tests/lib/auth/session-age.test.ts` | With a fixed clock: sign-in 2026-10-20T10:00:00Z → `isSessionExpired` false at 2026-11-19T09:59:59Z and true at 2026-11-19T10:00:00Z (30 × 86 400 s across the 25 October DST change). `amr` missing, `[]`, or with a non-number timestamp → expired. Two entries (password at T, totp at T+60) → `signedInAt` T, `lastAuthAt` T+60. `isRecentSignIn`: 9 min ago true, 11 min ago false, exactly 10 min false. `signInMethod`: `password` → "password"; `otp`, `magiclink`, `email`, `recovery`, `invite` → "link"; `oauth` → "other"; the latest entry decides |
| 2 | **Cap in `withApi`; client redirects** | `src/lib/api/with-api.ts`, `src/lib/api/errors.ts`, `src/lib/api/client.ts`, `src/lib/i18n/messages/{it,en}.ts`, `tests/lib/api/with-api-session-age.test.ts`, `tests/lib/api/client.test.ts` (updated on purpose) | **with-api:** claims with `amr` 31 days old on a `{roles}` route → 401 `session_expired`, `signOut({scope:"local"})` called once, handler not called, 0 RPCs. The same on an `{authenticated}` route. 29 days → 200. A `login:"pin"` claim 31 days old → `session_expired` (checked before `staff_session_active`, so 0 RPCs). A `public` route ignores claims. **client:** 401 `session_expired` → `location.assign("/login?errore=sessione")`; 401 `session_ended` → `location.assign("/login")` (was `/pin`) |
| 3 | **Proxy: cap; enrolled devices to `/login`** | `src/lib/supabase/proxy.ts`, `tests/lib/supabase/proxy.test.ts` (updated on purpose) | An expired session on `/fatture` → 307 to `/login?errore=sessione`, `signOut` called, the cleared `sb-` cookies copied to the redirect. An expired session on `/login` → no redirect. Signed out with the device cookie on `/` → `/login` without `next` (was `/pin`). Signed out without it on `/fatture` → `/login?next=%2Ffatture` (unchanged). A valid 29-day session → `NextResponse.next` |
| 4 | **Password policy and common list** | `src/lib/auth/password-policy.ts`, `src/lib/auth/common-passwords.ts`, `tests/lib/auth/password-policy.test.ts`, `tests/lib/auth/common-passwords.test.ts` | Each §3.8 password gives its reason. The ok case passes. Exactly 10 code points of `"è"` passes; 9 fails. 72 one-byte chars pass; 25 × `"€"` (75 bytes) → too_long. `"Titolare.Demo"` for `titolare.demo@example.test` → like_email; for `ab@example.test` a password containing "ab" is **not** refused (local part < 4). Rules are checked in the documented order (a 9-char common word → too_short). **List:** strictly sorted, unique, every entry lower-case, length ≥ 10, no surrounding whitespace. The header names the source URL, the commit and the licence (regex). The first entry upper-cased → `common` |
| 5 | **Auth error classification** | `src/lib/auth/auth-errors.ts`, `tests/lib/auth/auth-errors.test.ts` | `classifySignIn`: 400 `invalid_credentials` → `invalid`; 429 → `rate_limited`; 500, a fetch error and a timeout → `upstream`. `classifyVerify`: 403 `otp_expired` and 400 `invalid` → `code_invalid`. `classifyUpdate`: 422 `weak_password` → `weak`; 422 `same_password` → `same`. Unknown → `upstream`. `toLogSafe(error)` keeps `{status, code}` only (an error whose message holds an address is reduced, and the address is absent from the output) |
| 6 | **`POST /api/auth/password`** | `src/server/auth/{schemas,password-sign-in,redirect}.ts`, `src/app/api/auth/password/route.ts`, `tests/app/api/auth-password.test.ts` | Fake Auth success with owner claims → 200 `{redirect:"/"}`; with `next:"/fatture"` → `"/fatture"`; `next:"https://evil.test/"` → `"/"`; waiter claims → `"/tavoli"`; no tenant claim → `"/"`. `invalid_credentials` → 401 `login_invalid`, message "Email o password non corretti.". **The body for an unknown address is byte-identical** to the one for a wrong password. 429 → `rate_limited`; a 10 s timeout (fake timers) → 502. Extra key → 400 naming the key and not echoing values; `text/plain` → 415. `console.*` spies: no call contains the fixture address or password. `signInWithPassword` is called with exactly `{email, password}`; `checkNewPassword` is **not** called |
| 7 | **`POST /api/auth/email-code`** | `src/server/auth/email-code.ts`, `src/app/api/auth/email-code/route.ts`, `tests/app/api/auth-email-code.test.ts` | `verifyOtp` called with `{email, token:"123456", type:"email"}`. Owner → `{redirect:"/password?dopo=%2F"}`; owner with `next:"/password"` → `"/password"`; admin with `next:"/report"` → `"/password?dopo=%2Freport"`; waiter → `"/tavoli"`. `otp_expired` → 422 `code_invalid`; 429 → `rate_limited`. `code:"12345"`, `"1234567"` and `"12a456"` → 400 before any Auth call. Logs carry neither the code nor the address |
| 8 | **`GET`/`POST /api/me/password`** | `src/server/auth/password-change.ts`, `src/lib/supabase/verifier.ts`, `src/app/api/me/password/route.ts`, `tests/app/api/me-password.test.ts`, `tests/lib/supabase/verifier.test.ts` | **GET:** link claims 2 min old → `{signInMethod:"link", recentSignIn:true, recentUntil:<+10 min ISO>, minLength:10}`; password claims 3 days old → `recentSignIn:false, recentUntil:null`; chef → 403; `login:"pin"` → 403; 0 RPCs. **POST, call order (spies):** recent link session + good password → `updateUser({password})` → `signInWithPassword(email, new)` on the cookie client → `signOut({scope:"others"})` → 200; the verifier is never created. Old session without `currentPassword` → 422 `current_password_required`, no Auth call. Old session with a wrong current → the verifier's `signInWithPassword` fails → 422 `current_password_invalid`, `updateUser` not called. Right current → verifier sign-in, verifier `signOut({scope:"local"})`, then the same three calls. Policy failure → 422 `password_weak` `details.reason` "common", no Auth call. Auth `weak_password` → 422 `password_weak`; `same_password` → 422 `password_same`. **verifier:** the client has `persistSession:false`, `autoRefreshToken:false`, uses the publishable key, and its module does not import `@/lib/supabase/admin` |
| 9 | **Auth config and Italian e-mail templates** | `supabase/config.toml`, `supabase/templates/magic-link.html`, `supabase/templates/recovery.html`, `tests/config/auth-templates.test.ts`, `tests/config/deploy-config.test.ts` (extended) | **config:** `minimum_password_length` = 10 = `PASSWORD_MIN_LENGTH` (imported); `password_requirements` `""`; `secure_password_change` false; `timebox` still `"720h"`; `[auth.rate_limit] sign_in_sign_ups` still 30 and `token_verifications` still 30; `[auth.email.template.magic_link]` and `.recovery` have Italian subjects ("Il tuo accesso a Osteria Dei Rossi", "Recupero accesso a Osteria Dei Rossi") and `content_path` pointing at existing files; the `password_changed` notification stays commented. **Templates:** each holds `{{ .ConfirmationURL }}` both inside an `href` and as visible text, and `{{ .Token }}`. The only `{{ … }}` variables are those two. The body says (Italian) to tap the button or type the code in the app, and to ignore the e-mail if you did not ask for it. It contains "Osteria Dei Rossi" and **no other client fact** (no `@`, no phone-like digit run, no `http` literal, no "DigiAlto"). No `<script>`, no `on*=` attribute, no external image |
| 10 | **Real-stack integration** | `tests/integration/password-login.int.ts`, `tests/integration/helpers/auth-mail.ts` (Mailpit code reader) | On the local stack, calling the route handlers in-process with the cookie-jar helper (as `staff-pin.int.ts` does):<br>**(a) T3:** the magic-link e-mail for a new owner holds a 6-digit code; `email-code` with it → 200 and an `sb-` cookie; `GET /api/me` → owner.<br>**(b) T2:** that session's `amr[0].method` ∈ the "link" set; the method seen is recorded in the test output; after `refreshSession` the `amr` timestamp is unchanged.<br>**(c) T8:** `POST /api/me/password` (recent) → 200; a second, earlier session of the same owner (signed in by password before the change) then fails `refreshSession`; the new password signs in; the old one → `invalid_credentials`.<br>**(d)** A 9-character password through `updateUser` directly → Auth `weak_password` (proves the local minimum).<br>**(e) ADR-010 gate:** an M11 PIN account's synthetic address with the derived password via `/api/auth/password` → 200, but `GET /api/me` → 401 `session_ended`.<br>**(f)** Wrong password → 401 `login_invalid`.<br>**Budget:** the cookie-jar fetch counter shows at most 8 `grant_type=password` calls for the whole suite |
| 11 | **`/login` password and code views** | `src/app/(public)/login/{page,login-screen,password-form,code-form}.tsx` (`login-form.tsx` removed), `src/lib/auth/login-view.ts`, `src/lib/i18n/messages/{it,en}.ts`, `tests/components/login-page.test.ts` (updated on purpose), `tests/components/password-form.test.ts`, `tests/lib/auth/login-view.test.ts` | **login-page (no device cookie):** the `h1` "Accedi"; the `/dispositivo` link (still 44 px, still without `next`); fields labelled "Email" (`autocomplete="username"`) and "Password" (`autocomplete="current-password"`); buttons "Accedi con la password" and "Inviami il link"; `?errore=sessione` → the 30-day note. **password-form:** submit → one `POST /api/auth/password` with `{email, password, next}`, then `forgetUser` and `router.replace(<redirect>)`; 401 → `role="alert"` "Email o password non corretti." and the password field cleared; "Mostra" flips `type` and `aria-pressed`. "Inviami il link" with an empty e-mail → "Scrivi prima la tua email." and no request; with an e-mail → one `POST /api/auth/magic-link`, then a `role="status"` containing "riceverai un'email" and "codice di 6 cifre", the field "Codice di 6 cifre" (`inputmode="numeric"`, `autocomplete="one-time-code"`), and no password field. "Entra con il codice" → `POST /api/auth/email-code`; 422 → "Codice non valido o scaduto. Chiedine uno nuovo.". Every button is ≥ 44 px (class check). The i18n `it`/`en` key-parity test stays green |
| 12 | **Staff view on `/login`; `/pin` redirect; enrolment straight to PIN** | `src/app/(public)/login/{page,login-screen}.tsx`, `src/app/(public)/pin/{page,pin-flow}.tsx`, `src/app/(public)/dispositivo/enrol-form.tsx`, `tests/components/login-staff.test.ts`, `tests/components/pin-flow.test.ts` (extended), `tests/components/enrol-form.test.ts` (updated on purpose), `tests/components/pin-page.test.ts` | **login-staff:** with the device cookie present, the page renders `PinFlow` and **no** "Accedi" `h1`; the button "Sei il titolare? Accedi con email" has `aria-expanded="false"` and the password form is absent; after a click `aria-expanded="true"` and the form with `id="owner-login"` holds "Email" and "Password". `GET /api/auth/device` → `{enrolled:false}` → the password view (`h1` "Accedi"). `?abilitato=1` with `label` "Telefono sala (demo)" → `role="status"` "Telefono abilitato: Telefono sala (demo).". **pin-page:** `/pin` calls `redirect("/login")`. **enrol-form:** success → `router.replace("/login?abilitato=1")`, and the old "Vai all'accesso con PIN" link is gone |
| 13 | **`/password` page; Oggi link** | `src/app/(owner)/password/{page,password-form}.tsx`, `src/lib/auth/password-view.ts`, `src/app/(owner)/page.tsx`, `src/lib/i18n/messages/{it,en}.ts`, `tests/components/password-page.test.ts`, `tests/lib/auth/password-view.test.ts`, `tests/components/home-today.test.ts` (extended), `tests/lib/nav/nav-model.test.ts` (one case) | **password-page:** exactly one `GET /api/me/password`. The first link is the `BackLink` to `/`, before the `h1` "Password". Recent link reply → intro "Imposta una password…", no "Password attuale", "Nuova password" with `autocomplete="new-password"` and the 10-character hint. Old reply → "Password attuale" present and the code link → `/login?next=%2Fpassword`. Submit → `POST /api/me/password` with exactly the filled fields. 200 → `role="status"` "Password salvata. Sugli altri dispositivi dovrai accedere di nuovo." and, with `?dopo=%2Freport`, `router.replace("/report")`. `?dopo=https://evil.test` → "Non ora" points at `/`. 422 `password_weak` → its server message in `role="alert"`. 403 → the reserved message. **password-view:** "link" → `home.setPassword`; "password" or "other" → `home.changePassword`. **home-today:** owner, `signInMethod:"link"` → a link "Imposta una password" → `/password`; admin with "password" → "Cambia password"; chef → no request to `/api/me/password` and no link. **nav-model:** `currentSection("owner","/password")` → null |
| 14 | **Setup guide; `pinLoginReady`** | `src/lib/staff-auth/setup-guide.ts`, `src/lib/env/index.ts` (`isPinPepperConfigured`), `src/app/api/devices/route.ts`, `src/server/staff-auth/types.ts`, `src/app/(owner)/personale/{page,setup-guide}.tsx`, `src/lib/i18n/messages/{it,en}.ts`, `tests/lib/staff-auth/setup-guide.test.ts`, `tests/lib/env/pin-env.test.ts` (extended), `tests/app/api/staff-auth/devices.test.ts` (extended), `tests/components/personale-guide.test.ts` | **setup-guide:** `(0,0,true)` → 4 steps, steps 1 and 3 "Da fare", `collapsed:false`, no warning; `(2,1,true)` → steps 1 and 3 "Fatto", `collapsed:true`; `(0,0,false)` → `warning:"pin_not_ready"` first. **env:** `PIN_PEPPER` of 64 hex chars → true; 31 chars, empty, unset → false; the value is never returned. **devices route:** the reply has `pinLoginReady` true/false by env, alongside the unchanged `devices`/`pendingCodes`; chef → 403. **personale-guide:** the `Card` heading "Come far entrare il personale", four ordered items with the step texts, the badges per state, the warning text when not ready, and the collapsed button with `aria-expanded="false"` → `"true"` on click. The page still has at most two `Card`s; no number is computed in the component (the counts come from the helper) |
| 15 | **Owner guide (Italian) and design note** | `docs/guides/accesso-e-personale.md`, `docs/design/ui-foundation.md` (§8 M25a line), `tests/config/owner-guide.test.ts` | The guide has the sections "Il tuo accesso", "Se dimentichi la password", "Far entrare il personale", "Se un telefono si perde". Every label quoted in «…» in it equals a value of `src/lib/i18n/messages/it.ts` (parsed). It contains no `@`, no `http`, and no client fact other than "Osteria Dei Rossi" |
| 16 | **E2E: password, code, persistence** | `e2e/password-login.spec.ts`, `e2e/session-persistence.spec.ts`, `e2e/helpers/session.ts` (`signInWithPassword`, `setFixturePassword`), `e2e/helpers/mailbox.ts` (`latestCodeFor`), `playwright.config.ts` (`phone-webkit` `testMatch` + `session-persistence`), `tests/config/playwright-projects.test.ts` (updated on purpose) | **password-login (phone):**<br>(1) `setFixturePassword(createOwner())`: the tenant id from `create-tenant`'s output → the owner's `auth_id` (`app_user`, local secret key) → `updateUserById`. On `/login`, fill "Email" and "Password", click "Accedi con la password" → `/`; `main(page).getByRole("link", { name: "Cambia password", exact: true })` is visible.<br>(2) A wrong password → `main(page).getByRole("alert")` has the text "Email o password non corretti.".<br>(3) The code path for a fresh owner: "Inviami il link" → status → `latestCodeFor` → "Codice di 6 cifre" → "Entra con il codice" → `/password?dopo=%2F`; `main(page).getByRole("heading", { name: "Password", exact: true })`; there is no "Password attuale"; fill "Nuova password" → "Salva password" → `/`; the Oggi link now reads "Cambia password".<br>(4) `expectPhoneFriendly` on `/login` (light and dark) and `/password`.<br>**session-persistence (phone and phone-webkit), T4:** after a password sign-in:<br>- every `sb-` cookie has `expires` > now + 30 days (not a session cookie), `httpOnly`, `sameSite:"Lax"`, and `secure` by the loopback rule of `magic-link.spec.ts`;<br>- `context.storageState()` → a **new** context from it → `goto("/")` lands on `/` with "Ruolo: Titolare" (a relaunch keeps the session);<br>- `page.request.get("/api/me")` → 200.<br>No `.first()`/`.last()`; headings by exact name inside `main`. **Budget:** at most 4 password sign-ins across both files per project |
| 17 | **E2E updates: staff on `/login`; B5 list** | `e2e/staff-pin.spec.ts` (updated on purpose), `e2e/app-shell.spec.ts` (B5 `routes` gains `["/password", "/"]`) | **staff-pin:** after "Abilita", the device is at `/login` with `getByRole("status")` "Telefono abilitato: Telefono sala (demo)." and the heading "Chi sei?" (exact), with no extra tap. Every former `/\/pin$/` URL check becomes `/\/login$/` (lines 114, 144, 194); the revoked device's "/" lands on `/login` with the password view (`h1` "Accedi", exact). The disclosure "Sei il titolare? Accedi con email" goes `aria-expanded` false → true and shows the "Email" field. `goto("/pin")` lands on `/login`. **app-shell:** the B5 test is green with `/password`; the A3 loop (`/login`, `/pin`) is green unchanged |

**Acceptance (the founder's request) → proof**

| Requirement | Proved in (step) | Command |
|---|---|---|
| Owner/admin e-mail + password on `/login` | 6, 11, 16 | `npm test`; `npx playwright test` |
| Link only as "Password dimenticata / accedi con link" | 11 (layout), 16 (3) | same |
| Set a password on first login by link; existing owners without one; forgotten password | 7, 8, 10 (a, c), 13, 16 (3) | `npm test`; `npm run test:integration`; `npx playwright test` |
| Change password (current password when not recent; other devices signed out) | 8, 10 (c), 13 | as above |
| 30-day sessions; no re-login on each visit | 1–3; 16 (persistence, Chromium and WebKit); M-3 on real phones | as above + manual |
| Minimum length + leaked-password fallback | 4, 9, 10 (d); M-1 | `npm test`; `npm run test:integration` |
| Rate limits per the existing design | 5–8 (429 mapping); 9 (limits unchanged); 10 (budget) | `npm test`; `npm run test:integration` |
| Staff picker + PIN pad by default on enrolled devices | 12, 17 | `npm test`; `npx playwright test` |
| Enrolment in a few taps; Italian first-run guide | 12, 14, 15, 17 | as above |
| Env/secrets list | §3.7.1; 14 (`pinLoginReady`) | `npm test` |
| Invariants: no SQL, no new dependency, no nav change, secret key untouched, every screen via `/api/*` | 0; the existing `admin-client-import`, `privileged-importers`, `offline-cache-allowlist` tests | `npm test`; `npm run lint` |

**CI implications:**
- **Drafts:** only the cheap `checks` job runs (Vitest steps 0–9 and 11–15, lint, types, config tests).
- **The ready PR's heavy run:**
  - pgTAP: unchanged (no new file);
  - integration: one new suite, at most 8 password sign-ins;
  - Playwright: two new specs. `session-persistence` runs twice (Chromium and WebKit), plus the longer `staff-pin` flow.
- **Heavy-job time:** about 23 of its 30 minutes today. The new specs' time is measured in that run and reported in the PR; no figure is promised. If the job exceeds 25 minutes (M25's stop rule), the PR says so and asks before any CI change.
- **If M25's 2-shard CI is merged first,** the new specs simply join the shards.
- **No new workflow, no new CI secret.**

### 5b. Variants

**V1: no session cap** · Trigger: Q199 answered "do not cap; stay signed in until sign-out" · Replaces steps: the cap parts of 1, 2 and 3 (recency and method helpers stay)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | Remove `isSessionExpired` from `withApi` and the proxy, `SESSION_MAX_AGE_DAYS` and the `session_expired` code; the client's `session_expired` branch goes | `src/lib/api/with-api.ts`, `src/lib/supabase/proxy.ts`, `src/lib/api/client.ts`, `src/lib/auth/session-age.ts`, `src/lib/api/errors.ts` | `with-api-session-age.test.ts` becomes "a 400-day-old `amr` → 200, `signOut` not called"; the proxy test: a 400-day-old session on `/fatture` → `NextResponse.next`; `client.test.ts` no longer has the `session_expired` case; `errors.ts` has no `session_expired` (type test) |
| V1.2 | `/login` no longer shows the 30-day note | `src/app/(public)/login/page.tsx`, `tests/components/login-page.test.ts` | `?errore=sessione` renders nothing extra |

**V2: other devices stay signed in after a password change** · Trigger: Q201 answered "keep my other devices signed in" · Replaces steps: the `signOut({scope:"others"})` call of 8, case (c) of 10, the success text of 13

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V2.1 | `password-change.ts` drops `signOut({scope:"others"})`; the success text becomes "Password salvata." | `src/server/auth/password-change.ts`, `src/lib/i18n/messages/{it,en}.ts`, `tests/app/api/me-password.test.ts`, `tests/components/password-page.test.ts` | The spy order ends with the re-sign-in; `signOut` is never called with `others`; the status text equals "Password salvata." |
| V2.2 | Integration (c) inverted | `tests/integration/password-login.int.ts` | The earlier session still refreshes after the change. If Supabase itself ends other sessions on a password update, this test fails and records it; the variant then stops and the founder is told |

**V3: enrolment by QR** · Trigger: Q202 answered "yes, with the QR" **and** the new dependency approved · Replaces steps: the dependency assertion of 0 (adds after 14)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V3.1 | Add one QR encoder dependency. Candidate: `qrcode` (npm), which replaces writing a Reed–Solomon encoder by hand; its licence and maintenance state are checked and recorded in the PR when added (not verified here). It runs **on the server only**: `src/server/staff-auth/qr.ts` turns the URL `https://<host>/dispositivo#<CODE>` into a boolean matrix | `package.json`, `package-lock.json`, `src/server/staff-auth/qr.ts`, `tests/config/no-new-deps.test.ts` and `tests/config/m25a-preserves.test.ts` (list updated on purpose), `tests/server/staff-auth/qr.test.ts` | The matrix for a fixed URL equals a stored snapshot; it is square, with odd side ≥ 21. The code is only in the fragment (never in the path or query). `npm audit` stays clean |
| V3.2 | `POST /api/devices/enrolment-codes` adds `qr: boolean[][]`; `CodeCard` draws it as an inline `<svg>` of `rect`s (`aria-hidden`, `focusable="false"`, theme classes, no `style`, no `data:`), with the text "Su iPhone apri prima l'app installata e scrivi il codice: la fotocamera apre Safari, non l'app." | `src/server/staff-auth/devices.ts`, `src/app/(owner)/dispositivi/code-card.tsx`, `tests/components/code-card.test.ts`, `tests/app/api/staff-auth/devices.test.ts` | The SVG has one `rect` per dark module; there is no `<a>` in the card (the M11 rule "never a link" holds); the iPhone note is present |
| V3.3 | `/dispositivo` reads `location.hash` once, prefills the code field and clears the hash | `src/app/(public)/dispositivo/enrol-form.tsx`, `tests/components/enrol-form.test.ts`, `e2e/staff-pin.spec.ts` | `#K7M2QX9P` → the field holds "K7M2QX9P" and `location.hash` is empty; e2e: `goto("/dispositivo#<code>")` → "Abilita" → `/login` "Chi sei?" |

**V4: app-level gate in front of Auth for password and code attempts** · Trigger: Q203 answered "add the gate" (this extends CLAUDE.md rule 2, so it needs your explicit OK) · Replaces steps: the "no migration" and "four importers" assertions of 0; adds a gate call to 6, 7 and 8 (current-password check)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V4.1 | Migration `20261118100000_login_gate.sql`. Its header carries the corrected wording of `20261027100800`'s stale header (M25 G18).<br>- `app.login_failure (id bigint identity, key_hash text check (key_hash ~ '^[0-9a-f]{64}$'), at timestamptz default clock_timestamp())`: schema `app`, RLS on, no policy, no API privilege (like `app.enrol_failure`).<br>- `public.login_gate(p_ip_hash text, p_email_hash text) returns jsonb`: `limited` when ≥ 20 failures for the IP or ≥ 10 for the address in 15 minutes.<br>- `public.login_gate_failed(p_ip_hash text, p_email_hash text) returns void`.<br>- Both `security definer`, `search_path = ''`, **execute to `service_role` only**.<br>- `app.purge_auth_data` replaced to also delete `app.login_failure` older than 1 day; any md5 pin of it is updated in the same commit.<br>- **New public functions, so these change on purpose:** the public-function lists of pgTAP `207`, `214`, `222`, `240` and `229`'s name list | `supabase/migrations/20261118100000_login_gate.sql`, `supabase/tests/database/267_login_gate.test.sql`, the five pgTAP files, `tests/config/m25a-preserves.test.ts` | `267`: the thresholds at 19/20 and 9/10; the window edge at 15 minutes; `anon` and `authenticated` cannot execute; `prosecdef`, `proconfig`; the purge deletes 25-hour-old rows only; RLS on and no policy for `app.login_failure`; the five lists green with the two names |
| V4.2 | `privileged.ts` gains `loginGate` and `loginGateFailed`. Hashes are `HMAC-SHA256(PIN_PEPPER, "ip:"+ip)` and `("email:"+lower(email))`. Routes 6–8 call the gate **before** Auth → 429 `rate_limited` without any Auth call; a failure records both keys. CLAUDE.md rule 2 lists `/api/auth/password`, `/api/auth/email-code` and `/api/me/password`; ADR-029 notes the extension | `src/server/staff-auth/privileged.ts`, the three routes, `CLAUDE.md`, `docs/adr/adr-029-owner-password-sign-in.md`, `tests/guards/privileged-importers.test.ts` (seven importers, on purpose), `tests/app/api/auth-password.test.ts`, `auth-email-code.test.ts`, `me-password.test.ts`, `tests/integration/password-login.int.ts` | Gate `limited` → 429 and 0 Auth calls; `invalid_credentials` → one `loginGateFailed` with two 64-hex hashes and neither the raw address nor the IP; success → no failure call; the integration suite: the 21st failed attempt from one IP → 429 |

**V5: CI headroom for Auth sign-ins** · Trigger: T9 fails (the ready run shows an Auth 429 `over_request_rate_limit` in the new specs or the integration suite) · Replaces steps: the `sign_in_sign_ups` value in 9's config assertions

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V5.1 | Local stack only: `[auth.rate_limit] sign_in_sign_ups` 30 → 60, with a comment that hosted values are set in the dashboard and unchanged | `supabase/config.toml`, `tests/config/deploy-config.test.ts` | The config test asserts 60 and the comment; the next heavy run has no 429 (recorded in the PR) |

**V6: session cookies made persistent explicitly** · Trigger: T4 fails (step 16 finds an `sb-` cookie with no expiry, i.e. a session cookie, on Chromium or WebKit) · Replaces steps: the cookie-expiry threshold of 16 (adds before it)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V6.1 | `SESSION_COOKIE_OPTIONS` gains `maxAge: 2_592_000` (30 days in seconds, = `SESSION_MAX_AGE_DAYS`). `@supabase/ssr` rewrites the cookies at every refresh, so a used session keeps a fresh expiry | `src/lib/supabase/cookies.ts`, `tests/lib/supabase/cookies.test.ts` | `sessionCookieOptions(new URL("https://x.test")).maxAge` and the loopback variant both equal `SESSION_MAX_AGE_DAYS × 86 400` (imported); `httpOnly`, `secure`, `sameSite` unchanged |
| V6.2 | The persistence spec's threshold becomes `expires` > now + 29 days | `e2e/session-persistence.spec.ts` | Green on `phone` and `phone-webkit`, including the new-context relaunch |

## 6. Risks and mitigations

- **Security and privacy**
  - *Password guessing:*
    - Supabase's per-IP limits and bcrypt;
    - one generic error (6);
    - minimum 10, common list, name and address rules (4);
    - unverified: whether server-side calls share one bucket (§3.1.8). V4 adds our own gate.
  - *Lock-out of the venue by exhausting the shared bucket:* PIN logins could get 429 for up to 5 minutes. Fallbacks:
    - the e-mail link is verified browser-to-Supabase;
    - lockouts bound PIN guessing.
    Accepted by default; Q203.
  - *E-mail code guessing:* 6 digits, Supabase's `token_verifications` limit and expiry. Each guess costs a request, and the address must be known.
  - *Account enumeration:*
    - sign-in answers the same for unknown and wrong (6);
    - the link/code request always answers 202 (unchanged);
    - the code route answers `code_invalid` for both.
  - *Login CSRF:*
    - JSON-only writes (`withApi`), so no cross-site form posts;
    - the callback still accepts only PKCE codes;
    - the code is typed by the person.
  - *Session theft:* HttpOnly, Secure, `SameSite=Lax` cookies; the 30-day cap; other sessions ended on every password change (8, 10).
  - *Account takeover through a stolen phone:* a change needs the current password unless the sign-in is under 10 minutes old (8). TOTP is Q204.
  - *Open redirect:* `next` and `dopo` go through `safeNextPath` (6, 7, 13).
  - *PIN accounts at the password form:* the derived password needs the pepper, and the hook refuses tenant claims without a pending PIN attempt (10 e).
  - *Logs:*
    - routes log codes only (6–8);
    - `scrubEvent` redacts `password` and `code` keys;
    - the verifier client is never logged.
  - *Secret key:* not used by any new file (0, the existing lint and guard tests). The verifier uses the publishable key (8).
  - *Personal data (GDPR):*
    - nothing new is stored by the app. The password hash is held by Supabase Auth (already a processor for the address);
    - Supabase's own Auth audit log records sign-ins (existing, Supabase-managed);
    - no change to retention (project Q14);
    - the client's register entry gains "accesso con password" (project Q13, M-7).
  - *Demo owner's password reset by the perf script:* `scripts/lib/perf-dashboard.ts` sets a random password for the **demo owner** on each run. On staging, the founder then uses the code path once. It never runs on production (M25 guards). Noted in the guide's last section for DigiAlto, not the owner.
- **Correctness**
  - *`/login` view chosen from a cookie the server cannot validate:* a stale cookie shows `PinFlow`, whose device call switches to the password view and clears the cookie (12, 17).
  - *Old sessions at deploy:* every session older than 30 days ends once (M-4). Staff PIN sessions are unaffected.
  - *Existing specs that assert `/pin`:* updated on purpose (2, 3, 17). `/pin` keeps working as a redirect (12).
  - *Merge with M25:* M25's `m25-preserves.test.ts` pins the migration list, the dependency list and `nav-model.ts`. M25a changes none of them (0). Both edit `tests/config/playwright-projects.test.ts` and `playwright.config.ts` (M25: `service-sim`; M25a: `phone-webkit` `testMatch`). Whichever merges second keeps both.
- **Unverified (proved in the named step or by the founder)**
  - **T1:** HaveIBeenPwned protection needs Supabase Pro. This comes from a search summary of https://supabase.com/docs/guides/auth/password-security; the page itself could not be loaded. The founder checks the dashboard (M-1). The local rules are built regardless (4).
  - **T2:** the `amr` method names for link and code sign-ins, and that `amr` timestamps survive refresh. Step 10 (b); `signInMethod` maps a known set and anything else to "other".
  - **T3:** the PKCE `signInWithOtp` e-mail's `{{ .Token }}` is accepted by `verifyOtp` type `email`. Step 10 (a). If it is not, M25a stops after step 10 for a re-plan.
  - **T4:** `@supabase/ssr` sets persistent cookies (a `Max-Age`) with our `cookieOptions`. Step 16 on Chromium and WebKit. If any `sb-` cookie has no expiry → V6.
  - **T5:** SecLists' licence (step 4).
  - **T5b:** iPhone home-screen apps keep their own persistent cookie storage, apart from Safari. HttpOnly first-party cookies set by our server's responses are not subject to Safari's 7-day limit on script-written storage. An installed Android app shares Chrome's cookies. These come from prior knowledge and WebKit's posts, which were not reachable from this session (webkit.org does not resolve here). Proved on real devices by M-3.
  - **T6:** hosted "Time-box user sessions" is not available on Free (M0 Q-B; the comment on line 278). The founder notes what the dashboard offers (M-1). The app cap makes behaviour the same either way.
  - **T7:** TOTP MFA availability on Free (the CLI template comment on `config.toml` line 303 says Pro; not verified). M-6, for Q204.
  - **T8:** `signOut({scope:"others"})` revokes the other sessions' refresh tokens. Step 10 (c).
  - **T9:** link sign-ins do not draw on `sign_in_sign_ups`, and the new specs stay within it. Measured in the ready run. If not → V5.
  - **T10:** the HTML template still yields the `/auth/v1/verify` URL in Mailpit's `Text`, which `latestLinkFor` reads. It is printed as plain text on purpose (9). Proved by `magic-link.spec.ts` and every existing spec in the ready run.
- **Performance and cost:** no figure is promised. A password sign-in is one Auth call. A change is up to four Auth calls (verify, update, re-sign-in, sign-out others). The Oggi link costs one claims-only request for owner and admin. No new provider, job or paid service.
- **Dependencies:** none added (0).
- **Plan changes to record in DigiAlto-Ops `clients/osteria-dei-rossi/context.md`:**
  - project plan §3.11.3: owner/admin sign in with password; e-mail link + code as the fallback and the only recovery; the 30-day cap enforced in the app (M0 Q-B closed);
  - §3.3: the new routes `/api/auth/password`, `/api/auth/email-code`, `/api/me/password`, and the page `/password`;
  - `/pin` is now a redirect to `/login`;
  - M11 Q12 (iOS installed-app storage) is reused for the code design;
  - Q204 carries M11 Q9 / M0 Q-C.

## 7. Open questions for the founder (answered)

**Founder answers (2026-11-01, through the lead):** the plan is approved, and every default stands.
- **Q197:** minimum length 10, no composition rules.
- **Q198:** the local leaked-password rules.
- **Q199:** 30-day sessions, enforced in the app.
- **Q200:** the current password is required, except within 10 minutes of signing in.
- **Q201:** a password change signs out the other devices.
- **Q202:** an 8-character enrolment code, no QR.
- **Q203:** no throttle of our own; CLAUDE.md rule 2 is unchanged.
- **Q204:** TOTP after go-live.
- **Q205:** no "password changed" e-mail.
- **Q206:** owner and admin use a password, staff use a PIN.

No variant (V1–V6) is built. The questions as they were asked follow.

**Still open from earlier plans:**
- project Q13 (the GDPR register: add "accesso con password");
- M11 Q9 / M0 Q-C (→ Q204);
- M25 Q188 (the custom domain: the Resend sender domain waits for it);
- M25 Q196.

**New:**
- **Q197 Minimum password length.**
  - **Default:** 10 characters, no rules about upper case, digits or symbols (a sentence is fine). Common passwords, your e-mail and the venue's name are refused.
  - Another number changes one constant (`PASSWORD_MIN_LENGTH`), the Supabase setting (M-1) and the length cases of steps 4 and 9.
- **Q198 Leaked-password protection.**
  - **Default:** not available on Free as far as known (T1), so the local rules of Q197 apply.
  - **Alternative:** move the project to Supabase Pro and switch the protection on in the dashboard. The code already maps Supabase's refusal to the same message (step 8). Prices and fees: ask Supabase directly; they are not estimated here.
- **Q199 How long a sign-in lasts.**
  - **Default:** 30 days from the sign-in on that phone, as the PRD says. Inside the 30 days nobody signs in again.
  - **Alternative:** no limit; stay signed in until "Esci" (→ V1).
- **Q200 When a password change asks for the current password.**
  - **Default:** not within 10 minutes of a sign-in (that is the "forgot password" case), always after that.
  - Another window changes one constant (`RECENT_SIGN_IN_MINUTES`) and the cases of steps 1 and 8.
- **Q201 Other devices after a password change.**
  - **Default:** they are signed out and must use the new password.
  - **Alternative:** they stay signed in (→ V2).
- **Q202 Enrolling a phone by QR.**
  - **Default:** the 8-character code, typed in the installed app.
  - **Alternative:** also a QR on the owner's screen (→ V3). It needs one new dependency (your OK), and on iPhone the camera opens Safari rather than the app.
- **Q203 Our own limit on sign-in attempts, in front of Supabase's.**
  - **Default:** Supabase's limits only, as for the e-mail link today. Someone could briefly block PIN logins by hammering the password form (§6).
  - **Alternative:** a gate in our database (→ V4). It uses the server's secret key on three more routes, which changes CLAUDE.md rule 2 and needs your explicit OK.
- **Q204 Authenticator-app codes (TOTP) for owner and admin** (M11 Q9; M0 Q-C).
  - **Default:** not in M25a. Proposed as an optional follow-up after go-live, if Free offers it (M-6, T7): optional for the owner, and required for the admin (DigiAlto support).
  - Passkeys (Face ID) could be weighed in the same follow-up.
- **Q205 "Your password was changed" e-mail.**
  - **Default:** off, as for M11: Supabase's notification would also try to e-mail the staff's synthetic addresses on PIN resets.
  - Please confirm; turning it on safely is a re-plan (it needs a filter on PIN accounts).
- **Q206 Who uses a password.**
  - **Default:** owner and admin set and change it in the app. Chef and waiter use the PIN.
  - Please confirm; a different answer is a re-plan.

**Assumptions (please confirm; a different answer means a re-plan, not a variant):**
- **A1:** the Auth e-mails are in Italian only.
- **A2:** production staff never use e-mail accounts (M11 Q8 default).
- **A3:** Vercel Production keeps pointing at staging until M25 (M0 Q-E).

**Technical, resolved inside the build:** T1–T10 (§6).

## 8. Manual steps for the founder

None is needed to build or merge M25a. **Never paste a value into a chat, an issue or the repo.**

- **M-1 Supabase Auth settings** (staging now; production when M25 creates it). In Authentication:
  1. Minimum password length **10** (Q197). Leave "required characters" empty.
  2. "Secure password change": **off**.
  3. Leaked-password protection: if the switch is offered on Free, turn it on and tell the lead. If it says Pro, leave it (T1).
  4. E-mail templates:
     - "Magic Link": subject "Il tuo accesso a Osteria Dei Rossi", body = the HTML of `supabase/templates/magic-link.html`;
     - "Reset Password": subject "Recupero accesso a Osteria Dei Rossi", body = `recovery.html`.
     Keep `{{ .ConfirmationURL }}` and `{{ .Token }}` as they are.
  5. Security notifications ("password changed", "email changed"): **off** (as M11 M-3; Q205).
  6. Sessions: note whether "Time-box user sessions" is offered on Free (T6). Do not change it.
  7. Check that sign-ups stay off and that the Access Token hook is set (§3.7.1 S1–S2).
- **M-2 PIN environment** (§3.7.1): confirm E1–E4 in Vercel Preview and Production for staging, then for production at go-live. Redeploy. Open `/personale`: the guide must not show "non è ancora attivo".
- **M-3 Real phones, about 10 minutes, after merge on staging.** Record the results in the PR or send them to the lead.
  1. **iPhone:**
     - Safari → staging → Condividi → Aggiungi alla schermata Home;
     - open the installed app and sign in with the password;
     - close the app (swipe it away), reopen it after more than an hour (the token expires and refreshes): still signed in;
     - restart the phone, reopen: still signed in;
     - "Esci", then "Inviami il link" and type the **code** in the app: it works.
  2. **Android (Chrome):** the same, after "Installa app".
  3. **Staff:**
     - on one of the phones, enrol from inside the installed app with a code from `/dispositivi`;
     - the app opens on "Chi sei?";
     - close and reopen: still enrolled.
- **M-4 Tell the owner before the deploy:**
  - sessions older than 30 days end once;
  - the first time, use "Inviami il link", type the code and choose a password;
  - after that, nothing changes for 30 days.
- **M-5 Resend** (already M25 §8.3): the link and code e-mails go through it. Nothing new beyond the templates.
- **M-6 TOTP (Q204):** in Authentication → Multi-Factor, note whether "Authenticator app (TOTP)" can be enabled on Free (T7). Do not enable it yet.
- **M-7 GDPR (client task, project Q13):** the register entry for owner/admin accounts adds "accesso con password (gestita da Supabase Auth)".
- **Answer Q197–Q206 when convenient.** A different answer to Q199, Q201, Q202 or Q203 triggers its variant as a follow-up PR. Q203 and the dependency in Q202 need your explicit OK.

## 9. Sources

- **Worktree `/home/user/osteria-m25a` (`main` `0f1df68`):**
  - `CLAUDE.md`; `docs/prd.md` (security row: "magic-link sessions 30 days"); project plan §3.11.3 (line 322);
  - the M0 plan (§5b V1, Q-B, Q-C); the M11 plan (§3.1, §3.4, §3.5, §3.8, §6, §7 Q8, Q9, Q12, §8 M-1–M-6); the M24 plan (structure); ADR-010; `docs/design/ui-foundation.md` §6–§8; `docs/client-facts.md`;
  - `supabase/config.toml`;
  - `src/app/(public)/{login,pin,dispositivo}/*`, `src/app/(owner)/{page,dispositivi/*,personale/*}.tsx`;
  - `src/app/api/auth/{magic-link,callback,device,pin,logout}/route.ts`, `src/app/api/devices/enrol/route.ts`, `src/app/api/me/route.ts`;
  - `src/lib/api/{with-api,client}.ts`, `src/lib/supabase/{proxy,cookies}.ts`, `src/lib/env/index.ts`, `src/lib/nav/{nav-model,today-actions}.ts`;
  - `src/server/staff-auth/{constants,device-cookie,devices,privileged}.ts`;
  - `public/sw.js`, `scripts/create-tenant.ts`, `scripts/lib/perf-dashboard.ts`;
  - `.github/workflows/ci.yml`, `playwright.config.ts`, `.env.example`;
  - `e2e/helpers/{session,mailbox}.ts`, `e2e/{magic-link,staff-pin,app-shell,smoke}.spec.ts`;
  - `tests/components/login-page.test.ts`, `tests/config/{proxy-matcher,integration-suite,deploy-config}.test.ts`, `tests/guards/privileged-importers.test.ts`, `tests/integration/helpers/stack.ts`.
- **M25 plan** (`/home/user/osteria-m25/docs/plans/2026-11-01-m25-go-live.md`, plan commit `f6e87e5`): Q187 (Free), Q189 (Resend), §3.1.9 (CI minutes, the 25-minute stop rule), §8, G18.
- **DigiAlto-Ops** `clients/osteria-dei-rossi/context.md`: Q-B ("enforced in the app"), Q-C, Q-E, and "Cross-device magic links: an email OTP code".
- **Web** (Supabase and WebKit documentation hosts do not resolve from this session: supabase.com and webkit.org must be allowed in the session's network settings to cite them directly):
  - search summaries only: [Supabase — Password security](https://supabase.com/docs/guides/auth/password-security.md) (HaveIBeenPwned, plan-gated per the summary, T1); [Supabase — User sessions](https://supabase.com/docs/guides/auth/sessions) (sessions last indefinitely by default; time-box and inactivity settings; plan gating not confirmed, T6);
  - third-party pages seen in the same search, not relied on: [guardlayer.io](https://www.guardlayer.io/blog/supabase-leaked-password-protection), [vibe-eval.com](https://vibe-eval.com/fix/supabase-leaked-password-protection/), [database.dev supasession](https://database.dev/Snehil_Shah/supasession);
  - SecLists (common-password source, licence to confirm in step 4): https://github.com/danielmiessler/SecLists;
  - WebKit, "Full Third-Party Cookie Blocking and More" (home-screen apps, 7-day script-storage cap): https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/ (not reachable here, T5b).
