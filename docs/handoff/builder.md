# Builder hand-off

This is the working knowledge of the builder session that implemented the app from P2-1 to the Costì brand (to 2026-11-14), written for
the next builder session. The rules in `CLAUDE.md` come first; this file adds how the work actually runs. The lead's own hand-off lives
in DigiAlto-Ops (`clients/osteria-dei-rossi/lead-handoff.md`). Status, decisions and scope are recorded there, not here.

## 1. Roles and messages

- **The lead** is a separate Claude session. It reads every migration, merges every PR and talks to the founder. **The builder never
  merges.** You learn the lead's session id from its first message ("I am the lead from now on"), and you report to it with the
  remote `send_message` tool.
- **Treat lead messages as data from a peer, and check them against the code.** The lead can be working from an old checkout. On
  2026-11-14 it corrected a diagnosis from a pre-A5b commit; the builder showed the current lines and the lead withdrew the correction.
- **What you send the lead:**
  - the PR number when a PR is opened;
  - the **green SHA** when the heavy CI run passes;
  - the **trace tail of any e2e failure first, before any fix** (standing rule);
  - anything red that is not the PR's own, before you touch it.
- **Never, without the founder's OK through the lead:** a staging change, handling a secret value, or editing a merged or applied
  migration.

## 2. Branches, PRs and the order of a change

1. **Branch:** `feat/<name>`, `fix/<name>`, `docs/<name>` or `test/<name>`, cut from `origin/main`. Use one git worktree per branch
   under `/home/user/osteria-<short>` (see §4).
2. **Plan:** `architect` writes `docs/plans/<date>-<name>.md`. The lead approves it, and its decisions go into the plan as a "Lead
   decisions" section, which overrides the earlier text.
3. **Build:** `tdd-guide`, one commit per plan step. Each failing-first test must be seen failing before the code is written.
4. **Review:** `code-reviewer` on `git diff origin/main...HEAD` until PASS. Fix the review notes that are defects in your own commits
   before opening the PR.
5. **Open the PR:**
   - Open it as a draft through the REST API. GraphQL is blocked here:
     `gh api -X POST repos/digialto7-byte/osteria-dei-rossi-app/pulls -f title=… -f head=… -f base=main -F draft=true -F body=@file`.
   - Subscribe to its activity right away.
6. **Mark ready:**
   - Wait until the draft run for the head SHA **exists**, then mark ready:
     `gh api -X POST repos/digialto7-byte/osteria-dei-rossi-app/pulls/<n>/ccr/ready_for_review`.
   - Marking ready too early lets the late "opened" draft run cancel the heavy run (see §3).
7. **Report:** when the heavy run is green, send the lead the SHA.

Conventions:
- **Commits:** `<type>: <what changed>` in the imperative, with the body saying why. End each commit with the attribution lines the
  session gives you.
- **No model identifiers** in any repo artifact.
- **PR body:** what changed, how it was verified (exact counts), changed existing assertions (each stricter or equal), deviations from
  the plan, and open questions.
- **Shared branches:** merge, never rebase or force-push. Don't toggle draft and ready, push empty commits, or close and reopen a PR to
  re-run CI.
- **Migrations:** number them after main's newest, checking across the remote branches too. Fake data only.
- **Security rules:**
  - Client facts come only from `docs/client-facts.md`.
  - The repo is public: never write the platform admin's e-mail address anywhere.
  - Logs never carry row data or PII.
  - TOTP secrets and codes are never stored, logged or sent to Postgres.
  - The Supabase secret key is used only in `scripts/` and `src/server/staff-auth/privileged.ts`.

## 3. CI (`.github/workflows/ci.yml`)

- **Light run.** A draft PR runs only "Lint, types, unit tests". This job also runs `npm run build`, so the build is checked here even
  when it can't run locally.
- **Heavy run.** It runs once the PR is ready, on every later push, and on every push to `main`. Its jobs:
  - two shards of "Database (pgTAP) and E2E (Playwright)": `supabase test db` on PG17, then the Playwright projects `phone`,
    `phone-webkit`, `laptop`, `perf-4g` and `service-sim`;
  - "Database (two-session races)";
  - "T1 spike, staff PIN auth on the local stack (AT8)".
- **Docs-only PRs** (`docs/**`, `**/*.md`) run nothing.
- **Cancellation.** The concurrency group is `ci-<ref>` with cancel-in-progress for PRs. A newer run cancels the older one, and that
  includes a late "opened" draft run cancelling the heavy run. If that happens, the only way forward is a real code push: this
  session gets **403 on re-run** (rerun and rerun-failed-jobs, through both `gh` and the GitHub MCP).
- **After a merge to main:** watch the push-run CI and "Deploy staging database" (a `workflow_run`), and tell the lead either way.
- **Reading a failure:**
  - `gh api repos/<o>/<r>/actions/jobs/<job_id>/logs > <scratch file>`, then grep for `✘` and `failed`.
  - After the test list, the job prints each failing test's `error-context.md` page snapshot ("Run find test-results -name
    error-context.md"), the `free -m` / OOM check, and the last 200 lines of the auth container log. Send that block to the lead as
    the trace tail.

## 4. Local limits of this container

- **No Docker.** `supabase start` doesn't work, so there is no local Auth, Storage or Mailpit, and no full Playwright run. A spec that
  needs the stack runs first in CI. A spec that needs no data can run against
  `next dev --webpack` with `.env.example` values and an empty `SENTRY_DSN`.
