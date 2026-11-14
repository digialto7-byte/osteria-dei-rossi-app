# Screens: P2-2 Trace and sell-through

- **Status:** draft for founder approval · **Author:** UX/UI designer · **Date:** 2026-11-14
- **Spec for:** `docs/plans/2026-11-14-p2-2-trace-sell-through.md` (PR #91, architect), §3.6 and §3.8. The plan owns the data, the API and
  the roles; this file owns **layout, order, states and wording** of the screens. Where this file proposes something different from the
  plan, it says so in §8 and the lead decides.
- **Look:** venue screens, so the **osteria theme** (`docs/design/ui-foundation.md` §1–§7), never Costì (`docs/ux/costi-design-system.md` §1).
- **Rules used everywhere here:** 360 px first; one primary action per screen; every target ≥ 44 px; amounts `1.234,50 €`; dates and times
  Europe/Rome, grouped by **business day** (02:00 cut-off); every value from `/api/*`; status always in words, never colour alone; a gap is
  said, never guessed (plan D-P3). Waiters see none of the trace or sell-through screens.
- **Wording.** Strings already in `it.ts` are quoted with their key. Every other Italian string here is the plan's draft and is
  **(da approvare)** until the copywriter and the founder approve it. English is the second locale, as everywhere.

## 1. Who sees what

| | Owner | Admin | Chef | Waiter |
|---|---|---|---|---|
| Tracciabilità (search, lot, batch, plate) | yes, with invoice link and supplier article | yes, as owner | yes, **no invoice, no article, no money** | no |
| Lot nudge on invoice review | yes | yes | n/a (no invoice access) | no |
| "Com'è andata" on Da spingere | yes, with day price | yes, as owner | yes, **no day price** | no |
| Booked covers on Produzione | yes | yes | yes (counts only) | already sees bookings in Sala |

No screen in this spec shows guest names, phones or e-mails, for any role.

## 2. Flows

### F1 · A recall letter arrives (owner or chef; the main job)
```
Cucina › Tracciabilità ─ tab "Da un lotto" ─ type code "L-2311" ─ Cerca
   └─ results (1 row usually) ─ tap row
        └─ Lotto: summary → Lotti di produzione → Piatti serviti → Scarti → Ancora in magazzino
              └─ tap a batch ─ Produzione: "Dove è andato"
```
Target: **4 taps + 1 typed field** from the Cucina tab to the answer "what did we make and serve with it". Back always returns to the
previous list with the search kept (the query lives in the address: `?lotto=L-2311`).

### F2 · A guest complains about a dish (owner or chef)
```
Tracciabilità ─ tab "Da un piatto servito" ─ Giorno (default yesterday) ─ Piatto (optional) ─ Cerca
   └─ list of plates served that day (table, time) ─ tap one
        └─ Piatto: its batches → the lots and suppliers behind them
```

### F3 · From a batch (chef, day to day)
`Produzione › batch` → link **"Tracciabilità"** → "Da dove viene" / "Dove è andato". From `Magazzino › ingredient` each lot row gets
**"Traccia"** → the lot page.

### F4 · Receiving an invoice (owner)
Invoice review: stock lines without a lot carry **"Lotto mancante"**; before **Approva**, one sentence counts them and offers
**"Mostra la prima"**. Approval is never blocked.

### F5 · The morning after a push (owner, chef)
Home › Da spingere → section **"Com'è andata"**, opened on **yesterday** → one card per pushed dish.

### F6 · Planning prep (chef)
Produzione → forecast panel: under the day chips, the **booked covers** per service for the chosen day.

## 3. `/tracciabilita` — search

Nav: **"Tracciabilità"** in Cucina, after Riordino (and after Margini for the chef). See §8 D2 for the six-pill limit.

```
┌──────────────────────────────┐ 360
│ ▒▒ OSTERIA DEI ROSSI ▒▒ Esci │ band
├──────────────────────────────┤
│ Comande Produzione Magazzino │ pills (Cucina)
│ Riordino [Tracciabilità]     │
│                              │
│ Tracciabilità            h1  │
│ ──                           │
│ [ Da un lotto | Da un piatto servito ]   segmented, role=tab
│                              │
│ Codice lotto                 │
│ [ L-2311                   ] │ 16 px, autocapitalize=characters
│ Basta l'inizio del codice.   │ hint (meta)
│                              │
│ ▸ Cerca per ingrediente o fornitore      disclosure (closed)
│                              │
│ [          Cerca           ] │ primary
│                              │
│ ─ Risultati ───────────── h2 │
│ L-2311-A          [Scade 20 nov]  badge
│ Farina Demo · Fornitore Demo 1 · consegna 13 nov
│ ──────────────────────────── │
│ Lotto senza codice           │
│ Farina Demo · Fornitore Demo 2 · consegna 9 nov
│                              │
│ ┌ Lotti registrati ────────┐ │ capture card
│ │ Ultimi 30 giorni: 18 su 25│ │
│ │ consegne con il lotto.    │ │
│ │ Per fornitore ▸           │ │
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

- **Segmented control** "Da un lotto" / "Da un piatto servito" (`role="tablist"`, as the comanda's tabs). The chosen tab is in the address
  (`?da=piatto`) so Back and a shared link reopen it.
- **"Da un lotto":** the code field is the default and first. "Cerca per ingrediente o fornitore" is a disclosure holding
  **Ingrediente** (select), **Fornitore** (select), **Dal** / **Al** (dates, default last 30 days). A recall letter almost always has a code;
  the disclosure keeps the common path short.
- **"Da un piatto servito":** **Giorno** (date, default yesterday, no future date) and **Piatto** (select, optional, "Tutti i piatti"). The
  result list: `13 nov · 21:14 · Tavolo 7 · Lasagne Demo · 1 porz.`; a voided plate carries the badge **"Annullato"** (neutral).
- **Result rows** reuse the stock lot row (`magazzino/[ingredientId]/lot-row.tsx`): code bold, expiry badge with its word, then one meta
  line `ingrediente · fornitore · consegna <data>`. The whole row is the link (≥ 44 px). Newest delivery first.
- **Capture card** (one `Card`): "Lotti registrati negli ultimi 30 giorni: 18 su 25 consegne"; "Per fornitore" opens a list sorted by most
  missing first: `Fornitore Demo 2 · 3 su 9`. Numbers only, no colour judgement.

**States**

| State | What shows |
|---|---|
| Before a search | The form and the capture card; no empty list |
| Loading | "Caricamento…" (`common.loading`) in the results slot; the form stays usable |
| No result | "Nessuna consegna trovata con questo codice." + "Prova con l'ingrediente o il fornitore" (opens the disclosure) |
| Truncated (`truncated`) | Under the list: "Mostro le 50 consegne più recenti. Restringi le date per vedere le altre." |
| Validation (400) | `ErrorAlert` next to the field: "Scrivi un codice lotto, o scegli un ingrediente o un fornitore." Focus moves to the code field |
| Future date / range too long (422) | `ErrorAlert` under the dates: "La data non può essere nel futuro." / "Scegli al massimo un anno." |
| 403 (a waiter by URL) | `ErrorAlert` "Questa pagina non è disponibile per il tuo ruolo." and no form |
| Offline | Not cached (plan §3.7): the offline banner, the form disabled with the sentence "Serve la connessione per cercare." |

## 4. `/tracciabilita/lotto/[id]` — forward trace

Order follows the recall question: **what was it → how much went where → the detail**.

```
‹ Torna alla ricerca                         BackLink
Farina Demo                              h1
──
┌ Lotto L-2311-A ─────────────────────┐   Card (fact sheet, dl)
│ Fornitore     Fornitore Demo 1       │
│ Consegna      13 nov 2026            │
│ Scadenza      20 nov 2026 [Scade tra 2 giorni]
│ Ricevuto      25 kg · Magazzino      │
│ Articolo      FD-00 · Farina 00 25kg │  owner/admin only
│ Fattura n. 418 del 13 nov ›          │  owner/admin only (link)
└──────────────────────────────────────┘
[!] Alcuni dati mancano: 2 produzioni di Farina Demo   info notice (only when gaps)
    hanno usato farina senza lotto dal 13 nov. Da verificare a mano.

Dove è andato                            h2
  In produzione      18 kg               dl, .num, right-aligned
  Nei piatti          2 kg
  Scartato          0,5 kg
  Conteggi         −0,5 kg
  Ancora in magazzino 4 kg

Lotti di produzione (3)                   h2
  Ragù Demo · lotto P-1114-02 ›           LedgerRow, link
  14 nov 09:40 · 6 kg da questo lotto · 40 porz. → 31 vendute, 2 scartate, 7 rimaste
  Ragù Demo · P-1114-02-B ›  [Diviso da P-1114-02]
  ...
Piatti serviti (per giorno)               h2
  14 nov · Lasagne Demo · 14 piatti (14 porz.) · 12:40–14:55
  14 nov · Pane Demo · 3 piatti · 20:05–21:30 · senza preparazione   (via:"direct")
Annullati dopo l'invio                    h2 (only if > 0)
  2 piatti (2 porz.)
```

- **Summary first.** "Dove è andato" is a `dl` fact sheet with `.num` figures in the lot's base unit, net of reversals. It answers the
  recall in one screen at 360 × 740 without scrolling past the card.
- **Sections only when they have rows**, except "Lotti di produzione" and "Piatti serviti", which say "Nessuna produzione con questo
  lotto." / "Nessun piatto servito con questo lotto." so the absence is explicit (a recall needs "none" said, not implied).
- **Plates** are grouped by business day, newest day first, one line per dish per day; times are first and last fire time. A plate that
  used the raw ingredient directly says "senza preparazione".
- **Gaps:** an info notice (`info` on `info-bg`, `role="status"`), never a warning colour alone. Two cases: "Il fornitore non ha indicato il
  lotto per questa consegna." (`gaps.lotCodeMissing`) and the unlotted-batches count above.
- **Truncated** lists end with "Mostro i primi 200. Il resto è nel registro completo." (no export in P2-2: V5).
- **Print.** A recall may be printed or shown to an inspector: the page prints light, one column, without the band's grain and the nav
  (existing print CSS). No new print layout.

## 5. `/tracciabilita/produzione/[id]` and `/tracciabilita/piatto/[lineId]` — backward trace

**Batch:** h1 = recipe name; fact card (lotto, prodotto il, scadenza, porzioni iniziali, stato with its badge word); then:
- **"Da dove viene"**: one row per input: `Farina Demo · 6 kg · lotto L-2311-A · Fornitore Demo 1 · consegna 13 nov ›` (link to the lot).
  Unlotted slice: **"Senza lotto"** (`stock.noLot`) + meta "scorta mancante al momento della produzione". A split child shows the notice
  "Ingredienti ereditati dal lotto di produzione P-1114-02 ›" above the list.
- **"Dove è andato"**: portions `dl` (vendute, scartate, pasto del personale, conteggi, divise, rimaste), then plates as in §4.

**Plate:** h1 = dish name; meta line `14 nov · 21:14 · Tavolo 7 · 1 porz.`; sections "Preparazioni usate" (batch rows ›),
"Ingredienti diretti" (only if any), **"Lotti e fornitori"** (the distinct lots, each a link, owner/admin with "Fattura n. …"). A draft
line: "Questo piatto non è stato inviato in cucina: non c'è nulla da tracciare."

**Entry links** (secondary text links, not buttons, so each page keeps one primary):
- `/produzione/[id]`: "Tracciabilità ›" under the fact card.
- `/magazzino/[ingredientId]`: on each lot row with a `rawLotId`, a trailing "Traccia ›" link (44 px tall). The "Senza lotto" bucket has none.

## 6. Invoice review: lot nudge (plan §3.6)

```
Mozzarella Demo · 2 kg            [Lotto mancante]   warning badge, word + dot
...
Lotto  [            ]
Copia il lotto dall'etichetta della confezione, se c'è.    hint

┌ approval panel ───────────────────────┐
│ 3 righe di magazzino senza lotto.      │  warning notice (not an error)
│ Puoi aggiungerlo ora; dopo             │
│ l'approvazione non si potrà più.       │
│ Mostra la prima                        │  quiet button
│ [            Approva            ]      │  primary, unchanged, enabled
└────────────────────────────────────────┘
```
- The badge is **warning**, not danger: nothing is wrong, something is recommended.
- "Mostra la prima" scrolls to the first marked line **and opens its editor with focus in the Lotto field** (one tap to type).
- With 0 lines missing, the notice is absent (no "tutto a posto" noise).
- The sentence "dopo l'approvazione non si potrà più" depends on the founder's Q-P3; if V1 (late lot note) is chosen, it becomes "Potrai
  aggiungerlo anche dopo, come nota." (da approvare).

## 7. "Com'è andata" on `/spingere`, and booked covers on `/produzione`

### 7.1 "Com'è andata" (section under today's push list)

```
Com'è andata                                  h2
[ Giorno precedente ]  Giorno [ 13/11/2026 ]   existing DayPicker pattern
Venerdì 13 novembre                           day title (businessDayTitle)

───────────────────────────────────────── LedgerRow per push
Lasagne Demo                 14 piatti venduti
in evidenza 11:05–02:00 · Prezzo del giorno 12,00 €   (price: owner/admin only)
  Ragù Demo
  10 porzioni in scadenza all'avvio
  8 vendute (80%) · 1 scartata · 1 rimasta
  scartate dopo: 1
─────────────────────────────────────────
Tiramisù Demo                  6 piatti venduti
in evidenza 18:30–02:00
  Nessun lotto in scadenza all'avvio della spinta.

Le porzioni vendute includono altri piatti con lo stesso preparato.   footnote (meta)
```
- **Placement:** below the current push list, so the morning view starts with today's job (what to push now) and the review sits one
  scroll below. A Home link "Com'è andata ieri" is **not** added (Home is already full; ADR-030).
- **Day choice:** reuse the day-close `DayPicker` ("Giorno precedente" + date field, `chiusura/day-picker.tsx`) instead of a new "‹ Ieri ›"
  stepper: one day control in the whole app. Default yesterday; today allowed and titled "Oggi (in corso)"; no future date.
- **Rows, not cards:** a push is a `LedgerRow` (hairline list), keeping the page to its existing cards budget (ui-foundation §6: at most two).
- **Percent with the numbers, no colour:** "8 vendute (80%)". No red/green, no badge: there is no target to judge against yet (Q-P5 → V3).
- **Empty day:** "Nessun piatto messo in evidenza in questo giorno."
- **Ongoing push today:** the time range ends in "in corso" and the figures say "finora".

### 7.2 Booked covers in the forecast panel

```
[ Oggi | Domani ]                               existing chips
Coperti attesi: 42                              existing line (owner/admin only)
Prenotati (confermati)                          new, all four roles that see the panel
  Pranzo   12 coperti · 4 prenotazioni
  Cena     30 coperti · 9 prenotazioni
```
- **Two different numbers, two labels.** "Coperti attesi" is the forecast (history); "Prenotati (confermati)" is bookings. They sit on
  separate lines, booked under expected, so nobody adds them up.
- One row per service, figures `.num` and aligned. All zero: "Nessuna prenotazione confermata". Error on this read only: a one-line
  `ErrorAlert` inside the panel; the forecast still shows.
- The panel's chips are Oggi / Domani; the covers follow the chosen chip (the API allows 6 days ahead, the panel only needs 2).

## 8. Design decisions that differ from, or add to, the plan (for the lead)

| # | Proposal | Plan says | Why |
|---|---|---|---|
| D1 | A lot without a code reads **"Lotto senza codice"**, the existing `stock.lot.noCode` | "Lotto fornitore non registrato" | Same fact, same words on Magazzino and Tracciabilità (consistency, Nielsen 4) |
| D2 | Nav: Tracciabilità last in Cucina. For the chef the Cucina row becomes **6 pills** (Comande, Produzione, Magazzino, Riordino, Margini, Tracciabilità): exactly the ADR-030 maximum. No further Cucina section can be added without a nav decision | Adds the entry | Flagged so the next addition triggers a nav review, not a 7th pill |
| D3 | Day control in "Com'è andata": reuse `DayPicker` | New "‹ Ieri ›" stepper | One day control in the app |
| D4 | Pushes as rows, not cards | "one card per push" | Card budget (≤ 2 per screen) |
| D5 | Lot search query and tab kept in the address | not specified | Back and shared links reopen the same result |
| D6 | "Mostra la prima" also focuses the Lotto field | scrolls to the line | Saves a tap; the point is to type the code |
| D7 | Explicit "none" sentences in the two main trace sections | not specified | A recall answer must say "nothing", not leave a blank |

## 9. Open questions

| # | For | Question | Default |
|---|---|---|---|
| Q-UX-P1 | Founder | Wording of the screens (all strings marked da approvare) | Copywriter drafts from this file; you approve |
| Q-UX-P2 | Lead | Accept D1–D7 above? | Yes |
| (Q-P3) | Founder | Late lot note after approval (plan §7.2) changes the nudge sentence (§6) | As the plan |
