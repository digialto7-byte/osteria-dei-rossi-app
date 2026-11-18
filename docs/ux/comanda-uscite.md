# Screens: Comanda per uscita (the handwritten pad)

- **Status:** accepted by the lead (#195, 2026-11-18), including the two-tap move (§2.2); decisions in §9 · **Author:** UX/UI designer · **Date:** 2026-11-18
- **Founder request (2026-11-18, via the lead):** "the comanda when taken should be like an old piece of handwritten paper, by portata,
  not invio e segue — someone takes an antipasto and another a primo, then both a secondo."
- **Spec for:** `/tavoli/comanda` (waiter sheet), `/cucina` (kitchen board), `/tavoli` (tile). It replaces, on those screens, the
  per-course grouping, the per-course send buttons, the per-line "Segue" toggle and "Invia a seguire" of P3 (`p3-sala-waiter.md` §3, §10.2).
  Everything else of P3 and of the Direct comanda (§10) stays: the header, "Conto richiesto", the Conto tab, the sticky bar, the pinned strip,
  high contrast, tap-comfort.
- **Look:** Costì + the venue layer (`costi-design-system.md`). Phone first, 360 px; the kitchen board also at 1280 px.
- **Wording:** every new Italian string is **(da approvare)**. Existing strings are quoted as they are in `it.ts`.
- **Server side:** this file owns the screens and the words. What the database must learn is listed in §8 for builder 1 to plan; nothing
  here decides a table, a procedure or a test.

## 1. The model: uscite, not categories

On paper a waiter writes the order top to bottom and draws a line where the table wants a pause: everything above the line comes out
together, everything below waits until the waiter calls it. The app copies that.

| Word | Meaning on screen |
|---|---|
| **uscita** (1ª, 2ª, 3ª…) | One wave of service: the dishes that come out together, **whatever their menu category**. An antipasto and a primo can share the 1ª |
| **— segue —** | The line between two uscite on the sheet. Drawing it ("Segue", one tap) starts the next uscita |
| **uscita corrente** | Where the next dish tapped in the menu lands. Shown on the sheet; one tap on another uscita's heading makes it current |
| **in attesa** | An uscita the kitchen has received but must not start: it waits for the waiter's call |
| **Via la 2ª** | The waiter's call: the kitchen may now make the 2ª |
| **Bevande** | Not an uscita: drinks go as soon as they are sent (§2.5) |

The menu category (`course`: Antipasti, Primi, Secondi, Dolci, Bevande) stays on each dish. It still sorts the menu, orders the lines inside
an uscita (antipasti before primi), and feeds the reports. It no longer decides **when** a dish comes out: the uscita does.

## 2. The waiter's sheet (`/tavoli/comanda`, 360 px)

### 2.1 Layout

```
‹ Tavoli                                          BackLink
Tavolo 2                              [ Tavolo ▾ ]   unchanged (P3 §10.2)
[Aperto]                     [ ✓ Conto richiesto ]
4 coperti · Giulia · 20:14 · Coperto 10,00 €
[ Comanda | Conto ]
┌ Comanda ──────────────────────────────────────┐
│ 1ª uscita · qui                                │  heading; "qui" marks the current uscita (bold, ink)
│   1 × Bruschetta Demo                          │  drafts as rows (tap = editor, as today)
│   1 × Tagliatelle al ragù Demo                 │
│ ─────────────── segue ───────────────          │  the divider, ink rule + the word
│ 2ª uscita                                      │  tap the heading = make it current (44 px)
│   2 × Spezzatino con polenta Demo              │
│ [ + Segue ]                                    │  secondary: draws a new line, the new uscita becomes current
│ Bevande · subito                               │  separate group, always last
│   1 × Acqua naturale 75 cl                     │
└────────────────────────────────────────────────┘
[Antipasti] [Primi] [Secondi] [Dolci] [Bevande]   menu category tabs: only to FIND dishes (SegmentedControl, ink)
Da proporre / menu of the category                tap a dish = add it to the current uscita
┌ sticky bar ────────────────────────────────────┐
│ [Comanda · 4 righe ↑]          [ Invia comanda ] │  one primary
└────────────────────────────────────────────────┘
```

- **Headings:** "1ª uscita", "2ª uscita"… (da approvare), `costi/label` 16 px bold. The current one carries " · qui" (da approvare) in ink
  and a 4 px Coral bar at its left edge (decoration; the word carries the meaning). Each heading is a 44 px button,
  `aria-pressed` = current; its accessible name is "2ª uscita, 1 piatto" plus ", corrente" when it is.
- **Divider:** "— segue —" between two uscite: a 1 px `rule-strong` line with the word "segue" (da approvare) in `ink-muted`, centred. It
  is the paper's line. It is decoration for screen readers (`role="separator"`); the headings carry the structure.
- **"+ Segue"** (da approvare): a secondary 44 px button at the end of the last uscita. It creates the next uscita, empty, and makes it
  current. An empty uscita shows "Tocca un piatto per aggiungerlo qui." (da approvare) and disappears if the waiter leaves it empty and
  sends (it never reaches the kitchen).
- **Bevande · subito** (da approvare): drinks, whatever uscita is current, land in this group. One line under its heading: nothing else.
- **Menu tabs:** the category tabs stay, but only to find dishes. They no longer group the sheet and carry no counts (the counts were
  per-course sends, which are gone).
- **The pinned strip** ("Da proporre") stays above the menu, as today.

### 2.2 Adding, moving, removing

| Action | Taps | What happens |
|---|---|---|
| Add a dish | 1 (the dish) | It joins the **current** uscita (drinks: Bevande). Same dish twice in the same uscita: the existing row's quantity goes up, as today |
| Start the next uscita | 1 ("+ Segue") | New empty uscita, current |
| Make another uscita current | 1 (its heading) | Next dishes land there |
| Move a line to another uscita | 2 (the line, then its uscita in the editor) | The editor's "Portata" select becomes **Uscita**: a `SegmentedControl` "1ª · 2ª · 3ª · + nuova" (ink fill). One tap moves the line; the editor stays open |
| Quantity, half portion, note, shared | as today | The line editor is unchanged apart from Uscita replacing Portata and Segue |
| Remove a draft | as today | "Rimuovi" in the editor |

**Why moving takes two taps, not one.** A one-tap move needs a control on every line (a chip that cycles 1ª → 2ª → 3ª), which is 44 px of
width per row on a 360 px screen and a mis-tap risk mid-service. The current-uscita model makes moves rare: the waiter puts the dish where
it belongs as they write it. The editor already opens with one tap, so a move is one tap more. If P0 shows moves are common, a swipe or a
row chip is the follow-up (§9).

### 2.3 Sending: one "Invia comanda"

The sticky bar has **one primary**, chosen in this order:

1. **"Invia comanda · n"** (da approvare) when there are drafts. It sends **every** draft at once (lead ruling, 2026-11-18, builder 1's
   plan Q5):
   - dishes added to an uscita already **in cucina** are made now (an "aggiunta", §3);
   - if **no uscita of the table is waiting**, the **lowest new uscita is called automatically** at the send and made now: on the first send
     that is the 1ª; later, it is the next one, so a late dessert goes straight to the kitchen with no "Via";
   - every other new uscita, and any uscita **behind one still waiting**, reaches the kitchen **in attesa**;
   - Bevande are made now.
2. Else **"Via la 2ª"** (da approvare; the number is the lowest uscita in attesa) when one is waiting.
3. Else no primary: the bar shows only the summary.

There is no confirmation step. The send is undoable the way it is today: a sent line has "Storna" (void) in the folded uscita.

After the send, the sheet shows the sent uscite **folded**, one row each (they replace P3's "Primi · 3 inviati ▸"):

```
1ª uscita · in cucina · 2 piatti ▸           sent and called
2ª uscita · in attesa · 2 piatti ▸   [ Via la 2ª ]   secondary in the list; the bar's primary is the same action
Bevande · 1 inviata ▸
```

States of an uscita row (da approvare): "da inviare" (drafts), "in coda" (the send is in the outbox), "in attesa" (sent, not called),
"in cucina" (called or first), "pronta" (every dish marked Fatto in the kitchen). Each state is a word; a `Badge` tone may echo it
(info for in attesa, success for pronta) but never replaces the word.

### 2.4 Adding dishes after the send

- After a send, the **current uscita** becomes the lowest one still **in attesa**; if none waits, a new empty uscita "(n+1)ª" is current.
  The waiter can tap another heading, including an uscita already in cucina.
- A dish added to an uscita **in attesa** joins it: it is sent with the next "Invia comanda" and waits with it.
- A dish added to a **new** uscita (the dessert) is made at the next "Invia comanda" **if nothing else waits** (§2.3: called automatically);
  if an earlier uscita still waits, the new one waits behind it. The bar's label says which: "Invia comanda · 1" either way, and after the
  send the row reads "3ª uscita · in cucina" or "· in attesa".
- A dish added to an uscita **in cucina** (the forgotten bread of the 1ª) is sent with the next "Invia comanda" and made at once; the kitchen
  sees it as an addition to that uscita (§3).
- The bar's primary is "Invia comanda · n" whenever drafts exist, even if an uscita is waiting: sending comes before calling.

### 2.5 Bevande straight away (agreed with the lead's proposal)

Drinks are poured, not cooked: they never wait for a course and the table expects them first. So the Bevande group is outside uscite, its
dishes go with the next "Invia comanda" and are never in attesa. A drink that must come with the dessert (a passito) is a note on the line
("con il dolce") — rare enough not to need its own uscita. If the venue later wants drinks timed, a dish can be moved into an uscita from the
editor (the Uscita control lists "Subito" for drinks); that is the escape hatch, not the default.

### 2.6 The founder's example, tap by tap

Table of four: one antipasto A, one primo B, then two secondi. Menu on the Antipasti tab, sheet empty, 1ª current.

| # | Tap | Sheet |
|---|---|---|
| 1 | Antipasto A | 1ª: A |
| 2 | "Primi" tab | (menu shows primi) |
| 3 | Primo B | 1ª: A, B |
| 4 | "+ Segue" | 2ª empty, current |
| 5 | "Secondi" tab | (menu shows secondi) |
| 6 | Secondo C | 2ª: C |
| 7 | Secondo C again (or D) | 2ª: C ×2 (or C, D) |
| 8 | "Invia comanda · 4" | 1ª in cucina, 2ª in attesa |
| later | "Via la 2ª" | 2ª in cucina |

**The structure costs 2 taps: "+ Segue" and "Invia comanda".** The rest are the dishes themselves (4) and finding them (2 tab changes,
0 when the dishes are in "Da proporre"). Today the same table costs the dish taps plus: open each secondo's editor and toggle Segue (2 × 2),
"Invia antipasti", "Invia primi", "Invia a seguire" (3): 7 taps of structure against 2. A literal "3 taps in total" is not possible for
four dishes; **3 taps of structure** (segue, send, call) is what this spec guarantees, whatever the size of the table.

### 2.7 Closing the table while an uscita waits

Closing a table is **refused while an uscita is in attesa** (server code `uscita_waiting`; lead ruling, 2026-11-18): the dishes are paid for
and the kitchen holds them, so the table cannot just disappear. The close sheet (Conto tab, "Chiudi tavolo") says why and offers the two
ways out, instead of a bare error:

```
Chiudi tavolo
La 2ª uscita è ancora in attesa: 2 piatti.            the reason, in ink (da approvare)
Chiamala o stornala prima di chiudere il tavolo.
[ Chiama la 2ª ]                                       secondary: calls it ("Via la 2ª"), then the sheet waits for it
[ Storna come non preparati ]                          danger: voids every line of the 2ª with reason "Non preparato"
[ Annulla ]                                            quiet
```

- **"Chiama la 2ª"** is the same call as "Via la 2ª"; the sheet then shows the table as not yet closable until nothing waits, and the normal
  close comes back.
- **"Storna come non preparati"** opens the existing void step for all the uscita's lines at once, with the reason fixed to "Non preparato"
  (Q-U1: their stock is **reversed**, not wasted) and the sentence "I piatti tornano in magazzino e non vanno sul conto." (da approvare).
  After it, the close proceeds as usual.
- More than one uscita waiting: the sheet names the lowest ("La 2ª uscita è ancora in attesa…") and handles them one at a time.
- Offline: closing already needs the server; the sheet says so as today. If a close was refused with `uscita_waiting` after a replay, the
  notice uses the same sentence.

## 3. The kitchen board (`/cucina`)

### 3.1 Tickets by uscita

A ticket is now **one table's uscita** (it was one table's course and segue value):

```
┌ Tavolo 2                          4 coperti ┐
│ 1ª uscita                                    │  text-lg bold, as the course today
│ 20:14 · Giulia                               │
│ 0 di 2 fatti                                 │
│ Antipasti                                    │  small ink-muted label per category, only when the uscita mixes them
│  1 × Bruschetta Demo                [tap]    │
│ Primi                                        │
│  1 × Tagliatelle al ragù Demo       [tap]    │
│ [ Chiudi comanda ]                           │
│ ─ poi ─ 2ª uscita · in attesa · 2 piatti     │  the next uscita, folded, read-only, in ink-muted
└──────────────────────────────────────────────┘
```

- Inside an uscita the dishes are ordered by menu category (antipasti, primi, secondi, dolci) with a small category label when the uscita
  mixes categories, so the cook still reads "antipasti first" without the waiter having to split them.
- **The waiting uscita** sits folded at the foot of the table's current ticket: "poi · 2ª uscita · in attesa · 2 piatti" (da approvare),
  tappable to unfold its dishes read-only (`aria-expanded`), so the cook can prep (mise en place) but has no "Fatto" buttons on it.
- **When the waiter calls it** ("Via la 2ª"), it becomes its own ticket at the **front** of the board's order for that time, with the info
  `Badge` "Chiamata 21:02" (da approvare) for one minute, then the plain sent line. The board orders tickets by the time they were sent or
  called, oldest first, as today.
- **Additions** to an uscita already in cucina (§2.4) appear as a separate small ticket "1ª uscita · aggiunta" (da approvare), so a dish that
  arrives late is not hidden inside a half-done ticket.
- **Bevande** tickets read "Bevande" as today.
- "Fatto", "Chiudi comanda", "Riapri", the undo notice, "Chiuse oggi" and high contrast are unchanged; their accessible names say "uscita"
  where they said the course ("Chiudi comanda: Tavolo 2, 1ª uscita").
- The kitchen does **not** call an uscita itself in this version: the waiter knows when the table is ready. The board only shows it waiting.
  (If P0 shows the pass calling it verbally anyway, a "Via" on the kitchen side is a small follow-up.)

### 3.2 Remaining count

"Da fare: 7" counts the dishes of uscite in cucina only; the waiting ones are added in words: "Da fare: 7 · in attesa: 4" (da approvare).

## 4. The `/tavoli` tile

The tile's status word "Portate inviate" (`tables.status.courses_sent`) becomes a progress line built from the uscite (da approvare):

| Table state | Meta line on the tile |
|---|---|
| Open, drafts not sent | "2 piatti da inviare" (W2, unchanged) |
| Sent, nothing waiting | "1ª in cucina" |
| Sent, an uscita waiting | "1ª in cucina · 2ª in attesa" |
| The current uscita done in the kitchen, the next waiting | "1ª pronta · **2ª da chiamare**" (`<strong>`: it is what the waiter must act on) |
| Everything sent and called | "Ultima uscita in cucina" |

The status badge stays ("Aperto", "Conto richiesto"…). "Portate inviate" is retired as a status word: the uscite line says more. The tile
gets no new button: calling happens on the table's screen, one tap away (the tile opens it, P3 §10.1).

## 5. Offline and the outbox

The phone keeps working without a connection (M20); the same rules apply to uscite:

- **Adding, moving, removing, "+ Segue":** local at once, queued as today. A line's uscita is part of the add and edit operations.
- **"Invia comanda" offline:** queued as one fire; the uscite rows say "in coda" (the existing `sync.line.queued` family). The kitchen sees
  nothing until the queue drains; on reconnect, the 1ª is made at once and the later uscite arrive in attesa, exactly as online.
- **"Via la 2ª" offline:** queued as its own operation; the row says "Chiamata in coda" (da approvare). Replaying it twice calls once.
- **Order of replay:** a call never overtakes the send of the same uscita (the outbox already replays in sequence).
- **A conflict** (another phone sent or called first): the existing conflict notice, worded "La 2ª uscita era già stata chiamata."
  (da approvare); nothing is sent twice.

## 6. What replaces "Segue"

| Today (P3) | With uscite |
|---|---|
| Sheet grouped by menu category | Sheet grouped by uscita; categories only label lines inside an uscita in the kitchen |
| Per-line "Segue" toggle in the editor | Gone: the line's **Uscita** control (1ª · 2ª · … · + nuova) |
| "Invia antipasti · 2", "Invia primi · 1" per category | Gone: one "Invia comanda · n" |
| "Invia a seguire · 1" | Gone: later uscite are sent with the same tap and wait |
| Kitchen badge "A seguire" (`kitchen.segue`) | "in attesa" on the folded next uscita; "Chiamata 21:02" when called |
| Bar primary "Invia <portata> · n" (W-b) | "Invia comanda · n", else "Via la 2ª" |
| The leave sheet's "send before you go" groups (QW12) | One line: "4 piatti da inviare" + "Invia comanda" |
| Tile "Portate inviate" | The uscite progress line (§4) |

## 7. States checklist

| State | Sheet | Kitchen | Tile |
|---|---|---|---|
| Empty table | "Nessun piatto ancora: scegli dal menu qui sotto." (P3), 1ª current | nothing | "Aperto" |
| Drafts only | uscite with rows, bar "Invia comanda · n" | nothing | "n piatti da inviare" |
| Sending (online) | bar "Invio…" | — | — |
| Sent offline | rows "in coda" | nothing yet | "In coda" (W2 family) |
| 2ª in attesa | folded rows, "Via la 2ª" | folded under the 1ª | "1ª in cucina · 2ª in attesa" |
| 1ª done, 2ª waiting | "1ª uscita · pronta" | 1ª in Chiuse oggi when closed | "1ª pronta · **2ª da chiamare**" |
| Call queued offline | "Chiamata in coda" | still in attesa | unchanged |
| Line voided in an uscita in attesa | struck through in the folded row | removed from the folded list | count updated |
| Close with an uscita in attesa | Close sheet: the reason + "Chiama la 2ª" / "Storna come non preparati" (§2.7) | unchanged | unchanged |
| Dessert sent when nothing waits | "3ª uscita · in cucina" at once, no "Via" | its own ticket | "Ultima uscita in cucina" |
| Voided in an uscita in cucina | as today (struck, "Stornato · motivo") | as today | — |

All targets ≥ 44 px (tap-comfort 52 px for the dish buttons and the bar, P3 W4); one primary per screen; every state in words.

## 8. Server side (for builder 1 to plan)

Listed so the plan can start; the names are suggestions, the plan decides.

1. **Lines carry an uscita.** `order_lines` gains an uscita number (1–9; drinks: none / "subito"). `course` stays (menu category, reports,
   kitchen sorting). `segue` is retired: an open session's lines migrate as segue false → 1, segue true → 2.
2. **One send.** The fire procedure takes the drafts of the whole sheet in one transaction: lines of called uscite, drinks and, when nothing
   waits, the lowest new uscita are fired as now; every other new uscita is fired **held**. Stock and frozen costs at fire are unchanged (fire = sale).
3. **The call.** A new append-only record "uscita called" (session, uscita, at, by), written by its own procedure (single transaction, audit
   row, idempotent on replay). When no uscita of the table waits, the send calls the lowest new uscita implicitly (the 1ª on the first
   send; a late dessert later), per the lead's ruling on builder 1's Q5.
4. **Kitchen tickets.** The ticket key becomes (session, fired_at, uscita); held lines are readable by the board (for the folded "in attesa"
   list) but cannot be marked done until called.
5. **Tables read.** `/api/tables` returns, per open session, the uscite summary the tile needs (highest in cucina, lowest in attesa, whether
   the current one is all done).
6. **Sync.** `add_line` / `edit_line` payloads carry the uscita; a new op kind for the call; replay is idempotent; a call queued behind its own
   send never runs first.
7. **Voiding a held line (decision needed).** Today a voided fired line stays depleted and counts as waste ("Il piatto resta scaricato dal
   magazzino e conta come scarto."). A dish of an uscita **in attesa** was never cooked: the designer's recommendation is that its void
   **reverses** the depletion (a reversal row, never a delete) with the reason "Non preparato" (da approvare), and the dialog says so. This
   is a stock rule, so it is the lead's and the founder's call (Q-U1; **decided: reversal, "Non preparato"**).
8. **Reports** keep using `course`; nothing changes there.
9. **Closing** is refused while an uscita waits (`uscita_waiting`); the close sheet words it and offers the call or a "Non preparato" void of
   that uscita's lines (§2.7).

## 9. Open questions

| # | For | Question | Default |
|---|---|---|---|
| Q-U1 | Founder via lead | A dish of an uscita still in attesa is cancelled: back into stock (reversal, "Non preparato") or waste as today? | **Decided (lead, 2026-11-18): back into stock**, reason "Non preparato"; the lead tells the founder |
| Q-U2 | Lead | Bevande always "subito" (§2.5), with the editor's Uscita control as the escape hatch? | Yes |
| Q-U3 | Lead | Kitchen-side "Via" (the pass calls the next uscita) now, or after P0? | **Decided (lead): after P0** |
| Q-U4 | Lead | Ship together with the P0 observation, or before go-live? The model changes the waiter's core task | **Decided (lead): before go-live** |
| Q-U5 | Founder | Wording: "uscita", "segue", "Via la 2ª", "in attesa", "da chiamare" (all da approvare) | The copywriter drafts; the founder approves |

## 10. Acceptance checks (for the builder's tests)

- The founder's example (§2.6) sends 4 dishes with "+ Segue" and "Invia comanda" as the only structure taps; the kitchen shows the 1ª with
  both dishes (antipasti label, then primi) and the 2ª folded "in attesa".
- "Via la 2ª" turns the 2ª into its own ticket; the tile goes from "1ª in cucina · 2ª in attesa" to "Ultima uscita in cucina".
- A dish added to the 1ª after it was sent appears as "1ª uscita · aggiunta" on the board.
- Drinks are never in attesa.
- With the 1ª and 2ª already in cucina, a dessert added to a new 3ª and sent goes straight to the kitchen (no "Via"); with the 2ª still in
  attesa, the same dessert waits behind it.
- "Chiudi tavolo" with an uscita in attesa shows the reason and both ways out; "Storna come non preparati" reverses their stock and the table
  then closes.
- Offline: "Invia comanda" and "Via la 2ª" queue, show "in coda" / "Chiamata in coda", and replay once each, in order.
- No per-category send button, no "Segue" toggle and no "Invia a seguire" remain in the comanda.
- One primary on `/tavoli/comanda` in every state; every heading and button ≥ 44 px; no state shown by colour alone.
