# UX: designs, specs and their status

The UX/UI designer's specs for Costì (DigiAlto's product) and its first venue, Osteria Dei Rossi. The designer writes Markdown and Figma
only; the lead merges these docs and hands approved specs to the builder. Go-to-market work may reuse any screen marked **approved**.

**Status words.** *draft*: written, not yet seen by the founder · *approved*: the founder said yes (date) · *in build*: handed to the builder ·
*built*: on `main` (PR or commit).

| Spec | Scope | Look | Status | Figma | Built |
|---|---|---|---|---|---|
| [costi-design-system.md](costi-design-system.md) | **One design system for the whole app** (founder, 2026-11-14): foundations, components, the venue layer (name, logo, accent), Figma → code mapping, re-skin order | Costì | founder decision 2026-11-14; layer and order for the lead | library built (Starter plan; osteria collections to retire) | tokens, fonts, scope: PR #88; re-skin not started |
| [costi-sign-in.md](costi-sign-in.md) | Sign-in (owner, staff PIN), device enrolment, two-step pages; proposals S1–S4 | Costì | reference; S1–S3 accepted, S4 later (lead, 2026-11-14) | to create | built (PRs #87, #88); Costì-only band built (PR #112); S1–S3 in the small-fixes batch |
| [p2-2-trace-sell-through.md](p2-2-trace-sell-through.md) | Tracciabilità, lot nudge on invoice review, "Com'è andata", booked covers (plan PR #91) | Costì + venue layer | approved by the lead (D1–D7), 2026-11-14 | [venue page](https://www.figma.com/design/4QuajvzZM0J4lSBCOm5Q02?node-id=1-5): search screens (3 of ~14); rest blocked (Figma limit) | in build |
| [p3-sala-waiter.md](p3-sala-waiter.md) | Waiter: grid with "Da inviare", one-tap send bar, high contrast, tap-comfort (W1–W4) | Costì + venue layer | approved by the lead: W-a–W-c as P3 design, W-d to small fixes (2026-11-14) | to create | built (PR #109) except W2 and W-c (wait for `unsentCount` in `/api/tables`); checked by the designer, §9 |
| [p4-cucina.md](p4-cucina.md) | Chef Home card "Comande aperte", kitchen screen, recent recipes, one waste screen (K1–K3) | Costì + venue layer | approved by the lead: K-b, K-d; K-a, K-c after P0 (2026-11-14) | to create | P4 after go-live and P0; K-b in the small-fixes batch |
| [p5-owner.md](p5-owner.md) | Owner Home "Da fare ora" (counts only), "Chiusura di ieri", shortcuts (O1, O2); O-a–O-c | Venue | approved by the lead: O-a–O-c (2026-11-14); Q-UX-O2 with the founder | to create | not built (P5, after go-live and P0) |
| [p7-guest-booking.md](p7-guest-booking.md) | Guest booking: times as tap-comfort buttons with a status line, one green on the page, summary after sending (G1, G2); G-a–G-c | Venue | approved by the lead: G-a, G-b to small fixes; G-c with P7 (2026-11-14) | to create | G-a, G-b in the small-fixes batch; rest P7 |
| [p2-7-xml-invoice-upload.md](p2-7-xml-invoice-upload.md) | XML e-invoice upload: upload choice, refusals, "Dati dal file XML", notes, new supplier, "Usa il file XML al posto del PDF", "Usa come lotto / scadenza" (plan PR #103); Y1–Y10 | Venue | approved by the lead: Y1–Y10 (2026-11-14) | to create (Figma limit) | in build (P2-7) |
| [costi-console.md](costi-console.md) | Costì · Console (platform admin): sign-in on the console host, Locali list, venue detail (status, plan, modules, health, usage, DigiAlto activity, data), platform audit, notices; C1–C9 | Costì | approved by the lead: C1–C9 (2026-11-14); Q-UX-C1, C5 with the founder | to create (Figma limit) | not built (SP3 onward) |

**One design system (founder, 2026-11-14).** Every screen is Costì; a venue adds only its name, logo and accent colour to the band
(`costi-design-system.md` §1, §9). Where an older spec says "venue look" or "osteria theme", read "Costì + the venue layer"; its layout,
order, states and wording are unchanged.

## Figma file

[**Costì — design system**](https://www.figma.com/design/4QuajvzZM0J4lSBCOm5Q02) (team "Digialto Marketing's team", Starter plan). Pages: 1 Library
(Cover, Foundations, components) · 2 Product screens (Costì) · 3 Venue screens (osteria theme). Starter limits shape the file: 3 pages, 1 mode
per variable collection (so each theme is its own collection, see `costi-design-system.md` §8), and a monthly cap on Figma MCP tool calls,
which stopped work on 2026-11-14 after the library and the first three P2-2 screens.

## Planned, in this order (founder, 2026-11-14)

1. Costì product screens: sign-in (password, e-mail code, PIN), device enrolment, staff e-mail.
   (P2-2 screens were specified first, 2026-11-14, at the lead's request, so the builder has them when that plan is approved.)
2. Venue screens by role: Sala (waiters), Cucina, owner, following the UX strategy phases P3–P5
   (`docs/plans/2026-11-13-ux-strategy.md` §9).
3. New-venue onboarding (A2) and the guest booking page (P6, P7).

## Sources every spec uses

- Product brand: DigiAlto-Ops `knowledge/agency/products/costi/brand.md`; venue facts: `docs/client-facts.md`.
- `docs/design/ui-foundation.md` (house style; §11 Costì tokens), ADR-042 (product scope), `docs/plans/2026-11-13-ux-strategy.md`.
- New Italian wording is marked **(da approvare)** until the copywriter drafts it and the founder approves it.