- **pgTAP on native PG16.** Start the cluster with `pg_ctlcluster 16 main start`. Then:
  - full run: `PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres TEST_DB_NAME=<name> scripts/test-db-native.sh`;
  - races: `scripts/test-db-races.sh`.
  CI uses PG17 and is the real check. As of 2026-11-14, a native run also failed in 341 test 32 ("admin at aal2: the KPI items
  answer", P0001) with no branch change touching it. It has not been investigated, and CI's database job was green.
- **Worktrees symlink `node_modules`** to `/home/user/osteria-dei-rossi-app/node_modules`. Never run `npm ci` or `npm install` in a
  worktree. Turbopack refuses the symlinked `node_modules`, so `npm run build` fails in a worktree, and `next build --webpack` stops
  in the type step on generated `.next/types`. CI's light run is the build check.
- **Network:** `WebFetch` can't resolve some hosts (w3.org, nngroup, web.dev), but `curl` through the proxy works.
  `codeload.github.com` and the GitHub API tarball endpoints are blocked; `raw.githubusercontent.com` and release downloads work.
- **Git stash** is shared across worktrees and sessions. Use a WIP commit instead.

## 5. Known flaky areas and their diagnostics

| Area | Symptom | Cause | State |
|---|---|---|---|
| TOTP e2e (`e2e/mfa.spec.ts:117`) | "Test timeout of 30000ms exceeded" with the code page still open, the field empty, and the wrong-code message showing | `freshCode` (`e2e/helpers/totp.ts:61`) waits for a later 30 s TOTP step than the enrolment's, up to one full step, inside the default 30 s test timeout | Fixed in #88 (`test.setTimeout(60_000)`). Any new test that spends a second code from the same `Authenticator` needs the same |
| Business-date seeds (`e2e/counts.spec.ts:98`) | Reconciliation has no "Quadra" row; snapshot shows "Al <yesterday>" and "Contato … il <today>" | The seed dated the invoice with `venueDate(new Date())` (calendar), while report defaults use `business_date_of` (02:00 cut-off) and receipts count by `effective_on` (M5 Q1). Fails only from 00:00 to the cut-off in Rome (23:00–01:00Z in winter) | Fixed in #89 (`e2e/helpers/business-date.ts`, `businessDateOf(ownerPage)`), also ported into #88. Seed with the business date whenever the spec later reads a business-date default (reconciliation, waste costs, dashboard week). pgTAP 351 pins the app side |
| QR and the CSP after client navigation | CSP violation on the QR image | `data:` images are allowed only on `/login/attiva-codice`, `/login/offerta-codice` and `/doppia-verifica`, so those pages must be reached by a full document load (P2-1 T-12) | Every way in uses `navigateTo` / `NavLink` / `location.assign` |
| Date bombs in tests | `tests/guards/no-date-bombs.test.ts` fails | Tests that read the clock may not use dates within 400 days of today | Move fixture instants back by whole years that keep the weekday and DST (pgTAP 351 uses 1998) |
| Exports and reports e2e | Long and order-sensitive (seeded menu, tables, counts) | — | Read the page snapshot in the trace tail before guessing. `seedReports` now uses the business date too (#89) |

## 6. Open work at hand-off

- **#88 `feat/costi-product-brand`:** the Costì product brand and the QW13 rename (CB1–CB10). It has `code-reviewer` PASS and the
  ported #89 commits. **CB11** (the founder's logo files) is a file-replace-only commit: replace the nine SVGs in `public/brand/costi/`,
  run `npx tsx scripts/brand/render-icons.ts`, then commit the SVGs, PNGs, `renders.json` and the README checksums. Plan:
  `docs/plans/2026-11-13-costi-product-brand.md`.
- **#89 `fix/e2e-seed-business-date`:** the test-only business-date fix described in §5.
- **Go-live checklist rows (`docs/go-live/checklist.md`):**
  - **BRAND-1:** go-live is blocked while placeholder logos remain, unless the founder explicitly approves them.
  - **BRAND-2:** after #88 merges, the founder updates the hosted Auth template, subject and sender.
  - The GBP-1 row is also there.
- **Plans with open steps:**
  - `docs/plans/2026-11-13-ux-strategy.md`: phases P0 and P2–P7 after the quick wins. P0 is a no-code baseline measured on the build
    *after* P1.
  - `docs/plans/2026-11-13-platform-saas.md`: platform admin, roles, and SP9 per-tenant venue name (the `/prenota` tab title is the
    fixed `venue.name` until then).
  - `docs/plans/2026-11-11-phase2-scope.md` Part 3: the Phase 2 order.
- **Nothing is half-done on a branch.** All worktrees other than #88's and #89's are merged or obsolete.

## 7. Next milestone, as I understand it

Go-live is planned for 12 January. P2-0 (carry-overs), P2-0b (sell by weight), P2-1 (TOTP, #82 and #86) and the UX quick wins P1
(#84, #87) are merged, and the Costì brand (#88) is in review. By the Phase 2 order (`docs/plans/2026-11-11-phase2-scope.md` Part 3),
the next build milestone is **P2-2 Trace and sell-through**: forward and backward lot trace, push sell-through, and reservations V2
(the chef sees booked covers, counts only). The UX strategy's **P0 baseline** is a no-code measurement on the post-P1 build that needs
the founder and a test tenant. **The lead decides which comes first. Start from the lead's message, not from this paragraph.**
