# Screens: Avvio magazzino (opening stock)

- **Status:** direction approved by the lead (2026-11-18: Q-A1–Q-A3, Q-A5); data side (§7) aligned with builder 1's note (2026-11-18) ·
  **Author:** UX/UI designer · **Date:** 2026-11-18
- **Founder request (2026-11-18, via the lead):** "there should be a way to add ingredients and their costs as it already has stock when
  they start in the tenant."
- **Spec for:** a new owner/admin screen, `/magazzino/avvio` (path is a suggestion), and what changes afterwards in Magazzino, the
  ingredient detail and recipe costs.
- **Look:** Costì + the venue layer (`costi-design-system.md`). Phone first (360 px), with a laptop layout, because 50–150 rows are typed
  faster at a desk.
- **Wording:** every new Italian string is **(da approvare)**.

## 1. The job

On day one the venue already has a store room full of food that no invoice in the app explains. Until it is entered, Magazzino says zero,
consumption from sales drives balances negative, and every recipe built from those ingredients has no cost. The owner (or DigiAlto during
onboarding) needs to say once: **"this is what we have, where it is, and what it cost"**, quickly, for 50–150 lines.

## 2. One-time setup or reusable? Recommendation: one "Carico iniziale" per venue, kept as a draft until confirmed

| Option | For | Against |
|---|---|---|
| **A. One-time "Carico iniziale"** (recommended) | Matches the founder's words ("when they start"); one clear moment; easy to explain in the books ("stock at 1 dic"); no second way to add stock that bypasses invoices | A venue that forgets a shelf needs a way to add it later (answered below) |
| B. A reusable "carico" anyone can repeat | Flexible | It becomes a back door around invoices: stock and costs appear with no document, and food cost stops being traceable |

**How A works:**

1. The owner opens **Avvio magazzino** from "Primi passi" on Home (a new step, "Carica il magazzino iniziale", da approvare) or from
   Magazzino.
2. It is a **draft**: rows are saved as they are typed (on the server, so a phone and a laptop see the same list), and can be edited or
   removed freely. Nothing touches stock yet. The list is **grouped by location**, because the database books one operation per location.
3. **"Conferma il carico iniziale"** (one primary, two-step confirm) books the draft **one location at a time**, each as its own
   operation, all dated with the chosen **Data del carico** (default today; never in the future; never after the first invoice received).
   The confirm step lists them ("Dispensa · 24 righe", "Frigo 1 · 13 righe"); the result says per location what was booked, and a location
   that fails stays in the draft with its reason, while the others are booked.
4. A booked location is **closed**: read-only, listed in Magazzino history. Mistakes are corrected by reversing that location's operation
   (§5).
5. **Forgotten items** go through **"Aggiunta al carico iniziale"** (da approvare): the same screen, a new small draft for that location,
   booked as one more opening operation. It is allowed **per location, until that location's first approved monthly (full) count**; daily partial
   counts do not close the window (lead, 2026-11-18). After that, a count is the honest way to bring a forgotten item in. While a count
   of that location is **open**, no carico can be booked there (§3.4).

## 3. The screen

### 3.1 Phone (360 px)

```
‹ Magazzino                                       BackLink
Avvio magazzino                                   h1
──
Inserisci quello che hai già in magazzino oggi,   intro (da approvare)
con il costo che hai pagato. Serve una volta sola.
┌ Card ────────────────────────────────────┐
│ Data del carico   [ 01/12/2026 ]          │  Field, date
│ Ubicazione        [ Dispensa ▾ ]          │  default for new rows (remembered)
└───────────────────────────────────────────┘
┌ Nuova riga ───────────────────────────────┐
│ Ingrediente  [ farina 00…            ]    │  combobox: search; last option "Crea «farina 00»"
│ Quantità     [ 25    ] kg                 │  unit from the ingredient, as text after the field
│ Costo        [ 0,80  ] € / kg             │  per base unit; hint "IVA esclusa" (da approvare)
│ Ubicazione   Dispensa  (cambia)           │  quiet link opens the select
│ [        Aggiungi riga        ]           │  secondary; Enter also adds
└───────────────────────────────────────────┘
Righe · 37 · totale 2.418,60 €                    SubHeading + .num total (<strong>)
──────────────────────────────────────────────
Farina 00                          20,00 €        LedgerRow: title, trailing = row value
25 kg · 0,80 €/kg · Dispensa                      meta, .num
──────────────────────────────────────────────
Mozzarella fior di latte           38,40 €
4,8 kg · 8,00 €/kg · Frigo 1
──────────────────────────────────────────────
…
[ Conferma il carico iniziale ]                   PRIMARY (sticky bar on the phone)
```

