# Ricettario Osteria Dei Rossi — bozza (DRAFT)

| | |
|---|---|
| **Fonte** | Descrizioni del menu del fondatore (chat, 2026-10-22) e del sito catturato il 2026-10-22: vedi [`menu-draft.md`](menu-draft.md). |
| **Stato** | **BOZZA (DRAFT)** da completare con lo chef. DigiAlto-Ops deve registrarla in `clients/osteria-dei-rossi/context.md`. Non usare in seed, fixture o testi UI finché non è approvata. |
| **Scopo** | Preparare l'import delle ricette di M7 (`recipe`, `recipe_line`, tipi `batch`, `plate`, `sub`) e dell'anagrafica ingredienti di M1 ([`ingredienti-draft.csv`](ingredienti-draft.csv)). |

**Nessuna quantità, resa o porzione è indicata.** La colonna "Quantità" è sempre
**da compilare (chef)**: grammature, resa (`yield_factor`), uscita del lotto (`output_qty`),
porzioni per lotto, durata (`shelf_life_hours`) e tempi di preparazione li dà lo chef.

## 1. Legenda

| Colonna | Valori |
|---|---|
| **Origine** | `descrizione` = scritto nella descrizione del piatto; `assunto` = base culinaria ovvia o che definisce il piatto (es. soffritto per un ragù, mais per la polenta), **da confermare**; `assunto ?` = ipotesi più debole, da confermare per prima. |
| **Mag.** | `si` = ingrediente a magazzino (`is_stock = true`, scaricato dal registro movimenti); `no` = non a magazzino (proposta solo per sale e pepe nero: costo a consumo, nessun conteggio). |
| **Tipo** | `grezzo` = ingrediente del CSV; `SL-nn` = semilavorato (lotto prodotto e porzionato, PRD 2.2); `sub` = sotto-ricetta senza porzioni proprie. |
| **Unità** | Unità base dell'ingrediente (`kg`, `l`, `pz`), come nel CSV. Per un semilavorato: unità d'uscita proposta del lotto. |
| **Quantità** | Sempre *da compilare (chef)*. |

Gli ingredienti marcati `assunto` compaiono nel CSV solo perché servono a una ricetta plausibile;
l'elenco è in [§ 6](#6-righe-del-csv-basate-solo-su-assunzioni).

> **Allergeni (sicurezza alimentare).** Gli allergeni del CSV e quelli derivati in
> `menu-draft.md` sono una prima stima conservativa (meglio dichiarare in più che in meno). Ogni
> allergene è **da confermare** con lo chef e con le etichette dei fornitori prima di qualsiasi
> uso su menu, etichette o app. Un allergene vuoto nel CSV significa **"non ancora dichiarato"**,
> non "privo di allergeni".

## 2. Semilavorati (lotti: ricette `batch` e `sub`)

Ogni semilavorato è una ricetta `batch`: lo chef produce un lotto (es. kg di ragù), l'app calcola
le porzioni e scarica gli ingredienti grezzi alla produzione (`produce_batch`); il piatto scarica
poi una porzione del lotto alla comanda.

### SL-01 Ragù d'anatra — usato da PRI-02

| Ingrediente | Origine | Mag. | Tipo | Unità | Quantità |
|---|---|---|---|---|---|
| Anatra | descrizione | si | grezzo | kg | da compilare (chef) |
| Cipolle, Sedano, Carote (soffritto) | assunto | si | grezzo | kg | da compilare (chef) |
| Olio extravergine di oliva | assunto | si | grezzo | l | da compilare (chef) |
| Vino rosso da cucina | assunto ? | si | grezzo | l | da compilare (chef) |
| Sale, Pepe nero | assunto | no | grezzo | kg | da compilare (chef) |

Uscita del lotto: kg; porzione in kg. Pomodoro: vedi R-05.

### SL-02 Ragù bianco di cinta senese — usato da PRI-03

