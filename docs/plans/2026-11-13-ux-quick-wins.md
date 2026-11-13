# Tech plan — Osteria Dei Rossi app · UX quick wins (phase P1, before go-live)

- **Client slug / internal:** `osteria-dei-rossi` (internal plan, English; UI strings Italian with English second)
- **Repo and branch:** `osteria-dei-rossi-app`, worktree `/home/user/osteria-uxqw`, branch `feat/ux-quick-wins` (from `main` 491d0b4)
- **Author:** architect · **Date:** 2026-11-13
- **Source plan:** `docs/plans/2026-11-13-ux-strategy.md` (§3.2 tap counts, §7 findings F01–F28, §9.2 phase P1, §9.3 QW1–QW11, G2)
- **Founder decision 2026-11-13 (via the lead):** the quick wins ship **before go-live (2027-01-12)**. The role-by-role redesign waits until
  after the supervised run. To be recorded in DigiAlto-Ops `clients/osteria-dei-rossi/context.md` by the lead.

---

## Summary for the founder

**What changes before go-live.** These are twelve small fixes, each one tested before it is built. They change only layout, placement,
wording and flow. There are no new colours, fonts or sizes, no database change and no new library.

| Your item | What you will see |
|---|---|
| 1. Booking page name link | The restaurant name on the booking page is no longer a link, so a guest can no longer end up on the staff sign-in |
| 2. Disabled "Invia" | The guest can always press "Invia richiesta". If something is missing, a message names it ("Manca: telefono") and the cursor jumps there. Nothing typed is lost |
| 3. Booking requests on Home | Home has a "Prenotazioni" row: "Prenotazioni da confermare · 2" |
| 4. "Carica una fattura" higher | The to-do list (with "Carica una fattura" first) moves above the dashboard figures |
| 5. Day close in one tap | Home has a "Chiusura del giorno" row |
| 6. Unsent dishes | The order bar reads "Comanda · 5 righe · 2 da inviare". A waiter who leaves a table with dishes not sent sees a sheet: "2 piatti non inviati" with "Invia antipasti · 2", "Esci comunque" and "Resta al tavolo" |
| 7. "Esci" on the kitchen phone | "Esci" and the signed-in name sit in the green header on every screen of a phone |

The fixes also cover four smaller issues from the audit: an empty production screen gets a "Crea una ricetta" link; "Registra uno spreco"
takes you straight to the waste form; the invoice list opens the review page directly; and the waiter's table panel has only one green
button. One step (G2, bigger time buttons on the booking page) waits for the design-system phase, because it needs a new size token.

**Recommendation:** two pull requests. The booking-page fixes (items 1–2) go first, and the staff fixes follow.

**Decisions I need from you:** the questions in §7, each with a default. The two that matter most:
- Q-QW2: should dishes marked "a seguire" count as "da inviare"? Default: no.
- Q-QW8: when to deploy. Default: before the waiter training session and before 11:00 on the day of the deploy.

---

## 1. Goal and scope

- **Goal:** fix the seven frictions the founder listed (and four more from the audit) before the venue goes live. Each fix is tested
  first. Nothing is added to the visual system.
- **In scope:** QW1–QW11 from strategy §9.3. **QW12** is new: the leave warning, founder item 6, second half. There are also two doc
  steps (D1, D2).
- **Out of scope:**
  - Any new token, palette, type scale or size, which is phase P2 ("DS1–DS8"). The `tap-comfort` token is P2/W4, so **G2 is dropped from
    this plan** (§5a, "Dropped").
  - Table tiles with "Da inviare · n" (W2, P3, needs SQL) and the one-tap send in the bar (W1, P3).
  - Any migration, any change to the role model, RLS, API role lists or auth (including the PIN, see Q-UX21 in §7).
  - The P0 baseline. It runs during the supervised run, so it measures the build *after* these fixes (risk R6).
  - The booking band shows `app.name` ("Osteria Dei Rossi") for every tenant. A per-tenant name is open item G1/P7, not part of QW1.

**Departure from the strategy (stated, not silent):**
- Strategy line 5 says "No build before go-live", and §9.2 says P1 "Depends on P0 results". The founder decision of 2026-11-13 overrides
  both for P1. D1 records this in the strategy.
- QW3 does not change `src/server/today/*` as §9.3 proposed. It reuses `GET /api/reservations/pending-count`. The reason is in §4 (A1).
- QW4 changes the Home order that ADR-030 decision 4 fixed (`docs/adr/adr-030-navigation-by-job-home-first.md:28`). Founder item 4
  asks for it, so this plan treats Q-UX4 as answered in favour of QW4. D2 records the change in an ADR.

## 2. Current state (verified in `main` 491d0b4)

