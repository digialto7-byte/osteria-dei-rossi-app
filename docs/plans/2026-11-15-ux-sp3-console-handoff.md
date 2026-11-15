# Hand-off — steps 1–12 → steps 13–21 (tdd-guide)

- **Task:** SP3 step 18, the DigiAlto console screens (`docs/plans/2026-11-15-ux-sp3-console.md`)
- **Client slug / internal:** osteria-dei-rossi (Costì product surface)
- **Date:** 2026-11-15

## Context
Steps 1–12 are on `feat/ux-sp3-console` (#142, draft): the strings, the pure helpers, `console-api.ts`, the venue challenge-form fallback, the
console sign-in, code and enrolment pages, and the required `paths` on `EnrolFactor`. The code-reviewer passed them after one round (the
switch guard could get stuck for the whole tab; fixed in 84414294).

## Inputs for the next agent
- Files to use (paths): the plan with "Lead decisions" and §7a; `src/lib/console/*`; `src/components/console/*`; once #140 is on `main`,
  `src/lib/platform/api.ts`, `codes.ts`, `src/components/console/console-band.tsx`, `tests/config/sp3-preserves.test.ts`.
- Facts used: none (demo names only).

## Decisions made
- Every "Riprova" handler in steps 16–20 (`retryTenants`, the detail, the Registro, the Avvisi) **must call `resetConsoleSwitch()` before
  reading again**, and nothing automatic may call it. Without it, "Riprova" on «La console non risponde…» can never switch again.
- `ConsoleBand` takes a required `account: ReactNode | null` (#140's rework): «Esci» goes in the band (base plan, not V1).
- `usePathname()` gives the visible path on the console host: no V3. Every way into `/login/attiva-codice` is a full document load.
- `VENUE_ENROL_PATHS` stays a named constant (lead).
- An erased venue shows «Locale cancellato» + the 8-character id prefix (`console.audit.erasedPlace`, da approvare).

## Open questions
- None open for these steps. #142 stays draft until #140 and SP3 step 16 (proxy) are on `main`.

## Expected output
- Steps 13–21 of the plan, one commit each, on the same branch, after `main` (with #140) is merged in.
