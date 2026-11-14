# Screens: P3 Sala (waiter)

- **Status:** built on `main` (PR #109, 2026-11-14) except W2 and W-c, which wait for `unsentCount` in `/api/tables`; checked against this
  spec by the designer (§9). **§10 "Direct comanda" (founder, 2026-11-14) replaces the session panel of §2 and supersedes W-c**; it ships with
  the Sala design-system re-skin (`costi-design-system.md` §11 step 1) · **Author:** UX/UI designer · **Date:** 2026-11-14
- **Spec for:** UX strategy phase **P3** (`docs/plans/2026-11-13-ux-strategy.md` §9.3, steps **W1–W4**), on top of the quick wins already on
  `main` (QW5 unsent count, QW6 "Esci" in the header, QW11 bill toggle, QW12 leave warning). The strategy owns the steps and their tests;
  this file owns **layout, behaviour and wording**, and adds proposals (§7) for the lead.
- **When:** the strategy schedules P3 after go-live and after P0 (the baseline with real staff). This spec is ready for that phase plan;
  the `tap-comfort` value in W4 stays a P0 decision.
- **Look:** venue (osteria theme). Waiters never see costs (CLAUDE.md invariant); nothing below adds a money figure other than menu prices
  and the coperto, which the waiter already sees.

## 1. The waiter's day in three jobs

| Job | Today (from the code, strategy §3.2) | After P3 |
|---|---|---|
| **T-W1** open a table for 4, order 2 antipasti + 1 primo, send the antipasti | 5 taps + 2 for covers + 1 tab + dishes; "Invia" is inside the opened sheet | **4 taps** + covers + dishes: the send is on the bottom bar (W1) |
| **T-W2** close the table with receipt number and payment | 6 taps + 1 typed field | unchanged (no radio is preselected on purpose: fiscal data must be chosen) |
| See at a glance which tables still have dishes not sent | Only inside each comanda (QW5) | On the tile: "Da inviare · 2" (W2) |

## 2. `/tavoli` — the grid

```
┌──────────────────────────────┐ 360
│▓ OSTERIA DEI ROSSI  Giulia Esci│ band + AccountControl (QW6)
├──────────────────────────────┤
│ Tavoli                    h1 │
│ Tavoli  Prenotazioni         │ pills (Sala)
│ ┌────────────┐┌────────────┐ │ 2 columns at 360, 3 from 640
│ │ 1          ││ 2          │ │
│ │ [Libero]   ││ [Aperto]   │ │ status badge: word + dot
│ │            ││ 4 coperti  │ │
│ │            ││ Giulia·20:14│ │
│ │            ││[Da inviare · 2]│ W2: warning badge, only when > 0
│ └────────────┘└────────────┘ │
│ ┌────────────┐┌────────────┐ │
│ │ 3          ││ 4          │ │
│ │[Conto richiesto]│[Unito a 2]│ │ joined: not a button
│ └────────────┘└────────────┘ │
│ [ Alto contrasto ]           │ W3: same toggle as /cucina, end of page
└──────────────────────────────┘
```
- **W2, "Da inviare · n"** (new, da approvare): a `warning` badge under the opener line, the count from the server (`unsentCount`), shown
  only when > 0. It is the second badge on the tile; the status badge stays first. Screen reader name of the tile: "Tavolo 2, Aperto,
  4 coperti, Giulia alle 20:14, 2 piatti da inviare".
- **Order of badges and lines is fixed** (name, status, covers, opener, unsent) so a waiter scanning 20 tiles reads the same spot on each.
- **Tap a free tile** → the open-table card above the grid (covers stepper, "Apri tavolo"), as today. **Tap an open tile** → the session
  panel: one primary "Prendi la comanda", text link "Conto e chiusura", secondary "Modifica coperti" and the "Conto richiesto" toggle
  (QW11: pressed secondary, never primary), quiet "Chiudi".
- **Proposal W-c (§7):** when the table has unsent dishes, the panel says it above the primary: "2 piatti da inviare" (warning text with
  the word), so the waiter coming back to a table sees it before re-entering.

## 3. `/tavoli/comanda` — taking the order

```
← Tavoli                                   back link
Tavolo 2                         h1
[ Comanda | Conto ]                         view tabs
┌ sticky top ────────────────────────┐
│ [Antipasti·2] [Primi·1] [Secondi]  │ course tabs, wrap to 2 rows
│ [Contorni] [Dolci]                 │ W-a: selected = ink fill, not green
└────────────────────────────────────┘
Da proporre                                 pinned strip (pushed dishes, ★)
[★ Lasagne Demo              12,00 €]
Antipasti                                   section of the selected course
[Bruschetta Demo              6,00 €]       dish button: whole row, ≥ tap-comfort (W4)
[Tagliere Demo               14,00 €]
 Ne restano 3                               warning text with the word
[Burrata Demo (Esaurito)      9,00 €]       aria-disabled, sunk fill
              …
┌ sticky bottom bar (W1) ────────────┐
│ [Comanda · 3 righe ▲] [Invia antipasti · 2] │
│  secondary, opens sheet   PRIMARY           │
└────────────────────────────────────┘
```

### W1 · the sticky action bar
- **Two buttons side by side**, each half the width, both ≥ `tap-comfort` tall, inside the safe area:
  - left, **secondary**: the summary that opens the sheet, as today ("Comanda · 5 righe · 2 da inviare", QW5); on two lines if needed;
  - right, **primary**: **"Invia <portata> · n"** (`orders.send.label`), present only when there are confirmed drafts to send.
- **Which course the bar sends** (proposal W-b, §7): the **selected tab's course** if it has confirmed drafts; otherwise the **first course
  in service order** that has them. The course is always named on the button, so the waiter never sends blind.
- **"A seguire" drafts are never sent from the bar.** They stay in the sheet with "Invia a seguire · n" (secondary), because the waiter calls
  them later on purpose.
- **While sending:** the primary reads "Invio…" (`orders.send.sending`) and both send controls are off; no optimistic UI (firing moves stock).
  After success the bar's count drops and the course's lines show as sent.
- **No "blocked" state on the bar** (removed 2026-11-14, P3 plan D7 / Q-L6): since M20 the outbox queues a send after the lines it
  depends on, so a line still on its way never stops the bar. The sheet's per-course buttons keep their existing wording.
- **Offline:** sends queue as today ("In coda" on each line); the bar's primary stays available and its line says "In coda" after the tap.
- **Focus not obscured** (WCAG 2.2 SC 2.4.11): the page reserves the bar's height as bottom padding; the last dish button, when focused,
  is never entirely under the bar (W1 test).
- With no drafts at all, the primary is absent and the summary button takes the full width.

### Course tabs
- The tab shows its line count ("Primi · 2"). **Proposal W-a:** the selected tab uses the **ink** fill (as the current bottom-nav tab), not
  the green `accent` fill, so green means only "act" on this screen (the bar's primary). Selection is still marked by fill **and**
  `aria-selected`.
- **Q-L7 (designer, 2026-11-14): yes, extend W-a to the "Comanda | Conto" view tabs.** They still use the green fill, so the comanda shows
  two greens (the selected view tab and the bar's primary). Same rule: selected = ink fill + `aria-selected`. A small fix, in the next
  small-fixes batch or in P2's `SegmentedControl`, whichever ships first.

### The sheet (unchanged in structure)
Lines grouped by course; each course with drafts ends with its send buttons; "Storna" on sent lines; voided lines struck through; the leave
warning (QW12) when leaving with unsent dishes.

## 4. W3 · high contrast in Sala

- The same **"Alto contrasto"** toggle and the same `data-contrast="high"` rules as the kitchen (ink instead of grey, 2 px borders, larger
  names). Placed at the **end of `/tavoli`**, and applied to the comanda too (one setting per device, as the kitchen's).
- **Proposal W-d:** the kitchen toggle turns **primary** when pressed (`contrast-toggle.tsx`), which gives `/cucina` two green controls.
  Make it a pressed **secondary** with a ✓, like "Conto richiesto" (QW11), on both screens.

## 5. W4 · `tap-comfort`

- Applies to: dish buttons, course tabs, the bar's two buttons, kitchen line buttons. Never below the 44 px `tap` token.
- The value is chosen in **P0 by observation** (strategy §6.5). A starting candidate for P0 to test: **52 px** (between Apple's 44 pt and
  Android's 48 dp reference points and above both, for wet hands); it is a candidate, not a decision.
- At 360 px, five course tabs at 52 px wrap to two rows (as today); the bar still fits two buttons.

## 6. States checklist (every waiter screen)

| State | Rule |
|---|---|
| Loading | "Caricamento…" in place, layout height kept |
| Offline | Banner with the data time; writes queue with "In coda"; covers and "Conto richiesto" disabled with "Serve la connessione" |
| Sold out | "Esaurito" word, `aria-disabled`, no tap effect |
| Low stock | "Ne restano 3" in warning text, still tappable |
| Error | `ErrorAlert` next to what failed; the order sheet keeps every typed line |
| Leaving with drafts | QW12 sheet: send per course, "Esci comunque", "Resta al tavolo" |

## 7. Proposals and the lead's decisions

**Decided by the lead, 2026-11-14:**
- **W-a, W-b, W-c accepted as the P3 design.** They are built with P3, after go-live and the supervised run, and validated against the P0
  baseline (strategy §9.2); they stay in this spec, not in the build queue.
- **W-b changes what "Invia" sends** (the selected course, else the first course with drafts). The P0/P3 comparison of task T-W1 must
  therefore record which course was sent, and P3's task script must include a send from a tab whose course has no drafts.
- **W-d accepted into the pre-go-live small-fixes batch:** the pressed "Alto contrasto" on `/cucina` becomes a pressed secondary with ✓,
  like QW11.

The original proposals:

| # | Proposal | Why | Size |
|---|---|---|---|
| W-a | Selected course tab = ink fill instead of green | Green only for actions; one primary per screen (ui-foundation §1) | XS |
| W-b | Bar sends the selected course, else the first course in service order with confirmed drafts | The strategy says "the selected course"; with this rule the bar is never empty while dishes wait, and the label names the course | S |
| W-c | "2 piatti da inviare" in the session panel | Seen before re-entering the table | S (reads W2's count) |
| W-d | Kitchen contrast toggle: pressed secondary, not primary | Same rule as QW11; one primary on `/cucina` | XS |

## 8. Open questions

| # | For | Question | Default |
|---|---|---|---|
| Q-UX-W1 | Lead | Accept W-a to W-d? | Yes |
| Q-UX-W2 | P0 | `tap-comfort` value | Test 52 px in P0; decide from the observations |

## 9. Check of the build against this spec (designer, 2026-11-14; PR #109)

Read from the merged code and tests (`order-sheet.tsx`, `sticky-action-bar.tsx`, `fire-view.ts` `barSend`, `course-tabs.tsx`,
`menu-item-button.tsx`, `kitchen-line.tsx`, `contrast-toggle.tsx`, `globals.css`, `e2e/order-entry.spec.ts`). Staging not yet seen with the
founder.

| Spec | Built | Verdict |
|---|---|---|
| §3 W1 bar: secondary summary + primary "Invia <portata> · n", side by side, both `tap-comfort`; summary full width without drafts | as specified (`StickyActionBar`, `Button comfort`) | ✓ |
| §3 W-b: selected course, else first in service order; never "a seguire" | `barSend` over `unsentGroups` (segue excluded) | ✓ |
| §3 sending: "Invio…", both send controls off, no optimistic UI | `sending` state; sheet buttons `locked`; one send at a time | ✓ (plus focus returns to the bar after a send) |
| §3 blocked state | not built (D7) | spec updated: row removed |
| §3 2.4.11 focus not obscured | scroll padding on `html:has([data-slot=sticky-action-bar])` | ✓ |
| §3 W-a selected course tab ink fill | ✓ | ✓; **view tabs "Comanda / Conto" still green** → Q-L7 above (low) |
| §4 W3 toggle at end of `/tavoli`, applied to the comanda, one setting per device | ✓ (shared key, toggle only on `/tavoli`) | ✓ |
| §4 W-d pressed secondary with ✓ | ✓ on `/cucina` and `/tavoli` | ✓ |
| §5 W4 `tap-comfort` 52 px on dishes, course tabs, bar, kitchen lines | `--spacing-tap-comfort: 3.25rem`, marked provisional | ✓ (P0 decides the value) |
| §2 W2 "Da inviare · n" on the tile; W-c line in the panel | not built (waits for `unsentCount`) | open |
| High-contrast badges: ink on surface with an ink ring (plan D10) | added | ✓ (the word still carries the state) |

## 10. Direct comanda (founder direction, 2026-11-14)

**Why.** Today an occupied table needs three taps before the waiter sees what it ordered: tile → panel → "Prendi la comanda" → "Comanda ·
4 righe". The founder found it not intuitive. From now on **the table is its comanda**: one tap opens it, with its lines already showing.

### 10.1 What a tap on a tile does

| Tile | Today | From now on |
|---|---|---|
| **Occupied** (Aperto, Conto richiesto) | Opens the session panel above the grid | Opens **`/tavoli/comanda?s=<id>` directly**, lines visible at the top (§10.2). Offline: a full page load of the cached static page, exactly as `openTable` does today (M20, unchanged) |
| **Free** (Libero, or Chiuso today) | Opens the open-table card above the grid, then the comanda | Same two steps, as a **bottom sheet** in thumb reach: "Apri {name}", covers stepper (`tables.covers.*`), primary "Apri tavolo", quiet "Annulla" → the comanda. Focus moves into the sheet; Esc and "Annulla" return focus to the tile. Opening stays a queued operation (works offline) |
| **Joined** ("Unito a 2") | Not a button | Unchanged: not a button; the line names the table to tap |

The 15-second refresh, "Da inviare · n" (W2) and the tile's reading order (§2) are unchanged. Back from the comanda returns to the grid with
its scroll position.

### 10.2 The order screen, top to bottom

```
‹ Tavoli                                          BackLink
Tavolo 2                              [ Tavolo ▾ ]   h1 + secondary disclosure (44 px), "Tavolo: altre azioni"
[Aperto] [Conto richiesto]                         status badge; bill badge only when requested
4 coperti · Giulia alle 20:14 · Coperto 4 × 2,50 €  meta (from the panel)
[ Comanda | Conto ]                                view tabs (W-a ink fill, Q-L7)
┌ Comanda ──────────────────────────────┐          the lines, OPEN by default (was behind the bar)
│ Antipasti                              │
│  Bruschetta Demo ×2       da inviare   │          drafts in full, editable as today
│  [ Invia antipasti · 2 ]  (secondary)  │          per-course send stays in the list
│ Primi · 3 inviati ▸                    │          sent lines folded per course; tap to unfold
└────────────────────────────────────────┘
[Antipasti·2] [Primi·1] [Secondi] …                course tabs (sticky top as today)
Da proporre / menu of the course                   add dishes
┌ sticky bar ────────────────────────────┐
│ [Comanda · 5 righe ↑]  [Invia antipasti · 2]   │  summary now scrolls to the lines; primary unchanged (W1, W-b)
└────────────────────────────────────────┘
```

- **Lines first, menu second.** The order card renders **above** the course tabs and is open on arrival. A table with no lines yet shows
  one line instead: "Nessun piatto ancora: scegli dal menu qui sotto." (da approvare).
- **Long comande stay short:** drafts (what the waiter can still change or send) are listed in full; **sent lines fold to one row per
  course** ("Primi · 3 inviati ▸", da approvare), which unfolds in place to show them with "Storna" as today. Voided lines stay struck
  through inside the unfolded course.
- **The bar's summary button** ("Comanda · 5 righe") no longer opens a hidden sheet: it **scrolls to the lines** and moves focus to the
  "Comanda" heading. Its text and the primary "Invia …" (W1, W-b) are unchanged.
- **One primary** on the screen: the bar's "Invia …". The per-course buttons in the list stay secondary.
- **Conto tab:** unchanged (bill, split, close).

### 10.3 Where every action of today's table panel goes (nothing lost)

| Today, in the session panel (`session-panel.tsx`) | From now on |
|---|---|
| Table name (h2) | The comanda's h1 (already there) |
| "4 coperti" · "Giulia alle 20:14" · coperto line | Meta line under the h1 (same helpers: `coversLine`, `openedLine`, `copertoLine`) |
| **Prendi la comanda** (primary) | Gone: the tap on the tile *is* this action |
| **Conto e chiusura** (link) | The **"Conto"** view tab (it already opens the same view, `comandaHref(id, "bill")`) |
| **Modifica coperti** (secondary) → covers field, "Salva coperti", "Annulla" | In **"Tavolo ▾"**: same stepper and buttons, in place under the header |
| **Conto richiesto** (pressed secondary ✓, QW11) | In **"Tavolo ▾"**, same toggle; its state also shows as a badge "Conto richiesto" next to the status |
| "Serve la connessione" (offline: covers and bill disabled) | In **"Tavolo ▾"**, same rule and words (`tables.panel.needsConnection`) |
| Error of a covers/bill change | `ErrorAlert` inside "Tavolo ▾", next to what failed |
| **Chiudi** (hide the panel) | "‹ Tavoli" back link (and "Tavolo ▾" closes by tapping it again) |
| (not in the panel) Sposta, Unisci | Not built today. When they are, they go in **"Tavolo ▾"**, never on the grid |

"Tavolo ▾" is an in-place disclosure (`aria-expanded`), not a modal: it opens a small card under the header with the controls above, in
this order: Conto richiesto, Modifica coperti. It never holds the screen's primary.

### 10.4 What does not change

- **Offline:** the comanda opens offline from the tile as it does today after opening a table (static page, outbox); writes queue with "In
  coda"; covers and "Conto richiesto" need the connection and say so.
- The leave warning with unsent dishes (QW12), the sticky bar (W1), W-b, high contrast (W3), `tap-comfort` (W4) and roles (the chef's
  notice on `/tavoli`) are unchanged.
- **W-c is superseded:** the lines and the bar's "da inviare" count are now the first thing the waiter sees on entering a table, so the
  panel line is no longer needed. **W2** (the count on the tile) stays.

### 10.5 Taps (strategy tasks)

| Task | Before §10 | After §10 |
|---|---|---|
| See what table 2 has ordered | 3 taps | **1 tap** |
| Add a dish to an open table and send it | 3 taps + dish + "Invia" | **1 tap** + dish + "Invia" |
| T-W1 open a table for 4, order, send antipasti | 3 taps + covers + dishes + "Invia" | unchanged |
| Mark "Conto richiesto" | tile → toggle (2 taps) | tile → "Tavolo ▾" → toggle (3 taps) |

The last row costs one tap more for a once-per-table action, in exchange for the comanda being one tap away on every visit; P0/P3
measurement records it (T-W2 unchanged).
