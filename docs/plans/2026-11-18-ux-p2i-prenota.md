# P2i — Costì re-skin step 8: guest booking `/prenota/<slug>` (costi-design-system §11)

- **Date:** 2026-11-18 · **Branch:** `feat/ux-p2i-prenota` · **Pattern:** P2d–P2h
- **Spec:** §1 table, row "Guest booking `/prenota/<slug>`, guest e-mails": Costì values, venue layer **yes**, **no Costì logo or name shown to
  guests**, the band shows the venue's name with no link.
- **Scope:** UI only (`src/app/(public)/prenota/**`, `src/components/**`, `tests/**`, `e2e/**`).

## What the guard says
Raising `DONE` to 8 in `tests/components/costi-theme-order.test.ts` fails on:
1. `prenota/[slug]/page.tsx` and `prenota/[slug]/annulla/page.tsx` do not render `<CostiTheme />`.
2. `prenota/[slug]/slot-picker.tsx` has a hand-made `role="tablist"`. It becomes `SegmentedControl`, with manual activation, the house default.
3. `prenota/[slug]/annulla/cancel-view.tsx` has a hand-written `<dl>`. It becomes `FactList` / `FactRow`; use `figure` for dates, times and
   party size.

## Steps (one commit each, test first)
1. **Guard:** raise `DONE` to 8 (red).
2. **Marker:** add `<CostiTheme />` to both guest pages. Guests must not see Costì:
   - the tab title stays the venue's name;
   - no `img[alt="Costì"]` and no "Costì" text anywhere on the page;
   - the band keeps the venue name with no link.

   Unit-test all three on both pages.
3. **Slot picker → SegmentedControl:** keep every behaviour the current tests and e2e pin: labels, selection, keyboard, `aria-controls`
   to a real panel, and the request form's field. Grep `e2e/reservations-public.spec.ts` and `tests/` for the slot picker's roles,
   names and testids.
4. **Cancel view → FactList:** keep every testid and the left-out rule. Figures (date, time, covers) use `figure`.
5. **e2e pins move from cream to Off-white:** these checks now expect Costì on the guest page:
   - `product-brand.spec.ts` "an unknown booking address keeps the venue's cream…": the body becomes Off-white, and the title,
     no-Costì-logo, band and theme-color checks stay;
   - `reservations-public.spec.ts:261`;
   - `app-shell.spec.ts` coexistence test: the guest page is now Off-white. The one cream screen left is the 404 (§11 step 9),
     which `product-brand.spec.ts` already pins.

   Grep `e2e/` and `tests/` for `255, 250, 223`, `cream` and `/prenota` before pushing.
6. **e2e `prenota-theme.spec.ts`:** follow `gestione-theme.spec.ts`, signed out:
   - light and dark on `/prenota/<slug>` (a seeded slug, as `reservations-public.spec.ts` gets one) and on the unknown-slug page;
   - checks: Off-white or Charcoal body, Forest band, Montserrat h1, the venue tab title, no Costì name or logo;
   - the primary («Invia richiesta» or the real label) is readable;
   - any new browser launch passes `channel: "chromium"` (`tests/config/e2e-chromium-channel.test.ts`).

## Not in this PR: build queue for builder 1
**Guest e-mails** (`src/server/reservations/mail/templates.ts`, server-only) still use the osteria palette:
- link colour `#7a1f1f`, ink `#222`, muted `#666`, Arial.

Moving them to Costì values (Charcoal ink `#1F2933`, the muted ink, Forest or ink links, no Costì name) is the e-mail half of step 8. I
can't change `src/server/`, so it goes to the lead as a build-queue item.

## Risks
- The slot picker swap could break the e2e booking flow. Keep the accessible names the specs use.
- Guests seeing "Costì" would break the spec. The unit test and the e2e both assert there is none.
