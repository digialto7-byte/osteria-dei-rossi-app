# Tech plan — Osteria Digitalization · P2-0, go-live carry-overs

- **Client slug / internal:** `osteria-dei-rossi`. **Client facts used:** none. No step needs a name, price, URL or legal text.
- **Repo and branch:** `osteria-dei-rossi-app`, worktree `/home/user/osteria-p20`, branch `feat/p2-0-golive-carryovers`, from `main` `b473e9f`.
- **Source of the scope:** `docs/plans/2026-11-11-phase2-scope.md` Part 3 row P2-0; §2.5.1 F1, F2, F12, F26, F45; §2.5.2 "Before go-live" rows; §4.2 OQ-2.
  Also `docs/go-live/phase1-closeout.md`, `docs/go-live/checklist.md`, `docs/go-live/csp-impact.md`, `docs/plans/2026-11-01-m25-go-live.md` (§3.1.14, step 21, G-items), `docs/plans/2026-11-08-a5b-raw-stock-business-date.md`, ADR-033.
- **Not a milestone:** P2-0 has no `M<NN>`. The lead allows more than one PR when the items are unrelated, so this plan ships as **two PRs** (§5, "PR split").
- **Numbering:**
  - migration: **`20261129100000_supplier_item_mapping_update_revoke.sql`**. Main's newest is `20261128100600_affected_recipe_keys_bfs.sql` (directory listing of this worktree). The `20261128` prefix is avoided on purpose: `tests/config/reservations-preserves.test.ts` treats every `20261128*` file as a reservations PR2 migration and pins that list exactly. If `main` gains a newer migration before PR A merges, the file is renamed to sort after it (lead rule, 2026-11-09);
  - pgTAP: `303` (main's newest is `302_affected_recipe_keys_plan.test.sql`);
  - questions **Q-P0-1…Q-P0-5**; variants **V1–V4**; steps **A0–A3** (PR A) and **B1–B5** (PR B); founder steps **FS-1…FS-5**.
- **ADR:** none. F12 carries out the open item already written in the M4 plan (§3 point 3: "revoke it once the supplier screen writes through a procedure"); it is a small privilege change, not a new decision. V1, if chosen, stays within that decision.
- **Author:** architect · **Date:** 2026-11-11

## 1. Goal and scope

- **Goal:** close the code and document items that must be finished before the production go-live (F1, F2, F12, F26, F45), and list the answers the founder, the accountant and the chef still owe (§2.5.2 and OQ-2), so nothing go-live-critical is left without an owner.
- **In scope:**
  - F1/F2: verify against `main` that A5b and the index drop are merged, with evidence (no new work if verified);
  - F12: revoke the direct UPDATE of the mapping-memory columns of `supplier_item` from `authenticated`, pgTAP test first;
  - F26: a measurement document with a decision rule fixed in advance, filled by the founder from the extraction log lines that already exist; no change in `src/`;
  - F45: fill what can be filled in `docs/go-live/csp-impact.md` from the code and a local build (policy as built, third-party origins, guard tests, build output, requests per page open); everything that needs the real deployment stays `pending` as a founder step;
  - the "Before go-live" questions and OQ-2, grouped by who answers, with their defaults (§7.2). No code.
- **Out of scope:**
  - any change to staging (settings, data, deploys) without the founder's OK; no step of this plan touches staging by itself (merging PR A deploys to staging, §2.5, so the merge is the founder's OK);
  - handling secret values: steps name secrets and where they live, never their values;
  - the fix for a slow extraction (streaming, a longer `maxDuration`): the scope says "fix only if data shows a need", so it is planned only after F26's decision says "change";
  - the CSP verdict itself (G7-4) and the timing and usage runs (G7-1 to G7-3): founder steps;
  - G18/F43 (stale migration header): "Keep" in the scope doc, and the corrected wording is not written down in the repo (M25 §3.6 G18 only says the next migration-adding plan carries it). See §7.1, note for the lead;
  - the Q-A5b-1/2/3 defaults (A5b plan §7): they stay as answered.

## 2. Current state (checked on this worktree, `main` `b473e9f`)

**Tooling limit of this session:** I could read files but not run `git` or any other command. The lead's `git log --oneline origin/main | grep -i a5b` was therefore **not run**. The evidence below comes from the files on `main` and the local reflogs; step A0 runs the commands and must see the expected output.

### 2.1 F1 and F2: done on `main`

| Item | Status | Evidence |
|---|---|---|
| **F1** raw stock on the business day (A5b) | **Done** | Migration `supabase/migrations/20261127100000_raw_stock_business_date.sql` is on `main` (replaces `public.stock_reconciliation` and `app.weekday_consumption`; comments `stock_movement.effective_on`). pgTAP `259_raw_stock_business_date.test.sql` and `260` (named in the A5b plan) cover it; `src/server/counts/reconciliation.ts` holds A5b step 5's default date. Reflog of `fix/a5-raw-stock-business-day`: commits "A5b step 1" … "A5b step 7" (`e165972` … `a089bf0`) and the "PR #64 review" fixes (`f32bed1` … `b6f2e80`); the branch's last push was `c02f548`, and `origin/main` next moved from `8c2874f` to `10a0ab5`. The reflog alone does not prove that `10a0ab5` is the PR #64 merge; step A0 confirms it. The scope doc's "in progress on `fix/a5-raw-stock-business-day`" is out of date. |
| **F2** drop the unused index | **Done** | `supabase/migrations/20261127100100_drop_unused_effective_indexes.sql` line 9: `drop index public.batch_movement_effective_idx;` (line 10 also drops `stock_movement_consumption_idx`). The only other mention in `supabase/migrations/` is its creation in `20261108100200_dashboard_indexes.sql` line 14. pgTAP `202_dashboard_indexes.test.sql` line 13 asserts `hasnt_index … batch_movement_effective_idx`. `stock_movement_effective_idx` is **kept on purpose** (reader `app.kpi_purchases`, receipts by invoice date; pinned by `202` lines 12 and 21–22, `206` line 284, `259` G3). It is dropped only under A5b variant V1, which was not triggered (Q-A5b-1 default "yes, keep"). |

Small loose end, not P2-0 code: `docs/adr/adr-033-ledger-business-date.md` still says **Status: proposed** although A5b is merged. For the lead (§7.1).

### 2.2 F12: `supplier_item` privileges and every writer

