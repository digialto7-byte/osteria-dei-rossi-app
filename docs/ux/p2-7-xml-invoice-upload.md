# Screens: P2-7 XML e-invoice upload

- **Status:** draft for the lead and the founder · **Author:** UX/UI designer · **Date:** 2026-11-14
- **Spec for:** `docs/plans/2026-11-14-p2-7-xml-invoice-upload.md` (PR #103, approved by the lead), §3.8 (screens), with §3.5 (suppliers and
  duplicates), §3.6 (lot hooks) and §3.7 (API replies). The plan owns the data, the API, the error codes and the roles; this file owns
  **layout, order, states and wording** of the screens. Where this file proposes something different from or in addition to the plan, it
  says so in §8 and the lead decides.
- **Look:** venue screens (`/fatture` is a signed-in owner screen), so the **osteria theme** (`docs/design/ui-foundation.md` §1–§7), never
  Costì (`docs/ux/costi-design-system.md` §1). Components by their code names (`Button`, `Field`, `Badge`, `ErrorAlert`, `SuccessNote`,
  `Card`, `LedgerRow`, `TextLink`), as in the Figma library.
- **Rules used everywhere here:** 360 px first; one primary action per screen; every target ≥ 44 px; amounts `1.234,50 €` with tabular
  figures; dates Europe/Rome (`3 nov 2026`); every value from `/api/*`; a status is always a word, never colour alone; nothing is guessed:
  what the file does not say is shown as missing, what Costì ignores is listed.
- **Wording.** Strings already in `src/lib/i18n/messages/it.ts` are quoted with their key. Every other Italian string is the plan's draft,
  sometimes shortened here (§8), and is **(da approvare)** until the copywriter drafts it and the founder approves it. English is the
  second locale, as everywhere. Example data uses demo names only (Fornitore Demo 1, FT 12).