| Area | What exists (file:line) |
|---|---|
| Header band | One band for every page in the root layout, with `BrandLink` (`src/app/layout.tsx:92-96`). `BrandLink` is a link to `/` named "Osteria Dei Rossi, Home" (`src/components/brand.tsx:30-43`). No `not-found.tsx` and no `error.tsx` exist under `src/app` (Glob), so the default 404 sits in the root layout and gets the band |
| Guest dead end (F01) | `/` is not public; a signed-out visitor is redirected to `/login` (`src/lib/supabase/proxy.ts:13-15`, `:74-81`) |
| Public layout | `src/app/(public)/layout.tsx:4-7` wraps `/login`, `/pin`, `/dispositivo` and `/prenota/*` in `PageMain`. It has no band of its own |
| Booking form (F02) | `ready` needs hydration, not busy, the privacy tick, a chosen slot, a party, name, phone and e-mail (`src/app/(public)/prenota/[slug]/request-form.tsx:117-125`). The button is `disabled={!ready}` (`:353`). Nothing says what is missing. The submit handler returns early if not ready (`:129`) |
| Home (F03, F04, F05) | Order: greeting, error, alert strip (`src/app/(owner)/page.tsx:115-124`), dashboard `[data-dashboard]` (`:126-131`), actions (`:132-158`), first steps (`:159-180`), account card (`:181-193`), `LogoutButton` (`:194`). The actions come from `src/lib/nav/today-actions.ts:45-81`. There is no reservation and no day-close action. Owner and admin read **one** `GET /api/dashboard`, and its test pins "exactly one RPC" (`tests/app/api/dashboard.test.ts:39-46`) |
| Booking count | `GET /api/reservations/pending-count` is owner and admin only (`src/app/api/reservations/pending-count/route.ts:6-10`). Postgres checks the role again (`app.require_day_closer`, `supabase/migrations/20261124100600_reservation_reads.sql:101-111`). The reply is `{pending}` only (`src/server/reservations/output.ts:190`). Only `/prenotazioni` reads it (`src/app/(owner)/prenotazioni/page.tsx:87-90`) |
| Day close (F05) | `/chiusura` sits in Registro behind "Altro" (`src/lib/nav/nav-model.ts:135`). Gate: `canCloseDay` = owner, admin (`src/lib/day-close/day-close-view.ts:12-14`) |
| Comanda bar (F05b) | `sheetSummary` counts live lines only: "Comanda · N righe" (`src/lib/orders/order-view.ts:62-71`; strings `src/lib/i18n/messages/it.ts:1794-1795`). Sticky bar at `src/app/(owner)/tavoli/comanda/order-sheet.tsx:85-89`. A draft whose fire is queued stays `draft` with `queue: "fire"` (`src/lib/sync/overlay.ts:5-7`, `:101-108`). The sheet already leaves such lines out of the send buttons (`order-sheet.tsx:44-48`) |
| What "unsent" means | Server: `close_table` refuses while **any** `draft` line exists (`supabase/migrations/20261110100200_close_table.sql:63-69`; the comanda shows the refusal, `comanda/page.tsx:319`). M19 design: "Segue dishes stay drafts until the waiter calls them" (`docs/plans/2026-10-28-m19-firing.md:91`). Send buttons per course: "Invia <portata> · n" for non-segue drafts and "Invia a seguire · n" for segue drafts (`src/lib/orders/fire-view.ts:32-50`, `comanda/send-buttons.tsx:31-49`). `sendLines` queues one fire (`comanda/page.tsx:259-262`) |
| Ways out of the comanda | (1) the "← Tavoli" link to `/tavoli` (`comanda/page.tsx:328-332`, rendered at `:337`, `:354`, `:368`); (2) the header wordmark link to `/`, which sends a waiter on to `/tavoli` (`nav-model.ts:218-220`); (3) browser or OS back; (4) closing the app. The comanda is a focus route: no tab bar, no section row (`nav-model.ts:206-215`). There is no "Esci" on it today. No `beforeunload` exists |
| Bottom-sheet pattern | `WeightSheet`: scrim `bg-ink/40` and a fixed bottom sheet `bg-surface border-rule-strong rounded-t-2xl` (`comanda/weight-sheet.tsx:57-63`). Existing tokens only |
| "Esci" (F07) | `LogoutButton` calls `/api/auth/logout`, then `forgetUser()` and a full load of `/`. It shows the pending-ops line (`src/components/logout-button.tsx:17-41`). It is used on Home (`(owner)/page.tsx:194`, `lg:hidden`), on `/tavoli` for the waiter (`tavoli/page.tsx:136-137`) and in the laptop sidebar (`src/components/nav/sidebar-nav.tsx:45-51`). The staff guide says "tocca «Esci» in Oggi" (`docs/guides/accesso-e-personale.md:13`) |
| Focus on the band | The global ring is `focus` (`src/app/globals.css:121-122`; light `#8A5F22`, `src/lib/design/tokens.ts:97`). `CONTRAST_PAIRS` has `band-ink` on `band` as text (`tokens.ts:156`; 10.82, `docs/design/ui-foundation.md:117`) but **no focus pair on `band`** (`tokens.ts:173-175`). Hand-computed with the formula of `src/lib/design/contrast.ts`: `focus` on `band` in light ≈ **2.0:1**, below 3:1. This affects today's wordmark link and any new control on the band (new observation **N1**, not in §7; proposed severity 2, to be confirmed in P0) |
| Production empty (F09) | `recipes.length === 0` renders only `Muted production.noRecipes` (`src/app/(owner)/produzione/nuova/page.tsx:133-134`). `emptyFor` has no batch case (`src/lib/empty/empty-content.ts:35-62`), and `CREATE_RECIPE` → `/ricette/nuova` exists (`:30`). `POST /api/recipes` allows owner, admin, chef (`src/app/api/recipes/route.ts:8`, `:14-18`) |
| Waste (F10) | Home "Registra uno spreco" → `/magazzino` (`today-actions.ts:76`). The row links to `/magazzino/<id>` (`src/app/(owner)/magazzino/stock-row.tsx:21`). The waste form (`aria-label` "Registra spreco", `magazzino/[ingredientId]/waste-form.tsx:76`; `it.ts:688`) is below the lots list (`magazzino/[ingredientId]/page.tsx:199-224`). `useHashScroll` exists (`src/components/use-hash-scroll.ts:9-19`) |
| Invoice list (F11) | Every row links to `/fatture/<id>` (`src/app/(owner)/fatture/page.tsx:138-139`). The detail page's only forward action for `review` and `duplicate` is "Rivedi le righe" (`fatture/[id]/page.tsx:29`, `:92`, `:174-182`) |
| Session panel (F12) | Primary link "Prendi la comanda" (`src/app/(owner)/tavoli/session-panel.tsx:64-66`). The bill toggle turns `primary` when on (`:102-110`), against ui-foundation §6 "one per form or screen" (`docs/design/ui-foundation.md:261`) |
| PIN (Q-UX21) | PIN field `type="password"`, `autoComplete="off"`, no paste handler (`src/app/(public)/pin/pin-pad.tsx:39-51`) |
| E2E projects | Phone projects run at 360 × 740 (`playwright.config.ts:29`, `:46`); laptop at 1280 × 800 (`:55`) |
| Release | Migrations first, then promote on Vercel (`.github/workflows/deploy-production.yml:9-10`). Service hours 11:00–24:00 (`docs/prd.md:430`). Training check G3-4: a waiter enters a 4-cover, 3-course table in under 90 s "after one training session" (`docs/go-live/checklist.md:30`) |

## 3. Design

### 3.1 Components and responsibilities

