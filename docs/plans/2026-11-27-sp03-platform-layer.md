# Tech plan: Costì / Osteria Digitalization · SP3, the platform layer (the DigiAlto console's backend)

- **Status:** approved by the lead 2026-11-27 (§8a) · **Author:** SP3 planner · **Date:** 2026-11-27
- **Supersedes:** `docs/plans/2026-11-15-sp3-console.md` on draft PR #138 (`docs/sp3-console-plan`, head `210258a1`, never merged). The
  **design is #138's, unchanged** (its §3, the API of its §3.4 "FINAL", its lead decisions Q-P1–Q-P16 of §7a, its variants V1–V15). This
  file re-bases it on today's `main` (`c78de05e`, SP2 PR 1 #216 merged) and on SP2 PR 2 #217 / PR 3 #218 as approved: what is already on
  `main`, what to cherry-pick from draft PR #150, the new numbers, the pins, the PR split and the gates.
- **Milestone:** SP3 of `docs/plans/2026-11-13-platform-saas.md` (§10 row SP3; §10a "SP3" tests 1–12; §2.1–§2.6; §0a, §0b; ADR-037).
  Build order SP2 → SP3 → SP4 → SP5 → SP6 → SP7 (founder, 2026-11-26).
- **Client facts used:** none. Fixtures are fake ("Osteria Demo A/B", `IT00000000000`-style VAT numbers, addresses on `example.test`).
  **No e-mail address and no account name appears in this plan** (FD28): the platform admin account is "the platform admin account
  (address held by DigiAlto)".