| Ingrediente | Origine | Mag. | Tipo | Unità | Quantità |
|---|---|---|---|---|---|
| Carne di cinta senese | descrizione | si | grezzo | kg | da compilare (chef) |
| Miscela segreta di erbe e spezie della casa | descrizione | — | sub (SL-03) | kg | da compilare (chef) |
| Cipolle, Sedano, Carote (soffritto) | assunto | si | grezzo | kg | da compilare (chef) |
| Olio extravergine di oliva | assunto | si | grezzo | l | da compilare (chef) |
| Vino bianco da cucina | assunto ? | si | grezzo | l | da compilare (chef) |
| Sale | assunto | no | grezzo | kg | da compilare (chef) |

"Senza pomodoro" (descrizione): nessun pomodoro.

### SL-03 Miscela segreta di erbe e spezie della casa — sotto-ricetta di SL-02

Contenuto **sconosciuto, da confermare** (R-03). Nessun ingrediente assunto. Va registrata come
ricetta `sub` (o come ingrediente acquistato, se comprata pronta). Serve almeno sapere gli
allergeni (es. sedano, senape) anche se la ricetta resta riservata.

### SL-04 Ragù di cinghiale — usato da PRI-04

| Ingrediente | Origine | Mag. | Tipo | Unità | Quantità |
|---|---|---|---|---|---|
| Cinghiale | descrizione | si | grezzo | kg | da compilare (chef) |
| Cipolle, Sedano, Carote (soffritto) | assunto | si | grezzo | kg | da compilare (chef) |
| Olio extravergine di oliva | assunto | si | grezzo | l | da compilare (chef) |
| Vino rosso da cucina | assunto ? | si | grezzo | l | da compilare (chef) |
| Sale, Pepe nero | assunto | no | grezzo | kg | da compilare (chef) |

Pomodoro e aromi (alloro, ginepro, rosmarino): vedi R-05.

### SL-05 Sugo dell'Osteria — usato da PRI-06

| Ingrediente | Origine | Mag. | Tipo | Unità | Quantità |
|---|---|---|---|---|---|
| Pomodoro (pelati o passata) | descrizione | si | grezzo | kg | da compilare (chef) |
| Gorgonzola | descrizione | si | grezzo | kg | da compilare (chef) |
| Peperoncino | descrizione | si | grezzo | kg | da compilare (chef) |
| Olio extravergine di oliva | assunto | si | grezzo | l | da compilare (chef) |
| Sale | assunto | no | grezzo | kg | da compilare (chef) |

Lotto o espresso? Vedi R-06 (il gorgonzola potrebbe essere aggiunto al momento).

### SL-06 Ribollita — piatto PRI-08 (il lotto è il piatto)

La descrizione non nomina ingredienti. Quelli sotto definiscono la ribollita tradizionale e sono
tutti **assunti, da confermare** (R-07).

| Ingrediente | Origine | Mag. | Tipo | Unità | Quantità |
|---|---|---|---|---|---|
| Cavolo nero | assunto | si | grezzo | kg | da compilare (chef) |
| Fagioli cannellini | assunto | si | grezzo | kg | da compilare (chef) |
| Pane toscano (raffermo) | assunto | si | grezzo | kg | da compilare (chef) |
| Cipolle, Sedano, Carote (soffritto) | assunto | si | grezzo | kg | da compilare (chef) |
| Olio extravergine di oliva | assunto | si | grezzo | l | da compilare (chef) |
| Sale, Pepe nero | assunto | no | grezzo | kg | da compilare (chef) |

### SL-07 Pesto senese al dragoncello — usato da ANT-05

| Ingrediente | Origine | Mag. | Tipo | Unità | Quantità |
|---|---|---|---|---|---|
| Dragoncello | descrizione | si | grezzo | kg | da compilare (chef) |
| Olio extravergine di oliva | assunto | si | grezzo | l | da compilare (chef) |
| Aglio | assunto ? | si | grezzo | kg | da compilare (chef) |
| Sale | assunto | no | grezzo | kg | da compilare (chef) |

Mollica di pane, aceto, formaggio, frutta a guscio: vedi R-04 (cambiano gli allergeni).

### SL-08 Paté per crostini neri — usato da ANT-06

| Ingrediente | Origine | Mag. | Tipo | Unità | Quantità |
|---|---|---|---|---|---|
| Fegatini di pollo | assunto ? (tradizione; **da confermare**) | si | grezzo | kg | da compilare (chef) |
| Cipolle | assunto ? | si | grezzo | kg | da compilare (chef) |
| Olio extravergine di oliva | assunto | si | grezzo | l | da compilare (chef) |
| Sale, Pepe nero | assunto | no | grezzo | kg | da compilare (chef) |