- **Figma:** not drawn yet (the Starter plan's monthly MCP limit, `docs/ux/README.md`). The components these screens need already exist in
  the library; the screens follow when Figma calls are available again.

## 1. Who sees what

| | Owner | Admin | Chef | Waiter |
|---|---|---|---|---|
| Upload card with the XML choice, refusal messages | yes | yes | no (no `/fatture`) | no |
| List chips "XML" / "XML firmato" | yes | yes | no | no |
| Review: "Dati dal file XML", notes, line details, "Usa come lotto / scadenza", new supplier, duplicate banners, "Usa il file XML al posto del PDF" | yes | yes | no | no |
| Lots copied from the file, after approval | yes | yes | in Magazzino and Tracciabilità, **without prices** (as today) | no |

Chef and waiter have no entry in the nav and get the existing 403 page on every route here (plan §3.9). No screen in this spec shows a
codice fiscale: the plan reads it only for the buyer check and never stores it (D-X7).

## 2. Flows

### F1 · Upload an e-invoice file (the main job)
```
Gestione › Fatture ─ card "Carica una fattura" ─ "Carica PDF, foto o file XML" ─ pick FT12.xml.p7m
   └─ chip "Fattura elettronica" ─ Carica ─ "Caricamento e lettura del file…"
        ├─ read ─ SuccessNote "Fattura FT 12 del 3 nov · Fornitore Demo 1 · 1.234,50 € letta dal file XML." ─ "Controlla ora ›"
        │     └─ /fatture/<id>/revisione ─ check ─ Approva (unchanged)
        └─ refused ─ ErrorAlert with the reason and what to do; nothing saved; pick another file
```
Target: **3 taps** from the Fatture page to a read invoice (pick, Carica, Controlla ora), the same count as a PDF today, with no wait for
the AI reading.

### F2 · The photo came first, the XML file later (the common real case)
```
photo at delivery (in "Da controllare") … days later: upload the XML of the same invoice
   └─ SuccessNote "Fattura letta, ma sembra già caricata (FT 12 del 3 nov, da foto)." ─ "Apri ›"
        └─ review of the XML ─ banner "Questa fattura è già presente da foto/PDF … Importi uguali."
             └─ "Usa il file XML al posto del PDF" ─ confirm "Usa il file XML" ─ the photo copy is rejected, the XML is in "Da controllare"
```
Target: **3 taps** after the upload (Apri, Usa il file XML al posto del PDF, Usa il file XML).

### F3 · Supplier not yet known
Review › "Fornitore" panel: "Fornitore nuovo: Fornitore Demo 3 · P.IVA IT12345678903" › **Crea fornitore** (form prefilled with name and
VAT) › Conferma. Approval stays blocked until a supplier is linked (existing `supplier_required`).

### F4 · The supplier wrote the lot in the file
Review › line "Mozzarella Demo" with "Lotto mancante" › other data "LOTTO: L-DEMO-0001" › **Usa come lotto** › the line shows the lot, the
"Lotto mancante" badge disappears. Same for "Usa come scadenza" on a date. One tap per value, no typing.

### F5 · A file Costì cannot take
Upload › ErrorAlert names the reason and the next step (for example a credit note: "Passala al commercialista."). Nothing is saved, so
there is nothing to clean up.

## 3. A · Upload card on `/fatture` (`upload-form.tsx`)

```
┌──────────────────────────────┐ 360
│ ▒▒ OSTERIA DEI ROSSI ▒▒ Esci │ band (osteria)
├──────────────────────────────┤
│ Fatture                  h1  │
│ ──                           │
│ ┌ Carica una fattura ──────┐ │ Card (invoices.uploadTitle)
│ │ [ Scatta foto ]          │ │ secondary, unchanged (invoices.takePhoto)
│ │ Carica PDF, foto o file XML  label (changed, §8 Y1)
│ │ [ Scegli file …        ] │ │ file input, 44 px
│ │ PDF, JPEG, PNG o fattura  │ │ hint (changed)
│ │ elettronica (.xml o       │ │
│ │ .xml.p7m), fino a 4 MB.   │ │
│ │                           │ │
│ │ FT12.xml.p7m              │ │ picked file name (meta)
│ │ [● Fattura elettronica]   │ │ Badge info, by extension only
│ │                           │ │
│ │ [         Carica        ] │ │ PRIMARY (invoices.submit)
│ └───────────────────────────┘ │
│ … list of invoices …         │
└──────────────────────────────┘
```

- **Label and hint.** The file field's label today is "Carica PDF o foto" (`invoices.chooseFile`); with XML it becomes "Carica PDF, foto o
  file XML". Hint: "PDF, JPEG, PNG o fattura elettronica (.xml o .xml.p7m), fino a 4 MB." The HEIC sentence of `invoices.fileHint` stays
  at the end: "Le foto iPhone (HEIC) vengono convertite in automatico." The picker also accepts
  `.xml,.p7m,application/xml,text/xml,application/pkcs7-mime` (plan §3.8 A).
- **Chip after picking.** A file ending in `.xml` or `.p7m` shows the info `Badge` **"Fattura elettronica"** under its name. It is a hint
  only (the server sniffs the content); a PDF or photo shows no chip, as today.
- **One primary:** "Carica". "Scatta foto" stays secondary.
- **Busy:** the button is disabled with `aria-busy`, and the status line reads "Caricamento e lettura del file…" (`role="status"`). An XML
  file is read in the same request (plan D-X1), so this replaces "Caricamento in corso…" only when the file is XML/P7M.
- **Order of the result.** The result appears **inside the card, under "Carica"**, where the eye already is; focus moves to it (the
  alert or the note) so a screen reader hears it. The card resets the file field after a success, never after a refusal (§3.2).

### 3.1 Success

| Case | What shows (in a `SuccessNote`, `role="status"`) | Link |
|---|---|---|
| One invoice | "Fattura FT 12 del 3 nov · Fornitore Demo 1 · 1.234,50 € letta dal file XML. Controllala e approvala." | **"Controlla ora ›"** (`TextLink`) → `/fatture/<id>/revisione` |
| One invoice, unknown supplier | Same sentence with the file's supplier name, then "Fornitore nuovo: crealo durante il controllo." | "Controlla ora ›" |
| One invoice, duplicate | "Fattura letta, ma sembra già caricata (FT 12 del 3 nov, da foto). Aprila per decidere." | **"Apri ›"** |
| Several invoices in one file | "Il file conteneva 3 fatture, tutte lette:" then a hairline list (`LedgerRow`, whole row is the link): title "FT 12 del 3 nov · 1.234,50 €", trailing `Badge` with the status word ("Da controllare", or neutral "Sembra già caricata") | each row |

- The supplier name, number, date and total come from the reply (`invoices[]`, plan §3.7); a missing supplier name reads "Fornitore senza
  nome" rather than a blank.
- The new rows also appear at the top of the list below, as today after a PDF upload.
- **Why a link, not a second button:** "Carica" stays the card's one primary, so the owner can upload the next file at once; "Controlla
  ora" is the next step, one tap away (§8 Y2).

### 3.2 Refusals (nothing is saved)

One `ErrorAlert` (`role="alert"`) under "Carica", replacing any earlier result. Each message says **what happened and what to do**. The
picked file stays shown, so the owner sees which file was refused, and the field is ready for another file.

| Code (plan §3.7) | Message (da approvare) |
|---|---|
| 415 bad type | "Formato non supportato: servono PDF, JPEG, PNG o fattura elettronica XML/P7M." |
| 413 too large, XML/P7M picked | "Il file supera 4 MB. Succede quando contiene un PDF allegato: scarica dal portale la fattura senza allegati, oppure carica il PDF." (for a PDF or photo the existing `invoices.tooBig` stays) |
| `xml_unreadable` | "Il file XML è danneggiato o non leggibile. Scaricalo di nuovo e riprova." |
| `xml_not_fatturapa` | "Questo file XML non è una fattura elettronica." |
| `p7m_unreadable` | "Non riesco ad aprire il file firmato (.p7m). Prova a caricare la versione .xml della stessa fattura." |
| `xml_simplified_unsupported` | "È una fattura semplificata: non ancora gestita. Carica il PDF o una foto." |
| `xml_document_type_unsupported`, TD04 | "È una nota di credito (TD04): Costì non la registra ancora. Passala al commercialista." |
| `xml_document_type_unsupported`, other | "Tipo di documento non gestito: {etichetta} ({codice}). Passalo al commercialista." |
| `xml_content_unsupported` | One sentence per reason: ritenuta/cassa "Fattura con ritenuta d'acconto o cassa previdenziale: non ancora gestita."; valuta "Fattura in una valuta diversa dall'euro: non gestita."; riga negativa "La riga {n} ha un importo negativo (sconto o reso su una riga a parte): non ancora gestito."; scissione "Scissione dei pagamenti: riguarda solo la Pubblica Amministrazione."; righe "La fattura ha più di 200 righe."; corpi "Il file contiene più di 10 fatture: chiedi file separati." |
| `xml_invalid_content` | "Nel file mancano dati obbligatori o sono scritti male:" + a list of up to 5 rows, e.g. "Fattura 1, riga 3: aliquota IVA mancante", "Partita IVA del fornitore non valida" |
| `xml_not_addressed_to_tenant` | "Questa fattura è intestata a un'altra partita IVA, non al locale." |
| `xml_issued_by_tenant` | "Questa fattura è emessa dal locale, non da un fornitore." |
| `already_uploaded` (409) | "Questo file è già stato caricato." + `TextLink` **"Apri la fattura ›"** (the id from `details.invoiceId`) |
| 429, network | Existing texts, unchanged |

- **The 413 message by extension:** the client knows the picked name, so it chooses the XML wording when the name ends in `.xml` or
  `.p7m`; the server reply is the same 413.
- **When a file holds several invoices**, the reason names the invoice ("Fattura 2: …"); the plan refuses the whole file (D-X3), and the
  alert says so in its first line: "Nessuna fattura del file è stata salvata." (§8 Y3).
- **Errors are words only.** The alert keeps the danger tone of `ErrorAlert`; no icon carries the meaning.

## 4. B · Invoice list `/fatture`

Each row of an XML invoice gets a neutral `Badge` **"XML"** or **"XML firmato"** (from `fileMime`) after the status badge, same size, so
the row reads e.g. `FT 12 · Fornitore Demo 1 · 3 nov · 1.234,50 €  [Da controllare] [XML]`. The status badge stays first: the job (what to
do) before the source. PDF and photo rows show no source badge (no noise on the old rows). Filters unchanged.

## 5. C · Review `/fatture/[id]/revisione` (XML invoice)

Order on the phone, top to bottom (one column; on a laptop the two columns stay as today: document left, review right):

```
‹ Torna alla fattura                          BackLink (review.back)
FT 12 · Fornitore Demo 1                      h1 (existing)
──
[● Fattura elettronica · Fattura (TD01)]      Badge info
Fattura 2 di 3 nello stesso file              meta (only when bodyCount > 1)
File firmato (firma non verificata da Costì)  meta (only for .p7m)

[duplicate banner, when there is one]         §5.5, above everything it blocks

┌ Dati dal file XML ▾ ───────────────────┐    Card, collapsible on phone, open by default
│ Fornitore Demo 1 · P.IVA IT01234567897  │
│ Numero        FT 12                     │    FactRow (dl)
│ Data          3 nov 2026                │
│ Scadenza pagamento  3 dic 2026          │    (label changed, §8 Y4)
│ Riepilogo IVA                     h3    │
│ 22%  imponibile 100,00 € · IVA 22,00 €  │    one row per rate, .num
│ Esente (N4)  imponibile 10,00 €         │
│ Totale documento        132,00 €        │    bold
│ Scarica il file originale ›             │    TextLink, downloads
└─────────────────────────────────────────┘
┌ Nel file c'è anche ────────────────────┐    Card, only when notes exist
│ · 1 allegato (non importato)            │
│ · Riferimenti a DDT o ordini (non importati)
└─────────────────────────────────────────┘
Fornitore                               h2    supplier panel (§5.4)
Righe                                   h2    (review.linesTitle) §5.3
[approval panel, unchanged]                   Approva = the screen's primary
```

- **Two cards at most** (ui-foundation §6): "Dati dal file XML" and "Nel file c'è anche". The supplier panel, lines and approval panel keep
  their current look. If a third card would be needed, the notes become a plain list under an h3 inside the first card (§8 Y5).
- **One primary:** "Approva" in the approval panel, as today. When the invoice is a duplicate, approval is blocked by the existing
  duplicate gate and the banner's "Usa il file XML al posto del PDF" is the primary instead (§5.5); never both.

### 5.1 Header chips and the "Dati dal file XML" card

- **Chip:** info `Badge` "Fattura elettronica · Fattura (TD01)"; TD24 reads "Fattura differita (TD24)", TD25 "Fattura differita (TD25)"
  (label from `documentTypeLabel`, so the server owns the wording).
- **Card content** (all from the review reply): supplier name and "P.IVA IT…" as in the file; Numero, Data, **Scadenza pagamento**;
  "Riepilogo IVA" as stacked rows, one per rate or nature (`vatSummary`): "22% · imponibile 100,00 € · IVA 22,00 €", "Esente (N4) ·
  imponibile 10,00 €" (nature label from `natureLabel`); "Totale documento" in bold. Rows use `FactRow` (term left, value right, tabular
  figures).
