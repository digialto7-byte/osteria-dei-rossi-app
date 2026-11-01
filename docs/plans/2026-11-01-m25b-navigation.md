# Tech plan — Osteria Digitalization · M25b Navigation restructure (mobile first)

- **Client slug / internal:** `osteria-dei-rossi`.
  - Approved client facts in `docs/client-facts.md`: trading name, brand colours and fonts. **M25b uses only the trading name**, already in the wordmark label.
  - **No client figure is used.** Fixtures follow the M22–M24 conventions: tenants "Osteria Demo A/B"; users "Titolare Demo", "Admin Demo", "Chef Demo", "Cameriere Demo"; suppliers "Fornitore Demo A", "Fornitore Demo B". Every date and amount is a fake fixture value.
- **Repo and branch:** `osteria-dei-rossi-app`, worktree `/home/user/osteria-m25b`, branch `feat/m25b-navigation`, from `main` `0f1df68` (M0–M24 merged, M10 deferred). M25 (go-live) and M25a (password sign-in) are planned on their own branches and not merged (§3.9).
- **Numbering:**
  - migrations: one, `20261118100000_payable_list_range.sql`. M24 reserved `20261117100000`+ for its variants, so M25b starts on the next day. `…100100`–`…100900` are kept for review fixes; variants use `20261118101000`+;
  - pgTAP: `267`. `265` and `266` are reserved by M24's variants V4 and V6. M25b variants use `268`+;
  - ADR-030 (`docs/adr/adr-030-navigation-by-job-home-first.md`, proposed; supersedes ADR-020 once accepted);
  - questions **Q207–Q219** (M25a used Q197–Q206). Variants V1–V9 belong to this plan;
  - e2e: no new spec file. `e2e/app-shell.spec.ts`, `e2e/dashboard.spec.ts`, `e2e/payables.spec.ts` and `e2e/alerts.spec.ts` change (step 16).