Il resto della ricetta (milza, capperi, acciughe, vin santo o vino, burro, brodo) è nella domanda
R-02 e non è nel CSV.

### SL-09 Salsa dolce forte — sotto-ricetta di SL-10

| Ingrediente | Origine | Mag. | Tipo | Unità | Quantità |
|---|---|---|---|---|---|
| Aceto di vino | assunto ("agrodolce") | si | grezzo | l | da compilare (chef) |
| Zucchero | assunto ("agrodolce") | si | grezzo | kg | da compilare (chef) |

Cioccolato, uvetta, pinoli, canditi della ricetta tradizionale: vedi R-08. Può essere `sub` dentro
SL-10 (una sola preparazione) o un lotto a parte.

### SL-10 Cinghiale in dolce forte — piatto SEC-01

| Ingrediente | Origine | Mag. | Tipo | Unità | Quantità |
|---|---|---|---|---|---|
| Cinghiale | descrizione | si | grezzo | kg | da compilare (chef) |
| Salsa dolce forte | descrizione | — | sub (SL-09) | kg | da compilare (chef) |
| Cipolle, Sedano, Carote (soffritto) | assunto | si | grezzo | kg | da compilare (chef) |
| Olio extravergine di oliva | assunto | si | grezzo | l | da compilare (chef) |
| Vino rosso da cucina | assunto ? | si | grezzo | l | da compilare (chef) |
| Sale, Pepe nero | assunto | no | grezzo | kg | da compilare (chef) |

### SL-11 Tegamata di cinta senese — piatto SEC-02

| Ingrediente | Origine | Mag. | Tipo | Unità | Quantità |
|---|---|---|---|---|---|
| Carne di cinta senese (Crete Senesi, stato brado) | descrizione | si | grezzo | kg | da compilare (chef) |
| Cipolle, Sedano, Carote (soffritto) | assunto | si | grezzo | kg | da compilare (chef) |
| Olio extravergine di oliva | assunto | si | grezzo | l | da compilare (chef) |
| Vino bianco da cucina (o rosso?) | assunto ? | si | grezzo | l | da compilare (chef) |
| Sale, Pepe nero | assunto | no | grezzo | kg | da compilare (chef) |

"Senza base di pomodoro" (descrizione).

### SL-12 Spezzatino di cinghiale al coccio — usato da SEC-04

| Ingrediente | Origine | Mag. | Tipo | Unità | Quantità |
|---|---|---|---|---|---|
| Cinghiale | descrizione | si | grezzo | kg | da compilare (chef) |
| Cipolle, Sedano, Carote (soffritto) | assunto | si | grezzo | kg | da compilare (chef) |
| Olio extravergine di oliva | assunto | si | grezzo | l | da compilare (chef) |
| Vino rosso da cucina | assunto ? | si | grezzo | l | da compilare (chef) |
| Sale, Pepe nero | assunto | no | grezzo | kg | da compilare (chef) |

"Cottura lenta e aromatica": quali aromi? (R-05.)

### SL-13 Polenta — usata da SEC-04

| Ingrediente | Origine | Mag. | Tipo | Unità | Quantità |
|---|---|---|---|---|---|
| Farina di mais per polenta | assunto (definizione) | si | grezzo | kg | da compilare (chef) |
| Sale | assunto | no | grezzo | kg | da compilare (chef) |

Morbida o abbrustolita? Fatta a ogni servizio? (R-09.)

### SL-14 Salsa piccante fatta in casa — usata da SEC-05

| Ingrediente | Origine | Mag. | Tipo | Unità | Quantità |
|---|---|---|---|---|---|
| Peperoncino | assunto ("piccante") | si | grezzo | kg | da compilare (chef) |
| Olio extravergine di oliva | assunto ? | si | grezzo | l | da compilare (chef) |
| Sale | assunto | no | grezzo | kg | da compilare (chef) |

Ricetta da confermare (R-10): il sito dichiara uova e latte.

### SL-15 Trippa — piatto SEC-06

