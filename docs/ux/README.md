# UX: designs, specs and their status

The UX/UI designer's specs for Costì (DigiAlto's product) and its first venue, Osteria Dei Rossi. The designer writes Markdown and Figma
only; the lead merges these docs and hands approved specs to the builder. Go-to-market work may reuse any screen marked **approved**.

**Status words.** *draft*: written, not yet seen by the founder · *approved*: the founder said yes (date) · *in build*: handed to the builder ·
*built*: on `main` (PR or commit).

| Spec | Scope | Look | Status | Figma | Built |
|---|---|---|---|---|---|
| [costi-design-system.md](costi-design-system.md) | Foundations, components and the product/venue rule | Costì | draft (2026-11-14); Q-DS1–4 on defaults (lead) | to create | Tokens, fonts, scope: PR #88 |
| [costi-sign-in.md](costi-sign-in.md) | Sign-in (owner, staff PIN), device enrolment, two-step pages; proposals S1–S4 | Costì | draft (2026-11-14) | to create | built (PRs #87, #88); S1–S4 not built |
| [p2-2-trace-sell-through.md](p2-2-trace-sell-through.md) | Tracciabilità, lot nudge on invoice review, "Com'è andata", booked covers (plan PR #91) | Venue | approved by the lead (D1–D7), 2026-11-14 | to create | in build |

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