- **Fast entry:** after "Aggiungi riga" the form clears, keeps the location and focuses Ingrediente again, so a row is: type 3–4 letters,
  pick, quantity, cost, Enter. The row appears at the **top** of the list with a 2 s `SuccessNote`-style highlight (motion only if not
  reduced) and `role="status"` "Aggiunta: Farina 00, 25 kg" (da approvare).
- **Tapping a row** opens it in place to edit (the same four fields) with "Salva" and "Rimuovi" (danger, quiet): it is a draft, so removing
  is allowed and leaves no trace.
- **Grouped by location:** the list has one small heading per location with its subtotal ("Dispensa · 24 righe · 1.610,20 €",
  da approvare), because each location is booked as its own operation (§2, §7).
- **Totals:** "Righe · 37 · totale 2.418,60 €" (`<strong>` on the total, §10.4) so the owner can sanity-check against what they think the
  store is worth.

### 3.2 Laptop (≥ 1024 px): a grid, keyboard first

```
Avvio magazzino                                        Data del carico [01/12/2026]   [ Incolla da foglio di calcolo ]
┌─────────────────────────┬──────────┬──────┬─────────────┬──────────────┬───────────┬───┐
│ Ingrediente             │ Quantità │ Unità│ Costo unit. │ Ubicazione   │ Valore    │   │
├─────────────────────────┼──────────┼──────┼─────────────┼──────────────┼───────────┼───┤
│ [farina 00         ▾]   │ [25    ] │ kg   │ [0,80   ] € │ [Dispensa ▾] │   20,00 € │ ✕ │  entry row on top, Tab moves right,
│ Mozzarella fior di latte│    4,8   │ kg   │      8,00 € │ Frigo 1      │   38,40 € │ ✕ │  Enter adds and returns to Ingrediente
└─────────────────────────┴──────────┴──────┴─────────────┴──────────────┴───────────┴───┘
Righe · 37 · totale 2.418,60 €                                          [ Conferma il carico iniziale ]
```

- Tab order: Ingrediente → Quantità → Costo → Ubicazione → Enter (adds). Every cell has a real `<label>` (visually the column header,
  `aria-labelledby`), errors sit in the row, below the cell.
- **"Incolla da foglio di calcolo"** (da approvare): a secondary that opens a text area for rows copied from Excel/Numbers (4 columns:
  ingrediente, quantità, costo, ubicazione; tab or semicolon separated; Italian decimals). The paste becomes a **preview** of draft rows with
  each row's problem in words ("Ingrediente nuovo: verrà creato in kg", "Ubicazione sconosciuta", "Costo mancante") and nothing is saved
  until "Aggiungi 52 righe". It reuses the master-data import's CSV rules (`/anagrafiche/importa`). This is what makes 150 rows a 10-minute
  job.

### 3.3 Creating an ingredient on the fly

"Crea «farina 00»" in the combobox opens a **compact inline form** in the row: Nome (prefilled), **Unità di base** (`SegmentedControl` kg ·
l · pz, required: it cannot be changed later), and "Crea e continua". Allergens and supplier items are **not** asked here: the ingredient
gets the existing "allergeni da confermare" flag (`/anagrafiche/ingredienti` already shows it), so the setup stays fast and the allergen
duty is not skipped silently.

### 3.4 Validation, in words