| Ingrediente | Origine | Mag. | Tipo | Unità | Quantità |
|---|---|---|---|---|---|
| Trippa | descrizione | si | grezzo | kg | da compilare (chef) |
| Salsiccia | descrizione | si | grezzo | kg | da compilare (chef) |
| Pomodoro (pelati o passata) | descrizione | si | grezzo | kg | da compilare (chef) |
| Peperoncino | descrizione | si | grezzo | kg | da compilare (chef) |
| Cipolle, Sedano, Carote (soffritto) | assunto | si | grezzo | kg | da compilare (chef) |
| Olio extravergine di oliva | assunto | si | grezzo | l | da compilare (chef) |
| Sale | assunto | no | grezzo | kg | da compilare (chef) |

### SL-16 Fagioli all'uccelletto — piatto CON-02

| Ingrediente | Origine | Mag. | Tipo | Unità | Quantità |
|---|---|---|---|---|---|
| Fagioli cannellini | assunto (definizione) | si | grezzo | kg | da compilare (chef) |
| Pomodoro (pelati o passata) | assunto (definizione) | si | grezzo | kg | da compilare (chef) |
| Salvia | assunto (definizione) | si | grezzo | kg | da compilare (chef) |
| Aglio | assunto (definizione) | si | grezzo | kg | da compilare (chef) |
| Olio extravergine di oliva | assunto | si | grezzo | l | da compilare (chef) |
| Sale, Pepe nero | assunto | no | grezzo | kg | da compilare (chef) |

Fagioli secchi o in scatola? (R-11.)

### 2.1 Possibili semilavorati (da confermare con lo chef)

Preparati probabilmente in anticipo; se lo sono, diventano ricette `batch` con lotto ed etichetta.

| Preparazione | Piatto | Domanda |
|---|---|---|
| Cialda di parmigiano | ANT-02 | Fatte in anticipo (lotto) o al momento? |
| Salsa al pepe verde | FIL-01-PEP | Lotto o al momento? |
| Patate lesse | CON-03 | Lessate in anticipo? |
| Erbe sbollentate (bietole, cicoria, spinaci) | CON-04 | Sbollentate in anticipo, saltate al momento? |
| Condimento zucca e porri | PRI-07 | Cotto in anticipo? |
| Soffritto base | SL-01, 02, 04, 10, 11, 12, 15 | Un soffritto unico preparato in quantità? |
| Cinghiale marinato | SL-04, SL-10, SL-12 | Una marinatura comune ai tre piatti di cinghiale? |
| Dolci (tiramisù, panna cotta, cheesecake, tortino) | DOL-01..05 | Fatti in casa (lotto) o acquistati (rivendita)? |

## 3. Piatti (ricette `plate`)

Un piatto = porzioni di semilavorato + ingredienti di impiattamento. Tutti gli ingredienti grezzi
sono `si` a magazzino salvo sale e pepe nero.

