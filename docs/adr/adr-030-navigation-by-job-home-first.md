# ADR-030: Six job groups, Home first, and an "Altro" tab when a role has more than five

- **Status:** accepted (supersedes ADR-020); decision 4 superseded by ADR-041 for owner and admin
- **Date:** 2026-11-01 · **Decided by:** founder (request of 2026-11-01 through the lead; Q207–Q219 of `docs/plans/2026-11-01-m25b-navigation.md` carry the open parts; accepted with the plan on 2026-11-01)

## Context

**What ADR-020 built** (`src/lib/nav/nav-model.ts`, `src/app/(owner)/app-shell.tsx`)
- Five groups: Oggi, Acquisti, Cucina, Sala, Gestione.
- Phone: a bottom tab bar (`nav "Sezioni"`, one tab per group) and a wrapping row of pills for the current group (`nav "Menu principale"`). Laptop: a sidebar with every group.
- Each section is filtered by the screens' own `can*` gates. Hiding a link is not authorisation; the API and RLS decide.

**What the founder asked for (2026-11-01)**
- Home first: open alerts at the top, then the dashboard.
- Six groups: Home; Gestione (Fatture, Pagamenti); Cucina (Produzione, Magazzino, Riordino); Sala (Tavoli, Menu); Anagrafica (Ubicazioni, Ricette, Fornitori, Ingredienti, Personale); Registro (Sicurezza, Costi, Chiusura, Report).
- The least possible friction on a phone. Roles stay exactly as they are.

**Constraints**
- ADR-020 limits: at most 5 tabs on the phone, at most 6 pills in a row, no drawer (closed links are absent from the accessibility tree), no horizontal scrolling (ui-foundation).
- URLs are used by links, e-mails (payable reminders, alerts), service-worker shell pages and every e2e spec.
- Project invariants: screens read `/api/*`; no data logic in React; roles are enforced in Postgres.

## Decision

1. **Six groups, regrouping only.** The model keeps its shape (`Section`, `NavGroup`, `navFor`, `currentSection`). Group keys become `home`, `gestione`, `cucina`, `sala`, `anagrafica`, `registro`. **No URL changes**, so no redirect is needed. Every section keeps the gate it has today; the one new section, `/sicurezza` (an empty "in arrivo" page), is owner and admin only.
2. **Phone tabs come from the model too.** `phoneTabs(role)`: when a role has five groups or fewer, one tab per group; otherwise the first four groups and a fifth tab **"Altro"** that opens `/altro`, a plain page listing the remaining groups and their sections as 44 px links. Owner and admin: Home · Gestione · Cucina · Sala · Altro (Anagrafica, Registro). Chef: Home · Cucina · Anagrafica. Waiter: one group, no bar.
3. **The section row, the sidebar, `aria-current` and back links work as in ADR-020.** On `/altro` and on any page of an overflow group the "Altro" tab is current. The sidebar lists all six groups.
4. **Home** (`/`) shows, in this order: the open alerts (owner and chef; the admin has no alert access), the dashboard tiles in a compact form (headline and one link each, details behind a "Dettagli" toggle), the to-do actions, the first steps, the account card.

## Alternatives

- **Six tabs.** Pro: one tap to every group. Con: below 60 px per tab at 360 px; breaks ADR-020's limit. Not chosen.
- **Registro under Gestione on the phone only.** Pro: no extra page. Con: 7 pills in one row (over the 6 limit), and the phone and laptop groupings would differ. Not chosen.
- **No Home tab; the wordmark leads home.** Pro: five real groups. Con: Home is where the owner lands and comes back to; a hidden way back adds friction. Kept as a variant (plan V2).
- **A drawer or bottom sheet for "Altro".** Pro: no page load. Con: rejected by ADR-020 (hidden links, an extra toggle state to test). A page is simpler: it is a plain route like the others. Like them it is not in the service worker's shell pages (`/`, `/tavoli`, `/tavoli/comanda`), so offline it shows the generic offline page; adding it to `SHELL_PAGES` is a separate decision.
- **Renaming URLs to match the groups (`/gestione/fatture`, `/registro/costi`).** Pro: tidy addresses. Con: 60 route moves, redirects for links in e-mails and alerts, and every e2e spec changes. No user benefit. Not chosen.

## Consequences

**Good**
- The founder's grouping on every screen size, with the same pure model and one exhaustive role table test.
- No URL, API role list or RLS policy changes; a role sees exactly the links it saw before, plus "Sicurezza" for owner and admin.
- Room for growth: Sala, Gestione and Home have free pill slots; "Altro" can hold more groups without a sixth tab.

**Bad, and accepted trade-offs**
- Owner and admin reach Anagrafica and Registro (including Chiusura) in two taps on a phone instead of one.
- Anagrafica is at the 6-pill limit for owner and admin; the next master-data screen needs a decision (M25c's service settings are planned for Sala).
- Home makes one more request for the owner and the chef (`GET /api/alerts?filter=open&limit=3`).
- The ADR-020 e2e and unit lists are rewritten.

**What would make us revisit this**
- Owners using Chiusura or Report daily from the phone (a candidate to swap Registro and Sala, plan V1).
- A role needing more than two overflow groups.
- M31 (HACCP) needing the chef in Registro.
