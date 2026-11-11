# Client facts this project may use

Copied from DigiAlto-Ops `knowledge/clients/osteria-dei-rossi/profile.md`. Only approved lines
(no unverified marker). Update here when the profile changes; never add facts that are not there.

**Status 2026-11-11:** the trading name, brand colours and fonts (2026-10-22) and the legal name, VAT number and registered
address (2026-11-11) below are approved. Everything else in the profile is still unverified, so nothing else client-specific may appear in UI text,
seed data or fixtures. Use obviously fake values (e.g. "Osteria Demo", VAT `IT00000000000`) for
the rest until the founder approves it and it is copied here.

- Client slug: `osteria-dei-rossi` (identifier only, not a fact)
- Trading name: Osteria Dei Rossi (founder-approved 2026-10-22)
- Domains:
- Brand colours (hex): cream #FFFADF, cream-deep #F8EFC6, green #1C4130, gold #C89550, olive #7D9550, soft #4D5B45, black #0F0F0D, yellow #FFB028 (founder-approved 2026-10-22; source: menu-site capture 2026-10-22)
- Fonts: Bodoni Moda (display/titles), Figtree (body) (founder-approved 2026-10-22)
- Integrations approved (payments, booking, analytics):
- Tracking approved:
- Legal name: ML SNC DI LANARO E FRESI (DigiAlto-Ops profile, founder 2026-11-11)
- VAT number: IT00354250524 (DigiAlto-Ops profile, founder 2026-11-11)
- Registered address: Via dei Rossi 79/81, 53100 Siena (SI), Italy (DigiAlto-Ops profile, founder 2026-11-11; also the venue address)
- Privacy contact e-mail: [PENDING founder]
- Booking hours per service: [PENDING founder]

The legal name, VAT number, privacy contact and booking hours are the reservations feature's (plan `docs/plans/2026-11-08-reservations.md` §3.7, §3.9): the
privacy notice of the public booking page needs the legal name, the VAT number and the privacy contact, and the page needs the booking hours of each service. The legal
name, VAT number and registered address are approved (founder 2026-11-11); the privacy contact and the booking hours are still pending, so the notice is not complete.
All of them reach production only as tenant settings that the owner enters on "Tavoli, impostazioni", never from this file or the code, and never in seed data or
fixtures. Another number given with the legal name (01358391) has no confirmed meaning and must not be used.

Not approved (do not use as facts): other colours in the menu-site capture, Source Serif 4,
phone and socials, menu items, prices and allergens (see `docs/client/`, DRAFT), the logo.

## Draft client data (not approved facts)

Added 2026-10-22 from the founder's menu (chat) and the restaurant's website captured that day.
The founder approved them **only as a draft**. They are **not** approved facts under the rule
above: do not use them in UI text, seed data or fixtures until DigiAlto-Ops records them and the
lines are copied into the list above.

| File | Content | Status |
|---|---|---|
| [`client/menu-draft.md`](client/menu-draft.md) | Menu with codes, prices, units, variants, per-etto items, "Consigliato dall'Oste", venue info and coperto (draft), allergens derived vs site, founder/site differences | DRAFT, to confirm with founder and chef |
| [`client/recipes-draft.md`](client/recipes-draft.md) | Ingredients per dish and per semi-finished batch, no quantities; open questions for the chef | DRAFT, quantities to be filled in by the chef |
| [`client/ingredienti-draft.csv`](client/ingredienti-draft.csv) | Ingredient import file (M1 format), conservative allergens | DRAFT, allergens to confirm with chef and supplier labels; test tenant only |
