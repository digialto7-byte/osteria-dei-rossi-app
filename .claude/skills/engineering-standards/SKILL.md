---
name: engineering-standards
description: Use when writing, planning or reviewing code for a software project (web app, API, integration, automation, script) - DigiAlto's coding standards for structure, naming, errors, frontend, backend/API, data and dependencies.
---

# Engineering standards

Defaults for DigiAlto software work. A project's own `CLAUDE.md` or linter config wins where it
is stricter or different.

## General
- Read before writing: find the existing helper, pattern or component before creating one.
- Small units: functions do one thing (aim < 50 lines), files have one responsibility
  (aim < 400 lines). Split by feature, not by type.
- Names say what, not how: `fetchOpenOrders`, `isEligible`, `MAX_RETRIES`. No `data2`, `tmp`, `util`.
- Prefer immutable data: return new objects instead of mutating arguments.
- Validate at the boundary (HTTP input, files, env vars, third-party responses); trust
  internal calls after that.
- Errors: fail loudly with context (`raise ValueError(f"unknown plan {plan_id}")`); never
  swallow exceptions; user-facing messages never leak stack traces or internals.
- No magic numbers or strings: name them once.
- Comments explain why, not what. Delete dead code; git remembers it.
- No debug leftovers in committed code (`console.log`, `print`, `debugger`, commented-out blocks).
- Config and secrets from environment variables; commit a `.env.example` with fake values only.

## Frontend (HTML/CSS/JS, React/Next.js)
- Semantic HTML first; accessible by default (labels, alt, focus states, keyboard use,
  WCAG AA contrast, `prefers-reduced-motion`).
- Mobile-first; no horizontal scroll at 360px (`python3 scripts/viewport_check.py`).
- Components small and presentational; state lifted only as far as needed; derive instead of
  duplicating state; effects only for syncing with the outside world.
- Never inject HTML from data (`innerHTML`, `dangerouslySetInnerHTML`) unless sanitised.
- Performance budget: images sized and lazy-loaded, fonts `font-display: swap`, no library
  for what 20 lines of code can do.

## Backend and APIs
- Resource-shaped REST (`GET /orders/:id`, `POST /orders`), correct status codes, one error
  format: `{"error": {"code": "...", "message": "..."}}`.
- Validate every request body with a schema (zod, pydantic, ...). Reject unknown fields.
- Authorisation checked per resource, not only per route.
- Database: parameterised queries only; migrations in version control; index what you filter
  on; avoid N+1 (batch or join).
- Supabase: a new table that tests, jobs or scripts read with the secret key needs an explicit
  `grant select ... to service_role` when its grants were revoked. Bypassing RLS is not a table
  privilege, and tests that run as the table owner do not notice a missing grant.
- External calls: timeouts, retries with backoff for idempotent calls only, and a clear
  failure path.
- Log events with context (ids, durations), never personal data, tokens or full payloads.

## Python
- Type hints on public functions; `pathlib` for paths; f-strings; `ruff` for lint/format;
  `pytest` for tests.

## TypeScript / JavaScript
- `strict` TypeScript; no `any` without a comment explaining why; `const` by default;
  `async/await` with explicit error handling; ESLint + Prettier.

## Dependencies
- Add a dependency only when it saves real work. Check licence (MIT/Apache/BSD fine; GPL
  needs the founder), last release date and download count. Pin versions via the lockfile.

## Git
See `.claude/rules/git-workflow.md`.
