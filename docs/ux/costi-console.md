# Screens: Costì · Console (platform admin)

- **Status:** C1–C9 accepted by the lead (2026-11-14); Q-UX-C1 and Q-UX-C5 with the founder (defaults in force); wording (da approvare) ·
  **Author:** UX/UI designer · **Date:** 2026-11-14
- **Spec for:** `docs/plans/2026-11-13-platform-saas.md` §2 (roles, console mode, metadata only), §3 (tenant lifecycle), §4 (features
  and plans), §6.3–§6.4 (usage, health) and milestones **SP3** (console, audit, notices), with the parts of **SP4–SP7, SP10, SP11** that
  show up in the console marked by milestone, so the builder can ship the screens in the same order as the plan. The plan owns data,
  functions, roles and tests; this file owns **layout, order, states and wording**. Proposals that differ from or add to the plan are in
  §10 for the lead.
- **Look:** a **product surface**, so **Costì** (`docs/ux/costi-design-system.md`, token values `ui-foundation.md` §11), light and dark.
  It is the one product surface with no venue: the band says **"Costì · Console"** (plan §5.5) instead of a venue name (§10 C1).
- **Who uses it:** exactly one person, the platform admin account (plan FD28), mostly at a desk. **Laptop first in practice, phone first in
  structure:** every screen is drawn at 360 px and at 1280 px; nothing on the phone is hidden, it is stacked.
- **What it never shows (plan §2.3):** invoices, prices, costs, recipes, orders, reservations, staff names, e-mail addresses, guest data.
  Only tenant metadata: names of venues and organisations, venue type, status, plan, features, counts, dates, usage counters, health codes,
  and the platform audit. Every screen here is checked against that list (§9).
- **Wording.** Italian first, English second locale. Every string here is new and **(da approvare)** until the copywriter drafts it and
  the founder approves it. Example data uses demo names only ("Osteria Demo A", "Bar Demo").