| Piece | Kind | Responsibility |
|---|---|---|
| `HeaderBand` (`src/components/header-band.tsx`) | Server-safe view | The green band and its classes, moved unchanged from `layout.tsx:92-96`, with two slots: `brand` and an optional `account` |
| `BrandTitle` (`src/components/brand.tsx`) | View | The mark and the wordmark with **no link**, for `/prenota/*` |
| `PublicBrand` (`src/app/(public)/public-brand.tsx`) | Client | `BrandTitle` when `isGuestPath(pathname)`, else today's `BrandLink`. Pure test `isGuestPath` in `src/lib/nav/public-paths.ts` (prefix `/prenota/`) |
| `src/app/not-found.tsx` | Server | A 404 with the band (`BrandLink`) and a link to Home, so an unknown URL keeps a way back after the band leaves the root layout |
| `missingFields(form)` (`src/lib/reservations/request-check.ts`) | Pure | The missing booking fields in form order: `date`, `slot`, `name`, `phone`, `email`, `privacy`. Presence only; the server still validates everything |
| `requestsBadge(pending)` and two actions (`src/lib/nav/today-actions.ts`) | Pure | The actions "Prenotazioni" (`/prenotazioni`) and "Chiusura del giorno" (`/chiusura`) for owner and admin. Badge: null when unknown, "Niente da fare" at 0, else warning "Prenotazioni da confermare · n" |
| `usePendingRequests(enabled)` (`src/components/use-pending-requests.ts`) | Client hook (like `use-today.ts`) | One `GET /api/reservations/pending-count` when the role is owner or admin. On failure there is no badge, and the action stays |
| `unsentLines(lines)` (`src/lib/orders/order-view.ts`) | Pure | Lines with `state === "draft"`, `segue === false` and `queue` neither `"fire"` nor `"void"`. Queued adds count, because the kitchen does not have them. Used by the bar (QW5) and the leave warning (QW12). Segue drafts: see Q-QW2 and variant VA |
| `unsentGroups(lines)` (`src/lib/orders/fire-view.ts`) | Pure | `fireGroups(unsentLines(lines))`, reduced to `normalIds`: the same ids each course's "Invia" button would send |
| `LeaveGuardProvider`, `useLeaveGuard`, `useRequestLeave` (`src/components/nav/leave-guard.tsx`) | Client context in `AppShell` | A page registers a guard `(go) => boolean`. In-app exits ask it first; if it returns true, the exit waits for the page's answer |
| `GuardedLink` (same file) | Client | A `next/link` whose plain click asks the guard. Modified clicks (new tab) pass through |
| `ShellBrandLink` (`src/components/nav/shell-brand-link.tsx`) | Client | `BrandLink` rendered through `GuardedLink`, for signed-in pages |
| `AccountControl` (`src/components/nav/account-control.tsx`) | Client | The signed-in user's own `displayName` and "Esci" in the band, `lg:hidden` (the laptop sidebar keeps its own). It reuses `LogoutButton`'s logic: logout, `forgetUser()`, full load of `/`, and the pending-ops status line in `text-band-ink`. Logout goes through the guard |
| `LeaveSheet` (`src/app/(owner)/tavoli/comanda/leave-sheet.tsx`) | Client view | The bottom sheet: title "2 piatti non inviati" (singular "1 piatto non inviato"), one "Invia <portata> · n" button per course with unsent lines (the first course in service order is primary, the others secondary), "Esci comunque" (secondary), "Resta al tavolo" (quiet). Same classes as `WeightSheet` |
| `invoiceHref(invoice)`, `isReviewable(status)` (`src/lib/invoices/invoice-view.ts`) | Pure | `review`/`duplicate` → `/fatture/<id>/revisione`; else `/fatture/<id>`. The detail page uses `isReviewable` instead of its local `REVIEWABLE` |
| `emptyFor("batchRecipes", role)` (`src/lib/empty/empty-content.ts`) | Pure | Message plus `CREATE_RECIPE` for exactly the roles in `POST /api/recipes` (mirrored as a constant with a comment pointing to `src/app/api/recipes/route.ts:8`) |
| `stockRowHref(id, action)` (`src/lib/stock/stock-view.ts`) | Pure | `/magazzino/<id>`, or `/magazzino/<id>#spreco` when the list was opened with `?azione=spreco` |

**Focus on the band (N1).** Every control on the band (the wordmark link, `AccountControl`) gets `focus-visible:outline-band-ink`.
This is an existing token. QW1 adds the pair `{fg: "band-ink", bg: "band", min: AA_NON_TEXT, use: "focus ring on the header band"}` to
`CONTRAST_PAIRS`; the pair is already tested as text at 10.82. That is a test entry, not a new token.

### 3.2 Data model / schema
No change. No migration. `tests/config/ux-quick-wins-preserves.test.ts` (D1) pins this.

### 3.3 API / interfaces
- No new endpoint and no changed role list.
- QW3 reads the existing `GET /api/reservations/pending-count` (owner, admin; 403 for chef and waiter; returns `{pending: number}`).
- QW12 uses the existing outbox call `queue.queueFire({ sessionId, tableName, lineIds })`.

### 3.4 Flows

**Guest (QW1, QW2).** `/prenota/<slug>`: the band shows `BrandTitle` (no link).
- The guest taps "Invia richiesta". The `missingFields` list is not empty, so one `ErrorAlert` (role `alert`) appears with
  "Manca: telefono" (plural "Mancano: telefono, e-mail") and focus moves to the first missing control.
- For a missing slot, focus goes to the first available time button, or to the date when there is no date.
- No request is sent. The message updates live as fields are filled and disappears when nothing is missing. Values stay where they are.

**Owner Home (QW3, QW4, QW7).** The order becomes:
1. the h1;
2. the read-error notice;
3. the alert strip;
4. the actions: primary, then the list;
5. `[data-dashboard]`;
6. the first steps;
7. the account card.

The owner's actions are: Carica una fattura (primary), Prenotazioni, Chiusura del giorno, Comande, Pagamenti, Costi dei piatti, Tavoli,
Menu e prezzi. The admin's are: Personale e dispositivi (primary), Prenotazioni, Chiusura del giorno, Importa da file, Menu e prezzi,
Tavoli, Comande, Fatture.

**Leaving a table (QW12).**

```
Comanda (unsent = unsentLines(overlaid.lines))
  └─ useLeaveGuard(unsent.length > 0 ? (go) => { setPendingExit(() => go); return true } : null)
Exit tapped: "← Tavoli" (GuardedLink) | wordmark (ShellBrandLink) | "Esci" (AccountControl)
  └─ requestLeave(go)
       ├─ no guard, or the guard returns false → go()            (navigation as today)
       └─ guard returns true → LeaveSheet opens, focus on its title
            ├─ "Invia antipasti · 2" → queue.queueFire(those ids); unsent recomputed from the overlay;
            │                           when it reaches 0 → go(); otherwise the sheet stays with the rest
            ├─ "Esci comunque"        → go()
            └─ "Resta al tavolo" / Escape / scrim tap → sheet closes, nothing changes
```

The warning never blocks:
- one tap ("Esci comunque") always completes the exit;
- offline, "Invia" queues like the sheet's own buttons;
- nothing is lost on any path, because drafts are server rows or persisted outbox ops.

**Not covered (by design):**
- **Browser or OS back and closing the app.** No `beforeunload`:
  - Next.js client navigation does not fire it.
  - Mobile browsers show a generic dialog that cannot say "2 piatti" or offer "Invia".
  - Nothing is lost on unload.
- **History interception.** Rejected in §4 (A5).
- **The end-of-table case is already guarded.** `close_table` refuses while any draft exists (`close_table.sql:63-69`).

## 4. Alternatives considered

- **A1. QW3 as a new key in `public.today_counts()` / `dashboard_summary` (strategy §9.3).** Rejected for now:
  - it needs a migration that redefines `today_counts` (`supabase/migrations/20261107100000_today_counts.sql:59-117`);
  - it widens the strict `managerCountsSchema` (`src/server/today/types.ts:58-73`);
  - it opens a deploy window in which the old app strictly parses a document with an unknown key and Home fails until promote (migrations
    run first, `deploy-production.yml:9-10`).

  The reused endpoint gives the same count from the same database rule with no schema risk. A1 stays the better long-term shape for O1/O2
  in P5.
- **A2. A second RPC inside `GET /api/dashboard`.** Rejected: it breaks the pinned "exactly one RPC" property
  (`tests/app/api/dashboard.test.ts:39-46`), which would mean weakening a test.
