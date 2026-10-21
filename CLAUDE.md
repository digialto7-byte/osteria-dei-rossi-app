# <Project name>

<One paragraph: what this software does, for whom (DigiAlto client `<slug>` or internal), and
where it runs.>

Built and maintained by **DigiAlto** (always written with a capital A).

## Stack and commands
| Task | Command |
|---|---|
| Install | `<npm ci | pip install -r requirements.txt>` |
| Dev server | `<npm run dev>` |
| Build | `<npm run build>` |
| Type check | `<npx tsc --noEmit | pyright>` |
| Lint / format | `<npm run lint | ruff check . && ruff format --check .>` |
| Tests | `<npm test | pytest -q>` |
| E2E | `<npx playwright test>` |

## Ground rules
1. **Client facts** (names, URLs, prices, legal texts) come only from `docs/client-facts.md`,
   copied from the approved profile in DigiAlto-Ops. Never invent them; ask the founder.
2. **Secrets** only in environment variables. `.env` is gitignored; `.env.example` holds fakes.
3. **Test first** for new behaviour (`tdd-workflow` skill). Never skip or weaken a failing test.
4. **Standards:** `engineering-standards` and `security-checklist` skills.
5. **Branches and PRs** for every change; `main` stays deployable.

## Commands
| Command | What it does |
|---|---|
| `/feature <feature or milestone>` | Plan → test-first build → verify → code review → draft PR |
| `/tdd <task or plan>` | Implement test-first, then code review |
| `/build-fix [command]` | Smallest correct fix for a red build, lint, type check or test run |
| `/review-code [base or paths]` | `code-reviewer` on a diff → PASS / FAIL |

The product requirements live in `docs/prd.md`; the overall plan and milestones in `docs/plans/`.

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
4. PR description: what changed, how it was verified, open questions.

## Where things go
| Path | Purpose |
|---|---|
| `src/` | Application code |
| `tests/` | Tests mirroring `src/` |
| `docs/prd.md` | Product requirements (copied from DigiAlto-Ops at kickoff) |
| `docs/plans/` | Tech plans from `architect` (project plan + one per feature) |
| `docs/adr/` | Architecture decision records |
| `docs/client-facts.md` | Approved client facts this project may use |
