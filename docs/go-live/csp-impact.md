# What the nonce policy costs: measurement, estimate and stop rule (M25 step 21)

The founder asked for the strict Content-Security-Policy with a per-request nonce (ADR-028) and for its effect on speed and on Vercel's Hobby
plan to be measured and reported, with a stop rule fixed **before** the numbers are known. This document holds the method, the inputs of the
estimate, the stop rule and the empty slots for the results.

**State today:** the policy as built, the third-party origins and the build route counts are filled from the code and local runs (P2-0 PR B).
Everything that needs the deployment is `pending (founder)`: the staging timings, the Vercel usage, the estimate figures, the limit warning and
the verdict. The "after" runs happen on staging (Q235, staging only). The pull request that fills those slots is `docs/m25-csp-impact`, and it
must pass `tests/config/csp-impact-doc.test.ts`.

**Policy as built.** Built by `buildCsp` in `src/lib/security/csp.ts` (ADR-028), applied per request by `src/proxy.ts` and, for the static
headers, by `next.config.ts`. The test recomputes the page, static and development policies from `buildCsp` and fails if a directive name, its order or its value in this block
drifts from them.

Directives (production page): `default-src`, `script-src`, `style-src`, `img-src`, `frame-src`, `font-src`, `connect-src`, `worker-src`, `manifest-src`, `object-src`, `base-uri`, `form-action`, `frame-ancestors`, `upgrade-insecure-requests`.

The values, as `buildCsp` returns them for a production page (`<n>` is the per-request nonce, `<supabase-origin>` the project origin):

- `default-src 'self'`
- `script-src 'self' 'nonce-<n>' 'strict-dynamic'`
- `style-src 'self' 'unsafe-inline'`
- `img-src 'self' <supabase-origin>`
- `frame-src <supabase-origin>`
- `font-src 'self'`
- `connect-src 'self'`
- `worker-src 'self'`
- `manifest-src 'self'`
- `object-src 'none'`
- `base-uri 'self'`
- `form-action 'self'`
- `frame-ancestors 'none'`
- `upgrade-insecure-requests`

Where it differs:

- On `/api/*`, `/sw.js`, the manifest and the paths the proxy skips, there is no nonce: `script-src 'self'`.
- Under `next dev` only, `script-src 'self' 'nonce-<n>' 'strict-dynamic' 'unsafe-eval'`. `'unsafe-inline'` is never in `script-src`.
- `upgrade-insecure-requests` is added on production and preview, not on development (the doc test checks production and
  development; preview takes the same branch of `buildCsp` as production but is not checked separately).

Third-party origins in the browser policy: the Supabase project origin in `img-src` and `frame-src` (invoice photos and the PDF frame), nothing else.

