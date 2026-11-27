# Runbook: Osteria Dei Rossi app

For the founder and DigiAlto. English, except the two staff sheets, which are Italian and can be printed or sent as they are.
Nothing in this file is a secret: it says where secrets live, never what they are. Fake and placeholder values only.

How to read the citations: a bracket that starts with the word test and a file path names the test that proves the behaviour just stated. A claim with no citation is a
procedure for a person to follow, or a setting only the dashboard can show.

## Accounts and access

Every account has a person who owns it and a login kept in that person's password manager, with MFA on. Logins are never in the
repository, in DigiAlto-Ops or in a chat. Who owns each account is still open (project question Q26): **fill the "Owner" column in
once it is decided**, and keep a second person able to recover each account.

| Account | Used for | Owner |
|---|---|---|
| Vercel | hosting the app (EU region), environment variables, deployments, Deployment Protection | to fill in |
| Supabase | the database, Auth, Storage and Vault of staging and production (EU region) | to fill in |
| Anthropic console | the key for invoice extraction | to fill in |
| Google Cloud | the service account that writes the backups to the Shared Drive | to fill in |
| Google Drive (Shared Drive) | the folder that holds the encrypted backups | to fill in |
| Resend | the sender of the magic-link e-mails (set in Supabase Auth) | to fill in |
| Sentry | not used at go-live (no error reporting, Q193) | none yet |
| GitHub | the code, CI, the scheduled backups, the production migration | to fill in |
| Domain registrar | the custom domain (Q188, needed before 12 January) | to fill in |

Who signs in how:

- **The owner and the admin** sign in with e-mail and password, once per phone, and stay in for 30 days (ADR-029). Forgotten password: the
  e-mail code on the login page, then choose a new one. Their guide is `docs/guides/accesso-e-personale.md`.
  (test: tests/config/owner-guide.test.ts)
- **The chef and the waiters** use a phone the owner has enabled, their name and a 4-digit PIN. The sign-in lasts to the end of the day.
  (test: e2e/staff-pin.spec.ts)
- **Production has no demo data.** The one production tenant is made once by the `create-tenant` job of the `platform-ops` workflow (Actions, "Platform ops",
  "Run workflow", operation `create-tenant`), never from a laptop. Its four values are environment secrets of `platform-ops`, typed only into GitHub's "Add
  environment secret" form just before the run and deleted right after: `TENANT_NAME`, `TENANT_VAT_NUMBER`, `OWNER_EMAIL` and `OWNER_NAME`, the legal name, VAT
  number and owner e-mail that the founder has confirmed. Those are client facts and never go into the repository. Under `platform-ops` the job prints only an
  8-character prefix of the new tenant's id (the run log is public); the full tenant uuid, needed for `set-mfa-enforcement`, is read from the console or the
  Supabase dashboard.

## Where every secret lives and how to rotate it

Rotate on a schedule you choose, and at once when a person who knew a value leaves or a value may have been seen. After every
rotation: redeploy (or re-run the workflow) and check that the app, the daily backup and the cron routes still work.

