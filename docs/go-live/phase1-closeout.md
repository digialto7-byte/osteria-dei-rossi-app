# Osteria Dei Rossi app: Phase 1 close-out list

Read-only compilation from `origin/main` at `ea8376c` (M25 merged, PR #44) and the closed PRs #1 to #60 (REST API), on 2026-11-08.
Plan paths are under `docs/plans/`; dates are dropped from file names below (for example `m25-go-live` = `docs/plans/2026-11-01-m25-go-live.md`, `project-plan` = `docs/plans/2026-10-21-project-plan.md`).
Size guess: S = under a day, M = one to a few days, L = a milestone-sized piece. Nothing here is a new fact; where status could not be confirmed from main, the line says so.

Checked as **already done on main**, so not listed: G1, G9, G12 (M25 steps 7 to 9); G2 and G17 (A5, PRs #49/#50: business-day discards; the Sunday-night skip is gone from `exports.int.ts`); the M23 `menu_price_missing` follow-up (M24, migration `20261116100000`); the one-call extraction smoke contract asked in PR #55 (PR #56); the idle-sync lease fix (closed PR #51, merged into M25a as `30d9bea`); the M11 location-label overflow note (PR #20; `[overflow-wrap:anywhere]` is in `magazzino/[ingredientId]/lot-row.tsx`); the M0 cross-device magic-link problem (PR #2; M25a e-mail code); the AT8 output ceiling (PR #13).

---

## Founder decisions, 2026-11-08 (recorded after this list was compiled)

1. **RISK-1 accepted:** all three proposed risks (no sign-in throttle of our own, no second factor in the app, no self-service staff erasure: done on request). **TOTP** (required for the admin, optional for the owner) is an early Phase 2 item after go-live. Checklist RISK-1 is `done`.
2. **Invoice files WILL be backed up** (item 4 below is reversed). This is a new code item before go-live, `feat/backup-invoice-files`:
   - the `invoices` Storage bucket joins the encrypted daily backup to the Shared Drive; it may be incremental, with a periodic full manifest;
   - the weekly restore check verifies a sample of files against their checksums;
   - no plaintext leaves the runner, and the gpg passphrase path is the same;
   - Q186, the runbook and AT4/FREE-2 are updated by that change.
3. **Vercel Pro for production at go-live** (Q9/Q10/HOBBY-1 decided); staging may stay on Hobby. Pro lifts the daily-cron and timeout limits; nothing is redesigned around that now. Checklist HOBBY-1 is `done`.

**Code order after reservations PR1:**
- (a) raw stock on the business day (`fix/a5-raw-stock-business-day`);
- (b) invoice-file backups (`feat/backup-invoice-files`);
- then reservations PR2.

TOTP comes after go-live.

## 0. For the founder's sign-off: RISK-1 and assumptions A1–A3 (verbatim from main)

**RISK-1, accepted risks in `docs/go-live/security-walk.md`**

The three marked *proposed* need the founder's confirmation on the go-live checklist (S8-4):
1. **Sign-in throttle:** the owner's password and e-mail-code sign-in have no throttle of our own (item 13).
2. **Second factor:** the owner and admin have no second factor inside the app (item 14).
3. **Staff data erasure:** a staff member's data cannot be erased self-service (item 23).

These are already accepted or decided, but the founder should still see them:
4. **Invoice files not backed up:** the daily dump holds the database only (Q186), and the Free plan has no backup of its own. The 10-year retention of invoice PDFs and photos relies on Storage's durability alone. This is the one with the most business impact.
5. **Inline styles allowed:** `style-src 'unsafe-inline'` (Q234, decided 2026-11-03).
6. **Offline nonce replay:** an offline shell page replays its cached nonce. The check on a real iPhone is IPHONE-1.
7. **Privacy and data processing agreement:** the privacy text and the data processing agreement are still open (item 21). This is for the client.

**M25 assumptions (plan lines 907–909)**
- **A1:** waiters sign in by magic link in the simulation. PIN login has its own spec and the Gate 3 device check.
- **A2:** "invariant check clean" means `app.ledger_checks_body` returns nothing. The job-health part depends on the environment.
- **A3:** the production tenant is created once with `npm run create-tenant`. No demo data in production.

## 1. Open follow-ups (work items not done on main)

### Data correctness and reporting
- Raw stock still calendar-dated: counts, transfers, `void_line` raw half, staff-meal raw half, `stock_reconciliation`, AVT, `app.kpi_purchases`, `usable_on_hand`/`weekday_consumption` to move to the business day ("before go-live" per PR #50) — `a5-business-date-discards` §7.4, PR #50, PR #49 Q1 — L
- Decide whether to drop the now-unused `batch_movement_effective_idx` / `stock_movement_effective_idx` — `a5-business-date-discards` §5, §7.4 — S
- G13: KPI register line mixes app total over all dates with a difference on dates with a register entry (flagged to founder) — `m25-go-live` §3.6, PR #41 — S
- G14: KPI rollup can race `purge_demo_data` (purge should take the rollup lock) — `m25-go-live` §3.6, PR #41 — S
- G8: staff-meal rule at a later-deactivated location cannot be confirmed/deactivated until re-saved (runbook workaround) — `m25-go-live` §3.6, `docs/runbook.md`, PR #25 — S
- G3: monthly pack reads at most 12 counts / 10 pages; older months show "no count" — `m25-go-live` §3.6, PR #43 — S
- M13 job-health does not read `cron.job_run_details`, so a 57014 timeout in the hourly rules run leaves no trace outside it (main reads `alert_refusal` only) — PR #18 — S
- M13 known limits: `count_close` reads the cost basis without the cost lock; manual same-day invariant run can hide findings; a job that never writes `job_run` is never judged — PR #22 — S
- `purchasesUnvaluedCount` is always 0 (receipts never carry a null cost) — PR #41 — S
- Breakdown status excludes fixed cost, so it says "ok" where the older badge says `fixed_cost_unallocated` — PR #35 — S
- Stock left at a deactivated location stays in totals until moved (known limit) — PR #21, `m12-raw-stock` risks — S

### Security and robustness
- `supplier_item` keeps the column UPDATE grant for `authenticated` (mapping memory editable outside the review procedures; still granted in `20261021130200_supplier.sql`) — PR #11 — S
- PIN-change window: an old-PIN sign-in during `record_pin_change` keeps its session; a 502 leaves an audit row for a change that did not happen — PR #20 — S
- M1 import: validate inside the import RPCs (malformed JSON gives 500); accept a quote after leading whitespace in CSV; 413 for chunked bodies — PR #4 — S
- M2 upload: hourly limit counts saved invoices only (consider a DB-side limit); encrypted-PDF check also flags permission-only PDFs (check on samples); migration comment for limit constants — PR #6 — S
- Money-guard gaps: key rule misses `euro`/`eur`/`valueEur`, over-matches some keys, refuses text like "Quartiere EUR" — PR #15 — S
- Loosen the money guards for owner-only alert payloads (deferred) — `m12-raw-stock` §1, §6 — S
- G4: service-worker items: `AbortSignal.any`, concurrent puts, timer-clear test, 401 body classed as network, `storedSeq` pruning, `warm-reads` rate limit — `m25-go-live` §3.6, PR #38 — M
- G6: listing of orphan Storage objects — `m25-go-live` §3.6 (M2 §6) — S
- Date-bomb guard blind spots (imported helpers, `raise_alert` clock default, `make_date`/`Date.UTC`, server clock behind `/api/*`) — PR #54 — S
- TOTP (and maybe passkeys) for owner (optional) and admin (required), **early Phase 2 after go-live (founder 2026-11-08)** — `m25a-password-login` Q204, PR #45 — M

### Performance
- G11: index `applied_op(tenant_id, received_at)` for `late_op_count` (needs a migration; none on main) — `m25-go-live` §3.6, PR #40 — S
- Approval walks the cost graph twice per over-threshold ingredient (~490 ms each); compute costs once per invoice — PR #17 — M
- Chef cost endpoint passes keys via `.in()` in the URL (long at a few hundred plates) — PR #17 — S
- Payables rules run locks every open payable due within 7 days; filter first — PR #18 — S
- Extraction timeout: measure `outputTokens`/`durationMs` on staging, then streaming or a longer `maxDuration` if large invoices time out — PRs #13, #57 — M
- Recipe import into an empty tenant can be slow (ANALYZE after import or a partial index) — PR #16 — S

### UX and product polish
- G10: focus after Conferma/save falls to `<body>`; `aria-expanded` on "Aggiungi …" never true — `m25-go-live` §3.6, PR #37 — S
- Approval prompt still says "debito" (`approval.confirm` in `it.ts`) — PR #37 — S
- Invoice list capped at 100 rows (`MAX_INVOICE_LIST_ROWS`), no "older" paging in the UI — PR #6, `m25b-navigation` §6 — S
- M4 review gaps: clearing a duplicate does not re-run auto-mapping; old `supplier_item` kept on code change; mapping to an inactive item reactivates it; split `conf` child unit by hand — PR #11 — S
- M5 duplicate-flow notes: no release path when the original was rejected; partner label cannot tell 3+ look-alikes apart; `not_flagged` message wording; list note lags — PR #14 — S
- Recipe export includes active recipes only (re-import into an empty tenant can fail on `unknown_sub_recipe`) — PR #16 — S
- Name-length mismatch: SQL `left(…,80)` counts characters, Zod counts UTF-16 units (emoji names fall back to generic alert text) — PRs #17, #18 — S
- Cost walk keeps one depth per recipe across roots (hand-built 13-deep chains) — PR #17 — S
- Forecast panel `aria-labelledby` points at nothing while it shows an error — PR #42 — S
- Ieri tile shows a 0-cover service line when the day has other covers (intended?) — PR #47 — S
- Waiter "Pronto" on dishes (M19b V1, deferred) — `m19b-kitchen-done` Q136, PR #40 — M
- Per-supplier hints in the extraction prompt (deferred until the quality report shows a need) — `m04-review` §4 — M
- M10 Google Drive folder watch (deferred, Phase 2 candidate; `GOOGLE_SERVICE_ACCOUNT_JSON` unused) — `project-plan` §1.2, PR #19, `docs/runbook.md` — L

### Tests, CI and repo hygiene
- G15: `e2e/perf/dashboard-4g.spec.ts` needs `PERF_4G_STORAGE_STATE`, which nothing sets: wire up or remove — `m25-go-live` §3.6, PR #41 — S
- G16: M24 parity fixture has a column pair sharing a value (a swap would pass) — `m25-go-live` §3.6, PR #43 — S
- G18: stale header in `20261027100800_audit_checks_with_staff.sql`; next migration-adding plan carries the corrected wording — `m25-go-live` §3.6 — S
- `page-requests.json` counts not captured on green runs; log them to stdout — PR #44 — S
- Fill `docs/go-live/csp-impact.md` (all cells `pending`) in PR `docs/m25-csp-impact` after the founder's runs — PR #44, `docs/go-live/csp-impact.md` — S
- `push-forecast.spec.ts:152` page closed mid-test (possible OOM) still unexplained — PR #58 — M
- Native-run flakes: pgTAP 241 hang on an unanalysed DB; 082 test 16 and 174 tests 73/80 order-dependent — PR #42 — S
- e2e forecast heading race at 02:00; pgTAP 256 index assertion depends on planner stats — PR #42 — S
- Custom-range validity check duplicated in `report/page.tsx` — PR #41 — S
- CI cache: split restore (PRs) and save (main) if per-PR caches evict main's; move to `actions/cache@v5`; cache in `perf-dashboard-4g.yml` — PR #59, `ci.yml` comment — S
- Required status checks vs `paths-ignore` (docs-only PRs could leave a required check pending) — PR #29 — S
- `RESEND_API_KEY` still in `.env.example`, read by nothing — PR #15, `docs/runbook.md` — S

---

## 2. Open plan questions, with the default in force

Only questions not marked answered, decided or closed. Answered and skipped: project Q6, Q16, Q18, Q27, Q28; M2 Q1, Q3–Q6; M3 Q1, Q4; M4 Q3; M5 Q1; M6 Q5; M7 Q1, Q6; M8 Q10 (fixed costs part); M11 Q1, Q9 (→ Q204); M12 Q1; M19 Q98, Q101, Q105 (overridden by M19b); M21 Q128, Q129; Q106–Q110; UX Q1, Q2, Q4, Q5, Q6; Q136–Q237 (M19b, M22, M23, M24, M25a, M25b, M25c, M25 all answered; Q91 withdrawn). Per-plan numbers are prefixed with the milestone (for example "M5 Q2").

### Legal / GDPR
- Q11 — code and IP ownership (DigiAlto product or client-owned) — `package.json` private, no licence — `project-plan` §7, `m00-skeleton` §7
- Q13 — GDPR roles, DPA, sub-processor list, data location and retention at providers — none signed; accepted risk in the security walk — `project-plan` §7 (carried in M25 §7)
- Q14 — retention (departed staff, PIN log, alerts, ledgers vs 10-year invoices) — nothing deleted; per-plan defaults below — `project-plan` §7
- Q21 — which phase builds the allergen matrix (EU 1169/2011) — not phased; ingredient allergens captured since M1 — `project-plan` §7
- M11 Q2 — retention of PIN log, sessions, enrolment codes, IP-hash log — 30 / 30 / 30 days / 1 day — `m11-staff-pin`
- M11 Q10 — per-person login times (employee-monitoring limits) — owner sees none — `m11-staff-pin`
- M6 Q3 — how long alerts are kept — for good — `m06-alerts`
- M13 Q38 — how long `job_run` rows are kept — for good — `m13-counts`
- M20 Q120 — retention of `applied_op` — no deletion — `m20-offline`
- M20 Q124 — data kept on the phone (unsent ops, warnings 24 h); GDPR register line? — as stated — `m20-offline`
- Q96 — how long the demo purge record is kept — as long as the audit trail — `demo-data`
- M7 Q2 — chef's recipe file format; may an imported allergen list count as confirmed — our template; never confirmed by import — `m07-recipes`

### Hosting / billing
- Q9 — who owns and pays each account; Hobby is non-commercial — DigiAlto's own Vercel team and Supabase org (PR #1); Hobby question **decided 2026-11-08: Vercel Pro for production** — `project-plan` §7, `m25-go-live` §7
- Q10 — which plans — Supabase Free for production (Q187); **Vercel Pro for production, staging may stay on Hobby (2026-11-08)** — `project-plan` §7 (status partly answered)
- Q12 — app domain and sending domain — decided later, needed before 12 January (Q188) — `project-plan` §7, `m25-go-live` §7
- Q26 — where logins live, MFA owner, recovery codes — runbook "Owner" column "to fill in" — `project-plan` §7, `docs/runbook.md`
- M3 Q5 (remaining) — which environments get an Anthropic key; Vercel plan and Fluid compute (120 s) — none estimated — `m03-extraction`, PR #8
- Q95 — GitHub Actions minutes exhausted; run from a trusted machine — trusted machine (status unclear: CI has run heavily since) — `demo-data`
- Q15 — repo name `digialto7-byte/osteria-dei-rossi-app` — in use (status unclear: never marked answered) — `project-plan` §7
- M0 Q-F — one tenant per login, DigiAlto admin needs one login per tenant — as built (status unclear) — `m00-skeleton`

### Fiscal / RCH
- Q20 / M3 Q2 / M4 Q1 / M5 Q2 — totals check gross (lines + VAT vs total) or net; allowed VAT rates list — gross, ±0,05 €; rates 0/4/5/10/22 % — `project-plan`, `m03`, `m04`, `m05` (CSV part answered by Q170)
- M3 Q3 / M4 Q2 / M5 Q3 — negative lines (discounts, deposits, returns); separate credit notes — invoice fails extraction — `m03-extraction`, `m04-review`, `m05-approval`
- M5 Q5 — credit for short delivery with or without VAT — includes VAT — `m05-approval`
- M5 Q6 — due date when neither invoice nor supplier gives one; end-of-month terms — approval refused until typed; "fine mese" not understood — `m05-approval`
- M8 Q3 — sale VAT rate — one tenant rate 10 % (confirm with accountant) — `m08-food-cost`
- M17 Q73 — coperto VAT rate — pre-filled from sale VAT (10 %) — `m17-menu-tables`
- Q23 / M21 Q126 — payment types at close — Contanti, Carta, Altro (placeholder) — `project-plan`, `m21-bill-close`
- Q8 / M21 Q133 — who enters the register total — owner or admin — `project-plan`, `m21-bill-close`
- M21 Q130 — do fatture count in the register comparison — yes, subtotal shown apart — `m21-bill-close`
- M21 Q131 — sign and base of the difference — app minus register, € and % — `m21-bill-close`
- M21 Q132 — receipt number fixable after close — no — `m21-bill-close`
- M21 Q134 — split by dishes: shared dishes and coperto — equal split, extra cent to first groups — `m21-bill-close`
- M9 Q30 — separate supplier credit notes — credits only from invoice-line short deliveries — `m09-payables`

### Hardware / devices
- M11 Q4 — trivial PINs — refuse same-digit, runs, ABAB; 4 digits — `m11-staff-pin` (project Q22)
- M11 Q5 — who manages staff, PINs, devices — owner and admin, audited — `m11-staff-pin`
- M11 Q6 — unlock after 20 failures an hour — stays locked until owner taps "Sblocca" — `m11-staff-pin`
- M11 Q7 — tries after a 15-minute lock — one — `m11-staff-pin`
- M11 Q8 — e-mail staff sessions end at cut-off? — no, only PIN sessions — `m11-staff-pin`
- M11 Q11 — device label in lockout alert — label shown; field asks for no names — `m11-staff-pin`
- M11 Q12 — enrol from inside the installed iPhone app — yes, runbook states it — `m11-staff-pin`
- M2 Q2 — invoices or photos over 4 MiB — 413 with Italian message; decide after real samples — `m02-invoice-upload`, PR #7
- M18 Q80 — phone clock tolerance — 2 minutes ahead blocks edits — `m18-order-entry`
- M20 Q117 — owner/admin offline on the comanda — yes — `m20-offline`
- M20 Q119 — ops left on a shared phone by a waiter who left — wait for that waiter — `m20-offline`
- M20 Q121 — app icon — none until the logo is approved — `m20-offline`
- M20 Q125 — logout with queued ops — allowed with warning — `m20-offline`

### Ops
- Q1 — 10 sample invoices for AT8 — decided (founder supplies, anonymised in repo); only 1 pair on main — `project-plan`, PR #8 (listed: status unclear, operationally open)
- Q2 — full recipe list, batch sizes, shelf lives, chef's cost sheet — none loaded; drafts in `docs/client/` — `project-plan` §7
- Q3 — supplier lead times, delivery days, cut-offs — filled during setup — `project-plan` §7
- Q4 / M8 Q5 — fixed monthly costs; months without entry — net monthly totals, last month carried — `project-plan`, `m08-food-cost`
- Q5 / M21 Q127 — table names, covers, coperto, staff count — owner types them; no coperto until set — `project-plan`, `m17`, `m21`
- Q24 — which milestones may move after go-live — none assumed (status unclear: all built) — `project-plan` §7
- Q25 — app brand — colours and fonts approved; logo pending (status partly answered) — `project-plan` §7, `docs/client-facts.md`
- M7 Q7 — loading the chef's real recipes into production — no real data until founder says so — `m07-recipes`
- M4 Q4 — starting cost centres — none preset — `m04-review`
- M4 Q5 — what counts as a line correction for Gate 1 — value changes only — `m04-review`
- M8 Q8 — chef's spreadsheet for Gate 1 — CSV `piatto;costo_cibo`, ±5 % — `m08-food-cost`
- M13 Q33 — DigiAlto also receives drift alerts — no — `m13-counts` (project Q9)
- M13 Q34 — e-mail for drift — no — `m13-counts`
- M18 Q81 — AT7 timing run: URL, EU region, password protection — after merge on staging — `m18-order-entry` (superseded in practice by M25 G7 runs; status unclear)
- Q116 — where the dashboard speed is measured — local copy (status unclear: 4G workflow on staging since M22) — `owner-dashboard`
- Q90 — where the demo is shown — staging only — `demo-data`
- Q92 — short wait before demo logins/PDFs are removed — acceptable — `demo-data`
- Q93 — osteria tries the demo with its own login — no — `demo-data`
- Q94 — demo name without real brand — "Osteria Demo (dati di prova)" — `demo-data`

### Product
- Q7 — half portions and shared plates exist — yes ("Mezza porzione", "Piatto condiviso") — `project-plan`, `m18`, `m21`
- Q17 / M8 Q6 — fixed cost per plate before 30 days of sales — "not allocated" — `project-plan`, `m08-food-cost`
- Q19 — portion rounding — down to a whole portion, chef can edit — `project-plan`, `m14`
- Q22 — staff session length — to the cut-off — `project-plan` (built in M11)
- Q29 — "scheduled" payables get the +3 days reminder — no — `project-plan`, `m09-payables`
- M1 Q2 / Q3 / Q4 — foreign suppliers; tenant VAT checksum; chef sees supplier VAT and terms — stored without VAT; no; yes ("stay as built", status unclear) — `m01-master-data`, PR #5
- M1 Q5 — CSV template fine or existing sheet — our template (blank-cell part answered in PR #5) — `m01-master-data`
- M4 Q6 — remember non-stock lines per supplier — owner ticks each time — `m04-review`
- M5 Q4 — same as M4 Q6, at approval — no effect — `m05-approval`
- M5 Q7 — storage location per invoice or per line — per invoice — `m05-approval`
- M5 Q8 — undo an approval — none; fix with stock corrections and "disputed" — `m05-approval`
- M6 Q1 — default alert audiences per role — owner; kitchen kinds also chef — `m06-alerts`
- M6 Q2 — chef sees quantity-only alerts — yes (status unclear: lead default, founder to confirm A1) — `m06-alerts`
- M6 Q4 — which day for "one alert per day" — calendar day, Europe/Rome — `m06-alerts`
- M7 Q3 — sale price VAT included — included — `m07-recipes`
- M7 Q4 — batch inside a batch — no — `m07-recipes`
- M7 Q5 — max yield factor — 10, warning above 1 — `m07-recipes`
- M8 Q1 — moving average simple or weighted — simple mean of last N — `m08-food-cost`
- M8 Q2 — which max price — highest of all purchases to date — `m08-food-cost`
- M8 Q4 — GP% on food cost or after fixed costs — on food cost — `m08-food-cost`
- M8 Q7 — ingredients never invoiced — cost unknown, "Costo incompleto" — `m08-food-cost`
- M8 Q9 — price alerts on decreases, threshold — both, strictly above — `m08-food-cost`
- M8 Q10 (rules part) / Q11 — who changes N, threshold, VAT, cost basis — owner and admin, audited — `m08-food-cost`
- M9 Q31 — disputed invoices in supplier balance — yes, shown apart — `m09-payables`
- M9 Q32 — weekly summary lists which payables — all unpaid — `m09-payables`
- M12 Q2 — which movements the chef may undo — any, any time — `m12-raw-stock`
- M12 Q3 — who gets negative-stock alerts — owner and chef — `m12-raw-stock`
- M12 Q4 — waste valuation — current cost, frozen on the day — `m12-raw-stock`
- M12 Q5 — moving more than recorded — refused — `m12-raw-stock`
- M12 Q6 — kitchen-usage form — none — `m12-raw-stock`
- M12 Q7 — expired lots — strict FEFO, marked "Scaduto" — `m12-raw-stock`
- M12 Q8 — lots without expiry — used last — `m12-raw-stock`
- M13 Q35 — close a count with items not counted — yes — `m13-counts`
- M13 Q36 — who picks critical ingredients — owner, admin, chef — `m13-counts`
- M13 Q37 — count differences in "Sprechi in €" — no — `m13-counts`
- M13 Q39 — chef sees the activity log — no — `m13-counts`
- M14 Q40 — use-by across a clock change — real elapsed hours — `m14-batch-production`
- M14 Q41 — recipe part of the lot code — first 6 letters — `m14-batch-production`
- M14 Q42 — extra ingredients at production — no — `m14-batch-production`
- M14 Q43 — portions above computed — any 1–10.000 — `m14-batch-production`
- M14 Q44 — production time — moment of confirm — `m14-batch-production`
- M14 Q45 — one ingredient from two places — no — `m14-batch-production`
- M14 Q46 — lot choice — first-expiring, "start from this lot" — `m14-batch-production`
- M14 Q47 — producing with less stock than used — recorded, "Scorta negativa" — `m14-batch-production`
- M15 Q48 — split an expired batch — refused — `m15-batch-actions`
- M15 Q49 — staff meals per day per dish — one per rule per business day — `m15-batch-actions`
- M15 Q50 — staff meal with too few portions — refused — `m15-batch-actions`
- M15 Q51 — undo a discard/staff meal — no; fix with "Conta" — `m15-batch-actions`
- M15 Q52 — who sets staff-meal rules — owner, admin, chef — `m15-batch-actions`
- M15 Q53 — batch actions in Registro — no — `m15-batch-actions`
- M16 Q60 — who gets purchase alerts — owner only — `m16-alert-rules`
- M16 Q61 — who sets batch min/target — owner and admin — `m16-alert-rules`
- M16 Q62 — waste counts as consumption in forecast — no — `m16-alert-rules`
- M16 Q63 — new ingredient with <2 weeks history — missing days count as zero — `m16-alert-rules`
- M16 Q64 — expired stock alert — daily until used or discarded — `m16-alert-rules`
- M16 Q65 — "Ordinato" button — none — `m16-alert-rules`
- M16 Q66 — minimum but no supplier/days — no alert, "Da completare" — `m16-alert-rules`
- M16 Q67 — today's full average and same-day reversals — accepted for MVP — `m16-alert-rules`
- M17 Q68 — closed table shows — "Chiuso" for the day — `m17-menu-tables`
- M17 Q69 — same dish twice at two prices — no — `m17-menu-tables`
- M17 Q70 — chef marks "esaurito" — no — `m17-menu-tables`
- M17 Q71 — dishes sold by weight — no (draft menu has per-etto items) — `m17-menu-tables`
- M17 Q72 — table with no covers — no, 1–99 — `m17-menu-tables`
- M17 Q74 — price for margins — menu price — `m17-menu-tables`
- M18 Q75 — meaning of "segue" — a mark on a dish — `m18-order-entry`
- M18 Q76 — unsent dishes count against portions — no — `m18-order-entry`
- M18 Q77 — when "Ne restano N" shows — at 3 or fewer — `m18-order-entry`
- M18 Q78 — order 2 with 1 left — yes — `m18-order-entry`
- M18 Q79 — price if a push ends before sending — price at order — `m18-order-entry`
- M19 Q97 — segue at the pass — stays on phone until "Invia a seguire" — `m19-firing`
- M19 Q99 — chef sends courses — no — `m19-firing`
- M19 Q100 — raw ingredients from two areas — first-expiring lot anywhere — `m19-firing`
- M19 Q102 — confirm on "Invia" — no — `m19-firing`
- M19 Q103 — void reasons and waste mapping — six reasons per §3.1.7 — `m19-firing`
- M19 Q104 — who sees cost of a sent dish — owner and admin — `m19-firing`
- Q111 — food cost % before sales — menu average, unweighted by sales — `owner-dashboard`
- Q112 — plates without GP target — ranked after targeted ones — `owner-dashboard`
- Q113 — seen items stay on today's list — yes, "Visto" badge — `owner-dashboard`
- Q114 — count dashboard opens now — waits for M22 (status unclear: M22 built it) — `owner-dashboard`
- Q115 — "due soon" window — 7 days — `owner-dashboard`
- UX Q3 — renames (Riordino, "Menu principale", Importa, "Carichi e debito") — C9 only, no V1 — `ux-flows`
- UX Q7 — an "Impostazioni" page — none — `ux-flows`
- M20 Q118 — dish sold out while offline — not recorded — `m20-offline`
- M20 Q122 — two waiters open same table offline — second's dishes listed for re-entry — `m20-offline`
- M20 Q123 — covers and "Conto richiesto" offline — no — `m20-offline`
- M21 Q135 — close a table offline — no — `m21-bill-close`

---

## 3. Pending founder and ops steps

Marked **[blocking]** where the go-live checklist, a gate or a plan ties it to go-live; otherwise **[not blocking]**. Judgement calls are marked "(judgement)".

### Go-live checklist (`docs/go-live/checklist.md`), all `open`
- AT1 — paste the green `service-sim` CI run and minutes (PR #44 reports it green on `d458c50`, 47.1 s; row still "to fill") — DigiAlto — [blocking]
- AT2 — header check on a live preview and on production, `findings` empty — founder — [blocking]
- AT4 — backup self-test, first staging and production "Daily backup"/"Weekly restore check" run links — founder — [blocking]
- G3-1 — full service by waiters on their own phones, real data — client — [blocking]
- G3-2 — end-of-day app vs register variance under 5 % — client — [blocking]
- G3-3 — PRD acceptance checklists Modules 1–3 signed on real data — client — [blocking]
- G3-4 — 4-cover, 3-course table entered in under 90 s after one training — client — [blocking]
- S8-1 — production Supabase project (Free, `eu-central-1`), DB password in password manager — [blocking]
- S8-2 — GitHub environment `production` (founder reviewer, `main` only, 3 secrets, `PRODUCTION_PROJECT_REF`); run "Deploy production database" — [blocking]
- S8-3 — Resend account (free, EU if offered), SMTP only in Supabase; verify sending domain — [blocking]
- S8-4 — Supabase production Auth settings, hook, URLs, SMTP, read Auth rate limits, Vault secrets on staging and production — [blocking]
- S8-5 — Vercel Production env vars (all new), redeploy — [blocking]
- S8-6 — production deployments wait for promotion; note setting name — [blocking]
- S8-7 — Protection Bypass for Automation secret; header check (see AT2) — [blocking]
- S8-8 — Shared Drive folder, service account (Content manager), passphrase, pooler URLs — [blocking]
- S8-9 — GitHub `production-backup` and `staging` backup secrets/vars; setting `PRODUCTION_PROJECT_REF` arms backups — [blocking]
- S8-10 — watch repo issues; create label `backup-failure` — [blocking]
- S8-11 — first backup/restore runs on staging then production; decrypt one file by hand — [blocking]
- S8-12 — pause rehearsal on staging (optional, Q196) — [not blocking]
- S8-13 — performance and Hobby usage measured (G7-1..4, IPHONE-1) — [blocking]
- S8-14 — production tenant via `npm run create-tenant` with confirmed client facts; enrol staff phones — [blocking]
- S8-16 — `VERCEL_AUTOMATION_BYPASS_SECRET` in `staging` and Vault `vercel_protection_bypass` before the timing runs — [blocking]
- G7-1 — B0 baseline: order-entry timing and dashboard Slow-4G runs on staging — [blocking]
- G7-2 — Vercel Usage at B0 into `csp-impact.md` — [blocking]
- G7-3 — "after" runs on staging, Usage again 7 days later — [blocking]
- G7-4 — `csp-impact.md` verdict not "stop" (currently pending) — [blocking]
- FREE-1 — prove a `backup-failure` issue reaches the founder — [blocking]
- FREE-2 — newest Drive copy under 36 h, last restore check green — [blocking]
- FREE-3 — custom domain serving production; `app_base_url` updated; `vercel_protection_bypass` removed (Q188) — [blocking]
- FREE-4 — pause rehearsal (optional) — [not blocking]
- IPHONE-1 — real iPhone vs staging: comanda reloads in flight mode — [blocking]
- DPA-1 — DPA and sub-processor list (Supabase, Vercel, GitHub, Google, Resend, Anthropic), 14-copy retention — client — [blocking] (judgement; listed as accepted risk in the walk)
- RISK-1 — founder confirms accepted risks of `security-walk.md`, incl. the three "proposed" — **done 2026-11-08** (see Founder decisions)
- HOBBY-1 — check Hobby non-commercial terms and over-allowance behaviour (Q9, Q10) — **done 2026-11-08: Vercel Pro for production**

### Runbook (`docs/runbook.md`) "to fill in" and not-yet-done items
- Owner of the Vercel account (Q26) — [blocking] (judgement)
- Owner of the Supabase account (Q26) — [blocking] (judgement)
- Owner of the Anthropic console (Q26) — [blocking] (judgement)
- Owner of the Google Cloud account (Q26) — [blocking] (judgement)
- Owner of the Google Drive Shared Drive (Q26) — [blocking] (judgement)
- Owner of the Resend account (Q26) — [blocking] (judgement)
- Owner of the GitHub account (Q26) — [blocking] (judgement)
- Owner of the domain registrar account (Q26) — [blocking] (judgement)
- Second person able to recover each account — [not blocking] (judgement)
- Restore into a fresh hosted Supabase project, once on a spare Free project ("Not yet rehearsed") — [not blocking] (judgement)
- Confirm the Free-plan inactivity pause period and whether the backup ping counts as activity (T12, T13 unverified) — [not blocking]

### Plan "Manual steps for the founder" still open
- M11 M-1 — T1 spike on staging, plus Vercel `x-forwarded-for` behaviour (T4; also `rate-limits.md` enrolment row); §5.0 says "NOT RUN" — [blocking] (judgement)
- M11 M-2 — check/raise Supabase Auth sign-in rate limit (staging, production) — [blocking] (overlaps S8-4)
- M11 M-3 — Auth security notifications off — [blocking]
- M11 M-4 — `PIN_PEPPER` per environment (also PR #45) — [blocking]
- M11 M-5 — sign-ups stay off on staging and production — [blocking]
- M11 M-6 — client GDPR register entry for staff accounts — client — [blocking] (judgement)
- M25a M-1 — Auth settings: min length 10, OTP 600 s, secure change off, Italian templates, notifications off, note time-box — [blocking]
- M25a M-2 — PIN environment E1–E4 in Vercel for production — [blocking]
- M25a M-3 — real-phone test (iPhone and Android install, sign-in persistence, staff enrol) — [blocking] (judgement)
- M25a M-4 — tell the owner about the one-time session end and first password — [not blocking]
- M25a M-6 — note whether TOTP is available on Free; do not enable — [not blocking]
- M25a M-7 — GDPR register adds "accesso con password" — client — [not blocking]
- M25 A1–A3 — confirm assumptions (magic-link waiters in sim, invariant-clean definition, tenant via `create-tenant`) — PR #44 — [not blocking]
- M12 — create the venue's storage locations — [blocking] (judgement: needed for real stock)
- M13 — tick the critical ingredients before the first daily count — [not blocking]
- M14 — batch recipes with output, portions, shelf life before real production (Q2) — [blocking] (judgement)
- M16 — supplier delivery days and ingredient minimums (Q2, Q3) — [not blocking]
- M17 — real table names, coperto, menu items — [blocking] (judgement)
- M18 / M22 AT7 — order-entry and 4G timing runs on staging (now G7-1/G7-3) — [blocking]
- M19 — Gate 3: kitchen screen at the pass, normal and high-contrast — [blocking]
- M19b — Gate 3: Fatto, Chiudi comanda, Annulla, Riapri for one service — [blocking]
- M20 — Gate 3: airplane-mode order on venue iPhone and Android, badge back to zero — [blocking]
- M21 — Gate 3: close three tables (one without number), register total on `/chiusura` vs RCH — [blocking]
- M22 — DigiAlto checks `job_run_latest('kpi-rollup')` on staging; Gate 4 dashboard-opens query — [not blocking]
- M23 — DigiAlto checks push pin on a waiter device and its end at cut-off; Gate 4 `menu_push` query — [not blocking]
- M24 — CSV opens in Excel (Italian) and Google Sheets; pack prints to A4 from iPhone and laptop — [not blocking]
- M24 Q170 — send `kpis.csv` and `waste-costs.csv` to the accountant — [not blocking]
- M25b — ten-minute phone walkthrough on staging; report screens to move — [not blocking]
- M25c — DigiAlto checks default service hours and a past day's split on staging — [not blocking]
- Demo plan step 4 — purge the demo data from the staging tenant ("Elimina dati di prova" or `--purge`) — [not blocking] (production is a new tenant without demo data)

### From PR bodies (#44 "Open questions and founder steps" and others)
- PR #44 — fill `csp-impact.md` slots after staging runs, in PR `docs/m25-csp-impact` — [blocking]
- PR #44 — `production` and `production-backup` deployment branches `main` only — [blocking]
- PR #24 / PR #3 — confirm `staging` environment has "Deployment branches: main only" and required reviewer — [not blocking] (judgement)
- PR #52 — staging Vault: `app_base_url`, `cron_secret`, `vercel_protection_bypass` (S8-4/S8-16) — [blocking]
- PR #56 — create the `extraction-contract` environment (`ANTHROPIC_API_KEY`, `EXTRACTION_MODEL_ID`), run the smoke before a release — [not blocking] (judgement)
- PR #55 — retry the failed staging invoice ("Riprova lettura") to confirm the wire-schema fix (status not visible in repo) — [not blocking]
- PR #8 — confirm the Anthropic account is on commercial/API terms (data processing terms) — [blocking] (judgement)
- PR #8 / Q1 — supply 9 more anonymised invoice pairs (1 of 10 on main) for the full contract test — [not blocking]
- PR #6 — upload an invoice from a phone on the deployed app (Content-Length and Origin on preview and custom domain) — [not blocking]
- PR #29 — check branch protection required checks vs `paths-ignore` — [not blocking]
- PR #9 / Q121 — supply the logo — [not blocking]
- PR #10 — chef answers A-01…A-22 (allergens), S-01…S-13, M-01…M-10, R-01…R-22 in `docs/client/` — [blocking] (judgement: allergens and menu before real service)
- `docs/client-facts.md` — approve legal name, VAT number, owner e-mail (needed for S8-14), menu, prices, allergens — [blocking]
- PR #45 — founder FYI: whole words "osteria"/"rossi" refused in passwords — [not blocking]

---

## Counts

| Section | Lines |
|---|---|
| 1. Open follow-ups | 52 (several lines bundle related sub-items) |
| 2. Open plan questions | 151 (some lines merge the same question asked in several plans, e.g. Q20 / M3 Q2 / M4 Q1 / M5 Q2) |
| 3. Pending founder and ops steps | 89 (63 marked blocking, of which some are judgement calls) |

## Top 10 before go-live (judgement)

1. Production stack set up: Supabase project, GitHub `production` env and migration run, Vercel Production vars, Auth settings and Vault (S8-1 to S8-6, S8-16, M11 M-2 to M-5, M25a M-1/M-2).
2. Backups armed and proven: Drive, service account, passphrase, secrets, first staging and production runs, hand decryption, `backup-failure` alerting (S8-8 to S8-11, AT4, FREE-1/2).
3. Custom domain and Resend sending domain (Q12/Q188, FREE-3, S8-3).
4. CSP cost measured and verdict not "stop", plus the header check on preview and production (G7-1 to G7-4, `csp-impact.md`, AT2).
5. Raw-stock business-day follow-up, so `stock_reconciliation`, AVT and `waste_costs` agree (PR #50, A5 §7.4; L).
6. GDPR and contracts: DPA and sub-processor list, privacy text, retention, staff register entry, Anthropic terms (Q13, Q14, DPA-1, M11 M-6, PR #8).
7. Accounts and billing: Hobby non-commercial terms, plan choice, who owns each account (Q9, Q10, Q26, HOBBY-1, runbook owners).
8. Gate 3 on real data: full service, under-5 % register variance, PRD checklists, 90 s table entry, iPhone offline reload, real-phone sign-in test (G3-1 to G3-4, IPHONE-1, M25a M-3).
9. Production tenant with approved client facts and real master data: legal name, VAT, owner e-mail, recipes, allergens (chef questions), tables, coperto, menu, storage locations (S8-14, Q2, Q4, Q5, PR #10).
10. Fiscal confirmations with the accountant: totals gross vs net and VAT rates, sale and coperto VAT, payment types, negative lines and credit notes (Q20, M8 Q3, M17 Q73, Q126, M3 Q3, M9 Q30); plus RISK-1 sign-off of the accepted risks.
