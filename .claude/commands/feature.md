---
description: Plan, build, verify and review one feature (architect → tdd-guide → code-reviewer)
argument-hint: <feature, or a milestone from docs/plans/>
---

Build this feature end to end: $ARGUMENTS

1. Work on a new branch `feat/<short-name>`; never on `main`.
2. **Plan:** `architect` subagent → `docs/plans/<YYYY-MM-DD>-<short-name>.md` from
   `templates/tech-plan.md`, using `docs/prd.md` (if present) and `docs/client-facts.md`.
   Skip only for a change of a few lines with an obvious test. If the plan adds a paid service,
   a non-permissive licence or changes personal-data handling, stop and ask the founder.
3. **Build:** `tdd-guide` subagent with the plan, one step at a time.
4. **Red build/tests:** `build-error-resolver` subagent with the failing command and output.
5. **Verify:** run every command in CLAUDE.md "Stack and commands" (build, types, lint, tests
   with coverage); walk the `security-checklist` skill for the areas touched; for pages,
   `python3 scripts/viewport_check.py <html files>`.
6. **Review:** `code-reviewer` subagent on `git diff main...HEAD`. On FAIL send findings back to
   `tdd-guide` and repeat 5–6, at most two rounds, then stop and report.
7. Between steps, write a hand-off from `templates/handoff.md` next to the plan.
8. Commit, push, open a draft PR with: what changed, the verification results, the review
   verdict, open questions. Report the PR link.