| Codice | Piatto | Componenti (Origine) | Quantità |
|---|---|---|---|
| ANT-01 | Tagliere del Cacciatore | Salumi di cinta senese (assortiti) (descrizione); Salumi di selvaggina (assortiti) (descrizione) | da compilare (chef) |
| ANT-02 | Tartar dell'Oste | Manzo per tartare (descrizione, "battuta al coltello"); Parmigiano per la cialda (descrizione); Senape antica in grani (descrizione); Olio extravergine di oliva, Sale, Pepe nero (assunto) | da compilare (chef) |
| ANT-03 | Tagliere del Contadino | Formaggi toscani assortiti (tagliere) (descrizione; pecorini secondo l'EN); Miele (descrizione); Confetture assortite (descrizione) | da compilare (chef) |
| ANT-04 | Bis di crostoni | Pane toscano (descrizione, "crostoni"); Gorgonzola, Tartufo di stagione (descrizione, crostone 1); Pecorino toscano come "cacio" (assunto ?, R-12), Pere, Miele (descrizione, crostone 2); Olio extravergine di oliva (assunto) | da compilare (chef) |
| ANT-05 | Acciughe sotto pesto | Acciughe (descrizione); SL-07 Pesto al dragoncello, porzione (descrizione) | da compilare (chef) |
| ANT-06 | Crostini neri senesi | Pane toscano (descrizione, "crostini"); SL-08 Paté per crostini neri, porzione | da compilare (chef) |
| PRI-01 | Tagliatelle al Tartufo di Stagione | Tagliatelle all'uovo (descrizione); Tartufo di stagione (descrizione); Burro (assunto ?, R-13); Sale (assunto) | da compilare (chef) |
| PRI-02 | Pici al Ragù Tradizionale di Anatra | Pici (descrizione); SL-01 Ragù d'anatra, porzione; Sale (assunto) | da compilare (chef) |
| PRI-03 | Pici al Ragù Bianco di Cinta Senese | Pici (nome del piatto); SL-02 Ragù bianco, porzione; Sale (assunto) | da compilare (chef) |
| PRI-04 | Tagliatelle al Ragù di Cinghiale | Tagliatelle all'uovo (descrizione); SL-04 Ragù di cinghiale, porzione; Sale (assunto) | da compilare (chef) |
| PRI-05 | Pici Cacio e Pepe | Pici, Pecorino toscano, Pepe nero (descrizione); Sale (assunto) | da compilare (chef) |
| PRI-06 | Spaghetti alla Chitarra con Sugo dell'Osteria | Spaghetti alla chitarra (nome del piatto); SL-05 Sugo dell'Osteria, porzione; Sale (assunto) | da compilare (chef) |
| PRI-07 | Caserecce con Zucca Gialla, Porri e Pecorino | Caserecce, Zucca gialla, Porri, Pecorino toscano (descrizione; "pecorino" senza specifica, R-12); Olio extravergine di oliva, Sale (assunto) | da compilare (chef) |
| PRI-08 | Ribollita | SL-06 Ribollita, porzione; Olio extravergine di oliva a crudo (assunto ?) | da compilare (chef) |
| SEC-01 | Cinghiale in Dolce Forte | SL-10, porzione | da compilare (chef) |
| SEC-02 | Tegamata di Cinta Senese | SL-11, porzione | da compilare (chef) |
| SEC-03 | Agnello allo Scottadito | Costolette di agnello (descrizione); Olio extravergine di oliva, Sale, Pepe nero (assunto) | da compilare (chef; quante costolette?) |
| SEC-04 | Cinghiale al Coccio con Polenta | SL-12 Spezzatino, porzione; SL-13 Polenta, porzione | da compilare (chef) |
| SEC-05 | Sovracosce di Pollo alla Diavola | Sovracosce di pollo (descrizione); SL-14 Salsa piccante, porzione; Olio extravergine di oliva, Sale, Pepe nero (assunto) | da compilare (chef) |
| SEC-06 | Trippa | SL-15, porzione | da compilare (chef) |
| GRI-01 | Bistecca alla Fiorentina | Bistecca con osso (fiorentina) (descrizione), **a peso**; Sale, Olio extravergine di oliva (assunto) | peso venduto (per etto) |
| GRI-02 | Bistecca Fritta | Bistecca con osso (fiorentina) (descrizione), **a peso**; impanatura: Pangrattato (assunto, "impanata"), Uova (assunto ?), Farina 00 (assunto ?); Olio di semi per frittura (assunto, "fritta"); Sale (assunto) | peso venduto (per etto) + impanatura da compilare |
| GRI-03 | Costata del vamosh | Costata di manzo (descrizione: "simile alla Fiorentina, ma senza filetto"), **a peso**; Sale, Olio extravergine di oliva (assunto) | peso venduto (per etto) |
| FIL-01 | Medaglione di Filetto alla Griglia | Filetto di manzo (descrizione); Olio extravergine di oliva, Sale, Pepe nero (assunto) | da compilare (chef) |
| FIL-01-TAR | ↳ Con Tartufo | come FIL-01 + Tartufo di stagione (nome) | da compilare (chef) |
| FIL-01-PEP | ↳ Con Salsa al Pepe Verde | come FIL-01 + salsa: Pepe verde in salamoia (descrizione), Panna da cucina (assunto ?) | da compilare (chef) |
| FIL-01-LAR | ↳ Con Lardo di Colonnata | come FIL-01 + Lardo di Colonnata (descrizione) | da compilare (chef) |
| CON-01 | Chips di Patate Croccanti | Patate (nome); Olio di semi per frittura (assunto); Sale (assunto) | da compilare (chef) |
| CON-02 | Fagioli all'Uccelletto | SL-16, porzione | da compilare (chef) |
| CON-03 | Patate Prezzemolate | Patate, Prezzemolo, Olio extravergine di oliva, Sale, Pepe nero (descrizione) | da compilare (chef) |
| CON-04 | Erbe Saltate | Bietole, Cicoria, Spinaci, Aglio, Olio extravergine di oliva, Peperoncino (descrizione); Sale (assunto) | da compilare (chef) |
| CON-05 | Insalata Mista | Insalata mista (descrizione); Olio extravergine di oliva, Aceto di vino, Sale (assunto ?, R-14) | da compilare (chef) |

**Per etto (GRI-01..03).** La "porzione" è il peso venduto: la riga d'ordine porta il peso e lo
scarico della carne è dello stesso peso in kg (più eventuale scarto di rifilatura, `yield_factor`).
Serve l'unità di vendita per 100 g sul `menu_item` (M17); vedi `menu-draft.md` § 5.2.

### 3.1 Dolci (solo sul sito; da confermare)

Ingredienti derivati solo dal **nome** del dolce. Nel CSV entrano solo quelli nominati
esplicitamente (Cantuccini, Vin Santo, Pere, Cioccolato fondente); il resto attende la risposta
a D-01.

| Codice | Dolce | Componenti (Origine) |
|---|---|---|
| DOL-01 | Il Tiramisù di Manu | se fatto in casa: mascarpone, savoiardi, uova, caffè, cacao, zucchero (assunto, definizione); non nel CSV |
| DOL-02 | Cantuccini e Vin Santo | Cantuccini, Vin Santo (nome) |
| DOL-03 | Panna Cotta (cioccolato, frutti di bosco, caramello) | panna, zucchero, gelificante + topping (assunto, definizione); non nel CSV |
| DOL-04 | Tortino al Cioccolato con Cuore Caldo | Cioccolato fondente (nome); il resto non nel CSV |
| DOL-05 | Cheesecake (cioccolato, frutti di bosco, caramello) | non nel CSV |
| DOL-06 | Tris di Dolci Senesi | quali dolci? non nel CSV |
| DOL-07 | Carpaccio di Pere e Scaglie di Cioccolato Fondente | Pere, Cioccolato fondente (nome) |

### 3.2 Rivendita (nessuna ricetta)

Bevande, caffetteria, amari e grappe (`menu-draft.md` § 8) non hanno ricetta: ogni articolo
scarica l'ingrediente omonimo del CSV. La dose per calice, birra media/piccola, tazzina e
bicchierino è **da compilare**. Il caffè d'orzo e il decaffeinato potrebbero essere in capsule o
solubili (R-15).

## 4. Condivisioni tra piatti

**Stessa materia prima, preparazioni diverse.** Il cinghiale entra in tre lotti distinti: SL-04
Ragù di cinghiale (PRI-04), SL-10 Cinghiale in dolce forte (SEC-01) e SL-12 Spezzatino al coccio
(SEC-04). Sono **tre ricette diverse**, con tagli, cotture e porzioni diverse: non si scambiano
le porzioni. Lo stesso vale per la cinta senese: SL-02 Ragù bianco (PRI-03) e SL-11 Tegamata
(SEC-02) sono due lotti diversi, e i salumi di cinta del tagliere sono un prodotto acquistato a
parte.

**Lotti condivisi tra più piatti:** nessuno dei 16 semilavorati confermati serve oggi più di un
piatto in carta. Candidati alla condivisione, da confermare: soffritto base (7 lotti), cinghiale
marinato (3 lotti), SL-13 Polenta (solo SEC-04 oggi, ma utilizzabile come contorno), SL-05 Sugo
dell'Osteria (solo PRI-06).

**Ingredienti grezzi condivisi** (righe uniche nel CSV):

| Ingrediente | Usato da |
|---|---|
| Tartufo di stagione | ANT-04, PRI-01, FIL-01-TAR |
| Bistecca con osso (fiorentina) | GRI-01, GRI-02 |
| Cinghiale | SL-04, SL-10, SL-12 |
| Carne di cinta senese | SL-02, SL-11 (tagli probabilmente diversi: R-16) |
| Pici | PRI-02, PRI-03, PRI-05 |
| Tagliatelle all'uovo | PRI-01, PRI-04 |
| Pecorino toscano | PRI-05, PRI-07, ANT-04 (se "cacio") |
| Gorgonzola | ANT-04, SL-05 |
| Miele | ANT-03, ANT-04 |
| Pere | ANT-04, DOL-07 |
| Pane toscano | ANT-04, ANT-06, SL-06 |
| Patate | CON-01, CON-03 |
| Peperoncino | SL-05, SL-14, SL-15, CON-04 |
| Pomodoro (pelati o passata) | SL-05, SL-15, SL-16 |
| Olio di semi per frittura | GRI-02, CON-01 (friggitrice condivisa: contaminazione glutine e uova sulle chips) |
| Cipolle, Sedano, Carote | 8 semilavorati (soffritto) |

## 5. Note sul CSV `ingredienti-draft.csv`

- Formato dell'import M1 (`src/server/master/import.ts`): intestazione
  `nome;unita_base;categoria;a_magazzino;allergeni;giorni_conservazione`, separatore `;`,
  allergeni separati da `|` con i 14 codici di `ingredients.ts`, unità `kg`, `l` o `pz`.
- **89 righe**, una per ingrediente grezzo, senza doppioni e senza semilavorati. Comprende
  materie prime di cucina, dolci nominati e articoli di rivendita (bevande, caffè, amari, grappe).
- `giorni_conservazione` vuoto: all'import la durata resta quella salvata (o nulla per un
  ingrediente nuovo). La dà lo chef.
