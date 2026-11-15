# Tech plan — Osteria Digitalization · SP3 step 18, the DigiAlto console screens

- **Client slug / internal:** `osteria-dei-rossi` (tenant #1). This is an internal plan written in English. Italian strings are quoted exactly
  from `docs/ux/costi-console.md` (the "UX" below). Strings that the UX does not give are marked **(da approvare)**. Client facts used: none.
  Fixtures use only fake names ("Osteria Demo A", "Bar Demo").
- **Repo and branch:** `osteria-dei-rossi-app`, worktree `.claude/worktrees/sp3-console`. The branch is cut from `main`, stays on `main`, and
  merges `main` again once draft PR #140 lands (lead correction, 2026-11-15). One draft PR.
- **Author:** architect · **Date:** 2026-11-15
- **Contract:** SP3 plan §3.4 "API — FINAL" (builder 1's `sp3-plan.md`, not on `main` yet). The scratchpad copy of #140's `src/lib/platform/api.ts`
  is **incomplete and provisional**: it has no `/me`, `/open`, `/notified`, `/auth/password`, `/console`, `/logout`, no account-MFA replies and
  no error body, and its `prima` will change. Nothing here is locked to it. The screens import the **final** module's schemas and types
  only after #140 is on `main` (steps 13–21).
- **Inputs read:** the UX (§1–§11, C1–C9); SP3 plan §3.4–§3.8, §3.10, §3.11, §5 step 18, §5a, §8, §12; the #140 copies (`api.ts`, `codes.ts`,
  `console-band.tsx`, `sp3-preserves.test.ts`, `console-no-realtime.test.ts`); the code cited in §2; `docs/ux/costi-design-system.md` §1.

## Lead decisions (2026-11-15), built exactly as given

| # | Decision |
|---|---|
| L1 | The session switches into console mode **only** on a 409 `console_selection_required`: `POST /api/platform/console`, then reload |
| L2 | Sidebar counts: "Locali {n}" comes from the tenants read. "Avvisi {n}" comes from `GET /api/platform/me` (`unreadNotices`), and `displayName` feeds the footer. The layout's client shell reads both **once on mount**. The Avvisi count is read again after "Segna come avvisato". No polling at all (Rule A) |
| L3 | Salute is left out while `digialtoAttached` is true. When it is false, Salute shows only "DigiAlto non è collegato a questo locale." There is no "Collega DigiAlto" button (that is SP4) |
| L4 | "Entra nel locale" is **not** in this step. It is step 19, in its own PR |
| L5 | Sort is kept in the address: `?ordina=<nome\|gruppo\|attivita\|digialto>&verso=<asc\|desc>`. No param means the server order. An unknown value is ignored |
| L6 | Dates: "oggi" and "ieri" are relative to today in Europe/Rome, from the client clock. Other days show as "12 nov", with the year when it is not the current year. A null `lastActivityDate` shows "—". Instants show as "14 nov 2026, 09:40" in Europe/Rome. In the Registro, "Dal" after "Al" gives a field error "La data iniziale è dopo quella finale." and sends no request. The default range is the last 30 Europe/Rome days. The client always sends `dal` and `al`, and `al` is at most 366 days after `dal` |
| L7 | Wording, all (da approvare): "1 persona" in the singular; "Mostro {n} di {totale} locali." when filtered; a null booking slug shows "—"; the time zone shows its IANA name |
| L8 | Breakpoint: tables and the sidebar from lg (≥ 1024 px); `LedgerRow` lists and nav pills below it |
| L9 | Avvisi: "Segna come avvisato" has no date field. After it, the row shows "Avvisato il {data}". A notice whose `pending` is empty belongs on the "Letti" tab. An unknown kind shows its code. The sentence is "Nuovo sub-responsabile v{version}: {n} locali non ancora avvisati" |
| L10 | A code with no sentence (an audit action) shows the raw code. That is the UX §6.2 rule, not a fallback. The raw code always appears in small text |
| L11 | The console's code and enrolment pages use **only** `/api/auth/mfa/account*` (§3.4.3). The enrolment page reuses the venue app's wording, marked (da approvare). The venue app's `challenge-form.tsx` gains the fallback: on 403 `no_tenant` or 409 `tenant_selection_required` from `GET /api/me/mfa`, it uses the account pair |
| L12 | The root layout `src/app/layout.tsx` stays untouched. The console layout overrides `metadata.title` with "Costì · Console" and does not apply the venue layer. A test pins this: the console tree does not import `@/lib/design/venue-layer` |
| L13 | Builder 2 may add the console page list to `tests/config/sp3-preserves.test.ts` and may write the console row of `docs/ux/costi-design-system.md` §1 (C1) |
| L14 | Component tests only (Vitest + jsdom) under `tests/components/console/` and `tests/lib/console/`. The API is mocked in tests and fixtures, never in a shipping route. No e2e until a real console host exists |
| L15 | `codes.ts`, `api.ts`, `console-band.tsx` and `sp3-preserves.test.ts` belong to builder 1 (#140). Builder 2 does **not** create them |
| L16 (correction) | Do not merge #140's head branch into this branch. Merge `main` once #140 lands, then adjust the imports. Until then, build the steps that do not need `api.ts`. Test fixtures are built from §3.4's shapes and live in `tests/` only |

**Scope.** Allowed: `src/app/(platform)/console/**`, `src/components/console/**` (except `console-band.tsx`),
`src/app/(public)/login/codice/challenge-form.tsx`, `src/lib/console/**`, `src/lib/i18n/**`, `tests/components/**`, `tests/lib/console/**`, the
page-list line of `sp3-preserves`, and the design-system doc row. Forbidden: `supabase/**`, `src/server/**`, `src/app/api/**`, `src/proxy.ts`,
`src/lib/api/**`, `src/lib/supabase/**`, `src/lib/platform/**`, `public/sw.js`, `src/pwa/**`, `next.config.ts`, `.github/**`, `package.json`,
the lockfile, `src/lib/nav/nav-model.ts`.

---

## 1. Goal and scope

- **Goal:** the platform admin signs in on the console host and reads Locali, a venue's detail, the Registro della piattaforma and Avvisi. The
  screens contain no data logic, show metadata only, and are built against §3.4 with a mocked API.
- **In scope:** the console layouts and shell (band, sidebar, pills, counts, footer, "Esci"); the console sign-in, code and enrolment pages;
  Locali, the venue detail, Registro and Avvisi with the SP3 columns of SP3 plan §3.8.1; the venue app's `challenge-form.tsx` fallback; the
  `console.*` strings; the console page list in `sp3-preserves`; the design-system doc row.
- **Out of scope:** "Entra nel locale" and "Torna alla console" (step 19). Stato, Piano, Salute words, Moduli, Dati, "Nuovo locale", the
  «Solo DigiAlto» line (SP4–SP11). Any route, schema, proxy or SQL change. "Password dimenticata?" (Q-P6). E2e tests (step 23).

## 2. Current state

| What | Where | What matters here |
|---|---|---|
| Client fetch | `src/lib/api/client.ts` `apiJson` | Never throws. It already sends 403 `mfa_required` to `/login/codice?next=<visible path>` and 401 `session_expired` to `/login?errore=sessione`, unless the path starts with `/login`. It does **not** handle `unauthenticated`, `mfa_factor_required` or `console_selection_required` |
| Venue code page | `src/app/(public)/login/codice/challenge-form.tsx:50, 105` | Reads `GET /api/me/mfa` and posts `/api/auth/mfa/challenge`. It imports `LogoutButton` and `forgetUser`, and **both import `@/pwa/*`** (`logout-button.tsx:9`, `forget-user.ts:2–3`). The console cannot reuse it |
| Venue enrolment | `src/components/mfa/enrol-factor.tsx:52, 73` | The paths `/api/me/mfa/factors…` are hard-coded. `src/components/mfa/**` is outside scope, so the console builds its own (V2 if the lead widens the scope) |
| Pure MFA helpers | `src/lib/auth/mfa-view.ts` (`groupSecret`, `mfaErrorMessage`, `retryAfterSeconds`, `lockedMinutes`, `factorToUse`); `src/lib/auth/login-view.ts` (`loginNotice`, `passwordFieldType`, `toggleLabelKey`, `codeDigits`) | Reused as they are. `verifiedFactors` is typed on `MfaStatus` factors, which carry `createdAt`. §3.4.2's `MfaFactor` has none, so the console gets `accountVerifiedFactors` |
| UI kit | `src/components/ui.tsx` | `Button` (`primary`/`secondary`/`quiet`, `min-h-tap`), `Card` (`edge`), `Heading` (h1), `SubHeading` (h2), `Muted`, `ErrorAlert`, `SuccessNote`, `InfoNotice`, `Badge`, `LedgerList`, `LedgerRow`, `Field`, `TextInput`, `Select`, `linkClass`. **There is no `NavPill`, `TextLink` or table component** |
| Other components | `fact-list.tsx` (`FactList`, `FactRow`), `back-link.tsx` (`BackLink`), `segmented-control.tsx` (`SegmentedControl`, the house tabs), `page-main.tsx` (`PageMain`, the one `main`; wide via `data-layout="wide"`), `header-band.tsx` (`HeaderBand` with a `brand` and an `account` slot), `costi-theme.tsx` (`CostiTheme`), `product-logo.tsx` (`ProductLogo`), `use-hydrated.ts`, `mfa/live-error.tsx` (`LiveError`) | `EmptyState` is tied to `empty-content.ts` keys and is not used. `costi-theme-order.test.ts` forbids hand-made `<dl>`, `role="tablist"` and `font-display` on re-skinned roots: the console follows the same rule (FactList, SegmentedControl, Heading) |
| Nav | `src/components/nav/nav-classes.ts` (`sidebarLinkClass`, `pillClass`), `nav-link.tsx` (`NavLink`: full load for QR pages) | `SidebarNavView`/`SectionNavView` are bound to `NavGroup` and `LogoutButton` (pwa), so they are not reused. `account-control.tsx` provides the look of "Esci" on the band |
| Navigation helpers | `src/lib/nav/full-load.ts` (`navigateTo`, `needsFullLoad`), `src/lib/api/safe-next.ts` (`safeNextPath`), `src/lib/api/latest.ts` (`latestOnly`) | `/login/attiva-codice` is in `DATA_IMAGE_PATHS`, so `navigateTo` loads it fully (QR CSP) |
| Dates | `src/lib/time/venue-date.ts` (`venueDate`, `addDays`), `src/lib/reports/report-view.ts` (`dayAndMonth` → "28 ott"), `src/lib/time/format.ts` (`VENUE_TIME_ZONE`) | Reused |
| Product look | `src/app/(public)/login/layout.tsx` | `CostiTheme` + `ProductLogo` + `viewport.themeColor = PRODUCT_THEMES.light.band`. The console copies this pattern |
| Root layout | `src/app/layout.tsx:91–109` | title `t("app.name")`; it imports `venue-layer` for `themeColor`. Untouched (L12) |
| i18n | `src/lib/i18n/messages/{it,en}.ts`, `keys.ts` (`MessageKey = keyof typeof it`), `index.ts` (`t`, `tn` with `.one`/`.other`) | `en` must hold every key (type-checked). Today there are no `console.*` keys |
| Test style | `tests/components/challenge-form.test.ts` | `// @vitest-environment jsdom`, `createElement`, `vi.mock("@/lib/api/client")` with `calls`/`replies` maps, `vi.mock("next/navigation")`, `window.location` swapped by `defineProperty`. `vitest.config.ts`: only `tests/**/*.test.ts` run; coverage counts `src/**/*.ts` and leaves out `.tsx` |
| #140 guards | `console-no-realtime.test.ts` | Scans `src/app/(platform)` and `src/components/console` for `/realtime/i` (comments included), `.channel(`, browser clients, and direct `@/pwa/` imports. `sp3-preserves` requires that `console-band.tsx` contains no `props`, `tenant` or `venue=` |
| #140 band | `console-band.tsx` | `ConsoleBand()` takes **no arguments**, so the band has no "Esci" slot today (Q1, V1) |
| Console folders | `src/app/(platform)/`, `src/components/console/`, `src/lib/console/` | None exist on `main` |

## 3. Design

### 3.1 Files

**New**

| Path | Kind | Role |
|---|---|---|
| `src/app/(platform)/console/layout.tsx` | server | `metadata = { title: t("console.tabTitle") }`; `viewport = { themeColor: PRODUCT_THEMES.light.band }`; renders `<CostiTheme />{children}`. No venue layer |
| `src/app/(platform)/console/login/layout.tsx` | server | `<ConsoleBand />`, `<PageMain><ProductLogo />{children}</PageMain>` |
| `src/app/(platform)/console/login/page.tsx` | server | `loginNotice(searchParams.errore)` → `<ConsoleSignIn notice />` |
| `src/app/(platform)/console/login/codice/page.tsx` | server | `<Card>`, `<Heading>{t("mfa.challenge.title")}</Heading>`, `<ConsoleChallenge next />` |
| `src/app/(platform)/console/login/attiva-codice/page.tsx` | server | `<Card>`, `<Heading>{t("mfa.enrol.title")}</Heading>`, `<Muted>{t("mfa.enrol.forced")}</Muted>`, `<ConsoleEnrol next />` |
| `src/app/(platform)/console/(shell)/layout.tsx` | server | `<ConsoleShell>{children}</ConsoleShell>`. A route group keeps the shell away from the sign-in pages (Q2, V4) |
| `src/app/(platform)/console/(shell)/page.tsx` | server | `<Suspense><LocaliScreen /></Suspense>` (`useSearchParams` needs it) |
| `src/app/(platform)/console/(shell)/locali/[id]/page.tsx` | server | `const { id } = await params` → `<VenueDetail id />` |
| `src/app/(platform)/console/(shell)/registro/page.tsx` | server | `<Suspense><RegistroScreen /></Suspense>` |
| `src/app/(platform)/console/(shell)/avvisi/page.tsx` | server | `<AvvisiScreen />` |
| `src/components/console/console-shell.tsx` | client | `ConsoleShell`, `ConsoleShellContext`, `useConsoleShell()` |
| `src/components/console/console-nav.tsx` | client | `ConsoleSidebar`, `ConsolePills` |
| `src/components/console/console-logout.tsx` | client | `ConsoleLogout({ tone: "band" \| "plain" })` |
| `src/components/console/console-sign-in.tsx` | client | `ConsoleSignIn` |
| `src/components/console/console-challenge.tsx` | client | `ConsoleChallenge` |
| `src/components/console/console-enrol.tsx` | client | `ConsoleEnrol`, `ConsoleEnrolStep` |
| `src/components/console/read-error.tsx` | client | `ReadError({ message, onRetry })` = `ErrorAlert` + secondary "Riprova" |
| `src/components/console/raw-code.tsx` | server-safe | `RawCode({ code })` → `<span class="text-sm text-ink-muted">codice: {code}</span>` |
| `src/components/console/locali-screen.tsx` | client | `LocaliScreen`, `LocaliTable`, `SortHeader`, `LocaliList` |
| `src/components/console/venue-detail.tsx` | client | `VenueDetail` and its sections |
| `src/components/console/registro-screen.tsx` | client | `RegistroScreen`, `RegistroFilters`, `AuditTable`, `AuditList`, `AuditDetailPanel` |
| `src/components/console/avvisi-screen.tsx` | client | `AvvisiScreen`, `NoticeItem`, `PendingTenantRow` |
| `src/lib/console/console-api.ts` | pure + I/O injected | `consoleApi`, `isConsoleDown`, `consoleLogout` (§3.4) |
| `src/lib/console/console-dates.ts`, `locali-view.ts`, `audit-view.ts`, `notice-view.ts`, `account-mfa.ts`, `console-nav.ts` | pure | §3.3 |
| `tests/components/console/console-fixtures.ts` | test data | Built from §3.4 shapes (not a `.test.ts`, so Vitest does not collect it) |
| `tests/components/console/{console-sign-in,console-enrol,console-layout,console-shell,locali,venue-detail,registro,avvisi}.test.ts` | tests | §5 |
| `tests/lib/console/{console-messages,console-dates,locali-view,audit-view,notice-view,account-mfa,console-nav,console-api,fixtures-contract}.test.ts` | tests | §5 |

**Changed:** `src/app/(public)/login/codice/challenge-form.tsx` (fallback); `src/lib/i18n/messages/it.ts`, `en.ts`;
`tests/components/challenge-form.test.ts`; `tests/config/sp3-preserves.test.ts` (page list only); `docs/ux/costi-design-system.md`.

**Imported from #140, never created here:** `@/lib/platform/api` (types and schemas), `@/lib/platform/codes` (`PLATFORM_AUDIT_ACTIONS`,
`PLATFORM_NOTICE_KINDS`, `AuditAction`), `@/components/console/console-band` (`ConsoleBand`).

**Links use visible paths only:** `/`, `/locali/<id>`, `/registro`, `/avvisi`, `/login`, `/login/codice`, `/login/attiva-codice`. No string
`/console` appears in a link (a test in step 7 enforces this).

### 3.2 Component tree per screen

```
console/layout.tsx            CostiTheme · children
├─ login/layout.tsx           ConsoleBand · PageMain[ ProductLogo · children ]
│  ├─ login/page              ConsoleSignIn → Card edge[ Heading "Console" · p intro · (Muted login.sessionExpired) · form[ Field Email ·
│  │                          label Password + TextInput + Button quiet Mostra · ErrorAlert · Button primary "Accedi con la password" ] ]
│  ├─ login/codice/page       Card[ Heading "Codice di verifica" · ConsoleChallenge[ (p role=status "Per continuare inserisci il codice.") ·
│  │                          Muted intro · TextInput code · LiveError · Button primary Verifica · (Button quiet backup) · ConsoleLogout plain ] ]
│  └─ login/attiva-codice     Card[ Heading · Muted forced · ConsoleEnrol[ ConsoleEnrolStep[ ol(step1, step2 + img QR + key, step3 + code) ·
│                             LiveError · Button primary Attiva ] | backup offer (SubHeading · Muted · Button Aggiungi riserva · quiet Più tardi) ]
│                             · ConsoleLogout plain ]
└─ (shell)/layout.tsx         ConsoleShell (context provider)
   ├─ ConsoleBand account={<ConsoleLogout tone="band" />}           (Q1; V1 otherwise)
   ├─ PageMain[ div data-layout=wide · ConsolePills (lg:hidden) ·
   │    div.lg:flex[ ConsoleSidebar (hidden lg:flex, w-60: NavLink×3 with counts · footer: displayName · "Verifica in due passaggi attiva" ·
   │                 "Orari: ora italiana") · div.min-w-0.max-w-[1040px] children ] · p.lg:hidden "Orari: ora italiana" ]
   ├─ (shell)/page            LocaliScreen[ Heading "Locali" · (TextLink-styled Link "{n} avvisi da leggere" → /avvisi) ·
   │                          TextInput search "Cerca un locale…" · ( Muted "Caricamento…" | ReadError | empty: Muted + Button quiet "Togli i filtri" |
   │                          LocaliTable (hidden lg:block: SortHeader×4 with aria-sort; tr → one stretched Link) · LocaliList (lg:hidden: LedgerList
   │                          of LedgerRow → Link[title · meta]) · Muted "Mostro …" ) ]
   ├─ locali/[id]/page        VenueDetail[ BackLink "/" "Locali" · Heading name · Muted meta · (Muted "DigiAlto collegato") ·
   │                          div.lg:grid-cols-[minmax(0,640px)_minmax(0,360px)] in phone order (C9):
   │                          (section Salute: SubHeading · p sentence)        [lg: col 2, only when not attached]
   │                          section Utilizzo: SubHeading · FactList[ FactRow "Persone" ]                      [lg: col 2]
   │                          section Attività di DigiAlto: SubHeading · LedgerList[ LedgerRow: time · sentence · RawCode ] | Muted empty ·
   │                                  Link "Vedi tutto nel registro ›" → /registro?locale=<id>                  [lg: col 2]
   │                          section Impostazioni: SubHeading · FactList[ FactRow ×3 ]                         [lg: col 1, row 1]
   │                          ]
   ├─ registro/page           RegistroScreen[ Heading · RegistroFilters[ Field Locale Select · Field Azione Select · Field Dal date ·
   │                          Field Al date · field error p role=alert ] · ( Muted loading | ReadError | Muted empty |
   │                          AuditTable (hidden lg:table: Quando · Locale · Azione[sentence + RawCode] · Da; row = button) ·
   │                          AuditList (lg:hidden: LedgerRow button[title sentence · meta]) ) · (Button secondary "Carica altri") ·
   │                          AuditDetailPanel (lg: sticky aside beside the table; phone: replaces the list) [ SubHeading "Dettaglio" ·
   │                          FactList[ action code · when · tenantId · origin · each detail key/value ] · Button quiet "Chiudi" ] ]
   └─ avvisi/page             AvvisiScreen[ Heading "Avvisi" · SegmentedControl ["Da leggere", "Letti"] · ( loading | ReadError | Muted empty |
                              LedgerList[ NoticeItem: p sentence (or the code) · RawCode kind · Muted "creato il …" ·
                              ul PendingTenantRow[ name · Button secondary "Segna come avvisato" | Muted "Avvisato il …" · ErrorAlert ] ·
                              ul notified[ name · Muted "Avvisato il …" ] ] ) ]
```

- **One h1 per screen.** `ConsoleBand` renders a `span`, and each page has exactly one `Heading`.
- **One primary per screen.** Sign-in: "Accedi con la password". Code: "Verifica". Enrolment: "Attiva". The read screens have **no**
  primary: every action on them is secondary or quiet (UX §6.1: no primary in the detail header; C4: no actions in list rows).
- **Targets ≥ 44 px:** `Button`, `linkClass`, `sidebarLinkClass` and `pillClass` all carry `min-h-tap`. The table row link and the
  `SortHeader` buttons get `min-h-tap` too.
- **360 px:** the tables are `hidden lg:block`. Lists, filters (`grid-cols-1 sm:grid-cols-2`) and pills wrap. Names and ids carry
  `[overflow-wrap:anywhere]`.
- **Whole row is the link (C4):** in the table, the first cell holds a `Link` with `after:absolute after:inset-0` inside a `relative` row,
  so the row has one link, not one per cell. In the phone list, the `LedgerRow` content is the link.
- **Phone sort:** the list follows the address's sort but offers no sort control (the UX §5.2 phone layout has none).

### 3.3 Pure helpers (`src/lib/console/`, unit-tested, ≥ 80 % line coverage)

The helpers type their inputs with **local structural interfaces** that are copied from §3.4, so they do not depend on `api.ts`. Step 13
checks that the final types are assignable to them.

```ts
// console-dates.ts  (reuses venueDate, addDays, dayAndMonth, VENUE_TIME_ZONE)
export const EM_DASH = "—";
export function romeToday(now: Date): string;                                    // venueDate(now)
export function formatActivityDay(day: string | null, today: string, locale?: Locale): string;
//   null → "—"; day === today → "oggi"; addDays(today, -1) → "ieri"; same year → "12 nov"; else "12 nov 2025"
export function formatLongDay(dayOrInstant: string, locale?: Locale): string;   // "21 ott 2026" (an instant is converted to its Rome day first)
export function formatInstant(instant: string, locale?: Locale): string;        // "14 nov 2026, 09:40", Europe/Rome; RangeError if invalid
export function defaultRange(today: string): { dal: string; al: string };       // { dal: addDays(today, -29), al: today }
export type RangeProblem = "invalid" | "order" | "span";
export function rangeProblem(dal: string, al: string): RangeProblem | null;     // order: dal > al; span: al - dal > 366 days

// locali-view.ts
export const SORT_KEYS = ["nome", "gruppo", "attivita", "digialto"] as const;
export type SortKey = (typeof SORT_KEYS)[number]; export type SortDir = "asc" | "desc";
export interface Sort { key: SortKey; dir: SortDir }
export interface LocaliQuery { sort: Sort | null; search: string }
export interface SortableTenant { id: string; name: string; organisation: { name: string; tenantCount: number };
  members: { owner: number; admin: number; chef: number; waiter: number }; digialtoAttached: boolean; lastActivityDate: string | null }
export function parseLocaliQuery(params: URLSearchParams): LocaliQuery;   // unknown ordina → sort null; bad verso → that key's default dir; verso alone ignored; cerca trimmed
export function localiHref(query: LocaliQuery): string;                   // "/" or "/?ordina=…&verso=…&cerca=…" (cerca only when not empty)
export function nextSort(current: Sort | null, key: SortKey): Sort;      // same key → dir flipped; new key → its default (attivita: desc; others: asc)
export function ariaSort(current: Sort | null, key: SortKey): "ascending" | "descending" | "none";
export function sortTenants<T extends SortableTenant>(tenants: readonly T[], sort: Sort | null): T[];
//   null → server order (a copy); nome: localeCompare("it", base); gruppo: groupLabel, venues without a group last in both directions;
//   attivita: day string, nulls last in both directions; digialto: false < true; ties by name asc; stable; the input is never mutated
export function filterTenants<T extends SortableTenant>(tenants: readonly T[], search: string): T[]; // case- and accent-insensitive; name, or group name when shown
export function groupLabel(org: { name: string; tenantCount: number }): string | null;              // null when tenantCount === 1 (shown "—")
export function peopleCount(m: SortableTenant["members"]): number;
export function peopleMeta(m: SortableTenant["members"]): string;          // tn("console.locali.people", n): "1 persona", "4 persone"
export function shownLine(shown: number, total: number): string;           // shown === total ? "Mostro {n} locali." : "Mostro {n} di {totale} locali."
export function digialtoWord(attached: boolean): string;                   // "Sì" | "No"
export function listMeta(t: SortableTenant, today: string): string;        // phone: "4 persone · Gruppo Demo · oggi · DigiAlto: sì"
export function peopleLine(m: SortableTenant["members"], attached: boolean): string; // "1 titolare · 1 cuoco · 2 camerieri · DigiAlto"; zero roles left out; nothing → "nessuno"
export function detailMeta(t: SortableTenant & { createdAt: string }): string;      // "nessun gruppo · creato il 21 ott 2026" | "Gruppo Demo · creato il …"
export function healthSentence(attached: boolean): string | null;          // false → "DigiAlto non è collegato a questo locale."; true → null (no section)
export function tenantOptions<T extends SortableTenant>(tenants: readonly T[]): { value: string; label: string }[]; // by name, for the Registro filter

// audit-view.ts
export const AUDIT_SENTENCE_KEYS: Record<string, MessageKey>;              // the ten §3.1.3 codes → console.audit.action.<code>; step 14: `satisfies Record<AuditAction, MessageKey>`
export function auditSentence(action: string): string | null;              // null for an unknown code → the screen shows the code (L10)
export function originLabel(origin: string): string;                       // "Console" | "Script" | the raw code
export function auditPlace(row: { tenantId: string | null; tenantName: string | null }): string;
//   name; "—" for a platform-wide row; the first 8 characters of tenantId when the name is null (erased venue, SP10 adds "Locale cancellato")
export function auditDetailEntries(detail: Record<string, string | number | boolean | null>): [string, string][]; // keys sorted; null → "—"
export interface RegistroQuery { dal: string; al: string; locale: string | null; azione: string | null }
export function parseRegistroQuery(params: URLSearchParams, today: string, knownActions: readonly string[]): RegistroQuery;
//   missing or invalid dal/al, or a bad range → defaultRange(today); non-uuid locale → null; azione not in knownActions → null
export function registroHref(q: RegistroQuery, today: string): string;    // dal/al left out when they equal the default
export function auditRequestPath(q: RegistroQuery, prima: number | null): string; // "/api/platform/audit?dal=…&al=…[&locale][&azione][&prima]"; dal and al always
export function auditListMeta(row: { at: string; tenantId: string | null; tenantName: string | null; origin: string }): string;
//   "14 nov 2026, 09:40 · Osteria Demo A · Console"

// notice-view.ts
export function noticeSentence(n: { kind: string; version: number; pending: readonly unknown[] }): string | null;
//   subprocessor: n=1 "Nuovo sub-responsabile v3: 1 locale non ancora avvisato"; n>1 "…: {n} locali non ancora avvisati";
//   n=0 "Nuovo sub-responsabile v3: tutti i locali avvisati" (da approvare); unknown kind → null
export function splitNotices<T extends { pending: readonly unknown[] }>(notices: readonly T[]): { unread: T[]; read: T[] }; // order kept
export function notifiedLine(instant: string): string;                     // "Avvisato il 14 nov 2026, 09:40"

// account-mfa.ts  (used by the console code page and the venue fallback)
export interface AccountFactor { id: string; slot: "principale" | "riserva" | "altro"; status: "verified" | "unverified" }
export interface AccountMfaStatus { factors: AccountFactor[]; currentLevel: "aal1" | "aal2"; canAddFactor: boolean; lockedUntil: string | null }
export function accountVerifiedFactors(factors: readonly AccountFactor[]): AccountFactor[]; // verified only; principale, riserva, altro
export function accountGate(s: AccountMfaStatus): "ok" | "challenge" | "enrol";             // aal2 → ok; no verified factor → enrol; else challenge
export function usesAccountFallback(r: { status: number; error: { code: string } }): boolean; // 403 no_tenant or 409 tenant_selection_required only

// console-nav.ts
export type ConsoleSection = "locali" | "registro" | "avvisi";
export const CONSOLE_SECTIONS: readonly { key: ConsoleSection; href: "/" | "/registro" | "/avvisi"; labelKey: MessageKey }[];
export function currentSection(pathname: string): ConsoleSection | null;   // "/" and "/locali/…" → locali; "/registro…"; "/avvisi…"; else null
export function venueHref(id: string): string;                             // "/locali/<id>"
```

### 3.4 The console fetch wrapper (`src/lib/console/console-api.ts`)

```ts
export interface ConsoleEnv {
  fetchImpl: typeof fetch;
  location: Pick<Location, "pathname" | "search" | "assign" | "reload" | "replace">;
  session: Pick<Storage, "getItem" | "setItem" | "removeItem">;     // sessionStorage; holds only SWITCH_KEY = "1"
}
export type ConsoleFailure = { ok: false; status: number; error: ApiErrorBody; leaving: boolean };
export type ConsoleResult<T> = { ok: true; status: number; data: T } | ConsoleFailure;
export function consoleApi<T>(path: `/api/platform/${string}`, options?: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal },
  env?: Partial<ConsoleEnv>): Promise<ConsoleResult<T>>;
export function isConsoleDown(f: ConsoleFailure): boolean;   // status 0 (network), 500, 502, 503, or code bad_response
export function consoleLogout(env?: Partial<ConsoleEnv>): Promise<ConsoleFailure | null>;
```

The wrapper calls `apiJson` (imported, not changed) and then acts on the reply:

| Reply | Action | `leaving` |
|---|---|---|
| 2xx | clears `SWITCH_KEY`; returns the data | — |
| 409 `console_selection_required`, `SWITCH_KEY` not set | **single flight** (one module-level promise per document): sets `SWITCH_KEY`, `POST /api/platform/console {}`; 200 → `location.reload()` | true |
| 409 `console_selection_required`, `SWITCH_KEY` already set (a reload did not help) | no POST. Returns `{ code: "console_unavailable", message: t("console.unavailable") }`, which reports the failure and stops a reload loop | false |
| POST `/console` answers 503 `console_switch_failed` or a network error | returns that failure (`isConsoleDown` → "La console non risponde. Riprova tra poco.") | false |
| 403 `mfa_required` (a read, or the POST) | `apiJson` has already sent the browser to `/login/codice?next=…` | true |
| 403 `mfa_factor_required` | `location.assign("/login/attiva-codice?next=" + encodeURIComponent(path + search))` (full load: QR CSP) | true |
| 401 `unauthenticated` | `location.assign("/login?next=…")` | true |
| 401 `session_expired` | `apiJson` → `/login?errore=sessione` | true |
| 403 `forbidden` | returned; the screen shows "Questo account non ha accesso alla console." | false |
| any other | returned as is | false |

While `leaving` is true a screen keeps "Caricamento…" and never flashes an error. `consoleLogout` posts `/api/platform/logout {}`. On 200 it
calls `location.replace("/login")`. On a network or 5xx failure it returns the failure, and the button shows "La console non risponde.
Riprova tra poco.": the screen reports the failure and does not pretend the logout happened (Rule B). The route itself always answers 200
once the cookie is cleared.

**The shell context** (`ConsoleShell`) holds `{ tenants: Load<TenantSummary[]>, me: Load<{ displayName; unreadNotices }>, retryTenants(),
refreshMe() }`, where `Load<T> = { kind: "loading" } | { kind: "error"; down: boolean } | { kind: "ready"; data: T }`. The shell reads each
endpoint once on mount. `LocaliScreen` and the Registro's Locale filter use `tenants` from the context, so the home page does not read the
list twice. `AvvisiScreen` calls `refreshMe()` after a successful mark. There are no timers and no `visibilitychange` listener.

### 3.5 Flows

- **Sign-in:** `/login` → `POST /api/platform/auth/password { email, password }` → `navigateTo(router, safeNextPath(redirect))`. The
  `/login/codice` page → `GET /api/auth/mfa/account` → `accountGate` → `POST /api/auth/mfa/account { factorId, code, next }` → redirect (`/`).
  On a first sign-in `/login/attiva-codice` loads fully → `POST /api/auth/mfa/account/factors { slot: "principale" }` → QR and setup key →
  `POST …/factors/<id>/verify { code }` → backup offer ("riserva", at `aal2`) → `location.assign(safeNextPath(next))`.
- **First console read:** the shell's `GET /api/platform/me` and `GET /api/platform/tenants` → 409 → one `POST /api/platform/console` →
  reload → 200.
- **Status line:** `/login/codice` shows "Per continuare inserisci il codice." **only when `next` is present**. The console password route takes
  no `next` (§3.4.4), so `next` is present only after a 403 `mfa_required` redirect from a console page (UX §4).
- **Venue fallback (L11):** `GET /api/me/mfa`. When `usesAccountFallback(result)` is true → `GET /api/auth/mfa/account` → `accountGate`. `ok`
  → `navigateTo(next)`. `challenge` → the same form, posting `POST /api/auth/mfa/account`. `enrol` → `LiveError` "Attiva prima la verifica in
  due passaggi dalla console." (da approvare) + Esci. A 403 `forbidden` from the account route → its message + Esci. Any other error from
  `/api/me/mfa` behaves as today (the fallback is used only for these two codes).

### 3.6 i18n keys (`it.ts`; `en.ts` gets the same keys in English)

Reused without change: `app.name`, `home.logout` ("Esci"), `common.loading`, `common.retry`, `login.email`, `login.password`, `login.show`,
`login.hide`, `login.passwordSubmit`, `login.sessionExpired`, `mfa.*` (the code and enrolment pages: venue wording, (da approvare) for the
console, L11), `authError.mfa_*`.

| Key | it | UX source / status |
|---|---|---|
| `console.tabTitle` | Costì · Console | §4.1 |
| `console.nav.label` / `.locali` / `.registro` / `.avvisi` | Console / Locali / Registro / Avvisi | §3 |
| `console.footer.mfa` / `.times` | Verifica in due passaggi attiva / Orari: ora italiana | §3 |
| `console.unavailable` | La console non risponde. Riprova tra poco. | §4 |
| `console.noAccess` | Questo account non ha accesso alla console. | §4 |
| `console.signIn.title` / `.intro` | Console / Accesso riservato a DigiAlto. | §4 |
| `console.code.continue` | Per continuare inserisci il codice. | §4 |
| `console.day.today` / `.yesterday` | oggi / ieri | L6 |
| `console.yes` / `console.no` | Sì / No | §5.1 |
| `console.locali.title` / `.search` | Locali / Cerca un locale… | §5 |
| `console.locali.col.name` / `.group` / `.activity` / `.digialto` | Locale / Gruppo / Ultima attività / DigiAlto | §5 |
| `console.locali.people.one` / `.other` | {count} persona / {count} persone | L7 (da approvare) |
| `console.locali.shown.one` / `.other` | Mostro {count} locale. / Mostro {count} locali. | §5.1 |
| `console.locali.shownOf` | Mostro {n} di {totale} locali. | L7 (da approvare) |
| `console.locali.noMatch` / `.clearFilters` | Nessun locale con questi filtri. / Togli i filtri | §5.1 |
| `console.locali.readError` | Non riesco a leggere i locali. | §5.4 |
| `console.locali.unread.one` / `.other` | {count} avviso da leggere / {count} avvisi da leggere | §5.1 |
| `console.locali.digialtoMeta.yes` / `.no` | DigiAlto: sì / DigiAlto: no | §5.2 |
| `console.detail.back` | Locali | §6.1 |
| `console.detail.noGroup` / `console.createdOn` / `console.detail.attached` | nessun gruppo / creato il {date} / DigiAlto collegato | §6.1 |
| `console.detail.health.title` / `.notAttached` | Salute / DigiAlto non è collegato a questo locale. | §6.2, L3 |
| `console.detail.usage.title` / `.people` / `.digialto` / `.nobody` | Utilizzo / Persone / DigiAlto / nessuno | §6.5; `nobody` (da approvare) |
| `console.role.owner.one`/`.other`, `.admin.one`/`.other`, `.chef.one`/`.other`, `.waiter.one`/`.other` | {count} titolare/titolari, {count} admin/admin, {count} cuoco/cuochi, {count} cameriere/camerieri | §6.5 (plurals da approvare) |
| `console.detail.activity.title` / `.all` / `.empty` | Attività di DigiAlto / Vedi tutto nel registro › / Nessuna attività di DigiAlto. | §6.6; `empty` (da approvare) |
| `console.detail.settings.title` / `.name` / `.timeZone` / `.bookingSlug` | Impostazioni / Nome del locale / Fuso orario / Pagina prenotazioni | §6.7 (labels da approvare) |
| `console.detail.notFound` / `.readError` | Locale non trovato. / Non riesco a leggere il locale. | (da approvare) |
| `console.audit.title` | Registro della piattaforma | §7 |
| `console.audit.filter.locale` / `.allLocali` / `.action` / `.allActions` / `.from` / `.to` | Locale / Tutti / Azione / Tutte / Dal / Al | §7 |
| `console.audit.rangeOrder` / `.rangeSpan` | La data iniziale è dopo quella finale. / Il periodo può durare al massimo 366 giorni. | L6; `rangeSpan` (da approvare) |
| `console.audit.col.when` / `.place` / `.action` / `.origin` | Quando / Locale / Azione / Da | §7 |
| `console.audit.origin.console` / `.script` | Console / Script | §7, C7 |
| `console.audit.more` / `.empty` / `.readError` | Carica altri / Nessuna azione in questo periodo. / Non riesco a leggere il registro. | §7; `readError` (da approvare) |
| `console.audit.detail.title` / `.close` / `console.rawCode` | Dettaglio / Chiudi / codice: {code} | §6.2 "codice: …"; the others (da approvare) |
| `console.audit.action.platform_admin.bootstrapped` | Account DigiAlto creato | (da approvare) |
| `….platform_admin.factor_enrolled` | Verifica in due passaggi attivata | (da approvare) |
| `….console.entered` / `….console.left` | Accesso alla console / Uscita dalla console | §7 / (da approvare) |
| `….console.tenant_opened` | Locale aperto dalla console | (da approvare) |
| `….notice.created` / `….notice.tenant_notified` | Nuovo avviso / Locale avvisato | (da approvare) |
| `….script.create_tenant` | Locale creato con lo script | (da approvare) |
| `….script.mfa_reset` | Reset del secondo fattore (disconnessione da tutti i locali) | SP3 plan §3.9.3 (da approvare) |
| `….script.set_mfa_enforcement` | Obbligo della verifica cambiato con lo script | (da approvare) |
| `console.notices.title` / `.tab.unread` / `.tab.read` | Avvisi / Da leggere / Letti | §8 |
| `console.notices.subprocessor.one` / `.other` / `.done` | Nuovo sub-responsabile v{version}: {count} locale non ancora avvisato / …: {count} locali non ancora avvisati / Nuovo sub-responsabile v{version}: tutti i locali avvisati | L9; `.one`, `.done` (da approvare) |
| `console.notices.mark` / `.notified` | Segna come avvisato / Avvisato il {date} | L9 |
| `console.notices.emptyUnread` / `.emptyRead` / `.readError` | Nessun avviso da leggere. / Nessun avviso letto. / Non riesco a leggere gli avvisi. | (da approvare) |
| `mfa.account.noFactor` | Attiva prima la verifica in due passaggi dalla console. | venue fallback (da approvare) |

`console.notices.subprocessor.*` needs `{version}` too, so `noticeSentence` picks the `.one`/`.other` key itself and calls `t` with
`{ count, version }` (`tn` fills `{count}` only).

### 3.7 Security and privacy

- **Secrets:** none are added, read or shown. The screens call only same-origin `/api/*`. The Supabase keys, `CONSOLE_HOST` and `APP_ORIGIN`
  stay server-side (Vercel env, builder 1's steps). The browser has no Supabase client (guarded by #140's `console-no-realtime`).
- **Personal data (GDPR, EU client):** the e-mail address and password exist only in the uncontrolled inputs and the POST body. They are never
  in state, storage, the URL or logs, and the password is cleared after each error. The TOTP setup key and QR stay only in component state,
  are never written to storage, the URL or the console, and are gone on unmount. `sessionStorage` holds only `SWITCH_KEY = "1"`. The screens
  render tenant names, organisation names, counts, dates, codes and ids (UX §9). `displayName` is the `platform.staff.display_name`
  (default "DigiAlto"), see R5.
- **Redirects:** `next` and every `redirect` from the server pass through `safeNextPath`. `qrImage` is used only as an `img src`.
- **Auth and roles:** enforced in Postgres and `withApi` (builder 1). The screens branch on `error.code` only and never decide access.
- **No Realtime, no service worker:** the console tree imports nothing from `@/pwa/*`, directly or through another module. That rules out
  `LogoutButton`, `forgetUser` and `PasswordForm`. Step 15 tests it.

## 4. Alternatives considered

- **Reuse `ChallengeForm`, `PasswordForm` and `EnrolFactor` with props for the paths:** less code; but the first two pull in `@/pwa/*` through
  `LogoutButton` and `forgetUser`, which the console must not load, and `src/components/mfa/**` is outside scope. Rejected; V2 covers the
  enrolment if the lead widens the scope.
- **Put the 409/`mfa_factor_required` handling into `apiJson`:** one client; but `src/lib/api/**` is forbidden, and the venue app must never
  switch into console mode. Rejected for `src/lib/console/console-api.ts`.
- **Each screen reads `/api/platform/tenants` itself:** simpler components; but Locali would read the list twice on arrival, once for the
  sidebar count and once for the table. Rejected for the shell context.
- **Re-read `GET /api/platform/notices` after "Segna come avvisato":** always fresh; but the notice could jump to "Letti" under the person's
  thumb, and L9 says the row shows "Avvisato il {data}". Rejected: the row keeps the reply's `notifiedAt`.
- **One `console/layout.tsx` that hides the shell on `/login*` by pathname:** keeps the page paths exactly as SP3 plan §5 step 18 lists them; but
  the layout would branch on the URL. Rejected as the base; it is V4.
- **Parse every reply with the Zod schemas in the screens:** stronger; but the server already parses its output with the same schemas (§3.4.1),
  and a strict client parse would turn a new audit code into a blank page instead of L10's raw code. Rejected: the fixtures are parsed instead
  (step 13).

## 5. Build plan

Rules: test first (write the named test and see it fail for the stated reason). One commit per step. Each step ends with `npm run lint`,
`npx tsc --noEmit` and `npm test` green. Component tests mock `@/lib/api/client`'s `apiJson` as `tests/components/challenge-form.test.ts`
does, so `consoleApi` runs for real inside them.

**Gate "now":** buildable on `main` before #140 is on it. **Gate "#140":** after `main` contains #140 and has been merged into this branch.

| # | Step (one commit) | Gate | Files | Test that proves it (the first one fails first) |
|---|---|---|---|---|
| 1 | `console.*` strings and `mfa.account.noFactor` (§3.6) | now | `it.ts`, `en.ts`; `tests/lib/console/console-messages.test.ts` | **First: "`t('console.signIn.intro')` is «Accesso riservato a DigiAlto.»"** (fails: key missing). Then: every UX-quoted value in §3.6 verbatim; the ten `console.audit.action.*` keys exist; every plural has `.one` and `.other`; `en` has each key (tsc); no value contains `@` |
| 2 | Dates (§3.3 `console-dates.ts`) | now | `src/lib/console/console-dates.ts`; `tests/lib/console/console-dates.test.ts` | **First: "`formatActivityDay('2026-11-15', '2026-11-15')` is «oggi»"** (fails: module missing). Then: «ieri»; «ieri» across New Year (`2025-12-31` / `2026-01-01`); «12 nov»; «12 nov 2025»; null → «—»; `formatInstant('2026-11-14T08:40:00Z')` → «14 nov 2026, 09:40»; summer time `2026-07-01T07:40:00Z` → «1 lug 2026, 09:40»; an invalid instant → RangeError; `romeToday(2026-11-14T23:30Z)` → `2026-11-15`; `defaultRange('2026-11-15')` → `{dal: '2026-10-17', al: '2026-11-15'}`; `rangeProblem`: dal > al → `order`, 366 days → null, 367 → `span`, `2026-02-30` → `invalid`; `formatLongDay` of a day and of an instant |
| 3 | Locali helpers (§3.3 `locali-view.ts`) | now | `src/lib/console/locali-view.ts`; `tests/lib/console/locali-view.test.ts` | **First: "`parseLocaliQuery('ordina=nome&verso=desc')` is `{sort: {key: 'nome', dir: 'desc'}, search: ''}`"** (fails: module missing). Then: no param → `sort: null`; unknown `ordina` → null; bad `verso` → the key's default; `verso` alone ignored; `localiHref` round trip; `nextSort` flip and defaults (attivita → desc); `ariaSort`; `sortTenants` for each key, both directions, nulls and no-group last both ways, ties by name, stable, input not mutated, null → server order; `filterTenants` case- and accent-insensitive on name and on a shown group name only; `groupLabel`; `peopleMeta` «1 persona» / «4 persone» / «0 persone»; `shownLine` both forms; `digialtoWord`; `listMeta`; `peopleLine` with zero roles left out, «DigiAlto», «nessuno»; `detailMeta` both forms; `healthSentence`; `tenantOptions` by name |
| 4 | Audit helpers (§3.3 `audit-view.ts`) with the ten codes of SP3 plan §3.1.3 | now | `src/lib/console/audit-view.ts`; `tests/lib/console/audit-view.test.ts` | **First: "`auditSentence('console.entered')` is «Accesso alla console»"** (fails: module missing). Then: each of the ten codes has a sentence; an unknown code → null; `originLabel` console/script/raw; `auditPlace` name / «—» / 8-character id; `auditDetailEntries` sorted, null → «—»; `auditRequestPath` always has `dal` and `al` and adds only the set filters, `prima` as an integer; `parseRegistroQuery` defaults for missing, invalid or out-of-range dates, a non-uuid `locale` → null, an unknown `azione` → null; `registroHref` leaves out default dates; `auditListMeta` «14 nov 2026, 09:40 · Osteria Demo A · Console» |
| 5 | Notice helpers (§3.3 `notice-view.ts`) | now | `src/lib/console/notice-view.ts`; `tests/lib/console/notice-view.test.ts` | **First: "`noticeSentence({kind: 'subprocessor', version: 3, pending: [a, b]})` is «Nuovo sub-responsabile v3: 2 locali non ancora avvisati»"** (fails: module missing). Then: one pending → singular; none → the `done` sentence; an unknown kind → null; `splitNotices` by empty `pending`, order kept; `notifiedLine` |
| 6 | Account MFA helpers (§3.3 `account-mfa.ts`) | now | `src/lib/console/account-mfa.ts`; `tests/lib/console/account-mfa.test.ts` | **First: "`accountGate` with `currentLevel: 'aal2'` is `ok`"** (fails: module missing). Then: no verified factor → `enrol`; verified at aal1 → `challenge`; `accountVerifiedFactors` order, unverified dropped; `usesAccountFallback` true for 403 `no_tenant` and 409 `tenant_selection_required`, false for 403 `forbidden`, 403 `mfa_required`, 409 `console_selection_required`, 401, 500 |
| 7 | Console nav helpers (§3.3 `console-nav.ts`) | now | `src/lib/console/console-nav.ts`; `tests/lib/console/console-nav.test.ts` | **First: "`currentSection('/locali/<uuid>')` is `locali`"** (fails: module missing). Then: `/` → locali, `/registro` and `/registro?x` → registro, `/avvisi` → avvisi, `/login` → null; `CONSOLE_SECTIONS` order and hrefs; `venueHref`; **no `href` in `src/lib/console/**` or `src/components/console/**` starts with `/console`** (source scan) |
| 8 | Console fetch wrapper (§3.4) | now | `src/lib/console/console-api.ts`; `tests/lib/console/console-api.test.ts` | **First: "a 409 `console_selection_required` posts `{}` to `/api/platform/console` once, then reloads, and returns `leaving: true`"** (fails: module missing). Then: two parallel 409s → one POST and one reload; with `SWITCH_KEY` set, a 409 makes no POST and returns `console_unavailable` with «La console non risponde. Riprova tra poco.»; a 2xx clears the key; the POST answering 503 `console_switch_failed` → failure, `isConsoleDown`, no reload; the POST or a read answering 403 `mfa_factor_required` → `assign('/login/attiva-codice?next=%2Fregistro%3Fdal%3D…')`; 401 `unauthenticated` → `assign('/login?next=…')`; 403 `mfa_required` → `leaving: true` and no navigation of its own; 403 `forbidden` and 404 `tenant_not_found` → plain failure, no navigation; status 0 → `isConsoleDown`; GET sends no body, POST sends JSON; `consoleLogout` posts `/api/platform/logout` then `replace('/login')`, and on a network failure returns it without navigating; the only storage write is `SWITCH_KEY` = `"1"` |
| 9 | Venue code page fallback (§3.5, L11) | now | `src/app/(public)/login/codice/challenge-form.tsx`; `tests/components/challenge-form.test.ts` | **First (new case): "a 403 `no_tenant` from `GET /api/me/mfa` reads `GET /api/auth/mfa/account` and shows the code field"** (fails: shows the error). Then: 409 `tenant_selection_required` likewise; the code goes to `POST /api/auth/mfa/account` with `{factorId, code, next}` and the reply's redirect is followed; account `aal2` → straight to `next`; no verified factor → «Attiva prima la verifica in due passaggi dalla console.» + Esci; account 403 `forbidden` → its message + Esci; account lock and backup switch work as in the tenant path; 401, 403 `mfa_required` and 500 from `/api/me/mfa` → no account call (exactly one call); **every existing case unchanged** |
| 10 | Console sign-in: `ConsoleSignIn` and `login/page.tsx` | now | `src/components/console/console-sign-in.tsx`; `src/app/(platform)/console/login/page.tsx`; `tests/components/console/console-sign-in.test.ts` | **First: "the page shows one h1 «Console», «Accesso riservato a DigiAlto.», Email, Password, «Mostra» and the primary «Accedi con la password»"** (fails: module missing). Then: posts exactly `{email, password}` (no `next`) to `/api/platform/auth/password`; a `/login/codice` redirect → `router.replace`; a `/login/attiva-codice` redirect → `location.assign` (full load); 403 `not_console_account` → «Questo account non ha accesso alla console.»; 401 `login_invalid` and 429 → the server message, password cleared; 502 and network → «La console non risponde. Riprova tra poco.»; `errore=sessione` → the session line; no PIN, «Chi sei?», `/dispositivo` link or «Password dimenticata?»; submit disabled until hydrated; nothing written to storage or the address; buttons `min-h-tap` |
| 11 | Console code page: `ConsoleChallenge` and `login/codice/page.tsx` | now | `src/components/console/console-challenge.tsx`, `console-logout.tsx`, `read-error.tsx`; `src/app/(platform)/console/login/codice/page.tsx`; `tests/components/console/console-sign-in.test.ts` (describe "code page") | **First: "it reads `GET /api/auth/mfa/account` and never `/api/me/mfa`"** (fails: module missing). Then: the code goes to `POST /api/auth/mfa/account`; «Per continuare inserisci il codice.» only when `next` is present; `aal2` → `next`; no verified factor → `assign('/login/attiva-codice?next=…')`; wrong code, expired code, lock with minutes, rate limit; backup switch; 403 `forbidden` → «Questo account non ha accesso alla console.» + Esci; Esci posts `/api/platform/logout` (not `/api/auth/logout`) and goes to `/login`; a failing logout shows «La console non risponde…»; one h1 |
| 12 | Console enrolment: `ConsoleEnrol` and `login/attiva-codice/page.tsx` | now | `src/components/console/console-enrol.tsx`; `src/app/(platform)/console/login/attiva-codice/page.tsx`; `tests/components/console/console-enrol.test.ts` | **First: "mounting posts `{slot: 'principale'}` to `/api/auth/mfa/account/factors` exactly once, also under StrictMode"** (fails: module missing). Then: QR `img` and the grouped setup key; the code goes to `…/factors/<id>/verify`; wrong code; 429 `mfa_locked`; 409 `mfa_slot_taken` → message + «Riprova»; after verify the backup offer: «Aggiungi riserva» posts `{slot: 'riserva'}`, «Più tardi» → `assign(safeNextPath(next))`; no call to `/api/me/mfa*`; the key is not in storage, the URL or `console.*` output (spies) and is gone after unmount; the heading and steps are the venue wording |
| 13 | Merge `main` (with #140); fixtures and contract; local types aligned | #140 | `tests/components/console/console-fixtures.ts`; `tests/lib/console/fixtures-contract.test.ts`; `src/lib/console/*.ts` (local interfaces become the final types where `api.ts` exports them) | **First: "every fixture parses with the final `@/lib/platform/api` schema for its route"** (fails: fixtures missing). Fixtures: `tenantSummary(over)`, `tenantDetail`, `auditRow`, `notice`, `meReply`, `accountStatus`, `enrolReply`, with fake names and uuids, built from §3.4. Then `expectTypeOf`: each final type is assignable to the local interface it replaces; the earlier helper tests stay green |
| 14 | Bind the sentence table to the code lists | #140 | `src/lib/console/audit-view.ts`, `notice-view.ts`; `tests/lib/console/audit-view.test.ts`, `notice-view.test.ts` | **First: "the keys of `AUDIT_SENTENCE_KEYS` equal `PLATFORM_AUDIT_ACTIONS`, in order"** (fails before the merge: `@/lib/platform/codes` is absent). Then: `AUDIT_SENTENCE_KEYS satisfies Record<AuditAction, MessageKey>` (tsc); the notice kinds with a sentence equal `PLATFORM_NOTICE_KINDS`; the Azione options use the code-list order |
| 15 | Console layouts | #140 | `src/app/(platform)/console/layout.tsx`, `login/layout.tsx`; `tests/components/console/console-layout.test.ts` | **First: "the console layout's `metadata.title` is «Costì · Console»"** (fails: module missing). Then: it renders `CostiTheme`; `viewport.themeColor` is `PRODUCT_THEMES.light.band`; the login layout renders `ConsoleBand` («Costì · Console»), `ProductLogo` and one `main`; **no file under `src/app/(platform)/**`, `src/components/console/**` or `src/lib/console/**` imports `@/lib/design/venue-layer`** (direct imports: `ConsoleBand` → `HeaderBand` imports it for the `venue` prop it does not use); **no module reachable from those files imports `@/pwa/`** (a transitive walk of `@/` and relative imports); no console file contains the word that `console-no-realtime` forbids |
| 16 | `ConsoleShell`, sidebar, pills, counts, footer, Esci | #140 | `src/components/console/console-shell.tsx`, `console-nav.tsx`; `src/app/(platform)/console/(shell)/layout.tsx`; `tests/components/console/console-shell.test.ts` | **First: "on mount the shell reads `GET /api/platform/me` and `GET /api/platform/tenants` exactly once each"** (fails: module missing). Then: the sidebar shows «Locali 2», «Registro», «Avvisi 1»; the footer shows `displayName`, «Verifica in due passaggi attiva», «Orari: ora italiana»; `aria-current="page"` on the current section (`usePathname` mocked); the pills carry the same links and counts; no count is shown while loading or after an error; **no polling:** after fake timers advance 10 minutes and a `visibilitychange` event, still one call each; `refreshMe()` reads `/me` once more and the tenant list not at all; a 409 on both reads → one `POST /api/platform/console`; **«Esci» in the band** (`ConsoleBand account`) posts `/api/platform/logout`; the DOM has no `@` |
| 17 | Locali | #140 | `src/components/console/locali-screen.tsx`; `src/app/(platform)/console/(shell)/page.tsx`; `tests/components/console/locali.test.ts` | **First: "renders the h1 «Locali» and one row per tenant from the shell's read, in the server order"** (fails: module missing). Then: the columns Locale (meta «4 persone» / «1 persona»), Gruppo («—» when `tenantCount` is 1), Ultima attività (oggi / ieri / 12 nov / «—»), DigiAlto («Sì» / bold «No»); each row's only link goes to `/locali/<id>` (table and list); a header click → `router.replace('/?ordina=nome&verso=asc')`, a second click → `desc`; `aria-sort` on all four headers; `?ordina=attivita&verso=asc` applied on load; `?ordina=prezzo` ignored (server order); search filters and writes `cerca`; «Mostro 2 locali.» / «Mostro 1 di 2 locali.»; «Nessun locale con questi filtri.» + «Togli i filtri» clears `cerca`; «Caricamento…» with the search disabled; «Non riesco a leggere i locali.» + «Riprova» → `retryTenants`; down → «La console non risponde…»; «1 avviso da leggere» links to `/avvisi`, hidden at 0; the table wrapper is `hidden lg:block` and the list `lg:hidden`; long names `[overflow-wrap:anywhere]`; no «Stato», «Piano», «Salute» or «Nuovo locale»; one h1 |
| 18 | Venue detail | #140 | `src/components/console/venue-detail.tsx`, `raw-code.tsx`; `src/app/(platform)/console/(shell)/locali/[id]/page.tsx`; `tests/components/console/venue-detail.test.ts` | **First: "reads `GET /api/platform/tenants/<id>` and shows the BackLink «Locali» to `/` and the h1 with the venue's name"** (fails: module missing). Then: meta «nessun gruppo · creato il 21 ott 2026» and the group form; attached → «DigiAlto collegato» and **no** Salute section; not attached → Salute with only «DigiAlto non è collegato a questo locale.» (no button, no badge); Utilizzo «Persone» «1 titolare · 1 cuoco · 2 camerieri · DigiAlto»; Attività rows «14 nov 2026, 09:40», the sentence and «codice: console.tenant_opened» in small text; an unknown action shows its code; empty activity; «Vedi tutto nel registro ›» → `/registro?locale=<id>`; Impostazioni FactRows name, «Europe/Rome», slug or «—»; section DOM order Salute, Utilizzo, Attività, Impostazioni (C9); no «Entra nel locale» (L4); 404 `tenant_not_found` or `not_found` → «Locale non trovato.»; others → `readError` + «Riprova»; one h1 |
| 19 | Registro della piattaforma | #140 | `src/components/console/registro-screen.tsx`; `src/app/(platform)/console/(shell)/registro/page.tsx`; `tests/components/console/registro.test.ts` | **First: "with no params the first request is `/api/platform/audit?dal=2026-10-17&al=2026-11-15`"** (clock fixed at 2026-11-15; fails: module missing). Then: Azione options «Tutte» + the ten sentences in code-list order; Locale options «Tutti» + the shell's tenants by name; each filter change sends `dal` and `al` and updates the URL (`router.replace`); `?locale=<id>` preselected and sent; Dal after Al → «La data iniziale è dopo quella finale.», no request; 367 days → `rangeSpan`, no request; columns Quando / Locale / Azione / Da; «—» for platform-wide rows; «Console» / «Script»; a row opens the detail panel with the action code, ids and `detail` entries only; «Chiudi» closes it; «Carica altri» sends `prima=<nextBefore>`, appends, and is hidden when null; «Nessuna azione in questo periodo.»; error + «Riprova»; a slow older answer never replaces a newer one; phone meta «14 nov 2026, 09:40 · Osteria Demo A · Console»; no edit or delete control; one h1 |
| 20 | Avvisi | #140 | `src/components/console/avvisi-screen.tsx`; `src/app/(platform)/console/(shell)/avvisi/page.tsx`; `tests/components/console/avvisi.test.ts` | **First: "the «Da leggere» tab shows «Nuovo sub-responsabile v3: 2 locali non ancora avvisati»"** (fails: module missing). Then: `SegmentedControl` «Da leggere» / «Letti»; a notice with empty `pending` is under «Letti» only; an unknown kind (a raw fixture cast past the schema) shows its code; each pending row has the secondary «Segna come avvisato» and no date field; a click posts `{tenantId}` to `/api/platform/notices/<id>/notified`; on 200 the row shows «Avvisato il 15 nov 2026, 10:00» and `/api/platform/me` is read once more; `changed: false` shows the same; a 404 → a row error and the button again; notified rows show «Avvisato il …»; no timers; both empty states; error + «Riprova»; only tenant names, no `@`; one h1 |
| 21 | Page pin and design-system row | #140 | `tests/config/sp3-preserves.test.ts` (page list only); `docs/ux/costi-design-system.md` | **First (written before the pages of steps 15–20 exist, fails until step 20): "the console pages are exactly `(platform)/console/{login/page, login/codice/page, login/attiva-codice/page, (shell)/page, (shell)/locali/[id]/page, (shell)/registro/page, (shell)/avvisi/page}.tsx`"**. In the doc, row 23 already says "Costì · Console" (kept as is). Row 278 gets "`ConsoleBand` on the console; console layout `themeColor` Forest". The doc change is checked in review |
| 22 | Verification and hand-off | after 21 | PR description | `npm run lint`, `npx tsc --noEmit`, `npm test` green; coverage of `src/lib/console/*.ts` ≥ 80 %; the #140 guards (`console-no-realtime`, `sp3-preserves`) green; security checklist walked (§3.7); `code-reviewer` PASS; the PR lists the (da approvare) strings and §7 |

**Order and gating.** Steps 1–12 need nothing from #140 and go first. In practice, step 21's page-list test is written before step 15 and goes
green at step 20; its commit lands as step 21. The PR stays draft and must not merge before builder 1's step 16 (proxy host rules) is on
`main` (Q5).

**Mapping to the SP3 plan §8 test list:** `locali.test.ts` → 17; `venue-detail.test.ts` → 18; `registro.test.ts` → 19 (code-list filters,
origin column, codes-only detail panel, «Carica altri», `dal` and `al` always sent); `avvisi.test.ts` → 20; `console-sign-in.test.ts` → 10,
11 (§4 states, the `attiva-codice` redirect); `console-enrol.test.ts` → 12; §8's `tests/app/login/challenge-form.test.ts` →
`tests/components/challenge-form.test.ts`, step 9 (Q4). The accessibility checks of §8 (one h1, `aria-sort`, 44 px, the 360 px classes) sit
in 10–12 and 16–20. Added beyond §8: `console-layout` (15), `console-shell` (16) and the `tests/lib/console/*` unit tests (1–8, 13–14).

### 5b. Variants

**V1 — The band keeps no "Esci" slot** · Trigger: Q1 answered "`ConsoleBand` stays without arguments" · Replaces: step 16's "«Esci» in the
band" test and the `account={…}` in the shell.

| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| V1.1 | «Esci» (`ConsoleLogout tone="plain"`) sits at the foot of `ConsoleSidebar` on lg and after `ConsolePills` on the phone; `ConsoleBand` is rendered bare | `console-shell.tsx`, `console-nav.tsx`; `tests/components/console/console-shell.test.ts` | the band contains no button; the sidebar's «Esci» (inside `hidden lg:flex`) and the phone's «Esci» (inside `lg:hidden`) each post `/api/platform/logout` once and go to `/login` |

**V2 — Shared enrolment component** · Trigger: Q3 answered "builder 2 may change `src/components/mfa/enrol-factor.tsx`" · Replaces: step 12's
`console-enrol.tsx` copy of the step logic.

| # | Step | Files | Test |
|---|---|---|---|
| V2.1 | `EnrolFactor` and `EnrolStep` take `paths: { start: string; verify: (id: string) => string }`, defaulting to the venue's `/api/me/mfa/factors` | `src/components/mfa/enrol-factor.tsx`; `tests/components/enrol-factor.test.ts` | with no `paths` every existing case is unchanged; with the account paths the start and verify calls go to `/api/auth/mfa/account/factors…` |
| V2.2 | `ConsoleEnrol` renders `EnrolFactor` with the account paths and a full load to `safeNextPath(next)` | `console-enrol.tsx`; `tests/components/console/console-enrol.test.ts` | step 12's cases all pass against the shared component; no `/api/me/mfa*` call |

**V3 — `usePathname` returns the rewritten path during the server render** · Trigger: Q6 (builder 1's step 23 e2e shows a hydration warning or
a wrong current section on the console host) · Replaces: step 7's `currentSection` cases.

| # | Step | Files | Test |
|---|---|---|---|
| V3.1 | `currentSection` removes one leading `/console` segment before matching | `src/lib/console/console-nav.ts`; `tests/lib/console/console-nav.test.ts` | `/console/registro` and `/registro` both → registro; `/console` → locali; `/consolex` → null |

**V4 — No `(shell)` route group** · Trigger: Q2 answered "keep the page paths of SP3 plan §5 step 18" · Replaces: the `(shell)` paths of steps
16–21 and step 15's login layout.

| # | Step | Files | Test |
|---|---|---|---|
| V4.1 | `console/layout.tsx` renders `ConsoleFrame`, which puts the sign-in frame (band + logo) on `/login*` and `ConsoleShell` elsewhere, using `currentSection(usePathname()) === null && pathname.startsWith("/login")`; pages move to `console/{page, locali/[id]/page, registro/page, avvisi/page}.tsx` and `login/layout.tsx` is dropped | `src/app/(platform)/console/**`; `src/components/console/console-frame.tsx`; `tests/components/console/console-layout.test.ts` | on `/login` and `/login/codice` the frame renders no sidebar and makes **no** `/api/platform/*` call; on `/registro` it renders the shell and reads `/me` and `/tenants` once |
| V4.2 | The page pin lists the §5 step 18 paths | `tests/config/sp3-preserves.test.ts` | the list equals `(platform)/console/{page,login/page,login/codice/page,login/attiva-codice/page,locali/[id]/page,registro/page,avvisi/page}.tsx` |

## 6. Risks and mitigations

**Security and privacy**
- **R1. Console pages reachable on the app host.** Until builder 1's step 16 is on `main`, `/console/login` and the rest would render on the
  venue host. The data calls fail there (the routes and `withApi` refuse them), but the pages exist. Mitigation: the PR does not merge before
  step 16 (Q5).
- **R2. The console loading `@/pwa/*` or the venue layer indirectly.** Step 15 walks the imports transitively for `@/pwa/` and checks direct
  imports for `venue-layer`. `HeaderBand` imports `venue-layer` for a prop the band never passes, which is accepted and stated in the test.
- **R3. A reload loop on console mode.** The `SWITCH_KEY` guard (step 8) stops after one reload and reports «La console non risponde…».
- **R4. The setup key or the password leaking.** Both stay only in the DOM or component state; storage, URL and `console.*` spies are tested
  (steps 10, 12).
- **R5. `displayName` could carry a person's name.** It is the staff row's display name (default "DigiAlto", SP3 plan §3.1.2). The screen
  shows it as the API sends it; keeping it "DigiAlto" is builder 1's data rule. Noted for the reviewer.
- **R6. The QR image is blocked on the console's `/login/attiva-codice`.** The `data:` image rule is chosen by pathname (`csp.ts:70`,
  `DATA_IMAGE_PATHS`). It works only if step 16 computes the CSP from the visible path (Q7).

**Delivery**
- **R7. #140's `api.ts` changes again.** Steps 1–12 use local interfaces copied from §3.4; step 13 pins the final types against them.
- **R8. The `/realtime/i` scan of #140 matches any comment in `src/components/console/**` or `src/app/(platform)/**`.** Step 15 also checks it;
  writers avoid the word.
- **R9. Client navigation on the console host depends on the proxy rewriting RSC and prefetch requests** (step 16). Component tests cannot
  prove it; builder 1's step 23 e2e does (and V3 for `usePathname`).
- **R10. A leftover unverified factor in slot "principale"** answers 409 `mfa_slot_taken` on enrolment. The screen shows the message and
  «Riprova» (as the venue app does). The lost-factor path is SP3 plan R9.
- **R11. Duplicated code-form logic** between the venue `ChallengeForm` and `ConsoleChallenge`. The shared parts are helpers (`mfa-view`,
  `account-mfa`). V2 removes the enrolment duplicate if the scope widens.

**Performance / cost:** there is one read per screen and two shell reads on arrival, with no polling. No numbers are promised.

**Dependencies:** none added.

**ADR:** none. The decisions are local to the console screens and are recorded here.

## 7. Open questions

**For the lead**
- **Q1.** `ConsoleBand()` takes no arguments, but UX §3 and SP3 plan §8 put «Esci» in the band. Can #140's rework add an `account?: ReactNode`
  slot passed to `HeaderBand` (no `props` identifier, so `sp3-preserves` stays green)? Base plan: yes. If not: **V1**.
- **Q2.** The shell lives in a `(shell)` route group so that the sign-in pages make no `/api/platform/*` call. The page paths then differ from
  SP3 plan §5 step 18's pin list (`(shell)/` is added). Accept? Base plan: yes. If not: **V4**.
- **Q3.** May builder 2 add a `paths` prop to `src/components/mfa/enrol-factor.tsx` (outside today's scope) instead of a console copy? Base
  plan: no, a copy. If yes: **V2**.
- **Q4.** SP3 plan §8 names `tests/app/login/challenge-form.test.ts`, but the existing test is `tests/components/challenge-form.test.ts` (inside
  the allowed paths). Base plan: extend the existing file. Please amend §8.
- **Q5.** Confirm the merge order: this PR merges only after #140 and after step 16 (the proxy) are on `main` (R1).
- **Q6.** Under the proxy rewrite, does `usePathname()` give the visible path in the server render too? It cannot be checked before step 23.
  If not: **V3**.
- **Q7.** Does step 16 build the page CSP from the **visible** path, so that `/login/attiva-codice` on the console host gets the `data:` image
  rule (R6)?
- **Q8.** For an audit row with a `tenantId` and no `tenantName` (an erased venue), the plan shows the first 8 characters of the id until SP10's
  «Locale cancellato». Is that acceptable?

**For the founder (through the lead)**
- **F1.** Approval of every string marked (da approvare) in §3.6, including the ten audit sentences and the reuse of the venue enrolment
  wording on the console (Q-UX-C2).

No third-party provider is involved, so there are no prices, fees or retention questions.