- **Grant** (`20261021130200_supplier.sql` lines 85–98): `revoke all … from anon, authenticated`, then to `authenticated`: `select`; `insert (supplier_id, ingredient_id, supplier_code, description_hash, pack_count, pack_qty, pack_unit, pack_label, is_preferred)` (nine columns, `description_hash` included; pgTAP 303 P5 pins the real list); and **`update (ingredient_id, supplier_code, description_hash, pack_count, pack_qty, pack_unit, pack_label, is_preferred, is_active)`**. RLS (lines 111–120): select, insert and update for owner and admin only. `last_price` and `invoice_unit` have no API grant (`020` line 227: an `invoice_unit` UPDATE gives `42501`). No later migration changes these grants (grep of `grant|revoke … supplier_item`).
- **Writers in SQL** (grep `update public.supplier_item` / `insert into public.supplier_item`, newest definitions):

  | Writer | Mode | Columns it writes | Affected by the revoke? |
  |---|---|---|---|
  | `public.review_update_line` (`20261022130900_mapping_decisions.sql` line 72) | SECURITY DEFINER (line 75) | remaps `ingredient_id`, `is_active`, pack, `invoice_unit` (lines 252–261, 315–318); inserts items with `supplier_code` or `description_hash` (lines 274–280) | No (runs as the function's owner) |
  | `public.review_set_supplier` (same file, line 351), `app.automap_*` | SECURITY DEFINER, or called from a definer or `service_role` | map lines from items | No |
  | `public.approve_invoice` (`20261023110600_approve_invoice_variance.sql` line 204) | SECURITY DEFINER (line 207) | `last_price` | No |
  | `public.set_ingredient_rules` (`20261030100200_rules_settings_procedures.sql` lines 107–111, 182–185) | SECURITY DEFINER | `is_preferred` | No |
  | `public.set_preferred_supplier_item` (`20261021130200_supplier.sql` lines 124–145) | **SECURITY INVOKER** | `is_preferred` | Only if `is_preferred` lost its grant (it keeps it in the default design) |

- **Writers in TypeScript** (grep `supplier_item` in `src/`, `scripts/`):
  - `src/server/master/supplier-items.ts` (the M1 supplier screen, `PATCH /api/supplier-items/:id`, owner and admin): `updateSupplierItem` sends only `supplier_code`, `pack_count`, `pack_qty`, `pack_unit`, `pack_label`, `is_active`, `is_preferred` through `updateRow`, and calls `set_preferred_supplier_item` for `isPreferred: true`. `updateSupplierItemBody` has **no** `ingredientId` and no `descriptionHash` (lines 94–110), and bodies are parsed strictly (`src/lib/api/with-api.ts` line 115), so such keys are refused with 400. `createSupplierItem` inserts `supplier_id, ingredient_id, supplier_code, pack_*` (unchanged by this plan).
  - `scripts/lib/demo/seed.ts` lines 487–497: reads items and calls `set_preferred_supplier_item`.
  - `src/server/invoices/review.ts`: reads only.
  - `scripts/test-db-races.sh`: changes items only through `review_update_line` / `review_set_supplier` (cases `relink`, `code`).
- **Conclusion:** no legitimate path updates `supplier_item.ingredient_id` or `description_hash` directly as `authenticated`. Those two columns are the mapping memory (`(supplier, code or description hash) → ingredient`). The supplier screen legitimately edits code, pack, label, active and preferred.
- **Tests that pin migration lists:** `tests/config/m25-preserves.test.ts` and `tests/config/m25a-preserves.test.ts` (`LAST_MIGRATION = "20261128100600_affected_recipe_keys_bfs.sql"`), `tests/config/m25b-preserves.test.ts` (`ALLOWED_NEW_MIGRATIONS`, last entry `20261128100600…`). `tests/config/reservations-preserves.test.ts` filters on `20261128*` (avoided). `m19`, `m19b`, `m20`, `m22`, `m23`, `m24`, `m25c` filter on their own prefixes and are unaffected. The pgTAP preserves files (`207`, `214`, `222`, `229`, `240`, `286`, `296`, `301`) pin purge lists and function bodies; a column revoke changes neither.
- **Tests that touch the granted columns today:** `007_master_roles` line 76 (`last_price` refused), `008_master_constraints` lines 68–76 (a direct `is_preferred` update gives `23505`; `set_preferred_supplier_item` works as `authenticated`), `020` lines 213–227 (`invoice_unit` refused). None updates `ingredient_id` or `description_hash` directly.

### 2.3 F26: what the extraction already logs

- `src/server/extraction/extract.ts` lines 40–41 and 60–97: every call writes one `console.warn` JSON line `{"event":"extraction", …}` with `outcome`, `stopReason`, `requestId`, `inputTokens`, **`outputTokens`**, `effort`, **`durationMs`**, plus `flags` (gate-flag codes) on success, and `status`, `errorType`, `errorMessage` (the API's own message, cut to 300 characters, `outcome.ts` line 90) on a thrown error. No invoice content, no supplier name, no amount, no file path, no invoice id.
- The caller is `src/server/cron/extract-job.ts` line 153, behind `src/app/api/cron/extract/route.ts` (`maxDuration = 120`).
- Nothing stores the timings in the database (grep of `supabase/migrations/` for `duration`/`tokens`).
- Limits in `src/server/extraction/constants.ts`: `EXTRACTION_TIMEOUT_MS = 90_000`, `EXTRACT_MAX_DURATION_S = 120`, `EXTRACTION_MAX_TOKENS = 36_000`, `MAX_EXTRACTED_LINES = 200`; line 25: "The estimates are not measured yet; the extraction log records inputTokens, outputTokens, durationMs and effort."
- Outcome codes (`src/server/extraction/outcome.ts` lines 5–13): `provider_timeout`, `provider_unavailable`, `provider_rate_limited`, `provider_auth`, `provider_rejected`, `refused`, `output_truncated`, `schema_invalid`; success is `ok`.
- **So F26 needs no instrumentation.** It needs real invoices extracted on staging and someone to read the log lines. Whether staging has extracted invoices recently, and how long Vercel keeps those logs, cannot be seen from the repo.

### 2.4 F45: `docs/go-live/csp-impact.md` and its test

- Every result cell is `pending`; `Verdict: pending`. Its test `tests/config/csp-impact-doc.test.ts` pins: the six `##` headings exactly; the table rows and columns; integer-or-`pending` cells; the "Pre-rendered routes after" line equal to `PRERENDERED` in `e2e/security-headers.spec.ts` (`["/_global-error", "/manifest.webmanifest"]`); the stop rule S1–S3 computed from the doc's numbers; "Verdict: pending" today; the checklist line "csp-impact.md, now pending"; no secret-like text.
- **Fillable from the repo, without the deployment:** the build route counts (a local `npm run build` on `b215326` and on today's `main`), the requests per page open (the `page-requests.json` attachment of `e2e/security-headers.spec.ts`, run locally), and a description of the policy as built.
- **Needs the real deployment (founder):** staging timings B0 and A (`perf-order-entry.yml`, `perf-dashboard-4g.yml`, after S8-16), the Usage page at B0 and A + 7 days, the per-device estimate from the A run, the limit warning and the verdict (checklist G7-1 to G7-4).
- **New finding:** M25 (PR #44) is already on `main`, so a B0 "on `main` before merge" can no longer be taken: staging now serves the nonce policy. The repo shows no B0 (checklist G7-1 "to fill"). → Q-P0-4.
- **Production is on Vercel Pro** (close-out, founder decision 3, 2026-11-08); staging may stay on Hobby. The doc's usage section is titled and pinned "Vercel Hobby usage". → Q-P0-5.
- **The policy as built** (`src/lib/security/csp.ts`, ADR-028): `default-src 'self'`; `script-src 'self' 'nonce-<n>' 'strict-dynamic'` on pages (`'self'` only on `/api/*`, `/sw.js`, the manifest and paths the proxy skips; `'unsafe-eval'` only under `next dev`); `style-src 'self' 'unsafe-inline'`; `img-src 'self' <supabase-origin>`; `frame-src <supabase-origin>`; `font-src`, `connect-src`, `worker-src`, `manifest-src` `'self'`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'`; `upgrade-insecure-requests` on production and preview.
- **Third-party origins in the browser policy:** only the Supabase project origin, in `img-src` and `frame-src` (invoice photos and the PDF frame). The browser calls only `/api/*` (`connect-src 'self'`, guard `tests/guards/no-browser-supabase.test.ts`). A grep of `src/` for `http(s)://` literals finds outbound **server-side** calls only: `https://api.resend.com` in `src/server/mail/resend.ts`, the Anthropic SDK in `src/server/extraction/client.ts`, and Supabase; the other hits are comments and font licence files.
- **CSP guard tests that exist:** `tests/lib/security/csp.test.ts`, `tests/lib/security/nonce.test.ts`, `tests/proxy-csp.test.ts`, `tests/lib/security-headers.test.ts`, `tests/config/next-config-headers.test.ts`, `tests/app/root-layout.test.ts`, `tests/lib/security/header-check.test.ts` (with `scripts/check-headers.ts`, AT2), `tests/guards/no-raw-html.test.ts`, `tests/guards/no-browser-supabase.test.ts`, `tests/guards/public-page-csp.test.ts`, `e2e/security-headers.spec.ts`, `e2e/pwa.spec.ts` (with `e2e/helpers/csp.ts`).

### 2.5 Staging deploys

`.github/workflows/deploy-staging.yml` runs on every successful CI push to `main` (`workflow_run`, lines 8–12). **Merging PR A therefore applies its migration to staging.** The merge is the founder's OK for that change (§8, FS-5).

## 3. Design

### 3.1 F12: revoke the mapping-memory columns only (default)

- **Migration `supabase/migrations/20261129100000_supplier_item_mapping_update_revoke.sql`**, the two statements below (the UPDATE revoke, and the INSERT revoke of `description_hash` explained in the INSERT bullet):

  ```sql
  revoke update (ingredient_id, description_hash) on public.supplier_item from authenticated;
  revoke insert (description_hash) on public.supplier_item from authenticated;
  ```

  - Header comment: F12 (scope doc §2.5.1) and M4 plan §3 point 3; the writers checked in §2.2 of this plan; what stays granted and why (the M1 supplier screen edits code, pack, label, active and preferred; `set_preferred_supplier_item` is SECURITY INVOKER and needs `is_preferred`); `service_role` and the definer procedures are unaffected.
- **What it achieves:** an owner or admin can no longer remap a remembered article to another ingredient, or plant a description hash, outside `review_update_line`. The mapping memory changes only through the review flow, which also propagates and locks (M4 §3.1). Roles stay enforced in Postgres (CLAUDE.md invariant).
- **What it leaves (accepted; V1 closes it):** owner and admin can still edit an item's `supplier_code`, pack, label, `is_active` and `is_preferred` from the supplier screen. That is the M1 master-data feature, limited by RLS to owner and admin; it changes which article a future line matches by code, never which ingredient an article means.
- **INSERT: the `description_hash` gap is closed (lead's request, 2026-11-11, in this PR).** The same migration also runs `revoke insert (description_hash) on public.supplier_item from authenticated;`, so it holds exactly two statements and the `p2-0-preserves` pin lists both. `createSupplierItem` never sends `description_hash` (checked in `src/server/master/supplier-items.ts`), and `review_update_line`, which writes it, is SECURITY DEFINER. pgTAP 303 pins the eight remaining INSERT columns (P5) and shows a direct INSERT with a hash refused for owner and admin (I1, I2), the normal create still working (I3 to I5) and the review procedure still setting the hash (R7).
  - **`ingredient_id` stays insertable on purpose:** every article created on the supplier screen is mapped to an ingredient, so the create path sets it; revoking it would break create.
  - Owner and admin are trusted mappers (and can already map through `review_update_line`), so this is defence in depth, not a new boundary.
- **No API change.** `PATCH /api/supplier-items/:id` never sends the two columns and refuses them in the body (§2.2); step A1 pins that.
- **Data model:** no table, column, function or index changes. Postgres checks privileges at query time, so no PostgREST reload is involved.

### 3.2 F26: measurement document, filled by the founder

- **New `docs/go-live/extraction-timing.md`** with sections exactly `## Method`, `## Runs`, `## Decision`:
  - **Method:** the founder (after Q-P0-2) uploads the chosen invoices on staging, then in Vercel → the staging project → Logs, filters on the `/api/cron/extract` function and the text `"event":"extraction"`, and copies **only** these fields of each line: `outcome`, `outputTokens`, `durationMs`, `effort`; plus `lines` = the number of lines the review screen shows for that invoice (a count). Never copy `requestId`, `errorMessage`, `flags` or anything from the invoice. Read the logs the same day: their retention depends on the Vercel plan and is read on the dashboard, not assumed here.
  - **Runs:** table with columns exactly `run | outcome | lines | outputTokens | durationMs | effort`; `run` is 1, 2, 3…; each number an integer or `pending`; `outcome` one of the codes of §2.3, `ok`, or `pending`.
  - **Decision rule (fixed before any number; default of Q-P0-3):** a change is needed when any run's outcome is `provider_timeout` or `output_truncated`; or, over the `ok` runs, `max(outputTokens / lines) × MAX_EXTRACTED_LINES ≥ EXTRACTION_MAX_TOKENS`; or `max(durationMs / lines) × MAX_EXTRACTED_LINES ≥ EXTRACTION_TIMEOUT_MS`. The constants come from `src/server/extraction/constants.ts`; no number is written here. The linear projection is a simple screening rule, not a model of the API.
  - **Decision line:** exactly one `Decision: pending | no change | change: <reason>`. `no change` is refused while the rule holds or while no `ok` run exists; `pending` is refused once runs exist and no cell is pending.
- **Why no code:** the log already carries the two numbers (§2.3), and the line count is on the review screen. Adding an invoice id or line count to the log would link log lines to rows for no gain.

### 3.3 F45: fill what the repo can prove; leave the rest to the founder

- **A "Policy as built" block** in the intro of `docs/go-live/csp-impact.md` (bold label lines, **no new `##` heading**, because the test pins the six headings and the founder's later PR expects that shape):
  - the directive list of §2.4 and where it is built (`src/lib/security/csp.ts`, `src/proxy.ts`, `next.config.ts`, ADR-028);
  - the line ``Third-party origins in the browser policy: `<supabase-origin>` in `img-src` and `frame-src`, nothing else.``;
  - the server-side outbound services, named as not part of the browser policy (Supabase, Anthropic API, Resend API);
  - the guard tests of §2.4, each by path.
- **Build output:** `before (b215326)` from a local build of `b215326`; `after` from a local build of the PR's base on `main`, with a new line `After commit: <sha>` (M25's branch head no longer exists as such; today's `main` is what goes to production and includes the routes added after M25). Static (○) and dynamic (ƒ) counts from the route table; the pre-render list line stays the pinned one.
- **Requests per page open:** the three counts from the `page-requests.json` attachment of a local `npx playwright test e2e/security-headers.spec.ts --project phone` run on `main`, read from the Playwright report.
- **Stays `pending`:** staging timings, usage, the estimate figures, the limit warning, the verdict. The intro sentence that names the filling PR becomes: policy, build and request sections by PR B; the timing, usage, estimate and verdict cells by `docs/m25-csp-impact` after the founder's runs.

### 3.4 Sequence

1. PR A: A0 → A1 → A2 → A3; the founder merges (FS-5) → CI → staging migration.
2. PR B (independent of A): B1 → B2 → B3 → B4 → B5; merged.
3. Founder: Q-P0-2 and Q-P0-3 → FS-2 (F26 runs) → a docs PR fills `extraction-timing.md`. Q-P0-4 → FS-3 and FS-4 → `docs/m25-csp-impact` fills the rest of `csp-impact.md` and the verdict (G7-4).

### 3.5 Security and privacy

- **Auth:** F12 tightens Postgres privileges; RLS unchanged; tenant isolation unchanged (the definer procedures already filter `tenant_id = app.tenant_id()` and have cross-tenant cases in `023`).
- **Secrets:** none added or read. Where the relevant ones live (`docs/runbook.md` lines 48–49 and 77, checklist S8-16): `ANTHROPIC_API_KEY` and `EXTRACTION_MODEL_ID` in the Vercel environment (server only) and the GitHub environment `extraction-contract`; `VERCEL_AUTOMATION_BYPASS_SECRET` in the GitHub environment `staging` and as `vercel_protection_bypass` in Supabase Vault; the Vercel, Supabase, Anthropic and GitHub account logins in each owner's password manager (runbook "Accounts and access"; owners still "to fill in", Q26). The founder steps check that a variable **name** exists, never its value.
- **Personal data:** F26 copies counts and codes only; the doc test refuses extra columns and secret-like text. Real supplier invoices may hold personal data (for example a sole trader's name); sending them to the extraction provider from staging is the founder's decision (Q-P0-2) and depends on the open Anthropic-terms check (close-out §3, PR #8) and DPA-1.
- **Documents:** both docs pass the repo's secret regex in their tests; never paste a header, nonce or key (rule already in `csp-impact.md`).

## 4. Alternatives considered

- **F12, revoke every UPDATE and move the supplier screen to a procedure** — not the default: larger (a new definer function, `set_preferred_supplier_item` rewritten, `008` changed, API rewired) for columns that do not change what an article means. Kept as **V1** (Q-P0-1).
- **F12, a trigger that refuses mapping changes unless a procedure set a session flag** — rejected: a session-setting bypass is easy to get wrong and is more code than a column revoke that Postgres enforces.
- **F12, an RLS policy instead of a privilege** — rejected: an UPDATE policy cannot compare old and new column values.
- **F26, add `invoiceId` and `lineCount` to the log** — rejected: the numbers are already logged; ids would link log lines to rows; the line count is on the review screen.
- **F26, store timings in a table** — rejected: a migration and stored data for a one-off measurement.
- **F45, a new `## Policy as built` section** — rejected: the test pins six headings; changing the shape the founder's PR expects adds churn. The intro block plus a test that recomputes the origins gives the same guarantee.
- **F45, redeploy a pre-M25 commit on staging to take B0 now** — rejected as a plan step: it is a staging change, and that old app code would run against a database many migrations newer; whether it even works is unverified. The founder may still choose it (Q-P0-4 lists it), but it is not designed here.
- **One PR for everything** — rejected: PR A is a database privilege change that needs pgTAP, the race script and a security-focused review; PR B is documents and doc tests whose remaining cells wait days for the founder. Keeping them apart lets the go-live-critical revoke merge without waiting on measurements.

## 5. Build plan (test first: each step's named test is written and seen failing, then the code; one commit per step)

### PR split

- **PR A — `feat/p2-0-golive-carryovers` (this branch):** this plan + F12 (migration, pgTAP, pins). Steps A0–A3.
- **PR B — `docs/p2-0-csp-and-extraction-timing`, from `main`:** F45 (partial fill of `csp-impact.md`, doc test extended) + F26 (measurement doc and its test). Steps B1–B5. It changes `.ts` test files, so CI's required checks run (no `paths-ignore` hang, F51).
- **Why split:** unrelated areas (Postgres privileges vs go-live documents), different review focus, and PR B's last cells depend on founder runs while PR A does not. Each PR is independently deployable; neither touches the other's files.

### PR A — F12

| # | Step | Files | Test that proves it |
|---|---|---|---|
| A0 | **Base check (no code).** Confirm F1/F2 and the numbering on the real repo. | none | Commands and expected output: `git log --oneline origin/main \| grep -i a5b` lists the A5b steps and the PR #64 merge (its SHA goes into the PR description); `ls supabase/migrations \| tail -1` = `20261128100600_affected_recipe_keys_bfs.sql` (if not, A2's file is renamed to sort after the newest, avoiding any prefix another preserves test filters on); `grep -rn batch_movement_effective_idx supabase/migrations` shows only `20261108100200` (create) and `20261127100100` (drop); `npx supabase test db` runs `202` green. |
| A1 | **Guard: the supplier screen never sends a mapping column.** Written first; it passes on `main`, which is the precondition A2 relies on. It is seen red once through a scratch edit (adding `ingredientId` to `updateSupplierItemBody` and to the `columns` object), not committed. | `tests/app/api/master/supplier-items.test.ts` | Vitest (bodies are parsed strictly, `src/lib/api/with-api.ts` line 115, as the existing "supplierId cannot be changed" case shows): as owner, `PATCH /api/supplier-items/:id` with `{ "ingredientId": "<uuid>" }` → 400 `invalid_request` and `client.query.update` not called; the same for `{ "descriptionHash": "<64 hex>" }` and for `{ "ingredientId": "<uuid>", "packLabel": "cassa" }`; `{ "packLabel": "cassa" }` → 200 with `update` called with exactly `{ pack_label: "cassa" }`. Existing cases unchanged. |
| A2 | **Write pgTAP 303 (red), then the migration; pins move on purpose.** | `supabase/tests/database/303_supplier_item_mapping_grant.test.sql` (new); `supabase/migrations/20261129100000_supplier_item_mapping_update_revoke.sql` (new); `tests/config/m25-preserves.test.ts`, `tests/config/m25a-preserves.test.ts` (`LAST_MIGRATION` + one comment line "P2-0 F12"); `tests/config/m25b-preserves.test.ts` (`ALLOWED_NEW_MIGRATIONS` + comment); `tests/config/p2-0-preserves.test.ts` (new) | **303** (fixtures in the style of `023`: tenants "Osteria Demo A/B"; owner, admin, chef, waiter of A; owner of B; ingredients Manzo and Vitello; supplier "Fornitore Demo Srl"; item `MAN-1` → Manzo; an invoice in `review` with the supplier linked and three lines: code `MAN-1`, code `NEW-1` with unit `kg`, and one without a code with unit `kg`). **P (privileges):** `not has_column_privilege('authenticated', 'public.supplier_item', 'ingredient_id', 'UPDATE')`; the same for `description_hash`; `not has_table_privilege('authenticated', 'public.supplier_item', 'UPDATE')` (a table-level grant would void a column revoke); `has_column_privilege(…, 'UPDATE')` still true for `supplier_code`, `pack_count`, `pack_qty`, `pack_unit`, `pack_label`, `is_preferred`, `is_active`; INSERT privileges unchanged (true for the eight M1 columns, false for `description_hash`, `last_price`, `invoice_unit`); `anon` has no column privilege on the table. **D (direct writes):** as owner A, `update public.supplier_item set ingredient_id = <Vitello>` → `42501`; `set description_hash = repeat('a', 64)` → `42501`; the same two as admin A → `42501`; after `reset role`, `MAN-1` still points at Manzo and its hash is unchanged; as owner A, `update … set pack_label = 'cassa'` and `set is_active = false`, then `true`, live and change the row; `select public.set_preferred_supplier_item(<MAN-1>)` lives. **R (review procedures still work, as owner A):** `review_update_line(inv, <MAN-1 line>, '{"ingredient_id":"<Vitello>"}')` lives, `MAN-1.ingredient_id` = Vitello and the line's `supplier_item_id` = `MAN-1`; the `NEW-1` line mapped to Manzo creates exactly one new item with code `NEW-1`; the line without a code mapped to Manzo creates an item whose `description_hash = app.description_hash(raw_description)`; a pack change on a mapped line updates the item's pack. Before the migration, sections P and D fail (red); R passes before and after. **Unchanged and green:** `007`, `008`, `020`, `022`, `023`, `025`, `035`, `142`. **`p2-0-preserves.test.ts`:** the migration files sorting after `20261128100600_affected_recipe_keys_bfs.sql` are exactly `["20261129100000_supplier_item_mapping_update_revoke.sql"]`; that file, with comments and whitespace removed, is exactly the two statements `revoke update (ingredient_id, description_hash) on public.supplier_item from authenticated;` and `revoke insert (description_hash) on public.supplier_item from authenticated;`; a self-test on a temp directory with an extra file fails. **Pins:** `m25`, `m25a`, `m25b` preserves green with the new name. |
| A3 | **Verification and security walk.** | PR description only | `npm ci`; `npx supabase start`; `npx supabase db reset`; `npx supabase test db` (all green, `303` included); `npm test`; `npm run test:integration` (`review.int.ts` maps, propagates and approves over PostgREST as owner); `bash scripts/test-db-races.sh` (cases `relink`, `code`, `crossed-items` green); `npx tsc --noEmit`; `npm run lint`; `npm run format:check`; `npm run build`; `npx playwright test` (CI). Security checklist "Auth and access" walked for the change (authorisation enforced in Postgres; no new endpoint). Dependency audit unchanged (no package added). New code is SQL and tests only; no new `src/` lines, so the 80% coverage rule has nothing new to measure. |

### PR B — F45 and F26

| # | Step | Files | Test that proves it |
|---|---|---|---|
| B1 | **Doc test first: the "Policy as built" block (red), then the block.** | `tests/config/csp-impact-doc.test.ts` (extended on purpose); `docs/go-live/csp-impact.md` (intro block and the sentence naming the filling PRs) | New cases: the intro (text before the first `##`) contains a line starting `Third-party origins in the browser policy:`; the test builds `buildCsp({ supabaseOrigin: "https://abc.supabase.co", deployment: "production", dev: false, nonce: "AAAAAAAAAAAAAAAAAAAAAA==" })` (imported from `src/lib/security/csp.ts`), collects every source token matching `^https?://` with its directive, and expects exactly `[["img-src", "https://abc.supabase.co"], ["frame-src", "https://abc.supabase.co"]]`; the backticked directive names on the doc line equal `["img-src", "frame-src"]`. The intro names `src/lib/security/csp.ts` and `ADR-028`. Every backticked path in the doc under `src/`, `tests/`, `e2e/`, `scripts/` or `docs/` exists. Existing cases unchanged, including "today it is pending" and the six headings. |
| B2 | **Build output filled.** DigiAlto builds `b215326` (a separate worktree, `.env.example` fakes) and the PR's base on `main`, and copies the counts. | `docs/go-live/csp-impact.md`; `tests/config/csp-impact-doc.test.ts` (one new case) | New case: the Build output section has exactly one line matching `^After commit: [0-9a-f]{7,40}$`. Existing case: `static` and `dynamic` hold integers or `pending` in both columns. The pre-render line is unchanged (still equal to `PRERENDERED`). If the old commit does not build with the fakes, `before` stays `pending` and the PR says why (no number is guessed). |
| B3 | **Requests per page open filled** from a local run of `npx playwright test e2e/security-headers.spec.ts --project phone` on `main` (the `page-requests.json` attachment in the report). | `docs/go-live/csp-impact.md` | Existing case: `documents`, `RSC requests`, `prefetches` are integers. The PR description states it is a local run, not staging. |
| B4 | **F26 measurement doc: test first (red), then the doc** with every cell `pending` and `Decision: pending`. | `tests/config/extraction-timing-doc.test.ts` (new); `docs/go-live/extraction-timing.md` (new) | Headings exactly `Method`, `Runs`, `Decision`. Runs header exactly `run, outcome, lines, outputTokens, durationMs, effort`; each numeric cell an integer or `pending`; `outcome` is `ok`, `pending` or one of the `FailureCode` literals parsed from `src/server/extraction/outcome.ts` (so a new code shows up in the test); no column named `requestId`, `errorMessage`, `flags`, `supplier`, `description` or `amount`. The Method section names `"event":"extraction"` and says never to copy `requestId` or `errorMessage`. Exactly one line matching `^Decision: (pending\|no change\|change: .+)$`. The rule of §3.2 is computed with `EXTRACTION_MAX_TOKENS`, `EXTRACTION_TIMEOUT_MS` and `MAX_EXTRACTED_LINES` imported from `src/server/extraction/constants.ts`. On documents derived from the real one: a filled doc with small numbers and `no change` passes; a `provider_timeout` run, an `output_truncated` run, a tokens-per-line projection equal to `EXTRACTION_MAX_TOKENS`, and a ms-per-line projection equal to `EXTRACTION_TIMEOUT_MS` each make `no change` refused; `no change` with zero `ok` runs is refused; `pending` with no pending cell is refused; `change:` without a reason is refused. The secret regex of `csp-impact-doc.test.ts` finds nothing. |
| B5 | **Verification.** | PR description only | `npm ci`; `npm test` (both doc tests green, the rest unchanged); `npx tsc --noEmit`; `npm run lint`; `npm run format:check`. No migration, no `src/` change, no dependency. |

### Acceptance checks per item

| Item | Done when | Proof |
|---|---|---|
| F1 | A5b is on `main` | A0's `git log` shows the PR #64 merge; `259`, `260` green |
| F2 | `batch_movement_effective_idx` is gone; `stock_movement_effective_idx` kept on purpose | A0 grep; `202` green |
| F12 | `authenticated` cannot UPDATE `ingredient_id` or `description_hash`; the supplier screen and the review procedures still work | `303` (P, D, R), A1, `023`, `008`, `review.int.ts`, the race script (A3) |
| F26 | The measurement doc and its rule are on `main`; then the founder's runs set `Decision` to `no change` or `change: …` | B4's test; FS-2. A `change` starts a new plan (not designed here) |
| F45 | Policy, origins, build and request sections filled and tested; the remaining cells and the verdict filled from the founder's runs; G7-4 is not "stop" | B1–B3; FS-3, FS-4 in `docs/m25-csp-impact` |
| §2.5.2, OQ-2 | Each question in §7.2 answered or its default confirmed | The lead records them in DigiAlto-Ops `clients/osteria-dei-rossi/context.md` |

### 5b. Variants

**V1 — Every direct UPDATE of `supplier_item` goes through a procedure** · Trigger: Q-P0-1 answered "all of it" · Replaces: step A2's migration statement, its sections P and D, and its `p2-0-preserves` statement check (A0, A1, A3 stay)

| # | Step | Files | Test that proves it |
|---|---|---|---|
| V1.1 | pgTAP section V (red), then the migration revokes **all** UPDATE columns of `supplier_item` from `authenticated`, adds `public.update_supplier_item(p_item uuid, p_patch jsonb)` (SECURITY DEFINER, empty `search_path`, owner/admin through `app.require_invoice_reviewer()`, `tenant_id = app.tenant_id()` filter, allowed keys exactly `supplier_code`, `pack_count`, `pack_qty`, `pack_unit`, `pack_label`, `is_active`, and `is_preferred` = false), and re-creates `set_preferred_supplier_item` as SECURITY DEFINER with the same role check and an explicit tenant filter. | `20261129100000_…` (renamed `…_supplier_item_update_procedure.sql`); `303_…`; `008_master_constraints.test.sql` (lines 68–70 changed on purpose: the direct update now gives `42501`; the `23505` uniqueness case moves to an insert after `reset role`); `tests/config/p2-0-preserves.test.ts` (the statement list) | 303 V: `has_table_privilege` and `has_any_column_privilege(…, 'UPDATE')` false for `authenticated`; as owner, every direct UPDATE → `42501`; `update_supplier_item` changes pack and label, refuses the keys `ingredient_id`, `description_hash`, `last_price` (`invalid_patch`), refuses chef and waiter (`42501`), answers not found for tenant B's item; `incompatible_units` (`22023`) and `supplier_item_code_uq` (`23505`) still surface; `set_preferred_supplier_item` swaps the preferred item as owner, refuses chef, cannot touch tenant B; section R unchanged and green; `008` green. |
| V1.2 | The supplier screen writes through the procedure. | `src/server/master/supplier-items.ts`; `tests/app/api/master/supplier-items.test.ts`; `tests/server/master/db-errors.test.ts` | Vitest: PATCH calls `rpc("update_supplier_item", { p_item, p_patch })` with snake_case keys and no `ingredient_id`; `isPreferred: true` still calls `set_preferred_supplier_item`; `42501` → 403, `22023 incompatible_units` → 422, a duplicate code → the same status as today. Coverage of the changed file ≥ 80%. |

**V2 — The CSP verdict judges the "after" run against the targets alone** · Trigger: Q-P0-4 answered "no baseline; use the targets" · Replaces: none (adds to B1)

| # | Step | Files | Test that proves it |
|---|---|---|---|
| V2.1 | The `B0` column of "Staging timings" may hold `n/a`; with `n/a`, S1 holds when A's cold p95 ≥ 2,000 ms or A has any load without the tile, and S2 holds when an A p95 ≥ 300 ms. The doc's method text says so. | `tests/config/csp-impact-doc.test.ts`; `docs/go-live/csp-impact.md` | New cases: `n/a` accepted only in the `B0` column of the timing table; `["n/a", "2000"]` on cold p95 → `S1 cold p95`; `["n/a", "1"]` on failures → `S1 failures`; `["n/a", "300"]` on `add p95` → `S2 add`; `["n/a", "299"]` → no stop; every existing case green. |

**V3 — Explicit thresholds for the extraction decision** · Trigger: Q-P0-3 answered with numbers · Replaces: the projection part of B4's rule (the timeout and truncation conditions stay)

| # | Step | Files | Test that proves it |
|---|---|---|---|
| V3.1 | The doc states the founder's two thresholds (tokens and milliseconds per call) as named lines; the test reads them from the doc and applies `max(outputTokens) ≥ T` or `max(durationMs) ≥ M` instead of the per-line projection. | `docs/go-live/extraction-timing.md`; `tests/config/extraction-timing-doc.test.ts` | Derived documents: a run at exactly `T` tokens, and one at exactly `M` ms, each refuse `no change`; a run below both passes; missing threshold lines fail the shape check. |

**V4 — Usage is read from the production (Pro) account** · Trigger: Q-P0-5 answered "use the production account" · Replaces: none (adds to B1)

| # | Step | Files | Test that proves it |
|---|---|---|---|
| V4.1 | The usage section's method says the allowances and amounts come from the production account's Usage page; the heading, the rows and the 50% rule stay. | `docs/go-live/csp-impact.md`; `tests/config/csp-impact-doc.test.ts` | New case: the "Vercel Hobby usage" section contains "production account" and still matches `/Usage page/` and `/projected = .*31\s*\/\s*7/`; existing cases green. |

## 6. Risks and mitigations

- **Security / privacy:**
  - **Remaining direct edits (default):** owner and admin can still change an article's code, pack and active flag outside review. Bounded by RLS to owner and admin; it never changes which ingredient an article means. V1 closes it if wanted.
  - **A table-level UPDATE grant would make the column revoke a no-op** (for example through Supabase default privileges). `303` asserts `has_table_privilege(…, 'UPDATE')` is false, so this cannot pass silently.
  - **Real invoices on staging (F26):** supplier data goes to the extraction provider and into the staging database (and its backups once S8-9 and S8-11 arm them). Nothing runs until Q-P0-2 is answered; the PR #8 terms check and DPA-1 stay open founder items.
  - **Log content:** the extraction line can carry the provider's error message (at most 300 characters). The method says never to copy it; the doc test refuses such a column.
- **Deploy:** merging PR A applies the migration to staging automatically (§2.5). A privilege change only takes a brief catalog lock. Production gets it through "Deploy production database" at go-live (S8-2).
- **Numbering drift:** another PR may add a migration first. A0 re-checks; the rename rule and `p2-0-preserves.test.ts` catch it.
- **Measurement honesty (F45):** build and request counts are taken locally; they describe the build and the browser's requests, which do not depend on the host. Timings and usage exist only on staging and stay `pending` until the founder's runs. The "after" build is today's `main`, not M25's head; the doc records the commit.
- **No B0 (F45):** M25 is merged, so S1/S2 have no baseline unless Q-P0-4 finds or creates one. Until then the verdict stays `pending` and G7-4 blocks production, as designed.
- **`b215326` may not build** with today's toolchain or the fake env. B2 then leaves `before` `pending` and says why.
- **Performance / cost:** none from PR A or B. No price or allowance is estimated here; Vercel and provider figures come only from the founder's dashboards.
- **Dependencies:** none added.

## 7. Open questions

### 7.1 Decisions this plan needs (founder unless marked)

- **Q-P0-1 (F12 scope).** The revoke covers the two columns that define the mapping memory (`ingredient_id`, `description_hash`). The supplier screen can still edit code, pack, label, active and preferred directly. Is that enough? **Default: yes** (PR A as planned). "All of it" → V1. **Needed before A2.**
- **Q-P0-2 (F26 data).** May real supplier invoices be extracted on staging, and which ones? Which tenant receives them, and are they removed afterwards or kept? This sends supplier data to the extraction provider before the Anthropic terms check (PR #8) and DPA-1 are closed. **Default: no run until you say so.** Please also confirm, by name only, that `ANTHROPIC_API_KEY` and `EXTRACTION_MODEL_ID` exist in the staging Vercel environment (M3 Q5). **Needed before FS-2.**
- **Q-P0-3 (F26 rule).** The decision rule of §3.2 (any timeout or truncation, or a per-line projection to 200 lines reaching the token ceiling or the 90 s request timeout). **Default: that rule.** Explicit thresholds → V3. **Needed before FS-2.**
- **Q-P0-4 (F45 baseline).** M25 is on `main`, so B0 can no longer be taken on `main` before the merge. Options: (a) **default:** DigiAlto lists the runs of `perf-order-entry.yml` and `perf-dashboard-4g.yml` from before the M25 merge (`gh run list`, read-only); if a successful pre-M25 run against staging still has its summary, you decide whether it counts as B0; (b) judge the "after" run against the targets alone → V2; (c) temporarily redeploy a pre-M25 commit on staging for B0: a staging change with an untested risk of old code on a newer schema, not designed here. **Needed before FS-3.**
- **Q-P0-5 (F45 usage).** Production will be on Vercel Pro (2026-11-08); the usage section and S3 were written for Hobby, and staging may stay on Hobby. **Default:** keep reading the staging account's Usage page and keep S3 at 50% (Q236), as you fixed it. "Use the production account" → V4.
- **Answered on 2026-11-11, by the lead/founder:**
  - **Q-P0-1:** yes, the narrow column revoke (PR A as planned). V1 is not needed.
  - **Numbering:** `20261129100000_supplier_item_mapping_update_revoke.sql` is fine (main's newest is `20261128100600`).
  - **Q-P0-2:** F26's timing runs use whatever invoices the founder uploads in normal UAT on staging, in their own tenant. No special run, and no new data class goes to the extraction provider. DPA-1 stays open. The lead cites "M3 Q4/Q5, decision 2026-10-22, the same owner's account"; the repo does not record that decision (M3 Q4 is only listed as answered in `docs/go-live/phase1-closeout.md` line 116, without its content, and M3 Q5 is still listed as open in the scope doc), so this statement is attributed to the lead, 2026-11-11.
  - **Q-P0-3:** the rule of §3.2 is fine, fixed before the numbers.
  - **Q-P0-4:** V2 (the "after" run is judged against the targets), plus a read-only look for older runs, using a B0 if one exists.
  - **Q-P0-5:** keep the stop rule as the founder set it, with a note that it was written for Hobby.
  - **G18:** dropped; nothing is in the repo.
  - **ADR-033:** marked accepted in PR B, not in PR A.
  - **PR B carries F45, F26 and the ADR-033 status change.**
- **For the lead (not the founder):** mark ADR-033 accepted now that A5b is merged; update the scope doc's F1 note ("in progress"); and if G18's corrected wording exists outside the repo, send it so the next migration-adding PR can carry it (F43 is "Keep", so P2-0 does not).

### 7.2 Questions for the founder: the "Before go-live" answers (§2.5.2 and OQ-2)

No code in P2-0 depends on these. The defaults are the ones in force (close-out §2). Data-protection points are for the venue's data-protection adviser (still to be identified), through you, together with DPA-1.

**Accountant (one session):**

| Question | Default in force |
|---|---|
| Q20 / M3 Q2 / M4 Q1 / M5 Q2: totals check on gross (lines + VAT vs total) or net; the allowed VAT rates | Gross, ±0,05 €; rates 0/4/5/10/22 % |
| M3 Q3 / M4 Q2 / M5 Q3: negative lines (discounts, deposits, returns); separate credit notes | Such an invoice fails extraction |
| M5 Q5: credit for a short delivery, with or without VAT | Includes VAT |
| M8 Q3: sale VAT rate | One tenant rate, 10 % (to confirm with the accountant) |
| M17 Q73: coperto VAT rate | Pre-filled from the sale VAT (10 %) |

**Founder:**

| Question | Default in force |
|---|---|
| Q11: code and IP ownership (DigiAlto product or client-owned) | None decided; `package.json` private, no licence |
| Q12: app domain and sending domain | Decided later, needed before 12 January (Q188); FREE-3 and S8-3 are blocking |
| Q13: GDPR roles, DPA, sub-processor list, data location and retention at providers | None signed; accepted risk in the security walk; DPA-1 is blocking |
| Q14: retention (departed staff, PIN log, alerts, ledgers vs 10-year invoices) | Nothing deleted; per-plan defaults (for example M11 Q2: PIN log, sessions and enrolment codes 30 days, IP-hash log 1 day) |
| Q26: where logins live, MFA owner, recovery codes | Runbook "Owner" column "to fill in" for every account |
| M3 Q5: which environments get an extraction key; Vercel plan and Fluid compute (120 s) | None estimated; production needs one (see also Q-P0-2) |
| Q8 / M21 Q133: who enters the register total | Owner or admin |
| Q23 / M21 Q126: payment types at close | Contanti, Carta, Altro (placeholder) |
| M20 Q124: data kept on the phone (unsent operations, warnings 24 h); a line in the GDPR register | As stated; belongs in the staff register entry (M11 M-6) |

**Chef and owner:**

| Question | Default in force |
|---|---|
| Q2: full recipe list, batch sizes, shelf lives, the chef's cost sheet | None loaded; drafts in `docs/client/` |
| Q5 / M21 Q127: table names, covers, coperto, staff count | The owner types them; no coperto until set |
| M7 Q7: loading the chef's real recipes into production | No real data until you say so |
| **OQ-2:** how per-etto dishes are rung up from go-live until "Sell by weight" (C17, P2-6) | A fixed placeholder portion per dish, agreed with the chef, set up as an ordinary menu item and price (no code). Its price and portion size drive revenue, depletion and food cost for those dishes until P2-6, and those ledger rows are never rewritten |

## 8. Founder and staging steps (nothing here is done by DigiAlto without your OK)

- **FS-1:** answer Q-P0-1…Q-P0-5 and the §7.2 questions (or confirm the defaults).
- **FS-2 (F26, after Q-P0-2 and Q-P0-3, PR B merged):** upload the chosen invoices on staging, including the longest one you have; open each in review and note its line count; in Vercel → staging project → Logs, copy the four fields of each `"event":"extraction"` line into `docs/go-live/extraction-timing.md` (or send them and DigiAlto opens the docs PR); never copy `requestId` or `errorMessage`. Then remove or keep the invoices as decided in Q-P0-2.
- **FS-3 (F45 B0, after Q-P0-4):** as chosen: confirm an old run as B0, or V2, or a redeploy you approve and run yourself.
- **FS-4 (F45 A and usage, after S8-16):** run "Order entry timing on staging" and "Dashboard timing on Slow 4G (staging)" on `main`; note the dashboard run's window; read the Usage page at the start and seven days later; fill the remaining cells, the estimate lines, the limit warning and the verdict in `docs/m25-csp-impact` (its test applies the stop rule); update G7-1…G7-4 in the checklist.
- **FS-5 (F12):** approve and merge PR A when it is ready; that deploys the revoke to staging automatically (§2.5).
- **Related, already on the checklist, not part of P2-0:** AT2 header check on a preview and on production; IPHONE-1.

## 9. Sources

- Files in this worktree (`main` `b473e9f`), as cited by path and line above.
- Local reflogs: `/home/user/osteria-dei-rossi-app/.git/logs/refs/heads/fix/a5-raw-stock-business-day`, `/home/user/osteria-dei-rossi-app/.git/logs/refs/remotes/origin/fix/a5-raw-stock-business-day`, `/home/user/osteria-dei-rossi-app/.git/logs/refs/remotes/origin/main`.
- No web sources were needed. No external API behaviour is assumed beyond what the code and ADR-028 already state.