- `a_magazzino = no` solo per **Sale** e **Pepe nero** (proposta: costo basso, nessun conteggio).
  Tutto il resto `si`. Da confermare con il titolare.
- **Allergeni conservativi**, solo quelli ovvi dal nome: formaggi, burro, panna → `latte`; pasta,
  pane, pangrattato, farina, birra, orzo → `glutine` (+ `uova` per pasta all'uovo e chitarra);
  acciughe → `pesce`; sedano → `sedano`; senape antica → `senape|solfiti` (contiene aceto o vino);
  vini, aceto, Vin Santo → `solfiti`; cantuccini → `glutine|uova|frutta_a_guscio`; cioccolato
  fondente → `latte|soia` (lecitina e tracce di latte tipiche: verificare etichetta).
- **Vuoto ≠ senza allergeni.** Da verificare in etichetta soprattutto: salumi e salsiccia (latte,
  solfiti, senape, frutta a guscio), confetture (solfiti), olio di semi (se di arachide:
  `arachidi`), farina di mais (contaminazione glutine), amari e grappe, pepe verde in salamoia.
- Nomi generici da dividere quando lo chef li precisa: "Carne di cinta senese" (per taglio),
  "Salumi … (assortiti)", "Formaggi toscani assortiti", "Confetture assortite", "Insalata mista",
  "Pomodoro (pelati o passata)".
- Il CSV usa i dati del menu solo come bozza: va importato in un tenant di prova, non in
  produzione, finché la bozza non è approvata.

## 6. Righe del CSV basate solo su assunzioni

Queste righe non derivano da parole del menu ma da basi culinarie assunte; vanno confermate o
tolte: Fegatini di pollo, Burro, Panna da cucina, Uova, Cipolle, Sedano, Carote, Cavolo nero,
Salvia, Farina 00, Farina di mais per polenta, Zucchero, Aceto di vino, Olio di
semi per frittura, Vino rosso da cucina, Vino bianco da cucina, Pangrattato, Caffè in grani (formato).
Totale: **18**. (Fagioli e pomodoro sono nel menu; la varietà cannellini e il formato pelati o passata sono assunti.)

## 7. Domande aperte per lo chef

| # | Domanda |
|---|---|
| R-01 | Grammature, resa, uscita di ogni lotto, porzioni per lotto, durata e tempo di preparazione di ogni ricetta (tutte le colonne "da compilare"). |
| R-02 | **Crostini neri:** cosa contiene il paté? Fegatini di pollo (tradizione) **da confermare**; milza, capperi, acciughe, vin santo o vino, burro, brodo? Il sito dichiara anche frutta a guscio e sedano. |
| R-03 | **Miscela segreta** del ragù bianco: almeno l'elenco degli allergeni (sedano, senape, frutta a guscio, arachidi?); fatta in casa o acquistata? La ricetta può restare riservata (visibile solo a titolare e chef). |
| R-04 | **Pesto senese al dragoncello:** oltre a dragoncello e olio, c'è mollica di pane, aceto, aglio, formaggio, frutta a guscio? |
| R-05 | **Ragù d'anatra, ragù di cinghiale, spezzatino al coccio:** c'è pomodoro? Vino rosso o bianco? Aromi (alloro, ginepro, rosmarino)? Marinatura comune del cinghiale? |
| R-06 | **Sugo dell'Osteria:** lotto unico con il gorgonzola o base di pomodoro e peperoncino in lotto e gorgonzola al momento? Aglio o cipolla? |
| R-07 | **Ribollita:** confermare cavolo nero, fagioli, pane raffermo, soffritto; ci sono verza, bietole, patate, pomodoro, dado (sito: arachidi, soia)? |
| R-08 | **Dolce forte:** ingredienti della salsa (cioccolato, uvetta, pinoli, canditi, aceto, zucchero, pane grattugiato?) e se è una preparazione a parte o cotta con il cinghiale. |
| R-09 | **Polenta:** morbida o abbrustolita? Fatta a ogni servizio? Farina certificata senza glutine? |
| R-10 | **Salsa piccante** del pollo alla diavola: ricetta e allergeni (il sito dichiara uova e latte). |
| R-11 | **Fagioli** (uccelletto e ribollita): secchi o in scatola? Cannellini? |
| R-12 | **"Cacio"** del Bis di crostoni e **"pecorino"** delle caserecce: è lo stesso Pecorino toscano del cacio e pepe? |
| R-13 | **Tagliatelle al tartufo e filetto al tartufo:** burro, panna o solo olio? Tartufo nero o bianco, fresco a lamelle? Quale tartufo per stagione? |
| R-14 | **Insalata mista:** quali foglie e verdure? Condita in cucina o al tavolo? |
| R-15 | **Caffè:** in grani, in capsule o in cialde? Orzo e decaffeinato in che formato? |
| R-16 | **Tagli** di cinta senese (ragù vs tegamata), di cinghiale e della tartare; i salumi di cinta e di selvaggina del tagliere (quali, da chi). |
| R-17 | **Pasta:** pici, tagliatelle e spaghetti alla chitarra sono fatti in casa (allora servono farina e uova, non la pasta) o acquistati? I pici contengono uova? Le caserecce sono di semola o all'uovo? |
| R-18 | **Bistecca Fritta:** impanatura (farina, uova, pangrattato?) e olio di frittura (di arachide?). Friggitrice condivisa con le chips? |
| R-19 | **Chips di patate:** fatte in casa o acquistate (il sito dichiara glutine e uova)? |
| R-20 | **Agnello scottadito:** quante costolette a porzione? Marinatura (aglio, rosmarino)? |
| R-21 | **Trippa:** quale salsiccia (cinta?) e con formaggio grattugiato sopra? |
| R-22 | **Tagliere del Contadino:** quali formaggi (solo pecorini, come dice l'EN?), quali confetture, fatte in casa? |
| R-23 | Tutte le discordanze di allergeni tra derivazione e sito: `menu-draft.md` § 9 (A-01..A-22). |
| D-01 | **Dolci (solo sul sito):** sono in carta? Fatti in casa (ricetta e lotto) o acquistati (rivendita)? Chi è "Manu"? Quali dolci nel Tris senese? |

## 8. Conteggi

| Voce | Numero |
|---|---|
| Piatti con ricetta `plate` | 29 + 3 varianti del filetto (+ 7 dolci da confermare) |
| Semilavorati confermati (`batch` e `sub`) | 16 (14 `batch`, 2 `sub`: SL-03 Miscela segreta, SL-09 Salsa dolce forte) |
| Possibili semilavorati da confermare | 8 righe (§ 2.1) |
| Ingredienti grezzi nel CSV | 89 (di cui 18 solo assunti) |