- **Figma:** not drawn yet (the Starter plan's monthly limit, `docs/ux/README.md`); every component used here already exists in the library.

## 1. Words used on screen

| Plan term | On screen (it) | Note |
|---|---|---|
| tenant | **locale** (pl. locali) | What the founder sells and the venues call themselves |
| organisation | **gruppo** | A group of venues (ADR-038); "—" when the venue stands alone |
| status `provisioning` / `trial` / `active` / `suspended` / `cancelled` | **In preparazione** / **In prova** / **Attivo** / **Sospeso** / **Disdetto** | Always a `Badge` with the word: neutral / info / success / warning / neutral. `erased` never appears as a row: it is only an audit line |
| plan | **piano** | Labels are placeholders until FD3; the console shows the stored `label` |
| feature (module) | **modulo** | Labels in §5.3 |
| override | **eccezione** | "Eccezione fino al 30 nov" |
| platform audit | **Registro della piattaforma** | Distinct from a venue's own "Registro" (`/registro`) |
| platform notice | **avviso** | |
| health finding | **segnalazione** | Codes translated to sentences (§5.5) |

## 2. Flows

### F1 · Morning check (the main job)
```
console host ─ sign in (password + code) ─ Locali
   ├─ top: "Tutto in ordine" or "2 locali da guardare" (link filters the list)
   └─ tap a venue with "Da guardare" ─ Salute: the sentence and what to do ─ act or note it
```
Target: from sign-in to "is anything wrong today?" with **no tap** (the summary line), to the reason with **one** tap.

### F2 · Change what a venue can use
`Locali › Osteria Demo A › Moduli › "Prenotazioni" switch › reason + until when › Salva` → one audit row, the module list updates.

### F3 · Suspend or reactivate a venue
`Locali › venue › Stato e piano › "Sospendi" › reason › confirm` → takes effect at the venue's next day change (never mid-service), and the
screen says when.

### F4 · Look into a venue's business data (support)
`Locali › venue › "Entra nel locale"` → confirmation that every action is recorded as DigiAlto and visible to the owner → the venue app in
tenant mode (its own look, its own host). Coming back: "Torna alla console" in the account menu of the venue app (§10 C6).

### F5 · Find who did what
`Registro della piattaforma › filter by venue or action › row` → what happened, when, to which venue, with codes and ids only.

### F6 · New venue (SP7)
`Locali › "Nuovo locale" › form › Crea` → status "In preparazione", the invitation waits for the script step, shown as a checklist.

## 3. Frame and navigation

**Laptop (≥ 1024 px):**
```
┌────────────────────────────────────────────────────────────────────────────────────────┐ 1280
│▓ COSTÌ · CONSOLE ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ [Esci] ▓▓▓▓│ band Forest
│━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│ 2 px Coral rule
│ ┌ sidebar 240 ─────┐ ┌ main, max 1040 ──────────────────────────────────────────────┐ │
│ │ Locali        12 │ │ h1 + summary line                                            │ │
│ │ Registro         │ │ content                                                      │ │
│ │ Avvisi         1 │ │                                                              │ │
│ │                  │ │                                                              │ │
│ │ ──────────────── │ │                                                              │ │
│ │ DigiAlto         │ │                                                              │ │
│ │ Verifica attiva  │ │                                                              │ │
│ └──────────────────┘ └──────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
```
- Sidebar links as the venue app's `sidebarLinkClass` (current = ink fill, paper text). Counts are plain numbers after the label
  ("Avvisi 1"), not red dots.
- Bottom of the sidebar: the account's display name "DigiAlto" and "Verifica in due passaggi attiva" (meta); no e-mail address.
- **Esci** in the band, as on the venue app's band (`account-control.tsx` look).

**Phone (360 px):** band with "Esci"; under the band the three sections as `NavPill`s (Locali · Registro · Avvisi); no bottom tabs (three
sections fit one pill row). Tables become lists (§4).

**Common rules:** one `h1` per screen; one primary per screen; every target ≥ 44 px; times in **Europe/Rome** with the date ("14 nov 2026,
09:40"), stated once in the sidebar footer / page footer: "Orari: ora italiana"; dates of a venue's activity are dates only.

## 4. Sign-in on the console host

The same Costì sign-in pages as the venue app (`docs/ux/costi-sign-in.md` §2–§3), with three differences:

```
[costì]
┌ card, Coral top edge ───────────────┐
│ Console                       h1 40  │
│ ──                                   │
│ Accesso riservato a DigiAlto.        │ intro
│ Email                                │
│ [                              ]     │
│ Password                             │
│ [                     ] [Mostra]     │
│ [   Accedi con la password   ]       │ PRIMARY
│ Password dimenticata?                │ meta
│ [      Inviami il link       ]       │ secondary
└──────────────────────────────────────┘
then: /login/codice  "Codice di verifica" (6 digits), always
then: Locali
```

1. **Band:** "Costì · Console" (there is no venue). Tab title "Costì · Console".
2. **No staff path:** no "Chi sei?", no PIN, no "Abilita questo telefono" link.
3. **The code is always asked** (plan FD31: `aal2` everywhere for this account), right after the password or e-mail code, on the existing
   `/login/codice` page. There is no "offer" page: the account cannot exist without a factor (bootstrap requires it).

| State | What shows |
|---|---|
| Wrong e-mail or password, rate limit | As the venue app (one `ErrorAlert`, password cleared) |
| A venue account (owner, chef) signs in here | After the code (or the password, if it has none): `ErrorAlert` "Questo account non ha accesso alla console." and the form again; no hint about the venue app's address |
| Platform admin, code wrong | Existing `/login/codice` errors |
| Session in tenant mode arrives here | `select_console()` is called on arrival; the console opens. The venue session ends on this device (plan §2.2 point 1: one mode at a time); the confirmation in F4 says so the other way round |
| Console function answers `mfa_required` (session lost its second factor) | Back to `/login/codice` with the status line "Per continuare inserisci il codice." |
| Console host down or Postgres error | "La console non risponde. Riprova tra poco." (`ErrorAlert`) with "Riprova" |

## 5. Locali (tenant list) — home of the console

### 5.1 Laptop

```
Locali                                                         [ + Nuovo locale ]  (SP7; primary)
──
2 locali da guardare · 1 avviso da leggere                      summary line (links)

[Cerca un locale… ]  Stato [Tutti ▾]  Piano [Tutti ▾]  [ ] Solo da guardare

┌──────────────────────┬──────────────┬───────────────┬──────────┬──────────────────┬──────────────┬─────────┐
│ Locale ▲             │ Gruppo       │ Stato         │ Piano    │ Salute           │ Ultima attività│ DigiAlto│
├──────────────────────┼──────────────┼───────────────┼──────────┼──────────────────┼──────────────┼─────────┤
│ Osteria Demo A       │ —            │ [● Attivo]    │ Completo │ [● Da guardare]  │ oggi         │ Sì      │
│ Ristorante · 4 persone│             │               │          │ 1 segnalazione   │              │         │
│ Bar Demo             │ Gruppo Demo  │ [● In prova]  │ Base     │ [● In ordine]    │ 12 nov       │ Sì      │
│ Bar · fino al 30 nov │              │               │          │                  │              │         │
└──────────────────────┴──────────────┴───────────────┴──────────┴──────────────────┴──────────────┴─────────┘
Mostro 12 locali.
```

- **Columns** (only the lead's list plus two the plan returns and the founder needs daily): Locale (name; meta line: venue type and member
  count, e.g. "Ristorante · 4 persone"; for a trial "fino al 30 nov"), Gruppo, Stato, Piano, **Salute**, Ultima attività, DigiAlto
  (attached: "Sì" / **"No"** in bold, since a missing attachment is unusual).
- **"4 persone"** is the sum of member counts by role (§2.3 allows counts); the breakdown is on the detail page. No names.
- **Default order: "Da guardare" first, then by last activity, newest first.** Every column header is a sort button (`aria-sort`); the
  chosen order is kept in the address (`?ordina=attivita`) so a reload keeps it.
- **Whole row is the link** to the venue (≥ 44 px). No actions in the row: every change happens on the detail page, where its effect is
  explained (no accidental suspension from a list).
- **Filters:** search by venue or group name (local filter, the list is small); Stato, Piano; checkbox "Solo da guardare". Chosen filters
  live in the address. A filter that empties the list: "Nessun locale con questi filtri." + "Togli i filtri" (quiet button).
- **Summary line** above the table: "Tutto in ordine" or "{n} locali da guardare" (link sets the checkbox) and "{n} avvisi da leggere"
  (link to Avvisi). It is the answer to F1 without scrolling.

### 5.2 Phone

```
Locali                                  h1
──
2 locali da guardare · 1 avviso         summary (links)
[Cerca un locale…            ]
▸ Filtri (Stato, Piano, Solo da guardare)   disclosure, closed
──────────────────────────────────────
Osteria Demo A           [Da guardare]  LedgerRow, title + health badge
Attivo · Completo · oggi · DigiAlto: sì meta
──────────────────────────────────────
Bar Demo                   [In ordine]
In prova fino al 30 nov · Base · 12 nov
──────────────────────────────────────
[        + Nuovo locale        ]        primary, after the list (SP7)
```
On the phone the status is in the meta line as a word; the badge slot shows **Salute**, because "is anything wrong" is the morning
question (F1).

### 5.3 Salute (health) in one word

| Word (badge tone) | When (plan §6.4 codes) |
|---|---|
| **In ordine** (success) | no finding, every job's last run OK |
| **Da guardare** (warning) | a job late or failed once, extraction failures, quota reached, sub-processor notice not yet sent, `admin_row_foreign`, platform admin not attached |
| **Problema** (danger) | a ledger-check finding (`app.ledger_checks_body`), a job failing repeatedly |
| **Non disponibile** (neutral) | health could not be read; never shown as "In ordine" |

The row's meta under the badge says how many: "1 segnalazione", "3 segnalazioni". The thresholds (how many failures make "Problema")
are the builder's from the plan; this file only fixes the words and the order.

### 5.4 States

| State | What shows |
|---|---|
| Loading | "Caricamento…" in place of the table; filters disabled |
| No venues yet | "Nessun locale. Crea il primo con «Nuovo locale»." (SP7) |
| Error | `ErrorAlert` "Non riesco a leggere i locali." + "Riprova" |
| Health partly unavailable | That row's badge "Non disponibile"; the others normal |

## 6. Venue detail `/locali/[id]`

### 6.1 Layout

**Laptop:** header across, then two columns: left (wider, 640): Stato e piano · Moduli · Impostazioni; right (360): Salute · Utilizzo ·
Attività di DigiAlto. **Phone:** one column in this order: header, **Salute**, Stato e piano, Moduli, Utilizzo, Attività di DigiAlto,
Impostazioni. (Health first on the phone, because the phone visit is usually "something is wrong".)

```
‹ Locali                                                          BackLink
Osteria Demo A                                              h1
──
Ristorante · nessun gruppo · creato il 21 ott 2026          meta
[● Attivo]  Piano Completo  · DigiAlto collegato             badges + meta
[ Entra nel locale ]                                         secondary (F4)
```

- **No primary in the header.** Each section has at most one action; the screen's primary is the action of the section being edited
  (a section opens its form in place; only one form open at a time, the others collapse to their summary).
- "Entra nel locale" is **secondary** on purpose: it is a support tool, not the console's job.

### 6.2 Salute

```
Salute                                   [● Da guardare]
· La lettura fatture è fallita 3 volte oggi.            sentence per finding
  Controlla il registro della lettura nel locale.       what to do (meta)
· Il lavoro «riepilogo KPI» non gira da 2 giorni.
Ultimo controllo: oggi, 09:40
```
- One sentence per finding code, then what to do; the raw code in small text at the end ("codice: extraction_failed") so the builder and
  the founder can search it. Codes and sentences are a table the copywriter drafts from the plan's code list (§11 Q-UX-C3).
- `admin_row_foreign`: "C'è un altro account con ruolo admin in questo locale. Va disattivato con lo script (migrate-legacy)."
- Platform admin not attached: "DigiAlto non è collegato a questo locale." + secondary "Collega DigiAlto" (`platform_attach_admin`, SP4).
- No findings: "Nessuna segnalazione." + "Ultimo controllo: …".

### 6.3 Stato e piano

```
Stato e piano
Stato        Attivo dal 1 nov 2026
Piano        Completo dal 1 nov 2026
Prova        —
[ Cambia stato ]   [ Cambia piano ]          secondary buttons
▸ Storico (4)                                disclosure: the status and plan events, newest first
```

**Cambia stato** opens in place:

```
Nuovo stato
( ) Attivo   (•) Sospeso   ( ) Disdetto     radio, only the allowed transitions
Motivo  [ Mancato pagamento ▾ ]             select of reason codes (required)
Sospeso significa: il locale può leggere ed esportare, non può
scrivere. Parte dal prossimo cambio giornata del locale
(02:00 di domani, 15 nov), mai durante un servizio.
[       Sospendi il locale       ]          PRIMARY, wording follows the choice
[            Annulla             ]
```
- **The effect is said before the button**, in plain words, with the **date and time it starts** (plan §3.1: next business-day cut-off).
- **Disdetto** adds: "Il titolare potrà ancora esportare i dati. La cancellazione definitiva è un passo separato (vedi Dati)." and needs the
  venue's name typed to confirm ("Scrivi «Osteria Demo A» per confermare"); the button stays disabled until it matches (§10 C3).
- **Riattiva** from Sospeso is one step with a reason, effective at once.
- `In preparazione` → only through the wizard (SP7); the console shows it, it does not set it.
- After saving: `SuccessNote` "Il locale sarà sospeso dal 15 nov, 02:00." and the history gets the row. A scheduled suspension shows in the
  header as "[Attivo] · sospensione dal 15 nov, 02:00".

**Cambia piano** opens a select of active plans (`label`), the line "Le eccezioni dei moduli restano valide." and the primary "Cambia
piano". A trial shows its end date and "Prolunga la prova" (date field, max per FD6).

### 6.4 Moduli

```
Moduli                                  Modalità: Applica  (or: Osserva, info badge)
Ricette e costi          [●  Attivo ]   dal piano
Magazzino                [●  Attivo ]   dal piano
Prenotazioni             [  Spento ●]   eccezione fino al 30 nov · prova commerciale
Cucina                   [  Spento ●]   serve «Ordini» (switch disabled, reason given)
…
Lettura fatture (AI)     240 al mese    dal piano · usate 112 questo mese
```
- **Switch rows** (`role="switch"`, label = module name, state in words "Attivo" / "Spento" next to the switch, not only its position);
  44 px tall. Order: the module list of plan §4.2, grouped under small headings ("Acquisti e magazzino", "Servizio", "Rapporti", "Altro").
- **Source line** under each: "dal piano" or "eccezione fino al … · {motivo}" (or "eccezione senza scadenza").
- **Changing a switch never saves on its own:** it opens a small form under that row: Motivo (select, required), Fino al (date, optional),
  then "Salva eccezione" (primary) / "Annulla". Saving writes one override (append-only) and one audit row. "Torna al piano" removes
  nothing: it writes a new override that ends the old one (wording: "Usa di nuovo il piano").
- **Dependencies** (`requires`): a switch that cannot change says why in words ("serve «Ordini»"); turning off a module others need
  lists them: "Spegnendo Ordini si spengono anche Cucina, Offline e Chiusura cassa." before saving.
- **Metered modules** show the limit and this month's use instead of a switch; "Cambia limite" opens the same override form with a number.
- **Observe mode** (plan §4.1 `entitlement_mode`): an info notice at the top of the section: "Modalità osservazione: i moduli spenti non
  vengono bloccati, solo registrati. Blocchi registrati negli ultimi 30 giorni: 0." Tenant #1 runs in this mode until SP13. Switching to
  "Applica" is its own confirm step with the count of would-be refusals.
- **Effect line** before saving a switch-off: "Il personale non vedrà più il modulo. I dati restano e il titolare può esportarli." (plan
  §4.1: off never deletes or hides data from the owner).

### 6.5 Utilizzo (SP11)

```
Utilizzo · novembre 2026
Fatture lette (AI)       112 di 240
File caricati            38 · 41 MB
Persone                  1 titolare · 1 cuoco · 2 camerieri · DigiAlto
```
- Counts only; **no money** (the app knows no prices; plan §6.3). Quota reached: "Limite raggiunto: le fatture restano in attesa fino al
  1 dic o finché alzi il limite." + link to the module row.
- Member counts by role, never names.

### 6.6 Attività di DigiAlto

```
Attività di DigiAlto                         last 10, newest first
14 nov, 09:40   Modulo Prenotazioni acceso (eccezione fino al 30 nov)
12 nov, 18:02   Entrata nel locale
1 nov, 10:15    Stato: Attivo
Vedi tutto nel registro ›                    TextLink → Registro filtered on this venue
Quello che DigiAlto fa dentro il locale è nel registro del locale
(filtro «Solo DigiAlto»), visibile al titolare.            meta
```
- Source: the platform audit rows for this venue (plan §2.2 point 5) and the attach/entry events. **What DigiAlto did inside the venue
  (business actions) is tenant data and stays in the venue's own `/registro`** (plan §2.4 point 5); the console only says where to find it.

### 6.7 Impostazioni

Read-only summary of the per-tenant configuration the plan lists as metadata (SP1/SP9): lingua, fuso orario, tipo di locale, nome del
locale, slug of the booking page. Editing these is the owner's (wizard, SP7) or a later console step; the console shows them so support
can see them without entering the venue. Each row: term / value (`FactRow`).

### 6.8 Dati (SP10)

Only for a **Disdetto** venue, as the last section:

```
Dati
Disdetto dal 1 dic 2026. Cancellazione possibile dal {data} (periodo di conservazione).   or "Periodo di conservazione non ancora fissato: nessuna cancellazione possibile."
1 Richiesta scritta del titolare      [ Registra richiesta ]   → code field "Riferimento del documento" (no personal data)
2 Approvazione di DigiAlto            [ Approva la cancellazione ]  (enabled after 1)
3 Esecuzione                          "Si fa con lo script tenant-erase." (no button)
```
- A numbered checklist: each step shows done/not done in words ("Registrata il 3 dic, rif. DOC-12"). The console **never deletes**; it
  records the two events the function requires (plan §6.2). The same person often records the request and approves it (plan §6.2); the
  two steps stay separate on screen, as in the database.

## 7. Registro della piattaforma `/registro`

```
Registro della piattaforma                                  h1
──
Locale [Tutti ▾]  Azione [Tutte ▾]  Dal [ 01/11/2026 ]  Al [ 14/11/2026 ]

┌───────────────────┬──────────────────────┬────────────────────────────────────┬──────────────┐
│ Quando            │ Locale               │ Azione                             │ Da           │
├───────────────────┼──────────────────────┼────────────────────────────────────┼──────────────┤
│ 14 nov, 09:40     │ Osteria Demo A       │ Modulo acceso: Prenotazioni        │ Console      │
│ 14 nov, 08:12     │ —                    │ Accesso alla console               │ Console      │
│ 13 nov, 22:05     │ Bar Demo             │ Invito collegato                   │ Script       │
└───────────────────┴──────────────────────┴────────────────────────────────────┴──────────────┘
[ Carica altri ]
```
- **Columns:** when (Europe/Rome), venue (or "—" for platform-wide rows; an erased venue shows "Locale cancellato" with its short id),
  action (a sentence from the action code, §11 Q-UX-C3), **origin**: "Console" or "Script" (from the code path; a script row is DigiAlto
  using the secret key, which the founder must be able to tell apart).
- **Row opens a detail panel** (side panel on laptop, page on phone) with the action code, ids and codes from `detail`, never business data
  (plan §2.2 point 5: no e-mail address, codes and ids only).
- **Append-only:** no edit, no delete, no hide; the screen has no such action.
- Phone: each row is a `LedgerRow`: title = action sentence, meta = "14 nov, 09:40 · Osteria Demo A · Console".
- Empty filter result: "Nessuna azione in questo periodo."
- Default range: last 30 days; newest first; "Carica altri" pages by 50.

## 8. Avvisi (notices)

Two kinds, one list (plan §3 SP3 test 9; §6.4):

| Kind | Row | Action |
|---|---|---|
| Platform health (stale job, invariant drift in a venue) | "Lettura fatture ferma in 2 locali da 3 ore" | link to the filtered Locali list |
| Sub-processor notice (version) | "Nuovo sub-responsabile v3: 2 locali non ancora avvisati" | "Segna come avvisato" per venue, with the date (records the notified date) |

- Read notices move to "Letti" (a second tab); nothing is deleted. The sidebar count is the unread count.
- No e-mails from the console (plan §6.4, ADR-006): this page is the only place notices appear.

## 9. Metadata-only check (plan §2.3, SP3 test 5)

| Screen | Shows | Never shows |
|---|---|---|
| Locali | names of venues and groups, type, status, plan, health words, last activity date, member count | owner name or e-mail, any amount |
| Venue detail | the above + features, overrides, usage counts, finding codes, config summary, platform audit rows | staff names, invoices, costs, orders, reservations, guest data, prices of plans |
| Registro | action codes as sentences, ids, origin | `detail` values that are not codes or ids |
| Avvisi | counts of venues, versions, dates | names of people |

If a later need appears that this table forbids, it goes to the founder as a question, never into a screen first (§11).

## 10. Proposals that differ from or add to the plan (for the lead)

**Lead decision (2026-11-14): C1–C9 accepted, all of them.** Where they differ from the plan, this file wins for the screens.

| # | Proposal | Plan says | Why |
|---|---|---|---|
| C1 | Band wordmark "Costì · Console" (no venue name); update `costi-design-system.md` §1's console row in the same PR as the build | "Costì · Console" strings | The one product surface with no venue; the band must still name where you are |
| C2 | "Locale" / "Gruppo" on screen for tenant / organisation | tenant, organisation | The founder's and the venues' words |
| C3 | "Disdetto" needs the venue's name typed to confirm; "Sospeso" needs a reason and states the start time | reason codes | Both are hard to undo for a venue in service; the typed name stops a mis-tap on the wrong row |
| C4 | No actions in list rows; every change on the detail page with its effect stated | not specified | One person, many venues: no change without seeing which venue and what happens |
| C5 | Health in one word with four values, "Non disponibile" never shown as "In ordine" | finding codes | F1 is "is anything wrong?"; an unknown must not look fine |
| C6 | "Torna alla console" in the venue app's account menu for the platform admin in tenant mode | not specified | The way back from F4; one mode at a time means a fresh `select_console()` |
| C7 | Origin column "Console" / "Script" in the platform audit | rows written by both | Secret-key use must be visible at a glance (plan §2.2 "honesty about the secret key") |
| C8 | Switches never save on change; a reason is always asked | overrides carry `reason_code` | An accidental tap on a switch must not change a venue's service |
| C9 | Section order on the phone puts Salute first | — | Phone visits are usually "something is wrong" |

## 11. Open questions

| # | For | Question | Default |
|---|---|---|---|
| Q-UX-C1 | Founder | Anything you want to see in the console beyond §2.3's metadata (asked in chat, one at a time) | Only §2.3 |
| Q-UX-C2 | Founder | Wording of every string here (da approvare) | Copywriter drafts from this file; you approve |
| Q-UX-C3 | Lead / builder | The sentence for each finding code and each audit action code (one table, from the plan's code lists) | **Closed (lead, 2026-11-14):** the builder produces the code list in SP3, the copywriter drafts one sentence per code, the raw code stays visible in small text |
| Q-UX-C4 | Lead | Accept C1–C9? | **Closed:** all accepted (lead, 2026-11-14) |
| Q-UX-C5 | Founder | Reason codes offered for suspend, cancel and overrides | Suspend: mancato pagamento, fine prova, richiesta del titolare, abuso; cancel: richiesta del titolare, fine contratto; override: prova commerciale, accordo, supporto, correzione |
