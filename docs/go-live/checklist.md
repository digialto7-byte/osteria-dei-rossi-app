# Go-live checklist (M25 step 20)

Gate 3 is the go-live on 12 January. Each row has an owner (`founder`, `DigiAlto` or `client`), a status (`open`, `done`, or `optional`) and
an evidence cell that starts with `done:` (what proves it) or `to fill:` (what to paste when it is done). **Never paste a secret, a key or a
header value here**: run links, minutes, file names and counts only.

Where this file and the runbook (`docs/runbook.md`) differ on a procedure, the runbook wins.

Production is on the Supabase **Free** plan, so there are no Supabase-side backups and no point-in-time recovery: our own daily dump is the
only backup of the database, and the recovery point is the last dump (up to about a day). The invoice files of the private bucket are in
the same encrypted daily backup (ADR-034, `feat/backup-invoice-files`).

## The five acceptance tests of M25

| ID | Item | Owner | Status | Evidence |
|---|---|---|---|---|
| AT1 | A full service is simulated end to end: invoices approved, batches produced, 6 tables by 2 waiters with one offline, closes (one without a receipt), day close split in Pranzo and Cena, KPIs, app vs register, ledgers clean, no CSP violation | DigiAlto | done | done: CI run 42510283848 on `d458c50` (PR #44), `npx playwright test --project service-sim` green in 47.1 s (S); shard 1 of that run took 16.4 min in all |
| AT2 | The header check passes on a live preview and on production: `npx tsx scripts/check-headers.ts --base-url <address> --expect preview` and `--expect production` (nonce policy on pages, none on non-pages, HSTS on production, nosniff, Referrer-Policy, frame-ancestors) | founder | open | to fill: the JSON line of each run (header names and findings only), with `findings` empty |
| AT3 | `npm audit` is clean or each advisory is explained: `npx tsx scripts/audit-check.ts` in the `checks` job | DigiAlto | done | done: `scripts/audit-check.ts` ran clean on the branch (no unexcepted high or critical advisory); exceptions are in `docs/go-live/audit-exceptions.json` |
| AT4 | An encrypted dump is made and a restore passes the ledger check: the self-test on the PR, then the first real runs of "Daily backup" and "Weekly restore check". The invoice files are included (founder 2026-11-08, ADR-034): the self-test packs them twice and checks every pack (AT-F1), the staging runs show a pack and a manifest in Drive and a weekly check with files checked (AT-F2), the production runs follow once production holds invoices (AT-F3), and one pack and one manifest are decrypted by hand (AT-F4) | founder | open | to fill: run links of the self-test, of the staging runs and of the first production runs, with minutes (D, W) |
| AT5 | The security checklist is walked, every "no" fixed or accepted | DigiAlto | done | done: `docs/go-live/security-walk.md` (every item of the skill; the "no" lines are accepted risks) |

## The four criteria of Gate 3

| ID | Item | Owner | Status | Evidence |
|---|---|---|---|---|
| G3-1 | A full service entered by waiters on their own phones, with the venue's staff, on real data | client | open | to fill: date of the service and who ran it |
| G3-2 | The end-of-day variance between the app and the register is under 5% (read on `/chiusura`) | client | open | to fill: the day, the app total, the register total and the difference as shown by the app |
| G3-3 | The three PRD acceptance checklists (Modules 1 to 3) pass on real data | client | open | to fill: the signed checklists |
| G3-4 | The manual check: a 4-cover, 3-course table is entered by a waiter in under 90 s after one training session | client | open | to fill: the waiter, the time taken and the date |

## Manual steps of the founder (plan section 8)

| ID | Item | Owner | Status | Evidence |
|---|---|---|---|---|
| S8-1 | The production Supabase project "Osteria Dei Rossi - Production" exists in `eu-central-1` on the Free plan; the database password is in the password manager | founder | open | to fill: the project reference (not a key), and the date |
| S8-2 | The GitHub environment `production` exists: the founder is the required reviewer, branches `main`; secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`; variable `PRODUCTION_PROJECT_REF`. "Deploy production database" has run on `main` and been approved | founder | open | to fill: the run link |
| S8-3 | A Resend account on the free tier (EU region if offered) exists; its SMTP credentials are only in Supabase production, Authentication, SMTP settings; the sending domain is verified once the domain is decided | founder | open | to fill: date; the sending domain |
| S8-4 | Supabase production settings: sign-ups off, Email on, Access Token hook `app.custom_access_token_hook`, Site URL and redirect URLs set to the production address plus `/api/auth/callback**`, custom SMTP, the hosted Auth rate limits read (they back the accepted risk of walk item 13), and the Vault secrets `app_base_url`, `cron_secret` and, while the address is a protected `*.vercel.app` host, `vercel_protection_bypass` (the same value as `VERCEL_AUTOMATION_BYPASS_SECRET`), on each project | founder | open | to fill: the Auth limits as read from the dashboard; confirmation that the three Vault names exist on staging and production. The accepted risk of walk items 13 and 14 was signed off on 2026-11-08 (RISK-1) |
| S8-5 | Vercel Production environment variables are set, all new and never staging's: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `PIN_PEPPER`, `CRON_SECRET`, `ANTHROPIC_API_KEY`, `EXTRACTION_MODEL_ID`; then redeployed | founder | open | to fill: date of the redeploy |
| S8-6 | Production deployments wait for promotion (Vercel setting); its name is noted in the PR | founder | open | to fill: the setting's name |
| S8-7 | The Protection Bypass for Automation secret exists and is in the password manager; the header check was run on a preview and on production | founder | open | to fill: see AT2 |
| S8-8 | Backups prepared: a Shared Drive folder; a Google Cloud service account that is a Content manager on that Shared Drive, with a JSON key; a passphrase from `openssl rand -base64 48` kept in the password manager; the session-pooler connection strings of staging and production | founder | open | to fill: date; that the service account is a Content manager (not its key) |
| S8-9 | GitHub environment `production-backup` (main only, no required reviewer): secrets `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `BACKUP_ENCRYPTION_PASSPHRASE`, `BACKUP_DRIVE_SA_JSON`, `BACKUP_DRIVE_FOLDER_ID`; variables `PRODUCTION_PROJECT_REF`, `BACKUP_KEEP_COPIES`. **New: add production's `SUPABASE_SECRET_KEY` to `production-backup`** (it was only in Vercel; it reaches the invoice-files step only; a separate key named for the backups if the dashboard allows several, Q-F8). GitHub environment `staging`: the same backup secrets with staging's values (it already has `SUPABASE_SECRET_KEY`), plus `VERCEL_AUTOMATION_BYPASS_SECRET`. Setting `PRODUCTION_PROJECT_REF` arms the backups: while it is empty or unset the daily and weekly jobs skip with a notice and open no issue; once it is set, a missing secret fails the run and opens a `backup-failure` issue every day, so set the seven secrets first or together | founder | open | to fill: date; that the next daily run is green |
| S8-10 | The founder watches the repository's issues (Watch, Custom, Issues) and the label `backup-failure` exists | founder | open | to fill: date |
| S8-11 | First runs: "Daily backup" then "Weekly restore check" on staging, both green with the database copy, an invoice-file pack and a files manifest in Drive and the weekly check showing files checked (AT-F2); the same for production once it holds data (AT-F3); one database copy and one pack decrypted by hand and one PDF opened (AT-F4) | founder | open | to fill: run links, minutes (D, W) and the date of the hand decryption |
| S8-12 | Pause rehearsal on staging (optional, Q196): see FREE-4 | founder | optional | to fill: only if done, see FREE-4 |
| S8-13 | Performance and Hobby usage are measured: see G7-1 to G7-4 and IPHONE-1 | founder | open | to fill: see G7-1 to G7-4 |
| S8-14 | The production tenant is made with `npm run create-tenant` from a trusted machine, with the client facts confirmed in the profile; the staff phones are enrolled | founder | open | to fill: date; the number of phones enrolled |
| S8-15 | Q234 to Q237 are answered | founder | done | done: answered on 2026-11-03, all four defaults stand (plan section 7) |
| S8-16 | `VERCEL_AUTOMATION_BYPASS_SECRET` is in the `staging` environment, before the timing runs; the same value is in Vault as `vercel_protection_bypass` | founder | open | to fill: date |

## Performance and hosting impact of the nonce policy (G7, plan 3.1.14)

| ID | Item | Owner | Status | Evidence |
|---|---|---|---|---|
| G7-1 | Baseline B0: "Order entry timing on staging" and "Dashboard timing on Slow 4G" run on `main` against staging | founder | open | to fill: both summaries (run links) |
| G7-2 | Vercel Usage at B0: the account's own allowances and used amounts for function invocations, Active CPU, provisioned memory, edge requests, ISR reads and writes, fast data transfer | founder | open | to fill: the figures, copied into `docs/go-live/csp-impact.md` |
| G7-3 | After M25 reaches staging (A): both workflows run again; seven days later the Usage figures are copied again | founder | open | to fill: run links, the window of the dashboard run, the Usage figures |
| G7-4 | The verdict of `docs/go-live/csp-impact.md` is not "stop": nothing goes to production while it says stop (stop rule S1 to S4, Q236 at 50%) | founder | open | to fill: Verdict from `docs/go-live/csp-impact.md`, now pending |

## Supabase Free (production)

| ID | Item | Owner | Status | Evidence |
|---|---|---|---|---|
| FREE-1 | A `backup-failure` issue reaches the founder (he is watching issues): proved with the first failing or manual run, then closed | founder | open | to fill: the issue link and the date it arrived |
| FREE-2 | The newest daily copy in Drive is under 36 hours old (the weekly restore check enforces it), and so is the newest files manifest (invoice files, ADR-034) | founder | open | to fill: the dates of both files and the last green "Weekly restore check" |
| FREE-3 | The custom domain is added and serves production (Q188, needed before 12 January); `app_base_url` points at it and `vercel_protection_bypass` is removed from Vault | founder | open | to fill: the domain and the date |
| FREE-4 | Pause rehearsal on staging (optional): pause the project, wait for the `backup-failure` issue, resume as in the runbook, close the issue | founder | optional | to fill: only if done, the date and the time it took |

## Invoice-file backup: founder questions (ADR-034, plan `docs/plans/2026-11-09-backup-invoice-files.md` section 7)

Each has a default in force. "optional" rows need an answer only if you want to change the default.

| ID | Item | Owner | Status | Evidence |
|---|---|---|---|---|
| Q-F1 | Supabase Free lists 1 GB of file storage (Supabase pricing page, read 2026-11-09); a few thousand invoice files of a few MB can pass it, and the bucket refuses files over 4 MiB. Which plan, and when, is yours. Default: no change; the backup works on any plan | founder | open | to fill: the decision and the date; the bucket's size on the Supabase dashboard |
| Q-F2 | Should the weekly check also re-hash its sample against the live bucket? It would put `SUPABASE_SECRET_KEY` into the weekly job and spend Supabase egress each week. Default: no (variant V1) | founder | optional | to fill: only if changed, yes or no and the date |
| Q-F3 | Build a tool that re-uploads the files into a new project, proven in the self-test? Default: no; the runbook has a manual procedure (variant V2) | founder | optional | to fill: only if changed, yes or no and the date |
| Q-F4 | Which Google Workspace account and plan holds the Shared Drive for 10 years and more of invoice files, and who owns it (runbook Q26). Default: the existing backup folder | founder | open | to fill: the account that owns the Shared Drive, and the date; the storage cost is yours to read from Google |
| Q-F5 | Who deletes the packs after the 10-year retention, and how (a pack holds one day's invoices, so deleting one invoice means re-packing)? Default: no code deletes packs; a yearly manual review | founder | open | to fill: the person and the review date |
| Q-F6 | Passphrase rotation: keep every passphrase as long as its packs exist (default), or after each rotation run "Daily backup" with `full_files`, wait for a green weekly check and delete the older packs by hand; but packs older than a `--full` manifest are the only record of objects removed from the bucket, so do not delete them until those objects are no longer needed | founder | open | to fill: the choice, and where the old passphrases are kept |
| Q-F7 | Weekly sample size: 5 packs (the newest plus 4 at random), every file in them checked. Default: 5 | founder | optional | to fill: only if changed, the number |
| Q-F8 | If the Supabase dashboard lets you create more than one secret key (not verified), make one named for the backups so it can be revoked alone and put it in `production-backup`. Default: the project's secret key | founder | open | to fill: whether a separate key was made, and the date (never the key) |

## Other items

| ID | Item | Owner | Status | Evidence |
|---|---|---|---|---|
| IPHONE-1 | On a real iPhone against staging: open the comanda once online, then reload it in flight mode; it still shows the table (WebKit's service worker is not driven by our tests) | founder | open | to fill: the phone model, iOS version and the result |
| DPA-1 | The data processing agreement and the sub-processor list name Supabase, Vercel, GitHub (backups), Google (Drive), Resend and Anthropic; the retention of the 14 daily copies is stated, and that Google (Drive) holds the invoice files (supplier invoices) for the 10-year retention period; and, for the P2-1 second factor, that wrong-code records (account and time only) are deleted after 30 days while enrolment, removal, reset and lock events (app_user.mfa_locked, written once per lock) are kept permanently in the audit log | client | open | to fill: the signed document (project Q13, Q14) |
| RISK-1 | The founder confirms the accepted risks of `docs/go-live/security-walk.md`, including the three marked proposed | founder | done | done: 2026-11-08, the three proposed risks accepted (sign-in throttle, second factor, staff erasure on request); TOTP (admin required, owner optional) is an early Phase 2 item; **change asked and built:** invoice files are backed up before go-live (`feat/backup-invoice-files`, ADR-034; AT4, FREE-2 and S8-11 cover them) |
| HOBBY-1 | The Hobby plan's non-commercial terms and what happens beyond an allowance are checked (project Q9, Q10); no price is estimated here | founder | done | done: 2026-11-08, the founder decided on Vercel Pro for production at go-live; staging may stay on Hobby. Pro lifts the daily-cron and function-timeout limits, but nothing is redesigned around that now |
| GBP-1 | Google booking (founder decision 2026-11-13): the owner adds the public booking address (`<public domain>/prenota/<slug>`) as the "Prenota" (booking) link on the venue's Google Business Profile. No code. Depends on FREE-3 (the custom domain, Q188) | founder | open | to fill: the date and a screenshot of the profile's booking link |

## Phase 2: the second factor (P2-1)

TOTP for the owner and the admin (`docs/plans/2026-11-12-p2-1-totp.md`). These rows are for the Phase 2 rollout, after the screens ship; the full founder steps M-1 to M-7 are in `docs/runbook.md`.

| ID | Item | Owner | Status | Evidence |
|---|---|---|---|---|
| P2-1 | The second factor (TOTP): on a day without service, switch production to required once every admin has a factor: `npx tsx scripts/set-mfa-enforcement.ts --tenant <id> --mode required --actor <admin app_user id>` from the trusted machine. `--mode off` is the kill switch that lifts it with no deploy | founder | open | to fill: the date and the run (never a key); whether required or still enrolled |
| P2-JWT | Confirm the JWT signing algorithm of each Supabase project. With asymmetric signing keys, `/api/*` route handlers verify the token locally (`getClaims`), so the reset target's last aal2 access token may be accepted for up to 1 h (the residual window after a reset covers route handlers, not only the Data API); every data read and write is still refused by Postgres because the factors are gone and the gate re-checks them. The residual is as documented (plan T-10, runbook "Azzerare la verifica") | founder | open | to fill: the signing algorithm as read from the dashboard, and the date |
