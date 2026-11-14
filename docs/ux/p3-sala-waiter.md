# Screens: P3 Sala (waiter)

- **Status:** built on `main` (PR #109, 2026-11-14) except W2 and W-c, which wait for `unsentCount` in `/api/tables`; checked against this
  spec by the designer (§9) · **Author:** UX/UI designer · **Date:** 2026-11-14
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
