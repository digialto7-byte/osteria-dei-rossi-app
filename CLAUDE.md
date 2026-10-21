# Osteria Dei Rossi app (Osteria Digitalization)

A phone-first, Italian-language web app (PWA) for DigiAlto client `osteria-dei-rossi`. It runs
alongside the RCH fiscal register: supplier invoices feed prices and raw stock, recipes turn raw
stock into batches and portions, waiter orders deplete portions, and reports show margins, alerts
and what to push before it expires. One Next.js app on Vercel (EU region) in front of Supabase
(EU region); nothing is hosted at the venue. Multi-tenant (`tenant_id` + RLS) from day one,
single-venue UX for now.

Built and maintained by **DigiAlto** (always written with a capital A).

## Stack and commands
Stack: Next.js 16 App Router, TypeScript strict, Tailwind CSS v4, Zod 4, Supabase (Postgres + RLS,
Auth, Storage, Realtime, pg_cron), Claude API for invoice extraction, Vitest, pgTAP, Playwright.
Details and reasons: `docs/plans/2026-10-21-project-plan.md` §3 and `docs/adr/`.

The scripts below are created in milestone M0; until M0 is merged they do not exist yet.

| Task | Command |
|---|---|
| Install | `npm ci` |
| Local database | `npx supabase start` (local stack), `npx supabase db reset` (migrations + fake seed) |
| Dev server | `npm run dev` |
| Build | `npm run build` |
| Type check | `npx tsc --noEmit` |
| Lint / format | `npm run lint` and `npm run format:check` |
| Tests | `npm test` (Vitest) and `npx supabase test db` (pgTAP: RLS, procedures, ledgers) |
| E2E | `npx playwright test` |

## Ground rules
1. **Client facts** (names, URLs, prices, legal texts) come only from `docs/client-facts.md`,
   copied from the approved profile in DigiAlto-Ops. Never invent them; ask the founder.
2. **Secrets** only in environment variables. `.env` is gitignored; `.env.example` holds fakes.
   The Supabase secret key is used only in `/api/cron/*` services and `scripts/`, never in the
   browser or user-facing routes.
3. **Test first** for new behaviour (`tdd-workflow` skill). Never skip or weaken a failing test.
4. **Standards:** `engineering-standards` and `security-checklist` skills.
5. **Branches and PRs** for every change; `main` stays deployable. One milestone = one
   `/feature` run = one `feat/m<NN>-<name>` branch = one draft PR.
6. **Project invariants** (plan §3.6, ADR-002, ADR-003), never broken by a milestone:
   - stock and portion balances are only derived from the movement ledgers, never stored;
   - ledgers are append-only; nothing is deleted, only reversed;
   - `approve_invoice`, `produce_batch`, `fire_course`, `void_line` and the other procedures are
     single transactions;
   - recipes are immutable versions; costs are frozen at production and at sale;
   - every table has `tenant_id` and RLS; roles are enforced in Postgres, not only in the UI;
     waiters never see costs;
   - every screen reads `/api/*` JSON; no data logic in React components;
   - the extraction model ID comes from `EXTRACTION_MODEL_ID`, never a literal in `src/`.
7. **UI language** is Italian (English second locale); amounts as `1.234,50 €`; dates in
   Europe/Rome.

## Commands
| Command | What it does |
|---|---|
| `/feature <feature or milestone>` | Plan → test-first build → verify → code review → draft PR |
| `/tdd <task or plan>` | Implement test-first, then code review |
| `/build-fix [command]` | Smallest correct fix for a red build, lint, type check or test run |
| `/review-code [base or paths]` | `code-reviewer` on a diff → PASS / FAIL |

The product requirements live in `docs/prd.md`; the overall plan and milestones in
`docs/plans/2026-10-21-project-plan.md` (milestone list in §5, specifications in §5a). Start a
milestone with `/feature M<NN>`; its plan goes in `docs/plans/<date>-m<NN>-<name>.md`.

## The team
| Agent | Use for |
|---|---|
| `architect` | Tech plan / ADR before non-trivial work (`docs/plans/`, `docs/adr/`) |
| `tdd-guide` | Implementing plan steps test-first |
| `build-error-resolver` | Red build, types, lint, tests or CI |
| `code-reviewer` | Review of every diff before it is called done (PASS/FAIL) |

## Definition of done
1. Build, types, lint and tests pass (commands above), new code ≥ 80% line coverage.
2. Security checklist walked for the areas the change touches; dependency audit clean.
3. `code-reviewer` PASS on the diff.
4. The milestone's acceptance tests from plan §5a all pass.
5. PR description: what changed, how it was verified, open questions.

## Where things go
| Path | Purpose |
|---|---|
| `src/` | Application code (layout in plan §3.2) |
| `supabase/migrations/`, `supabase/tests/` | SQL migrations and pgTAP tests |
| `tests/`, `e2e/` | Vitest and Playwright tests |
| `docs/prd.md` | Product requirements (copied from DigiAlto-Ops at kickoff, 2026-10-21) |
| `docs/plans/` | Tech plans from `architect` (project plan + one per milestone) |
| `docs/adr/` | Architecture decision records |
| `docs/client-facts.md` | Approved client facts this project may use |

Status, decisions and scope changes are recorded in DigiAlto-Ops
(`clients/osteria-dei-rossi/context.md`), not here.