- **A3. QW1 by making the root band a client component that picks link or title from the pathname.** Smaller for QW1 alone, but QW6 needs
  the signed-in band to hold `AccountControl` with the `/api/me` user. A root-level client band would call `/api/me` on public pages too.
  Moving the band into the two layouts serves both steps.
- **A4. Leave warning as an inline banner on the comanda instead of a sheet.** Rejected: the exit tap is at the top ("← Tavoli") or in
  the header. A banner would have to be read before the tap, and QW5's count already does that job. The sheet appears exactly when the
  person acts.
- **A5. Intercept browser back with a pushed history entry or `popstate`.** Rejected: fragile with the App Router, it breaks the back
  button's meaning, and nothing is lost on that path.
- **A6. `beforeunload`.** Rejected (reasons in §3.4).
- **A7. "Invia tutto" in the leave sheet.** Not chosen by default: firing is the depletion moment and starts the kitchen
  (`m19-firing.md:91`), and sending secondi with the antipasti is a real service error. It is variant VD.

**Dependencies:** none added (`tests/config/no-new-deps.test.ts` stays green).

## 5. Build plan

**Test-first rule.** Each step's *failing-first* test is written first and fails on `main` for the reason given. A *guard* is a test that
already passes and must stay green. Every e2e named here runs in the 360 × 740 phone projects (`playwright.config.ts:29`, `:46`) unless
it says "laptop".

**Recording in the strategy's §9.**
- D1 adds a **"Done" column** to the P1 table in `docs/plans/2026-11-13-ux-strategy.md` §9.3, adds a **QW12** row and notes G2 as "not
  in P1".
- Each QW commit sets its own row's cell to `Done (PR 1)` or `Done (PR 2)`, in the same commit.
- `tests/config/ux-quick-wins-docs.test.ts` holds a `SHIPPED` list that each step extends by its id. It fails if a shipped id's row does
  not say `Done`.

### PR 1: guest booking page (branch `feat/ux-quick-wins`)

| # | Step (one commit) | Files | Failing-first test | Guards and e2e |
|---|---|---|---|---|
| D1 | Strategy §9: "Done" column, QW12 row, G2 "not in P1 (dropped, see ux-quick-wins plan §5a)"; header and §9.2 note on the founder decision of 2026-11-13 (P1 before go-live, before P0). Preserves test | `docs/plans/2026-11-13-ux-strategy.md`, `docs/plans/2026-11-13-ux-quick-wins.md`, `tests/config/ux-quick-wins-docs.test.ts`, `tests/config/ux-quick-wins-preserves.test.ts` | `ux-quick-wins-docs.test.ts`: the §9.3 P1 table has a `Done` column and a `QW12` row (fails: neither exists) | `ux-quick-wins-preserves.test.ts` (guard): the newest migration is still `20261201100500_mfa_failure_retention.sql`; the `--color-*` names in `globals.css` `@theme` equal `COLOR_TOKENS`; no `--spacing-*` or `--text-*` token added; `no-new-deps.test.ts` green |
| QW1 | Band moves out of the root layout into `HeaderBand`, used by `(public)/layout.tsx` (with `PublicBrand`) and by `AppShellView` (with `ShellBrandLink`; `AccountControl` slot left empty here). **Note (PR 1): `ShellBrandLink` deferred to PR 2 with QW12**; until then `AppShellView` uses `BrandLink`. `/prenota/*` shows `BrandTitle`. Band controls get `focus-visible:outline-band-ink`, and the pair is added to `CONTRAST_PAIRS`. `src/app/not-found.tsx` gets the band | `src/app/layout.tsx`, `src/app/(public)/layout.tsx`, `src/app/(public)/public-brand.tsx`, `src/app/(owner)/app-shell.tsx`, `src/components/header-band.tsx`, `src/components/brand.tsx`, `src/components/nav/shell-brand-link.tsx`, `src/lib/nav/public-paths.ts`, `src/app/not-found.tsx`, `src/lib/design/tokens.ts`, i18n it/en | `tests/components/brand-title.test.ts`: `BrandTitle` renders no `<a>` and shows the wordmark (fails: no export). `tests/lib/nav/public-paths.test.ts`: `/prenota/x` and `/prenota/x/annulla` true; `/prenotazioni`, `/login`, `/pin` false (fails: no module). `tests/lib/design/tokens.test.ts`: the band focus pair is in `CONTRAST_PAIRS` and passes 3:1 in both themes (fails: absent). e2e `reservations-public.spec.ts` "unknown address" test (`:230-239`): the page's `header` has no `a[href="/"]` (fails: the band link exists) | `brand-link.test.ts` unchanged. `owner-layout.test.ts` "exactly one main" unchanged. e2e `app-shell.spec.ts:22-43` **unchanged** (`/login`, `/pin`, `/`, `/fatture` keep the link to `/`), extended: exactly one `header.band` on each of those pages, and a signed-in unknown URL shows the band with the link to `/`. `pwa.spec.ts` privacy check ("the cached shell page holds no staff name", `:31`) stays green |
| QW2 | Submit enabled once hydrated and not busy; on submit with gaps: one `ErrorAlert` "Manca/Mancano: …", focus to the first missing control, no request; the list updates live | `src/lib/reservations/request-check.ts`, `src/app/(public)/prenota/[slug]/request-form.tsx`, `src/app/(public)/prenota/[slug]/slot-picker.tsx` (ref to the first available slot), i18n it/en | `tests/lib/reservations/request-check.test.ts`: each field named alone; all missing → form order; nothing → `[]`; whitespace-only name is missing (fails: no module). `tests/components/reservation-request.test.ts`, new case: without a tick the button is enabled; a click shows "Manca: conferma dell'informativa privacy" (and the English pair), focuses the checkbox, sends no POST, and the typed name, phone and e-mail stay (fails: the button is disabled) | e2e `reservations-public.spec.ts` "fill the form" phase (360): see §5c |

### PR 2: staff screens (branch `feat/ux-quick-wins-staff`, cut from `main` after PR 1 merges)

