# UX strategy: Osteria Dei Rossi app, and the path to a DigiAlto SaaS product

- **Client slug:** `osteria-dei-rossi` (internal planning document, English)
- **Author:** architect · **Date:** 2026-11-13 · **Worktree / branch:** `/home/user/osteria-ux-strategy`, `docs/ux-strategy` (from `origin/main`)
- **Status:** planning only. No build before go-live (2027-01-12) and the supervised run (2027-01-12 → 2027-01-30, project plan §1.2).
  **Update 2026-11-13 (founder decision, via the lead):** phase P1 (the quick wins) is built **before go-live** and before P0 (see §9.2 and
  `docs/plans/2026-11-13-ux-quick-wins.md`). Every other phase still waits as written.
  Each phase in §9 gets its own `docs/plans/<date>-<name>.md` and `/feature` run when it starts. The lead records decisions in
  DigiAlto-Ops `clients/osteria-dei-rossi/context.md`.
- **Builds on:** `docs/plans/2026-10-28-ux-flows.md` (the first UX audit; its PR A–C components exist in `src/components/`: `back-link.tsx`,
  `empty-state.tsx`, `collapsible-add.tsx`, `deactivate-button.tsx`, `facet-links.tsx`, `name-filter.tsx`), ADR-020 and its successor
  **ADR-030** (six groups, Home first, "Altro"), `docs/plans/2026-11-01-m25b-navigation.md` (questions Q207–Q219 answered by the founder
  on 2026-11-01: Q207 and Q208 as proposed, the defaults stand for the others; m25b §7), `docs/design/ui-foundation.md`,
  `docs/plans/2026-11-11-phase2-scope.md`.
- **Where this document departs from earlier decisions**, it says so at the point of departure and adds a founder question (§10).
  Nothing here changes a decision silently.
- **Client facts used:** trading name, the eight brand colours and the two fonts (`docs/client-facts.md`). Nothing else. The logo is not
  approved; the privacy contact and booking hours are `[PENDING founder]`.
- **Founder brief 2026-11-13.** Several inputs come from the founder's brief of 2026-11-13, passed on by the lead: the working conditions
  (gloves, wet hands, noise, glare), brand colours only, bars and coffee shops as future customers, and the 0–4 severity scale. Each is
  marked "founder brief 2026-11-13, via the lead; to be recorded in DigiAlto-Ops context.md" where it is used.
- **Founder decisions 2026-11-13** (via the lead) are listed after the summary and applied throughout; the §10 entries they answer are
  marked "decided".
- **Research status:** external best practice is cited only where a source was read on 2026-11-13 (§4.1): the WCAG 2.2 Recommendation
  from w3.org, Nielsen's heuristics, severity scale and response times from nngroup.com, offline guidance from web.dev, Apple HIG,
  Android developer guidance and MDN. Material's site could not be read, and kitchen display practice and Italian UI writing still have
  no source (§4.2); no claim is made on them.

---

## 0. Summary for the founder

**What this is.** This is a plan for how the app should look, feel and be organised. It covers the restaurant now and the product
you want to sell to other venues later. It is only a plan. Nothing gets built until after go-live and the two supervised weeks.

**What we found.** The app already does the job. The kitchen screen, the stock count and the table orders are in good shape. The
remaining friction is in a few places:
- A guest on the booking page who taps the restaurant's name ends up on the staff sign-in page.
- The booking form disables its "Invia" button and does not say which field is missing.
- When a guest asks for a table, nothing on your Home page tells you.
- On your Home page, "Carica una fattura" sits below all the dashboard figures.
- The day close is two taps away, although you do it every day.
- A waiter can leave a table without sending a course. The order bar counts dishes but does not say how many are not yet sent.
- On a shared kitchen phone, "Esci" is at the bottom of Home only.

**What we propose, in order.**
1. **Measure first.** During the supervised run, outside service hours, each person does a few real tasks while we count taps,
   time and mistakes. That gives a baseline. A table in §8 collects the friction you notice yourself.
2. **Quick wins.** About ten small fixes for the problems above, each tested.
3. **One design system that can wear any venue's colours.** This is the SaaS step. Each venue gets its own palette, fonts and name.
   The app checks every colour pair for readability before it accepts a theme. Your restaurant's theme uses only your eight approved
   colours and your two fonts.
4. **Redesign role by role:** waiters, then kitchen, then you, then the set-up screens for new venues and the public booking page.
   After each step the same staff repeat the same tasks, and a step only ships if they are at least as fast and accurate as before.

**What you decided on 2026-11-13** (next section): the day close stays on Home; your theme uses only the eight approved colours and the
two approved fonts; restaurants come first for the SaaS product; the tiers wait for the platform decision; the friction table in §8 stays
blank; the research sites are approved.

**What we still need from you** (full list in §10, each with a default):
- Nothing more on research: the sites you approved were read on 2026-11-13. Only Material's site, kitchen-screen practice and Italian
  interface-writing guidance stay unsourced (§4.5).
- Who "admin" is for other venues (Q-UX10): this is still open. Until you decide, DigiAlto staff set up each venue.
- The other §10 questions, for example the Home order (Q-UX4) and whether guests must give both phone and e-mail (Q-UX7).

---

## Founder decisions 2026-11-13