The browser calls only `/api/*` (`connect-src 'self'`). The outbound services (Supabase, the extraction provider's API and the Resend mail API)
are called by the server only and are not part of the browser policy.

Guard tests: `tests/lib/security/csp.test.ts`, `tests/lib/security/nonce.test.ts`, `tests/proxy-csp.test.ts`,
`tests/lib/security-headers.test.ts`, `tests/config/next-config-headers.test.ts`, `tests/app/root-layout.test.ts`,
`tests/lib/security/header-check.test.ts` (with `scripts/check-headers.ts`, AT2), `tests/guards/no-raw-html.test.ts`,
`tests/guards/no-browser-supabase.test.ts`, `tests/guards/public-page-csp.test.ts`, `e2e/security-headers.spec.ts` and `e2e/pwa.spec.ts`
(with `e2e/helpers/csp.ts`).

Why it costs something: no app page is pre-rendered any more. Every page load, in-app navigation and prefetch of a page is rendered on Vercel
for that request. Only `/manifest.webmanifest` (and Next.js 16's static `/_global-error` fallback) stay pre-rendered. Order entry is
`/api/*` only, which takes the proxy's early branch with no nonce work, so it is the control: no change is expected there. Oggi (`/`) used
to be HTML from the CDN and now waits for a render before the first byte, so cold loads on a throttled connection are the exposed path.

How to fill a cell: an integer (milliseconds or a count) or `pending`. A cell stays `pending` until its run has been made. Never paste a
header, a nonce or a key.

## Build output

Method: run `npm run build` on `b215326` (before: the merge of PR #50, the `main` commit that was merged into the M25 branch; PRs #52 to #60 reached `main` between it and M25's own merge, so it is not
the commit just before M25 on `main`) and on the commit named below (after: the base of
the P2-0 PR B on `main`), each with the fake values of `.env.example` (`SENTRY_DSN` unset, because its placeholder is not a URL), and count the
routes the route table marks static (○) and dynamic (ƒ). Then read the keys of `routes` in `.next/prerender-manifest.json`.

| Routes | before (b215326) | after |
|---|---|---|
| static | 49 | 1 |
| dynamic | 152 | 223 |

After commit: b473e9f

Read the counts with care. The route table of the after build also holds the routes added since `b215326` (the table has 224 rows against 201),
so the dynamic count rises for two reasons: the pages that used to be static are now rendered per request, and new pages exist. The static
column is the clean signal: 49 pages before, one after (`/manifest.webmanifest`). `/_global-error` is pre-rendered too but is not a row of the
route table, so it appears only in the manifest keys below. Before the change the manifest keys were 49 pages plus `/_global-error`.

Pre-rendered routes after: `/_global-error`, `/manifest.webmanifest`

That line is the expected list, not a measurement. `e2e/security-headers.spec.ts` pins it against the real build in CI (the Turbopack build is
the one that counts); a different list there is a stop, not an edit (S4).

## Requests per page open

Method: `e2e/security-headers.spec.ts` attaches `page-requests.json`. It counts the documents, the RSC requests (`rsc: 1`) and the prefetches
(`next-router-prefetch: 1`) seen while the owner opens `/`, waits 5 seconds and taps one navigation link. Each is one page render now.
Prefetches of dynamic routes may add renders; they are counted, not assumed.

**Pending (founder):** the spec needs the local Supabase stack for its signed-in steps, and the environment that built this PR had no running
Docker daemon, so the three counts were not measured. They are filled from a local `npx playwright test e2e/security-headers.spec.ts --project phone`
run on `main` by whoever has the stack, or by `docs/m25-csp-impact`. No number is estimated here.

| Request kind | count |
|---|---|
| documents | pending |
| RSC requests | pending |
| prefetches | pending |

## Staging timings

Method: two existing workflows, run from `main` against the staging app. The staging environment needs `VERCEL_AUTOMATION_BYPASS_SECRET`
first (checklist S8-16).

- **B0 (before): not available, `n/a`.** M25 is on `main`, so a run "on `main` before the merge" can no longer be taken, and no earlier run
  exists: on 2026-11-11 the GitHub Actions history of the repository holds no run at all of `perf-order-entry.yml` or `perf-dashboard-4g.yml`
  (both listed with a total of 0). The lead decided on 2026-11-11 (Q-P0-4) not to deploy an old commit to staging for a baseline.
- **A (after):** "Order entry timing on staging" and "Dashboard timing on Slow 4G (staging)" on `main`. Note the start and end time of the dashboard
  run.

With no baseline the verdict judges A against the targets alone: S1 holds when A's dashboard cold p95 is at or over 2,000 ms or A has any load
where the tile never showed; S2 holds when any A order-entry p95 is at or over 300 ms. `n/a` is allowed in the B0 column of this table only.

The dashboard rows are milliseconds from the 20 cold and 20 warm loads of Oggi until the "Ieri" tile shows; `dashboard failures` is the number
of loads in which the tile never showed. The six other rows are the p95 in milliseconds of each order-entry action. Targets: dashboard under
2,000 ms (M22), order entry under 300 ms (M18). Every A cell is pending (founder): it needs the
staging runs.

| Measure | B0 | A |
|---|---|---|
| dashboard cold p50 | n/a | pending |
| dashboard cold p95 | n/a | pending |
| dashboard warm p50 | n/a | pending |
| dashboard warm p95 | n/a | pending |
| dashboard failures | n/a | pending |
| add p95 | n/a | pending |
| edit p95 | n/a | pending |
| move p95 | n/a | pending |
| remove p95 | n/a | pending |
| menu p95 | n/a | pending |
| lines p95 | n/a | pending |

## Vercel Hobby usage

Method: the founder reads the account's **Usage** page at B0 and seven days after A, and copies the account's own allowance and used amounts.
The allowances are never taken from this repository. Where Observability shows them, the founder also reads the invocations and CPU of `/` for
the window of the A dashboard run (41 loads), which gives a figure per page view.

**Plan note (Q-P0-5, 2026-11-11).** The section and S3 were written for Vercel Hobby, and the stop rule stays as the founder set it (50%, Q236),
read from the staging account's Usage page. Production is on Vercel Pro (close-out, founder decision 3, 2026-11-08), whose allowances differ
and are never taken from this repository. So a staging reading against Hobby allowances is a conservative screen, not a prediction for
production. With no B0 run, "B0" in the table below is the reading taken at the start of the A run. Every cell is pending (founder).

Units, as the Usage page shows them: invocations, hours, GB-hours, requests, reads, writes and GB. Fill each cell with the number only.
`projected = (A + 7 days minus B0) x 31 / 7`, cross-checked against the estimate below.
`% of allowance` is `projected / allowance x 100`; the test computes it again from the row's own numbers.

| Metric | allowance | B0 | A + 7 days | projected | % of allowance |
|---|---|---|---|---|---|
| Function invocations | pending | pending | pending | pending | pending |
| Active CPU | pending | pending | pending | pending | pending |
| Provisioned memory | pending | pending | pending | pending | pending |
| Edge requests | pending | pending | pending | pending | pending |
| ISR reads | pending | pending | pending | pending | pending |
| ISR writes | pending | pending | pending | pending | pending |
| Fast data transfer | pending | pending | pending | pending | pending |

ISR is no longer used (no route revalidates and none is pre-rendered), so its two rows should stay near zero. Edge requests count every
request, static or not, so they change only through prefetches. Whether the proxy counts as its own function invocation on Vercel with
Next.js 16, and whether Observability shows per-route figures, are read from the dashboard and not assumed.

## Estimate

An upper bound for one venue, not a fact about it. The inputs are Q237's defaults, answered on 2026-11-03: **6 devices** (1 kitchen board,
1 owner phone, 4 waiter phones), **15 open hours** a day (from Pranzo's default start at 11:00 to the 02:00 cut-off) and **31 days** a month.
A smaller real count only lowers the estimate.

    added page renders per month = sum over devices of (renders per open hour) x 15 open hours x 31 days

"Renders per open hour" for each device comes from the requests table above and the A run. For scale, the polling that already runs on
functions, per open hour, is: kitchen board **720** calls (every 5 s), each waiter's tables or comanda screen **240** (every 15 s) and the
dashboard **60** (every 60 s). Every one of these also passes the proxy, whether Vercel counts it as a separate invocation or not.

Renders per open hour per device, from the A run: pending

Added page renders per month for 6 devices: pending

Cross-check against the projected figures of the usage table: pending

## Verdict

**Stop rule, fixed before measuring (Q236: 50%).** Any one of these stops the work. The founder gets the numbers before any further M25
step that depends on them, and before any production release.

- **S1 (M22):** A's dashboard cold p95 is at or over 2,000 ms; or A has any load where the tile never showed. (With a B0, the older rule applied:
  over the target while B0 was under it, or more failures than B0. B0 is `n/a`, see Staging timings.)
- **S2 (M18):** any of the six order-entry p95 rows is at or over 300 ms in A. (With a B0: while it was under 300 ms in B0.)
- **S3 (Hobby):** any metric's projection is at or over **50%** of its allowance, or the Usage page shows any limit warning.
- **S4:** the pre-render list or a violation check fails (steps 4, 4a and 17 already fail on that).

On a stop nothing is widened or switched off silently. The founder chooses between accepting the cost, a re-plan (for example `loading.tsx`
boundaries or fewer prefetches; not designed here), a paid Vercel plan (prices are never estimated here) and returning to the static policy
(ADR-028, alternatives).

The test refuses `Verdict: continue` while S1, S2 or S3 holds on the numbers above, refuses `pending` once no cell is pending, and refuses
`continue` while a cell is pending.

Limit warning on the Usage page: pending

Verdict: pending

The verdict, the timings and the usage are pending (founder). The G7-4 verdict is not decided in this document until they are filled.