| # | Step (one commit) | Files | Failing-first test | Guards and e2e |
|---|---|---|---|---|
| D2 | ADR-041 (next free number; ADR-040 is the highest today) "Home order and the account control in the header". It supersedes ADR-030 decision 4 (`adr-030…:28`) for owner and admin, and records "Esci in the band on every signed-in phone screen" as a shell rule | `docs/adr/adr-041-home-order-and-header-account.md`, `docs/adr/adr-030-navigation-by-job-home-first.md` (status line: "decision 4 superseded by ADR-041") | `ux-quick-wins-docs.test.ts`: ADR-041 exists, names ADR-030 decision 4 and at least one rejected alternative (fails: no file) | `code-reviewer` checks the ADR against `templates/adr.md` |
| QW5 | Bar reads "Comanda · 5 righe · 2 da inviare" using `unsentLines` | `src/lib/orders/order-view.ts`, i18n it/en | `tests/lib/orders/order-view.test.ts`: 2 non-segue drafts + 1 fired → "… · 2 da inviare"; a draft with `queue: "fire"` not counted; a queued add counted; a segue draft not counted; 0 → no suffix; English pair (fails: no suffix) | Unit and e2e changes in §5c |
| QW6 | `AccountControl` in the band (own name + "Esci", `lg:hidden`) on every signed-in screen, focus routes included. Remove the Home and waiter in-page buttons. Update the staff guide | `src/components/nav/account-control.tsx`, `src/app/(owner)/app-shell.tsx`, `src/app/(owner)/page.tsx` (remove `:194`), `src/app/(owner)/tavoli/page.tsx` (remove `:136-137`), `src/components/logout-button.tsx` (shared logout function), `docs/guides/accesso-e-personale.md:13` ("tocca «Esci» in alto") | `tests/components/account-control.test.ts`: renders the name and one "Esci"; logout calls `/api/auth/logout` then `forgetUser`; `focus-visible:outline-band-ink`; the wrapper is `lg:hidden` (fails: no module). `tests/components/app-shell.test.ts`: `AppShellView` for owner, admin, chef and waiter, on `/cucina` and on the comanda (focus route), has "Esci" in the `banner` landmark (fails: no header in the shell). e2e `app-shell.spec.ts` new test: the chef on `/cucina` taps "Esci" → `/login` (fails: no Esci on `/cucina`); the waiter on `/tavoli` the same; the "Esci" box is inside 360 × 740 and the page has no sideways scroll (`expectPhoneFriendly`) | Laptop `app-shell.spec.ts:385-397` ("one Esci", in the sidebar) **unchanged** and green. `staff-pin.spec.ts:170-171`, `menu-tables.spec.ts:198`, `magic-link.spec.ts:35`, `pwa.spec.ts:214-216`, `offline.spec.ts:208`, `:219` use page-wide locators and stay unchanged; comments at `staff-pin.spec.ts:170`, `menu-tables.spec.ts:195-196`, `offline.spec.ts:204` are reworded (comment only). Changed unit tests in §5c |
| QW12 | Leave warning: `useLeaveGuard` on the comanda; `GuardedLink` for "← Tavoli"; `ShellBrandLink` and `AccountControl` ask the guard; `LeaveSheet` | `src/components/nav/leave-guard.tsx`, `src/components/nav/shell-brand-link.tsx`, `src/components/nav/account-control.tsx`, `src/app/(owner)/app-shell.tsx` (provider), `src/app/(owner)/tavoli/comanda/page.tsx`, `src/app/(owner)/tavoli/comanda/leave-sheet.tsx`, `src/lib/orders/fire-view.ts` (`unsentGroups`), i18n it/en | `tests/lib/orders/fire-view.test.ts`: `unsentGroups` gives exactly the `normalIds` the sheet's "Invia" buttons send, per course in service order; segue and queued-fire lines are excluded (fails: no export). `tests/components/leave-guard.test.ts`: with no guard a `GuardedLink` click navigates; with a guard returning true it does not, and calling `go` navigates; ctrl/meta-click is never intercepted (fails: no module). `tests/components/leave-sheet.test.ts`: title singular and plural; one button per course with the right ids; first course primary, others secondary; "Esci comunque" calls `go`; "Resta al tavolo" and Escape call `onStay`; role `dialog` with the title focused (fails: no module). `tests/components/order-page.test.ts`: with one draft, "← Tavoli" opens the sheet and `push` is not called; "Invia antipasti · 1" queues one fire with that id and then calls `push("/tavoli")`; with 0 unsent, "← Tavoli" navigates at once (fails: it navigates with no sheet) | e2e `order-entry.spec.ts` new test (360): open a table, add one antipasto, tap "← Tavoli" → dialog "1 piatto non inviato" with "Invia antipasti · 1"; `expectPhoneFriendly` with the sheet open; "Resta al tavolo" keeps the URL; tap "← Tavoli" again, then "Invia antipasti · 1" → POST `/api/sync` carries a `fire`, then the URL is `/tavoli`. `offline.spec.ts:204-207` changed (§5c) |
| QW3 | "Prenotazioni" action with "Prenotazioni da confermare · n" on Home for owner and admin | `src/lib/nav/today-actions.ts`, `src/components/use-pending-requests.ts`, `src/app/(owner)/page.tsx`, i18n it/en | `tests/lib/nav/today-actions.test.ts`: owner and admin have `/prenotazioni`; chef and waiter do not; `requestsBadge(2)` → "Prenotazioni da confermare · 2" warning; `requestsBadge(0)` → "Niente da fare"; `requestsBadge(null)` → null (fails: no action or function). `tests/components/use-pending-requests.test.ts`: disabled → no request; enabled → one GET of `/api/reservations/pending-count`; error → state `error` (fails: no module). `tests/components/home-today.test.ts`: the owner's Home reads the endpoint once and shows the badge; the chef's never reads it; with an error the row stays without a badge (fails: no request) | `tests/app/api/reservations-read.test.ts` (role list and `{pending}` only) unchanged and green. e2e `reservations-staff.spec.ts`, inserted after `seedCustomerRequest` (`:92`): `/` shows "Prenotazioni da confermare · 1"; tapping it opens `/prenotazioni` (fails: no such row). Its text has no customer name (`expect(main).not.toContainText("Cliente Demo")` on Home) |
| QW7 | "Chiusura del giorno" action on Home for owner and admin | `src/lib/nav/today-actions.ts`, i18n it/en | `tests/lib/nav/today-actions.test.ts`: `/chiusura` is among the actions of exactly the roles where `canCloseDay` is true; the chef's words still have no "€" in it and en (fails: no action) | e2e `app-shell.spec.ts` (360), new test: owner Home → "Chiusura del giorno" → `/chiusura` in one tap (fails: no link). The "Altro leads to Chiusura" test (`:167-215`) stays unchanged |
| QW4 | Home: actions (primary + list) before `[data-dashboard]` for owner and admin; alert strip stays first | `src/app/(owner)/page.tsx` | `tests/components/home-today.test.ts` "Home order": the chain is h1 → strip → "Carica una fattura" → last action row → `[data-dashboard]` → "Primi passi" → account card (owner); for the admin, "Personale e dispositivi" → `[data-dashboard]` (fails: the dashboard comes first) | e2e `app-shell.spec.ts:225-241` extended (360): the "Carica una fattura" box ends inside the first 740 px before any scroll, and it precedes `[data-dashboard]`. This e2e may already pass on a fresh tenant, so it is a guard; the component test is the failing-first test |
| QW8 | Empty `/produzione/nuova`: `EmptyState` with "Crea una ricetta" for the roles of `POST /api/recipes`, text only for others | `src/lib/empty/empty-content.ts`, `src/app/(owner)/produzione/nuova/page.tsx`, i18n it/en | `tests/lib/empty/empty-content.test.ts`: `batchRecipes` offers `/ricette/nuova` for exactly owner, admin, chef (the mirrored constant equals the list at `api/recipes/route.ts:8`, read as text); null role → no link (fails: no case). `tests/components/production-page.test.ts`: no recipes → link "Crea una ricetta" (fails: plain text) | e2e `app-shell.spec.ts` B5 (`:621-659`) already opens `/produzione/nuova` on a fresh tenant and must keep the back link first (guard). New assertion in a new phone test: the owner on `/produzione/nuova` sees "Crea una ricetta" → `/ricette/nuova`; `expectPhoneFriendly` |
| QW9 | Home "Registra uno spreco" → `/magazzino?azione=spreco`; rows link to `/magazzino/<id>#spreco`; the waste form has `id="spreco"` and `useHashScroll` | `src/lib/nav/today-actions.ts`, `src/lib/stock/stock-view.ts`, `src/app/(owner)/magazzino/page.tsx`, `src/app/(owner)/magazzino/stock-row.tsx`, `src/app/(owner)/magazzino/[ingredientId]/page.tsx`, `.../waste-form.tsx` | `tests/lib/stock/stock-view.test.ts`: `stockRowHref(id, "spreco")` ends in `#spreco`; without an action, no hash (fails: no export). `tests/components/stock-row.test.ts`: the `spreco` prop sets the hash (fails) | e2e `stock.spec.ts` new test (360): chef Home → "Registra uno spreco" → ingredient → the form named "Registra spreco" (`waste-form.tsx:76`) is inside the viewport (fails: the form sits below the lots) |
| QW10 | Invoice rows link straight to the review for `review` and `duplicate` | `src/lib/invoices/invoice-view.ts`, `src/app/(owner)/fatture/page.tsx`, `src/app/(owner)/fatture/[id]/page.tsx` (use `isReviewable`) | `tests/lib/invoices/invoice-view.test.ts`: `review`, `duplicate` → `/fatture/<id>/revisione`; `received`, `extracting`, `extraction_failed`, `approved`, `rejected` → `/fatture/<id>` (fails: no export) | e2e `invoice-upload.spec.ts:162-164` changed (§5c). `app-shell.spec.ts:629` (review back link to the detail) unchanged |
| QW11 | "Conto richiesto" stays secondary; when on: `bg-sunk`, `aria-pressed="true"` and an `aria-hidden` "✓". Accessible name unchanged | `src/app/(owner)/tavoli/session-panel.tsx` | `tests/components/session-panel.test.ts`: in both states exactly one element with the primary classes (`bg-accent`), the comanda link; when on, the toggle shows "✓" and its accessible name is still "Conto richiesto" (fails: two primaries when on) | `menu-tables.spec.ts:230` (exact name "Conto richiesto") unchanged and green |