- **ID scheme:** #138's step numbers are kept (**steps 1–25**, 21a; 8 withdrawn) so #150's commit messages and #138's cross-references stay
  valid. SP3 PRs **PR 1–PR 4**. New questions **Q-R1–Q-R5** (lead), **F-1–F-5** (founder). Acceptance tests **AT1–AT12** = platform plan
  §10a "SP3" tests 1–12 (AT11 as amended by #138 Q-P5). SP2 steps are "SP2 S3"; SP0 hosted verdicts "T1.H"–"T4.H".

---

## 0. Summary

SP3 gives DigiAlto's console a backend. The console **screens are already on `main`** (#142), and so are the proxy host rules (#155), the
code lists and API schemas, the realtime guard, the console band and the `platform-ops` workflow with three jobs (#140). What is missing
is everything under them: the `platform` tables beyond `organisation`, the `platform_staff` role, console mode in the hook, the metadata
functions, the bootstrap, the account-level second factor and the `/api/platform/**` routes. Until they land, the screens answer 404
because `CONSOLE_HOST` is unset.

1. **Who (FD28).** `platform.staff` holds at most one active `platform_admin` (partial unique index). A `platform-ops` job bootstraps it from
   the environment secret `PLATFORM_ADMIN_EMAIL`. The address is never a workflow input, never printed, and never in the repo.
2. **Second factor (FD31).** `admin` already needs `aal2` in every tenant mode on `main` (`20261202100000_admin_mfa_always.sql`). SP3 adds
   `aal2` and a verified factor for every console function and for `select_console`, an account-level factor for a staff member with no
   membership, and `aal2` for `my_memberships` for `admin` holders.
3. **Console mode.** `select_console()` → the hook sets `role = platform_staff` with no tenant claim. That role has no table grant. It can
   call only metadata functions, and those return a whitelist of keys (AT5).
4. **Host.** `CONSOLE_HOST` is set in Vercel only after PR 4 (the API) is merged and the account is bootstrapped and enrolled (§6).
5. **Four PRs.** PR 1 does not use SP2 PR 2's code. PR 2 waits for T2.H. PR 3 needs SP2 PR 2 on `main`. PR 4 needs SP2 PR 3 on `main` (§5).

**Scope:** 15 migrations (`20261208100000`–`20261208101200`, all after SP2's `20261207100300`), 13 pgTAP files (**435–447**, after SP2's
434), the console API, one new script, two new workflow jobs, changes to three scripts. No new dependency. No new secret *value*, and one
new secret *name* (`PLATFORM_ADMIN_EMAIL`). No new cron job.

---

## 1. Goal and scope

**Goal:** as #138 §1. The platform admin signs in on the console host with password and code, and sees every venue's metadata, the
platform audit and the notices. Where the account already has an active `admin` row, it opens the venue in the app. No console session
reads tenant business data, and Osteria Dei Rossi notices nothing.

**In scope:** #138 §1 "In scope", minus what is already on `main` (§2).

**Out of scope:** as #138 §1. SP4: attach and detach, "Solo DigiAlto", `platform_access_event`, the issuer "Costì" for tenant `admin` rows,
`migrate-legacy`, FD35. Also out: SP5–SP7, SP10 and SP11, any write to organisation data (V12), and a console reset button (V4). SP3
changes nothing in `src/server/staff-auth/**`, `public/sw.js`, `app.tenant_id()`, `app.role()`, `app.app_user_id()`,
`app.membership_ungated()`, `app.mfa_needs_aal2` or `public.mfa_reset_service_begin`.

---

## 2. Audit of the earlier SP3 work (checked 2026-11-27)

| Item | State | What it gives SP3 now | Action |
|---|---|---|---|
| **#140** `feat/sp3-main-first` | **merged** (`048c7bc3`); branch 0 commits ahead of `main` | steps **6** (`platform-ops.yml` with jobs `mfa-reset`, `set-mfa-enforcement`, `create-tenant`; `tests/config/platform-ops-workflow.test.ts`; `mfa-reset` confirmation), **20** (`386_sp3_realtime_publication.test.sql`, `tests/guards/console-no-realtime.test.ts`), **21** (`console-band.tsx`), **21a** (`src/lib/platform/codes.ts`, `api.ts`), `tests/config/sp3-preserves.test.ts` | nothing; the branch can be deleted |
| **#155** `feat/sp3-console-host` | **merged** (`6df52644`); 0 ahead | step **16**: `src/proxy.ts` host rules and rewrite, `src/lib/platform/host.ts`, `CONSOLE_HOST`/`APP_ORIGIN` in `src/lib/env/index.ts`, `tests/proxy-console-host.test.ts`, `tests/lib/env/console-env.test.ts` | nothing; delete the branch |
| **#142** `feat/ux-sp3-console` | **merged** (`3c881c55`); 0 ahead | step **18**: every console page under `src/app/(platform)/console/**`, `src/components/console/**`, `src/lib/console/**`, the `challenge-form.tsx` account fallback (`ACCOUNT_PATH = "/api/auth/mfa/account"`), `tests/components/console/**`, `tests/config/console-pages-dynamic.test.ts` | nothing; the screens call routes PR 1 and PR 4 build |
| `docs/plans/2026-11-15-ux-sp3-console*.md` | on `main` | builder 2's plan and hand-off for step 18 | kept as the screen record; no change |
| **#150** `feat/sp3-console` (draft) | open; base `feat/sp2-memberships` (#131's dead branch); 262 commits behind `main` | steps **1, 2, 3, 4, 5** (+ the `100450` follow-up), **7, 9** (+ the `100550` follow-up): 8 migrations `20261208100000`–`100550`, pgTAP **374–379**, `scripts/platform-admin.ts`, `scripts/lib/platform-admin.ts`, `scripts/lib/platform-audit.ts`, `scripts/test-db-races.sh`, the account MFA routes and `src/server/auth/account-mfa.ts`, the `bootstrap` job, their tests | **reuse by cherry-pick** into PR 1 (only its SP3 commits, never its SP2 merges or SP2 files, which are on `main` or in #217); pgTAP renumbered **374–379 → 435–440**; every pin re-taken from a native build, never #150's values. **Close #150 as superseded** when PR 1 opens |
| **#138** `docs/sp3-console-plan` (draft) | open; the design | the design this file builds on | **close as superseded** by this file's PR. Q-R1 asks whether its file should land on `main` as the reference |
| `feat/sp2-memberships`, #131 | SP2's old branch | nothing for SP3 | the lead's call (SP2) |

Steps of #138 **not built anywhere:** 10, 11, 12, 13, 14, 15, 17, 19, 22, 23, 24, 25.

**What changed on `main` since #138 that matters:**
- SP2 PR 1 (#216) created `platform` and `platform.organisation` with its tenant-side drift guard. Step 1's organisation-side guard is still
  needed: nothing on `main` stops a VAT change on the organisation row.
- pgTAP 374–429 are taken, so SP3 uses **435–447**. Migration `20261208*` is free (newest on `main`: `20261207100000`; #217 adds
  `…100100`–`…100300`).
- #217's hook: strip, the PIN branch word for word (`tests/config/sp2-hook-pin-branch.test.ts`), and E1–E4. Step 14 inserts the console
  branch between the PIN branch and E1.
- #217 pins: `341` `exempt_session` = `select_tenant`, `my_memberships`; 346's public left-out list; `m25*` `LAST_MIGRATION =
  20261207100300_session_tenant_purge.sql`; `sp2-preserves` bans `platform_staff` in `20261207*` files only.
- The screens already exist. PR 4's routes must answer exactly the shapes of `src/lib/platform/api.ts` (#138 §3.4 FINAL), and the screens
  must not change.

---

## 3. Design

**Unchanged from #138 §3.1–§3.13.** Read it at `docs/sp3-console-plan` `210258a1`. Only these points are updated:

- **3.2 Hook (step 14):** the base is #217's hook, not M11's. Order: strip → PIN (verbatim) → **console** (own exception block; a
  `console_session` row for the token's `session_id` with `auth_id = user_id`, and an active `platform_admin` → `role = platform_staff`,
  no tenant claim) → SP2's E1–E4 (an incoming `role = platform_staff` is reset to `authenticated`). The equality tests cover two sources:
  the PIN block (SP2's test) and the E-blocks (a new `tests/config/sp3-hook-branches.test.ts` against #217's text).
- **3.3.2:** `select_tenant` is re-created from #217's body with one added first statement: delete the session's `console_session` row.
  #217's 432 must pass unchanged.
- **3.3.5:** `my_memberships` is re-created from #217's body. The caller is the active platform admin, or holds an active `admin` row, at
  `aal1` → P0001 `mfa_required`. #217's 432 must pass unchanged, and 341's `exempt_session` stays exactly two, with neither function
  reading `membership_ungated`.
  **Lead decision 2026-11-28 (option A):** the two sentences conflicted (432's login holds an `admin` row in B and lists at `aal1`). Only the
  active platform admin gets `mfa_required` at `aal1`; a legacy `admin` row lists as before, and 432 stays unchanged. Why: venue routes already
  gate `admin` at `aal2` through the MFA gate, and the list is not sensitive.
- **3.5 Host:** built (#155). `CONSOLE_HOST` unset (or blank) means no console anywhere.
- **3.11 Pins:** replaced by §4 below.
- **3.12 Gating:** replaced by §5 below.
- **3.13 `platform-ops`:** the three jobs are on `main`. PR 1 adds `bootstrap`, PR 2 adds `notice-add`. FS-1 is still not done (§6).

---

## 4. Re-pin table (each with a "re-pinned on purpose by SP3 (step N; was …)" comment, each listed in its PR body)

Values are taken from a native build on the PR's base (`main` with #217, and #218 where stated). #150's and #138's values are never
copied.

| File | Kind | Change | PR / step |
|---|---|---|---|
| `tests/config/m25-preserves.test.ts` `LAST_MIGRATION`; `m25a-preserves.test.ts`; `ux-quick-wins-preserves.test.ts` `NEWEST_MIGRATION` | newest migration | `20261207100300_session_tenant_purge.sql` → each SP3 file in turn; last `20261208101200_console_session_purge.sql` | every migration step |
| `tests/config/m25b-preserves.test.ts` `ALLOWED_NEW_MIGRATIONS` | allowlist | append each SP3 file | same |
| `tests/config/sp3-preserves.test.ts` | SP3 guards (on `main`) | add: the `20261208*` files are exactly the steps built so far and sort after `20261207100300`; `platform.audit_actions()` and the notice kinds equal `codes.ts`; the #138 §5 "never re-create" list (plus `public.mfa_reset_service_begin`); no `drop … cascade`; no new name matching `cost\|margin\|price\|service` | 1/2, then each step |
| `tests/config/sp00-scratch-isolated.test.ts` | `platform_staff` banned under `supabase/` | allowed only in `supabase/migrations/2026120810*`, `supabase/tests/database/4[34][0-9]_sp3_*` and 359 (#150 used `3[7-8][0-9]`); `sp0_`/`sp0.` still banned everywhere | 1/3 |
| `supabase/tests/database/365_p27_roles_preserves.test.sql` trigger count | `public`+`app` triggers | #217's value **+1** (`app_user_platform_staff_guard`); `platform` triggers are not counted (Q-P2) | 1/3 |
| `359_p22_preserves.test.sql` `p27_objs` | additions | the trigger `app_user.app_user_platform_staff_guard`; `app` fns `app_user_platform_staff_guard`, `require_console`; the public fns of steps 4, 5, 9, 11–13, 15 (#138 §3.11 row, plus `platform_mfa_enrol_check`) | 1, 2, 3 |
| `346_p21_preserves.test.sql` hook md5 | md5 | #217's value → SP3's | 3/14 |
| same, public left-out list and count | catalogue | add the SP3 public names; `select_tenant`, `my_memberships`, `mfa_enrol_check` keep their signatures | 1, 2, 3 |
| `229_m19b_preserves.test.sql` public name hash | hash | add the SP3 public names to the exclusion list | 1, 2, 3 |
| `327_p20b_preserves.test.sql` public catalogue md5 | md5 | each new public fn joins the exclusion list; `sp3-preserves` checks each one is pinned by an SP3 pgTAP file | 1, 2, 3 |
| `341_mfa_gate_coverage.test.sql` | exempt lists | new `exempt_platform`: the four `platform_mfa_*` fns (step 9) → five with `select_console()` (step 13); scan 1 excludes it; a test pins the count and checks that none reads `membership_ungated`. `exempt_session` (two, from #217) and `exempt_auth` **not moved** | 1/9, 3/13 |
| `tests/guards/waiter-weight-no-cost.test.ts` route list | cost guard | the three `/api/auth/mfa/account*` routes; every `/api/platform/*` route | 1/9, 4/17 |
| `tests/config/platform-ops-workflow.test.ts` | workflow allowlist | the `operation` choice gains `bootstrap` (PR 1) and `notice-add` (PR 2); the secret names add `PLATFORM_ADMIN_EMAIL` | 1/7, 2/12 |
| `tests/config/env-example.test.ts`, `tests/lib/env.test.ts` | fakes | accept `PLATFORM_ADMIN_EMAIL=platform-admin@example.test` | 1/7 |
| `docs/go-live/rate-limits.md` (`rate-limits-doc.test.ts`) | doc rows | the three account MFA routes | 1/9 |
| `docs/runbook.md` (`runbook.test.ts`) | secrets table | `PLATFORM_ADMIN_EMAIL` (PR 1); the console and `platform-ops` sections (PR 4) | 1/7, 4/24 |
| `436` named catalogue (new) | `platform` tables | `organisation`, `staff`, `audit_event`, `auth_lock`, `mfa_failure`, then `notice`, `console_session` as they land | 1, 2, 3 |

**Must pass unchanged:** pgTAP 001, 002, 003, 005, 085, 086, 088, 101, 340, 342, 343, 349, 386, 389, 390, 417, 418, 430–434 (SP2);
`tests/config/sp2-preserves.test.ts`, `sp2-hook-pin-branch.test.ts`, `console-pages-dynamic.test.ts`, `tests/proxy-console-host.test.ts`,
`tests/guards/console-no-realtime.test.ts`, `tests/guards/admin-client-importers.test.ts`, `tests/lint/admin-client-import.test.ts` (AT10),
`offline-cache-allowlist`, the `NAV_MODEL_MD5` pins, `tests/components/console/**`. **Any other failing pin is a stop: report it to the
lead, do not re-pin it.** A pin found outside this table goes into the PR body and §9.

---

## 5. Build plan and PR split

**Rules:** as #138 §5 (test first; one commit per step; each step runs its targeted suites, and CI runs the rest). Every SECURITY
DEFINER function sets `search_path = ''` and checks its caller first. Nothing is granted to `anon`. Fixtures use `example.test` only.

| PR | Branch | Steps | Migrations | pgTAP | Depends on | Merge gate |
|---|---|---|---|---|---|---|
| **1** | `feat/sp03-platform-1` | 1 VAT guard · 2 staff + audit · 3 staff/member guards · 4 `platform_bootstrap_admin` · 5 script audit (+ tenant of `script.mfa_reset`) · 7 `scripts/platform-admin.ts bootstrap` + job · 9 account second factor (+ `platform_mfa_enrol_check`) | `20261208100000_organisation_vat_guard`, `100100_platform_staff_audit`, `100200_platform_staff_guards`, `100300_platform_bootstrap`, `100400_platform_script_audit`, `100450_script_audit_mfa_reset_tenant`, `100500_platform_mfa`, `100550_platform_mfa_enrol_check` | 435 VAT guard, 436 catalogue, 437 guards, 438 bootstrap, 439 script audit, 440 platform MFA | **no SP2 PR 2 code.** Cut from `main` **after #217 merges** (Q-R2) so 365/359/341/346/229/327 move once, on top of SP2's values | T4.H (isolation, every merge) |
| **2** | `feat/sp03-platform-2` | 10 `platform_staff` role + `app.require_console` · 11 metadata reads + whitelist · 12 notices, `platform_me`, `notice-add` job | `100600_platform_staff_role`, `100700_platform_metadata`, `100800_platform_notices` | 441 role, 442 metadata, 443 notices | PR 1 | **T2.H** (fail → V2, #138 §5b) |
| **3** | `feat/sp03-platform-3` | 13 console mode switches (+ `select_tenant` re-created) · 14 the hook's console mode · 15 `my_memberships` at `aal2` for `admin` · 22 purge of console rows and staff MFA failures | `100900_console_session`, `101000_hook_console_mode`, `101100_my_memberships_aal2`, `101200_console_session_purge` | 444 console session, 445 hook, 446 my_memberships, 447 purge | PR 2; **SP2 PR 2 (#217) on `main`** (its hook, `session_tenant`, `select_tenant`, `my_memberships`, the purge job) | T1.H, T3.H (already #217's gates); hook change goes to staging first (#138 R1) |
| **4** | `feat/sp03-platform-4` | 17 platform API (`src/server/platform/*`, `src/app/api/platform/**`, `withApi` platform access, new error codes) · 19 enter a venue and come back · 23 integration + Playwright · 24 runbook, FS steps; ADR-037 note (lead) · 25 hand-off | none | none | PR 3; **SP2 PR 3 (#218) on `main`** (the chooser takes the `locale` highlight) | T3.H; code review of `withApi` line by line (Q-R4) |

**Notes per step, against #138's step table (§5 there; tests unchanged unless said):**
- **1–5, 7, 9:** cherry-pick #150's SP3 commits in order, renumber the pgTAP files, and re-take the pins. #150's later fixes come along:
  the lock row `platform.auth_lock` for guard serialisation, the race harness `scripts/test-db-races.sh`, uppercase-id refusals in the MFA
  scripts, and the fixed-code output of a throwing bootstrap. Step 3 is new against `main`: it runs together with #217's
  `app_user_pin_single_membership` and `app_user_insert`. 437 adds one case: a PIN login cannot become a platform-staff member either,
  and #217's 431 stays green.
- **7:** the `bootstrap` job reads `PLATFORM_ADMIN_EMAIL` only through `secrets.*`, and its input is `auth_id` (an optional uuid). The
  script prints `{authId, hasVerifiedFactor}`. The captured stdout, stderr and errors contain no `@` (AT11 script half).
- **9:** the console's `/login/codice` and `/login/attiva-codice`, and the venue app's `challenge-form.tsx` fallback, already call these
  routes (#142). The route tests use the request and reply fixtures in `tests/components/console/console-fixtures.ts`, so screens and routes
  cannot drift.
- **14:** one commit in its own PR (PR 3), staging first. 003, 085, 340 and #217's 431 pass unchanged in the same commit.
- **17:** every reply is parsed with `src/lib/platform/api.ts`. A `platform_staff` token on any tenant route → 403 `console_session`
  before any RPC. No file under `src/server/platform/` imports the admin client (AT10).
- **19:** "Entra nel locale" is enabled only when `digialtoAttached`. `?locale=` only highlights a venue in #218's chooser and never switches
  on load. "Torna alla console" shows for `admin`, and only when `CONSOLE_HOST` is set.

**Acceptance tests → PR:** AT2, AT7, AT8 (scripts), AT11 → PR 1; AT1 (role), AT3, AT4, AT5, AT8 (console writes), AT9 → PR 2; AT1 (hook),
AT12 → PR 3; AT6 (end to end), AT10, and the full flow → PR 4. AT6's proxy half is already on `main` (#155).

**Order that keeps tenant #1 working:** PR 1 and PR 2 are additive (no venue path reaches them). PR 3 changes the hook only for sessions
with a console row, and `my_memberships` only for `admin` holders. PR 4 is inert while `CONSOLE_HOST` is unset.

---

## 6. FD28, FD31, the console host and `platform-ops`

- **FD28 (one platform admin; the address never in the repo).** Enforced by: the partial unique index `staff_one_active_admin`; bootstrap's
  `platform_admin_exists`; the guards of step 3; `PLATFORM_ADMIN_EMAIL` only as a `platform-ops` environment secret, never an input;
  `.env.example` holds only `platform-admin@example.test`; the `audit_detail_ok` CHECK refuses `@`; and every script test scans its
  captured output for `@`. The account must not be the owner's login at tenant #1 (platform plan §0a note 2, enforced by
  `platform_admin_has_member_role`). Which auth user it is: F-2.
- **FD31 (aal2 everywhere for admin).** Already on `main` for tenant mode (`admin_mfa_always`). SP3 adds:
  - `app.require_console()`: active `platform_admin`, a verified factor (`mfa_factor_required`) and `aal2` (`mfa_required`), first in every
    console function;
  - `select_console()`, with the same three checks;
  - the account-level second factor (step 9), so the account can reach `aal2` with no tenant;
  - `my_memberships` at `aal2` for `admin` holders (step 15).

  A staff row with no factor grants nothing (#138 Q-P5, R14).
- **Console host.** `CONSOLE_HOST` is read by `src/lib/platform/host.ts` and `src/proxy.ts` (#155). Unset means no console. The lead
  reports that `console.digialto.com` is already a verified Vercel domain and that the variable is unset. **It is set only after PR 4 is
  merged**, the account is bootstrapped and its factor is enrolled. Before that, the screens would call routes that do not exist.
  `APP_ORIGIN` (the venue app's origin, for "Entra nel locale") is set at the same time: F-3.
- **`platform-ops`.** The workflow is on `main` with three jobs, and the GitHub environment **does not exist yet**. A job that names an
  environment the repository lacks makes GitHub create it **without protection** when the job runs (#138 §9a FS-1). So **nobody dispatches
  `platform-ops` until the founder has done FS-1**: required reviewer = the founder's GitHub account; branches = `main`; secrets
  `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, then `PLATFORM_ADMIN_EMAIL` before the first `bootstrap`. FS-1's text
  is #138 §9a, unchanged. **Nobody dispatches `platform-ops` before the lead confirms FS-1 is done** (lead, 2026-11-27). No new workflow
  logic for this (Q-R3 decided); the runbook carries the warning (PR 1, with the `PLATFORM_ADMIN_EMAIL` row).
- **Bootstrap order (runbook, PR 4):** FS-1 → PR 1 merged → dispatch `bootstrap` (founder approves) → after PR 4 and `CONSOLE_HOST`: the
  first console sign-in → `/login/attiva-codice` → enrol → console.

---

## 7. Risks

#138 §6 R1–R18 still apply. Updates:
- **R15 (stacking):** no stacking on dead branches any more. PR 1 starts from `main` after #217, and PR 3 and PR 4 wait for #217 and #218.
- **R19 (new): an unprotected `platform-ops` environment.** A dispatch before FS-1 creates it open (§6). Mitigation: Q-R3, and the lead
  tells the team not to dispatch.
- **R20 (new): screens on `main` against routes that do not exist.** They are inert while `CONSOLE_HOST` is unset. The challenge-form
  fallback answers 404 until PR 1, and only after a 403 `no_tenant` or a 409, which no venue user gets today.

**Dependencies:** none added. **Secrets:** `PLATFORM_ADMIN_EMAIL` (private, not a key) as a `platform-ops` secret. No secret value is
written in any file or chat.

---

## 8. Questions

**For the lead:**
- **Q-R1.** Should #138's file land on `main` as the design reference (one copy, marked "superseded for numbering by 2026-11-27"), or stay
  on the closed PR, as SP2 cites #131? Recommendation: copy it into PR 1, so the design is in the repo that builds it.
- **Q-R2.** PR 1 needs no #217 code. Build it now and rebase it after #217, or start it after #217 merges? Recommendation: start after #217,
  as the brief says, so the pins move once.
- **Q-R3.** Add a guard step to every `platform-ops` job that fails if the environment has no required reviewer (via the API at run
  start), or rely on FS-1 coming first? Recommendation: FS-1 first and a runbook warning. A guard would need a token with admin read.
- **Q-R4.** Should the lead read `withApi`'s platform branch (PR 4) line by line, as for `src/proxy.ts`? Recommendation: yes.
- **Q-R5.** Close #138 and #150 as superseded when this PR and PR 1 open (not by me).

### 8a. Decided by the lead (2026-11-27)

| ID | Decision |
|---|---|
| Plan | **Approved**, with the PR split and the order after #217/#218 |
| Q-R1 | **Yes:** PR 1's first commit copies `docs/plans/2026-11-15-sp3-console.md` from `docs/sp3-console-plan` (`210258a1`) to `main` unchanged, with one line under its title: "Design reference. Numbering, pins, gates and PR split superseded by `2026-11-27-sp03-platform-layer.md`." |
| Q-R2 | PR 1 starts after #217 merges (the brief) |
| Q-R3 | **FS-1 plus a runbook warning**; no new workflow logic now. Nobody dispatches `platform-ops` before the lead confirms FS-1 |
| Q-R4 | **Yes:** the lead reads `withApi`'s platform branch line by line in PR 4 |
| Q-R5 | The lead closes #138 and #150 as superseded |
| F-1, F-3 | Taken to the founder by the lead. FS-1 is planned from a PC on 2026-11-28 (required reviewer, `main` only) |
| T2 gate (PR 2, PR 3) | **Decided 2026-11-27:** the hosted T2 check cannot run from a cloud session (#220). PR 2 and PR 3 merge on the local T2.L evidence (pgTAP 441–443 as `platform_staff`) plus CI. T2 is verified on the live project after PR 4 is merged: the founder signs in to the console on `console.digialto.com`, and the lead checks that the console reads work under the `platform_staff` role and that tenant sessions are unchanged. Tenant sign-in stays byte-for-byte unchanged for every non-console session, and a test pins it |

**For the founder (via the lead):**
- **F-1.** FS-1: create the `platform-ops` environment **before anyone dispatches the workflow** (#138 §9a).
- **F-2.** Which auth user becomes the platform admin account: a fresh login, not the owner's login at tenant #1.
- **F-3.** Agree that `CONSOLE_HOST` and `APP_ORIGIN` are set in Vercel only after PR 4 is merged and the account is enrolled.
- **F-4, F-5:** #138's F-4 (how long the platform audit is kept) and F-5 (a second factor beyond TOTP) stay open.

---

## 9. Hand-off log and build notes

(Filled by the builder per PR: pins moved with old and new values, any pin outside §4, the CI result, the review verdict.)

**PR 1 (#221, `feat/sp03-platform-1`).**
- **Built:** steps 1–5, 7 and 9, cherry-picked from #150 and renumbered to pgTAP 435–440. Plus the lead's `scripts/add-owner.ts`, with the new audit code `script.add_owner`.
- **Pins moved:**
  - newest migration (m25, m25a, ux-quick-wins): `20261207100300` → `20261208100550`;
  - m25b: the eight SP3 files;
  - 365 triggers: 136 → 137;
  - 359: an SP3 `p27_objs` block;
  - 229, 327 and 346: the SP3 public fns are left out, one per line;
  - 341: `exempt_platform` = 4, plan 49 → 51;
  - sp00: `4[34][0-9]_sp3_*`, 359 and `2026120810*` may name the role;
  - platform-ops-workflow: `bootstrap`, `package-manager-cache` 3 → 4;
  - the cost guard: the account routes;
  - env tests: accept the fake;
  - rate-limits: 440.
- **Outside §4:**
  - `workflow-actions-pinned` (the bootstrap job holds the secret key);
  - the "ten codes" pins (codes, audit-view, registro), moved to eleven. The lead approved this on 2026-11-27, option A.
- **Changes against #150:**
  - no `api.ts` export;
  - the staff/member guards pass a null `auth_id` through, so pgTAP 390 still sees RLS's 42501;
  - a PIN-login case in 437;
  - the create-tenant audit row on both owner paths.
- **Not done here:** the `.env.example` fake line. This session's permissions deny the file; the lead will have it added.
- **Verification:** local pgTAP ran natively on Postgres 16 (Supabase images unreachable from the session), and so did the race script. CI is the gate.
- **Review:** `code-reviewer` PASS, notes only:
  - add-owner's "member nowhere" check is not atomic with the insert (operator script; an RPC under the `auth_lock` row would close it);
  - a reused login's confirmation is not checked;
  - a `platform_support` enrolment is logged as `platform_admin.factor_enrolled`.

**PR 2 (#223, `feat/sp03-platform-2`).**
- **Built:** steps 10–12: migrations `20261208100600_platform_staff_role`, `100700_platform_metadata`, `100800_platform_notices`; pgTAP 441–443;
  `platform-admin.ts notice-add`; the `platform-ops` job `notice-add`. 441 also pins the hook's claims for every non-console session (lead, 2026-11-27).
- **Pins moved:** newest migration `100550` → `100800` (m25, m25a, ux-quick-wins; m25b +3 files); 359 `app.require_console` + 8 public fns; 229, 327, 346
  (both lists) the 8 public fns left out; 436 `platform_staff` in its role lists, `notice` in the catalogue and the no-policy check; `sp3-preserves`
  steps 10–12; `platform-ops-workflow` (`notice-add`, `read_int`, a hyphen in a script command, counts 5→6 jobs, 4→5, 8→10, 4→5).
- **Outside §4:** `workflow-actions-pinned` (the `notice-add` job), as §11a foresaw.
- **Changes against #138:** `platform_open_tenant` writes `console.tenant_opened` only when DigiAlto is attached (#138 §3.3.3 says it always writes;
  the console refuses with 409 otherwise, so nothing was opened); `platform.notice` has no `created_by` (the actor is in `notice.created`);
  `platform_add_notice` checks `auth.jwt() ->> 'role' = 'service_role'` first: **add it to the live T2 check after PR 4**.
- **Verification:** native Postgres 16, all 339 pgTAP files; vitest config, guards, lint, scripts. CI is the gate.
- **Review:** `code-reviewer` one round: FAIL on one missing test (Rome day bounds of `platform_audit`), fixed with rows on both sides of a Rome
  midnight in CET and CEST; the existing-role guard also refuses grants to roles other than `authenticator` and role settings. Concurrency of
  `platform_notice_mark` reasoned (advisory lock, READ COMMITTED), not testable in pgTAP.

## 10. Sources

Repository only: `main` `c78de05e`; branches `feat/sp02-memberships-2` (`676ab591`), `feat/sp02-memberships-3` (`e5c7e051`),
`feat/sp3-console` (`4c9e79d3`), `docs/sp3-console-plan` (`210258a1`); PRs #138, #140, #142, #150, #155, #217, #218. The console host's
Vercel status is the lead's report of 2026-11-27, not checked here.

---

## 11. Builder hand-off (read first)

You start from this file, after #217 is merged (Monday 2026-11-30 at the earliest). Do not start PR 3 before #217 is on `main`, or PR 4
before #218.

1. **Base check.** `git fetch`; branch `feat/sp03-platform-1` from `main`. Confirm: the newest migration is `20261207100300_session_tenant_purge.sql`;
   the newest pgTAP is 434; no `20261208*` file and no `43[5-9]_`/`44[0-7]_` pgTAP exists; `LAST_MIGRATION` in `m25-preserves` names
   `100300`. If any of these differs, stop and tell the lead.
2. **First commit (Q-R1):** copy the design file (§8a), docs only.
3. **Cherry-pick from #150** (`origin/feat/sp3-console`, head `4c9e79d3`). Take **only** the commits whose message says "SP3 step"; skip
   the merges (`4c9e79d3`, `23475ce2`, `ca51ad3a` and the others) and every SP2 file (`20261207100000_organisation.sql`, `369_sp2_*`,
   `src/lib/tenancy/**`, `use-tenant-switch-listener.ts`, `sp2-preserves`, `sp00-memberships-shape`); those are on `main` or in #217.
   List them with `git log --reverse --no-merges --format='%h %s' $(git merge-base origin/main origin/feat/sp3-console)..origin/feat/sp3-console | grep 'SP3 step'`
   (fetch with `--deepen` first: the clone is shallow). On a conflict, re-apply by hand on today's file.
4. **Renumber:** `374_sp3_organisation_vat_guard` → 435, `375_sp3_platform_catalogue` → 436, `376_sp3_staff_member_guards` → 437,
   `377_sp3_bootstrap` → 438, `378_sp3_script_audit` → 439, `379_sp3_platform_mfa` → 440. Update every reference (`sp00-scratch-isolated`
   pattern `4[34][0-9]_sp3_*`, comments, `sp3-preserves`). The migration names stay as #150 has them.
5. **Pins:** never copy #150's values. Run the suites, read each failure, and re-pin only rows of §4 with the comment form
   "re-pinned on purpose by SP3 (step N; was …)". Anything else red: stop and report.
6. **#150's diff also touches** `platform-ops.yml` (the `bootstrap` job), `.env.example`, `docs/runbook.md`, `docs/go-live/rate-limits.md`,
   `scripts/lib/create-tenant.ts`, `scripts/lib/mfa-admin.ts`, `src/server/auth/mfa.ts`, `src/app/api/me/mfa/**`, `src/lib/platform/api.ts`
   (4 lines) and `src/components/me-problem.tsx`. `main` changed most of these since (#140, #142, SP1, SP2); compare each hunk with `main`
   before keeping it. `src/lib/platform/api.ts` and the console screens are the contract (#138 §3.4): a change to them needs the lead.
7. **Workflow file:** every change to `.github/workflows/platform-ops.yml` is read line by line by the lead. Never dispatch the workflow
   (§6).
8. **The account MFA routes** must answer the shapes the screens on `main` already expect (`src/lib/console/account-mfa.ts`,
   `tests/components/console/console-fixtures.ts`). Read those first.
9. **Never** write an e-mail address other than `@example.test` fakes, and never print one in a script or a test log.
10. **Per PR:** draft PR from `feat/sp03-platform-<n>`; body: what changed, the SP0 verdicts relied on, the pins moved (old → new), open
    questions; one `code-reviewer` round; fill §9 here in the same PR.


### 11a. Hand-off for PR 2–4 (PR 1 builder, 2026-11-27, after #221 merged as `6c7b8706`)

- **State on `main`:** steps 1–5, 7 and 9, migrations `20261208100000`–`100550`, pgTAP 435–440, and `scripts/add-owner.ts` (audit code
  `script.add_owner`; there are now **eleven** audit codes). The newest-migration pins name `20261208100550_platform_mfa_enrol_check.sql`. In 229,
  327, 346 and 359, SP3 has its own lines and insert block: follow those formats (one name per line with "SP3 step N: re-pinned on purpose by
  SP3"). `sp3-preserves` `STEPS` and its pgTAP pattern `4[34][0-9]_sp3_` are ready for 441–447.
- **Next migration:** `20261208100600_platform_staff_role`. PR 2 is gated on **T2.H** (the lead decides how T2 is verified). Build and review it on
  the local T2.L evidence, mark it ready, and stop before it merges. PR 3 needs only #217, which is on `main`. PR 4 needs #218, also on `main`.
- **Local database:** Supabase images could not be pulled from a cloud session (registry data limit, Docker Hub 429, blob hosts not allowed).
  What works:
  1. `apt-get install -y postgresql-16-pgtap libtap-parser-sourcehandler-pgtap-perl`, then `pg_ctlcluster 16 main start`;
  2. set the `postgres` password to `postgres`;
  3. run `PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres scripts/test-db-native.sh` (about 100 s, all 336 files), and
     `scripts/test-db-races.sh` with the same variables.

  CI's `supabase test db` remains the gate.
- **Traps found in PR 1:**
  - A BEFORE trigger on `public.app_user` runs before RLS: anything that can fail inside it changes pgTAP 390's 42501. The staff guard
    therefore returns early on a null `auth_id`.
  - `sp00-scratch-isolated` bans the word `platform_staff` in every file outside the allowed paths, comments included (365's comment had to
    avoid it).
  - #150's `platform-ops-workflow.test.ts` hunks predate #144 (every job now sets `package-manager-cache: false`).
  - `tests/config/workflow-actions-pinned.test.ts` lists every secret-holding job, so PR 2's `notice-add` job adds a row there (outside §4;
    list it).
  - A new audit or notice code moves the console's "N codes" pins (`codes.test.ts`, `audit-view.test.ts`, `registro.test.ts`); ask the lead
    first.
  - `.env.example` is denied to this session's tools; the fake `PLATFORM_ADMIN_EMAIL` line is still to be added (lead).
- **Open review notes on add-owner (not defects; the lead's call):**
  - the "member nowhere" check is not atomic with the insert (an RPC under the `platform.auth_lock` row would close it);
  - a reused login's confirmed or banned state is not checked;
  - the script prints prefixes without `createIdDisplay` (it is not a workflow job).

  On step 9: a `platform_support` enrolment is logged as `platform_admin.factor_enrolled`.
- **Unchanged rules:** nobody dispatches `platform-ops` (FS-1 first); `CONSOLE_HOST` stays unset until PR 4 is merged and the account is enrolled; no
  real address anywhere.