| Problem | Message (da approvare) |
|---|---|
| Quantity 0, negative or not a number | "Inserisci una quantità maggiore di zero." |
| Cost missing | "Inserisci il costo: serve per il food cost." (a row without a cost is not allowed; "0,00 €" must be typed on purpose, with the hint "Merce senza costo: omaggi o campioni") |
| Same ingredient and location twice | **One row per ingredient and location** (lead, 2026-11-18): there is no "separate row". Same cost: the quantities are summed, said in a status line "Farina 00 in Dispensa: 25 kg + 10 kg = 35 kg." Different cost: the screen asks before saving, "Farina 00 è già in Dispensa a 0,80 €/kg. Con quale costo tengo i 35 kg?" with "0,80 €/kg" / "0,90 €/kg" (two secondary buttons) and "Annulla". In a paste, duplicates are merged in the preview and said per row ("unita a una riga precedente"); a cost conflict blocks that row until the owner picks |
| Unit mismatch in paste (`g` for a kg ingredient) | The database takes base units only (kg, l, pz), so the preview converts when unambiguous (g → kg, ml → l) and says it: "500 g → 0,5 kg"; otherwise it refuses the row with the reason. The conversion is a pure helper in `src/lib`, never in a component |
| Data del carico after the first invoice received | "La data deve essere prima della prima fattura ricevuta (3 dic)." |
| Location already counted (monthly) | "Dispensa ha un conteggio mensile approvato il 15 dic: per aggiungere merce usa un conteggio." (the location is not offered). A daily partial count does not block it |
| A count of the location is open | "In Dispensa c'è un conteggio aperto: chiudilo o annullalo prima di caricare." (the location's rows stay in the draft; the others can be booked) |

## 4. What the owner sees afterwards

- **Magazzino:** balances include the carico. Each ingredient's history shows one row "Carico iniziale · 1 dic · 25 kg · 0,80 €/kg"
  (da approvare), not editable; a reversed operation shows its rows struck through with "Annullato il 2 dic · motivo".
- **Ingredient detail:** the stock is "Senza lotto · Dispensa" (opening stock has no lot or use-by in v1, §9 Q-A3). **So the carico
  stock gets no expiry alerts**: Avvisi and "Da spingere" know nothing about its dates. The screen says it once, under the intro and in the
  confirm step: "Il carico iniziale non ha lotti né scadenze: l'app non ti avviserà quando scadono. Controllali tu finché non arrivano le
  prime fatture." (da approvare)
- **Recipe costs:** an ingredient whose only price comes from the carico shows its cost with the source in words: "Costo da carico
  iniziale" (da approvare) next to the figure, so the owner knows it is their own estimate, not an invoice. As soon as the ingredient has
  an invoice price, **the invoice price wins outright** (no blending with the carico cost) for new costs; frozen costs of past sales never
  change.
- **Home "Primi passi":** "Carica il magazzino iniziale" → "Fatto" once confirmed.
- **Reports:** the carico value appears as opening stock in the reconciliation (`/magazzino/riconciliazione`), never as a purchase: it was
  not bought in the period.

## 5. Correcting mistakes after confirmation (reversal, never delete)

Ledgers are append-only (project invariant): a booked operation is never edited or deleted. The database reverses **a whole location's
operation**, so the screen corrects that way, and makes it cheap:

- On a booked location, **"Correggi il carico di Dispensa"** (quiet, da approvare) opens a step: a required reason (select: "Quantità
  sbagliate", "Costi sbagliati", "Ingredienti sbagliati", "Ubicazione sbagliata"; da approvare) and the sentence "Annulliamo il carico di
  Dispensa (24 righe) e lo rimettiamo in bozza, così correggi solo le righe sbagliate e confermi di nuovo." (da approvare), then
  **"Annulla e correggi"** (danger).
- That writes the **reversal of the whole operation** (one transaction, audited, visible in history as "Carico iniziale annullato ·
  motivo" with who and when) and puts the **same rows back into the draft**, prefilled. The owner fixes the one wrong row and confirms
  again: one new operation. Nothing is retyped.
- To remove a location's carico without rebooking it: the same step, then "Svuota la bozza" in the draft.
- **Limit:** a location can be corrected only until its first approved **monthly (full)** count, and not while a count of it is open;
  after the monthly count, stock is corrected by counting (conteggi), and the cost by the next invoice. A location that can no longer be
  corrected says so: "Dispensa ha un conteggio mensile approvato il 15 dic: correggi con un conteggio." (da approvare).
- Food cost: a corrected cost applies to costs computed **after** the correction; sales already made keep their frozen cost (project
  invariant), and the step says so: "I piatti già venduti mantengono il costo di allora." (da approvare).

## 6. Who

Owner and admin only (it writes stock and costs). The chef sees the result in Magazzino but no costs on it, as today; a waiter never sees
the screen. DigiAlto during onboarding uses it as admin (entering the venue from the console, its actions recorded as DigiAlto).

## 7. Data side (aligned with builder 1's note, 2026-11-18)

Builder 1's plan owns the data; this is what the screens rely on, as the lead summarised the note:

1. **A new stock movement type `opening`**: unlotted, cost frozen at booking, read by the reconciliation as opening stock and **never**
   counted as a purchase.
2. **One owner/admin procedure `post_opening_stock(location, lines)`**: one location per call, one transaction, audited. The screen calls
   it once per location of the draft (§2 step 3) and reports each result.
3. **Quantities in base units only** (kg, l, pz): the screen converts what it can before sending (§3.4) and never sends anything else.
4. **Effective date** chosen by the owner: not in the future, not after the first invoice receipt (the screen validates the same rule
   and words the server's refusal).
5. **Allowed per location until that location's first approved monthly (full) count** (daily partial counts don't close it), for the
   first carico, additions and corrections alike; **refused while a count of that location is open**.
6. **Corrections by reversal of the whole operation** (§5): the screen pairs it with putting the rows back into the draft.
7. **Cost source**: the opening unit cost is used only while the ingredient has no invoice price; then the invoice price wins, with no
   blending. The cost API must say which source a figure comes from, so the screen can show "Costo da carico iniziale".
8. **A server-side draft**, in the smallest form builder 1's plan proposes. The screens need only: rows per location (ingredient, quantity,
   unit cost), edited and removed freely, shared between the owner's devices, and restorable from a reversed operation (§5).
9. **No duplicate lines**: one line per ingredient and location in an operation; the screen merges or asks before sending (§3.4).

## 8. States checklist

| State | What shows |
|---|---|
| No draft yet | Intro, the date and location card, the empty entry form, "Nessuna riga ancora." |
| Draft with rows | The list with totals, the primary "Conferma il carico iniziale" |
| Saving a row | The row shows "Salvataggio…"; the form stays usable |
| Offline | The form is disabled with "Serve la connessione per caricare il magazzino." (stock writes are online-only, like the kitchen) |
| Confirming | Step 2: "Carichi 37 righe per 2.418,60 € alla data 01/12/2026: Dispensa (24), Frigo 1 (13). Dopo la conferma si corregge annullando il carico di un'ubicazione." plus the no-expiry sentence (§4) + "Conferma" / "Annulla" |
| Partly booked | Per location: "Dispensa: caricato" (`SuccessNote`) or "Frigo 1: non caricato · motivo" (`ErrorAlert`); the failed location stays in the draft |
| Confirmed | Read-only list per location, "Confermato il 1 dic da Mario", "Correggi il carico di …" and "Aggiunta al carico iniziale" on locations without an approved monthly count |
| A count is open | That location's actions are disabled with the reason "Conteggio aperto in Dispensa" (da approvare); other locations work |
| Error | `ErrorAlert` with the reason; the draft is never lost |

All targets ≥ 44 px; one primary per screen; amounts `1.234,50 €` in `.num`; dates Europe/Rome.

## 9. Open questions

| # | For | Question | Default |
|---|---|---|---|
| Q-A1 | Lead | One-time carico (with an "Aggiunta" window until the first count), as §2 recommends? | **Decided (lead, 2026-11-18): yes**, additions until the first approved monthly (full) count; refused while a count is open; one row per ingredient and location |
| Q-A2 | Founder | Cost per base unit **IVA esclusa**, like invoice prices? | **Decided (lead, 2026-11-18): IVA esclusa**, as the invoice side |
| Q-A3 | Lead | Lots and use-by on opening stock: optional fields (laptop grid only) or none? | **Decided (lead, 2026-11-18): none in v1**; no expiry alerts for carico stock, said on screen (§4) |
| Q-A4 | Builder 1 | The data side | **Answered (builder 1's note, 2026-11-18)**: §7 |
| Q-A5 | Founder | Wording (all da approvare) | **Decided (lead): stays da approvare**; the copywriter drafts, the founder approves |