### 5a. Step table (founder items, findings, taps)

Taps follow strategy §3.2's counting rules: app taps on the shortest path; OS taps and scrolling are not counted. "Before" values come from
§3.2 where it has the job; otherwise they are counted from the files cited in §2.

| QW | Founder item | Finding / severity (§7) | Screen | Taps before → after | PR |
|---|---|---|---|---|---|
| QW1 | 1 | F01 / 3 | `/prenota/<slug>` header (band moved for all pages) | J10: the header tap was a dead end (staff `/login`, form lost) → no link in the header | 1 |
| QW2 | 2 | F02 / 3 | `/prenota/<slug>` form | J10 happy path 6 → 6. With a gap: no message (stuck) → 1 tap shows the list and focuses the field | 1 |
| QW3 | 3 | F03 / 3 | Home `/` (owner, admin) | J9 4 → 3 (Home row, Accetta, submit) for a request on today's date; for another date, add the day navigation in both cases (not determined, §3.2) | 2 |
| QW4 | 4 | F04 / 2 | Home `/` (owner, admin) | J7 7 → 7 taps; the scroll to the link is removed (before: not measured, §3.2) | 2 |
| QW7 | 5 | F05 / 2 | Home `/` (owner, admin) | J8 3 → 2 | 2 |
| QW5 | 6 (count) | F05b / 3 | comanda sticky bar | J2 5 → 5; unsent count visible with 0 taps | 2 |
| QW12 (new) | 6 (leave warning) | F05b / 3 | comanda exits: "← Tavoli", wordmark, "Esci" | Send forgotten antipasti and leave: bar (1) + "Invia antipasti" (1) + "← Tavoli" (1) = 3 → "← Tavoli" (1) + "Invia antipasti" in the sheet (1) = 2. Leave on purpose with unsent dishes: 1 → 2 ("Esci comunque"). With nothing unsent: 1 → 1 | 2 |
| QW6 | 7 | F07 / 2 | band on every signed-in screen | Chef on `/cucina`: Home tab (1) + "Esci" (1) after a scroll to the page end = 2 → 1. Waiter on the comanda: "← Tavoli" (1) + "Esci" (1) = 2 → 1 (+1 if dishes are unsent, QW12) | 2 |
| QW8 | — | F09 / 2 | `/produzione/nuova`, no batch recipe | Chef: Anagrafica tab (1) → `/ricette` "Nuova ricetta" (1) = 2 → 1. Owner: Altro (1) → Ricette (1) → Nuova ricetta (1) = 3 → 1 (`ricette/page.tsx:71`) | 2 |
| QW9 | — | F10 / 2 | Home → `/magazzino` → ingredient | J11 5 → 5; the scroll to the form is removed (before: "likely, not determined", §3.2) | 2 |
| QW10 | — | F11 / 1 | `/fatture` list | J7 7 → 6; screens 4 → 3 | 2 |
| QW11 | — | F12 / 1 | `/tavoli` session panel | J2 and J3 unchanged; two primaries → one | 2 |
| G2 | — | none in §7 (R13 status line; `tap-comfort` size) | `/prenota` slot picker | **Dropped** (below) | — |

**Dropped: G2.** It belongs to P7 in strategy §9.2, not to P1, and its main part sizes the slot buttons with `tap-comfort`, a new token from
P2/W4. The constraint "no new tokens" rules it out before go-live. Its other half (a `role="status"` line naming the chosen time) has no
§7 finding behind it. It stays in P7 with the rest of G2.

### 5b. Variants

Each variant is triggered by an open question in §7. Other sections refer to them only by ID.

**VA — Segue drafts count as unsent** · Trigger: Q-QW2 answered "yes" · Replaces: the `unsentLines` predicate in QW5 and QW12
| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| VA.1 | `unsentLines` drops the `segue === false` condition; the bar counts segue drafts too | `src/lib/orders/order-view.ts` | `tests/lib/orders/order-view.test.ts`: a segue draft is counted; a queued-fire segue draft is not |
| VA.2 | `LeaveSheet` shows "Invia a seguire · n" per course for segue drafts (secondary), as `SendButtons` does | `leave-sheet.tsx`, `fire-view.ts` (`unsentGroups` keeps `segueIds`) | `tests/components/leave-sheet.test.ts`: one segue draft opens the sheet with "Invia a seguire · 1", which queues exactly that id. e2e `order-entry.spec.ts` leave test: mark the line "a seguire", tap "← Tavoli", and the sheet appears |