- **Collapsible on phone only:** the card title is a 44 px button "Dati dal file XML" with `aria-expanded`; open by default, so the
  first look shows the file's facts. On a laptop it sits in the document column, always open.
- **"Scarica il file originale ›"** is a `TextLink`, not a button: it downloads (the signed URL has `disposition: "attachment"`, plan
  D-X13b) and never opens inline. Its accessible name adds the type: "Scarica il file originale (XML)" / "(P7M firmato)". While the URL
  is being fetched it reads "Caricamento…" (`common.loading`); on failure the existing "Ricarica documento" (`review.reloadDocument`)
  applies.
- **No iframe** for XML: the PDF/photo document panel is replaced by this card; nothing renders the XML.

### 5.2 "Nel file c'è anche" (notes; the "partial parse" state)

Only when `notes[]` is not empty. One line per note, plain words, never a warning colour (nothing is wrong; the owner should know):

| Note | Line (da approvare) |
|---|---|
| `attachments` | "1 allegato (non importato)" / "{n} allegati (non importati)" |
| `ddt_refs`, `order_refs` | "Riferimenti a DDT o ordini (non importati)" |
| `text_lines_skipped` | "{n} righe descrittive senza importo (non importate)" |
| `rounding_line_added` | "Arrotondamento di 0,40 € aggiunto come riga" |
| `document_discount` | "Sconto sul totale documento: controlla il totale" |
| `stamp_duty` | "Bollo indicato nel file (non importato)" (§8 Y6) |
| `instalments` | "Pagamento a rate: scadenza della prima rata" |
| `buyer_unchecked` | "Partita IVA del locale non impostata: intestatario non controllato" |
| `riepilogo_negative_residual`, `vehicle_data` | Wording from the plan's `xml-view.ts` labels; the copywriter drafts them with the rest (§9) |

