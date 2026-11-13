# ADR-041 — Home order for owner and admin, and the account control in the header

- **Status:** accepted (supersedes ADR-030 decision 4 for owner and admin)
- **Date:** 2026-11-13 · **Decided by:** founder (UX quick wins, items 4 and 5 of the 2026-11-13 request; plan `docs/plans/2026-11-13-ux-quick-wins.md`, Q-QW4 and Q-QW5)

## Context
- ADR-030 decision 4 fixed the Home order: alerts, dashboard tiles, to-do actions, first steps, account card.
- The founder asked for "Carica una fattura" higher on the owner's phone Home (finding F04). Up to 11 dashboard tiles sit above it today.
- On a phone "Esci" exists only at the end of Home (owner, admin, chef) and on `/tavoli` (waiter). There is none on `/cucina`, the shared
  kitchen device's main screen (finding F07).
- Constraints: no new tokens or libraries, no URL moves, roles stay enforced in Postgres, waiters never see costs, the chef sees no euro amounts.

## Decision
1. **Home order for owner and admin:** the h1, the read-error notice, the alert strip, the actions (primary first, then the list), the
   dashboard `[data-dashboard]`, the first steps, the account card. This replaces ADR-030 decision 4 for those two roles. The alert strip
   stays first. The chef's Home is unchanged.
2. **Account control in the header band:** the signed-in user's own name and "Esci" sit in the green band on every signed-in phone screen,
   focus routes included (`lg:hidden`; the laptop sidebar keeps its own "Esci"). The in-page "Esci" on Home and on `/tavoli` is removed.
   This is a shell rule: a new signed-in screen gets it by living inside `AppShell`.
3. **The in-app exits ask the leave guard.** A page may register a guard (the comanda, for dishes not sent). The exits are: "← Tavoli",
   the wordmark, the header "Esci", and on a laptop (1024 px and wider) the sidebar links and the sidebar "Esci". All of them go through the
   guard; the browser back gesture is not intercepted, and a modified click (a new tab) is never stopped. A QR page (`needsFullLoad`) is
   still a full document load once the guard lets go. A guard is registered only when its sheet can be shown: the loading, failed and
   forbidden screens of the comanda register none, so an exit is never swallowed. A failed "Invia" from the sheet is said inside the sheet.
   Every shell `NavLink` asks the guard, so a link added to the shell later is covered without extra work. After an "Invia" from the
   sheet, the exit runs only if the sheet is still waiting on it: a "Resta al tavolo" or "Esci comunque" tapped during the send wins.

## Alternatives
- **Keep ADR-030's order and add the counts inside the alert strip (plan V2).** Pro: no change for the owner. Con: "Carica una fattura"
  stays below the tiles, which is what the founder asked to change. Not chosen.
- **Hide the tiles on a phone.** Pro: the primary action is at once in view. Con: removes information the owner uses daily. Not chosen.
- **"Esci" in the bottom tab bar or an account sheet.** Pro: near the thumb. Con: focus routes have no bar, an extra sheet state, and the
  bar is full at five tabs (ADR-030). Not chosen.
- **A per-screen "Esci" link at the end of each page.** Pro: no shell change. Con: out of reach on long pages, inconsistent, and it is
  the status quo that fails on `/cucina`. Not chosen.

## Consequences
- Good: the first action is in the first viewport on a fresh tenant; "Esci" is one tap on every signed-in screen.
- Home gains one request for the owner and the admin: `GET /api/reservations/pending-count` (a number only, owner and admin only, Postgres
  checks the role again). A failure shows no badge and the row stays. Home also gains two actions: "Prenotazioni" (hint "Richieste dei
  clienti da confermare.", badge "Prenotazioni da confermare · n", English "Reservations to confirm · n") and "Chiusura del giorno" (hint
  "Confronta i totali con la cassa e chiudi la giornata."; the app does not close the RT, so it never says "Chiudi la cassa").
- Bad / accepted trade-offs: the band may gain a second row at 360 px (it wraps); the staff guide sentence about "Esci" changes; staff
  trained on the old Home need one line of notice before the training session.
- What would make us revisit this: P0 measurements showing owners scroll past the dashboard to reach the actions, or the band row
  hurting the order-entry tap targets.