**VB — Unlink the wordmark on every public page** · Trigger: Q-QW6 answered "unlink all" · Replaces: the `PublicBrand` choice in QW1
| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| VB.1 | `(public)/layout.tsx` always renders `BrandTitle`; `PublicBrand` and `public-paths.ts` are removed | `src/app/(public)/layout.tsx` | e2e `app-shell.spec.ts:25-32` becomes: on `/login` and `/pin` the band shows "Osteria Dei Rossi" **and** has no `a[href="/"]` (a different requirement asserted at the same strictness: presence of the band text plus absence of the link) |

**VC — One contact is enough for a booking (= strategy V5)** · Trigger: Q-UX7 answered "phone or e-mail" · Replaces: none (adds after QW2)
| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| VC.1 | The request schema and `missingFields` accept phone **or** e-mail; the message reads "Manca: telefono o e-mail" | `src/server/reservations/public/*` (request schema), `src/lib/reservations/request-check.ts`, i18n | API test: phone-only and e-mail-only both accepted, neither refused. `request-check.test.ts`: both missing → "telefono o e-mail" |

**VD — "Invia tutto" in the leave sheet** · Trigger: Q-QW3 answered "one button for everything" · Replaces: the per-course buttons in QW12
| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| VD.1 | The sheet has one primary "Invia tutto · n" that queues one fire per course, in service order, then leaves | `leave-sheet.tsx` | `tests/components/leave-sheet.test.ts`: two courses → two `queueFire` calls in service order with the right ids, then `go` |

**VE — No name in the band** · Trigger: Q-QW5 answered "no" · Replaces: the name in `AccountControl` (QW6)
| # | Step (one commit) | Files | Test that proves it |
|---|---|---|---|
| VE.1 | `AccountControl` shows only "Esci"; its accessible name stays "Esci" and a `title` is not used | `account-control.tsx` | `tests/components/account-control.test.ts`: the band text has no `displayName`; one "Esci" |

### 5c. Existing assertions that change (each stricter or equal)

| Spec or test (file:line) | Step | Before | After | Why it is not weaker |
|---|---|---|---|---|
| `e2e/reservations-public.spec.ts:130-132` | QW2 | "Invia richiesta" `toBeDisabled()` before the tick | Click "Invia richiesta" before the tick: `role=alert` has "Manca: conferma dell'informativa privacy"; no POST to `/requests` within the action (listener); focus is on the privacy checkbox; name, phone and e-mail keep their values. Then tick and continue as today | Same guarantee (nothing is sent without the tick) plus the message, the focus and the kept values |
| `tests/components/reservation-request.test.ts:205-212`, `:214-220` | QW2 | Button disabled until the tick, and until a time and fields are set | Button enabled after hydration; a click with gaps sends no POST and names exactly the missing fields; with everything filled the POST goes as in `:234-268` | "No request while incomplete" stays asserted (by call count), and the named fields are asserted too |
| `e2e/order-entry.spec.ts:190`, `:246` | QW5 | `toHaveText("Comanda · 8 righe")` | `toHaveText("Comanda · 8 righe · 8 da inviare")` | Exact match, now also on the unsent count. `:168` ("Comanda", no lines) unchanged |
| `tests/lib/orders/order-view.test.ts:189-192` | QW5 | "Comanda · 3 righe", "Comanda · 1 riga", "Comanda" | The exact new strings for the same fixtures ("… · n da inviare" where the fixture holds non-segue drafts; `LINE_SOUP` is segue, `tests/helpers/orders-data.ts:45`) | Exact strings, more information |
| `tests/components/order-sheet.test.ts:28`, `:60`, `:121`; `tests/components/order-page.test.ts:135`, `:369`, `:491` | QW5 | Button names "Comanda · n righe" | The same names with the exact suffix | Exact names |
| `e2e/offline.spec.ts:204-207` | QW12 | Click "← Tavoli", then wait for `/tavoli` | Click "← Tavoli" → expect dialog "1 piatto non inviato" with "Invia bevande · 1" → click "Esci comunque" → wait for `/tavoli`. The rest is unchanged | Same end state, plus the warning asserted |
| `e2e/invoice-upload.spec.ts:162-164` | QW10 | Row click → heading on the detail page and a "Rivedi le righe" link | Row click → URL is exactly `/fatture/<id>/revisione` and the review heading "Fornitore Demo Srl · 123/A" is visible; then `page.goto("/fatture/<id>")` still shows "Rivedi le righe" | The old assertion is kept on the detail page; the URL is now pinned too |
| `tests/components/home-today.test.ts:348-365` | QW4, QW6 | Chain h1, strip, dashboard, first action, steps, card, Esci | Chain h1, strip, first action, last action, dashboard, steps, card; plus `queryByRole("button", {name: "Esci"})` is null inside the page. "Esci" presence moves to `account-control.test.ts` and `app-shell.test.ts` (banner) | Full order still asserted; "Esci" is asserted where it now lives, for every role |
| `tests/components/home-links.test.ts:123-127` | QW6 | Home has one `lg:hidden` "Esci" | Home has no "Esci"; `app-shell.test.ts` asserts one "Esci" in the banner, `lg:hidden` | Moved, same strictness |
| `tests/components/tables-page.test.ts:120-121`, `:125-139` | QW6 | The waiter's in-page "Esci" is the signal that the role is known; only the waiter gets it | Signal: `apiJson` called with `/api/me` and the tiles rendered; then the absence of "Impostazioni" for the waiter as today. No role gets an in-page "Esci" | Same absences asserted after a real "role known" signal; the banner "Esci" is asserted in `app-shell.test.ts` |
| `tests/lib/nav/today-actions.test.ts:37-43`, `:50-…`, `:63-…` | QW3, QW7, QW9 | Exact href lists for owner, admin, chef | The exact new lists (owner and admin gain `/prenotazioni` and `/chiusura`; the chef's waste href becomes `/magazzino?azione=spreco`) | Exact equality kept |
| `tests/components/session-panel.test.ts:50-70` | QW11 | `aria-pressed` follows the state | Same, plus the single-primary check | Additive |
| `tests/server/dashboard/__snapshots__/output.test.ts.snap` | none | — | Not touched: QW3 does not change `/api/dashboard` (A1, A2) | — |

The comments at `e2e/staff-pin.spec.ts:170`, `e2e/menu-tables.spec.ts:195-196` and `e2e/offline.spec.ts:204` still describe in-page
"Esci" and are reworded. Their assertions do not change.

## 6. Risks and mitigations

- **R1. Changing screens before go-live.** Staff learn the app in the training session behind G3-4 (`docs/go-live/checklist.md:30`).
  - Mitigation: both PRs are merged and promoted **before that session** (Q-QW8).
  - `docs/guides/accesso-e-personale.md:13` is updated in QW6, the only guide sentence the steps contradict (Grep of `docs/guides/` for
    "Esci", "Altro", "Chiusura", "Invia richiesta", "Carica una fattura" and "Rivedi le righe").
  - No URL moves, so links in e-mails and alerts are unaffected.
- **R2. Deploy timing.** Neither PR has a migration (D1 preserves test), so a release is only a Vercel promote, and rollback is
  re-promoting the previous deployment.
  - Deploy outside service hours 11:00–24:00 (`docs/prd.md:430`; strategy Q-UX15 default), for example in the morning before 11:00
    Europe/Rome.
  - PR 1 changes the public booking page. Deploy it when no guest is likely mid-form; the morning is still the low point. That is an
    assumption, since there is no traffic data.
  - No date is promised here.
- **R3. E2E churn.**
  - Changed assertions are in §5c: 6 e2e locations in 4 specs and 9 unit or component files, all stricter or equal, each listed in its PR
    description.
  - `reservations-public.spec.ts` is slow and timeout-sensitive (`:31-38`). The QW2 change stays inside the existing "fill the form"
    phase and uses the spec's bounded timeouts.
  - Every spec that clicks "Esci" uses a page-wide role locator, so the move into the band keeps them green. The laptop spec stays at one
    "Esci" because the band control is `lg:hidden`.
- **R4. Header move (QW1).** Every page outside both groups would lose the band. Today that is only the default 404, so `not-found.tsx`
  adds it back (tested). `global-error.tsx` renders its own document and is unaffected.
  - The band now renders in a client shell. The service worker's cached shell HTML must still hold no staff name: `AccountControl`
    renders the name only after `/api/me`, so the SSR markup has none, and `pwa.spec.ts:31`'s privacy check stays green.
- **R5. The band gains a row on phones (QW6).** The wordmark width at 360 px was not measured, so the band uses `flex-wrap`. "Esci" may sit
  on a second row, about one 44 px row of height, also on focus routes.
  - Mitigation: the QW6 e2e checks no sideways scroll and that "Esci" is in the first viewport.
  - Order-entry's measured targets (`expectPhoneFriendlyBothThemes`) stay green.
- **R6. No measured baseline.** P0 runs after these fixes, so "before" numbers are code-counted only (§5a). Any regression in P0 is
  logged against the post-fix build. The P1 validation row in strategy §9.2 cannot run as written, and D1 notes this.
- **R7. Nagging leave warning.** Excluding segue drafts (Q-QW2 default) and per-course send buttons keep it to dishes that are ready to
  go. P0 observes whether waiters tap "Esci comunque" by reflex.
- **R8. A second tap with the same gaps is not announced again (QW2).** The message is already on screen and unchanged, so a screen reader
  does not repeat it, though focus still moves. Left as is for PR 1; P0 observes whether it matters.
- **Security and privacy:**
  - **QW3 returns a count only.** `{pending}`, role-checked in the route and again in Postgres (`require_day_closer`). The chef's Home
    never calls it (component test), and the e2e asserts no customer name on Home.
  - **The header shows only the signed-in user's own name** (QW6, VE as an option). Logout still clears the cached user and the service
    worker's read cache (`forgetUser`).
  - **QW2's check is UX only.** The server validates every field as today (`reservation-request.test.ts:294-321` keeps the server-error
    cases). The message names fields, never values.
  - **QW8's link is for the roles `POST /api/recipes` already allows.** The API stays the guard.
  - **Waiters never see costs; the chef never sees €.** No step adds money to any screen. The chef-words test in
    `today-actions.test.ts` and `app-shell.spec.ts:320-328` stay green.
  - **CSP.** No inline style or script is added (ADR-028 unchanged; `security-headers.spec.ts` green).
  - **Secrets.** No new secret. App secrets stay in Vercel environment variables, database-side secrets in Supabase Vault
    (`docs/guides/cron-vault-secrets.md`), CI secrets in GitHub environments, and provider logins in the account owners' password
    manager (strategy §9c).
