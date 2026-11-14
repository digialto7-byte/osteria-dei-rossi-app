# Screens: P4 Cucina (chef and kitchen)

- **Status:** draft · **Author:** UX/UI designer · **Date:** 2026-11-14
- **Spec for:** UX strategy phase **P4** (`docs/plans/2026-11-13-ux-strategy.md` §9.3, steps **K1–K3**), on top of what is on `main`:
  QW6 ("Esci" in the header), QW8 (empty state with no batch recipe), QW9 (waste shortcut), and W-d (pressed "Alto contrasto" as a
  secondary, in the small-fixes batch).
- **When:** after go-live and P0, like P3. Validated on tasks T-C1–T-C4 against the P0 baseline (strategy §9.1).
- **Look:** venue (osteria theme). The chef sees **no €** anywhere (ADR-020/030); nothing below adds a money figure.
- **Source note.** Kitchen display (KDS) practice still has no read source (strategy §4.2). Where this spec proposes a kitchen pattern that
  is not already in the app, it says "to observe in P0", and makes no claim about industry practice.

## 1. The chef's jobs and their paths

| Task | Today (strategy §3.2) | After P4 |
|---|---|---|
| **T-C1** mark a ticket of 3 dishes done | Home → Cucina tab (1) → 3 dishes → "Chiudi comanda" = 5 | Home card "Comande aperte · n" (K1) → 3 dishes; the ticket **closes itself** when all are done ("Tutto fatto alle …", `kitchen.closedAt.auto`), so "Chiudi comanda" is only for closing early = **4** |
| **T-C2** register a batch | Home "Nuova produzione" → recipe select (2) → quantity → Calcola → Registra = 5 | Home → **recent recipe button** (1, K2) → quantity → Calcola → Registra = **4** |
| **T-C3** daily count | 5 taps, autosave, Enter-to-next | unchanged (the strategy's model pattern) |
| **T-C4** raw waste | Home → Magazzino → ingredient → form at the anchor (QW9) → reason select (2) → Registra = 5+ | Home "Registra uno spreco" → **one screen** (K3): search, quantity, reason, Registra = **≤ QW9's taps** |

## 2. Chef Home (K1)

```
┌──────────────────────────────┐ 360
│▓ OSTERIA DEI ROSSI  Marco Esci│
├──────────────────────────────┤
│ Home  Avvisi  Da spingere    │ pills (Home group)
│ Osteria Dei Rossi        h2  │
│ [!] 2 avvisi: …              │ alert strip (as today)
│ ┌ Comande aperte · 3 ──────┐ │ K1: first card, whole card is the link → /cucina
│ │ Da fare: 7 piatti         │ │ (kitchen.remaining)
│ │ Apri la cucina ›          │ │
│ └──────────────────────────┘ │
│ [   Nuova produzione    ]    │ primary (as today)
│ Conteggio giornaliero ›      │
│ Registra uno spreco ›        │
│ Pasto del personale ›        │
└──────────────────────────────┘
```
- **K1 card** "Comande aperte · n" (count from the server, same as `/api/kitchen/tickets`), with "Da fare: n" piatti. With **0 open**:
  the card stays, reads "Nessuna comanda in cucina." (`kitchen.empty`) and still links to `/cucina` — the chef learns where the kitchen
  is even on a quiet morning. No money key in the reply (strategy K1 test).
- The card is a link styled as a card, not a second primary: the one primary stays "Nuova produzione".
- The plain "Comande" action (`TICKETS` in `today-actions.ts`) is dropped from the chef's list when the card is there (no duplicate path).

## 3. `/cucina` — the kitchen screen

```
Cucina                           h1
Da fare: 7                       remaining count, bold
Aggiornato alle 20:41   [Alto contrasto]   pressed = secondary + ✓ (W-d)
┌ ticket ─────────────────────────────┐
│ Tavolo 7              4 coperti     │ table in display face 28 px
│ Primi   [A seguire]                 │ course + segue badge (info)
│ 20:14 · Giulia                      │ fired at · by
│ 1 di 3 fatti                        │
│ ─────────────────────────────────── │
│ 2 × Tagliatelle Demo     [Fatto]    │ done: struck + word + aria-pressed
│ 1 × Risotto Demo                    │ open: whole row is the button
│     senza formaggio                 │ note
│ 1 × Lasagne Demo  Stornato · errore │ voided: struck text, not a button
│ [        Chiudi comanda        ]    │ secondary, full width
└─────────────────────────────────────┘
Chiuse oggi (12) ▸                     closed section (Riapri)
[Tavolo 7 · Primi: comanda chiusa  Annulla]   undo notice
```
**Kept as built** (strategy §7 "what works"): full-width line buttons, the word "Fatto", `aria-pressed`, undo, high contrast, the stale
banner, offline-disabled writes with "Serve la connessione per segnare i piatti." (`kitchen.offline`) — this answers the strategy's open
point "whether the reason is shown": it is.

**Proposals (to observe in P0, §6):**
- **K-a · age of the ticket.** Today the card shows the fire time ("20:14 · Giulia"). Add the elapsed time next to it: "20:14 · Giulia ·
  da 12 min" (da approvare), refreshed with the existing poll. Words only; **no colour change with age** until P0 shows the cooks want
  one and a KDS source is read.
- **K-b · no reveal animation** on `/cucina` (strategy §6.8): the list updates by polling, and motion there adds nothing.

## 4. `/produzione/nuova` — recent recipes (K2)

```
Nuova produzione                 h1
Ultime preparazioni              h2 (da approvare)
[ Ragù Demo        ] [ Besciamella Demo ]   2 columns, ≥ tap-comfort, max 4
[ Brodo Demo       ] [ Pesto Demo       ]
Ricetta                          the existing select, unchanged
[ Scegli la ricetta        ▾]
Quantità prodotta  [ 4 ] kg      focus lands here after a recent-recipe tap
[ Calcola ]                      secondary
…
[ Registra produzione ]          primary
```
- Up to **4** buttons: the chef's most recent distinct batch recipes, newest first (from the recipes API's recent list). A tap selects the
  recipe in the select (so both stay in sync) and **moves focus to the quantity**.