"Sconto sul totale documento" is the one note with an action: when the totals gate blocks approval, the approval panel already says why;
this line explains where the difference comes from.

### 5.3 Lines

Each line keeps today's row (description, quantity, price, amount, VAT, mapping, P2-2's "Lotto mancante") and adds, for an XML line:

```
Mozzarella Demo · 2 kg            [Lotto mancante]   existing warning Badge
Cod. EAN 8000000000001                               meta; hint "usato per riconoscere l'articolo"
Prezzo 10,00 € − sconto 10%                          meta, only with discounts
┌ Dal fornitore ───────────────────────┐            sunk panel, only with otherData
│ LOTTO       L-DEMO-0001               │
│ [ Usa come lotto ]                    │            secondary Button, 44 px
│ SCADENZA    1 dic 2026                │
│ [ Usa come scadenza ]                 │
└───────────────────────────────────────┘
```

- **Source.** The whole list sits under one line at the top, "Righe dal file XML" (meta), instead of a chip on every row (§8 Y7); the
  residual line reads "Differenza dal riepilogo IVA 22%"; an accessory cost line reads "Spesa accessoria".
- **First code:** "Cod. {tipo} {valore}" with the hint "usato per riconoscere l'articolo" the first time it appears on the page (not on
  every line). Further codes are listed only in the line editor.
