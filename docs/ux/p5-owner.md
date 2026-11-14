# Screens: P5 Owner (Home "Da fare ora" and the day close)

- **Status:** draft · **Author:** UX/UI designer · **Date:** 2026-11-14
- **Spec for:** UX strategy phase **P5** (`docs/plans/2026-11-13-ux-strategy.md` §9.3, steps **O1, O2**), on top of `main`: ADR-041's Home
  order, QW3 (booking requests count), QW4 (actions above the tiles), QW7 ("Chiusura del giorno" on Home, founder decision D1).
- **When:** after go-live and P0; validated on T-O1–T-O4 (strategy §9.1).
- **Look:** venue (osteria theme). Counts only on "Da fare ora": **no personal data and no money** in that list (strategy §5).

## 1. The owner's question

"Does anything need me today?" (job J12). Today Home answers it in four places: the alert strip, one badge under the primary, a badge
on some rows of an eight-row action list, and the "Andamento" tiles. P5 gives it **one answer, at the top, in words**.

## 2. Home, owner, after P5

```
┌──────────────────────────────┐ 360
│▓ OSTERIA DEI ROSSI  Anna Esci │
├──────────────────────────────┤
│ Ciao, Anna                h1 │ home.greeting
│ [!] Avvisi (3 più recenti)   │ alert strip, as today (acknowledge in place)
│                              │
│ Da fare ora               h2 │ O1 (da approvare)
│ ┌──────────────────────────┐ │
│ │ Fatture da rivedere    2 › │ → /fatture (review rows first, QW10)
│ │ Prenotazioni da confermare 1 ›│ → /prenotazioni (QW3 count)
│ │ Pagamenti scaduti      1 › │ → /pagamenti
│ │ Chiusura di ieri: da fare ›│ → /chiusura on yesterday (O2)
│ └──────────────────────────┘ │
│ [   Carica una fattura    ]  │ primary (unchanged)
│ Scatta una foto o scegli un file.
│                              │
│ Vai a                     h2 │ shortcuts, no badges
│ Comande ›  Tavoli ›  Menu e prezzi ›
│ Pagamenti ›  Costi dei piatti ›  Chiusura del giorno ›
│                              │
│ Andamento                 h2 │ dashboard tiles, as today
│ …                            │
│ [ Osteria Dei Rossi · Titolare ] account card
└──────────────────────────────┘
```

### O1 · "Da fare ora"
- **Only items that need the owner now**, each a full-width row link (≥ 44 px): label, count right-aligned in `.num`, chevron. An item with
  0 is **not listed**.
- **Order (fixed):** fatture da rivedere → prenotazioni da confermare → pagamenti scaduti → chiusura di ieri. Money-critical and
  time-critical first; the order never moves with the counts, so the owner learns where to look.
- **All clear:** one line, "Niente da fare ora." (da approvare), with the success dot and the word. No empty box.
- **Alerts are not repeated here** (proposal O-a): the strip above already lists them with their own count and acknowledge button.
- **Loading:** the box keeps its height with "Caricamento…"; **error:** the existing one notice "dashboard.error" + "Riprova", and the
  shortcuts still work.
- **No new request:** the counts come from the reads Home already makes: the `/api/dashboard` cards (invoices, payables) and QW3's
  `GET /api/reservations/pending-count` (bookings). O2 adds one key to the dashboard reply.

### O2 · "Chiusura di ieri"
- From the server (`dayCloseDone` for the previous business day, ADR-033). Not done → the row "Chiusura di ieri: da fare" in "Da fare
  ora", opening `/chiusura` **on yesterday's date**. Done → no row.
- Before the business day ends (02:00 cut-off), today's close is not "da fare": the row only ever names **yesterday**, so the owner is
  never nagged mid-service.
- "Chiusura del giorno" stays in **Vai a** at all times (founder decision D1: the day close lives on Home).

### "Vai a" (shortcuts)
- The rest of today's action list, as plain links in a wrapping row of 44 px text links, **without badges** (their counts moved up).
  Proposal O-b: a two-column grid of text links rather than the eight-row list, so "Andamento" comes into the first or second screen.
- Admin: same pattern with the admin's own actions (Personale primary); the admin has no alerts strip.

## 3. `/chiusura` opened from "Da fare ora"

The existing day-close screen, opened with `?data=<ieri>`; the page already reads that parameter (`chiusura/page.tsx`, `DayCloseRoute`),
so the `DayPicker` starts on the right day with no change. After a successful save it shows
the existing confirmation and a text link "Torna alla Home" (da approvare); Home then no longer lists the row.

## 4. Proposals and the lead's decisions

**Decided by the lead, 2026-11-14:** O-a, O-b and O-c accepted as the P5 design (built after go-live and P0). Q-UX-O2 is with the
founder; "overdue only" is in force until they answer.

The original proposals:

| # | Proposal | Why |
|---|---|---|
| O-a | "Da fare ora" does not repeat alerts; the alert strip stays the place for them | The strategy's O1 lists alerts too; repeating them is a duplicate path (strategy F14) and two counts of the same thing |
| O-b | "Vai a" as a two-column grid of text links, no badges | Shorter page; counts live in one place |
| O-c | Fixed order of the "Da fare ora" rows, items with 0 hidden | Predictable spot; nothing to read when nothing is due |

## 5. Open questions

| # | For | Question | Default |
|---|---|---|---|
| Q-UX-O1 | Lead | Accept O-a–O-c? | Yes |
| Q-UX-O2 | Founder (via the lead) | Should "Pagamenti in scadenza questa settimana" also appear, or only overdue ones? | Only overdue (less noise); the payables page shows the week |