- Fewer than 2 recent recipes: the section is hidden (a single button is not worth the space). No recipe at all: QW8's empty state.
- The chosen button shows pressed state (`aria-pressed`, ink fill), not green.

## 5. `/magazzino/spreco` — one waste screen (K3)

```
Registra spreco                  h1 (stock.waste.title)
Ingrediente
[ moz                          ]  search field, results below as you type
  Mozzarella Demo · 2,4 kg in magazzino      result rows, ≥ 44 px
  Mozzarella di bufala Demo · 1 kg
 → after a tap: "Mozzarella Demo" chip with "Cambia"
Quantità  [ 0,5 ]  [kg ▾]
Motivo    [ Scegli il motivo  ▾]  (stock.waste.reason)
Ubicazione [ Cucina ▾]           only with several locations
Lotto     [ Primo in scadenza (consigliato) ▾]   default kept
[        Registra spreco        ]  primary
Spreco registrato.               SuccessNote role=status; form resets, ingredient kept
```
- Reached from Home "Registra uno spreco" (replacing QW9's `/magazzino?azione=spreco` target) and from the ingredient page.
- **Search**, not a long select: the existing `name-filter.tsx` pattern; matching on any word of the name; shows the stock on hand so the
  chef picks the right one.
- **After saving**, the ingredient stays selected and quantity and reason clear: several wastes of the same item in a row cost 3 taps each.
- Reasons stay a select (the list is short and fixed). Proposal **K-c** (to observe in P0): if P0 shows one or two reasons dominate, show
  them as large buttons above the select.

## 6. Proposals for the lead

| # | Proposal | Why | When |
|---|---|---|---|
| K-a | Ticket age "da 12 min", words only, no colour | The cook sees what waits longest without reading clocks | Observe in P0; build in P4 if it helps |
| K-b | No reveal animation on `/cucina` | Strategy §6.8 | P4 (or with W-d, it is a one-line CSS change) |
| K-c | Common waste reasons as buttons | Fewer taps if P0 shows a dominant reason | After P0 |
| K-d | Drop the chef's plain "Comande" Home action once the K1 card exists | No duplicate path | P4 |

## 7. Open questions

| # | For | Question | Default |
|---|---|---|---|
| Q-UX-K1 | Lead | Accept K-a–K-d? | K-b, K-d yes; K-a, K-c after P0 |
| Q-UX-K2 | Chef (via the lead, one question) | During service, do you want to see how long each comanda has waited? | Yes, as words ("da 12 min"), no colours |