- **Other data ("Dal fornitore").** Each `AltriDatiGestionali` is one row: the supplier's own label as written in the file (`TipoDato`,
  e.g. "LOTTO", "LOT", "SCAD"), then the value. Costì does not interpret the label (plan D-X17): the owner decides what it is.
  - A **text** value offers **"Usa come lotto"**; a **date** value offers **"Usa come scadenza"**; a number offers nothing.
  - These are **secondary** buttons, not primaries (the screen's primary stays "Approva").
  - **After the tap:** the request is `PATCH …/lines/:lineId` (plan §3.6). The button shows "Salvataggio…" while it runs, then the line
    shows the lot (or expiry) in its usual place, the "Lotto mancante" badge disappears, and a short status line "Lotto copiato." / "Scadenza
    copiata." (`role="status"`) replaces the button. On failure: a one-line `ErrorAlert` under the button, the button comes back.
  - **Line already has a lot:** the row shows "Lotto attuale: L-OLD" and the button reads **"Sostituisci con questo lotto"** (§8 Y8). Same
    for expiry. The owner can always correct it in the line editor.
  - A value longer than 64 characters (the lot limit) shows no button and the meta "Troppo lungo per un lotto".
- **Line editor** (existing): under Quantità / Prezzo / Importo / IVA the hint "Dal file XML: cambialo solo se il fornitore ha sbagliato."
  (meta, not a warning). Corrections stay possible and are recorded as today (plan D-X16).

### 5.4 Supplier panel, unknown supplier

```
Fornitore                                     h2 (review.supplier.title)
Fornitore nuovo: Fornitore Demo 3             label
P.IVA IT12345678903 · dal file XML            meta
[        Crea fornitore        ]              secondary (review.supplier.create)
Collega un fornitore esistente ›              TextLink (review.supplier.linkExisting)
```

- "Crea fornitore" opens the existing create form in place, prefilled with name and VAT, plus the optional "Pagamento (giorni)"
  (`suppliers.paymentTerms`). The hint above the form becomes "Dati letti dal file XML: controllali prima di creare." for an XML invoice
  (`review.supplier.createHint` says "documento").
- **Foreign VAT** (`IdPaese` ≠ IT): the line reads "P.IVA {paese} {codice} · dal file XML" and the form creates the supplier without a VAT,
  with the meta "La partita IVA estera resta sulla fattura." (plan §3.5.1).
- **Inactive supplier with the same VAT:** the existing 409 `duplicate_vat_number` text applies, telling the owner to re-activate it in
  Fornitori.
- "Crea fornitore" is secondary because "Approva" is the primary; approval says "Collega il fornitore" (`review.supplier.needed`) as today.

### 5.5 Duplicate banners

A banner sits **above the data card**, because it decides whether the rest matters. It replaces the generic duplicate text when the
partner is known. Each banner: a `Card`-less notice block (warning tone, as `warningNoteClass`), the partner as a link
("FT 12 del 3 nov ›", `review.duplicatePartnerLabel`), the amount comparison, then the actions.

| # | Case | Banner text (da approvare) | Actions |
|---|---|---|---|
| 1 | XML is a duplicate of a photo/PDF **in review** | "Questa fattura è già presente da foto/PDF (FT 12 del 3 nov, da controllare). Importi uguali." | **"Usa il file XML al posto del PDF"** (primary) · "Non è un doppione" (secondary, existing `review.notDuplicateOf` flow) · "Rifiuta questo file" (quiet) |
| 2 | XML is a duplicate of an **approved** photo/PDF | "Già approvata da foto/PDF il 12 nov. Importi diversi: 1.234,50 € qui, 1.230,00 € approvati." | **"Rifiuta questo file"** (primary) with the meta "Il file resta in archivio." |
| 3 | Photo/PDF is a duplicate of an XML | "Esiste già il file XML di questa fattura (FT 12 del 3 nov)." | **"Rifiuta questa copia"** (primary) · "Non è un doppione" (secondary) |
| 4 | XML is a duplicate of another XML | "Doppione di un altro file XML (FT 12 del 3 nov)." | **"Rifiuta"** (primary) · "Non è un doppione" (secondary) |

- **Amounts in words and figures:** "Importi uguali." when the two totals differ by at most 0,05 €; otherwise "Importi diversi: {qui} qui,
  {altro} nell'altra" (or "approvati"). Never a colour alone, never a tick.
- **"Rifiuta"** opens the existing reject form in place (`reject-form.tsx`) with the reason prefilled where the plan gives one; the owner
  can edit it.

**"Usa il file XML al posto del PDF" (banner 1)**

```
[ Usa il file XML al posto del PDF ]            primary
   └─ in-place confirmation (pattern of the reject form, not a modal):
      Usare il file XML?                        h3
      La copia da foto/PDF verrà rifiutata e resterà in archivio.
      Gli abbinamenti già memorizzati per il fornitore valgono anche
      per le righe del file XML, se codice o descrizione coincidono.
      [        Usa il file XML        ]         primary
      [            Annulla            ]         secondary (common.cancel)
```

- **Why a confirmation:** the tap rejects the other copy, and an invoice is never deleted or un-rejected; one more tap is cheap against
  that (and the mapping done on the photo copy is not copied line by line, which the second sentence says).
- **While sending:** the button is disabled with "Salvataggio…"; the request is `POST /api/invoices/[id]/use-xml {replaces}`.
- **After success:** the page reloads the review; a `SuccessNote` at the top reads "Ora questa è la fattura da controllare. La copia da
  foto/PDF è stata rifiutata." and the banner is gone (status `review`). If another look-alike still exists (reply `duplicate`), the
  page shows that banner instead.
- **409 `replace_not_allowed`:** "La situazione è cambiata: ricarico la fattura." (`role="status"`), then the page reloads; for example the
  photo copy was approved by someone else in the meantime, and banner 2 appears.
- **Approval** stays blocked while the banner shows (existing duplicate gate); the approval panel says so in its usual words.

## 6. States

| Screen | State | What shows |
|---|---|---|
| Upload | Idle | Card as §3; no result area |
| Upload | XML picked | File name + "Fattura elettronica" badge |
| Upload | Sending | "Caricamento e lettura del file…", button disabled |
| Upload | Success (1, several, duplicate) | §3.1 |
| Upload | Refused | §3.2; nothing saved |
| Upload | Offline | As today: the upload fails with the existing network error text; no queue for invoice uploads |
| Review | Loading | "Caricamento…" (`common.loading`) in place of the cards |
| Review | XML, supplier known, no notes | Header chip, data card, lines, approval |
| Review | Partial parse | + "Nel file c'è anche" |
| Review | Unknown supplier | §5.4; approval blocked as today |
| Review | Duplicate 1–4 | §5.5 |
| Review | Totals mismatch (document discount) | Existing totals gate in the approval panel + the note "Sconto sul totale documento" |
| Review | Download link fails | Existing "Ricarica documento" |
| Review | Approved / rejected | As today; the data card and "Scarica il file originale" stay; "Usa come lotto" buttons are gone (the invoice is closed) |
| Any | Chef or waiter by URL | Existing 403 page |

## 7. Accessibility checklist (WCAG 2.2 AA)

- Every message that appears after an action is announced: refusals `role="alert"`, results and copies `role="status"`, focus moved to
  the result after "Carica" (3.3.1, 4.1.3).
- The "Fattura elettronica", "XML", "XML firmato" and status badges are words; amounts compare in words ("Importi uguali") (1.4.1).
- Collapsible card: a real button with `aria-expanded`, 44 px tall (4.1.2, 2.5.8).
- "Scarica il file originale" says it downloads and the file type (2.4.4).
- Every button and link here is ≥ 44 × 44 px, including "Usa come lotto" and the links inside notes (2.5.8; house rule 2.5.5).
- Long supplier names, lot values and labels wrap (`overflow-wrap: anywhere`), never truncate a fact at 360 px (1.4.10).
- Light and dark: all colours are osteria tokens; the badge and notice pairs are tested AA pairs (ui-foundation §2).

## 8. Design decisions that differ from, or add to, the plan (for the lead)

| # | Proposal | Plan says | Why |
|---|---|---|---|
| Y1 | File field label "Carica PDF, foto o file XML" (changed `invoices.chooseFile`) | Field "Scegli un file" | Keeps today's label pattern; the owner sees XML is accepted before opening the picker |
| Y2 | "Controlla ora ›" and "Apri ›" as text links inside the success note | "button Controlla ora" | "Carica" stays the card's one primary; the next upload is one tap away |
| Y3 | First line of a refusal for a multi-invoice file: "Nessuna fattura del file è stata salvata." | Not specified | All-or-nothing (D-X3) must be said, or the owner thinks the other invoices went in |
| Y4 | Header label **"Scadenza pagamento"** in the XML card | "Scadenza" | The same screen offers "Usa come scadenza" for a product expiry; two meanings of one word on one screen would mislead |
| Y5 | At most two cards on the review (data + notes); notes fold into the data card if a third would appear | Cards not counted | Card budget (ui-foundation §6) |
| Y6 | Note line for `stamp_duty`: "Bollo indicato nel file (non importato)" | Listed in D-X15, no wording | Every note needs a sentence |
| Y7 | "Righe dal file XML" once above the list, not a chip on every line | Chip "Dal file XML" per line | Less noise on a 200-line invoice; the fact is the same for every line |
| Y8 | When a lot or expiry is already set, the button reads "Sostituisci con questo lotto" and the current value is shown | "Usa come lotto" always | The owner sees that the tap replaces a value |
| Y9 | Duplicate banner sits above the XML data card, and its main action is the primary while approval is blocked | Banner position not specified | One primary per screen; the decision comes before the details |
| Y10 | "Usa il file XML al posto del PDF" confirms in place, not in a modal sheet | "Sheet" | Same pattern as the reject form; no focus trap on a phone |

## 9. Open questions

| # | For | Question | Default |
|---|---|---|---|
| Q-UX-X1 | Founder | Wording of every new string here (marked da approvare), including the two notes without plan wording | Copywriter drafts from this file; you approve |
| Q-UX-X2 | Lead | Accept Y1–Y10? | Yes |
| (Q-X2) | Founder | Credit notes: refuse for now (plan default) changes only the TD04 message if the answer is "record them" (V1) | As the plan |
