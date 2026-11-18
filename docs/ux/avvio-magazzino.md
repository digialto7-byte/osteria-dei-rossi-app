# Screens: Avvio magazzino (opening stock)

- **Status:** draft for the lead; **the data side (§7) waits for builder 1's note** on what the database already supports ·
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
   removed freely. Nothing touches stock yet.
3. **"Conferma il carico iniziale"** (one primary, two-step confirm) books every row at once, dated with a chosen **Data del carico**
   (default today, never in the future, never after the first approved invoice).
4. After confirmation the carico is **closed**: read-only, listed in Magazzino history. Mistakes are corrected by reversal (§5).
5. **Forgotten items after confirmation** go through a **"Aggiunta al carico iniziale"** (da approvare): the same screen, a new small draft,
   allowed only until the first stock count (conteggio) is approved. After that, a count is the honest way to bring a forgotten item in:
   "Trovato in conteggio".

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
| Same ingredient and location twice | Not an error: "Già presente in Dispensa: 25 kg. Sommo le quantità?" with "Somma" / "Riga separata" (two lots at two prices are real) |
| Unit mismatch in paste (`g` for a kg ingredient) | Converted when unambiguous (g → kg, ml → l) and said in the preview: "500 g → 0,5 kg"; otherwise refused with the reason |
| Data del carico after the first approved invoice | "La data deve essere prima della prima fattura approvata (3 dic)." |

## 4. What the owner sees afterwards

- **Magazzino:** balances include the carico. Each ingredient's history shows one row "Carico iniziale · 1 dic · 25 kg · 0,80 €/kg"
  (da approvare), not editable.
- **Ingredient detail:** the stock is "Senza lotto · Dispensa" (opening stock has no lot or use-by in v1, §9 Q-A3).
- **Recipe costs:** an ingredient whose only price comes from the carico shows its cost with the source in words: "Costo da carico
  iniziale" (da approvare) next to the figure, so the owner knows it is their own estimate, not an invoice. When the first approved invoice
  brings a price, the invoice price takes over for new costs (frozen costs of past sales never change).
- **Home "Primi passi":** "Carica il magazzino iniziale" → "Fatto" once confirmed.
- **Reports:** the carico value appears as opening stock in the reconciliation (`/magazzino/riconciliazione`), never as a purchase: it was
  not bought in the period.

## 5. Correcting mistakes after confirmation (reversal, never delete)

Ledgers are append-only (project invariant): a confirmed row is never edited or deleted.

- On the closed carico, each row has **"Correggi"** (quiet) → a small form: the corrected quantity and/or cost, and a required reason
  (select: "Quantità sbagliata", "Costo sbagliato", "Ingrediente sbagliato", "Ubicazione sbagliata"; da approvare).
- **"Salva correzione"** writes two rows in one transaction: a **reversal** of the original row and a **new row** with the right values,
  both dated with the carico's date, both visible in the history as "Correzione del carico iniziale · motivo" with who and when.
- A whole row that should not exist: "Annulla riga" = a reversal only, with the reason.
- **Limit:** corrections are allowed until the first approved stock count of that ingredient's location; after it, stock is corrected by
  counting (conteggi), which already exists, and the cost by the next invoice. The screen says so on a row that can no longer be corrected:
  "Corretto dal conteggio del 15 dic: modifica dal conteggio." (da approvare).
- Food cost: a corrected cost applies to costs computed **after** the correction; sales already made keep their frozen cost (project
  invariant), and the correction row says so: "I piatti già venduti mantengono il costo di allora." (da approvare).

## 6. Who

Owner and admin only (it writes stock and costs). The chef sees the result in Magazzino but no costs on it, as today; a waiter never sees
the screen. DigiAlto during onboarding uses it as admin (entering the venue from the console, its actions recorded as DigiAlto).

## 7. Data side — pending builder 1's note

To be finalised when builder 1 reports what the database supports. What the screens need, as questions, not decisions:

1. A movement type for opening stock (or an existing one, such as `receipt` without an invoice, with a source flag) that the
   reconciliation reads as **opening**, not as a purchase.
2. A draft store for the rows (server-side, per tenant), separate from the ledger, so the draft can be edited and deleted freely.
3. One confirm procedure: all rows in one transaction, dated `Data del carico`, idempotent on a double tap, refused if the date is after the
   first approved invoice.
4. A price source for costing: the carico's unit cost, used until an approved invoice price exists for that ingredient, labelled as such
   in the cost API so the screen can say "Costo da carico iniziale".
5. Reversal rows for corrections (the M12 stock reversal pattern), with a reason code and the original row's id.
6. Whether opening stock may carry a lot code and use-by (Q-A3).

## 8. States checklist

| State | What shows |
|---|---|
| No draft yet | Intro, the date and location card, the empty entry form, "Nessuna riga ancora." |
| Draft with rows | The list with totals, the primary "Conferma il carico iniziale" |
| Saving a row | The row shows "Salvataggio…"; the form stays usable |
| Offline | The form is disabled with "Serve la connessione per caricare il magazzino." (stock writes are online-only, like the kitchen) |
| Confirming | Step 2: "Carichi 37 righe per 2.418,60 € alla data 01/12/2026. Dopo la conferma le righe si correggono solo con uno storno." + "Conferma" / "Annulla" |
| Confirmed | Read-only list, "Confermato il 1 dic da Mario", "Correggi" on rows still correctable, "Aggiunta al carico iniziale" while allowed |
| Error | `ErrorAlert` with the reason; the draft is never lost |

All targets ≥ 44 px; one primary per screen; amounts `1.234,50 €` in `.num`; dates Europe/Rome.

## 9. Open questions

| # | For | Question | Default |
|---|---|---|---|
| Q-A1 | Lead | One-time carico (with an "Aggiunta" window until the first count), as §2 recommends? | Yes |
| Q-A2 | Founder | Cost per base unit **IVA esclusa**, like invoice prices? | Yes |
| Q-A3 | Lead | Lots and use-by on opening stock: optional fields (laptop grid only) or none? | None in v1; traceability starts with the first invoice |
| Q-A4 | Builder 1 | §7 items 1–6 | Waits for the note |
| Q-A5 | Founder | Wording (all da approvare) | The copywriter drafts; the founder approves |