- **Shared lists (house lesson).** This milestone rewrites most of the lists that spell out the navigation. Every one is changed on purpose in a named step, or left unchanged on purpose:

  | List | M25b | Step |
  |---|---|---|
  | `src/lib/nav/nav-model.ts` (`GROUPS`, `SECTIONS`) | rewritten | 1 |
  | `tests/lib/nav/nav-model.test.ts` (`EXPECTED`, group order, per-role cases) | rewritten | 1 |
  | `tests/components/app-shell.test.ts` (tab names, row pills, sidebar headings and the `3 + 3 + 5 + 4 + 6` count) | rewritten | 2, 4 |
  | `tests/components/me-retry.test.ts` line 78 (the owner's tab names) | updated | 2 |
  | `tests/components/brand-link.test.ts` line 12 (`"Osteria Dei Rossi, Oggi"`) | updated | 2 |
  | `e2e/app-shell.spec.ts`: `TABS`, `PAGES`, `OWNER_HREFS`, `SIDEBAR_HREFS`, `ROW_HREFS`, the sidebar heading and link lists, the A3 wordmark name, the A4 tab test | rewritten | 16 |
  | `e2e/app-shell.spec.ts`: the B5 back-link `routes` list | **unchanged on purpose** (no URL moves; `/altro` and `/sicurezza` are top-level pages with no back link) | — |
  | `e2e/dashboard.spec.ts` (the to-do-before-tiles order; tile bodies; the chef's "Cosa preparare" link) | updated | 16 |
  | `e2e/alerts.spec.ts` lines 164–174 (clicks the home list's "Avvisi" action) | updated | 16 |
  | `e2e/payables.spec.ts` (the `tab(page, "Cucina")` helper) | unchanged; one test added | 16 |
  | other specs using `nav(page)` + `aria-current` (`recipes`, `costs`, `batches`, `stock`, `menu-tables`, `alert-rules`, `kitchen`) | **unchanged on purpose**: each asserted pill stays in a row of two or more pills (checked in §3.1.6) | — |
  | `tests/integration/dashboard.int.ts` | one case added (the Home alert read) | 15 |
  | pgTAP `207` line 20 (`payable_list` md5) | updated | 6 |
  | pgTAP `071` line 101 (`payable_list` signature in the privilege check) | updated | 6 |
  | pgTAP `180`, `205` (positional `payable_list` calls) | **unchanged**; green because the new parameters have defaults | 6 |
  | pgTAP `203`, `204`, `214`, `222`, `229`, `238`, `240` | **unchanged on purpose**: no dashboard key, tile, public function name, table or check changes (`payable_list` keeps its name) | 6 |
  | `tests/lib/reports/no-money-math.test.ts` | **unchanged on purpose**: no report file is added or moved | — |
  | PWA manifest (`src/app/manifest.ts`, `tests/app/manifest.test.ts`) | **unchanged on purpose**: there are no `shortcuts`; `start_url` stays `/` | 0 (asserted) |
  | `src/lib/nav/today-actions.ts`, `tests/lib/nav/today-actions.test.ts` | the two `/avvisi` actions removed | 13 |
  | `tests/components/home-dashboard.test.ts`, `home-links.test.ts`, `home-today.test.ts` | updated | 13 |
  | `tests/components/dashboard-tiles.test.ts`, `tests/lib/dashboard/dashboard-view.test.ts` | extended | 14 |
  | `tests/config/m25-preserves.test.ts`, `tests/config/m25a-preserves.test.ts` (only if merged before M25b) | pins updated | 18 |

  A grep of `e2e/` for `/oggi` finds nothing. The group hrefs (`/`, `/fatture`, `/cucina`, `/tavoli`, `/costi`) appear only in the files above.
- **Shared check constraints:** no audit entity type or action, alert kind or `job_run` job is added. `tests/config/check-constraint-union.test.ts` is unaffected.
- **Author:** architect · **Date:** 2026-11-01
- **Sources:**
  - The founder's request of 2026-11-01 (through the lead).
  - `CLAUDE.md`; `docs/prd.md`; project plan §3.6, §5 (M31 HACCP registers; temperature logs are out of the PRD's scope, line 45 and line 1202); `docs/design/ui-foundation.md` §6 (app shell row), §8.
  - ADR-020, ADR-021; the M23, M24 plans; the M25a plan in `/home/user/osteria-m25a` (steps 0, 13, 17) and the M25 plan in `/home/user/osteria-m25` (step 1) for coexistence.
  - The merged code listed in §2. **Where merged code and a plan differ, the code wins.**
  - DigiAlto-Ops `clients/osteria-dei-rossi/context.md`: no navigation decision recorded.

> **Flags for the founder (read first)**
> - **Your six groups, as asked: Home, Gestione, Cucina, Sala, Anagrafica, Registro.** No address changes, so links, e-mails and bookmarks keep working.
> - **The phone has five tabs: Home · Gestione · Cucina · Sala · Altro.** "Altro" opens one page with Anagrafica and Registro, each with its screens as big links. On a laptop the left sidebar shows all six groups (Q207).
> - **Home opens with the open alerts** (the three newest, with "Ho visto" and "Tutti gli avvisi"), then the dashboard tiles in a **compact form**: each tile shows one line and its link ("Apri pagamenti"); "Dettagli" opens the full tile (Q209, Q210, Q219).
> - **Fatture and Pagamenti get "Dal", "Al" and "Fornitore" filters.** They stay in the address (a refresh or a shared link keeps them) and "Azzera filtri" clears them in one tap (Q212–Q214).
> - **Nobody sees more than before.** The waiter sees only Sala. The chef has Home, Cucina and Anagrafica (Ricette, Ingredienti, which the chef already had). The only new item is **"Sicurezza" in Registro**, an empty "in arrivo" page for you and the admin (Q216).
> - **Screens you did not name are placed in §3.1.3, each with a default** (Q208). Examples: the kitchen board ("Comande") opens Cucina; "Da spingere" stays next to Avvisi in Home; "Importa dati" is in Anagrafica; the change log is renamed "Attività" in Registro, so it does not share a name with the group.
> - **"Oggi" becomes "Home"** in the tab, the row and the logo's label (Q211).
> - **No new provider, dependency, secret or paid service.** One database change: the payables list learns a date range.
> - Q207–Q219: **open; each has a default in force for this build** (§7).

## 1. Goal and scope

- **Goal:** the owner opens the app on a phone and finds what needs attention first (alerts, then the day's figures), and every screen is at most two taps away in a grouping that matches how the osteria works. Fatture and Pagamenti can be narrowed by period and supplier without losing the filter on refresh.
- **In scope**
  - **Navigation model** (`src/lib/nav/nav-model.ts`): six groups, the same per-section gates, `phoneTabs`, `currentTab`, `overflowGroups` (step 1).
  - **Shell:** bottom tabs from `phoneTabs` with "Altro" (step 2); `/altro` (step 3); a six-group sidebar that scrolls on short laptop screens (step 4).
  - **`/sicurezza`:** an empty "in arrivo" page in Registro, owner and admin (step 5).
  - **Filters:**
    - `GET /api/payables` gains `from`, `to` (step 7), backed by `public.payable_list` with two new parameters (step 6, the only migration);
    - `GET /api/invoices` gains `from`, `to`, `supplier`, and its query parsing becomes strict (step 8);
    - pure URL helpers (step 9), the shared `ListFilters` control, and the filters on `/fatture` (step 10) and `/pagamenti` (step 11).
  - **Home:**
    - `GET /api/alerts` gains `limit` (step 12);
    - the alert strip first, the actions without the two duplicate `/avvisi` links, the account card last (step 13);
    - compact tiles (step 14).
  - **Tests:** Vitest (unit, route, component, guards), pgTAP `267`, one new integration suite plus one case, Playwright updates (steps 15, 16). Docs (step 17). The other milestones' guard pins (step 18).
- **Out of scope**
  - any URL rename or redirect (§3.1.1);
  - any change to API role lists, RLS policies or what a role may open;
  - the HACCP register itself, fridge temperatures, wireless thermometers (M31 / Phase 2; temperature logs are outside the PRD's scope today, Q216);
  - Pranzo/Cena service periods (M25c; §3.8 leaves room);
  - paging of the invoice list beyond its existing 100-row cap (§6);
  - a supplier filter on other lists (Magazzino, Riordino) and CSV links for filtered lists (M24 Q169).

## 2. Current state (`main` `0f1df68`)

### 2.1 Reused as they are

| Object (file) | State | M25b uses it how |
|---|---|---|
| Nav model (`src/lib/nav/nav-model.ts`) | `GroupKey` = `oggi`, `acquisti`, `cucina`, `sala`, `gestione`; 21 sections with `can` gates; `navFor`, `currentSection`, `currentGroup`, `isFocusRoute`, `landingFor` | Rewritten in step 1, same exports plus three |
| `isCurrent` (`src/lib/nav/is-current.ts`) | Home only on `/`; others on their path and below | Unchanged |
| Shell (`src/app/(owner)/app-shell.tsx`) | `AppShellView`: bar when `groups.length > 1`; row when the group has 2+ sections; sidebar from 1024 px; placeholders while `/api/me` loads | Step 2 swaps groups for `phoneTabs` in the bar |
| `BottomTabsView`, `SectionNavView`, `SidebarNavView`, `nav-classes.ts` (`src/components/nav/`) | `nav "Sezioni"`, `nav "Menu principale"` (row and sidebar), `aria-current="page"`, `min-h-tap` | Bar takes tabs (2); sidebar gains a max height (4); row unchanged |
| `BackLink` (`src/components/back-link.tsx`) | `‹` is `aria-hidden`, so the link's name is the label alone | Unchanged; the e2e disambiguation in §3.1.6 depends on it |
| Brand link (`src/components/brand.tsx`) | `aria-label={t("brand.homeLink")}` = "Osteria Dei Rossi, Oggi" | Label value changes (2) |
| Home (`src/app/(owner)/page.tsx`) | h1 greeting → account `Card` → error → actions (primary first) → "Primi passi" → tiles (`data-dashboard`) → `LogoutButton` | Reordered (13) |
| `todayActions` (`src/lib/nav/today-actions.ts`) | owner: Carica una fattura, **Avvisi (`/avvisi`)**, Comande, Pagamenti, Costi, Tavoli, Menu; chef: Nuova produzione, Comande, **Cosa preparare (`/avvisi`)**, … | The two `/avvisi` actions removed (13) |
| Dashboard (`GET /api/dashboard`, `src/server/dashboard/output.ts`, `DashboardTiles`, `Tile`, `dashboard-view.ts`) | Owner/admin; strict output; `tileOrder`, `tileEmpty`, formatters; tiles are `section[data-tile]` with an `h2` and one link | Compact rendering only (14); output and SQL unchanged |
| Alerts (`GET /api/alerts`, `src/server/alerts/list.ts`) | Owner and chef; strict query `filter`, `before`, `locale`; page of `ALERT_LIST_PAGE_SIZE` = 50; `AlertRow` with "Ho visto"; `POST /api/alerts/:id/ack` | Gains `limit` (12); `AlertRow` reused on Home (13) |
| Payables (`GET /api/payables`, `src/server/payables/list.ts`) | Strict query `filter`, `supplier`, `before`; repeated key → 400; RPC `payable_list(p_filter, p_supplier, p_cursor_date, p_cursor_id, p_limit)` | Gains `from`, `to` (6, 7) |
| `public.payable_list` (`20261024100100_payable_reads.sql`) | Definer, `require_payables_reader()`, tenant from `app.tenant_id()`, key date = `paid_on` for `paid` else `due_date`; keyset cursor on (key, id); unpaid totals by supplier | Replaced with two more parameters (6) |
| Invoices (`GET /api/invoices`, `src/server/invoices/invoices.ts`) | `listInvoicesQuery` = `z.object({status, before})` (**not strict**, repeated keys not refused); RLS select, newest `created_at` first, cap 100; `invoice.supplier_id` (set at review) and `invoice_date` exist | Strict; gains `from`, `to`, `supplier` (8) |
| `GET /api/suppliers` | Owner, admin, chef; `?active=true` filter exists | The Fornitore choices (10, 11) |
| Audit page date pattern (`src/app/(owner)/registro/page.tsx`) | "Dal"/"Al" `TextInput type="date"` with `min`/`max` | Same pattern in `ListFilters` |
| URL-state pattern (`src/app/(owner)/report/page.tsx`) | `useSearchParams` inside `Suspense`, Italian keys (`dal`, `al`), a pure `readParams` | Same pattern for the lists |

### 2.2 Every screen today (routes under `src/app`, 61 `page.tsx`)

`(owner)` (58): `/`, `/avvisi`, `/spingere`, `/fatture`, `/fatture/[id]`, `/fatture/[id]/revisione`, `/fatture/qualita`, `/pagamenti`, `/pagamenti/[id]`, `/anagrafiche` (redirects to `/anagrafiche/fornitori`), `/anagrafiche/fornitori`, `/anagrafiche/fornitori/[id]`, `/anagrafiche/fornitori/[id]/estratto-conto`, `/anagrafiche/ingredienti`, `/anagrafiche/ubicazioni`, `/anagrafiche/importa`, `/cucina`, `/produzione`, `/produzione/nuova`, `/produzione/personale`, `/produzione/[id]`, `/produzione/[id]/etichetta`, `/magazzino`, `/magazzino/[ingredientId]`, `/magazzino/conteggi`, `/magazzino/conteggi/critici`, `/magazzino/conteggi/[id]`, `/magazzino/conteggi/[id]/scostamenti`, `/magazzino/sprechi`, `/magazzino/riconciliazione`, `/riordino`, `/riordino/ingredienti`, `/riordino/fornitori`, `/riordino/ricette`, `/ricette`, `/ricette/nuova`, `/ricette/[key]`, `/ricette/[key]/nuova-versione`, `/ricette/[key]/versioni/[version]`, `/margini`, `/margini/[key]`, `/tavoli`, `/tavoli/impostazioni`, `/tavoli/comanda`, `/tavoli/[sessionId]`, `/menu`, `/chiusura`, `/report`, `/report/mese`, `/costi`, `/costi/impostazioni`, `/costi/ingredienti`, `/costi/verifica`, `/costi/ricette/[key]`, `/registro`, `/personale`, `/dispositivi`, `/impostazioni/dati-di-prova`.
`(public)` (3): `/login`, `/pin`, `/dispositivo`.

### 2.3 What each role sees today (`tests/lib/nav/nav-model.test.ts` `EXPECTED`)

- **owner** (21): Oggi `/`, `/avvisi`, `/spingere` · Acquisti `/fatture`, `/pagamenti`, `/anagrafiche/fornitori` · Cucina `/cucina`, `/produzione`, `/magazzino`, `/riordino`, `/ricette` · Sala `/tavoli`, `/menu`, `/chiusura`, `/report` · Gestione `/costi`, `/registro`, `/personale`, `/anagrafiche/ingredienti`, `/anagrafiche/ubicazioni`, `/anagrafiche/importa`.
- **admin** (20): as the owner without `/avvisi`.
- **chef** (10): `/`, `/avvisi`, `/spingere`, `/cucina`, `/produzione`, `/magazzino`, `/riordino`, `/ricette`, `/margini`, `/anagrafiche/ingredienti`.
- **waiter** (1): `/tavoli`.

### 2.4 Missing

- No date or supplier filter on `/fatture`; no date filter on `/pagamenti`; neither list keeps its filter in the URL.
- No way to ask `/api/alerts` for fewer than 50 rows.
- No overflow tab; no `/altro`, no `/sicurezza`.

## 3. Design

### 3.1 Decisions

1. **Regroup, do not rename (ADR-030).** Every URL stays. No redirect is added (there is nothing to redirect). Step 0's guard proves every one of the 61 paths of §2.2 still has its `page.tsx`, and that the only new `(owner)` pages are `altro`, `sicurezza` (and M25a's `password` when present).
2. **Groups, sections and gates.** Order inside a group is the order below. Every gate is the one the href has today, so the per-role href sets are today's sets plus `/sicurezza` for owner and admin (asserted in step 1).

   | Group (`GroupKey`, label it / en) | Sections (href · label · gate) | owner | admin | chef | waiter |
   |---|---|---|---|---|---|
   | `home` · Home / Home | `/` · Home · staff but waiter; `/avvisi` · Avvisi · `canReadAlerts`; `/spingere` · Da spingere · `canReadPushList` | 3 | 2 | 3 | – |
   | `gestione` · Gestione / Management | `/fatture` · Fatture · `canReadInvoices`; `/pagamenti` · Pagamenti · `canReadPayables` | 2 | 2 | – | – |
   | `cucina` · Cucina / Kitchen | `/cucina` · Comande · `canReadKitchen`; `/produzione` · `canProduce`; `/magazzino` · `canReadStock`; `/riordino` · `canReadRules`; `/margini` · `canReadMargins` | 4 | 4 | 5 | – |
   | `sala` · Sala / Floor | `/tavoli` · `canUseTables`; `/menu` · `canEditMenu` | 2 | 2 | – | 1 |
   | `anagrafica` · Anagrafica / Master data | `/anagrafiche/ubicazioni` · `canEditMasterData`; `/ricette` · `canReadRecipes`; `/anagrafiche/fornitori` · `canEditMasterData`; `/anagrafiche/ingredienti` · `canReadMasterData`; `/personale` (match `/dispositivi`) · `canManageStaff`; `/anagrafiche/importa` · Importa dati · `canEditMasterData` | 6 | 6 | 2 | – |
   | `registro` · Registro / Records | `/sicurezza` · Sicurezza · `canSeeSafety` (new: owner, admin); `/costi` · `canReadCosts`; `/chiusura` · `canCloseDay`; `/report` · `canReadReports`; `/registro` · **Attività** · `canReadAudit` | 5 | 5 | – | – |

   - The founder's order is kept in Anagrafica and Registro; the unnamed screens go last (Importa dati, Attività).
   - `canSeeSafety` lives in `src/lib/safety/safety-view.ts` (`role === "owner" || role === "admin"`).
   - The audit page keeps its `h1` "Registro attività"; only its nav label changes to "Attività", so the pill never shares a name with the group tab "Registro" (Q215).
3. **Every screen → group (Q208 defaults; sub-pages follow their parent by path prefix, as today).**

   | Screen | Group > section | Named by the founder? |
   |---|---|---|
   | `/` | Home > Home | yes |
   | `/avvisi` (full list, "Tutti", test alert) | Home > Avvisi | yes (Avvisi on Home) |
   | `/spingere` | Home > Da spingere | no |
   | `/fatture`, `/fatture/[id]`, `/fatture/[id]/revisione`, `/fatture/qualita` | Gestione > Fatture | yes (sub-pages no) |
   | `/pagamenti`, `/pagamenti/[id]` (payable detail, "Cassa" actions) | Gestione > Pagamenti | yes |
   | `/cucina` (the kitchen board, "Comande") | Cucina > Comande (first, as ADR-020/M19) | no |
   | `/produzione`, `/produzione/nuova`, `/produzione/personale`, `/produzione/[id]`, `/produzione/[id]/etichetta` | Cucina > Produzione | yes |
   | `/magazzino`, `/magazzino/[ingredientId]`, `/magazzino/conteggi` (Conteggi), `/magazzino/conteggi/critici`, `/magazzino/conteggi/[id]` (focus), `/magazzino/conteggi/[id]/scostamenti`, `/magazzino/sprechi`, `/magazzino/riconciliazione` | Cucina > Magazzino | yes (Conteggi no) |
   | `/riordino`, `/riordino/ingredienti`, `/riordino/fornitori`, `/riordino/ricette` (the reorder and alert rules) | Cucina > Riordino | yes |
   | `/margini`, `/margini/[key]` (the chef's margins in %) | Cucina > Margini (chef only, as today) | no |
   | `/tavoli`, `/tavoli/impostazioni`, `/tavoli/comanda` (focus), `/tavoli/[sessionId]` (focus) | Sala > Tavoli | yes |
   | `/menu` | Sala > Menu | yes |
   | `/anagrafiche/ubicazioni` | Anagrafica > Ubicazioni | yes |
   | `/ricette`, `/ricette/nuova`, `/ricette/[key]`, `/ricette/[key]/nuova-versione`, `/ricette/[key]/versioni/[version]` | Anagrafica > Ricette | yes |
   | `/anagrafiche/fornitori`, `/anagrafiche/fornitori/[id]`, `/anagrafiche/fornitori/[id]/estratto-conto` (supplier statement), `/anagrafiche` (redirect) | Anagrafica > Fornitori | yes (statement no) |
   | `/anagrafiche/ingredienti` | Anagrafica > Ingredienti | yes |
   | `/personale`, `/dispositivi` (devices, via `match`) | Anagrafica > Personale | yes (Dispositivi no) |
   | `/anagrafiche/importa` | Anagrafica > Importa dati | no |
   | `/sicurezza` (new) | Registro > Sicurezza | yes |
   | `/costi`, `/costi/impostazioni` (cost settings), `/costi/ingredienti`, `/costi/verifica`, `/costi/ricette/[key]` | Registro > Costi | yes |
   | `/chiusura` | Registro > Chiusura | yes |
   | `/report`, `/report/mese` (monthly pack) | Registro > Report | yes |
   | `/registro` (change log) | Registro > Attività | no |
   | `/impostazioni/dati-di-prova` (demo data) | no section, as today (reached from the demo banner) | no |
   | `/altro` (new) | the "Altro" tab | — |
   | `/login`, `/pin`, `/dispositivo` (and M25a's `/password`) | outside the shell's sections, as today | — |

4. **Phone tabs (Q207 default).** `MAX_TABS = 5`. `phoneTabs(role)`:
   - `navFor(role).length ≤ 5` → one tab per group (`href` = the group's landing, its first section for the role);
   - otherwise the first four groups, then `{ key: "altro", labelKey: "nav.more", href: "/altro", groups: <the rest> }`.

   | Role | Tabs (href) | Overflow |
   |---|---|---|
   | owner, admin | Home `/` · Gestione `/fatture` · Cucina `/cucina` · Sala `/tavoli` · Altro `/altro` | Anagrafica, Registro |
   | chef | Home `/` · Cucina `/cucina` · Anagrafica `/ricette` | none |
   | waiter | (Sala `/tavoli`: one tab, so no bar, as today) | none |

   - `currentTab(role, pathname)`: the tab whose groups contain `currentGroup(role, pathname)`; `"altro"` on `/altro` when the role has an Altro tab; otherwise null.
   - `overflowGroups(role)`: the `NavGroup`s inside the Altro tab (empty for chef and waiter).
5. **`/altro`** (`src/app/(owner)/altro/page.tsx`): `h1` "Altro"; per overflow group a `section` with an `h2` (the group label) and a `LedgerList` of 44 px links (`ROW_LINK` style, label and `›`). Data: `useMe()` and the pure model only (no new endpoint). A role with no overflow sees "Tutte le sezioni sono nella barra in basso." On `/altro` no section is current, so the section row is absent and no sidebar link is current. No back link (it is a tab page, like `/fatture`).
6. **Section row, sidebar, back links, `aria-current`.**
   - **Row:** unchanged component; at most 6 pills per group for every role (asserted in step 1). In the e2e specs listed as unchanged, each pill they assert stays in a row of two or more: Ricette (Anagrafica 6, chef 2), Costi (Registro 5), Margini (chef Cucina 5), Produzione, Magazzino, Riordino and Comande (Cucina 4–5), Tavoli and Menu (Sala 2), Pagamenti (Gestione 2), Avvisi (Home 3).
   - **Sidebar:** six headed groups; the owner has 22 links (21 + Sicurezza). It gains `max-h-[calc(100dvh-1.5rem)] overflow-y-auto`, so the footer with "Esci" stays reachable on an 800 px laptop (vertical scroll inside the sidebar; no sideways scroll).
   - **`aria-current="page"`:** exactly one tab (or none outside the role's nav), one pill, one sidebar link, as today.
   - **Back links (B5):** unchanged, because no parent URL moves. On a phone, a sub-page's back link and the row's pill can share a name (e.g. `/costi/impostazioni`: back link "Costi" and pill "Costi"); e2e tells them apart by `aria-current` (the pill is current, the back link is not) and never by position.
7. **Home (Q209 default).** Order on the page:
   1. `h1` "Ciao, {nome}"; the error block when the counts read fails (as today);
   2. **Avvisi** (owner and chef only, `canReadAlerts`): `section` with `h2` "Avvisi" and the alerts badge from the existing `alerts` card (`badgeFor`); the reply of `GET /api/alerts?filter=open&limit=3` as `AlertRow`s with "Ho visto"; "Nessun avviso da vedere." when empty; a link "Tutti gli avvisi" → `/avvisi`. After "Ho visto" the strip and the counts are read again;
   3. **Andamento** (owner and admin): the compact tiles (8);
   4. the to-do actions (`todayActions`), without the owner's "Avvisi" and the chef's "Cosa preparare" (both led to `/avvisi`, now the strip);
   5. "Primi passi" until done (owner and admin);
   6. the account `Card` (venue, "Ruolo: …"), moved from the top;
   7. "Esci" (phone).
   - Requests: owner `GET /api/dashboard` + `GET /api/alerts?…`; admin `GET /api/dashboard`; chef `GET /api/today` + `GET /api/alerts?…`; waiter none (redirect to `/tavoli`). The admin never calls `/api/alerts` (403 by role, unchanged).
   - `HOME_ALERT_LIMIT = 3` in `src/server/alerts/constants.ts` (Q219).
8. **Compact tiles (Q210 default).** `Tile` gains `headline: string` and a disclosure:
   - always shown: the `h2`, the headline line, the tile's one link (e.g. "Apri pagamenti"), and a 44 px button "Dettagli" with `aria-expanded`, `aria-controls="tile-<key>-body"` and `aria-describedby` the heading;
   - the body (today's content: lists, tables, charts) is rendered only when expanded (so closed links are not in the accessibility tree). Collapsed by default on every width; the grid stays one column on a phone and `lg:grid-cols-2 xl:grid-cols-3` on a laptop;
   - `tileHeadline(key, data, locale)` in `src/lib/dashboard/dashboard-view.ts` (pure) returns the empty text (`tileEmpty`) or one template filled **only with server values**, formatted with the existing helpers (no sum, difference or ratio):

     | Tile | Headline (it) | Fields |
     |---|---|---|
     | `pushList` | "{count} da spingere entro domani" | `count` |
     | `yesterday` | "Coperti {covers} · incasso netto {revenue}" (+ " · provvisorio" when `final` is false) | `covers`, `revenueNetEur`, `final` |
     | `todayLists` | "Da preparare {prep} · da ordinare {purchase}" | `prepCount`, `purchaseCount` |
     | `plates` | "Sotto obiettivo: {name}" when `worst[0].status` is `below_target`, else "Tutti i piatti in linea" | `worst[0]` (server-ranked) |
     | `foodCost` | "Food cost medio {pct}" | `overallPct` |
     | `payables` | "Scaduti {n} · {amount} · in scadenza {m}" | `overdue.count`, `overdue.amountEur`, `dueSoon.count` |
     | `stockAtRisk` | "Sotto minimo {a} · lotti in scadenza {b} · preparazioni in scadenza {c}" | the three `count`s |
     | `waste` | "{value} di sprechi questa settimana" | `valueEur` |
     | `priceVariance` | "{count} aumenti di prezzo da vedere" | `count` |
     | `fixedCosts` | "{total} al mese" or "Non ripartiti finché non ci sono vendite." | `monthlyTotalEur`, `reason` |
     | `comingSoon` | none (renders as today; the server sends no key today) | — |

9. **Filters (Q212–Q214 defaults).**
   - **URL (page) keys, Italian like `/report`:** `dal`, `al` (ISO dates), `fornitore` (uuid); on `/pagamenti` also `stato` = `pagate` | `tutte` (absent = "Da pagare"). An invalid value in the address is ignored (the field shows empty), never sent.
   - **API keys, English like the other endpoints:** `from`, `to`, `supplier`; on payables `filter` as today.
   - **One-sided ranges work** (`dal` only, `al` only). `dal > al` → the page shows "La data di inizio è dopo la data di fine." and reads nothing; the API answers 400 for it anyway.
   - **Changing a filter** calls `router.replace` (the back button leaves the list instead of stepping through each change). **"Azzera filtri"** (44 px, shown only while a filter is set) replaces the address with the bare path: every filter, including `stato`, returns to its default in one tap.
   - **Fatture:** `invoice_date` between `from` and `to` (inclusive); `supplier` = `invoice.supplier_id`. Invoices still being read have no date and no confirmed supplier, so a date or supplier filter leaves them out; the page says so under the filters while one is set ("Le fatture ancora da leggere o da rivedere senza data o fornitore non compaiono con questi filtri.").
   - **Pagamenti:** the range applies to the date the list is ordered by: the due date for "Da pagare" and "Tutte", the payment date for "Pagate". A hint under the date fields says which ("Date di scadenza" / "Date di pagamento"). The totals line follows every filter and reads "Con questi filtri: …" while one is set.
   - **Fornitore choices:** `GET /api/suppliers` (all suppliers, active and not, in the server's order), plus "Tutti i fornitori". The choice is a `Select` labelled "Fornitore".
10. **API parsing stays strict; RLS and roles unchanged.**
    - `/api/payables`: `listQuery` gains `from: z.iso.date().optional()`, `to: z.iso.date().optional()` and a refine `from ≤ to`; repeated keys stay refused. 400 message "Filtri non validi." as today.
    - `/api/invoices`: `listInvoicesQuery` becomes `z.strictObject({ status, before, from, to, supplier: z.uuid() })` with the same refine; a repeated key → 400 (new, as payables). Owner and admin only, as today.
    - `/api/alerts`: `limit` = `^[1-9]\d?$` → 1–`ALERT_LIST_PAGE_SIZE`; outside → 400. Default 50 (unchanged replies without it).
    - No role list or RLS policy is touched (step 6 scans the migration; steps 7, 8, 12 keep the 403 cases).
11. **Implicit defaults, each tested with at least two candidates:** owner vs admin vs chef vs waiter tabs; 4 vs 6 groups (overflow or not); a page in an overflow group vs a direct group (`currentTab`); `paid` vs `unpaid` range key; `from` only vs `to` only vs both; `from > to`; a supplier of tenant B vs A; an invoice with vs without `invoice_date`; collapsed vs expanded tile; `limit` 3 with 2 vs 5 open alerts; `dal`/`al` valid vs malformed in the address.

### 3.2 Data model and SQL

**No table, view, column, index, policy or check is added.**

**`20261118100000_payable_list_range.sql`** (step 6, the only migration)
- Header comment: why (M25b, founder: date filter on Pagamenti), and that it replaces only `public.payable_list` (new signature, so `drop` + `create`; `create or replace` cannot add parameters).
- `drop function public.payable_list(text, uuid, date, uuid, integer);`
- `create function public.payable_list(p_filter text default 'unpaid', p_supplier uuid default null, p_cursor_date date default null, p_cursor_id uuid default null, p_limit integer default 50, p_from date default null, p_to date default null) returns jsonb language plpgsql stable security definer set search_path = ''`. The body is the merged body verbatim, with three additions:
  ```sql
  -- validation (added to the existing invalid_request test)
     or (p_from is not null and p_to is not null and p_from > p_to)
  -- in ranked, after the supplier filter: the range is on the list's own key date
     and (p_from is null or (case when p_filter = 'paid' then p.paid_on else p.due_date end) >= p_from)
     and (p_to   is null or (case when p_filter = 'paid' then p.paid_on else p.due_date end) <= p_to)
  -- in the unpaid totals, after the supplier filter
     and (p_from is null or p.due_date >= p_from) and (p_to is null or p.due_date <= p_to)
  ```
- `revoke all … from public, anon, service_role; grant execute … to authenticated;` restated with the new signature.
- Callers with 1, 2 or 5 positional arguments (pgTAP `071`, `180`, `205`) resolve to the new function through the defaults.
- **Pins:** `207` line 20 gets the new md5 (written into the test in step 6); `071` line 101 gets the new signature. `229`'s md5 of public function **names** is unchanged (same name).

### 3.3 Sequence of calls

1. **Owner opens the app on a phone:** `/` → `GET /api/me` → shell with tabs Home · Gestione · Cucina · Sala · Altro (Home current) → in parallel `GET /api/dashboard` and `GET /api/alerts?filter=open&limit=3` → Avvisi strip, then compact tiles.
2. **To Chiusura:** tap "Altro" → `/altro` (Altro current) → tap "Chiusura" → `/chiusura`; tab Altro current; row Registro with "Chiusura" current.
3. **Filter payables:** `/pagamenti` → `GET /api/suppliers` and `GET /api/payables?filter=unpaid` → choose "Fornitore Demo A" → `router.replace("/pagamenti?fornitore=<id>")` → `GET /api/payables?filter=unpaid&supplier=<id>` → set "Dal" → `/pagamenti?fornitore=<id>&dal=2026-11-01` → `GET /api/payables?filter=unpaid&supplier=<id>&from=2026-11-01` → `payable_list('unpaid', <id>, null, null, 50, '2026-11-01', null)` → "Azzera filtri" → `/pagamenti`.
4. **Filter invoices:** `/fatture?dal=2026-10-01&al=2026-10-31` → `GET /api/invoices?from=2026-10-01&to=2026-10-31` → RLS select with `invoice_date` between.

### 3.4 API (Zod 4; `withApi`; strict query → 400; errors `{"error":{"code","message"}}`; `Cache-Control: no-store`)

| Endpoint | Roles (unchanged) | Query | Success | Errors |
|---|---|---|---|---|
| `GET /api/payables` | owner, admin | `filter?`, `supplier?`, `before?`, **`from?`, `to?`** (ISO dates, `from ≤ to`) | unchanged shape; `totals` follow supplier and range | 400 (bad date, `from > to`, unknown or repeated key); 401; 403 chef, waiter before any RPC |
| `GET /api/invoices` | owner, admin | `status?`, `before?`, **`from?`, `to?`, `supplier?`** (uuid) | `{ invoices }` unchanged | 400 (as above; **unknown key now 400**); 401; 403 |
| `GET /api/alerts` | owner, chef | `filter?`, `before?`, `locale?`, **`limit?`** (1–50) | `{ alerts, nextCursor, canRaiseTest }`; at most `limit` rows; `nextCursor` when more | 400; 401; 403 admin, waiter |

- **Files:** `src/lib/nav/nav-model.ts`, `src/lib/safety/safety-view.ts`, `src/components/nav/{bottom-tabs,sidebar-nav}.tsx`, `src/app/(owner)/app-shell.tsx`, `src/app/(owner)/altro/page.tsx`, `src/app/(owner)/sicurezza/page.tsx`, `src/lib/filters/list-filters.ts`, `src/components/list-filters.tsx`, `src/app/(owner)/{fatture,pagamenti}/page.tsx`, `src/lib/payables/payable-view.ts`, `src/server/payables/list.ts`, `src/server/invoices/invoices.ts`, `src/server/alerts/{list,constants}.ts`, `src/components/home/home-alerts.tsx`, `src/components/use-home-alerts.ts`, `src/app/(owner)/page.tsx`, `src/lib/nav/today-actions.ts`, `src/components/dashboard/{tile,*-tile}.tsx`, `src/lib/dashboard/dashboard-view.ts`, `src/lib/i18n/messages/{it,en}.ts`.

### 3.5 Screens (Italian first, English second; 360 px first; targets ≥ 44 px; every value from `/api/*`)

- **Tab bar:** "Home", "Gestione", "Cucina", "Sala", "Altro" (en "Home", "Management", "Kitchen", "Floor", "More"); chef "Home", "Cucina", "Anagrafica". Words only, no icons.
- **`/altro`:** "Altro"; "Anagrafica" (Ubicazioni, Ricette, Fornitori, Ingredienti, Personale, Importa dati); "Registro" (Sicurezza, Costi, Chiusura, Report, Attività).
- **`/sicurezza`** (owner, admin): `h1` "Sicurezza"; one `Muted` paragraph "In arrivo: qui troverai il registro di sicurezza alimentare (HACCP)." Nothing else; no promise of sensors or dates (Q216). Chef or waiter by URL: `ErrorAlert` "Questa sezione è riservata al titolare e all'amministratore."
- **Filters (Fatture, Pagamenti):** a group "Filtri" with "Dal", "Al" (date fields, two columns from `sm`, one column at 360 px), "Fornitore" (`Select`), and "Azzera filtri" (`secondary`). Empty results: "Nessuna fattura con questi filtri." / "Nessun pagamento con questi filtri."
- **Home:** §3.1.7; compact tiles §3.1.8.
- **Wordmark label:** "Osteria Dei Rossi, Home" (en "Osteria Dei Rossi, Home").

### 3.6 Who calls what

| Object | owner | admin | chef | waiter | Enforcement |
|---|---|---|---|---|---|
| Nav links (all) | as §3.1.2 | as §3.1.2 | as §3.1.2 | `/tavoli` | UI only; each page's API and RLS unchanged |
| `/sicurezza` page | ✓ | ✓ | reserved message | reserved message | `canSeeSafety` (no data behind it) |
| `GET /api/payables?from&to` | ✓ | ✓ | 403 | 403 | `withApi` + `app.require_payables_reader()` (unchanged) |
| `public.payable_list(…, p_from, p_to)` | ✓ | ✓ | 42501 | 42501 | definer; explicit tenant filter; `anon`, `service_role` no execute |
| `GET /api/invoices?from&to&supplier` | ✓ | ✓ | 403 | 403 | `withApi` + invoice RLS (unchanged) |
| `GET /api/alerts?limit` | ✓ | 403 | ✓ (rows narrowed as today) | 403 | `withApi` + alert RLS (unchanged) |

### 3.7 Secrets and configuration

| Name | Public? | Where it lives | Used by M25b |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public by design (existing) | Vercel env | The session client of the three changed routes |
| `SUPABASE_SECRET_KEY` | **private** (existing) | Vercel env (server-only); local `.env` (gitignored); GitHub `staging` environment secret | **Not used by M25b `src/` code.** Used only by integration and e2e helpers to seed fixtures (existing pattern) |
| `CRON_SECRET`, Vault values, `PIN_PEPPER`, `ANTHROPIC_API_KEY`, `EXTRACTION_MODEL_ID`, `RESEND_API_KEY` | existing | Vercel env / Supabase Vault | **Not touched** |
| Account logins (Vercel, Supabase, GitHub) | private | The account owner's password manager, with MFA (project Q26); never in the repo or in DigiAlto-Ops | Humans only |

### 3.8 Room for M25c (Pranzo/Cena service periods)

- Default home for its settings: **Sala** (2 pills today, room for 4 more), as a new section or as a part of `/tavoli/impostazioni` (Q218). Sala is a direct tab on the phone.
- Anagrafica is at 6 pills for owner and admin; step 1's "at most 6 pills" assertion fails if a seventh is added there, so the choice cannot be made by accident.
- `phoneTabs` needs no change for a new section; a seventh group would join "Altro".

### 3.9 Coexistence with M25a and M25

**Files both M25b and M25a touch**

| File | M25a (its plan step) | M25b (step) | Rebase recipe for whichever merges second |
|---|---|---|---|
| `src/app/(owner)/page.tsx` | adds the "Imposta/Cambia password" link inside the account `Card` (13) | moves the account `Card` block, unchanged inside, to after "Primi passi" and inserts the Avvisi strip (13) | **Expected textual conflict.** Keep M25b's order and M25a's link inside the moved card. `home-today.test.ts` (both suites) and `home-dashboard.test.ts` decide |
| `tests/components/home-today.test.ts` | extends (13) | adds its cases in a new `describe("Home order (M25b)")` (13) | Hunks do not overlap; keep both |
| `tests/lib/nav/nav-model.test.ts` | adds `currentSection("owner","/password")` null (13) | rewrites the file (1) | Keep M25b's file and re-add M25a's case (still true: `/password` is in no section; step 1 already asserts it) |
| `e2e/app-shell.spec.ts` | B5 `routes` gains `["/password", "/"]`; A3 loop unchanged (17) | rewrites the nav lists and the A3 wordmark name; **does not touch `routes`** (16) | Separate hunks; keep both |
| `src/lib/i18n/messages/{it,en}.ts` | new `home.*`, `login.*`, `password.*` keys | edits only the `nav.*`/`brand.homeLink` block (it lines 46–51, 110–118) and adds `altro.*`, `safety.*`, `filters.*`, `home.alerts.*`, `dashboard.headline.*` **next to their families, not at the end of the file** | Usually clean; keep both |
| `docs/design/ui-foundation.md` | §8 M25a line (15) | §6 shell row, §8 M25b line (17) | Keep both §8 lines |
| `tests/config/m25a-preserves.test.ts` | pins `nav-model.ts` md5 at `0f1df68` and "migrations end with `20261116100000`" (0) | step 18 when M25a is merged first | **If M25b merges first, M25a's guard fails on rebase:** M25a updates both pins to the values on `main` at its rebase, on purpose, in its step 0 commit. If M25a merges first, M25b step 18 updates them |
| M25a's `/password` page | `BackLink` to `/` (13) | Home label becomes "Home" | M25a's back label should use `t("nav.today")`, so it reads "Home" after M25b; if it uses its own key, the second rebase sets it to "Home" |

- **M25 (go-live)** has the same guard (`tests/config/m25-preserves.test.ts`, its step 1). Same rule: the branch that merges second updates the pins (M25b's side is step 18).
- M25a's `/pin` redirect and `/login` changes are outside the shell. M25b's step 0 guard accepts `pin/page.tsx` as a redirect (it checks that the file exists, not what it does).
- M25a's link "Imposta una password" and its e2e `getByRole("link", { name: "Cambia password", exact: true })` keep working: the link stays in `main`, inside the moved card.

## 4. Alternatives considered

- **Six tabs on the phone:** rejected (ADR-030): under 60 px per tab at 360 px and against ADR-020's limit.
- **Registro inside Gestione on the phone:** rejected: 7 pills in one row and a phone grouping that differs from the laptop's.
- **A drawer or bottom sheet for Altro:** rejected (ADR-020): hidden links and an extra state. `/altro` is one plain page.
- **Renaming URLs (`/gestione/fatture`, `/registro/costi`):** rejected: 60 route moves, redirects for e-mailed and alert links, every e2e spec changed, no user gain.
- **Dashboard tiles moved to Report:** not the default (Q209 → V3): the owner asked to land on alerts and figures.
- **Compact tiles by CSS only (body hidden under `lg`):** rejected: hidden links stay in the accessibility tree, and one `aria-expanded` value could not be true on both widths.
- **Open alerts embedded in `/api/dashboard`:** rejected: it changes `dashboard_summary` and the pinned lists (`203`, `204`, `207`, `238`) and gives the admin a list the API refuses them today. A `limit` on `/api/alerts` reuses the existing read and its RLS.
- **Slicing the alerts list in React to three rows:** rejected: the server owns paging; `nextCursor` stays truthful.
- **Filtering payables by date in TypeScript after the RPC:** rejected: pages and totals come from SQL; filtering a page would lose rows and make totals wrong.
- **A second function `payable_list_range`:** rejected: a new public function name changes `207`, `214`, `222`, `229`, `240`; replacing the one function changes two pins.
- **Filters kept in component state:** rejected by the founder's request (persist in the URL).
- **A date-range picker library:** rejected: native `type="date"` fields already serve `/registro` and `/report`; no dependency.

## 5. Build plan (test first: each step's named test is written and seen failing, then the code; one commit per step; `tdd-guide` follows the order)

| # | Step (one commit) | Files | Test that proves it (written first, must fail first) |
|---|---|---|---|
| 0 | **Guard:** URLs stable, no dependency, the manifest, the migration list | `tests/config/m25b-preserves.test.ts` | **Routes:** each of the 61 `page.tsx` paths of §2.2 (inline list, from `0f1df68`) exists; the `(owner)` page files not in that list are a subset of `["altro/page.tsx", "sicurezza/page.tsx", "password/page.tsx"]`. **Deps:** the `dependencies` + `devDependencies` names equal the inline list of `tests/config/no-new-deps.test.ts` (imported). **Manifest:** `manifest()` has no `shortcuts` key and `start_url` is `/`. **Migrations:** the names after `20261116100000_push_menu_price_missing.sql` are a subset of `["20261118100000_payable_list_range.sql"]`. Self-test: the listing helper fails on a temp dir with an extra `20261119000000_x.sql` |
| 1 | **Nav model** | `src/lib/nav/nav-model.ts`, `src/lib/safety/safety-view.ts`, `src/lib/i18n/messages/{it,en}.ts` (nav block), `tests/lib/nav/nav-model.test.ts` (rewritten), `tests/lib/safety/safety-view.test.ts` | **`EXPECTED`** per role equals §3.1.2 exactly (owner 22 hrefs in six groups; admin the same without `/avvisi`; chef `home: ["/","/avvisi","/spingere"]`, `cucina: ["/cucina","/produzione","/magazzino","/riordino","/margini"]`, `anagrafica: ["/ricette","/anagrafiche/ingredienti"]`; waiter `sala: ["/tavoli"]`). **Never widen:** for each role, the sorted href set equals the §2.3 set (inline from `0f1df68`) plus `/sicurezza` for owner and admin only. Group order `home, gestione, cucina, sala, anagrafica, registro`; ≤ 6 groups and ≤ 6 sections per group for every role; no empty group. **`phoneTabs`:** owner and admin → `[["home","/"],["gestione","/fatture"],["cucina","/cucina"],["sala","/tavoli"],["altro","/altro"]]` with Altro groups `["anagrafica","registro"]`; chef → three tabs `home`, `cucina`, `anagrafica` (`/ricette`) and no Altro; waiter → one tab; a fake 4-group nav → no Altro (two candidates for the threshold). **`currentTab`:** owner `/chiusura`, `/anagrafiche/fornitori/x/estratto-conto`, `/dispositivi`, `/altro` → `"altro"`; `/fatture/qualita` → `"gestione"`; `/impostazioni/dati-di-prova` → null; chef `/altro` → null; chef `/ricette/x` → `"anagrafica"`. **`currentSection`:** `/report/mese` → `/report`; `/costi/impostazioni` → `/costi`; `/ricette/x/versioni/2` → `/ricette`; `/magazzino/conteggi/critici` → `/magazzino`; `/sicurezza` → `/sicurezza` (owner) and null (chef); `/` only on `/`; `/password` → null; exactly one section per path (the existing loop). **Labels:** `t("nav.today")` "Home"; `t("nav.audit")` "Attività" (en "Activity"); `t("nav.more")` "Altro" / "More"; group labels "Home", "Gestione", "Cucina", "Sala", "Anagrafica", "Registro" and their en words; no section label equals a group label for any role (so "Registro" is never both). **Kept:** the `isFocusRoute` and `landingFor` cases unchanged. **`canSeeSafety`:** true for owner and admin, false for chef, waiter and an unknown role. The i18n key-parity test stays green |
| 2 | **Bottom tabs with "Altro"; wordmark label** | `src/components/nav/bottom-tabs.tsx`, `src/app/(owner)/app-shell.tsx`, `src/lib/i18n/messages/{it,en}.ts` (`brand.homeLink`), `tests/components/app-shell.test.ts` (bar and row cases rewritten), `tests/components/me-retry.test.ts` (line 78), `tests/components/brand-link.test.ts` (line 12) | **app-shell:** owner on `/fatture` → bar links `[["Home","/"],["Gestione","/fatture"],["Cucina","/cucina"],["Sala","/tavoli"],["Altro","/altro"]]`; current `["Gestione"]`. Owner on `/chiusura` → current `["Altro"]` and the row lists `Sicurezza, Costi, Chiusura, Report, Attività` with `Chiusura` current. Owner on `/altro` → current `["Altro"]` and **no** `section-nav`. Owner on `/dispositivi` → tab `Altro`, pill `Personale`. Chef on `/` → `["Home","Cucina","Anagrafica"]`; admin → 5 tabs; waiter → no bar. Every tab `min-h-tap`; at most one `aria-current`. Owner on `/anagrafiche/ingredienti` → a row of 6 pills, each `min-h-tap`. Chef on `/anagrafiche/ingredienti` → row `Ricette, Ingredienti`. Chef shell: no `/fatture`, `/pagamenti`, `/costi`, `/anagrafiche/importa`, `/sicurezza` href and no `€`. The focus-route and placeholder cases unchanged. **me-retry:** tabs `["Home","Gestione","Cucina","Sala","Altro"]`. **brand-link:** `aria-label="Osteria Dei Rossi, Home"` |
| 3 | **`/altro`** | `src/app/(owner)/altro/page.tsx`, `src/lib/i18n/messages/{it,en}.ts` (`altro.*`), `tests/components/altro-page.test.ts` | Owner (fake `useMe`) → `h1` "Altro"; two `section`s with `h2` "Anagrafica", "Registro" in that order; the links' hrefs equal `overflowGroups("owner")` flattened (11, in model order); every link `min-h-tap`. Admin → the same 11. Chef → no `h2` and the text "Tutte le sezioni sono nella barra in basso.". Loading → no link. No `fetch` other than the mocked `/api/me` (spy). No `€`. `tests/guards/back-link.test.ts` stays green |
| 4 | **Sidebar: six groups, reachable footer** | `src/components/nav/sidebar-nav.tsx`, `tests/components/app-shell.test.ts` (sidebar cases) | Owner `h2`s `["Home","Gestione","Cucina","Sala","Anagrafica","Registro"]`; 22 links (`3 + 2 + 4 + 2 + 6 + 5`), in §3.1.2 order. Chef: `Home, Avvisi, Da spingere, Comande, Produzione, Magazzino, Riordino, Margini, Ricette, Ingredienti`. Waiter `["/tavoli"]`. The `nav` class contains `overflow-y-auto` and `max-h-[calc(100dvh-1.5rem)]`; "Esci" is still the only button. On `/altro`, no sidebar link is current |
| 5 | **`/sicurezza` placeholder** | `src/app/(owner)/sicurezza/page.tsx`, `src/lib/i18n/messages/{it,en}.ts` (`safety.*`), `tests/components/safety-page.test.ts` | Owner and admin → `h1` "Sicurezza" and the paragraph "In arrivo: qui troverai il registro di sicurezza alimentare (HACCP)."; the page has no link, button, form or digit; no `fetch` other than `/api/me`. Chef and waiter → `role="alert"` "Questa sezione è riservata al titolare e all'amministratore." The text contains no "sensor", "termometr" or "temperatur" (Q216) |
| 6 | **SQL: `payable_list` with a date range** | `supabase/migrations/20261118100000_payable_list_range.sql`, `supabase/tests/database/267_payable_list_range.test.sql`, `supabase/tests/database/207_dashboard_preserves.test.sql` (line 20 md5), `supabase/tests/database/071_payable_reads.test.sql` (line 101 signature), `tests/config/m25b-preserves.test.ts` (migration scan added) | **`267`**, fixture: tenant A with suppliers S1, S2; P1 S1 open due 2026-11-05; P2 S1 open due 2026-11-20; P3 S2 open due 2026-11-10; P4 S1 paid, due 2026-11-01, `paid_on` 2026-11-03; tenant B one open payable due 2026-11-10. As owner A: `payable_list('unpaid', null, null, null, 50, '2026-11-06', '2026-11-15')` → items `[P3]`, totals `{count:1, amount:<P3's amount>}`; `('unpaid', S1, null, null, 50, null, '2026-11-10')` → `[P1]`, totals count 1; `('paid', …, '2026-11-03', '2026-11-03')` → `[P4]`; `('paid', …, '2026-11-01', '2026-11-01')` → `[]` (paid uses `paid_on`, not `due_date`); `('all', …, '2026-11-05', null)` → ids `[P2, P3, P1]` (descending), P4 absent; only `from` and only `to` each tested. **Paging inside a range:** `('unpaid', null, null, null, 1, '2026-11-01', '2026-11-30')` → `[P1]` with a cursor; the next two pages `[P3]`, `[P2]`; the last `nextCursor` null. `'2026-11-15','2026-11-01'` → P0001 `invalid_request`. **No range:** `payable_list('unpaid')` and `payable_list('unpaid', null, null, null, 50)` resolve and are equal. Tenant B's payable never appears. Chef and waiter → 42501. **Definer:** exactly one `public.payable_list`; `pg_get_function_identity_arguments` = `p_filter text, p_supplier uuid, p_cursor_date date, p_cursor_id uuid, p_limit integer, p_from date, p_to date`; `prosecdef`; `proconfig` `{search_path=""}`; `anon`, `service_role` no execute; `authenticated` execute. **Pins:** `207` (new md5 written into line 20) and `071` (new signature) green; `180`, `203`, `204`, `205`, `214`, `222`, `229`, `238`, `240` green **unchanged**. **Config scan** (the SQL of `20261118*` without comments): exactly one `drop function` and one `create function`, both `public.payable_list`; no `create table`, `alter table`, `create policy`, `drop policy`, `create index`, `cron.schedule`, audit check or alert-kind change |
| 7 | **`/api/payables` `from`/`to`** | `src/server/payables/list.ts`, `tests/server/payables/list.test.ts`, `tests/app/api/payables/payables.test.ts` | **Parse:** `?from=2026-11-01&to=2026-11-30` → `{from:"2026-11-01", to:"2026-11-30"}`; none → both null; `from` only and `to` only pass; `from=2026-11-30&to=2026-11-01` → 400 `invalid_request` "Filtri non validi."; `from=2026-13-01`, `from=01/11/2026`, `from=2026-11-01&from=2026-11-02` → 400; none of them makes an RPC. **RPC args:** exactly `{p_filter, p_supplier, p_cursor_date, p_cursor_id, p_limit, p_from, p_to}` (the two new as `null` when absent). Chef, waiter → 403 with 0 RPCs. Existing cases green |
| 8 | **`/api/invoices` filters, strict** | `src/server/invoices/invoices.ts`, `tests/app/api/invoices/read.test.ts`; the shared fake Supabase helper **only if** it lacks `gte`/`lte` (T3) | `?supplier=<uuid>` → `eq("supplier_id", <uuid>)`; `?from=2026-10-01` → `gte("invoice_date","2026-10-01")`; `?to=2026-10-31` → `lte("invoice_date","2026-10-31")`; none → `eq`, `gte`, `lte` not called (two candidates each). `?supplier=abc`, `?from=2026-10-32`, `?from=2026-10-31&to=2026-10-01`, `?foo=1` (**now 400**), `?status=review&status=paid` → 400 `invalid_request` before `from()`. Order, cap 100, private columns and roles: existing cases green |
| 9 | **URL filter helpers (pure)** | `src/lib/filters/list-filters.ts`, `tests/lib/filters/list-filters.test.ts` | `readListFilters(new URLSearchParams("dal=2026-11-01&al=2026-11-30&fornitore=<uuid>"))` → those three; `dal=2026-11-31`, `dal=ieri`, `fornitore=abc` → null for that key; `toApiQuery({dal,al,fornitore})` → `from=…&to=…&supplier=…` (absent keys omitted); `toPageHref("/pagamenti", {fornitore:<id>}, {stato:"pagate"})` → `/pagamenti?fornitore=<id>&stato=pagate`; `hasActiveFilters` false for `{}` and true for each single key; `rangeInvalid({dal:"2026-11-02", al:"2026-11-01"})` true, equal dates false, one side null false. `readPayableStato`: `pagate` → `paid`, `tutte` → `all`, absent or `foo` → `unpaid` |
| 10 | **`ListFilters` control and `/fatture` filters** | `src/components/list-filters.tsx`, `src/app/(owner)/fatture/page.tsx`, `src/lib/i18n/messages/{it,en}.ts` (`filters.*`, `invoices.emptyFiltered`, `invoices.filterNote`), `tests/components/list-filters.test.ts`, `tests/components/invoice-list-filters.test.ts`; `tests/components/invoice-list-refresh.test.ts` and `forbidden-pages.test.ts` stay green | **list-filters:** a group named "Filtri"; "Dal", "Al" (`type="date"`, `min`/`max` linked), "Fornitore" (`Select` with "Tutti i fornitori" then the reply's names in reply order); "Azzera filtri" absent with no filter and present (≥ 44 px) with one; a change calls `onChange` with the new filters; the reset calls `onReset` once; an optional `hint` prop renders under the dates. **Fatture page** (mocked `useSearchParams`, `useRouter`, `apiJson`): address `?dal=2026-10-01&al=2026-10-31&fornitore=<id>` → exactly one `GET /api/invoices?from=2026-10-01&to=2026-10-31&supplier=<id>` and one `GET /api/suppliers`; picking another supplier → `router.replace("/fatture?dal=2026-10-01&al=2026-10-31&fornitore=<id2>")`; "Azzera filtri" → `router.replace("/fatture")`; `?dal=2026-11-02&al=2026-11-01` → the range message and **no** `/api/invoices` call; a filtered empty reply → "Nessuna fattura con questi filtri."; with a filter set, the note about invoices without date or supplier is shown, without one it is not; no filter → `GET /api/invoices` with no query (two candidates). Upload form and polling unchanged |
| 11 | **`/pagamenti` filters and `stato` in the address** | `src/app/(owner)/pagamenti/page.tsx`, `src/lib/payables/payable-view.ts` (`filteredTotalsLine`, `rangeHintKey`), `src/lib/i18n/messages/{it,en}.ts`, `tests/components/payables-filters.test.ts`, `tests/lib/payables/payable-view.test.ts` | `?stato=pagate&dal=2026-11-01` → one `GET /api/payables?filter=paid&from=2026-11-01`; the "Pagate" button has `aria-pressed="true"`; clicking "Tutte" → `router.replace("/pagamenti?dal=2026-11-01&stato=tutte")`; "Azzera filtri" → `router.replace("/pagamenti")`, after which "Da pagare" is pressed; "Mostra altri" sends the same filters plus `before`; a filtered reply's totals line starts "Con questi filtri:" and an unfiltered one does not; empty filtered → "Nessun pagamento con questi filtri."; the date hint reads "Date di pagamento" under `stato=pagate` and "Date di scadenza" under "Da pagare" and "Tutte" (`rangeHintKey` unit cases for the three values); 403 → the reserved message unchanged. No component adds money (the totals are the reply's) |
| 12 | **`/api/alerts?limit`** | `src/server/alerts/{list,constants}.ts`, `tests/app/api/alerts/alerts.test.ts` | `?filter=open&limit=3` with 5 fake rows → 3 alerts in reply order and a non-null `nextCursor`, and the query's `limit` called with 4; with 2 rows → 2 alerts and `nextCursor` null; no `limit` → `limit(51)` as today. `limit=0`, `51`, `03`, `-1`, `abc` → 400 before any query. Admin and waiter → 403 with 0 queries. `HOME_ALERT_LIMIT` = 3 |
| 13 | **Home: Avvisi first; actions; account card last** | `src/app/(owner)/page.tsx`, `src/components/home/home-alerts.tsx`, `src/components/use-home-alerts.ts`, `src/lib/nav/today-actions.ts`, `src/lib/i18n/messages/{it,en}.ts` (`home.alerts.*`), `tests/components/home-alerts.test.ts`, `tests/components/home-dashboard.test.ts`, `tests/components/home-links.test.ts`, `tests/components/home-today.test.ts` (new `describe("Home order (M25b)")`), `tests/lib/nav/today-actions.test.ts` | **Order (owner):** the `main` content in document order is `h1` → `section` "Avvisi" → `[data-dashboard]` → the action list → "Primi passi" → the account card (contains `data-testid="role"`) → "Esci". **Requests:** owner exactly one `/api/dashboard` and one `/api/alerts?filter=open&limit=3`, none to `/api/today`; admin one `/api/dashboard`, **zero** `/api/alerts`, no "Avvisi" section; chef one `/api/today` and one `/api/alerts?filter=open&limit=3`, no tiles, no `€`; waiter none. **Strip:** 3 fake alerts → 3 `AlertRow`s and a link "Tutti gli avvisi" → `/avvisi`; empty → "Nessun avviso da vedere."; the badge text equals `badgeFor`'s for the `alerts` card ("Avvisi da vedere · 4"); "Ho visto" → one `POST /api/alerts/<id>/ack`, then one more alerts read and one more counts read; an alerts 500 → one `ErrorAlert` in the strip while the tiles still render. **Actions:** `todayActions("owner")` hrefs no longer contain `/avvisi` (the others keep their order); `todayActions("chef")` neither; admin unchanged. The first-steps and demo-banner cases stay green |
| 14 | **Compact tiles** | `src/components/dashboard/tile.tsx`, `src/components/dashboard/*-tile.tsx` (pass `headline`), `src/lib/dashboard/dashboard-view.ts` (`tileHeadline`), `src/lib/i18n/messages/{it,en}.ts` (`dashboard.headline.*`), `tests/components/dashboard-tiles.test.ts`, `tests/lib/dashboard/dashboard-view.test.ts` | **tileHeadline** on the existing owner fixture: each row of §3.1.8 gives its template filled with the fixture's own fields, compared as an exact string (e.g. payables = "Scaduti " + `overdue.count` + " · " + `formatEur(overdue.amountEur)` + " · in scadenza " + `dueSoon.count`); `yesterday` with `final` false ends " · provvisorio", with `final` true it does not; `plates` with `worst[0].status` `ok` → "Tutti i piatti in linea", with `below_target` → "Sotto obiettivo: " + its name; an empty tile → its `tileEmpty` text; en strings for two keys; the admin fixture gives no headline for the owner-only keys. **Tile:** collapsed → the `h2`, the headline, the link (e.g. "Apri pagamenti" → `/pagamenti`), a button "Dettagli" with `aria-expanded="false"` and `aria-controls="tile-payables-body"`, and **no** element with that id; click → `aria-expanded="true"` and the element with that id holds today's rows; click again → collapsed. The button is `min-h-tap`. The order and the owner/admin sets of tiles unchanged; the chef/waiter `€` checks unchanged |
| 15 | **Real-stack integration** | `tests/integration/list-filters.int.ts`, `tests/integration/dashboard.int.ts` (one case) | **Filters** (two tenants; invoices approved through the existing helpers, so payables exist; dates taken from the replies, never the calendar): owner A `GET /api/invoices?supplier=<S1>` → only S1's invoices; `?from=<d>&to=<d>` with `d` an approved invoice's `invoiceDate` → that invoice included, and `to=<d − 1 day>` → excluded; `GET /api/payables?filter=all&from=<due>&to=<due>` → only payables with that `dueDate`; a `filter=paid` range on `paidOn`; owner B with A's supplier id → `{invoices:[]}` and `{payables:[]}` (200, no leak); chef A and waiter A (PIN) → 403 on both; `from > to` → 400 on both. **T1:** a supplier deactivated through the existing API still appears in owner A's `GET /api/suppliers` (no query). **dashboard.int:** `GET /api/alerts?filter=open&limit=3` → its ids equal the first `min(3, n)` ids of `?filter=open` in the same order, and `nextCursor` is non-null exactly when `n > 3` |
| 16 | **Playwright** | `e2e/app-shell.spec.ts`, `e2e/dashboard.spec.ts`, `e2e/alerts.spec.ts`, `e2e/payables.spec.ts` | **app-shell (lists rewritten):** `TABS` owner/admin `["Home","Gestione","Cucina","Sala","Altro"]`, chef `["Home","Cucina","Anagrafica"]`; `OWNER_HREFS` = the 22 of step 1 in sidebar order; `SIDEBAR_HREFS.admin` = owner without `/avvisi`; chef list as step 4; sidebar headings the six groups; A3 wordmark name "Osteria Dei Rossi, Home" (three places); "a tab opens the group's first section": tap "Gestione" → `/fatture`, row `["Fatture","Pagamenti"]`. **`ROW_HREFS`** for the owner per tab: Home `["/","/avvisi","/spingere"]`, Gestione `["/fatture","/pagamenti"]`, Cucina `["/cucina","/produzione","/magazzino","/riordino"]`, Sala `["/tavoli","/menu"]`, Altro `[]` (no row on `/altro`); chef: Home, Cucina (5), Anagrafica `["/ricette","/anagrafiche/ingredienti"]`. On the Altro tab the A9 phone loop reads `main(page).locator("section a")` hrefs, expects the 11 of step 3 in order, and opens each without a role refusal. **New test "Altro (owner, phone)":** `/` → tap the bar's "Altro" → `/altro`; `main(page).getByRole("heading", { name: "Registro", exact: true })` visible; tap `main(page).getByRole("link", { name: "Chiusura", exact: true })` → `/chiusura`; the bar's `[aria-current="page"]` has text "Altro"; `sectionRow(page).locator('[aria-current="page"]')` has text "Chiusura". Then `/costi/impostazioni`: `main(page).locator('a[aria-current="page"]', { hasText: "Costi" })` count 1 (the pill) and `main(page).locator('a:not([aria-current])', { hasText: "Costi" })` count 1 (the back link); one `page.evaluate` returns the row's and the back link's `top` and the `h1`'s, and the test asserts row < back link < `h1`. `expectPhoneFriendly` on `/altro` and `/sicurezza`. **dashboard.spec:** "Avvisi, then the tiles, then the to-dos": one `page.evaluate` returns the `top` of the `main h2` "Avvisi", of `[data-testid="dashboard-tiles"]` and of the "Primi passi" heading, asserting increasing order; tile bodies are opened first with `tile(page, key).getByRole("button", { name: "Dettagli", exact: true })`, each checked with `toHaveAttribute("aria-expanded", "true")`; the 44 px tile-link pass opens every tile first; the empty-tenant texts are read from the collapsed headlines (unchanged strings); the chef test checks `main(page).getByRole("heading", { name: "Avvisi", exact: true })` instead of the "Cosa preparare" link. **alerts.spec 164–174:** click `main(page).getByRole("link", { name: "Tutti gli avvisi", exact: true })` → `/avvisi`, pill "Avvisi" current. **payables.spec, new test "filters stay in the address":** owner with `seedApprovedPayable`; `dueDate` and `invoiceDate` from `page.request.get("/api/payables/<id>")`; `/pagamenti?stato=tutte` → pick the seeded supplier in "Fornitore" → the URL has `fornitore=<id>` and the row is visible; "Dal" = due date + 1 day (computed from the reply) → "Nessun pagamento con questi filtri."; `page.reload()` → the same search string and field values (T2); "Azzera filtri" → `pathname` `/pagamenti` with an empty search; `/fatture?fornitore=<id>&dal=<invoiceDate>&al=<invoiceDate>` → the invoice row visible; `al` = invoiceDate − 1 day → "Nessuna fattura con questi filtri.". No `.first()`/`.last()` in new code; headings by exact name inside `main`; toggles by `aria-expanded` |
| 17 | **Docs** | `docs/adr/adr-030-navigation-by-job-home-first.md` (written with this plan, proposed), `docs/adr/adr-020-app-shell-navigation.md` (status line only: "accepted (2026-10-28); to be superseded by ADR-030 (proposed)"), `docs/design/ui-foundation.md` (§6 app-shell row rewritten for six groups, Altro and the sidebar height; §8 "M25b" line for Home, compact tiles, filters, `/altro`, `/sicurezza`), `tests/config/m25b-docs.test.ts` | The ui-foundation §6 row names the six groups and "Altro" and no longer names "Acquisti"; the §8 M25b line exists; every Italian label quoted in that line in «…» (Home, Altro, Dettagli, Azzera filtri, Tutti gli avvisi, Sicurezza, Attività) equals a value in `it.ts` (parsed); ADR-020's status line mentions ADR-030 |
| 18 | **Other milestones' guard pins (only if M25 or M25a merged first)** | `tests/config/m25-preserves.test.ts`, `tests/config/m25a-preserves.test.ts` (each only if present on the rebased base) | Each present file's `nav-model.ts` md5 pin equals the md5 of M25b's `src/lib/nav/nav-model.ts` and its "last migration" pin equals `20261118100000_payable_list_range.sql`, both written into the test; the file is green; its other assertions are untouched (diff limited to those two lines). If neither file exists, the step is skipped and the PR says so |

**Requirements → proof**

| Founder request | Proved in (step) | Command |
|---|---|---|
| Home: Avvisi first, then tiles (compact strip) | 12, 13, 14, 15, 16 (dashboard.spec order) | `npm test`; `npm run test:integration`; `npx playwright test` |
| Gestione: Fatture filters date range and Fornitore | 8, 9, 10, 15, 16 | as above |
| Gestione: Pagamenti filters Fornitore and date range | 6, 7, 9, 11, 15, 16 | as above + `npx supabase test db` |
| Filters persist in the URL and clear with one tap | 9, 10, 11, 16 (reload, "Azzera filtri") | `npm test`; `npx playwright test` |
| Cucina, Sala, Anagrafica, Registro as listed; unnamed screens mapped | 1, 2, 3, 4, 16 | `npm test`; `npx playwright test` |
| Sicurezza "in arrivo" placeholder | 1, 5 | `npm test` |
| Roles unchanged; never widen | 1 ("never widen"), 2, 7, 8, 12, 13 (admin no alerts), 15 | `npm test`; `npm run test:integration` |
| ≤ 5 tabs; section row; sidebar; back links; `aria-current` | 1, 2, 3, 4, 16 | `npm test`; `npx playwright test` |
| URLs stable, no redirects needed | 0, 16 (B5 list unchanged and green) | `npm test`; `npx playwright test` |
| Coexistence with M25a and M25 | 0 (accepts `password/page.tsx`), 1 (`/password` case), 18 | `npm test` |
| Invariants: screens read `/api/*`; no data logic in React; strict parsing; RLS unchanged; no new dependency; no secret in `src/` | 0, 6 (config scan), 7, 8, 9 (pure helpers), 12, 14 (pure headline); the existing `admin-client-import`, `offline-cache-allowlist` tests | `npm test`; `npx supabase test db`; `npm run lint` |

**CI implications:**
- **Drafts:** only the cheap `checks` job runs (Vitest, lint, types, config tests: steps 0–5, 7–14, 17, 18).
- **The ready PR's heavy run:**
  - pgTAP: one new file (`267`), two pins changed (`071`, `207`);
  - integration: one new suite (`list-filters.int.ts`), one case in `dashboard.int.ts`;
  - Playwright: **no new spec file.** Added: the "Altro" test and the "filters stay in the address" test. Changed: the A9 phone loop (the Altro page's 11 links replace Gestione's 6 pills and Acquisti's 3), the dashboard order and the expand clicks. The heavy job uses about 23 of its 30 minutes today; the added time is measured in that run and reported in the PR. **No figure is promised.** If the job passes 25 minutes, the PR says so and asks before any CI change.
- **No new workflow, no new CI secret, no race case** (the one SQL change is a read).

### 5b. Variants

**V1: Registro as a direct tab** · Trigger: Q207 answered "Chiusura and Report one tap away; Sala in Altro" · Replaces steps: the `phoneTabs` and Registro-order cases of 1, the bar cases of 2, the Altro links of 3, the `TABS`/`ROW_HREFS` lists and the Altro test of 16

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | Direct groups `home, gestione, cucina, registro`; Altro holds `sala, anagrafica`; Registro order `chiusura, report, costi, registro (Attività), sicurezza`, so the tab lands on a working screen | `src/lib/nav/nav-model.ts`, `tests/lib/nav/nav-model.test.ts` | owner tabs `[["home","/"],["gestione","/fatture"],["cucina","/cucina"],["registro","/chiusura"],["altro","/altro"]]`; `currentTab("owner","/tavoli")` → `"altro"`; `currentTab("owner","/report/mese")` → `"registro"`; the never-widen sets unchanged; chef and waiter unchanged |
| V1.2 | Shell, `/altro` and e2e lists | `tests/components/{app-shell,altro-page,me-retry}.test.ts`, `e2e/app-shell.spec.ts` | bar text `["Home","Gestione","Cucina","Registro","Altro"]`; `/altro` `h2`s `["Sala","Anagrafica"]`; the e2e Altro test taps "Tavoli" and finds the bar's current tab "Altro" |

**V2: No Home tab (Home through the wordmark)** · Trigger: Q207 answered "five real groups, no Altro" · Replaces steps: the `phoneTabs` cases of 1, the bar cases of 2, step 3 (the page is not built), the Altro test of 16

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V2.1 | `phoneTabs` = the role's groups without `home`, up to 5; no Altro tab and no `/altro` page | `src/lib/nav/nav-model.ts`, `tests/lib/nav/nav-model.test.ts`, `tests/config/m25b-preserves.test.ts` (the allowed new pages drop `altro`) | owner tabs `gestione, cucina, sala, anagrafica, registro`; `currentTab("owner","/")` → null; chef `cucina, anagrafica`; the never-widen sets unchanged |
| V2.2 | Shell and e2e | `tests/components/app-shell.test.ts`, `e2e/app-shell.spec.ts` | on `/` no tab is current and the wordmark link "Osteria Dei Rossi, Home" → `/`; e2e: from `/chiusura` the wordmark returns to `/`, and the bar has 5 tabs |

**V3: Full tiles move to Report** · Trigger: Q209 answered "Home: alerts and headlines only; the full tiles in Report" · Replaces steps: the "Dettagli" disclosure of 14 and the expand clicks of 16 (adds a Report view)

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V3.1 | `/report?vista=riepilogo` renders `DashboardTiles` with full bodies from `GET /api/dashboard`; Home tiles show headline and link only, no "Dettagli" | `src/app/(owner)/report/page.tsx`, `src/components/dashboard/tile.tsx`, `tests/components/report-page.test.ts`, `tests/components/dashboard-tiles.test.ts`, `tests/lib/reports/no-money-math.test.ts` (its file list checked unchanged) | the Report view list gains "Riepilogo" (`aria-current` on it when chosen); one `/api/dashboard` read; tile bodies present; on Home no button named "Dettagli" |
| V3.2 | e2e | `e2e/dashboard.spec.ts`, `e2e/reports.spec.ts` | the seeded tile assertions run on `/report?vista=riepilogo`; Home still shows the headlines |

**V4: Tiles always open on a laptop** · Trigger: Q210 answered "compact on the phone only" · Replaces steps: the "collapsed on every width" cases of 14 and the laptop dashboard test of 16

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V4.1 | `Tile` renders the body always; under 1024 px it is shown only when expanded (`hidden` + `lg:flex`), and the "Dettagli" button is `lg:hidden` | `src/components/dashboard/tile.tsx`, `tests/components/dashboard-tiles.test.ts` | collapsed: the body element exists with classes `hidden lg:flex`; the button class contains `lg:hidden`; expanded: the body class is `flex` |
| V4.2 | Laptop e2e | `e2e/dashboard.spec.ts` | at 1280 px a payable row link in the tile is visible without a click; at 360 px it is not until "Dettagli" |

**V5: Fatture filtered by upload date** · Trigger: Q212 answered "the day I uploaded it" · Replaces steps: the `invoice_date` cases of 8, 10 and 15

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V5.1 | `from`/`to` become Europe/Rome day bounds on `created_at`: `gte(created_at, <from 00:00 Rome as UTC>)`, `lt(created_at, <to + 1 day 00:00 Rome as UTC>)`, computed on the server by `venueDayStartUtc` in `src/lib/time/venue-date.ts` | `src/lib/time/venue-date.ts`, `src/server/invoices/invoices.ts`, `tests/lib/time/venue-date.test.ts`, `tests/app/api/invoices/read.test.ts`, `src/app/(owner)/fatture/page.tsx` | `from=2026-10-25` → `gte("created_at","2026-10-24T22:00:00.000Z")` (CEST midnight); `to=2026-10-25` → `lt("created_at","2026-10-25T23:00:00.000Z")` (CET next midnight, across the DST change); `from=2026-11-04` → `2026-11-03T23:00:00.000Z`; the "without date" note of step 10 is absent |
| V5.2 | Integration | `tests/integration/list-filters.int.ts` | an upload's `createdAt` Rome date as `from=to` includes it; the day before excludes it |

**V6: Pagamenti filtered by invoice date** · Trigger: Q213 answered "the invoice's date, not the due date" · Replaces steps: the key-date cases of 6, 7, 11 (hint) and 15

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V6.1 | `public.payable_list` replaced again (`create or replace`, same signature): the range filters `i.invoice_date` for every `p_filter`, totals likewise; the paging key unchanged | `supabase/migrations/20261118101000_payable_list_invoice_date.sql`, `supabase/tests/database/268_payable_list_invoice_date.test.sql`, `207` (md5), `tests/config/m25b-preserves.test.ts` (the allowed list gains this name) | the `267` fixture plus invoice dates: a range matching only P3's invoice date → `[P3]` under `unpaid` and `all`; P4 found by invoice date under `paid`; paging inside the range as in `267`; definer checks as in `267` |
| V6.2 | Integration and UI text | `tests/integration/list-filters.int.ts`, `src/lib/payables/payable-view.ts`, `tests/lib/payables/payable-view.test.ts` | a range on `invoiceDate` from the reply includes and excludes as above; `rangeHintKey` gives "Date delle fatture" for all three `stato` values |

**V7: Keep the word "Oggi"** · Trigger: Q211 answered "Oggi" · Replaces steps: the label cases of 1, 2 and 16

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V7.1 | `nav.today` and `nav.group.home` = "Oggi" / "Today"; `brand.homeLink` = "Osteria Dei Rossi, Oggi" | `src/lib/i18n/messages/{it,en}.ts`, `tests/lib/nav/nav-model.test.ts`, `tests/components/{app-shell,me-retry,brand-link}.test.ts` | the group and section label "Oggi"; tabs `["Oggi","Gestione","Cucina","Sala","Altro"]`; the brand label "Osteria Dei Rossi, Oggi" |
| V7.2 | e2e lists | `e2e/app-shell.spec.ts` | `TABS` and the A3 name use "Oggi"; green |

**V8: "Da spingere" in Cucina** · Trigger: Q217 answered "with the kitchen" · Replaces steps: the Home and Cucina rows of 1, 2, 4 and 16

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V8.1 | `/spingere` moves to Cucina, after Comande | `src/lib/nav/nav-model.ts`, `tests/lib/nav/nav-model.test.ts`, `tests/components/app-shell.test.ts` | owner Cucina `["/cucina","/spingere","/produzione","/magazzino","/riordino"]`; chef Cucina 6 pills (≤ 6 holds); Home owner `["/","/avvisi"]`, admin `["/"]` (one section, so no row on `/` for the admin); the never-widen sets unchanged |
| V8.2 | e2e lists | `e2e/app-shell.spec.ts`, `e2e/push-forecast.spec.ts` (only if it asserts the pill's group) | `ROW_HREFS` updated; on `/spingere` the bar's current tab is "Cucina" |

**V9: Sicurezza for the chef too** · Trigger: Q216 answered "the chef will keep the HACCP register" · Replaces steps: the `canSeeSafety` and chef cases of 1, 2 and 5

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V9.1 | `canSeeSafety` adds the chef; the chef's nav gains Registro with one section | `src/lib/safety/safety-view.ts`, `tests/lib/safety/safety-view.test.ts`, `tests/lib/nav/nav-model.test.ts` | chef groups `home, cucina, anagrafica, registro`; chef Registro `["/sicurezza"]` only (no Costi, Chiusura, Report, Attività); chef tabs 4, no Altro; the chef's never-widen set allows exactly `/sicurezza` more |
| V9.2 | Shell and page | `tests/components/{app-shell,safety-page}.test.ts`, `e2e/app-shell.spec.ts` | the chef's bar `["Home","Cucina","Anagrafica","Registro"]`; `/sicurezza` shows the chef the placeholder, with no `€` |

## 6. Risks and mitigations

- **Security and privacy**
  - *Widening access by moving links:* the "never widen" assertion compares each role's href set with `0f1df68`'s (1); every gate is reused; the chef shell has no money hrefs (2); "every visible link opens" runs for every role (16). Hiding a link is still not authorisation: routes and RLS are unchanged (§3.6).
  - *Filter parameters as an IDOR path:* `supplier` is a uuid filter inside RLS (invoices) or inside the definer's explicit tenant filter (payables); another tenant's id gives an empty list, not an error that confirms it exists (15).
  - *Injection through filters:* Zod-validated dates and uuids only, passed as PostgREST and SQL parameters, never built into strings (7, 8).
  - *The replaced definer:* keeps `security definer`, `search_path = ''`, the role check first and the grants (6).
  - *Alerts on Home for the admin:* the admin's Home never calls `/api/alerts` (13); the API refuses it anyway.
  - *Personal data (GDPR):* nothing new is stored or shown. The Home strip shows the same alert texts as `/avvisi` (the chef still sees no other person's name, M6 rule). No retention change (project Q14 unchanged).
- **Correctness and usability**
  - *Two taps to Chiusura and Report for the owner on a phone:* accepted by the default (Q207).
  - *Anagrafica at 6 pills:* the step-1 bound stops a seventh by accident; M25c is planned for Sala (§3.8, Q218).
  - *Invoices without a date or supplier vanish under a filter:* the page says so while a filter is set (10; Q212).
  - *Invoice list cap (100 rows, existing):* a wide filter could hit it silently. Unchanged by M25b and noted for the founder; paging is a follow-up if the count is reached.
  - *The payables range date differs by view (due date vs payment date):* the hint under the fields says which (11).
  - *Sidebar taller than an 800 px laptop:* it scrolls inside itself (4).
  - *The compact tiles hide detail the owner used to see at once:* one tap per tile (14; Q209, Q210).
  - *One more request on Home:* it runs in parallel with the dashboard read; no figure is promised.
- **Coexistence:** the M25a and M25 guards fail for whichever branch merges second; §3.9 names each file and the recipe, and step 18 carries M25b's side.
- **Unverified (proved in the named step)**
  - **T1:** `GET /api/suppliers` without `?active=true` returns inactive suppliers too (the option exists, so the default is assumed to be all). Proved in 15. If not, steps 10 and 11 also read `?active=false` and merge nothing in React: the page shows two option groups, "Attivi" and "Non attivi", in reply order, and the step records it.
  - **T2:** `router.replace` with a search string re-renders the `useSearchParams` consumer inside `Suspense` and survives a reload (as `/report` relies on with `push`). Proved in 16 (filters, then reload).
  - **T3:** the shared fake Supabase client supports `gte`/`lte`. If not, step 8 extends it (named in its files).
- **Performance and cost:** no figure is promised. The range adds two predicates to an existing query; no index is added. No new provider, job or paid service.
- **Dependencies:** none added (0).
- **Plan changes to record in DigiAlto-Ops `clients/osteria-dei-rossi/context.md`:** ADR-030 proposed (supersedes ADR-020); the six groups and the Altro tab; filters on Fatture and Pagamenti; the `/sicurezza` placeholder as the future M31 entry; M25c settings planned under Sala.

## 7. Open questions for the founder

**Already decided and applied:** M24 Q169–Q179 (defaults); M25a Q197–Q206 (defaults; M25a not yet merged).

**Still open from earlier plans:** project Q13 and Q14 (GDPR roles and retention; M25b stores nothing new); project Q24 (which milestones move after go-live).

**New (each has a default in force for this build):**
- **Q207 How do six groups fit on the phone's bar of five?**
  - **Default:** Home · Gestione · Cucina · Sala · **Altro**; "Altro" opens a page with Anagrafica and Registro.
  - **Alternatives:** Registro as a direct tab and Sala in Altro (→ V1); no Home tab, five real groups, the logo leads home (→ V2). Registro inside Gestione on the phone was considered and not proposed (7 buttons in one row).
- **Q208 The screens you did not name** (table in §3.1.3).
  - **Default:** Comande first in Cucina; Da spingere in Home; Margini (chef) in Cucina; Conteggi, Sprechi and Riconciliazione under Magazzino; Importa dati last in Anagrafica; Dispositivi under Personale; the supplier statement under Fornitori; payable details under Pagamenti; cost settings, ingredient costs and the cost check under Costi; the monthly pack under Report; the change log as "Attività" in Registro; demo data reached from its banner only, as today. Please confirm or move any line.
- **Q209 What Home shows, in which order.**
  - **Default:** alerts (3 newest, with "Ho visto" and "Tutti gli avvisi"), the compact tiles, the to-do list without the two links to Avvisi, "Primi passi", your account card, "Esci". The admin has no alerts (as today).
  - **Alternative:** the full tiles live in Report, and Home keeps one line per tile (→ V3).
- **Q210 Compact tiles.**
  - **Default:** one line and the tile's link always visible; "Dettagli" opens the rest; closed on the phone and on the laptop.
  - **Alternative:** always open on a laptop (→ V4).
- **Q211 "Home" or "Oggi"?**
  - **Default:** "Home" for the tab, the first pill and the logo's label, as you wrote it.
  - **Alternative:** keep "Oggi" (→ V7).
- **Q212 Fatture: which date and which supplier.**
  - **Default:** the invoice's own date and its confirmed supplier. Invoices still being read are left out while a filter is set, and the page says so.
  - **Alternative:** the upload date (→ V5).
- **Q213 Pagamenti: which date.**
  - **Default:** the due date ("Da pagare", "Tutte") or the payment date ("Pagate"), the same date the list is sorted by. The totals follow the filters.
  - **Alternative:** the invoice date for every view (→ V6).
- **Q214 How filters behave.**
  - **Default:** they live in the address as `dal`, `al`, `fornitore` (and `stato` on Pagamenti); a change replaces the address, so "back" leaves the list; "Azzera filtri" resets everything, the Pagate/Tutte choice included. Please confirm; a different behaviour is a small re-plan.
- **Q215 Registro's order and the log's name.**
  - **Default:** Sicurezza, Costi, Chiusura, Report as you listed them, then "Attività" (the change log, renamed so it does not share the name "Registro" with the group). The page title stays "Registro attività". Please confirm.
- **Q216 Sicurezza.**
  - **Default:** visible to you and the admin; the page says only "In arrivo: qui troverai il registro di sicurezza alimentare (HACCP)." It does not mention sensors or temperatures: temperature logs are outside the PRD's scope today, so that is a scope decision for when M31 is planned.
  - **Alternative:** the chef sees it too (→ V9).
- **Q217 "Da spingere".**
  - **Default:** stays in Home, next to Avvisi (the Home tile links to it).
  - **Alternative:** in Cucina, after Comande (→ V8).
- **Q218 Where Pranzo/Cena settings (M25c) go.**
  - **Default:** Sala, where there is room and where the service happens. Anagrafica is full at six. Please confirm; M25c's plan decides it.
- **Q219 How many alerts on Home.**
  - **Default:** the three newest open ones, plus the count and "Tutti gli avvisi". Please confirm; another number is a one-line change.

**Assumptions (please confirm; a different answer means a re-plan, not a variant):**
- **A1:** roles stay exactly as today; the only new link is Sicurezza for you and the admin.
- **A2:** no address changes; old links, e-mails and home-screen icons keep working.

**Technical, resolved inside the build:** T1–T3 (§6).

## 8. Manual steps for the founder

- None are needed to build, test or merge M25b. Migration `20261118100000` reaches staging through the existing deploy job after merge.
- After merge, on staging, on your own phone (about ten minutes):
  1. open the app: alerts at the top, then the tiles; open one tile with "Dettagli";
  2. tap each tab, then "Altro" → "Chiusura" and back;
  3. on Pagamenti choose a supplier and a "Dal" date, refresh the page (the filter stays), then tap "Azzera filtri";
  4. tell us any screen you would move (Q208) and where the taps feel too many (Q207).
- Answer Q207–Q219 when convenient. A different answer to Q207, Q209–Q213, Q216 or Q217 triggers its variant as a follow-up PR.

## 9. Sources

- Worktree `/home/user/osteria-m25b` (`main` `0f1df68`):
  - `CLAUDE.md`, `docs/prd.md`, `docs/plans/2026-10-21-project-plan.md` (lines 45, 861, 1202), `docs/plans/2026-10-31-m24-exports.md` (structure, numbering), `docs/design/ui-foundation.md` (§6 shell row, §8), ADR-020, ADR-021;
  - `src/lib/nav/{nav-model,is-current,today-actions,facet-links}.ts`, `src/components/nav/*`, `src/app/(owner)/{app-shell,layout,page}.tsx`, `src/components/{back-link,brand}.tsx`, `src/components/dashboard/{dashboard-tiles,tile,payables-tile}.tsx`, `src/lib/dashboard/dashboard-view.ts`, `src/server/dashboard/output.ts`, `src/app/api/{alerts,dashboard,invoices,payables}/route.ts`, `src/server/alerts/{list,constants}.ts`, `src/server/invoices/invoices.ts`, `src/server/payables/{list,schemas}.ts`, `src/app/(owner)/{fatture,pagamenti,avvisi,registro,report,anagrafiche}/page.tsx`, `src/app/manifest.ts`, `src/lib/i18n/messages/{it,en}.ts`; all 61 `page.tsx` under `src/app`;
  - migration `20261024100100_payable_reads.sql`; pgTAP `071`, `176`, `180`, `196`, `205`, `207`, `229`, `239`; `tests/lib/nav/nav-model.test.ts`, `tests/components/{app-shell,me-retry,brand-link}.test.ts`, `tests/app/api/invoices/read.test.ts`, `tests/integration/dashboard.int.ts`, `tests/guards/back-link.test.ts`, `tests/app/manifest.test.ts`, `tests/config/*-preserves.test.ts`; `e2e/{app-shell,dashboard,alerts,payables}.spec.ts` and the `nav(page)` users listed in the header.
- `/home/user/osteria-m25a/docs/plans/2026-11-01-m25a-password-login.md` (steps 0, 13, 17) and `/home/user/osteria-m25/docs/plans/2026-11-01-m25-go-live.md` (step 1).
- DigiAlto-Ops `clients/osteria-dei-rossi/context.md` (no navigation decision).
- Web: none needed. M25b adds no library and relies on no new external API behaviour.
