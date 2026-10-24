---
name: tdd-workflow
description: Use when implementing a feature, fixing a bug or adding tests in a software project - the red/green/refactor loop DigiAlto engineering agents follow, with coverage and test-quality expectations.
---

# TDD workflow

## Loop (per step of the plan)
1. **Red.** Write one test for the next small behaviour. Run it. It must fail, and for the
   reason you expect (not an import error).
2. **Green.** Write the least code that passes. Run the whole suite.
3. **Refactor.** Clean names and duplication with the suite green. Run it again.
4. Commit-sized: one behaviour per loop. Repeat.

Bug fix: the first test reproduces the bug. It fails before the fix and passes after.

## What to test
- Happy path, empty input, invalid input, boundaries (0, 1, max), error path.
- Public behaviour (function results, HTTP responses, rendered output), not private internals.
- One reason to fail per test; the test name says the behaviour:
  `test_rejects_booking_in_the_past`.

## Test types
| Type | Scope | Speed | Share |
|---|---|---|---|
| Unit | one function/module, collaborators faked | ms | most |
| Integration | real DB/API boundary in a test environment | s | some |
| End-to-end | critical user flows in a browser (Playwright) | slow | few |

## Rules
- Inject or fake time, randomness and network in unit tests.
- Tests are independent: no order dependence, no shared mutable state.
- Fixtures are small and fake. Never real client or customer data, never real keys.
- Integration fixtures hold at least two of anything a tenant can have several of (locations,
  suppliers, users). Bugs that appear only with a second one pass a one-of-each fixture.
- E2E: a control nested inside its `<label>` takes the selected option into its accessible name.
  Find it by role and a name prefix (`getByRole("combobox", { name: /^Supplier/ })`), not
  `getByLabel(..., { exact: true })`.
- Find list items by id or name, never by position, unless the test is about the order; lists
  sorted by name reorder as soon as a fixture gains a row.
- Coverage target 80% of lines for new code. Coverage is a floor, not the goal; a test
  that asserts nothing doesn't count.
- Never skip, delete or loosen a failing test to get green. Fix the code, or explain why
  the test is wrong.

## Commands (use whatever the project already has)
- Python: `pytest -q`, coverage `pytest --cov=<pkg> --cov-report=term-missing`
- JS/TS: `npm test`, coverage `npx vitest run --coverage` or `npx jest --coverage`
- E2E: `npx playwright test`
