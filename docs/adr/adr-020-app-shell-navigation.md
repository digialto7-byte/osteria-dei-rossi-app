# ADR-020: One app shell with role-based navigation grouped by job

- **Status:** proposed
- **Date:** 2026-10-28 · **Decided by:** founder (on `docs/plans/2026-10-28-ux-flows.md`; open questions Q1–Q3 there)

## Context

**The navigation today**
- Home `/` (`src/app/page.tsx`) sits outside the `(owner)` layout, so it has no navigation. It shows a list of 9 text links that misses Fatture, Ricette, Costi and Personale.
- Every other signed-in page carries `OwnerNav` (`src/app/(owner)/owner-nav.tsx`): one flat, wrapping row of pills in data-table order.
  - The owner has 16 pills, the admin 15, the chef 12 and the waiter 7.
  - Five pills ("Fatture", "Fornitori", "Ingredienti", "Ubicazioni", "Importa") show to every role, although the API refuses them for the waiter and partly for the chef.
  - The pills sit above the waiter's comanda as well.

**Constraints**
- PRD: phone first for waiters and kitchen, 44 px targets, Italian UI.
- ui-foundation:
  - no icon fonts or images;
  - wrapping instead of horizontal scrolling;
  - `expectPhoneFriendly` forbids sideways overflow.
- Project invariants: screens read `/api/*` only; roles are enforced in Postgres; waiters never see costs and the chef never sees €.
- Later milestones need slots: M19 kitchen tickets, M21 day close, M22 and M23 dashboard and push list.

## Decision

**One pure navigation model.** `src/lib/nav/nav-model.ts` holds sections grouped by job: **Oggi, Acquisti, Cucina, Sala, Gestione**.
- Each section is filtered by the existing `can*` role gates, plus three new mirrors of API role lists (`canReadInvoices`, `canReadMasterData`, `canEditMasterData`).

**One shell around every signed-in page, home included.**
- On phones: a fixed bottom tab bar of at most 5 group tabs (`nav "Sezioni"`), and a wrapping row with the current group's sections (`nav "Menu principale"`).
- On laptops (≥ 1024 px): a sidebar with all groups (`nav "Menu principale"`).
- Focus screens with their own sticky bars (the comanda and the count in progress) show neither.
- The role comes from one cached `/api/me` read (`useMe`), which is reset on logout and PIN login.
- The waiter has a single group and lands on `/tavoli`.
- M19 adds "Comande" (`/cucina`) as the first section of Cucina for chef, owner and admin. It is not a focus route: it has no sticky bottom bar of its own, and the chef needs the tab bar and "Esci" on a shared kitchen device. A kiosk layout stays a revisit trigger (below).

## Alternatives

- **Drawer or hamburger menu.** Pro: it fits any number of items. Con: the nav is hidden, it costs an extra tap, and closed links are absent from the accessibility tree. Not chosen.
- **Horizontally scrolling tabs.** Pro: one line. Con: items are off-screen, and it breaks the overflow rule and the ui-foundation choice. Not chosen.
- **Role filtering of the flat list only.** Pro: the smallest change. Con: the owner still has 16 items above every page. Not chosen.
- **Separate route groups `(sala)`, `(cucina)` and `(admin)` with their own layouts (project plan §3.2).** Pro: physical separation. Con: 100+ file moves for no URL or security gain, since roles are enforced in Postgres. Deferred, to be revisited at M19.
- **Role read from JWT claims in a server layout.** Pro: no loading flash. Con: it would be the first screen code to read the session outside `/api/*`. Not chosen; a fixed-height placeholder removes the jump instead.

## Consequences

**Good**
- Every role sees only what it can open.
- The phone nav is one bar plus at most one wrapped row.
- Home has the nav and is now a role-based "Oggi".
- Later milestones add a section with one row in the model.
- Role visibility becomes one exhaustive unit-tested table.

**Bad, and accepted trade-offs**
- Some existing e2e assertions about the old nav change. Two of them encoded a bug, the waiter seeing "Fatture".
- Pages that the chef can still open by URL (Fornitori, Ubicazioni) drop out of the chef's nav.
- The landmark name "Menu principale" stays for compatibility until a rename is approved.

**What would make us revisit this**
- A role needing more than 5 groups.
- The kitchen screen (M19) needing a full-screen, kiosk-like layout.
- The founder choosing different group names (plan Q1).