| Name | Lives in | Used by | How to rotate |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel environment (public by design) | browser and server | Changes only with a new project. Set it in Vercel, redeploy |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Vercel environment (public by design; RLS protects the data) | browser and server | Create a new publishable key in the Supabase dashboard (API keys), put it in Vercel and in the GitHub environments below, redeploy, then delete the old key |
| `SUPABASE_SECRET_KEY` | Vercel environment (server only, never `NEXT_PUBLIC_`); GitHub environments `staging`, `production-backup` and `platform-ops` | cron routes, the PIN sign-in module, admin scripts, the demo and timing workflows, and the invoice-file backup (the "Back up the invoice files" step of "Daily backup" only) | Create a new secret key in the Supabase dashboard, update Vercel, `staging`, `production-backup` and `platform-ops`, redeploy, delete the old key. It is used only in `/api/cron/*`, `src/server/staff-auth/privileged.ts` and `scripts/` |
| `ANTHROPIC_API_KEY` | Vercel environment (server only); GitHub environment `extraction-contract` (the manual contract test) | invoice extraction | Create a new key in the Anthropic console (a separate production key is recommended), update both places, redeploy, revoke the old key |
| `EXTRACTION_MODEL_ID` | Vercel environment; GitHub environment `extraction-contract` | invoice extraction (never a literal in `src/`) | Not a secret. Change it in both places, redeploy, then run the "Extraction contract" workflow by hand |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | nowhere yet (deferred with M10) | nothing at go-live | Nothing to rotate until the Drive reader is built |
| `RESEND_API_KEY` | Vercel environment (server only), Production and Preview | the reservation e-mails, sent by `/api/cron/reservation-mail` only (`MAIL_TRANSPORT=resend`) | Create a new key in Resend (sending access only), put it in Vercel, redeploy, then delete the old key. It is separate from the Resend SMTP credentials below, which live in Supabase |
| `SENTRY_DSN` | Vercel environment, optional | nothing at go-live (no error reporting, Q193) | Not a secret of any weight. Change it in Vercel, redeploy |
| `CRON_SECRET` | Vercel environment **and** Supabase Vault (`cron_secret`) of each project | the bearer check of `/api/cron/*`, and pg_cron when it calls the app | Make a new value (`openssl rand -hex 32`). Change the Vault secret on each project and the Vercel variable together, then redeploy. Between the two changes cron calls are refused (401); the next run after both match works |
| `RESERVATION_GATE_KEY` | Vercel environment (server only) **and** Supabase Vault (`reservation_gate_key`) of each project | the public booking routes sign every call to the five anonymous reservation functions with it; the database checks the same signature | At least 32 characters (`openssl rand -hex 32`). Without a gap: add the new value as Vault `reservation_gate_key_next`, set the Vercel variable, redeploy, then move the value to `reservation_gate_key` and delete `_next`. See `docs/guides/prenotazioni.md` |
| `RESERVATION_LINK_KEY` | Vercel environment (server only); `RESERVATION_LINK_KEY_PREVIOUS` only while rotating | signs the cancel links in e-mails and the booking form's token | At least 32 characters. Set `RESERVATION_LINK_KEY_PREVIOUS` to the old value and `RESERVATION_LINK_KEY` to the new one, redeploy; delete PREVIOUS once the booking horizon has passed. Dropping it at once makes older cancel links show "link non valido" |
| `MAIL_TRANSPORT` | Vercel environment | which sender the reservation mail job uses: `resend`, or `mailpit` on a developer machine and in tests (refused in production) | Not a secret. Set `resend` in production and preview, redeploy |
| `MAIL_FROM` | Vercel environment | the sender of reservation e-mails; its domain must be verified in Resend | Not a secret. Change it in Vercel and redeploy |
| `MAILPIT_URL` | local `.env` and CI | the local mail catcher the `mailpit` transport posts to | Not a secret. Only for development and tests |
| `APP_PUBLIC_ORIGIN` | Vercel environment | the address cancel links in e-mails are built on (https in production) | Not a secret. Change it with the app's address, redeploy |
| `CONSOLE_HOST` | Vercel environment | the host the platform console answers on (name and optional port, lowercase). Unset means no console anywhere: every console path is 404 on every host | Not a secret. Change it with the console's domain, redeploy. A bad value (scheme, path, capitals) stops every request with a configuration error, on purpose |
| `APP_ORIGIN` | Vercel environment | the venue app's origin (scheme and host, no path, no trailing slash), for the console's "Entra nel locale" | Not a secret. Change it with the app's address, redeploy |
| `PIN_PEPPER` | Vercel environment (server only) | the staff PIN sign-in | Rotating it changes every derived staff password, so **every staff PIN must be reset**: change it in Vercel, redeploy, then in Personale give each person a PIN again. Staff cannot sign in until their PIN is set |
| `SUPABASE_URL` | GitHub environments `production-backup`, `staging` and `platform-ops` | the backup guards and the keep-alive ping | The same value as that project's `NEXT_PUBLIC_SUPABASE_URL`. Changes only with a new project |
| `SUPABASE_PUBLISHABLE_KEY` | GitHub environments `production-backup`, `staging` and `platform-ops` | the keep-alive ping | The same key as that project's publishable key; rotate it together with the Vercel one |
| `TENANT_NAME` | GitHub environment `platform-ops` | the `create-tenant` job of `platform-ops` (SP3): the new venue's name | Not a standing secret: set it right before a `create-tenant` run and delete it right after. The value is typed only into GitHub's own "Add environment secret" form |
| `TENANT_VAT_NUMBER` | GitHub environment `platform-ops` | the `create-tenant` job of `platform-ops`: the new venue's VAT number | As `TENANT_NAME`: set before the run, delete after |
| `OWNER_EMAIL` | GitHub environment `platform-ops` | the `create-tenant` job of `platform-ops`: the owner's sign-in address | As `TENANT_NAME`: set before the run, delete after |
| `OWNER_NAME` | GitHub environment `platform-ops` | the `create-tenant` job of `platform-ops`: the owner's display name | As `TENANT_NAME`: set before the run, delete after |
| `PLATFORM_ADMIN_EMAIL` | GitHub environment `platform-ops` | the `bootstrap` job of `platform-ops` (SP3 step 7): finds the platform admin account; never printed, logged or put in an input | A standing secret (the account's address, held by DigiAlto). If the account's address changes, update the secret; there is no key to rotate. The value is typed only into GitHub's own "Add environment secret" form |
| `SUPABASE_DB_URL` | GitHub environments `production-backup` and `staging` | the daily dump | The session-pooler URL whose user is `postgres.<project ref>`. It holds the database password: after resetting the password in the Supabase dashboard, paste the new URL here and the new password into `SUPABASE_DB_PASSWORD` |
| `BACKUP_ENCRYPTION_PASSPHRASE` | The founder's password manager, and GitHub environments `production-backup` and `staging` | encrypting the daily dump, the invoice-file packs and manifests; decrypting in the weekly restore check | At least 32 characters (`openssl rand -base64 48`). **old backups need the old passphrase**: keep every old passphrase until the last database copy encrypted with it has been deleted by the 14-copy retention (about two weeks). **Invoice-file packs are never deleted by the code**, so keep every passphrase for as long as a pack made with it exists (years), or after a rotation run "Daily backup" with `full_files`, wait for a green weekly check, then delete the older packs by hand (Q-F6). Without the passphrase no backup can be read |
| `BACKUP_DRIVE_SA_JSON` | GitHub environments `production-backup` and `staging` | uploading to, listing and deleting in the Shared Drive folder | In Google Cloud, create a new key for the service account, replace the secret, delete the old key |
| `BACKUP_DRIVE_FOLDER_ID` | GitHub environments `production-backup` and `staging` | the folder the backups go to | Not a secret. Changes only if the folder is replaced; share the new folder with the service account as Content manager first |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | GitHub environment `staging`; the founder's password manager | the timing workflows and `scripts/check-headers.ts` reaching protected staging and preview hosts | Regenerate "Protection Bypass for Automation" in the Vercel project, then update the GitHub secret **and** the Vault secret `vercel_protection_bypass` with the same value |
| `DEMO_TENANT_ID` | GitHub environment `staging` | the demo-data workflow | Not a secret of weight, but a client fact. Replace it if the demo tenant is made again |
| `SUPABASE_ACCESS_TOKEN` | GitHub environments `production` and `staging` | `supabase db push` | Create a new access token in the Supabase account settings, replace it in both, delete the old token |
| `SUPABASE_DB_PASSWORD` | GitHub environments `production` and `staging` | `supabase db push` | Reset the database password in the Supabase dashboard of that project, replace it here and in `SUPABASE_DB_URL` |
| `SUPABASE_PROJECT_REF` | GitHub environments `production` and `staging` | `supabase db push` | Changes only with a new project. For production it must equal `PRODUCTION_PROJECT_REF` or the workflow stops |
| `PRODUCTION_PROJECT_REF` | variable of GitHub environments `production` and `production-backup` | guards: the workflows refuse any other project | Changes only with a new production project |
| `BACKUP_KEEP_COPIES` | variable of GitHub environment `production-backup` | retention of the daily database copies and of the files manifests (default 14); packs are never deleted | Edit the variable |
| `STAGING_APP_HOST` | variable of GitHub environment `staging` | the timing workflows (they only talk to this host) | Edit the variable when the staging host changes |
| `app_base_url` | Supabase Vault of each project | pg_cron calling the app | `select vault.update_secret(id, '<new URL>') from vault.secrets where name = 'app_base_url';` when the app's address changes (the custom domain). See `docs/guides/cron-vault-secrets.md` |
| `cron_secret` | Supabase Vault of each project | pg_cron calling the app | The same value as `CRON_SECRET` in Vercel: change both together (see `CRON_SECRET`) |
| `vercel_protection_bypass` | Supabase Vault of each project, only while the app is on a protected `*.vercel.app` host | pg_cron getting past Vercel's login wall | Holds the same value as `VERCEL_AUTOMATION_BYPASS_SECRET`; update both together. Delete it when the app moves to a custom domain |
| Resend SMTP credentials | Supabase dashboard, Authentication, SMTP settings of each project | the magic-link e-mail | Create a new key in Resend, replace the password in the SMTP settings, delete the old key. The magic-link path never holds a Resend key; the reservation mail job has its own, `RESEND_API_KEY` |
| Vercel account | the owner's password manager, MFA on | humans | Change the password and the MFA device in the account's security settings. Remove people who left |
| Supabase account | the owner's password manager, MFA on | humans | As above; also review the access tokens |
| Anthropic console account | the owner's password manager, MFA on | humans | As above; also review the API keys |
| Google Cloud account | the owner's password manager, MFA on | humans | As above; also review the service account keys |
| Resend account | the owner's password manager, MFA on | humans | As above; also review the API keys |
| Sentry account | the owner's password manager, MFA on | humans | As above, once the account exists |
| GitHub account | the owner's password manager, MFA on | humans | As above; also review who may approve the `production` environment |
| Domain registrar account | the owner's password manager, MFA on | humans | As above; also review the DNS records |

**Never dispatch `platform-ops` before its GitHub environment exists with protection** (SP3 plan §6, FS-1). A job that names an environment the repository lacks makes GitHub create it without protection when the job runs. The founder first creates `platform-ops` (Settings, Environments: required reviewer the founder's own GitHub account, deployment branches `main` only) and adds its secrets; nobody dispatches any `platform-ops` job until the lead confirms that is done. `PLATFORM_ADMIN_EMAIL` is added before the first `bootstrap` run.

**Changing `.github/workflows/platform-ops.yml`** (the workflow that holds the secret key and the four tenant secrets above) needs the lead's line-by-line read in the pull request. Its guard test, `tests/config/platform-ops-workflow.test.ts`, is a safety net, not the review: it can only refuse what its author thought of. Never re-run a `platform-ops` job with debug logging, and never set `ACTIONS_STEP_DEBUG` or `ACTIONS_RUNNER_DEBUG` (as a secret or a variable) in this repository: debug output is outside what the file and its guard control.

### GitHub environment `production-backup`

For the scheduled daily backup and the weekly restore check. **main only, no required reviewer**: a nightly job cannot wait for a
person, so the protection is the branch rule and the project-ref guards.

- Secrets: `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `BACKUP_ENCRYPTION_PASSPHRASE`,
  `BACKUP_DRIVE_SA_JSON`, `BACKUP_DRIVE_FOLDER_ID`.
- `SUPABASE_SECRET_KEY` is new here (ADR-034): production's secret key, which bypasses RLS. It reaches the invoice-files step only, never
  `npm ci`, and is never printed. Inside that step only the downloader (`scripts/lib/backup/download.ts`) uses it; the child processes
  (gpg, psql, tar) do not get it. If the Supabase dashboard allows several secret keys, make a separate secret key named for the backups so it can be
  revoked alone (Q-F8); otherwise use the project's key. (test: tests/config/backup-daily-workflow.test.ts)
- Variables: `PRODUCTION_PROJECT_REF`, `BACKUP_KEEP_COPIES`.
- **Setting PRODUCTION_PROJECT_REF arms the backups.** The daily backup and the weekly restore check begin with a gate step that reads
  the variable `PRODUCTION_PROJECT_REF` of this environment:
  - **Empty or unset (not armed):** every other step is skipped, the run ends green with the notice
    "backups not armed: PRODUCTION_PROJECT_REF is not set", and no `backup-failure` issue is opened. This is the state until production exists.
  - **Set (armed):** the jobs behave in full. **Until the seven secrets are set too, the run fails and opens (or updates) a
    `backup-failure` issue**, every day for the daily backup. Set the secrets, run "Daily backup" once by hand, then close the old issues.
  - A manual run with target `staging` is always armed (it uses the `staging` environment and its own project ref).
  (test: tests/config/backup-daily-workflow.test.ts, tests/config/backup-restore-workflow.test.ts)
- The Drive service account must be a **Content manager** on the Shared Drive (the job lists, uploads and deletes old copies in that folder).
  (test: tests/config/backup-daily-workflow.test.ts)

### GitHub environment `staging`

For manual backup runs against staging, and for the staging workflows.

- Backup secrets, the same seven names as above with staging's values: `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SECRET_KEY`, `BACKUP_ENCRYPTION_PASSPHRASE`, `BACKUP_DRIVE_SA_JSON`, `BACKUP_DRIVE_FOLDER_ID`.
- Also `VERCEL_AUTOMATION_BYPASS_SECRET`, for the timing workflows and the header check.
- Already there for the staging deploy and demo workflows: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`,
  `SUPABASE_SECRET_KEY`, `DEMO_TENANT_ID` and the variable `STAGING_APP_HOST`.

### GitHub environment `production`

For "Deploy production database". **The founder is the required reviewer**, and runs only from `main`.

- Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`.
- Variable: `PRODUCTION_PROJECT_REF`.
- The workflow stops with a named error if the variable is empty, is the staging project, or differs from the secret.
  (test: tests/config/deploy-production-workflow.test.ts)

### GitHub environment `extraction-contract`

`ANTHROPIC_API_KEY` and `EXTRACTION_MODEL_ID`, for the manual live contract test only.

### Supabase Vault, on each project

`app_base_url`, `cron_secret` and `vercel_protection_bypass` (see `docs/guides/cron-vault-secrets.md`). `vercel_protection_bypass`
holds the same value as `VERCEL_AUTOMATION_BYPASS_SECRET`. Until `app_base_url` and `cron_secret` both exist, the database's scheduled
calls do nothing, which is what keeps local stacks and CI from calling out.

## Outage

Start with who is affected, then the layer.

| What staff see | Likely cause | What to do |
|---|---|---|
| Nobody can sign in, every screen fails | Supabase project paused (Free plan) or down | Go to "Supabase Free: pause, resume, keep active" |
| Pages fail, the Supabase dashboard is healthy | Vercel deployment problem | Vercel, Deployments: promote the last good deployment (a rollback). No data is touched by that |
| One phone cannot open the app | That phone's connection | The offline sheet below: the comanda keeps working, then sends by itself |
| Staff are asked for the PIN screen again | The end of the day's sign-in, as designed | Nothing. Sign in again |
| The kitchen board is empty while orders were sent | The sending phone is offline: its operations wait on the phone | Reconnect that phone and keep the app open; see "Scheda per il personale: lavorare senza connessione" |
| An alert "ledger_drift" arrives | A nightly ledger check found a mismatch, or a scheduled job did not run | Read the alert's check names. `job_stale` after a pause is expected once. Anything else: stop and call DigiAlto with the alert text |

Check that the app is up with `GET /api/health` (it answers `{"status":"ok"}` without touching the database, so it proves Vercel only).

The headers and the nonce policy are checked on a deployment with `npx tsx scripts/check-headers.ts --base-url <https address> --expect
preview|production` (set `VERCEL_AUTOMATION_BYPASS_SECRET` for a protected host). It prints one JSON line with header names only.
(test: tests/scripts/check-headers.test.ts)

### Known quirk: a staff-meal rule at a deactivated place

A staff-meal rule whose stored location was deactivated afterwards cannot be confirmed or deactivated. **Workaround: re-save the rule**
(open the rule on "Pasti del personale", choose an active place, save it again), then confirm or deactivate it. A real fix comes after
go-live (follow-up G8).

## Supabase Free: pause, resume, keep active

Production is on the Supabase **Free** plan. Supabase pauses a Free project after a period of inactivity (one week in Supabase's
documentation as far as we know; not re-checked here). A paused project serves nothing: the app fails and pg_cron stops. Free also has
no Supabase-side backups and no point-in-time recovery, so **our daily dump is the only backup** and the recovery point is the last dump
(up to about 24 hours).

The invoice-file backup downloads from Supabase too: the day's new invoice files each day, and the whole bucket on the first run and on every
"Daily backup" run with `full_files`. That counts as egress, which Free pools across the whole organisation (5 GB a month; Supabase
pricing page, read 2026-11-09). The weekly restore check reads Drive only and costs no Supabase egress. Free also holds 1 GB of file
storage (Q-F1).

What keeps the project active, and how sure we are:

| Source | When | Certainty |
|---|---|---|
| The venue's own use: every screen makes Auth and REST calls through Vercel | every service day | **sure** on days with service (real API traffic) |
| The daily backup: a database connection through the pooler, then `GET <SUPABASE_URL>/auth/v1/health` with the publishable key | every day, 03:15 CET / 04:15 CEST | **likely, not verified**: whether these count as activity is not documented in what we could read |
| pg_cron jobs (they run inside the database, with no outside request) | continuous | **not counted on** |

The venue never closes for longer than a week (Q196), so its own use covers every week. (test: tests/scripts/backup/keepalive.test.ts)

How a pause shows up:

1. The daily backup fails at the dump or at the ping, and opens (or comments on) a **`backup-failure`** issue with the run link.
   Watch the repository's issues (GitHub, Watch, Custom, Issues).
2. The weekly restore check fails its 36-hour freshness test, because no new copy arrived. (test: tests/scripts/backup/freshness.test.ts)
3. Staff cannot sign in.
4. The Supabase dashboard shows the project as paused.

To **resume**:

1. Supabase dashboard, the project, resume (or restore) it, and wait until it is healthy.
2. Sign in as the owner.
3. Run "Daily backup" by hand (Actions tab, target production), then close the `backup-failure` issues.
4. Expect one `job_stale` line in the next `ledger_drift` alert: the scheduled jobs did not run while the project was paused.
5. Tell staff to reopen the app so waiting operations replay.

A staging pause rehearsal is optional (Q196).

## Scheda per il personale: lavorare senza connessione

*Per camerieri e cucina. Si può stampare.*

Se il telefono perde la rete, **continua a lavorare**: l'app non si blocca.

1. In alto compare «Sei offline». Le comande restano sul telefono e partono da sole appena torna la connessione. La cucina non le vede finché non partono.
2. Puoi aprire un tavolo, aggiungere i piatti e toccare «Invia» come sempre. Le righe dicono «In coda» e «In coda per la cucina»; il numero «In coda · 5» ti dice quante cose aspettano.
3. **Chiudere il conto serve la connessione.** Se sei offline il pulsante per chiudere il tavolo è spento e lo dice. Riprova quando la rete torna.
4. Alcune pagine (per esempio le fatture) non si aprono offline e mostrano «Sei offline».
5. Quando torna la rete, tieni l'app aperta qualche secondo finché «In coda» sparisce. Se un piatto era già in cucina o è esaurito, l'app ti avvisa con un messaggio: toccalo per leggerlo e poi «Ho capito».
6. **Non toccare «Esci» con operazioni in coda.** Se un collega entra sullo stesso telefono, le tue operazioni restano ferme e partono solo quando rientri tu con il tuo nome.
7. Se vedi «Un'operazione non riesce a partire: avvisa il titolare», chiama il titolare e non chiudere l'app.

(test: e2e/offline.spec.ts, tests/pwa/sw.test.ts, e2e/bill-close.spec.ts)

## Scheda per il personale: primo accesso

*Per camerieri e cucina. La prima volta il titolare è con te.*

1. Il titolare ha già aggiunto il tuo nome e ti ha dato un PIN di 4 cifre.
2. Sul telefono della sala o della cucina apri l'app installata. Il telefono si apre su «Chi sei?».
3. Scegli il tuo nome e scrivi il tuo PIN.
4. L'accesso dura fino a fine giornata: domani lo rifai.
5. Dopo 5 PIN sbagliati devi aspettare 15 minuti. Se hai dimenticato il PIN, chiedi al titolare di cambiartelo.
6. Se l'app dice «Questo dispositivo non è abilitato», chiama il titolare: il telefono va abilitato da lui.
7. Mai dire il PIN a un collega e mai scriverlo sul telefono.

(test: e2e/staff-pin.spec.ts, tests/lib/staff-auth/setup-guide.test.ts)

Per il titolare, i passi per abilitare un telefono sono in `docs/guides/accesso-e-personale.md`: Personale per le persone e il PIN,
Dispositivi abilitati per il codice (vale 15 minuti).

## Device revocation

A lost or stolen venue phone is revoked from **Dispositivi abilitati** (owner or admin):

1. Open Dispositivi abilitati, find the phone, tap "Revoca" and confirm.
2. The phone is signed out and cannot sign anyone in again. A repeated revoke is harmless, and an unknown device is a 404.
   (test: tests/app/api/staff-auth/devices.test.ts)
3. A revoked phone that tries a PIN sign-in is refused (401, no token is requested). (test: tests/integration/staff-pin.int.ts)
4. If it was also the owner's phone, change the password ("Cambia password" in Oggi). Other devices of that account sign out within an
   hour at most.
5. Operations a revoked phone still held are not sent by any other user: they are held under the name of the person who made them.
   (test: e2e/offline.spec.ts)
6. When there is a new phone, enrol it again with a new code (Aggiungi dispositivo, valid for 15 minutes).

Also see `PIN_PEPPER` in the secrets table: rotating it resets every staff PIN, which is the way to lock out every staff sign-in at once.

## Two-step verification (TOTP)

The owner and the admin can add a second factor (an authenticator app, TOTP) on top of their password (P2-1, `docs/plans/2026-11-12-p2-1-totp.md`). The
owner is offered it; the admin is always required to have it, in every mode (FD31, 2026-11-13). Staff PIN sign-ins are never affected. Codes are checked in Postgres; after
5 wrong codes in 15 minutes the account's code entry is locked for 15 minutes. (test: supabase/tests/database/342_mfa_self.test.sql)

**Enforcement and the kill switch.** A tenant's enforcement is `off`, `enrolled` (default) or `required`. Only `scripts/set-mfa-enforcement.ts`, run from a trusted
machine with the environment's Supabase secret key, changes it:

- `npx tsx scripts/set-mfa-enforcement.ts --tenant <id> --mode required --actor <admin app_user id>` turns the requirement on. It is refused (`admins_not_enrolled`,
  with the count) until every active admin has a verified factor, so nobody is locked out at the switch.
- `--mode off` is the **kill switch for owners**: it lifts the requirement for owners at the next request, with no deploy. It does **not** lift it for admins (FD31, 2026-11-13: the admin always needs the code, in every mode), so the switch never rescues an admin. **Recovering a locked-out admin, in this order:**
  1. **Lost or broken factor:** run the reset (`scripts/mfa-reset.ts`, below). It runs as the service role with the secret key and needs no
     working admin session, so it works even when no admin can sign in.
  2. **Re-enrol at once:** the admin is forced to the enrolment page at the next sign-in; DigiAlto stays on the phone until it is done.
  3. **The gate itself is broken** (an admin with a valid factor at `aal2` is still refused): neither the switch nor the reset helps; ship a
     hotfix migration for `app.mfa_needs_aal2` through the normal PR and deploy.
- `--mode enrolled` returns to the default (offered, not required).

**Founder steps, staging then production** (the implementer and the agents never toggle a hosted project):

- **M-1** Staging and production, Supabase dashboard, Authentication, multi-factor settings: confirm "Authenticator app (TOTP)" enrolment and verification are enabled
  (on by default); leave phone MFA off; note the MFA challenge/verify rate limit if the dashboard shows it. Before PR 1 is deployed to staging.
- **M-2** After the screens ship to staging: the DigiAlto admin turns the code on (main and backup), signs out and in, and passes the code.
- **M-3** On staging: sign in on a real iPhone and a real Android phone, from the installed app, and pass the code.
- **M-4** Production: same as M-1, after go-live.
- **M-5** `npx tsx scripts/set-mfa-enforcement.ts --tenant <id> --mode required --actor <admin app_user id>` with the environment's secret key, from the trusted
  machine: staging first, production on a day without service. `--mode off` is the kill switch for owners only (never for admins, FD31).
- **Deploy note (FD31)** Deploying migration `20261202100000_admin_mfa_always.sql` forces every existing admin without a verified factor to enrol at their next request, in every
  mode (`off`, `enrolled`, `required`). Enrol the admin accounts on the authenticator before the deploy or right after it. Nobody is locked out: forced enrolment works at `aal1`.
  Owners, chefs, waiters and PIN sign-ins are unaffected.
- **M-6** Tell the owner (in Italian, the owner guide) that the code is available and optional for them.
- **M-7** Decide where the backup authenticators are kept (a second phone or a password manager with TOTP; never in the repo or DigiAlto-Ops) and record it.

**Azzerare la verifica (reset a lost second factor, D2, DigiAlto only).** There is no in-app reset (Q-T1 = V1). When a titolare or admin loses the phone and has no
backup device, DigiAlto runs the break-glass script after confirming the person's identity **by phone** first:

1. `npx tsx scripts/mfa-reset.ts --tenant <id> --user <target app_user id> --actor <actor app_user id>` with the secret key, from the trusted machine. The target must
   be an active owner or admin (never a chef or waiter).
2. **Which actor id to pass:** another active admin of the same tenant when one exists; in a venue with a single admin who lost their phone, the actor is the target's own app_user id.
   The audit row's `created_by` then records that actor, so `created_by` means "requested by" — DigiAlto runs the script on their behalf.
3. The script deletes the target's sessions (they can no longer refresh) and all of their factors, and writes one `app_user.mfa_reset` audit row with
   `after {"sessions_revoked": n}` (the count only, no ids). It prints the number of factors removed. A reset is idempotent: if it half-fails, run it again.
4. Enrol the person's new device **at once**, while still on the phone with them. After a reset an admin is forced to enrol at the next
   sign-in, in every mode (FD31). An owner is only offered the code on the offer page, which has "Non ora": it can be dismissed and the sign-in
   then goes on with no second factor. So DigiAlto stays on the phone until the person has pressed "Attiva ora" and finished the enrolment. A new or just-reset
   account must not be left unenrolled, as whoever has that password first could enrol their own authenticator.

A residual window applies after a reset: see the go-live checklist item `P2-JWT` and plan T-10.
(test: tests/scripts/mfa-reset.test.ts, supabase/tests/database/343_mfa_admin.test.sql)

**Wrong-code records.** Wrong codes are kept in `app.mfa_failure` (account and time only, no code) and deleted after 30 days by the daily pg_cron job
`mfa-failure-retention`; enrolment, removal, reset and lock events stay permanently in the audit log. If the job goes stale (no good run in 48 hours) it shows under
job health like the other cron jobs. (test: supabase/tests/database/347_mfa_failure_retention.test.sql)

## Backups and restore

**What exists.** Daily at 02:15 UTC (03:15 CET, 04:15 CEST, after the 02:00 Rome cut-off), "Daily backup" dumps roles, schema and data,
encrypts them with the founder's passphrase (AES-256 through gpg), uploads to the Shared Drive folder, checks the MD5 against Drive's, keeps
the newest 14 copies (`BACKUP_KEEP_COPIES`), then pings Auth health, then runs the step "Back up the invoice files" (below). Every Monday at 04:00 UTC "Weekly restore check" downloads the newest
copy, checks its MD5, decrypts it, restores it into an **empty local** Supabase stack and passes only if: no ledger finding, row counts equal
the manifest's, migrations equal the manifest's, no scheduled job and no Vault secret survives, and the copy is under 36 hours old.
It also checks the invoice files, items (e) to (i): the newest files manifest is under 36 hours old, every pack it names is in Drive, every
object row of the restored copy has an entry in the manifest, and the newest pack plus four others picked at random are decrypted with
every file in them matched to its sha256. The clear text lives only on the runner and is removed at the end. No backup is ever a GitHub artifact.
(test: tests/config/backup-daily-workflow.test.ts, tests/config/backup-restore-workflow.test.ts)

**What is backed up, and how fresh.** The database (up to about a day old, 14 copies) and the invoice files of the private bucket
`invoices` (every object within a day of its upload). The step "Back up the invoice files" lists the bucket with a read-only query,
downloads what is new since the previous manifest, and uploads one encrypted pack per run, `osteria-files-<UTC stamp>-<target>-<nn>.tar.gpg`
(split at 200 MiB), and an encrypted full manifest every run, `osteria-files-manifest-<UTC stamp>-<target>.json.gpg`. Manifests keep the
newest `BACKUP_KEEP_COPIES`; **packs are never deleted by the code**, because invoices are kept for 10 years and the database copies rotate
after 14 days. Someone must delete packs once the retention period ends (Q-F5). Drive holds supplier invoices for that whole time (DPA-1 in
the go-live checklist). A pack holds the new files of one day. A removed or changed object is not hidden: the manifest marks it, and on
production it fails the run (`files_bucket_anomaly`, below).
(test: tests/scripts/backup/files.test.ts, tests/scripts/backup/files-verify.test.ts, tests/config/backup-selftest-workflow.test.ts)

**Invoice-file log codes.** Logs hold counts, byte totals, our own Drive file names and these codes, never an object path. The run uploads
nothing until every download has succeeded.

| Code | Meaning and what to do |
|---|---|
| `files_bucket_anomaly` | Production only. The manifest and the packs were uploaded, so the backup is complete, but an object was removed from the bucket or its bytes changed since the last run. The app cannot do either (no update or delete policy). Check who used the secret key or the dashboard. A path is reported once: the next run sees it already marked |
| `files_run_cap_reached` | The run hit its 1 GiB download limit. The backup is valid so far; the next run continues. Repeats every day only while there is a backlog |
| `files_manifest_unreadable` | The previous manifest (daily step) or the newest manifest (weekly check, as a problem in its summary) does not decrypt or parse (wrong passphrase, a damaged file). Fix the passphrase, or run "Daily backup" with `full_files` |
| `files_path_invalid` | An object path the manifest cannot carry (empty, too long, a control character) or that could leave the bucket (an empty segment, a `.` or `..` segment, a leading `/`). The run fails instead of skipping it. Find it in the dashboard and rename or remove it |
| `files_download_failed` | An object could not be downloaded twice in a row. Nothing was uploaded; re-run. If the object was deleted between listing and download, the next run recovers: it is no longer listed and is marked removed |
| `files_manifest_missing`, `files_manifest_stale` | Weekly check: no files manifest of the target, or the newest is over 36 hours old. The daily files step did not run or failed |

**A `full_files` run drops removed objects from the manifest.** "Daily backup" with `full_files` packs every object again and writes a manifest
with no history, so an object that was removed from the bucket earlier is no longer in it. **Its older packs are then the only record of it:
do not delete them** until you have decided the object is no longer needed. It downloads the whole bucket (Supabase egress).

**A failure after some packs were uploaded leaves orphans.** Packs are uploaded first and the manifest last. If an upload fails midway, the packs
already uploaded are not named by any manifest: they are orphans, and their files are re-packed by the next run into a new pack. The orphan is
harmless and only costs Drive space; it may be deleted by hand once the next run is green.
(test: tests/scripts/backup/files.test.ts)

**Both workflows fail loudly.** A failure opens or comments on a `backup-failure` issue; see the Free section for what to do.

**Run one by hand.** Actions, "Daily backup" or "Weekly restore check", Run workflow, choose the target (`production` or `staging`).
The first runs on staging prove the Drive setup before production holds data. Record the run minutes.

**Open one by hand (once, to prove you can).**

1. Download a `osteria-backup-<UTC stamp>-<target>.tar.gpg` from the Shared Drive folder.
2. `gpg --decrypt --output backup.tar osteria-backup-<UTC stamp>-<target>.tar.gpg` and give the passphrase when asked.
3. `tar -xf backup.tar`. It holds `roles.sql`, `schema.sql`, `data.sql`, the migration history (`history_schema.sql`, `history_data.sql`: `supabase db dump`
   leaves out `supabase_migrations`) and `manifest.json` (migrations and table counts, no data).
4. Delete the clear text when done.

To open a pack: download `osteria-files-<UTC stamp>-<target>-<nn>.tar.gpg`, decrypt it the same way and `tar -xf` it. It holds
`index.json` and the files as `o/<n>` (`index.json` maps each `o/<n>` to the object path and its sha256). To open a manifest: decrypt
`osteria-files-manifest-<UTC stamp>-<target>.json.gpg` to JSON; it lists every object path with its pack, member and sha256. Both hold
object paths that point at supplier invoices: never paste them into an issue, a chat or a log, and delete the clear text when done.

**Recover the database (disaster).** The data in a copy is up to about a day old.

1. Make a new Supabase project (Free), in the EU region. Do not delete the old one until the new one is checked.
2. Decrypt and unpack the newest copy as above.
3. Restore into the new project's database in one transaction that stops at the first error, in this order: `roles.sql`, `schema.sql`,
   `history_schema.sql`, then `set session_replication_role = replica`, then `data.sql`, then `history_data.sql`. The weekly check does exactly this on an empty local stack.
   (test: tests/scripts/backup/commands.test.ts)
   A copy made before 2026-11-08 has no migration history (no `history_*.sql`): leave those two files out, then record the applied
   migrations on the new project with `supabase migration repair --status applied <version>` for each version in its `manifest.json`.
4. Remove what must not survive a restore: the copied cron jobs (`select cron.unschedule(jobid) from cron.job`; the restoring role
   cannot delete from `cron.job`) and the Vault secrets, then create the three Vault secrets again
   for the **new** project (see "Where every secret lives"). The restore removes all three route-calling secrets (`app_base_url`, `cron_secret` and
   `vercel_protection_bypass`) from the copy, so none can point at the old setup.
5. Point Vercel at the new project (`NEXT_PUBLIC_SUPABASE_URL`, the keys), repeat the Auth settings of the Go-live day list, set
   `PRODUCTION_PROJECT_REF` and the backup secrets to the new project, redeploy.
6. Sign in as the owner and read Oggi and the day close before opening to staff.

**Recover the invoice files.** There is no tool for this (Q-F3); it is done by hand, after the database is restored.

1. Decrypt the newest manifest (above). Every entry without a `removedAt` is a file that should be in the bucket; an entry with `removedAt`
   is a file that was removed later and is kept only in its pack.
2. For each file, take its `pack` and `member`, download that pack from Drive (each pack once), decrypt and unpack it, and read the file `o/<n>`.
3. Upload it to the **same path** in the new project's private `invoices` bucket, with the new project's secret key. Check its sha256 against the
   manifest.
4. Try one file first on the spare project. After a database restore the `storage.objects` rows exist without their bytes, and whether an upload to
   such a path succeeds, and with which option, has not been verified.
5. Delete the clear text.

**Not yet rehearsed:** the weekly check proves the restore into an empty *local* stack. A restore into a fresh *hosted* project has not
been run; do it once on a spare Free project before you depend on it.

## Releases

Order: **migrations first, then the code** (decision Q190), so new code never meets an old schema.

1. Merge the pull request. CI runs on `main` and staging follows by itself (migrations pushed to staging).
   The staging deploy checks out the commit whose CI passed (`workflow_run.head_sha`), not the tip of `main`. GitHub labels a
   `workflow_run` run with the tip of `main` when the event fires, so a run labelled with a newer commit may deploy an older one: read its
   checkout step. When a newer push cancels a CI run on `main`, that run's deploy is skipped and the next green run deploys both changes.
   (test: tests/config/deploy-staging-workflow.test.ts)
2. Look at staging: the pages that changed, then `npx tsx scripts/check-headers.ts --base-url <staging> --expect preview`.
3. Actions, "Deploy production database", Run workflow on `main`. It dry-runs, then waits for **the founder's approval**, then pushes the
   migrations to the production project only. It never seeds or resets.
   (test: tests/config/deploy-production-workflow.test.ts)
4. In Vercel, **promote** the deployment of that commit to production (production deployments wait for promotion; confirm the setting is
   on).
5. `npx tsx scripts/check-headers.ts --base-url https://<production address> --expect production`. It must print no findings.
6. Rollback of code: promote the previous deployment. Migrations are not rolled back: a bad one is fixed by a new migration.

**Deploys that change `/api/me`.** A production deploy that changes the `/api/me` reply (a new key, as SP1's `settings`) goes out **outside service hours**, and each device opens the app once while online afterwards. An old cached `/api/me` without `settings` shows the error state with its retry button, by design (Rule B: no silent defaults); one online reply replaces it.

**Previews are off.** Only `main` deploys on Vercel (staging); pull requests get no preview, and GitHub CI covers them. The Hobby plan
allows 100 deployments a day, which branch previews used up on 2026-11-14. The switch is `git.deploymentEnabled` in `vercel.json`
(`"**": false, "main": true`). To get a preview for one branch, add `"<branch>": true` there in that branch, and remove it before merging:
`tests/config/deploy-config.test.ts` pins the exact value, so CI is red on that branch while the line is there (on purpose: the red check
shows the line must go before merging). Use `"**"`, never `"*"`: `*` does not match across `/`, so every `feat/...` branch would deploy again. AT2's
`--expect preview` check runs on staging (step 2). (test: tests/config/deploy-config.test.ts)

Dependencies: the `checks` job runs `scripts/audit-check.ts`; a high or critical advisory fails CI unless
`docs/go-live/audit-exceptions.json` excepts it with a reason and a review date. (test: tests/scripts/audit-check.test.ts)

## Venue settings

A venue's language and its lists of sale VAT rates, receipt types and payment types are changed through one route. There is no screen yet
(SP7's wizard will use it), so DigiAlto does it for the owner, or the owner does it with their own session. The design is in
`docs/adr/adr-046-per-tenant-sale-lists.md`.

**How to change a list.** `PATCH /api/settings/venue`, JSON body, owner or admin only (a chef or waiter gets 403; the database repeats the check).
(test: tests/app/api/settings-venue.test.ts)
- Keys: `locale` (`it` or `en`), `saleVatRates` (numbers from 0, 4, 5, 10, 22), `receiptTypes` (`scontrino`, `fattura`),
  `paymentTypes` (`cash`, `card`, `other`). Send only the keys to change, at least one. A list is the complete new list: what is left out is
  switched off. For `receiptTypes` and `paymentTypes` the array order is the order on screen; `saleVatRates` is always stored and shown in
  ascending order (`[22, 10]` becomes `[10, 22]`).
- Answers: 200 with `changed` and the settings. Sending the same values again is 200 with `changed: false` and writes nothing.
  (test: supabase/tests/database/395_sp1_tenant_settings.test.sql)
- 400: an unknown key, no key, a wrong type, a list longer than 20 entries, or a body that is not valid JSON (`invalid_json`). 413: a body
  over the size limit. 415: not a JSON body. 401: not signed in. 403: not owner or admin (`forbidden`), or the second step is missing
  (`mfa_required`; an admin without an enrolled factor gets `mfa_enrol_required`). 422: a value the database refuses, with one of these codes:
  `locale_invalid`, `vat_rate_invalid` (a rate not in the statutory list, or the same rate sent twice), `receipt_type_invalid`,
  `payment_type_invalid` (a code outside the catalogue, or the same code sent twice), `settings_list_empty` (an empty list: keep at least one
  entry). Nothing is written on a refusal. Each change writes one `tenant.settings_changed` audit row.

**What removing a VAT rate does.** The rate is switched off for this venue (`is_active = false`), never deleted. Switching it on again is the
same call with the rate back in the list.
- Open table sessions keep the coperto rate they were opened with and still close.
  (test: supabase/tests/database/391_sp1_sale_vat.test.sql)
- **The stored coperto rate is not changed.** If the venue's coperto (Tavoli › Impostazioni › Coperto) is at the removed rate, every table
  opened afterwards still copies that rate, because the coperto rate is checked only when it is set or changed. Saving the coperto card with
  only a new amount keeps it too. Change the coperto rate to one in the new list as part of the same job (see the last point).
- Existing menu prices at that rate stay valid and keep selling. A new price version at the same rate as the dish's current one is accepted;
  a new dish, a new coperto rate, or a price at a rate other than the current one is refused with `vat_rate_invalid` (422). The menu form
  shows the stored rate as the current option, so saving a dish unchanged keeps it.
  (test: supabase/tests/database/391_sp1_sale_vat.test.sql)
- Supplier invoices are not affected: they are checked against the statutory list.
- To move off the removed rate completely: set the coperto rate to one in the new list (Tavoli › Impostazioni › Coperto), and edit each dish
  at the old rate to a rate in the new list. Until both are done, the old rate keeps being charged on new tables (coperto) and on those
  dishes.

**What removing a receipt or payment type does.** A table that is closed afterwards with that code is refused (`receipt_type_invalid` or
`payment_type_invalid`) and stays open; tables already closed with it keep it, and the day report still shows it for that day.
(test: supabase/tests/database/394_sp1_close_codes_procs.test.sql)

## Avvio magazzino (carico iniziale)

A venue that starts on the app already has stock. Owners and admins enter it once per location on Magazzino › Avvio magazzino: quantity and
unit cost per ingredient, a "Data del carico", then one confirmation per location. The design is in `docs/adr/adr-048-opening-stock.md`.

- **Count right after the carico.** Once a location's carico is confirmed, do a **monthly count** of that location the same day. The AVT
  report needs an opening count to compare against, and the count also closes that location's carico window: after it, stock comes in only
  by invoice or count. While a count of either type is open at the location, the carico is refused (`opening_count_open`); after a closed
  monthly count it is refused with `opening_location_counted`.
  (test: supabase/tests/database/412_post_opening_stock.test.sql)
- **Corrections.** Before that count, use "Correggi il carico di …" on the screen: it reverses the whole location's carico with a reason, and
  its rows come back to the draft to be fixed and confirmed again. After the count, correct quantities with a count, and costs with the next
  invoice. (test: supabase/tests/database/413_reverse_opening_stock.test.sql)
- **No lots, no use-by.** Carico stock has no lot and gets no expiry alerts; the venue checks those dates by hand until invoices arrive.
- **The cost.** The carico's unit cost is used only while the ingredient has no invoice price; from the first approved invoice the invoice
  price is used and the carico cost is ignored, never averaged. (test: supabase/tests/database/414_opening_cost_fallback.test.sql)
- **The date.** The "Data del carico" is at most today and at most 366 days back, and not after the location's first invoice receipt (the
  receipt's own day is allowed). An owner confirming a carico in the same instant an invoice for that location is approved can end up with
  a carico dated after the first receipt: it is visible in the history and can be corrected by reversal before the first monthly count.
- **Onboarding by DigiAlto.** DigiAlto enters the carico as admin only with the owner's agreement; every booking and every reversal is in the
  activity log (`stock.opening_posted`, `stock.opening_reversed`).
- **Costs are IVA esclusa**, per base unit (kg, l, pz), like invoice prices.
- **Two devices.** A draft line saved on another device while this one confirms the same location can come back into the draft after the
  confirmation (the last write wins). After confirming, reload the draft: if a location that was just booked shows lines again, check them
  before confirming again.

## Comanda per uscita

The waiter sends a table once ("Invia comanda"); dishes are grouped in uscite and the later ones wait in the kitchen until "Via la n". The
design is in `docs/adr/adr-049-comanda-per-uscita.md`.

- **Deploy outside service.** The migration that places the open tables' lines (M5) locks the order lines for a few milliseconds and must
  run with the room closed. Afterwards **every phone and the kitchen screen close the app and reopen it**, so they load the new version;
  until then an old phone keeps working with today's buttons, and its queued dishes keep their meaning ("Invia a seguire" still calls the
  2ª at once). (test: supabase/tests/database/423_uscita_open_sessions.test.sql)
- **Reload the kitchen screens after the kitchen deploy (M6).** From this deploy a kitchen comanda is one uscita, not one course. The
  migration and the new app go out together outside service: between the migration and the new app going live the kitchen list answers an
  error, and a kitchen screen still on the old version shows the error page at its next refresh (its comande have no course any more), and
  its "Chiudi comanda" is refused ("Richiesta non valida.", nothing saved). Nothing is lost: close and reopen the app on every kitchen
  device, online, right after the deploy. The open tables' closed comande are carried over to the new key by the migration.
  (test: tests/app/api/kitchen-ticket-mark.test.ts)
- **Reading the calls.** Every "Via la n" is one row of `uscita_call` (session, uscita, when, who, cause): `call` is a waiter's tap,
  `fire_now` a send from an old phone, `migration` the deploy. Rows are never changed or deleted.
  (test: supabase/tests/database/421_uscita_fire_call.test.sql)
- **A dish that waits and is not wanted.** Before its uscita is called, a held dish is voided "Non preparato": its portions go back to
  stock and nothing is counted as waste. After the call, the usual reasons apply. (test: supabase/tests/database/422_uscita_void.test.sql)
- **`uscita_waiting`.** A table cannot be closed while an uscita is still waiting: call it, or void its dishes "Non preparato", then close.
  The message lists the waiting dishes.

## SP2 rollout (memberships)

One login can belong to several venues (`app_user` keyed by `(tenant_id, auth_id)`), and the sign-in hook gives the tenant claim from the venue the
person selected. The plan is `docs/plans/2026-11-26-sp02-memberships.md`. **Do not merge the hook migration (PR 2) before the hosted SP0 run has passed
T1.H and T3.H**: a push to `main` migrates hosted staging.

- **What changes at deploy.** The hook's e-mail branch. Every token issued or refreshed after the migration goes through it (tokens live 3600 s).
  Nobody is signed out: until the first second membership exists, every login has one active row, and the hook gives exactly today's claims.
  (tests: supabase/tests/database/003_access_token_hook.test.sql, supabase/tests/database/085_access_token_hook_pin.test.sql, supabase/tests/database/431_sp2_memberships_hook.test.sql)
- **Order.** Staging first (`deploy-staging`), then the smoke list below. Then production **on a day the founder names with no service**:
  `deploy-production` (migrations), promote the Vercel build, run `scripts/check-headers.ts`, run the smoke list again. The release order is the one
  in "Releases".
- **Smoke list.** Each on a phone: an owner signs in with the password and the second-factor code and lands on Oggi; a PIN sign-in on an enrolled
  device; a waiter opens `/tavoli`; a token refresh (leave the app open for an hour, or sign in again) keeps the same venue. With a test login that
  holds two venues (made with `create-tenant --existing-owner-id`): the sign-in goes to "Scegli il locale", a pick lands on the page it came from, the
  header shows the venue switcher, and a switch shows the other venue's name and none of the first venue's data.
  (tests: e2e/tenant-switch.spec.ts, tests/integration/memberships.int.ts)
- **Adding a second venue to a login.** Only the founder, with the script: `create-tenant --existing-owner-id <uuid>` (a uuid only; no auth user is
  created or deleted). A PIN login can never get a second venue. (test: tests/scripts/create-tenant.test.ts)
- **Fix-forward, if the new hook misbehaves.** A migration that restores the M11 hook body (not committed; prepare it from the M11 migration). It is
  valid only while no login has two active rows. Run this first, and apply it only if it returns 0:

  ```sql
  select count(*) from (
    select auth_id from public.app_user where is_active group by auth_id having count(*) > 1
  ) x;
  ```

  With a count above 0, do not restore the old body: a person with two venues would lose the second one. Fix the hook forward instead.
  (test: tests/config/sp2-hook-pin-branch.test.ts)
- **A person sees "Scegli il locale" and cannot continue.** The login has two or more venues and chose none, or the chosen venue was deactivated.
  They pick one. If the list is empty, their account is enabled for no venue (an owner can enable it again).

## Go-live day

The go-live gate is 12 January. Before it, with the founder:

1. The production Supabase project (Free) exists, with the database password in the password manager, and the GitHub environments
   `production`, `production-backup` and `staging` are filled as above.
2. Run "Deploy production database" and approve it.
3. In the production project: sign-ups off, Email on, the Access Token hook `app.custom_access_token_hook`, the Site URL and the redirect
   URLs set to the production address plus `/api/auth/callback**`, and the Resend SMTP credentials.
4. In the production project's Vault: `app_base_url` (the production address), `cron_secret` (the same value as `CRON_SECRET` in Vercel)
   and, while the address is a protected `*.vercel.app` host, `vercel_protection_bypass` (the same value as
   `VERCEL_AUTOMATION_BYPASS_SECRET`). Do the same on staging.
5. Vercel Production variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `PIN_PEPPER`,
   `CRON_SECRET`, `ANTHROPIC_API_KEY`, `EXTRACTION_MODEL_ID`. All new, never staging's. Then redeploy.
6. The custom domain (Q188) is added and serving production. Then delete `vercel_protection_bypass` from the production Vault and set
   `app_base_url` to the domain.
7. Make the production tenant (the `create-tenant` job of `platform-ops`, with its four secrets, see "Where every secret lives"), then enrol the staff phones with the owner (the two staff sheets above).
8. Run "Daily backup" and "Weekly restore check" on staging, then on production; check the database copy, an `osteria-files-` pack (once
   there is an invoice) and an `osteria-files-manifest-` file are in Drive, and the minutes are noted.
9. Run the header check against production. Walk `docs/go-live/checklist.md` and keep its evidence.
10. On a real iPhone against staging: open the comanda once online, then reload it in flight mode. It must still show the table.