Passed on by the lead on 2026-11-13; to be recorded in DigiAlto-Ops `clients/osteria-dei-rossi/context.md`. The "Decision" column holds
only what the founder decided. The last column is how the architect applies it in this plan; the §10 entry it answers is marked
"decided". FD3 and FD14 are platform decisions in `docs/plans/2026-11-13-platform-saas.md` (PR #81).

| # | Decision | Answers | Applied as (architect) |
|---|---|---|---|
| D1 | The day close stays on **Home** | Q-UX5 (default) | QW7 is the step. Variant V1 (Registro as a tab) is closed and not built (§9b) |
| D2 | The osteria theme uses **only the eight approved colours and the two approved fonts** | Q-UX2 (default) | §6.3's brand-only mapping is the plan, built in DS1. Variant V4 (derived shades) is closed and not built (§9b) |
| D3 | **Restaurants first** (platform FD14) | Q-UX9 | Restaurants are built first; counter service is **deferred, not excluded**: it is variant V7 (§9b). This plan's interpretation for P6: no counter-service work in P6, and A2's venue-type step offers restaurant types only until V7 |
| D4 | **Tier mapping waits for platform FD3** | Q-UX10, tier part only | ENT1 stays in P6 with no tier content; no section is assigned to a tier until FD3 is decided. The admin part of Q-UX10 was not decided and stays open (§10) |
| D5 | The UAT friction table (§8) **stays blank** | n/a | §8 unchanged; no rows are filled by the lead or the architect |
| D6 | **Research sites approved:** `www.w3.org`, `nngroup.com`, `m3.material.io`, `web.dev` | Q-UX1 | §4.2 records what could be read. R19–R23 were added from w3.org, nngroup.com and web.dev; m3.material.io's text could not be read |

---

## 1. Personas and context of use

Roles, devices and cost visibility come from the PRD ("Users, roles and devices", `docs/prd.md:25-38`) and the founder's 2026-10-28
answer that every waiter has their own phone (`docs/plans/2026-10-28-ux-flows.md` §7 Q2). The **working conditions** (gloves, wet hands,
noise, glare) are from the founder brief 2026-11-13, via the lead; to be recorded in DigiAlto-Ops context.md. They are **assumptions to
observe in Phase 0** (§9), not measured facts about the venue.

| Persona | Who (PRD) | Device | When and under what pressure | Hands, light, sound | Sees money | What failure costs |
|---|---|---|---|---|---|---|
| **Titolare (owner)** | Approves invoices, sets prices, reads reports, gets reminders | Phone + laptop | Mornings and end of day; sometimes mid-service on the floor | Usually clean hands. Phone outdoors or by a window: glare (to observe) | Yes | Unapproved invoices mean stale stock and costs. A missed day close leaves the variance against the register unknown. Booking requests can go unanswered |
| **Admin (DigiAlto)** | Tenant setup, recipe import, support | Laptop | Setup weeks, then occasional support | n/a | Yes | Setup errors spread into every report. For SaaS, each new venue's onboarding is this persona's job |
| **Cuoco (chef / kitchen)** | Batches, labels, waste, counts, prep alerts, kitchen tickets | Phone or kitchen tablet; one **shared** kitchen device optional (PRD:38) | Prep in the morning; at the pass during service, at peak pressure | Wet or greasy hands, possibly gloves (assumption). Noise and extractor fans (assumption). Heat and steam | Margins in % only; never € (ADR-006 context, `src/lib/nav/nav-model.ts:92`) | A missed ticket means a dish is late or never made. A batch not registered makes stock depletion wrong |
| **Cameriere (waiter)** | Opens tables, orders by course, closes with the receipt number | Own phone (PWA) | The whole service, under rush, often one-handed while carrying | Possibly wet hands (assumption). Room noise (assumption). Dim light at evening service (assumption) | Never (CLAUDE.md invariant) | An order not sent means a late dish. An order kept on paper instead leaves depletion and every report wrong (PRD:445: "if waiters skip the app on a busy Saturday, depletion is wrong and every report downstream is wrong") |
| **Ospite (public booking guest)** | Requests a table on `/prenota/<slug>` | Their own device. Type unknown: phone assumed | Any time; no training; one visit | Unknown | Sees nothing internal | They abandon and call or go elsewhere. Their personal data is the app's first customer data (phase 2 scope, C14) |

**What the context implies for design.** These are proposals, to be validated in Phase 0. Where an external source supports one, it is
cited by its §4.1 ID.
- **Italian first.** Every string is Italian with English second (`CLAUDE.md` rule 7). Amounts as `1.234,50 €` come from
  `src/lib/money/format.ts:11-12`, which forces grouping because it-IT would otherwise skip it below 10.000. Dates are in Europe/Rome.
  The guest page switches language per request (`src/app/(public)/prenota/[slug]/request-form.tsx:160-180`).
- **Hands and gloves (assumed).** Use big, forgiving targets, no gesture-only actions (swipe, long-press) and no precise drags. Any
  future drag must also work with a single pointer without dragging (WCAG 2.2 SC 2.5.7 Dragging Movements, AA, R7). Taps should be safe
  to repeat: the table-open session id is made once and replayed (`src/app/(owner)/tavoli/open-table-dialog.tsx:12-31`), and the kitchen
  "Fatto" has an undo (`src/app/(owner)/cucina/undo-notice.tsx`). Keep both patterns.
- **Noise (assumed).** Never rely on sound. The code has no audio or vibration today (a search for `new Audio`, `AudioContext` and
  `vibrate` in `src/` found nothing). Every state change must be visible in words.
- **Glare and dim light (assumed).** Contrast well above the minimum. The kitchen already has a high-contrast mode
  (`[data-contrast="high"]`, `src/app/globals.css:246-260`, pairs ≥ 7:1 in `src/lib/design/tokens.ts:184-202`). §9 proposes the same for Sala.
- **Shared devices.** A clean hand-over between people: `forgetUser()` on PIN login (`src/app/(public)/pin/pin-flow.tsx:73-77`), and
  "Esci" reachable from every screen of a shared device (finding F07).
- **SaaS extension.** Bars and coffee shops are named as future customers (founder brief 2026-11-13, via the lead; to be recorded in
  DigiAlto-Ops context.md). The founder decided on 2026-11-13 that **restaurants come first** (platform FD14; D3, Q-UX9): restaurants are
  built first and counter service is deferred. The roles, devices and service style (counter instead of tables) of bars and coffee shops
  are **not known**, and nothing here assumes them; counter service is variant V7 (§9b).

## 2. Jobs and use cases per role

Frequency comes from the PRD where it states one. Elsewhere it is marked *(assumed)*. **Criticality:**
- **C** (critical): blocks service or makes money or stock wrong;
- **H** (high): daily control is lost;
- **M** (medium): a delay or workaround;
- **L** (low): rare or set-up only.

| ID | Role | Job | Frequency | Crit. | Where today |
|---|---|---|---|---|---|
| J1 | Waiter | Sign in with PIN at the start of a shift | Per shift *(assumed)* | C | `/pin`, or `/login` on an enrolled device (`src/lib/supabase/proxy.ts:75`) |
| J2 | Waiter | Open a table and send the first course under rush | Many per service | C | `/tavoli` → `/tavoli/comanda?s=` |
| J2b | Waiter | Add dishes, half portions, notes; send "a seguire" | Many per service | C | comanda line editor and send buttons |
| J3 | Waiter (also owner) | Close a table with the receipt number and payment type | Per table | C | comanda, "Conto" tab |
| J4 | Chef | Mark dishes done at the pass; close the ticket | Continuous during service | C | `/cucina` |
| J5 | Chef | Register a batch (prep) and get its label text | Daily, several *(assumed)* | H | `/produzione/nuova` |
| J6 | Chef | Daily count of the critical items | Daily (`today.dailyCount` action) | H | `/magazzino/conteggi` |
| J11 | Chef | Log raw waste | Daily *(assumed)* | M | `/magazzino/<ingredient>` |
| J7 | Owner | Photograph an invoice, review it, approve it | About 25 a month (PRD assumption, `docs/prd.md:457`) | H | `/fatture` → `/fatture/[id]` → `/revisione` |
| J8 | Owner | End-of-day close against the register | Daily; one shift a day (PRD assumption, `docs/prd.md:457`) | H | `/chiusura` |
| J9 | Owner (admin, waiter can see) | Answer a booking request | Per request; volume unknown | H | `/prenotazioni` |
| J10 | Guest | Request a table | Per guest | H | `/prenota/<slug>` |
| J12 | Owner | "Does anything need me today?" (alerts, payables, use-by) | Daily | H | Home `/` |
| J13 | Admin | Set up a venue: locations, suppliers, ingredients, recipes, staff, devices, tables, menu | Once per venue (SaaS: per customer) | M now, **H for SaaS** | Anagrafica, Personale, Tavoli › Impostazioni, Importa |
| J14 | Admin / owner | Enrol a staff phone | Per new device | M | `/personale` → `/dispositivi`, phone `/dispositivo` |
| J15 | Owner | Read margins, food cost, reports, exports | Weekly / monthly *(assumed)* | M | Registro (behind "Altro" on a phone) |

## 3. The current flows as built (mapped from the code)

### 3.1 The shell per role (from `src/lib/nav/nav-model.ts` and `src/app/(owner)/app-shell.tsx`)

`navFor(role)` filters `SECTIONS` (`nav-model.ts:75-139`) through each screen's own gate. `phoneTabs` shows at most 5 tabs, else four
groups plus "Altro" (`nav-model.ts:152-167`). The **comanda** and an **open count** are focus routes, with no bar and no section row
(`nav-model.ts:206-215`).

| Role | Phone tabs | Section rows (pills) | Behind "Altro" (`/altro`) | Start screen |
|---|---|---|---|---|
| Owner | Home · Gestione · Cucina · Sala · Altro | Home: Home, Avvisi, Da spingere · Gestione: Fatture, Pagamenti · Cucina: Comande, Produzione, Magazzino, Riordino · Sala: Tavoli, Prenotazioni, Menu | Anagrafica (Ubicazioni, Ricette, Fornitori, Ingredienti, Personale, Importa) · Registro (Sicurezza, Costi, Chiusura, Report, Attività) | `/` |
| Admin | same tabs | as owner, without Avvisi (no alert access) | as owner | `/` |
| Chef | Home · Cucina · Anagrafica | Home: Home, Avvisi, Da spingere · Cucina: Comande, Produzione, Magazzino, Riordino, Margini · Anagrafica: Ricette, Ingredienti | none | `/` |
| Waiter | **no bar** (one group) | Sala: Tavoli, Prenotazioni | none | `/tavoli` (`landingFor`, `nav-model.ts:218-220`) |
| Guest | no shell; root band with the brand link only (`src/app/layout.tsx:92-96`) | none | none | `/prenota/<slug>` |

On a laptop (≥ 1024 px) a sidebar lists every group (`src/components/nav/sidebar-nav.tsx`).

The role tables above were derived from the gates named in `nav-model.ts`, and the independent fact-check of 2026-11-13 re-derived them
from each gate's role list. `tests/lib/nav/nav-model.test.ts` remains the authority if the gates change before Phase 1.

### 3.2 Eleven jobs (J1–J11): taps and screens

**Counting rules.**
- A **tap** is one press on an app control on the shortest path, with defaults left as they are.
- **Typing** is shown separately as typed fields.
- **OS** taps (camera shutter, native date or select wheels) are listed apart, because the app does not control them. A native
  `<select>` is counted as 2 taps (open, choose).
- **Scrolling is not counted.** It cannot be determined from code. Where a control is likely below the fold, the row says
  "scroll not determined".
- **Screens** are distinct routes, or distinct full-page states of one route.

| Job | Path as built (files) | App taps (min) | Typed fields | Screens | Notes and what could not be determined |
|---|---|---|---|---|---|
| **J1** PIN sign-in | Name in `StaffPicker` (1) → PIN field autofocused → "Entra" (1) (`pin/pin-flow.tsx:122-147`, `pin/pin-pad.tsx:38-56`) → `/tavoli` or `/` | 2 + 4 digit keys | 1 (PIN) | 1 route, 2 states | Whether the numeric keypad's own key submits on iOS: **not determined** |
| **J2** Open table, send first dish | Tile (1) → `OpenTableDialog`, covers default "2", ± buttons (`tavoli/covers-field.tsx`) → "Apri tavolo" (1) → comanda (course tab defaults to "antipasti", `src/server/menu/constants.ts:14`) → dish (1) → sticky "Comanda · 1 riga" (1) → "Invia antipasti · 1" (1) (`tavoli/comanda/order-sheet.tsx:51-89`, `send-buttons.tsx:31-39`) | **5** (+1 per covers step, +1 if the dish is in another course) | 0 | 2 | The send buttons sit inside the expanded card, above the sticky toggle; whether a scroll is needed after expanding: **not determined**. Extra dishes are +1 each; another course is +1 tab, +1 send |
| **J3** Close table | Tile (1) → session panel "Conto" link (1) (`tavoli/session-panel.tsx:67-69`) → bill tab → "Chiudi tavolo" (1) (`comanda/bill-sheet.tsx:92`) → document type radio (1) → receipt number → payment radio (1) → confirm (1) (`comanda/close-sheet.tsx:114-155`) | **6** | 1 | 2 | No radio is preselected (`src/lib/bill/close-form.ts:16-20`) |
| **J4** Kitchen, one ticket of 3 dishes | Chef Home → "Cucina" tab (1) → `/cucina` → each dish (3) (`cucina/kitchen-line.tsx:41-61`) → "Chiudi comanda" (1) (`cucina/ticket-card.tsx:62-70`) | **5** (1 + n + 1) | 0 | 2 | Big full-width line buttons, the word "Fatto", `aria-pressed`, undo. Whether "Chiudi comanda" is needed after all lines are done or the card closes by itself: **not determined** |
| **J5** Register a batch | Home primary "Nuova produzione" (1) → recipe `<select>` (2) → output quantity → "Calcola" (1) → "Registra" (1) → label page (`produzione/nuova/page.tsx:112`, `production-form.tsx:155-291`) | **5** (+2 when there are several locations) | 1 (+ portions or shelf life if changed) | 3 | Whether portions and shelf life always come prefilled from the proposal: **not determined** |
| **J6** Daily count | Home "Conteggio giornaliero" (1) → `/magazzino/conteggi` → "Avvia giornaliero" (1) (`conteggi/start-count.tsx:73-80`) → focus screen: first field (1), then Enter moves to the next and leaving a field saves it (`conteggi/[id]/page.tsx:30`) → "Chiudi conteggio" (1) → confirm (1) (`conteggi/[id]/close-count.tsx:74-107`) | **5** (+2 with several locations) | N lines | 3 | A strong pattern: autosave, Enter-to-next, a sticky close bar and a confirmation sentence |
| **J7** Invoice in → approved | Home "Carica una fattura" (1) → "Scatta foto" (1) + OS camera → "Carica" (1) (`fatture/upload-form.tsx:97-124`) → wait (list polls, `fatture/page.tsx:109`) → row (1) → `/fatture/[id]` "Rivedi le righe" (1) (`fatture/[id]/page.tsx:176-188`) → review → "Approva" (1) → confirm (1) (`revisione/approval-panel.tsx:238-251`, `:66`) | **7** (+ line fixes; + location select if required) | 0 on a clean invoice | 4 (Home, list, detail, review) | The detail page is a stop with one forward link for a reviewable invoice (F11). After approval, next steps are offered (`approval-panel.tsx:111-125`) |
| **J8** Day close | Home → "Altro" (1) → "Chiusura" (1) → `/chiusura` → register total → save (1) (`chiusura/register-form.tsx:43-53`) | **3** | 1 | 3 | Which business day the picker opens on (`chiusura/day-picker.tsx`): **not determined** |
| **J9** Answer a booking request | Home → "Sala" (1) → lands on `/tavoli` (first Sala section) → "Prenotazioni" pill (1) → row action (1) → accept sheet submit (1) (`prenotazioni/accept-sheet.tsx:184`) | **4** | 0 | 3 | The "requests to answer" count exists only on `/prenotazioni` (`prenotazioni/page.tsx:89`); nothing on Home announces it (F03). Whether the day view opens on the request's day: **not determined** |
| **J10** Guest requests a table | Date (native, 1 + OS) → party `<select>` (2) → service tab if several (+1) → time slot (1) → name, phone, email → privacy checkbox (1) → "Invia richiesta" (1) (`prenota/[slug]/request-form.tsx:237-355`) | **6** (+1 service tab; + OS picker taps) | 3 | 1 + success state | The submit button stays **disabled** until every field and the checkbox are set, with no word on what is missing (`request-form.tsx:117-125`, `:353`). Phone **and** e-mail are both required (`:123-125`) |
| **J11** Raw waste | Home "Registra uno spreco" (1) → `/magazzino` → ingredient (1) → waste form **below** the lots list (`magazzino/[ingredientId]/page.tsx:199-225`) → quantity, reason `<select>` (2), location (+2 if several), lot (optional) → "Registra" (1) (`waste-form.tsx:87-132`) | **5** | 1 | 3 | Scroll to the form: likely, **not determined** |

**Admin set-up (J13) and device enrolment (J14)** were not tap-counted in this pass. Their paths are in the 2026-10-28 audit (flows 1
and 5). That plan's fixes for them (enrolment link, back links, empty states, collapsed add forms) exist in `src/components/`, but **each
acceptance criterion was not re-verified here**.

### 3.3 Dead ends, duplicate paths, screens nobody needs

**Dead ends**
- **Guest → staff login.** On `/prenota/<slug>` the header band shows `BrandLink` → `/` (`src/app/layout.tsx:94`,
  `src/components/brand.tsx:30-41`). `/` is not public, so the proxy redirects a signed-out guest to `/login` (`src/lib/supabase/proxy.ts:13-15`,
  `:81`). The guest's typed form is lost and they land on a staff screen. (F01)
- **No batch recipes.** `/produzione/nuova` shows only the text `production.noRecipes`, with no way forward (`produzione/nuova/page.tsx:133-134`). (F09)
- **`/sicurezza`** is an "in arrivo" text page with no function (`src/app/(owner)/sicurezza/page.tsx`). It takes a pill in Registro for
  owner and admin (`nav-model.ts:133`). (F28)

**Duplicate paths** (most are deliberate; listed so the redesign can choose)
- `/tavoli/[sessionId]` only redirects to `/tavoli/comanda?s=` (`tavoli/[sessionId]/page.tsx`). It is a legacy URL kept for old links. Keep it.
- `/anagrafiche` only redirects to `/anagrafiche/fornitori` (`anagrafiche/page.tsx`). Keep it.
- Owner Home actions repeat tab and pill destinations: "Comande", "Tavoli", "Menu e prezzi" (`src/lib/nav/today-actions.ts:46-58`).
- The push list is reachable from the Home pill "Da spingere" (`nav-model.ts:85`) and the first dashboard tile (`src/lib/dashboard/dashboard-view.ts:107`).
- Alerts appear as the Home strip (`(owner)/page.tsx:115-124`) and the "Avvisi" pill (`nav-model.ts:83`).
- `/altro` lists the same links as the laptop sidebar. On a phone it is required by the five-tab limit (ADR-030).

**Screens nobody needs yet:** `/sicurezza` (above). `/impostazioni/dati-di-prova` is a demo-data tool (ADR-018) that has no use on the
production tenant (assumption A3, `docs/plans/2026-11-01-m25-go-live.md:909`: "No demo data in production"). Whether it is hidden there:
**not determined**.

## 4. Best practice to apply

### 4.1 Sources read on 2026-11-13

Every source below was read on **2026-11-13**. R1–R14 were first read from the W3C's own source repository (`w3c/wcag`, branch
`main`). After the founder approved the research sites (D6), the published **WCAG 2.2 W3C Recommendation of 12 December 2024**
(`https://www.w3.org/TR/WCAG22/`, R19) was read on 2026-11-13 with `curl` by the session that coordinates this plan (the architect session's fetch tool could not resolve the host, §4.2). Every WCAG number, level and value in R1–R14
matches R19, and R19 also gives the numbers for contrast (1.4.3), non-text contrast (1.4.11), status messages (4.1.3) and reflow (1.4.10).
R20–R23 were read from nngroup.com and web.dev the same day. `m3.material.io` loaded, but its pages render their text with
JavaScript, so no Material guidance could be read (§4.2).

| ID | Source (URL) | What it states (exact rule or number) | Supports in this plan |
|---|---|---|---|
| R1 | `https://raw.githubusercontent.com/w3c/wcag/main/guidelines/sc/22/target-size-minimum.html` | "Target Size (Minimum)", level **AA**: "The size of the target for pointer inputs is at least 24 by 24 CSS pixels", except Spacing, Equivalent, Inline, User Agent Control, Essential | §4.3 target size; the globals.css:13 correction (DS1) |
| R2 | `https://raw.githubusercontent.com/w3c/wcag/main/guidelines/sc/21/target-size-enhanced.html` | "Target Size (Enhanced)", level **AAA**: "The size of the target for pointer inputs is at least 44 by 44 CSS pixels", except Equivalent, Inline, User Agent Control, Essential | §4.3; the 44 px `tap` token meets it; §6.5 |
| R3 | `https://raw.githubusercontent.com/w3c/wcag/main/guidelines/index.html` | Order of the included criteria. Guideline 2.5: pointer-gestures, pointer-cancellation, label-in-name, motion-actuation, **target-size-enhanced (5th)**, concurrent-input-mechanisms, **dragging-movements (7th)**, **target-size-minimum (8th)**. Guideline 2.4: focus-not-obscured-minimum is 11th. Guideline 3.2: consistent-help is 6th. Guideline 3.3: redundant-entry 7th, accessible-authentication-minimum 8th | The numbers 2.5.5, 2.5.7, 2.5.8, 2.4.11, 3.2.6, 3.3.7, 3.3.8 used in this plan |
| R4 | `https://raw.githubusercontent.com/w3c/wcag/main/understanding/22/target-size-minimum.html` | "2.5.5 Target Size (Enhanced) uses the larger 44 by 44 CSS pixel measure as its threshold size"; "For important links/controls, consider aiming for the stricter 2.5.5 Target Size (Enhanced)" | 2.5.5 = Enhanced = 44 × 44; the `tap-comfort` rationale for important controls (§6.5) |
| R5 | `https://raw.githubusercontent.com/w3c/wcag/main/understanding/21/target-size-enhanced.html` | Heading "Understanding SC 2.5.5 Target Size (Enhanced)"; "Make custom targets at least 44 by 44 pixels" | Same as R4 |
| R6 | `https://raw.githubusercontent.com/w3c/wcag/main/guidelines/sc/22/focus-not-obscured-minimum.html` | "Focus Not Obscured (Minimum)", level **AA** (2.4.11): "When a user interface component receives keyboard focus, the component is not entirely hidden due to author-created content." | Sticky bars and the tab bar (§4.3, §6.6 `StickyActionBar`, W1) |
| R7 | `https://raw.githubusercontent.com/w3c/wcag/main/guidelines/sc/22/dragging-movements.html` | "Dragging Movements", level **AA** (2.5.7): "All functionality that uses a dragging movement for operation can be achieved by a single pointer without dragging", unless dragging is essential or the user agent determines it | §1 "no precise drags" |
| R8 | `https://raw.githubusercontent.com/w3c/wcag/main/guidelines/sc/22/accessible-authentication-minimum.html` | "Accessible Authentication (Minimum)", level **AA** (3.3.8): "A cognitive function test (such as remembering a password or solving a puzzle) is not required for any step in an authentication process unless that step provides at least one of the following": Alternative, Mechanism, Object Recognition, Personal Content | PIN sign-in check (§4.3, Q-UX21) |
| R9 | `https://raw.githubusercontent.com/w3c/wcag/main/guidelines/sc/22/redundant-entry.html` | "Redundant Entry", level **A** (3.3.7): information previously entered and "required to be entered again in the same process" is "auto-populated, or available for the user to select", except when essential, needed for security, or no longer valid | QW2 keeps typed values (§4.3) |
| R10 | `https://raw.githubusercontent.com/w3c/wcag/main/guidelines/sc/22/consistent-help.html` | "Consistent Help", level **A** (3.2.6): help mechanisms repeated on multiple pages "occur in the same order relative to other page content, unless a change is initiated by the user" | §4.3 (applies only if a help mechanism is added) |
| R11 | `https://raw.githubusercontent.com/w3c/wcag/main/guidelines/sc/20/contrast-minimum.html` | "Contrast (Minimum)" (**1.4.3**, per R19), level **AA**: text "has a contrast ratio of at least 4.5:1"; "Large-scale text and images of large-scale text have a contrast ratio of at least 3:1" | The 4.5:1 minimum in `tokens.ts:136-138` and §6.3 |
| R12 | `https://raw.githubusercontent.com/w3c/wcag/main/guidelines/sc/21/non-text-contrast.html` | "Non-text Contrast" (**1.4.11**, per R19), level **AA**: "a contrast ratio of at least 3:1 against adjacent color(s)" for the listed UI components and graphics | The 3:1 minimum in `tokens.ts:136-138` and §6.3 (borders, focus, shapes) |
| R13 | `https://raw.githubusercontent.com/w3c/wcag/main/guidelines/sc/21/status-messages.html` | "Status Messages" (**4.1.3**, per R19), level **AA**: status messages "can be programmatically determined through role or properties" so assistive technologies can present them without moving focus | `role="status"` in §6.7, G2 |
| R14 | `https://raw.githubusercontent.com/w3c/wcag/main/guidelines/sc/21/reflow.html` | "Reflow" (**1.4.10**, per R19), level **AA**: no two-dimensional scrolling for "Vertical scrolling content at a width equivalent to 320 CSS pixels" and horizontal content at a height of 256 CSS pixels | W4's 320 px check (§4.3) |
| R15 | `https://developer.apple.com/design/human-interface-guidelines/accessibility` (the HTML page returned no body text; the same page's data was read at `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/accessibility.json`) | Control sizes: iOS, iPadOS default **44x44 pt**, minimum **28x28 pt** (watchOS 44/28, macOS 28/20, visionOS 60/28, tvOS 66/56). Contrast "from WCAG Level AA": up to 17 pt 4.5:1; 18 pt 3:1; bold 3:1. "If your app supports Dark Mode, make sure to check the minimum contrast in both light and dark appearances." | §6.5 reference point; both-mode contrast (DS1, DS8) |
| R16 | `https://developer.android.com/guide/topics/ui/accessibility/apps` (in this session the content came back directly, with a pointer to the Views version) | "we recommend that each interactive UI element have a focusable area, or *touch target size*, of at least **48dpx48dp**. Larger is even better." Text contrast at least 4.5:1 "If the text is smaller than 18sp, or if the text is bold and smaller than 14sp", 3:1 for other text | §6.5 reference point |
| R17 | `https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/progressive_web_apps/guides/offline_and_background_operation/index.md` (MDN "Offline and background operation", from MDN's own content repository) | Background sync "enables the app to ask its service worker to perform a task on its behalf"; if the task fails "the browser may retry a limited number of times". **No guidance on how to tell the user about offline state** | Only the mechanism behind "In coda"; the offline wording in §6.7 stays this plan's proposal (§4.2) |
| R18 | `https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/css/reference/at-rules/@media/prefers-reduced-motion/index.md` (MDN) | `prefers-reduced-motion` values: `no-preference`; `reduce`, "a user has enabled the setting on their device for reduced motion" | §6.8 (the `reduce` block). Browser support data was **not** read |
| R19 | `https://www.w3.org/TR/WCAG22/` ("W3C Recommendation 12 December 2024"; this version `https://www.w3.org/TR/2024/REC-WCAG22-20241212/`) | The dated Recommendation. Confirms: 1.4.3 Contrast (Minimum) AA, "at least 4.5:1"; 1.4.10 Reflow AA; 1.4.11 Non-text Contrast AA, "at least 3:1 against adjacent color(s)"; 4.1.3 Status Messages AA; 2.5.8 Target Size (Minimum) AA, "at least 24 by 24 CSS pixels"; 2.5.5 Target Size (Enhanced) AAA, "at least 44 by 44 CSS pixels"; 2.4.11 Focus Not Obscured (Minimum) AA; 3.3.7 Redundant Entry A; 3.3.8 Accessible Authentication (Minimum) AA | Re-verifies R1–R14; the numbers for R11–R14 |
| R20 | `https://www.nngroup.com/articles/ten-usability-heuristics/` (Jakob Nielsen, 24 April 1994, "Last reviewed Jan. 30, 2024") | The ten heuristics: 1 Visibility of System Status; 2 Match Between the System and the Real World; 3 User Control and Freedom; 4 Consistency and Standards; 5 Error Prevention; 6 Recognition Rather than Recall; 7 Flexibility and Efficiency of Use; 8 Aesthetic and Minimalist Design; 9 Help Users Recognize, Diagnose, and Recover from Errors; 10 Help and Documentation | §7 heuristic labels |
| R21 | `https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/` (Jakob Nielsen, 1 November 1994) | "0 = I don't agree that this is a usability problem at all"; "1 = Cosmetic problem only: need not be fixed unless extra time is available on project"; "2 = Minor usability problem: fixing this should be given low priority"; "3 = Major usability problem: important to fix, so should be given high priority"; "4 = Usability catastrophe: imperative to fix this before product can be released" | §7 severity scale |
| R22 | `https://www.nngroup.com/articles/response-times-3-important-limits/` | "0.1 second is about the limit for having the user feel that the system is reacting instantaneously"; "1.0 second is about the limit for the user's flow of thought to stay uninterrupted"; "10 seconds is about the limit for keeping the user's attention focused on the dialogue", with feedback for longer delays | §4.3 response-time feedback; §6.7 loading states |
| R23 | `https://web.dev/articles/offline-ux-design-guidelines` (published 10 November 2016) | Gives an example message: "You seem to have a bad network connection. Not to worry! Messages will be sent when the network is restored." Says "Clearly inform the user when a change in state occurs as soon as possible", uses a "toast" for brief feedback (e.g. when a section has synced), and says "Make sure the language you're using fits your audience, and use the same phrasing in all cases where it applies" | §6.7 offline and queued wording |

### 4.2 Sources not readable, and topics with no source

Q-UX1 was **approved by the founder on 2026-11-13** (D6) for `www.w3.org`, `nngroup.com`, `m3.material.io` and `web.dev`. The
architect sessions' fetch tool could not resolve these hosts (`getaddrinfo ENOTFOUND`), but a later fetch with `curl` on 2026-11-13 read
them (R19–R23). Results:

| Host or source | Result |
|---|---|
| `https://www.w3.org/TR/WCAG22/` | Read (R19). R1–R14 re-verified against it |
| nngroup.com: ten heuristics, severity ratings, response times | Read (R20, R21, R22) |
| `https://web.dev/articles/offline-ux-design-guidelines` | Read (R23) |
| `m3.material.io` (e.g. `/foundations/designing/structure`) | Loaded, but the page text is rendered by JavaScript; no guidance could be read. Android's own number is R16 |
| `en.wikipedia.org` ("Heuristic evaluation") | Not read; not needed now that R20 is read |
| `https://raw.githubusercontent.com/italia/writing-toolkit/master/README.md` (read 2026-11-13) | The "Guida al linguaggio della Pubblica Amministrazione" for Docs Italia (CC BY 4.0). The README has **no interface-text guidance**, so it supports nothing here |

**Topics with no external source** (no claim is made):
- **Touch-target and ergonomics guidance from Material (m3.material.io):** not readable (above). The 48 × 48 dp number used here is
  Android's (R16).
- **POS and kitchen display (KDS) patterns** (ticket ageing, bump, recall, colour use): no source; reviewed in Phase 4 only if one is read.
- **Italian UI writing conventions** (infinitive or imperative on buttons, capitalisation, gender-inclusive role names): no source read.
  Strings follow `CLAUDE.md` rule 7 and the existing `it.ts`.

### 4.3 What the sources settle for this plan

All WCAG points below rest on R1–R14 and are confirmed against the dated Recommendation (R19).
- **Target size.** The PRD's 44 px minimum (`docs/prd.md:436`, `--spacing-tap: 2.75rem`, `globals.css:14`) is above WCAG 2.2 SC 2.5.8
  Target Size (Minimum), AA, 24 × 24 CSS px (R1, R3), and meets SC 2.5.5 Target Size (Enhanced), AAA, 44 × 44 CSS px (R2, R4, R5).
  **The globals.css:13 question is resolved:** its comment "WCAG 2.5.5" names the **AAA** criterion. The token is correct; the comment
  should name both (2.5.5 AAA 44 × 44, met; 2.5.8 AA 24 × 24, exceeded). DS1 makes that change and tests the token value.
- **Platform reference points for `tap-comfort`.** Apple: iOS default 44 × 44 pt, minimum 28 × 28 pt (R15). Android: at least
  48 × 48 dp, "Larger is even better" (R16). Points and dp are platform units, not CSS px; this plan claims no conversion. The
  `tap-comfort` value is chosen in Phase 0 and is never below the 44 px `tap` token (§6.5, W4). Material's own guidance (m3.material.io)
  was not read (§4.2).
- **Focus not obscured (2.4.11, AA, R6).** A focused control must not be entirely hidden by the fixed tab bar or a sticky bar. The tab bar
  already hides while a text field has focus (`globals.css:272-293`), which covers text fields only. `StickyActionBar` reserves its height
  as bottom scroll padding; W1 tests it on the comanda and the count.
- **Dragging (2.5.7, AA, R7).** Supports §1's "no precise drags": any future drag needs a single-pointer alternative.
- **Accessible authentication (3.3.8, AA, R8).** The staff PIN is a remembered code, which R8 names as a cognitive function test
  ("remembering a password"). Conformance then depends on one of R8's exceptions, for example the magic-link and password sign-in that
  exist (`e2e/magic-link.spec.ts`, `e2e/password-login.spec.ts`) as an Alternative, or a Mechanism such as allowing paste or autofill in
  the PIN field. Whether an exception holds for a waiter on an enrolled device: **not determined**. Q-UX21 asks for the check in the P1
  plan; no step is proposed until then.
- **Redundant entry (3.3.7, A, R9).** After QW2's missing-field message the guest's typed values stay in their fields (QW2's test).
  QW1 removes the path that loses the form (F01).
- **Consistent help (3.2.6, A, R10).** Applies only to a help mechanism repeated across pages. The app has none today that this plan
  changes. If a contact link is added (for example the privacy contact on the booking page, still pending), it keeps the same position.
- **Contrast (R11, R12).** Confirms the 4.5:1 text and 3:1 non-text minimums encoded in `tokens.ts:136-138` and used in §6.3. This plan
  applies 4.5:1 to all text, including large text, which is stricter than R11 requires. R15 asks for checks in both light and dark: DS1
  and DS8 test both modes.
- **Status messages (4.1.3, R13).** Supports `role="status"` for offline, queued and saved states (§6.7) and G2's announced slot.
- **Response times (R22).** Below about 0.1 s no feedback is needed; up to about 1 s the flow of thought holds; beyond about 10 s
  attention goes, so long operations (invoice extraction, sync) need progress or completion feedback. §6.7's Loading rule now says so;
  no other threshold is claimed.
- **Offline wording (R23).** Say clearly and early when the connection state changes, reassure that queued work will be sent, use words
  the audience understands, and keep the same phrasing everywhere. §6.7's "In coda" wording is checked against this in Phase 0.
- **Reflow (1.4.10, R14).** The repo's phone checks run at 360 px (`expectPhoneFriendly`). R14 names 320 CSS px. W4's test adds a 320 px
  no-sideways-scroll check on the screens it resizes.
- **Reduced motion (R18).** The repo's `reduce` block (`globals.css:207-215`) uses the value R18 defines.

### 4.4 Rules already binding this design (repo sources, read in this session)

These are project requirements, not external best practice:
- **PRD accessibility NFR** (`docs/prd.md:436`): "Large tap targets (min 44 px) for waiters, high-contrast kitchen mode, works in Safari iOS and
  Chrome Android of the last 2 years".
- **PRD localisation** (`docs/prd.md:435`): Italian UI and number formats (comma decimal, € after the amount), English second, dates in Europe/Rome.
- **PRD adoption risk** (`docs/prd.md:445`): the design must be "faster than paper".
- **UI foundation** (`docs/design/ui-foundation.md` §1, §2, §5, §7):
  - every text pair is AA in both themes and tested;
  - colour never carries meaning alone;
  - one primary (green) action per screen;
  - gold and yellow are never text on cream;
  - reduced motion cuts all animation (`globals.css:207-215`);
  - a 3 px focus outline on every focusable element;
  - fonts are self-hosted (no third-party origin, GDPR).
- **Invariants** (`CLAUDE.md` rule 6): screens read `/api/*` only; waiters never see costs; roles are enforced in Postgres. The chef sees
  no € (ADR-020/030 tests).

### 4.5 Proposals in this plan that still have no external source

These come from the code, the PRD and the founder brief. Each is re-checked against a source before its phase plan is approved:
- `tap-comfort` against Material's touch-target guidance (§6.5, W4): m3.material.io could not be read (§4.2); Android's R16 applies;
- the kitchen ticket pattern review (Phase 4): no source is known;
- Italian button and label conventions (all phases): no source is known.

## 5. Proposed information architecture and navigation per role

The baseline is ADR-030 (accepted). This plan **keeps** its groups, URLs and the five-tab bar. It proposes the changes below, each
marked as a default answer to a founder question in §10, or as a founder decision of 2026-11-13.

| Role | Start screen | Primary navigation | Behind "Altro" | Changes against today (step) |
|---|---|---|---|---|
| **Owner** | Home `/`, reordered: "Da fare ora" first (alerts strip + counts, including **booking requests** and **day close**), then the one primary action, then the compact tiles, first steps and the account card | Bottom tabs Home · Gestione · Cucina · Sala · Altro (ADR-030, unchanged) | Anagrafica; Registro. Phase 6 adds a group **Impostazioni** (settings now spread over `/costi/impostazioni`, `/tavoli/impostazioni`, `/riordino/*`, `/impostazioni/dati-di-prova`) | Booking-request count on Home (QW3); primary action above tiles (QW4; ADR-030 decision 4 sets a different order, so this needs the founder, Q-UX4); "Chiusura del giorno" as a Home action (QW7; founder decision D1, Q-UX5); account control in the header (QW6); consolidated "Da fare ora" (O1, O2); Impostazioni group (A1) |
| **Admin** | Home `/` (laptop) | Laptop sidebar; phone tabs as owner | as owner | As owner, without alerts. For SaaS, who "admin" is remains an open question; default: DigiAlto staff per venue (Q-UX10, admin part, not decided) |
| **Chef** | Home `/` with a "Comande aperte · n" card at the top (K1) | Tabs Home · Cucina · Anagrafica (unchanged) | none | Account control with "Esci" in the header on every screen, including `/cucina` (QW6). A service-aware landing on `/cucina` is a variant only (§9b V3) |
| **Waiter** | `/tavoli` (unchanged) | No bar; Sala row (Tavoli, Prenotazioni) | none | "Esci" moves from inside the page (`tavoli/page.tsx:137`) to the header account control (QW6). Unsent lines are visible on the comanda bar (QW5), later with a send shortcut (W1) and on the tiles (W2) |
| **Guest** | `/prenota/<slug>` | none | none | The header shows the venue's name with **no link** into the staff app (QW1). The venue name comes from the tenant (DS6) |

**Navigation rules carried over** (ADR-020/030):
- at most 5 tabs;
- at most 6 pills per row;
- no drawer;
- focus routes have no bar;
- the bar hides while a text field has focus (`globals.css:272-293`);
- every link ≥ 44 px.

**New rules proposed:**
- **One place to leave.** On every signed-in screen, the user's name and "Esci" sit in the header band, in the same spot.
- **"Da fare ora" uses counts only.** No personal data and no money for anyone, as `/api/today` already does for every role
  (`docs/plans/2026-10-28-ux-flows.md` §3.3 and §6).
- **Entitlements are separate from roles** (Phase 6, ENT1). A tier decides which sections a venue has. A role decides who in the venue
  sees them. Both are enforced in the API and in Postgres, never only in the nav. Which sections belong to which tier waits for
  platform FD3 (D4).

## 6. Design-system direction (per-tenant theming)

### 6.1 Layers

1. **Tenant palette.** Raw, approved colours of one venue, plus its display and body fonts and its logo file. Data, per tenant.
2. **Semantic tokens.** `paper`, `surface`, `sunk`, `ink`, `ink-muted`, `rule`, `rule-strong`, `band`, `band-ink`, `gold`, `highlight`,
   `on-highlight`, `accent`, `accent-hover`, `on-accent`, `accent-ink`, `focus` (today's names, `COLOR_TOKENS` in
   `src/lib/design/tokens.ts:8-34`). Each maps to **one palette entry** per mode (light and dark).
3. **Product (DigiAlto) system tokens, not themable.** The status colours `success`, `warning`, `danger`, `info` and their backgrounds,
   the `tap` sizes, the type scale steps, radii and motion durations. **Proposal:** status colours stay the same for every tenant. "Red
   means a problem" should not change with a venue's brand, and they are not brand colours (§10 Q-UX3).
4. **Component tokens** derived from the above (unchanged `ui.tsx` components).

Today one hard-coded theme lives in `src/app/globals.css` (`@theme`) and is mirrored in `tokens.ts`. The SaaS step makes layer 1 data
and maps it through layer 2 at request time (DS1–DS5).

### 6.2 Tenant theme: data and serving (sketch; the ADR is DS0)

- **Table `tenant_theme`:** `tenant_id`, `palette` (jsonb: named `#RRGGBB` values, Zod-validated with a strict hex regex), `mapping`
  (semantic token → palette key, for light and dark), `font_display` and `font_body` (an **allow-list** of self-hosted, OFL-licensed
  faces committed in the repo, as today's `src/app/fonts/`), `logo_path` (Storage, reusing the upload checks of M2), `updated_by`,
  `updated_at`.
- **RLS:** members of the tenant read; owner and admin write; every write audited.
- **Contrast gate at save.** The server runs `checkTheme()` (DS2) over every required pair (today's `CONTRAST_PAIRS`) in both modes. A
  failing theme is refused with each failing pair and its ratio. The tenant can never save an unreadable theme.
- **Serving.** The `(owner)` and public layouts render one inline `<style>` block of CSS custom properties built from the validated
  mapping, allowed by the existing `style-src 'self' 'unsafe-inline'` (ADR-028:45). There is no style nonce (ADR-028:116: founder and lead
  decision 2026-11-03, variant V2 rejected), no third-party origin, and the CSP header is unchanged. The app already uses inline style
  attributes (`src/components/cost/plate-breakdown.tsx:24`, `src/app/global-error.tsx:18`); this design adds none. Because a style
  injection is possible under `'unsafe-inline'`, the serialiser emits only `--color-*` declarations with hex values (DS5's test).
  Rejected alternatives are in DS0.

### 6.3 The osteria theme: brand colours only, with computed contrast

**Palette:** the eight approved colours only (`docs/client-facts.md:14`): cream `#FFFADF`, cream-deep `#F8EFC6`, green `#1C4130`, gold
`#C89550`, olive `#7D9550`, soft `#4D5B45`, black `#0F0F0D`, yellow `#FFB028`. **Fonts:** Bodoni Moda (display), Figtree (body).

**Departure from today, made explicit.** Today's theme also uses derived shades that are not brand colours:
- `surface` `#FFFDF2`, `rule-strong` `#857A57`, `focus` `#8A5F22`, `accent-hover` `#122C20`;
- the sage dark accent;
- most of the dark theme (`docs/design/ui-foundation.md` §2, "derived UI shade").

Brand colours only is from the founder brief 2026-11-13, via the lead, and was **decided by the founder on 2026-11-13** (D2, Q-UX2: the
eight approved colours and the two approved fonts only); to be recorded in DigiAlto-Ops context.md. The mapping below meets every AA pair
with the eight colours alone. The derived shades are dropped; variant V4, which would have kept them, is closed (§9b).

**How the ratios were computed.** WCAG relative luminance and contrast ratio, using the formula implemented in
`src/lib/design/contrast.ts:14-30`, computed by hand in this session (no script runner was available). Hand values may differ from
the test's in the second decimal. Where `docs/design/ui-foundation.md` §2 already reports a tested value for the same pair, it matches
(18.27, 16.59, 10.82, 9.82, 6.90, 6.26, 10.50, 7.19, 4.26, 2.54, 1.74, 7.34, 9.80). DS1 adds every pair to `CONTRAST_PAIRS`, so
`tests/lib/design/tokens.test.ts` recomputes them exactly.

Relative luminance used:
- cream 0.9496; cream-deep 0.8577; green 0.0424; gold 0.3435;
- olive 0.2643; soft 0.0949; black 0.0047; yellow 0.5246.

**Theme-invariant tokens.** `gold`, `highlight` and `on-highlight` map to the same palette entry in both modes (gold; yellow; black).
They appear in both tables below so DS1's "exactly §6.3's mapping in both modes" covers them.

**Light mapping (proposed)**

| Token | Palette | Pair checked | Min | Ratio | Result |
|---|---|---|---|---|---|
| `paper` | cream | `ink` on `paper` | 4.5 | 18.27 | pass |
| `surface` | cream, the same as `paper` (cards set apart only by the `rule` hairline and the existing soft shadow) | `ink` on `surface` | 4.5 | 18.27 | pass. **Phase 0 legibility check:** whether cards still read as separate from the page |
| `sunk` | cream-deep | `ink` on `sunk` | 4.5 | 16.59 | pass |
| `ink` | black | `paper` on `ink` (current tab) | 4.5 | 18.27 | pass |
| `ink-muted` | soft | on `paper` / on `sunk` | 4.5 | 6.90 / 6.26 | pass |
| `band` / `band-ink` | green / cream | `band-ink` on `band` | 4.5 | 10.82 | pass |
| `accent` / `on-accent` | green / cream | label on primary button | 4.5 | 10.82 | pass |
| `accent-hover` | black | `on-accent` (cream) on black | 4.5 | 18.27 | pass |
| `accent-ink` | green | links on `paper` / on `sunk` | 4.5 | 10.82 / 9.82 | pass |
| `highlight` / `on-highlight` | yellow / black (theme-invariant) | "Consigliato" badge | 4.5 | 10.50 | pass |
| `rule-strong` | soft | input border on `paper` / `sunk` | 3 | 6.90 / 6.26 | pass |
| `accent` shape | green | primary button on `paper` | 3 | 10.82 | pass |
| `focus` | black | focus ring on `paper` / `sunk` | 3 | 18.27 / 16.59 | pass |
| `gold` | gold (theme-invariant) | rule under the wordmark on `band` | 3 | 4.26 | pass |
| `rule` | cream-deep, the same as `sunk` | hairline on `paper`; decorative, no minimum (as today) | n/a | 1.10 | decorative only. **Phase 0 legibility check**, together with `surface` = `paper`: the hairline is the only card edge |
| Chart, second series | olive | bar on `paper` (shape) | 3 | 3.18 | pass, narrow margin |

**Dark mapping (proposed)**

| Token | Palette | Pair checked | Min | Ratio | Result |
|---|---|---|---|---|---|
| `paper` / `surface` | black / black (cards by `rule` border) | `ink` (cream) on black | 4.5 | 18.27 | pass |
| `sunk` | green | `ink` (cream) on green | 4.5 | 10.82 | pass |
| `ink` | cream | `paper` (black) on cream (current tab) | 4.5 | 18.27 | pass |
| `ink-muted` | cream-deep | on black / on green | 4.5 | 16.59 / 9.82 | pass (hierarchy carried by size and weight, not tint) |
| `band` / `band-ink` | green / cream | wordmark | 4.5 | 10.82 | pass |
| `accent` / `on-accent` | gold / black | label on primary button | 4.5 | 7.19 | pass |
| `accent-hover` | yellow (label black) | label on hover | 4.5 | 10.50 | pass |
| `accent-ink` | yellow | links on black / on green | 4.5 | 10.50 / 6.22 | pass |
| `highlight` / `on-highlight` | yellow / black (theme-invariant) | "Consigliato" badge | 4.5 | 10.50 | pass |
| `rule-strong` | olive | input border on black | 3 | 5.74 | pass |
| `accent` shape | gold | primary button on black | 3 | 7.19 | pass |
| `focus` | yellow | focus ring on black / on green | 3 | 10.50 / 6.22 | pass |
| `gold` | gold (theme-invariant) | rule under the wordmark on `band` (green in both modes) | 3 | 4.26 | pass |
| `rule` | soft | hairline on black; decorative | n/a | 2.65 | decorative only |

**Forbidden pairs (measured; the contrast gate refuses them):**

| Pair | Ratio | Why forbidden |
|---|---|---|
| gold on cream | 2.54 | Under 3 and 4.5. Never text and never a required boundary on cream. Today's rule "gold is jewellery" stays |
| yellow on cream | 1.74 | Never text or boundary on cream |
| olive text on cream | 3.18 | Under 4.5. Allowed only as a non-text shape |
| green on black | 1.69 | Never in dark. This is why the dark accent is gold |
| soft on black | 2.65 | Decorative only in dark |
| gold text on green | 4.26 | Under 4.5. Fine as the band rule (non-text) only |
| olive on green | 3.40 | No muted text on `sunk` in dark |

**Status colours (product tokens, on the osteria `paper`).** Kept at today's values; these are not tenant colours:

| Pair | Ratio | Result |
|---|---|---|
| success `#2D6435` on cream | 6.70 | pass |
| warning `#74480A` on cream | 7.48 | pass |
| danger `#9A2A1D` on cream | 7.34 | pass |
| info `#1E5470` on cream | 7.82 | pass |
| danger `#F4A694` on black (dark) | 9.80 | pass |

The tinted status backgrounds and the other dark status pairs keep their tested values in `docs/design/ui-foundation.md` §2. They
were **not recomputed here**. Status words always come with their colour (ui-foundation §1).

### 6.4 Type scale

Kept from ui-foundation §3, named as tokens so a tenant's display face can replace Bodoni:

| Token | Use | Size / leading | Face |
|---|---|---|---|
| `type-wordmark` | Header name | 21 px / 1, caps, +0.1 em | tenant display |
| `type-title` | `Heading` h1 | 34 px / 1.08 | tenant display (Bodoni 600 for the osteria; never below 20 px, ui-foundation §3) |
| `type-section` | `SubHeading` h2 | 24 px / 1.25 | tenant display |
| `type-ticket` | Kitchen ticket table name | 28 px (`ticket-card.tsx:37`) | tenant display |
| `type-body` | Body and inputs | 16 px / 1.5 (inputs stay 16 px) | tenant body (Figtree) |
| `type-label` | Labels, buttons, tabs | 15–16 px bold | tenant body |
| `type-meta` | Hints, meta | 14–16 px | tenant body |
| `type-kitchen-hc` | High-contrast kitchen lines | 22 px / 1.3 (`globals.css:257-259`) | tenant body |

**Proposal (F21):** the bottom-tab labels are `text-sm` (14 px, `src/components/nav/nav-classes.ts:14`). Raise them to `type-label`
(15 px) if the 360 px layout still fits five tabs. Validate in Phase 0.

**Tenant font rule:** only faces from a committed, OFL-licensed allow-list, self-hosted (ui-foundation §3, GDPR reason). No tenant can
point at a font host. For the osteria the faces are the two approved fonts only (D2).

### 6.5 Spacing and size

- **Kept:** 16 px gutter, 24 px rhythm (`gap-6`), radii 8 / 12 / full, `tap` = 44 px (`globals.css:13-14`, PRD NFR). The 44 px token
  meets WCAG 2.2 SC 2.5.5 (AAA, 44 × 44 CSS px) and exceeds SC 2.5.8 (AA, 24 × 24 CSS px) (§4.3, R1–R5).
- **New token `tap-comfort`** for the waiter's dish buttons, the kitchen line buttons and the bars' primary actions. The gloves and wet
  hands it serves are an assumption (founder brief 2026-11-13, via the lead; to be recorded in DigiAlto-Ops context.md). R4 supports
  aiming above the minimum for important controls; the platforms give 44 × 44 pt (Apple iOS default, R15) and at least 48 × 48 dp
  (Android, R16) as reference points, in their own units. Material's own touch-target guidance (m3.material.io) was not read (§4.2). The
  value is chosen in Phase 0 by observation and is never below the 44 px `tap` token (W4).

### 6.6 Components

Existing: in `src/components/ui.tsx` (ui-foundation §6): Field, TextInput, Select, FilePicker, Checkbox, Button ×4, ErrorAlert,
SuccessNote, Heading, SubHeading, Card, LedgerList/Row, Muted, Badge. In their own files: `BackLink` (`src/components/back-link.tsx`)
and `EmptyState` (`src/components/empty-state.tsx`). Proposed additions:

| Component | Purpose | Replaces |
|---|---|---|
| `AppHeader` with `AccountControl` | Tenant name (unlinked on public pages), the user's name, "Esci" | `BrandLink` in the root layout; the in-page `LogoutButton` uses (`(owner)/page.tsx:194`, `tavoli/page.tsx:137`) |
| `StateView` | One component for loading, empty, error (+ "Riprova"), offline (+ "Dati delle hh:mm"), stale | Per-page `Muted` / `ErrorAlert` / `OfflineBanner` / kitchen `StaleBanner` combinations |
| `StickyActionBar` | The bottom bar of focus routes (comanda, count) with up to two actions, padded for the safe area. It reserves its height as bottom scroll padding so a focused control is never entirely hidden under it (WCAG 2.2 SC 2.4.11, AA, R6; tested in W1) | `order-sheet.tsx:85-89`, `close-count.tsx:70-107` styles |
| `Stepper` | − value + with 44 px+ buttons | `tavoli/covers-field.tsx` (generalised) |
| `SegmentedControl` | Tabs inside a screen (Comanda / Conto, course tabs, booking services) with `role="tab"` | Hand-made tablists: `comanda/page.tsx:376-395`, `src/app/(owner)/tavoli/comanda/course-tabs.tsx:21,31`, `src/app/(public)/prenota/[slug]/slot-picker.tsx:34,41` |

**Rules carried over:** one primary per screen (finding F12), at most two `Card`s, no icon fonts, no images except the tenant logo
file, no `italic`.

### 6.7 States (empty, loading, error, offline)

The wording below is this plan's proposal from the repo's existing patterns. It is to be checked in P0 against web.dev's offline
guidance (R23): announce a change of connection state early, reassure that queued work will be sent, and use the same words everywhere. `role="status"` and
`role="alert"` follow R13 (4.1.3).

| State | Rule | Today's example to generalise |
|---|---|---|
| Loading | Words, not a spinner alone. Keep the layout height so nothing jumps. An operation that can take longer than about 10 s (invoice extraction, a long sync) shows its progress or stage and says it will finish without the person waiting on the screen (R22) | Nav placeholders (`app-shell.tsx:80-92`) |
| Empty | Say why it is empty and offer the one next step the role is allowed | `EmptyState` + `emptyFor()` (`src/lib/empty/empty-content.ts`) |
| Error | `role="alert"` next to what failed; "Riprova" when a retry can help; never leave "Caricamento…" next to an error | Home `(owner)/page.tsx:105-114` |
| Offline | `role="status"` banner with the data's age; writes queue and each queued item says "In coda" | `OfflineBanner` (`src/components/sync/offline-banner.tsx`), `SyncStatus` |
| Stale (polling) | Say when the last good read is old; keep the list visible | `/cucina` stale banner (`cucina/page.tsx:60`) |
| Saving / saved | Per item, in words | Count line "Salvato" (`conteggi/[id]/count-line-row.tsx:66-69`) |
| Online-only action while offline | Disabled **with a sentence why** | Kitchen writes (`ticket-card.tsx:24`); whether the reason is shown: **not determined** |

### 6.8 Motion

Keep ui-foundation §5: one 420 ms reveal, 150 ms state transitions, and the `prefers-reduced-motion: reduce` block that zeroes durations
and delays (`globals.css:207-215`, guarded by a test; the media feature's values per R18).

**Proposal:** no reveal animation on the focus routes or `/cucina`. Their content updates by polling, and repeated motion there adds no
information. `prefers-reduced-motion` stays the hard override for every tenant.

### 6.9 Dark mode

- Dark follows the device (ui-foundation §1). Every tenant theme must provide a dark mapping that passes the gate (DS2).
- **Proposal:** a per-device override (`data-theme` on `<html>`, already foreseen in ui-foundation §1), stored on the device only, so a
  kitchen tablet can stay dark (DS8).
- Print stays light (`globals.css:222-239`).

## 7. Heuristic audit of the current screens

**Scale and labels.** Severity uses Nielsen's 0–4 severity scale (R21; founder brief 2026-11-13, via the lead; to be recorded in
DigiAlto-Ops context.md):
- **0:** "I don't agree that this is a usability problem at all".
- **1:** "Cosmetic problem only: need not be fixed unless extra time is available on project".
- **2:** "Minor usability problem: fixing this should be given low priority".
- **3:** "Major usability problem: important to fix, so should be given high priority".
- **4:** "Usability catastrophe: imperative to fix this before product can be released".

The heuristic labels are short forms of Nielsen's ten usability heuristics (R20).

| ID | Sev | Heuristic | Finding | Evidence | Role | Fix |
|---|---|---|---|---|---|---|
| F05b | 3 | Visibility of system status | The comanda's sticky bar says "Comanda · N righe" and does not count **unsent** lines. A waiter can leave a table with drafts not sent to the kitchen | `src/lib/orders/order-view.ts:62-71`, `it.ts:1783-1785`, `comanda/order-sheet.tsx:85-89` | Waiter | QW5, W1, W2 |
| F01 | 3 | User control and freedom; Error prevention | The guest's header brand link leads to `/`, which redirects a signed-out guest to the staff `/login`. The typed form is lost | `src/app/layout.tsx:94`, `src/components/brand.tsx:30-41`, `src/lib/supabase/proxy.ts:13-15,81` | Guest | QW1 |
| F02 | 3 | Help users recognise, diagnose, recover from errors | Booking submit is disabled until everything is filled, with no message naming the missing field. Phone **and** e-mail are required | `prenota/[slug]/request-form.tsx:117-125,353` | Guest | QW2 (V5 if one contact is enough) |
| F03 | 3 | Visibility of system status | New booking requests are counted only inside `/prenotazioni`. Home has no reservation count, so the owner learns of requests only by opening that page | `prenotazioni/page.tsx:89`; no reservation key in `src/server/today/` or `src/components/dashboard/` | Owner, admin | QW3, O1 |
| F04 | 2 | Flexibility and efficiency; Aesthetic and minimalist design | On the owner's phone Home, "Carica una fattura" comes after the alerts and up to 11 dashboard tiles (scroll distance not measured) | `(owner)/page.tsx:115-141`, `src/lib/dashboard/dashboard-view.ts:106-118` | Owner | QW4 (V2 keeps ADR-030 order) |
| F05 | 2 | Flexibility and efficiency | The daily day close is behind "Altro" (2 taps). ADR-030 accepted this and named it as a revisit trigger | `nav-model.ts:135`, ADR-030 "What would make us revisit this" | Owner | QW7 (Home action; founder decision D1, Q-UX5) |
| F06 | 2 | Flexibility and efficiency | Sending a course needs the sheet opened first: "Invia …" is only inside the expanded card. That is 2 taps per send, plus a possible scroll (not determined) | `comanda/order-sheet.tsx:51-89`, `send-buttons.tsx` | Waiter | W1 |
| F07 | 2 | Consistency and standards; User control | On a phone, "Esci" exists only at the end of Home (owner, admin, chef) and on `/tavoli` (waiter). There is none on `/cucina`, the shared kitchen device's main screen | `(owner)/page.tsx:194`, `tavoli/page.tsx:137`, `sidebar-nav.tsx` (laptop only) | Chef, all | QW6 |
| F09 | 2 | Help and documentation; Error recovery | `/produzione/nuova` with no batch recipe shows a plain line with no next step | `produzione/nuova/page.tsx:133-134` | Chef | QW8 |
| F10 | 2 | Flexibility and efficiency | Raw waste: Home → stock list → ingredient → a form placed below the lots list; 3 selects | `today-actions.ts:76`, `magazzino/[ingredientId]/page.tsx:199-225`, `waste-form.tsx:87-132` | Chef | QW9, K3 |
| F11 | 1 | Aesthetic and minimalist design | For a reviewable invoice, `/fatture/[id]` is a stop whose main job is one link to the review | `fatture/[id]/page.tsx:176-188` | Owner | QW10 |
| F12 | 1 | Consistency and standards | The session panel's "Conto richiesto" toggle becomes primary-styled when on, next to the primary "Prendi la comanda" link: two primaries | `tavoli/session-panel.tsx:64,102-104`; ui-foundation §6 "one per screen" | Waiter | QW11 |
| F08 | 1 | Match between system and the real world | "Home" is English in an Italian UI. The founder chose it (m25b Q211, answered 2026-11-01: the default stands; V7 there keeps "Oggi") | `it.ts:74,131,141` | All | Q-UX6 (no step by default) |
| F17 | 1 | Error prevention | "Avvia giornaliero" and "Avvia mensile" sit side by side; a wrong start is cancellable | `conteggi/start-count.tsx:73-80`, `close-count.tsx:86-104` | Chef | Observe in Phase 0 |
| F21 | 1 | Aesthetic and minimalist design | Bottom-tab labels are 14 px, smaller than body text, for use at arm's length | `nav/nav-classes.ts:14` | All phone | DS1 (type token), observe |
| F25 | 1 | Visibility of system status | The open-table card renders above the grid. Focus and scroll-into-view mitigate it (`useFocusIntoView`); after "Annulla" the scroll position is not determined | `tavoli/page.tsx:155-187`, `open-table-dialog.tsx:34` | Waiter | Observe in Phase 0 |
| F28 | 1 | Aesthetic and minimalist design | `/sicurezza` is a placeholder pill for owner and admin | `sicurezza/page.tsx`, `nav-model.ts:133` | Owner, admin | Hide until M31 (Q-UX18) |
| F14 | 0 | n/a | Alerts and the push list each reachable two ways (Home strip or tile, and a pill). Deliberate (ADR-030) | `(owner)/page.tsx:115-124`, `nav-model.ts:83-85` | Owner, chef | None |

**What works and must be kept** (no severity; patterns to copy):
- **Kitchen lines:** full-width buttons, the word "Fatto" with `aria-pressed`, undo, high-contrast mode (`cucina/*`).
- **Count:** autosave on leaving a field, Enter to the next, sticky close bar with a sentence of what will be posted (`conteggi/[id]/*`).
- **Table open:** idempotent session id (`open-table-dialog.tsx:12-31`).
- **Offline:** banner with data time, "In coda" markers (`src/components/sync/*`).
- **Invoice approval:** a confirmation sentence, then next-step links (`approval-panel.tsx:50-125`).
- **Tab bar and keyboard:** the bar hides on keyboard focus with a delay that avoids lost taps (`globals.css:262-293`).
- **Tested contrast pairs** in both themes (`tokens.ts`).

**SaaS readiness gaps** (not usability faults for this venue; they block selling to others):

| ID | Gap | Evidence | Step |
|---|---|---|---|
| S1 | The header and page title use the literal `app.name` "Osteria Dei Rossi", and the brand link label says "Osteria Dei Rossi, Home" | `src/lib/i18n/messages/it.ts:2,74`, `src/app/layout.tsx:68`, `brand.tsx:39` | DS6 |
| S2 | One hard-coded colour theme | `src/app/globals.css` `@theme`, `src/lib/design/tokens.ts:79-134` | DS1–DS5 |
| S3 | Fonts fixed in the root layout | `src/app/layout.tsx:17-66` | DS4–DS5 (allow-list) |
| S4 | Logo slot is a placeholder; the logo is not an approved fact | `brand.tsx:12-24`, `docs/client-facts.md:30-31` | DS4 (`logo_path`) |
| S5 | Role words fixed ("Cuoco", "Cameriere") | `it.ts:35-36` | A2 (tenant role labels, Q-UX14) |
| S6 | Service model assumes tables and courses (`COURSES` fixed) | `src/server/menu/constants.ts:14` | Deferred while restaurants are built first (D3, platform FD14); counter service is V7 |
| S7 | No entitlement layer: nav and API know roles, not tiers | `nav-model.ts:30-38` (`can: (role)`) | ENT1 (tier content waits for platform FD3, D4) |

## 8. Founder UAT friction notes

Founder decision 2026-11-13 (D5): this table **stays blank**. Nobody fills it on the founder's behalf.
"Severity" uses the §7 scale. "Linked finding" is an F-ID from §7, or "new".

| Date | Role | Screen | What happened | Severity | Linked finding |
|---|---|---|---|---|---|
| | | | | | |

## 9. Phased plan

**Sizes (relative; no days, no prices):**
- **S:** a few commits.
- **M:** one normal `/feature` run.
- **L:** large, may split into two runs, or needs an ADR or a founder decision first.

Every step below is test-first (`tdd-workflow`). Each step names the test that proves it. Paths are proposals for the phase's own
plan to confirm.

### 9.1 Validation protocol (used by every phase)

- **What is measured, per task:**
  - **success:** done correctly without help (yes / with help / no);
  - **time on task:** from the first tap on the start screen to the end state shown;
  - **taps:** counted by a second observer;
  - **errors:** a wrong tap that had to be undone, back-tracking, wrong data entered, help asked;
  - **self-rated ease:** 1–5, this project's own question ("Quanto è stato facile?"), not a standard instrument.
- **Who:** every available person per role (the venue's staff count is not a known fact): owner, chef(s), waiters. Guests for J10 are
  people outside the staff, recruited by the founder (Q-UX11).
- **Where and when:**
  - At the venue, **outside service hours**, on the devices people really use (waiters' own phones; the kitchen device).
  - On a **test tenant with demo data** (ADR-018), never on the production tenant. Ledgers are append-only, so test movements in
    production could not be deleted.
- **Conditions:**
  - Standing, phone in one hand.
  - Gloves only if Phase 0 shows the kitchen works in gloves.
  - The light of the room where the job happens.
- **Procedure:**
  1. A short consent script in Italian.
  2. One practice task.
  3. The role's tasks in a fixed order, with no hints.
  4. If someone is stuck for 3 minutes (proposed cut-off, founder may change it), the task is marked "no" and the observer helps.
  5. Afterwards, a two-question debrief: what was hard, what was missing.
- **Tasks:**
  - **Waiter:** T-W1 open a table for 4, order 2 antipasti and 1 primo, send the antipasti; T-W2 close that table with a receipt
    number and payment type.
  - **Chef:** T-C1 mark a ticket done; T-C2 register a batch; T-C3 daily count of the critical items; T-C4 log a raw waste.
  - **Owner:** T-O1 photograph and approve a test invoice (fake supplier); T-O2 day close; T-O3 accept a booking request;
    T-O4 "tell me what needs you today".
  - **Guest:** T-G1 request a table for 2.
  - **Admin:** T-A1 enrol a phone.
- **Analysis:**
  - Per task: success rate (succeeded ÷ attempted), median and range of time and taps, and an error list.
  - Each error is mapped to a §7 finding or §8 note, or added as new.
- **Pass rule for a redesign phase:** on its own tasks, against the Phase 0 baseline:
  - success rate not lower;
  - median taps and median time not higher;
  - no new finding of severity ≥ 3.

  Numeric targets beyond "not worse" are set by the founder after Phase 0 (Q-UX12). No target is assumed here.
- **Privacy:**
  - Participants are recorded by code (W1, C1, …), never by name.
  - No audio, video or screen recording by default.
  - Sheets are stored in DigiAlto-Ops (`clients/osteria-dei-rossi/deliverables/<date>-ux-baseline/`), not in the app repo.
  - Retention is decided by the founder (Q-UX11).
  - In-app measurement of staff is variant V6 only, after the venue's data-protection adviser answers (DPA-1).

### 9.2 Phases

| Phase | Scope | Depends on | Size | Validation |
|---|---|---|---|---|
| **P0 Baseline** (no code) | Run §9.1 on today's build; §8 stays blank (D5); observe the assumed conditions (§1) and the two §6.3 legibility checks; check §6.7's offline wording against R23 | Founder: Q-UX11; the supervised run; a test tenant | S | It *is* the baseline: one sheet per task and role |
| **P1 Quick wins** | QW1–QW11 | P0 results (re-rank by observed severity); answers Q-UX4, Q-UX21 (Q-UX5 decided, D1) | M (all S steps) | Re-run the tasks touched (T-G1, T-O1–T-O4, T-W1, T-W2, T-C2, T-C4) against P0 |
| **P2 Design system and tenant theming** | DS0–DS8 | ADR (DS0); Q-UX3, Q-UX16, Q-UX17 (Q-UX2 decided, D2) | L | Automated contrast gate; visual check at 360 × 740 in both themes with reduced motion (ui-foundation §7); no task-time regression on T-W1 and T-C1 |
| **P3 Waiter (Sala)** | W1–W4 | P1 (QW5), P2 (StickyActionBar, tokens) | M | T-W1, T-W2 against P0 and P1 |
| **P4 Kitchen and chef** | K1–K3 | P2 (StateView); a KDS source if one is read (§4.2; none of the D6 sites is known to cover it) | M | T-C1–T-C4 |
| **P5 Owner** | O1, O2 | P1 (QW3, QW7), P2 | M | T-O1–T-O4 |
| **P6 Admin and onboarding (SaaS)** | A1, A2, ENT1 (no tier content until platform FD3, D4); restaurants built first, counter service deferred to V7 (D3, platform FD14; restaurant venue types only in P6 is this plan's interpretation) | Founder: Q-UX10 (admin part), Q-UX14, Q-UX19; platform FD3 for any tier content; a new ADR superseding parts of ADR-030 | L | T-A1 plus a new "set up a demo venue" task with a person who has never seen the app |
| **P7 Guest booking** | G1, G2 | P2 (DS5, DS6); privacy contact and booking hours (`docs/client-facts.md:21-22`, pending) | S | T-G1 against P0 |

**P1 before go-live (founder decision 2026-11-13).** P1 is built before go-live and before P0, so "Depends on P0 results" and the validation row above do not apply as written: P0 will measure the build *after* the quick wins, and the "before" numbers for P1 are counted from the code only (quick-wins plan R6, Q-QW10). P1 now has QW1 to QW12 (QW12 is new, §9.3); G2 is not in P1.

### 9.3 Build steps (one commit each, with the test that proves it)

**P1 Quick wins**

| # | Step | Files | Test that proves it | Done |
|---|---|---|---|---|
| QW1 | Header band moves out of the root layout into the `(owner)` and `(public)` layouts; on `/prenota/*` the venue name shows with **no link** | `src/app/layout.tsx`, `src/app/(owner)/layout.tsx`, `src/app/(public)/layout.tsx`, `src/components/brand.tsx` (`BrandTitle`) | `tests/components/brand-title.test.ts`: `BrandTitle` renders no `<a>`. Extend `e2e/reservations-public.spec.ts` (360): on `/prenota/<slug>` the header has no link with `href="/"`; on `/` (owner) the band link still points to `/`; exactly one band and one `main` per page on `/login`, `/prenota/<slug>`, `/`, `/fatture` | Done (PR 1) |
| QW2 | Booking form names what is missing: the submit is enabled; on submit with gaps, one `ErrorAlert` lists the missing fields and focus moves to the first; typed values stay | `src/lib/reservations/request-check.ts` (pure `missingFields()`), `prenota/[slug]/request-form.tsx`, i18n it/en | `tests/lib/reservations/request-check.test.ts`: each missing field is named; nothing missing → empty list. `tests/components/request-form.test.ts` (jsdom): submit without a name shows "Manca: nome" (and the English pair) and focuses the name field, no request is sent, and the typed phone and e-mail are still in their fields (WCAG 2.2 SC 3.3.7, R9) | Done (PR 1) |
| QW3 | Booking requests to answer, as a Home count for owner and admin | `src/server/today/types.ts` (card key `reservationRequests`), the dashboard/today service that builds `today` (`src/server/today/summary.ts`), `src/lib/nav/today-actions.ts` (action → `/prenotazioni`), i18n | `tests/app/api/today/today.test.ts` and the dashboard API test: for the owner the count equals `/api/reservations/pending-count` on the same fixture; the chef's payload has no `reservationRequests` key; no key matches `/name\|phone\|email/`. `tests/lib/nav/today-actions.test.ts`: badge "Prenotazioni da confermare · 2" | Done (PR 2) |
| QW4 | Owner and admin Home order: "Da fare" actions and the primary action **before** the dashboard tiles | `src/app/(owner)/page.tsx` | `tests/components/home-order.test.ts` (jsdom): the primary link precedes `[data-dashboard]` for owner and admin; the alerts strip stays first. `e2e/app-shell.spec.ts` (360, fixture with 0 open alerts): "Carica una fattura" is inside the first viewport | Done (PR 2) |
| QW5 | The comanda bar counts unsent lines: "Comanda · 5 righe · 2 da inviare" | `src/lib/orders/order-view.ts` (`sheetSummary`), i18n | `tests/lib/orders/order-view.test.ts`: 2 drafts + 1 fired → "… · 2 da inviare"; a draft whose fire is queued is not counted; 0 drafts → no suffix; English pair | Done (PR 2) |
| QW6 | `AccountControl` (name + "Esci") in the signed-in header for every role; the in-page waiter "Esci" and the Home logout are removed | `src/components/nav/account-control.tsx`, `src/app/(owner)/app-shell.tsx`, `src/app/(owner)/page.tsx:194`, `tavoli/page.tsx:137`, `src/components/logout-button.tsx` | `tests/components/account-control.test.ts`: renders the signed-in name and one "Esci" button; `forgetUser` runs on logout. `e2e/app-shell.spec.ts` (360): chef on `/cucina` taps "Esci" → `/login` (PIN screen on an enrolled device); waiter on `/tavoli` the same; focus routes still show it (it is in the header, not the bar) | Done (PR 2) |
| QW7 | "Chiusura del giorno" as a Home action for owner and admin (founder decision D1, Q-UX5) | `src/lib/nav/today-actions.ts`, i18n | `tests/lib/nav/today-actions.test.ts`: owner and admin have `/chiusura`; the chef does not; the chef's actions still carry no "€" | Done (PR 2) |
| QW8 | Empty state on `/produzione/nuova` with no batch recipe: "Crea una ricetta" for the roles the recipe POST route allows, text only for the others | `src/lib/empty/empty-content.ts` (`emptyFor("batchRecipes", role)`), `produzione/nuova/page.tsx` | `tests/lib/empty/empty-content.test.ts`: the link appears for exactly the role list of the recipe POST route's `withApi` (read at build time from `src/app/api/recipes/route.ts`, mirrored as a constant with a comment); `tests/components/production-empty.test.ts` | Done (PR 2) |
| QW9 | Waste shortcut: Home "Registra uno spreco" opens `/magazzino?azione=spreco`; ingredient links then go to `/magazzino/<id>#spreco`, and the page scrolls to the waste form (`use-hash-scroll.ts` exists) | `today-actions.ts`, `magazzino/page.tsx`, `magazzino/stock-row.tsx`, `magazzino/[ingredientId]/page.tsx` (anchor id) | `tests/components/stock-row.test.ts`: with `azione=spreco` the href ends in `#spreco`. `e2e/stock.spec.ts` (360): Home → spreco → ingredient → the waste form heading is in the viewport | |
| QW10 | Invoice rows link straight to the review when the status is `review` or `duplicate` | `src/lib/invoices/invoice-view.ts` (`invoiceHref`), `fatture/page.tsx` | `tests/lib/invoices/invoice-view.test.ts`: `review` and `duplicate` → `/fatture/<id>/revisione`; others → `/fatture/<id>` | |
| QW11 | "Conto richiesto" is a pressed secondary toggle with its word, never primary | `tavoli/session-panel.tsx` | `tests/components/session-panel.test.ts`: exactly one primary-styled control (the comanda link) in both toggle states; `aria-pressed` follows the state | |
| QW12 | Leave warning on the comanda: a waiter who leaves a table with dishes not sent sees a sheet ("2 piatti non inviati": send per course, leave anyway, stay). Added by the quick-wins plan (founder item 6, second half); it builds on QW5's `unsentLines` | `src/components/nav/leave-guard.tsx`, `src/app/(owner)/tavoli/comanda/leave-sheet.tsx`, `src/app/(owner)/tavoli/comanda/page.tsx`, `src/lib/orders/fire-view.ts` (`unsentGroups`) | `tests/components/leave-sheet.test.ts`, `tests/components/leave-guard.test.ts`, `tests/components/order-page.test.ts`: see `docs/plans/2026-11-13-ux-quick-wins.md` §5, step QW12 | Done (PR 2) |

**Done column.** `Done (PR 1)` or `Done (PR 2)` is set in the commit that builds the step (`tests/config/ux-quick-wins-docs.test.ts` fails if a shipped step's cell says otherwise). The steps are built in two pull requests: the guest booking page first (QW1, QW2), the staff screens after (QW3 to QW12); see `docs/plans/2026-11-13-ux-quick-wins.md` §5. G2 is not part of P1.

**P2 Design system and tenant theming**

| # | Step | Files | Test that proves it |
|---|---|---|---|
| DS0 | ADR "Per-tenant theming": layers (§6.1); serving through one inline `<style>` under the existing `style-src 'self' 'unsafe-inline'`, no style nonce (ADR-028:116); rejected alternatives (§9.5) | `docs/adr/adr-0NN-tenant-theming.md` | Doc step: `code-reviewer` checks it names at least one rejected alternative, the CSP impact (ADR-028: header unchanged) and where data lives; no code |
| DS1 | `TenantPalette` type and `themeFromPalette(palette, mapping, mode)`, pure; the osteria mapping of §6.3 (brand colours only, D2), including the theme-invariant `gold`, `highlight`, `on-highlight`; every pair of §6.3 in `CONTRAST_PAIRS`; tab labels move to `type-label`; the `--spacing-tap` comment at `globals.css:13` names WCAG 2.2 SC 2.5.5 (AAA, 44 × 44, met) and SC 2.5.8 (AA, 24 × 24, exceeded) (§4.3) | `src/lib/design/tokens.ts`, `src/lib/design/theme.ts`, `src/components/nav/nav-classes.ts`, `src/app/globals.css` (comment only) | `tests/lib/design/theme.test.ts`: the osteria palette gives exactly §6.3's mapping in both modes; it uses only the eight `BRAND` values (no other hex); every pair meets its minimum. `tests/lib/design/tokens.test.ts` extended: `--spacing-tap` in `globals.css` is 2.75rem (44 px) or more |
| DS2 | `checkTheme(theme)` returns each failing pair with its ratio | `src/lib/design/theme-check.ts` | `tests/lib/design/theme-check.test.ts`: gold text on cream fails with 2.54 (two decimals); a valid theme returns `[]`; a missing dark mapping fails |
| DS3 | Status tokens are product tokens: `themeFromPalette` cannot override them | `src/lib/design/theme.ts` | `theme.test.ts`: a mapping that names `danger` is refused; the status pairs pass on every tenant `paper` in the fixture set |
| DS4 | `tenant_theme` table, RLS, audit; `PUT /api/settings/theme` (owner, admin) runs `checkTheme` and refuses with 422 | `supabase/migrations/<ts>_tenant_theme.sql`, `supabase/tests/database/<n>_tenant_theme.test.sql`, `src/server/settings/theme.ts`, `src/app/api/settings/theme/route.ts` | pgTAP: another tenant reads 0 rows; chef and waiter cannot write; the write is audited in the same transaction. Vitest API: waiter 403; a failing contrast → 422 listing pairs; a non-hex value → 400; a font outside the allow-list → 400 |
| DS5 | The layouts render the tenant's CSS variables in one inline `<style>` (no nonce; allowed by the existing `style-src`) | `src/app/(owner)/layout.tsx`, `src/app/(public)/layout.tsx`, `src/server/settings/theme-css.ts` (pure serialiser) | `tests/server/settings/theme-css.test.ts`: only `--color-*` declarations, values matching `^#[0-9A-F]{6}$`, nothing else. Playwright: the computed `--color-accent` equals the tenant's; the CSP header is unchanged (`e2e/security-headers.spec.ts` still green); `e2e/fonts.spec.ts` still green |
| DS6 | Tenant name instead of `app.name` in the header, the page title and the brand link label | `src/components/brand.tsx`, layouts, `src/app/layout.tsx` (metadata), i18n | `tests/components/brand.test.ts`: renders the name passed in. A grep test fails if `t("app.name")` appears in `src/components/` or the layouts. Playwright: a second test tenant's name shows on its pages |
| DS7 | `StateView` (loading, empty, error, offline, stale) and its use on `/tavoli`, comanda, `/cucina`, Home | `src/components/state-view.tsx`, those pages | `tests/components/state-view.test.ts`: the right role per state (`status` or `alert`); error has "Riprova" only when a retry callback is given; no "Caricamento…" next to an error |
| DS8 | Per-device theme override (`data-theme`), stored on the device only; osteria dark mapping live | `src/components/theme-toggle.tsx`, `globals.css`, `/cucina` | `tests/components/theme-toggle.test.ts`: sets `data-theme` and keeps it in local storage; no request is made. Tokens test: dark pairs of §6.3 pass |

**P3–P7**

| # | Step | Files | Test that proves it |
|---|---|---|---|
| W1 | The comanda `StickyActionBar` shows "Invia <portata> · n" for the selected course when it has drafts (one tap), beside the sheet toggle; the count's close bar uses the same component; the bar reserves its height as bottom scroll padding (§4.3, R6) | `comanda/order-sheet.tsx`, `conteggi/[id]/close-count.tsx`, `src/components/sticky-action-bar.tsx`, `src/lib/orders/fire-view.ts` | `tests/components/order-sheet.test.ts`: the bar button sends exactly the course's draft ids (same as `fireGroups`); hidden when there are none. `e2e/order-entry.spec.ts` (360): grid → "Apri tavolo" → dish → "Invia antipasti" = 4 taps from the tile; tabbing to the last dish button, its box is not entirely under the bar. `e2e/counts.spec.ts` (360): tabbing to the last count field, its box is not entirely under the close bar |
| W2 | Table tiles show "Da inviare · n" | `/api/tables` service output (`src/server/tables/output.ts`, its SQL), `tavoli/table-tile.tsx` | pgTAP or API test: `unsentCount` per session equals the drafts not fired or voided; the waiter payload gains no cost key (extend the waiter-cost column test). `tests/components/table-tile.test.ts` |
| W3 | High-contrast mode on `/tavoli` and the comanda (same `data-contrast="high"`) | `tavoli/page.tsx`, `comanda/page.tsx`, the kitchen `contrast-toggle.tsx` generalised | `tests/components/contrast-toggle.test.ts` for Sala; `HIGH_CONTRAST_PAIRS` unchanged and green |
| W4 | `tap-comfort` token on dish buttons, kitchen lines and bar actions (value from P0, never below the 44 px `tap`) | `globals.css`, `comanda/menu-item-button.tsx`, `cucina/kitchen-line.tsx` | Playwright 360: each measured element ≥ the token and ≥ 44 px; no sideways scroll (`expectPhoneFriendly`). Playwright 320 (WCAG Reflow, R14): no sideways scroll on `/tavoli`, the comanda and `/cucina` |
| K1 | Chef Home card "Comande aperte · n" first | `src/server/today/*` (card `openTickets`), `today-actions.ts`, `(owner)/page.tsx` | API test: count equals `/api/kitchen/tickets` open tickets on the fixture; no money key. Component test: the card is first for the chef |
| K2 | Production form: the chef's most recent batch recipes as large buttons above the select | `produzione/nuova/production-form.tsx`, recipes API (recent list) | `tests/components/production-form.test.ts`: a recent-recipe tap selects it and focuses the quantity; the select still works |
| K3 | One "Registra spreco" screen: ingredient search, quantity, reason | `src/app/(owner)/magazzino/spreco/page.tsx`, the existing waste API | `tests/components/waste-screen.test.ts`; `e2e/stock.spec.ts`: Home → waste registered in ≤ the taps of QW9 |
| O1 | Owner Home "Da fare ora": one list of counted items (alerts, invoices to review, booking requests, overdue payables, day close) | `(owner)/page.tsx`, `today-actions.ts` | `tests/components/home-today.test.ts`: order and wording; items with 0 show "Niente da fare"; no personal data |
| O2 | "Chiusura di ieri: da fare / fatta" from the server | `src/server/today/*` (key `dayCloseDone` for the previous business day, ADR-033), `today-actions.ts` | API test on fixtures: closed day → true; open → false; the chef has no key |
| A1 | Group "Impostazioni" behind "Altro" gathering the settings screens (URLs unchanged); new ADR | `src/lib/nav/nav-model.ts`, `docs/adr/` | `tests/lib/nav/nav-model.test.ts`: the role × section table with Impostazioni; max 6 pills; `/costi/impostazioni` marks Impostazioni current |
| A2 | Tenant setup wizard (name, theme, venue type, services, tables, role labels) using the existing APIs. Venue types offered in P6: restaurant types only. This is **this plan's interpretation** of "restaurants first" (D3, platform FD14) for P6, not part of the decision: counter service is deferred, not excluded, and V7.2 adds it | `src/app/(owner)/impostazioni/avvio/*` | Component tests per step, including (P6 interpretation of D3, replaced by V7.2's test when V7 is built): the venue-type step offers no counter-service option; Playwright: a new test tenant finishes the wizard and Home shows its name and colours |
| ENT1 | Entitlements: `can(role, entitlements)` in the nav model; the API refuses a section outside the tenant's plan with 403 `not_in_plan`. Ships with no tier content: which sections belong to which tier waits for platform FD3 (D4) | `nav-model.ts`, `src/lib/api/with-api.ts`, migration `tenant_entitlement`, pgTAP | Vitest: a section hidden when not entitled; API 403 `not_in_plan`; pgTAP RLS on the new table; existing role tests unchanged; no tier-to-section mapping is seeded (fixture entitlements only) |
| G1 | Booking page wears the tenant theme and name (from DS5, DS6) | `prenota/[slug]/page.tsx` | Playwright: two test tenants show their own name and accent on `/prenota/<slug>` |
| G2 | Slot picker buttons sized `tap-comfort`; the chosen slot announced in a status line. `aria-pressed` on the chosen slot already exists (`slot-picker.tsx:62`) and stays | `prenota/[slug]/slot-picker.tsx`, `e2e/reservations-public.spec.ts` | `tests/components/slot-picker.test.ts`: `aria-pressed` still on the chosen slot (regression); new: a `role="status"` line (R13) names the chosen time. `e2e/reservations-public.spec.ts` (360): each slot button ≥ `tap-comfort` **Not in P1** (dropped: it needs the `tap-comfort` token from P2; see `docs/plans/2026-11-13-ux-quick-wins.md` §5a, "Dropped"). Stays in P7 |

### 9.4 Branches

One `/feature` run per phase: `feat/ux-p1-quick-wins`, `feat/ux-p2-tenant-theming`, `feat/ux-p3-sala`, `feat/ux-p4-cucina`,
`feat/ux-p5-owner`, `feat/ux-p6-onboarding`, `feat/ux-p7-booking`. These are not milestones, so they follow the precedent of
`docs/plans/2026-10-28-ux-flows.md` §5 (`feat/ux-p0-shell`, `feat/ux-p1-flows`, `feat/ux-p2-polish`, one `/feature` run each), which the
founder accepted in the answer to its Q6 (2026-10-28: "Done").

### 9.5 Alternatives considered (and rejected)

- **A full visual redesign before measuring.** Rejected: friction must be measured with the real staff first (P0). Otherwise we
  optimise guesses.
- **A UI kit or theming library** (e.g. a headless component library, CSS-in-JS). Rejected: no new dependency is needed. Tailwind v4
  custom properties and `ui.tsx` already do it, and CSS-in-JS would add a runtime dependency for what one block of custom properties
  already does.
- **Tenant theme as a generated static CSS file per tenant at build time.** Rejected: every new tenant would need a deploy.
- **Tenant theme served from a separate `/theme.css` route.** Not chosen by default: it adds a cacheable request per page and a cache
  invalidation question. Kept as the DS0 alternative.
- **Tenant-themable status colours.** Rejected by default (Q-UX3): meaning should not change per brand, and a tenant palette could
  fail the status pairs.
- **A sixth tab, or a drawer, for the day close.** Rejected again for the reasons in ADR-030. The founder decided on 2026-11-13 that
  the day close stays on Home (D1): QW7 covers it, and the m25b V1 swap (§9b V1) is closed.
- **Keeping today's derived shades in the osteria theme.** Rejected by the founder on 2026-11-13 (D2): brand colours only (§9b V4 closed).

### 9b. Variants

V1 and V4 are **closed** by the founder decisions of 2026-11-13 (D1, D2): their triggers can no longer fire, and they are kept only as a
record. They are not built.

| ID | Trigger (open answer) | Replaces | Steps |
|---|---|---|---|
| **V1** Registro as a direct tab (**closed**, D1) | Was: Q-UX5 answered "Chiusura one tap away as a tab" (m25b's V1 for Q207). Q-UX5 was decided on 2026-11-13 for the Home action, so this does not fire | QW7 | Not built. Recorded step, if Q-UX5 is ever reopened: V1.1 `phoneTabs` for owner and admin: Home · Gestione · Cucina · Registro · Altro (Sala and Anagrafica in Altro). Test: `tests/lib/nav/nav-model.test.ts` owner and admin tabs in that order; `/altro` lists Sala and Anagrafica; the waiter is unchanged |
| **V2** Keep ADR-030's Home order | Q-UX4 answered "keep alerts, then tiles, then actions" | QW4 | V2.1 keep the order and add the compact "Da fare" counts inside the alerts strip area. Test: `tests/components/home-order.test.ts` asserts the ADR-030 order (alerts, `[data-dashboard]`, primary) and that the counts render inside the strip |
| **V3** Chef lands on Comande during an open service | Q-UX8 answered "yes" | none (adds after K1) | V3.1 `landingFor(role, serviceOpen)`: chef → `/cucina` while a service period is open (ADR-031), `/` otherwise; the PIN flow passes the flag from its reply. Test: `tests/lib/nav/nav-model.test.ts` both cases; `tests/components/pin-flow.test.ts` chef + open service → `replace("/cucina")` |
| **V4** Keep derived shades in tenant themes (**closed**, D2) | Was: Q-UX2 answered "derived tints allowed". Q-UX2 was decided on 2026-11-13 for brand colours only, so this does not fire | DS1's osteria mapping for `surface`, `rule-strong`, `focus`, `accent-hover` and the dark theme | Not built. Recorded step, if Q-UX2 is ever reopened: V4.1 the mapping allows `mix(a, b, t)` entries over palette keys (as `DERIVED` today) and the osteria mapping keeps today's values. Test: `theme.test.ts` each derived literal equals its formula; all pairs pass; `tokens.test.ts` unchanged |
| **V5** One contact is enough for a booking | Q-UX7 answered "phone or e-mail" | none (adds after QW2) | V5.1 the request schema and `missingFields` accept phone **or** e-mail. Test: API test accepts phone-only and e-mail-only and refuses neither; `request-check.test.ts` "Manca: telefono o e-mail" |
| **V6** In-app task measurement in test sessions | Q-UX13 answered "yes" after the data-protection adviser (DPA-1) | none (adds to P0) | V6.1 a test-mode flag (test tenant only) that stores per-task tap counts and durations with a participant code, no user id, in an append-only table with a retention job. Test: pgTAP: no row on a non-test tenant; no column holds a user id; the retention job deletes rows older than the founder's period |
| **V7** Counter service (bars, coffee shops) | Counter service is scheduled after the restaurant build: the founder or a platform decision following FD14 starts counter-service venues. D3 (restaurants first, Q-UX9) defers counter service; it does not exclude it | A2's P6 venue-type step as this plan interprets it (restaurant types only) (adds to P6 or a later phase) | V7.1 a "Banco" order with no table and no courses, reusing the order and fire procedures. Test: pgTAP: a counter order depletes like a table order and stays single-transaction; Vitest: the waiter view shows no table grid for a counter-only venue. V7.2 A2's venue-type step offers counter service. Test: the A2 component test's "no counter-service option" assertion is replaced by "counter service offered and saved" |

### 9c. Risks, security and privacy

- **Tenant theme as an injection path.** `style-src` allows inline styles (`'unsafe-inline'`, ADR-028:45), so the theme block itself must
  be safe.
  - Mitigations: strict hex Zod schema; font allow-list; the serialiser emits only `--color-*` declarations with hex values (DS5 test);
    logo uploads reuse M2's type, size and magic-byte checks; CSP unchanged (ADR-028), `script-src` stays nonce-only.
- **Cross-tenant leakage of name or theme.** `tenant_theme` has RLS (DS4). The public page resolves the tenant from the slug on the
  server (ADR-032). G1 tests two tenants.
- **Personal data:**
  - QW3 and O1 return **counts only**, with no names, phones or e-mails (tested key regex).
  - The header shows only the signed-in user's own name (QW6).
  - UAT sheets carry participant codes, not names (§9.1).
  - V6 only after the adviser answers.
- **Waiters never see costs; no money on Home counts.** W2 extends the waiter-cost column test; K1, O2 and QW7 keep the "no money key"
  tests.
- **Roles and plans in Postgres, not only in the UI.** ENT1 adds the entitlement check in the API and RLS; nav hiding is never the guard.
- **Staff sign-in accessibility.** The PIN may need one of WCAG 2.2 SC 3.3.8's exceptions (R8). Not determined; Q-UX21. No change to
  the sign-in security model is proposed here.
- **Secrets.** No new secret in any phase.
  - Existing app secrets (including `PIN_PEPPER` and the extraction API key) stay in Vercel environment variables.
  - Database-side secrets stay in Supabase Vault (`docs/guides/cron-vault-secrets.md`).
  - CI secrets stay in GitHub environments.
  - Provider logins stay in the account owners' password manager (project Q26).
  - Fonts stay self-hosted, so there is no font provider account.
  - If a usability-testing or analytics provider is ever proposed, its choice, prices and data retention are open questions
    (Q-UX13), never estimated.
- **Changing screens of a live service.** Deploy outside service hours (Q-UX15). Each phase's e2e changes are listed before and after
  in its PR (as in ux-flows §6).
- **Test changes that look like weakening** (QW6 removes two in-page "Esci" buttons; QW4 or V2 change the Home order assertions).
  Each changed assertion is listed in the PR, and its replacement is stricter.
- **Best practice with partial sourcing.** WCAG 2.2, Nielsen's heuristics and severity scale, response times and offline guidance are
  sourced (R19–R23). The §4.5 items (Material touch guidance, kitchen display practice, Italian UI writing) have no external source; each
  is re-checked before its phase plan is approved.

## 10. Open questions and founder decisions

| # | Question | Recommended default |
|---|---|---|
| Q-UX1 | Allow more research hosts in the session's network settings: `www.w3.org` (to check §4.1's WCAG quotations against the published Recommendation), `www.nngroup.com` or `en.wikipedia.org` (the heuristics citation and the severity wording), `web.dev` (offline UX), `m3.material.io`, `developer.mozilla.org` (browser support), `designers.italia.it` / `docs.italia.it` (Italian UI writing), `learn.microsoft.com`? Kitchen display (KDS) practice also has no source yet: which vendor pages, if any, may be read? | **Decided 2026-11-13 (D6): approved** for `www.w3.org`, `nngroup.com`, `m3.material.io`, `web.dev`. Read on 2026-11-13: R19 (WCAG 2.2 Recommendation), R20–R22 (nngroup), R23 (web.dev). `m3.material.io` loads but renders its text with JavaScript, so Material stays unsourced (§4.5). The other hosts and KDS vendor pages were not part of the decision |
| Q-UX2 | The osteria theme: the eight approved colours only (§6.3), or keep today's derived tints (`#FFFDF2`, `#857A57`, `#8A5F22`, `#122C20`, the sage dark accent)? | **Decided 2026-11-13 (D2): brand colours only**, the eight approved colours and the two approved fonts. V4 closed |
| Q-UX3 | Status colours (success, warning, error, info) the same for every venue, not part of a venue's theme? | **Yes, same for all** |
| Q-UX4 | Home order for owner and admin: "Da fare" and "Carica una fattura" above the figures (QW4), or ADR-030's order (alerts, figures, actions)? | **Actions above figures** (QW4); V2 otherwise |
| Q-UX5 | Day close: an action on Home (QW7), or Registro as its own tab with Sala behind "Altro" (V1, = m25b Q207 V1)? | **Decided 2026-11-13 (D1): Home action** (QW7). V1 closed |
| Q-UX6 | "Home" or "Oggi" (m25b Q211, answered 2026-11-01: the default "Home" stands)? | **Keep "Home"** (your choice); revisit if P0 shows confusion |
| Q-UX7 | Booking: must guests give both phone and e-mail (as today), or is one enough? | **Keep both** (reservations plan); QW2 says what is missing; V5 if one is enough |
| Q-UX8 | Should the chef land on "Comande" while a service is open? | **No** (Home with the K1 card first); V3 if yes |
| Q-UX9 | First SaaS venue types: table-service restaurants only, or also counter service (bars, coffee shops)? | **Decided 2026-11-13 (D3): restaurants first** (platform FD14): restaurants are built first; counter service is deferred, not excluded (V7) |
| Q-UX10 | Paid tiers: which sections belong to which tier? For SaaS, is "admin" DigiAlto staff across venues or a manager per venue? | Tier mapping decided (D4): waits for platform FD3. The admin question is still open; default: DigiAlto staff per venue. |
| Q-UX11 | UAT participants, consent and notes: participant codes, no recordings, sheets kept until the phase report, then deleted? Who recruits guests for T-G1? | **Yes to codes and no recordings**; you set the retention period; you recruit 2–3 non-staff guests (number is a proposal, not a requirement) |
| Q-UX12 | Targets beyond "not worse than baseline" (§9.1)? | **Set them after P0** with the baseline in hand |
| Q-UX13 | Any in-app measurement of staff, or any testing or analytics provider? | **No** (observer sheets only); if wanted, the data-protection adviser first (DPA-1), then provider choice, prices and retention as open questions (V6) |
| Q-UX14 | Role labels per venue (e.g. "Cuoco", "Cameriere", and words for bars), including gender-inclusive forms? | **Keep today's words for the osteria**; tenant-configurable labels in A2 |
| Q-UX15 | Deploy UX changes only outside service hours? | **Yes** |
| Q-UX16 | Tenant fonts only from a committed, OFL-licensed, self-hosted allow-list? | **Yes** |
| Q-UX17 | A per-device light or dark switch (e.g. the kitchen tablet always dark)? | **Yes** (DS8) |
| Q-UX18 | Hide the "Sicurezza" placeholder until the HACCP register (M31) exists? | **Hide it** (m25b Q216 put it there; this reverses that default, so it needs your yes) |
| Q-UX19 | Gather the settings screens into an "Impostazioni" group behind "Altro" (A1, a new ADR that supersedes part of ADR-030)? | **Yes, in P6** |
| Q-UX20 | The logo is not an approved fact (`docs/client-facts.md:30-31`). Keep the placeholder mark until it is? | **Yes** |
| Q-UX21 | Staff PIN sign-in and WCAG 2.2 SC 3.3.8 Accessible Authentication (Minimum), AA (R8): a remembered PIN is a cognitive function test unless an exception applies (an alternative method, or a mechanism such as paste or autofill). Should the P1 plan check which exception holds for a waiter on an enrolled device and propose a step if none does? | **Yes, check in the P1 plan**; no change before then |

**Founder UAT notes (§8):** decided 2026-11-13 (D5): the table stays blank.

---

*Not determined from the code in this pass:*
- scroll distances on every flow;
- whether the PIN keypad submits on iOS;
- whether the kitchen ticket closes by itself when all dishes are done;
- the day the Chiusura picker opens on;
- whether portions and shelf life are always prefilled in production;
- whether the booking day view opens on the request's day;
- whether `/impostazioni/dati-di-prova` is hidden on production;
- whether the kitchen's offline-disabled buttons show a reason;
- whether the PIN field allows paste or autofill, and so whether a WCAG 3.3.8 exception holds (Q-UX21).

Phase 0 or the phase plans settle these.