- **Performance and cost:** one extra small GET on the owner and admin Home (QW3). No other request is added.
- **Dependencies:** none.

## 7. Open questions for the founder

| # | Question | Default |
|---|---|---|
| Q-QW1 | One PR or two? | **Two:** PR 1 booking page (D1, QW1, QW2) on `feat/ux-quick-wins`, then PR 2 staff (D2, QW5, QW6, QW12, QW3, QW7, QW4, QW8, QW9, QW10, QW11) on `feat/ux-quick-wins-staff`, cut from `main` after PR 1 merges. Reasons: the guest page faces the public and holds personal data; its e2e is the slowest; it can ship and be rolled back alone; QW6 builds on QW1's header move, so the order is fixed |
| Q-QW2 | Should dishes marked "a seguire" (held on purpose) count as "da inviare" and trigger the leave warning? | **No.** M19 keeps them as drafts until the waiter calls them (`m19-firing.md:91`), and closing the table already refuses any draft (`close_table.sql:63-69`). VA if yes |
| Q-QW3 | In the leave sheet: one "Invia" per course, or one "Invia tutto"? | **Per course**: secondi should not go with the antipasti by accident. VD if one button |
| Q-QW4 | Order of the new Home rows (§3.4) and moving the actions above the figures (your item 4, which changes ADR-030 decision 4) | **As in §3.4**, recorded in ADR-041 (D2) |
| Q-QW5 | Show the signed-in person's name next to "Esci" in the header? | **Yes**: on a shared kitchen phone it shows who is signed in. VE if no |
| Q-QW6 | On `/login`, `/pin` and `/dispositivo`, keep the name as a link to Home (it leads back to the sign-in)? | **Keep** (unchanged; only the booking page loses the link). VB if unlink all |
| Q-QW7 | Wording: "Manca: telefono" / "Mancano: telefono, e-mail", "2 piatti non inviati", "Esci comunque", "Resta al tavolo", "Chiusura del giorno", "Prenotazioni da confermare · 2" | **As written**; you may change any word before PR 1 or PR 2 |
| Q-UX7 | Must guests give both phone and e-mail? (carried from the strategy) | **Keep both**; QW2 says what is missing. VC if one is enough |
| Q-QW8 | When do we deploy? | **Both PRs before the waiter training session (G3-4) and before 2027-01-12, outside 11:00–24:00.** You set the dates; none is promised here |
| Q-QW9 | Drop G2 from the pre-go-live set? | **Yes**: it needs the `tap-comfort` token (P2) and stays in P7 |
| Q-QW10 | Accept that P0 measures the build after these fixes, so the "before" numbers here are counted from the code only? | **Yes** |
| Q-UX21 | PIN sign-in and WCAG 2.2 SC 3.3.8. Checked as the strategy asked: the PIN field does not block paste but sets `autocomplete="off"` (`pin-pad.tsx:44`), which discourages password managers. Staff accounts can also use the magic link (`e2e/*` signs waiters in with `signInWithMagicLink`), but whether every waiter has an e-mail address is not known. So whether an exception holds is **still not determined** | **No change before go-live** (it touches the sign-in security model, not a quick win). Revisit in the P3 plan |
