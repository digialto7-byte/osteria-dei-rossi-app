# Screens: P7 Guest booking (`/prenota/<slug>`)

- **Status:** draft · **Author:** UX/UI designer · **Date:** 2026-11-14
- **Spec for:** UX strategy phase **P7** (`docs/plans/2026-11-13-ux-strategy.md` §9.3, steps **G1, G2**), on top of `main`: QW1 (the venue
  name with no link into the staff app) and QW2 (the form names what is missing and keeps typed values).
- **Look:** **venue** (osteria theme now; the tenant's theme once P2's tenant themes exist, G1). Never Costì: guests book the osteria, not
  the product (lead decision Q-CB6, variant VD). The tab title is the venue's name.
- **Facts:** the privacy contact and the booking hours are still `[PENDING founder]` in `docs/client-facts.md`; nothing here invents them.
- **Who:** a guest on their own phone, no training, one visit (strategy §1). Italian first, English by the language switch.

## 1. The flow (T-G1: request a table for 2)

```
date ─ party ─ (service tab) ─ time ─ name ─ phone ─ e-mail ─ privacy ✓ ─ Invia richiesta ─ "Richiesta inviata"
```
6 taps + OS date picker + 3 typed fields today (strategy §3.2). P7 does not add a step; it makes each one clearer.

## 2. The form

```
┌──────────────────────────────┐ 360
│▓ OSTERIA DEI ROSSI ▓▓▓▓▓▓▓▓▓▓│ band: venue name, no link (QW1)
├──────────────────────────────┤
│ Italiano  English            │ language switch (current in bold, aria-current)
│ Osteria Dei Rossi         h1 │
│ Richiedi una prenotazione    │ G-b: ink, not muted (it is the page's purpose)
│ Scegli data, persone e orario. Ti risponderemo via e-mail.  (muted)
│                              │
│ Data      [ 21/11/2026     ] │ native date
│ Persone   [ 2            ▾ ] │ "Più di <max>" → call text with a tel: link
│                              │
│ [ Pranzo ] [ Cena ]          │ service tabs (only if > 1 service)
│ ┌────┐┌────┐┌────┐           │ times, 3 per row, ≥ tap-comfort (G2)
│ │19:30││20:00││20:30│        │ chosen: pressed, ink fill + ✓ (G-a)
│ └────┘└────┘└────┘           │ taken: disabled, "20:30, non disponibile" for SR
│ Orario scelto: 20:00, Cena   │ G2: role=status line (da approvare)
│                              │
│ Nome      [                ] │
│ Telefono  [                ] │ type=tel
│ E-mail    [                ] │ type=email
│ Usiamo nome, telefono ed e-mail solo per gestire la tua richiesta.
│ Leggi l'informativa ▸        │
│ [✓] Ho letto l'informativa privacy
│ [!] Manca: orario            │ QW2: names what is missing, focus moves there
│ [      Invia richiesta     ] │ the ONE primary
└──────────────────────────────┘
```

### G2 · times
- Time buttons sized `tap-comfort` (the token comes from P2/P0; until then 44 px stays), 3 per row at 360 px.
- After a pick, a **status line** "Orario scelto: 20:00, Cena" (`role="status"`, da approvare) is announced to screen readers and sits
  under the grid, so the choice is confirmed in words once the guest scrolls on. `aria-pressed` on the chosen time stays (regression test).
- A taken time stays visible but disabled, with its accessible name "20:30, non disponibile" (`publicReservation.slotUnavailable`), so the
  grid keeps its shape and the guest sees the evening is busy rather than empty.

### G-a · one green on the page (proposal)
Today the **chosen service tab** and the **chosen time** use the primary (green) fill, and so does "Invia richiesta": three green controls
at once. Make the chosen tab and the chosen time **ink fill + ✓**, keeping `aria-selected` / `aria-pressed` — the same rule as the waiter's
course tabs (W-a, accepted) and QW11. Green then means only "send".

### G1 · the venue's own look and name
When per-tenant themes exist (P2: DS5, DS6), the page wears the venue's theme and name from the tenant record; two test tenants show
their own name and accent (strategy G1 test). Until then: the osteria theme, unchanged.

## 3. After sending

```
Osteria Dei Rossi                h1
✓ Richiesta inviata: ti scriveremo via e-mail appena confermata.   SuccessNote role=status
  Sabato 21 novembre · 20:00 · 2 persone          G-c: a summary of what was asked (da approvare)
  Ti scriveremo a m•••@esempio.it                  G-c: the address, masked
```
- **Proposal G-c:** repeat what was asked (day, time, party) and where the answer goes, with the e-mail **masked** on screen (the guest typed
  it; masking keeps it off a shoulder-surfer's view and off screenshots). Nothing else of the guest's data is shown.
- No link to the staff app, and no "book again" button (one request per visit is the normal case; the browser's back works).

## 4. States

| State | What shows |
|---|---|
| Loading the page | "Caricamento…" |
| No date chosen | "Scegli una data per vedere gli orari." |
| Closed that day | "Quel giorno siamo chiusi. Scegli un'altra data." |
| No time free | "Nessun orario disponibile per questa data. Prova un altro giorno." |
| Loading times | "Cerco gli orari…" |
| Party above the maximum | "Per gruppi più numerosi chiamaci al <tel: link>" (or "contattaci direttamente" with no phone fact) |
| Missing fields on submit | QW2: one `ErrorAlert` "Manca: …" / "Mancano: …", focus to the first; typed values kept |
| Sending | the button reads "Invio in corso…" and is off |
| Server error | `ErrorAlert` above the button; everything typed is kept |

## 5. Proposals and the lead's decisions

**Decided by the lead, 2026-11-14:** G-a and G-b accepted into the **pre-go-live small-fixes batch** (the page is guest-facing from
go-live). G-c stays with P7.

The original proposals:

| # | Proposal | Why | When |
|---|---|---|---|
| G-a | Chosen service tab and time: ink fill + ✓, not green | One primary per page; same rule as W-a and QW11 | Small; could join the pre-go-live small fixes, since the page is live for guests from go-live |
| G-b | "Richiedi una prenotazione" in ink, not muted | It is the page's purpose, not a hint | XS, with G-a |
| G-c | Summary of the request after sending, e-mail masked | The guest sees exactly what was asked and where the reply goes | P7 |

## 6. Open questions

| # | For | Question | Default |
|---|---|---|---|
| Q-UX-G1 | Lead | Accept G-a–G-c, and G-a/G-b before go-live? | Yes |
| (Q-UX7) | Founder | Phone **and** e-mail both required (today), or one is enough (V5)? | Both (strategy default; not decided yet) |
