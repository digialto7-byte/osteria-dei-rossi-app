# Menu Osteria Dei Rossi — bozza (DRAFT)

| | |
|---|---|
| **Fonte primaria** | Menu incollato dal fondatore in chat, 2026-10-22 ("menu-source"). Testi riportati alla lettera. |
| **Fonte secondaria** | Sito del ristorante catturato dal lead il 2026-10-22 (`https://azure-locust-452058.hostingersite.com/`, blocchi `INFO`, `MENU`, `DRINKS`, `ALLERGENI`), dato dal fondatore come fonte per stile e prima bozza del menu. Usato per: informazioni del locale, coperto, flag "Consigliato dall'Oste", codici allergeni del sito (non affidabili), sezione Dolci, testi EN delle bevande. |
| **Stato** | **BOZZA (DRAFT)**. Approvato dal fondatore solo come bozza di fatti cliente. Non è ancora un fatto approvato ai sensi di `docs/client-facts.md`: non va usato in testi UI, seed o fixture finché non è approvato. |
| **Registro** | Questa bozza va registrata nell'archivio interno (fonte, data, stato) e, dopo l'approvazione, nel profilo cliente. |
| **Collegati** | Ricette: [`recipes-draft.md`](recipes-draft.md). Import ingredienti: [`ingredienti-draft.csv`](ingredienti-draft.csv). |

Dove sito e menu del fondatore differiscono, la tabella riporta il **testo del fondatore**; ogni
differenza è elencata in [§ 10](#10-differenze-tra-menu-del-fondatore-e-sito-domande). Nessun prezzo
differisce.

## 1. Fatti cliente in bozza (draft client facts)

Da confermare e registrare nell'archivio interno. Solo quanto scritto nelle fonti; niente aggiunto.

| Fatto | Valore | Fonte |
|---|---|---|
| Nome | Osteria Dei Rossi (il sito scrive "Osteria dei Rossi": maiuscola da confermare) | fondatore; sito |
| Dal 1992 | La fonte dice che il Sugo dell'Osteria è "in menu dal 1992" (PRI-06). Che il locale sia aperto dal 1992 non è scritto: da confermare. | fondatore; sito |
| Macellaio di fiducia | "Alessio", cura la selezione settimanale della Fiorentina | fondatore; sito |
| Cinta Senese della Tegamata | da allevamento allo stato brado nel cuore delle Crete Senesi | fondatore; sito |
| Carni della griglia | "Selezioniamo le migliori carni provenienti da razze e allevamenti di tutto il mondo" | fondatore; sito |
| Affermazione commerciale | Bistecca Fritta: "siamo gli unici a Siena e provincia a proporvela così" (affermazione del cliente, non verificata) | fondatore; sito |
| Indirizzo | Via dei Rossi, 79/81 · 53100 Siena | sito (`INFO`) |
| Telefono | +39 0577 287592 | sito (`INFO`) |
| Coperto | 2,50 € (bozza per l'impostazione `coperto_amount`, M17) | sito (`INFO`); non presente nel menu del fondatore |
| Instagram | https://www.instagram.com/osteriadeirossi/ | sito (`INFO`) |
| Facebook | https://www.facebook.com/osteriadeirossi | sito (`INFO`) |
| Google Maps | https://maps.google.com/?cid=5066073290586870112 | sito (`INFO`) |
| Link recensione Google | https://search.google.com/local/writereview?placeid=ChIJe88ntrcsKhMRYFGGC9FOTkY | sito (`INFO`) |
| Persona citata | "Manu" (Il Tiramisù di Manu) | sito (solo Dolci) |

Fuori ambito di questa bozza: logo (descritto in chat, file non ancora fornito) e colori/font del
sito. Vanno nel profilo brand, non qui.

## 2. Come leggere le tabelle

- **Codice**: identificativo di bozza (`ANT`, `PRI`, `SEC`, `GRI`, `FIL`, `CON`, `DOL`, `BEV`,
  `CAF`, `DIG`). Non è un codice del registratore RCH.
- **Unità di vendita**: `porzione`, `€/etto` (prezzo per 100 g), `bottiglia`, `calice`, `bicchiere`
  (birra), `pz`, `tazzina`, `bicchierino`.
- **Oste**: ✓ = "Consigliato dall'Oste" sul sito (flag `oste: true`). Il menu del fondatore non
  ha questo flag.
- **Da dichiarare (prudente)**: **la colonna raccomandata.** È l'**unione** dei codici delle
  due colonne a destra (derivati + sito), più le note di verifica. Per i prodotti rivenduti
  (§ 8) non ci sono quelle colonne: il valore viene dall'ingrediente CSV e dall'etichetta. Finché lo chef non conferma,
  è questa che va usata per informare il cliente.
- **Derivati (ricette)**: derivazione conservativa da ingredienti dichiarati e assunti in
  `recipes-draft.md`, con i 14 codici dell'app (`src/server/master/ingredients.ts`). Tra
  parentesi: ingredienti assunti che portano l'allergene, e "+ …" = dipende da etichette o
  ricette non ancora note.
- **Sito (non usare da soli)**: codici del sito tradotti nei codici dell'app, tenuti per
  tracciabilità. Il lead li segnala come non affidabili (es. arachidi sui pici al ragù):
  **non usare i codici del sito da soli**, perché in vari piatti dichiarano meno della
  derivazione (es. la Tartar senza latte, nessun solfito sui piatti con vino). Ogni discordanza è
  una domanda per lo chef in [§ 9](#9-allergeni-discordanze-tra-derivati-e-sito-domande-per-lo-chef).
- **"da confermare"** in una colonna allergeni = nessun allergene ancora noto per quella fonte.
  **Vuoto / "da confermare" ≠ privo di allergeni.**

> **Allergeni: dato di sicurezza alimentare.** Ogni allergene di questo documento, del ricettario
> e del CSV è **"da confermare"** con lo chef e con le etichette dei fornitori. Fino alla
> conferma vale la colonna **Da dichiarare (prudente)** (unione di derivati e sito): meglio
> dichiarare in più che in meno.
>
> **Salumi, salsiccia, lardo** (ANT-01, SEC-06, FIL-01-LAR): nel CSV gli allergeni sono vuoti
> perché dipendono dal prodotto, ma questi prodotti contengono spesso lattosio (latte), senape,
> frutta a guscio (es. pistacchio) o solfiti. **Decidono le etichette del fornitore.**
>
> **Limite del modello dati (requisito per M7).** L'app oggi non distingue "allergeni non
> ancora noti" da "nessun allergene": la colonna `ingredient.allergens` è `not null default
> '{}'`, quindi una cella vuota del CSV importa una lista vuota e l'ingrediente appare privo di
> allergeni (e lo stesso varrà per i piatti che lo ereditano). Per questo il CSV va importato
> **solo in un tenant di prova** finché non esiste un flag "allergeni confermati" (o uno stato
> "sconosciuto") su ingrediente e ricetta, e la matrice allergeni non lo mostra. Il requisito è
> nel piano di M7: [project plan § 5a.1, M7](../plans/2026-10-21-project-plan.md), voce "In:"
> ("Allergens unknown vs none (added 2026-10-22)") e acceptance test 6.

## 3. Antipasti · Starters

| Codice | Nome | Prezzo | Unità | Oste | **Da dichiarare (prudente)** | Derivati (ricette) | Sito (non usare da soli) | Descrizione IT (testo del fondatore) |
|---|---|---|---|---|---|---|---|---|
| ANT-01 | Tagliere del Cacciatore | 22,00 € | porzione |  | **frutta_a_guscio (+ etichetta salumi)** | da confermare (+ etichetta salumi) | frutta_a_guscio | Una selezione di salumi di cinta senese e selvaggina, espressione dei sapori più autentici del territorio. |
| ANT-02 | Tartar dell'Oste | 15,00 € | porzione | ✓ | **soia, latte, senape, solfiti** | latte, senape, solfiti | senape, soia | Battuta di manzo al coltello, preparata al momento per esaltarne la qualità della carne e il sapore autentico. Servita su una croccante cialda di parmigiano e accompagnata da senape antica in grani. |
| ANT-03 | Tagliere del Contadino | 16,00 € | porzione |  | **latte (+ etichetta confetture)** | latte (+ etichetta confetture) | latte | Formaggi toscani abbinati a miele e confetture genuini e ricchi di sapore che portano in tavola tutta la bontà della nostra terra. |
| ANT-04 | Bis di crostoni | 12,00 € | porzione |  | **glutine, latte** | glutine, latte | glutine, latte | Due crostoni dai sapori distinti: uno con gorgonzola e tartufo, l'altro con cacio, pere e miele. Due abbinamenti che uniscono carattere, cremosità e delicate note dolci. |
| ANT-05 | Acciughe sotto pesto | 10,00 € | porzione |  | **glutine, pesce, solfiti (mollica e aceto assunti; + ricetta pesto)** | pesce, glutine, solfiti (mollica e aceto assunti; + ricetta pesto) | pesce | Acciughe con pesto senese al dragoncello: profumate, saporite e con quel tocco in più che non ti aspetti. |
| ANT-06 | Crostini neri senesi | 9,00 € | porzione |  | **glutine, pesce, latte, frutta_a_guscio, sedano, solfiti (acciughe, vin santo, burro, brodo assunti; + ricetta paté)** | glutine, pesce, latte, sedano, solfiti (acciughe, vin santo, burro, brodo assunti; + ricetta paté) | glutine, frutta_a_guscio, sedano | Un simbolo della cucina senese, dal gusto intenso e inconfondibile, che porta in tavola i sapori di Siena. |

## 4. Primi · First courses

| Codice | Nome | Prezzo | Unità | Oste | **Da dichiarare (prudente)** | Derivati (ricette) | Sito (non usare da soli) | Descrizione IT (testo del fondatore) |
|---|---|---|---|---|---|---|---|---|
| PRI-01 | Tagliatelle al Tartufo di Stagione | 18,00 € | porzione |  | **glutine, uova, latte** | glutine, uova, latte | glutine, uova, latte | Tagliatella accompagnata dal profumo intenso di tartufo di stagione. |
| PRI-02 | Pici al Ragù Tradizionale di Anatra | 16,00 € | porzione | ✓ | **glutine, uova, arachidi, frutta_a_guscio, sedano, solfiti** | glutine, uova, sedano, solfiti | glutine, arachidi, frutta_a_guscio, sedano | Pici della tradizione conditi con un ragu d'anatra ricco e saporito. Un piatto rustico, di quelli che sanno di casa e di cucina toscana. |
| PRI-03 | Pici al Ragù Bianco di Cinta Senese | 16,00 € | porzione |  | **glutine, uova, arachidi, frutta_a_guscio, sedano, solfiti (+ miscela segreta)** | glutine, uova, sedano, solfiti (+ miscela segreta) | glutine, arachidi, frutta_a_guscio, sedano | Ragù bianco di cinta senese, senza pomodoro, con la miscela segreta di erbe e spezie della casa. |
| PRI-04 | Tagliatelle al Ragù di Cinghiale | 16,00 € | porzione |  | **glutine, uova, arachidi, frutta_a_guscio, sedano, solfiti** | glutine, uova, sedano, solfiti | glutine, uova, arachidi, frutta_a_guscio, sedano | Tagliatelle accompagnate da un ragù di cinghiale dai sapori autentici e rustici della tradizione toscana. |
| PRI-05 | Pici Cacio e Pepe | 15,00 € | porzione |  | **glutine, uova, latte** | glutine, uova, latte | glutine, latte | Pici con pecorino toscano e pepe nero, una versione in stile toscano di un grande classico della cucina italiana. |
| PRI-06 | Spaghetti alla Chitarra con Sugo dell'Osteria | 14,00 € | porzione |  | **glutine, uova, latte** | glutine, uova, latte | glutine, uova, latte | Una ricetta storica ed esclusiva dell'Osteria Dei Rossi in menu dal 1992: Sugo a base di pomodoro, gorgonzola e peperoncino, per un incontro deciso e inconfondibile di sapori. |
| PRI-07 | Caserecce con Zucca Gialla, Porri e Pecorino | 14,00 € | porzione |  | **glutine, uova, arachidi, latte, frutta_a_guscio, sedano** | glutine, uova, latte | glutine, uova, arachidi, latte, frutta_a_guscio, sedano | Pasta corta con zucca gialla, porri e pecorino, una preparazione vegetariana dai sapori delicati e genuini. |
| PRI-08 | Ribollita | 13,00 € | porzione |  | **glutine, arachidi, soia, sedano** | glutine, sedano | glutine, arachidi, soia, sedano | La celebre zuppa toscana della tradizione contadina, ricca di storia. A volta le cose semplici sono le migliori. |

## 5. Secondi · Main courses

### 5.1 Specialità della cucina · House specialties

| Codice | Nome | Prezzo | Unità | Oste | **Da dichiarare (prudente)** | Derivati (ricette) | Sito (non usare da soli) | Descrizione IT (testo del fondatore) |
|---|---|---|---|---|---|---|---|---|
| SEC-01 | Cinghiale in Dolce Forte | 20,00 € | porzione |  | **glutine, arachidi, soia, latte, sedano, solfiti (cioccolato e pane grattugiato assunti; + ricetta dolce forte)** | glutine, latte, soia, sedano, solfiti (cioccolato e pane grattugiato assunti; + ricetta dolce forte) | glutine, arachidi, soia, latte, sedano | Un'antica ricetta medievale toscana, in cui il sapore intenso del cinghiale incontra il caratteristico equilibrio agrodolce del dolce forte. |
| SEC-02 | Tegamata di Cinta Senese | 19,00 € | porzione | ✓ | **glutine, sedano, solfiti** | sedano, solfiti | glutine, sedano | Uno stufato di cinta senese a cottura lenta, preparato senza base di pomodoro con carne proveniente da un allevamento allo stato brado nel cuore delle Crete Senesi. |
| SEC-03 | Agnello allo Scottadito | 18,00 € | porzione |  | **da confermare** | da confermare | da confermare | Costolette d'agnello cotte alla griglia, da gustare calde secondo la tradizione. |
| SEC-04 | Cinghiale al Coccio con Polenta | 18,00 € | porzione |  | **glutine, arachidi, frutta_a_guscio, sedano, solfiti** | sedano, solfiti | glutine, arachidi, frutta_a_guscio | Spezzatino di cinghiale dalla cottura lenta e aromatica, accompagnato da polenta: un grande classico della cucina toscana. |
| SEC-05 | Sovracosce di Pollo alla Diavola | 16,00 € | porzione |  | **uova, latte (+ ricetta salsa piccante)** | da confermare (+ ricetta salsa piccante) | uova, latte | Sovracosce di pollo croccanti, cotte alla griglia e accompagnate da una salsa piccante fatta in casa. |
| SEC-06 | Trippa | 14,00 € | porzione |  | **glutine, latte, sedano (+ formaggio? da confermare; + etichetta salsiccia)** | sedano, latte (+ formaggio? da confermare; + etichetta salsiccia) | glutine, sedano | Una ricetta della tradizione popolare senese, particolarmente legata al periodo del Palio. Sugo a base di pomodoro, salsiccia e peperoncino. |

### 5.2 Bistecche e tagli alla griglia · Steaks and grilled cuts (prezzo per etto)

| Codice | Nome | Prezzo | Unità | Oste | **Da dichiarare (prudente)** | Derivati (ricette) | Sito (non usare da soli) | Descrizione IT (testo del fondatore) |
|---|---|---|---|---|---|---|---|---|
| GRI-01 | Bistecca alla Fiorentina | 9,00 € | €/etto | ✓ | **da confermare** | da confermare | da confermare | La specialità della casa: una selezione settimanale curata da Alessio il nostro macellaio di fiducia. Selezioniamo le migliori carni provenienti da razze e allevamenti di tutto il mondo, per offrire un'esperienza alla griglia sempre distintiva e unica. |
| GRI-02 | Bistecca Fritta | 12,00 € | €/etto |  | **glutine, uova (+ olio di frittura (arachidi?) / contaminazione friggitrice: glutine, uova)** | glutine, uova (+ olio di frittura (arachidi?) / contaminazione friggitrice: glutine, uova) | glutine, uova | La nostra versione fuori dagli schemi della regina della tavola toscana: una bella bistecca alla fiorentina, impanata e fritta, croccante fuori e succosa dentro. Una specialità unica: siamo gli unici a Siena e provincia a proporvela così. Da provare almeno una volta! |
| GRI-03 | Costata del vamosh | 7,00 € | €/etto |  | **da confermare** | da confermare | da confermare | Un taglio di manzo simile alla Fiorentina, ma senza filetto, ideale per chi ama il gusto autentico della carne alla griglia. |

**Prezzo per etto (modello dati, M17).** Questi tre piatti sono venduti a peso: 1 etto = 100 g,
quindi 9 €/etto = 90 €/kg. Il `menu_item` del piano (§3.5.1) ha un solo `price` e `order_line.qty`
conta porzioni (0,5 ammesso). Serve un'**unità di vendita per 100 g** sul `menu_item` (es.
`sale_unit = 'etto'`) e una quantità a peso sulla riga d'ordine (peso reale crudo o cotto, deciso
in sala), con lo scarico dello stock in kg dello stesso peso. Da inserire nel piano di M17/M18;
domande in [§ 10](#10-differenze-tra-menu-del-fondatore-e-sito-domande).

### 5.3 Filetto di manzo · Beef fillet (con varianti)

| Codice | Nome | Prezzo | Unità | Oste | **Da dichiarare (prudente)** | Derivati (ricette) | Sito (non usare da soli) | Descrizione IT (testo del fondatore) |
|---|---|---|---|---|---|---|---|---|
| FIL-01 | Medaglione di Filetto alla Griglia (al naturale) | 25,00 € | porzione |  | **da confermare** | da confermare | da confermare | Medaglione di filetto di manzo cotto alla griglia, da gustare al naturale oppure nelle sue varianti. |
| FIL-01-TAR | ↳ Con Tartufo | 30,00 € | porzione |  | **latte (burro assunto, come PRI-01)** | latte (burro assunto, come PRI-01) | latte | Per chi al profumo del tartufo non sa proprio dire di no. |
| FIL-01-PEP | ↳ Con Salsa al Pepe Verde | 28,00 € | porzione |  | **latte (+ ricetta salsa)** | latte (+ ricetta salsa) | latte | Una salsa al pepe verde dal gusto deciso, per dare al filetto una bella spinta. |
| FIL-01-LAR | ↳ Con Lardo di Colonnata | 28,00 € | porzione |  | **da confermare** | da confermare | da confermare | Lardo di Colonnata, morbido e saporito, per un abbinamento ricco e tutto da gustare. |

**Varianti (modello).** Il prezzo della variante è il **prezzo totale del piatto** (non un
supplemento): +5,00 € tartufo, +3,00 € pepe verde, +3,00 € lardo rispetto al naturale. Proposta:
quattro `menu_item` distinti, ognuno con la propria ricetta piatto (filetto + condimento), così
costo e margine sono esatti per variante. Alternativa: un `menu_item` con modificatori a
supplemento (M18), se i modificatori potranno portare prezzo e ingredienti.

## 6. Contorni · Side dishes

| Codice | Nome | Prezzo | Unità | Oste | **Da dichiarare (prudente)** | Derivati (ricette) | Sito (non usare da soli) | Descrizione IT (testo del fondatore) |
|---|---|---|---|---|---|---|---|---|
| CON-01 | Chips di Patate Croccanti | 7,00 € | porzione |  | **glutine, uova (+ olio di frittura (arachidi?) / contaminazione friggitrice: glutine, uova)** | glutine, uova (+ olio di frittura (arachidi?) / contaminazione friggitrice: glutine, uova) | glutine, uova | Dorate, croccanti e una tira l'altra. C'è davvero bisogno di aggiungere altro? |
| CON-02 | Fagioli all'Uccelletto | 7,00 € | porzione |  | **latte, sedano** | da confermare | latte, sedano | Un grande classico toscano: fagioli saporiti, perfetti per accompagnare i piatti della casa. |
| CON-03 | Patate Prezzemolate | 6,00 € | porzione |  | **da confermare** | da confermare | da confermare | Patate lesse condite con prezzemolo tritato, olio, sale e pepe. Semplici, genuine e sempre al posto giusto. |
| CON-04 | Erbe Saltate | 8,00 € | porzione |  | **glutine, latte, sedano** | da confermare | glutine, latte, sedano | Bietole, cicoria e spinaci saltati in padella con aglio, olio e peperoncino. Verdure sì, ma con carattere. |
| CON-05 | Insalata Mista | 5,00 € | porzione |  | **solfiti (se condita con aceto)** | solfiti (se condita con aceto) | da confermare | Insalata fresca, ideale per chi vuole qualcosa di leggero e genuino. |

## 7. Dolci · Desserts (solo sul sito: da confermare)

**Questa sezione non è nel menu incollato dal fondatore.** È presa dal sito. Da confermare che i
dolci siano in carta oggi, e se sono fatti in casa o acquistati (domanda D-01 in
`recipes-draft.md`). Il sito non ha descrizioni IT per i dolci; la colonna riporta le opzioni
pubblicate.

| Codice | Nome | Prezzo | Unità | Oste | **Da dichiarare (prudente)** | Derivati (ricette) | Sito (non usare da soli) | Descrizione IT (sito) |
|---|---|---|---|---|---|---|---|---|
| DOL-01 | Il Tiramisù di Manu | 8,00 € | porzione |  | **glutine, uova, latte** | glutine, uova, latte | glutine, uova, latte | (nessuna) |
| DOL-02 | Cantuccini e Vin Santo | 7,00 € | porzione |  | **glutine, uova, frutta_a_guscio, solfiti** | glutine, uova, frutta_a_guscio, solfiti | glutine, uova, frutta_a_guscio, solfiti | (nessuna) |
| DOL-03 | Panna Cotta | 6,00 € | porzione |  | **latte, soia se opzione cioccolato (+ etichetta topping)** | latte (+ etichetta topping) | latte | Opzioni: Al cioccolato; Ai frutti di bosco; Al caramello. |
| DOL-04 | Tortino al Cioccolato con Cuore Caldo | 8,00 € | porzione |  | **glutine, uova, latte, soia (+ etichetta cioccolato)** | glutine, uova, latte, soia (+ etichetta cioccolato) | da confermare | (nessuna) |
| DOL-05 | Cheesecake | 7,00 € | porzione |  | **glutine, uova, latte, soia se opzione cioccolato (+ etichetta topping)** | glutine, uova, latte (+ etichetta topping) | da confermare | Opzioni: Al cioccolato; Ai frutti di bosco; Al caramello. |
| DOL-06 | Tris di Dolci Senesi | 8,00 € | porzione |  | **glutine, uova, frutta_a_guscio (+ etichetta)** | glutine, uova, frutta_a_guscio (+ etichetta) | da confermare | (nessuna) |
| DOL-07 | Carpaccio di Pere e Scaglie di Cioccolato Fondente | 6,00 € | porzione |  | **soia, latte (etichetta cioccolato)** | latte, soia (etichetta cioccolato) | da confermare | (nessuna) |

Opzioni di Panna Cotta e Cheesecake: proposta di tre `menu_item` (o modificatori senza
supplemento) per opzione, perché il topping cambia ingredienti e allergeni.

## 8. Bevande, caffetteria, amari: articoli di rivendita (nessuna ricetta)

Articoli rivenduti: nessuna ricetta di preparazione; ogni articolo scarica 1:1 un ingrediente a
magazzino del CSV (bottiglia in `pz`, vino al calice e alla spina in `l`). Le quantità per calice,
bicchiere e bicchierino sono **da compilare** (non inventate).

### 8.1 Bevande · Drinks

| Codice | Nome (fondatore) | Prezzo | Unità | **Da dichiarare (prudente)** | Scelte / note | Ingrediente CSV |
|---|---|---|---|---|---|---|
| BEV-01 | Vino l'Osteria Rosso bottiglia 0.75 | 18,00 € | bottiglia | **solfiti** | | Vino l'Osteria Rosso (bottiglia 0,75 l) |
| BEV-02 | Vino l'Osteria Bianco bottiglia 0.75 | 15,00 € | bottiglia | **solfiti** | | Vino l'Osteria Bianco (bottiglia 0,75 l) |
| BEV-03 | Vino al Calice Rosso | 7,00 € | calice | **solfiti** | Variante a scelta: Chianti Classico Gallo Nero; IGT Toscano; Maremma DOC | Chianti Classico Gallo Nero; Vino rosso IGT Toscano; Vino rosso Maremma DOC |
| BEV-04 | Vino al Calice Bianco | 6,00 € | calice | **solfiti** | Variante a scelta: Vernaccia di San Gimignano; Vermentino Toscano | Vernaccia di San Gimignano; Vermentino Toscano |
| BEV-05 | Bionda alla Spina Lager Media | 7,00 € | bicchiere (media) | **glutine** | | Birra bionda lager alla spina |
| BEV-06 | Bionda alla Spina Lager Piccola | 4,50 € | bicchiere (piccola) | **glutine** | | Birra bionda lager alla spina |
| BEV-07 | Coca-Cola / Coca-Cola Zero | 3,50 € | pz | **nessuno da etichetta (da confermare)** | Variante a scelta: Coca-Cola; Coca-Cola Zero | Coca-Cola; Coca-Cola Zero |
| BEV-08 | Acqua | 2,50 € | pz | **nessuno da etichetta (da confermare)** | | Acqua (bottiglia) |

Proposta per i calici e la Coca-Cola: un `menu_item` per scelta (stesso prezzo), così lo scarico
tocca la bottiglia giusta.

### 8.2 Caffetteria · Coffee

| Codice | Nome | Prezzo | Unità | **Da dichiarare (prudente)** | Ingrediente CSV |
|---|---|---|---|---|---|
| CAF-01 | Caffè corretto | 2,50 € | tazzina | **da confermare (etichetta)** | Caffè in grani + liquore da confermare |
| CAF-02 | Caffè | 2,00 € | tazzina | **nessuno da etichetta (da confermare)** | Caffè in grani |
| CAF-03 | Caffè d'Orzo | 2,00 € | tazzina | **glutine** | Caffè d'orzo |
| CAF-04 | Caffè Decaffeinato | 2,00 € | tazzina | **nessuno da etichetta (da confermare)** | Caffè decaffeinato |

### 8.3 Amari e grappe · Digestifs and grappas

| Codice | Nome | Prezzo | Unità | **Da dichiarare (prudente)** |
|---|---|---|---|---|
| DIG-01 | Vecchio Toscano | 4,00 € | bicchierino | **da confermare (etichetta)** |
| DIG-02 | Amaro di Siena | 4,00 € | bicchierino | **da confermare (etichetta)** |
| DIG-03 | Jefferson | 4,00 € | bicchierino | **da confermare (etichetta)** |
| DIG-04 | Bomba Carta | 4,00 € | bicchierino | **da confermare (etichetta)** |
| DIG-05 | Grappa Poli Aromatizzata | 4,00 € | bicchierino | **da confermare (etichetta)** |
| DIG-06 | Montenegro | 3,50 € | bicchierino | **da confermare (etichetta)** |
| DIG-07 | Capo | 3,50 € | bicchierino | **da confermare (etichetta)** |
| DIG-08 | Grappa Poli Bianca | 3,00 € | bicchierino | **da confermare (etichetta)** |
| DIG-09 | Grappa Poli Barricata | 3,00 € | bicchierino | **da confermare (etichetta)** |

Ogni amaro e grappa è un ingrediente in `l` con lo stesso nome nel CSV.

## 9. Allergeni: discordanze tra derivati e sito (domande per lo chef)

Una domanda per ogni piatto in cui le colonne **Derivati** e **Sito** differiscono. "Sito in più"
= il sito dichiara un allergene che la derivazione non trova; "sito in meno" = la derivazione lo
trova, il sito no. **Ogni allergene di entrambe le colonne è già incluso in "Da dichiarare
(prudente)"**: le domande servono a capire quali togliere dopo la conferma, non ad aggiungerne.
Le colonne "Sito in più" e "Sito in meno" sotto sono ricalcolate dopo la revisione del
2026-10-22. I piatti in cui le due colonne coincidono (ANT-03, ANT-04, PRI-01, PRI-06, SEC-03, GRI-01, GRI-02, GRI-03, FIL-01, FIL-01-PEP, FIL-01-LAR, CON-03, DOL-01, DOL-02, DOL-03) non sono elencati, ma restano da
confermare. FIL-01-TAR e CON-01 ora coincidono ma restano in tabella perché hanno ancora una
domanda per lo chef.

| # | Piatto | Sito in più | Sito in meno | Domanda |
|---|---|---|---|---|
| A-01 | ANT-01 Tagliere del Cacciatore | frutta_a_guscio | nessuno | Quali salumi? Qualcuno contiene pistacchio, noci o altra frutta a guscio? Etichette dei salumi (spesso latte, solfiti, senape). |
| A-02 | ANT-02 Tartar dell'Oste | soia | latte, solfiti | La cialda è di parmigiano (latte): il sito non lo dichiara. Nella tartare c'è salsa di soia o Worcestershire? La senape in grani contiene solfiti (etichetta)? |
| A-03 | ANT-06 Crostini neri senesi | frutta_a_guscio | pesce, latte, solfiti | Cosa c'è nel paté (domanda R-02 in `recipes-draft.md`)? Sedano nel soffritto? Frutta a guscio? |
| A-04 | PRI-02 Pici al ragù d'anatra | arachidi, frutta_a_guscio | uova, solfiti | Arachidi e frutta a guscio nel ragù o nei pici? (Il lead le ritiene errori.) Il ragù è sfumato con vino? |
| A-05 | PRI-03 Pici al ragù bianco | arachidi, frutta_a_guscio | uova, solfiti | Come A-04; la "miscela segreta" contiene frutta a guscio o arachidi? Vino bianco nel ragù? |
| A-06 | PRI-04 Tagliatelle al ragù di cinghiale | arachidi, frutta_a_guscio | solfiti | Come A-04. |
| A-07 | PRI-07 Caserecce zucca, porri e pecorino | arachidi, frutta_a_guscio, sedano | nessuno | Le caserecce sono all'uovo? C'è brodo vegetale con sedano, o frutta a guscio (es. noci, granella)? Arachidi? |
| A-08 | PRI-08 Ribollita | arachidi, soia | nessuno | Arachidi e soia da dove (dado, olio di semi di arachide)? |
| A-09 | SEC-01 Cinghiale in dolce forte | arachidi | solfiti | La carne è infarinata? Il dolce forte contiene cioccolato (latte, soia), pane? Arachidi? Aceto e vino (solfiti)? |
| A-10 | SEC-02 Tegamata di cinta senese | glutine | solfiti | Carne infarinata o pane? Sfumata con vino? |
| A-11 | SEC-04 Cinghiale al coccio con polenta | glutine, arachidi, frutta_a_guscio | sedano, solfiti | Carne infarinata? Arachidi e frutta a guscio da dove? C'è soffritto con sedano e vino? La polenta è solo mais (contaminazione glutine)? |
| A-12 | SEC-05 Pollo alla diavola | uova, latte | nessuno | La salsa piccante contiene uova o latte (es. base maionese, burro)? Il pollo è marinato con latte o yogurt? |
| A-13 | SEC-06 Trippa | glutine | latte | C'è pane, farina o formaggio grattugiato (latte) servito sopra? Etichetta della salsiccia. |
| A-14 | FIL-01-TAR Filetto con tartufo | nessuno (ora coincidono) | nessuno (ora coincidono) | C'è burro o panna con il tartufo? |
| A-15 | CON-01 Chips di patate | nessuno (ora coincidono) | nessuno (ora coincidono) | Chips fatte in casa o acquistate (pastellate)? Friggitrice condivisa con la Bistecca Fritta impanata (contaminazione glutine e uova)? |
| A-16 | CON-02 Fagioli all'uccelletto | latte, sedano | nessuno | Burro, formaggio o soffritto con sedano nei fagioli? |
| A-17 | CON-04 Erbe saltate | glutine, latte, sedano | nessuno | Pangrattato, burro, formaggio o sedano nelle erbe? |
| A-18 | CON-05 Insalata mista | nessuno | solfiti | Arriva già condita con aceto o con oliera e acetiera al tavolo? |
| A-19 | DOL-04 Tortino al cioccolato | nessuno | glutine, uova, latte, soia | Fatto in casa o acquistato? Etichetta: un tortino di cioccolato contiene di norma farina, uova, burro; il cioccolato fondente spesso latte e lecitina di soia. |
| A-20 | DOL-05 Cheesecake | nessuno | glutine, uova, latte | Base di biscotto e crema di formaggio: etichetta o ricetta. |
| A-21 | DOL-06 Tris di Dolci Senesi | nessuno | glutine, uova, frutta_a_guscio | Quali dolci (ricciarelli, panforte, cavallucci?) e da quale produttore: etichetta. |
| A-22 | DOL-07 Carpaccio di pere e cioccolato | nessuno | soia, latte | Etichetta del cioccolato fondente (latte, lecitina di soia). |
| A-23 | ANT-05 Acciughe sotto pesto | nessuno | glutine, solfiti | Il pesto contiene mollica di pane (glutine) e aceto (solfiti), come nella ricetta senese? Il sito dichiara solo pesce. |
| A-24 | PRI-05 Pici Cacio e Pepe | nessuno | uova | I pici sono senza uova (tradizione) o all'uovo? Finché non è confermato, uova resta dichiarato (vale anche per PRI-02 e PRI-03). |

## 10. Differenze tra menu del fondatore e sito (domande)

Nessun prezzo differisce: i 53 prezzi presenti in entrambe le fonti (29 piatti, 3 varianti, 21
bevande) coincidono; i 7 dolci sono solo sul sito. Differenze di nome, testo e
struttura, da far scegliere al fondatore:

| # | Dove | Fondatore | Sito | Domanda |
|---|---|---|---|---|
| S-01 | ANT-02 nome | Tartar dell'Oste | Tartare dell'Oste | Quale grafia va in carta e nell'app? |
| S-02 | GRI-03 nome | Costata del vamosh | Costata del Vamosh | Maiuscola? Cosa significa "vamosh" (nome proprio, soprannome)? |
| S-03 | Nome del locale (PRI-06) | Osteria Dei Rossi | Osteria dei Rossi | Grafia ufficiale del nome. |
| S-04 | PRI-06 descrizione | "in menu dal 1992: Sugo a base…" | "in menù dal 1992: sugo a base…" | Accento e maiuscola. |
| S-05 | PRI-02 descrizione | "un ragu d'anatra" | "un ragù d'anatra" | Refuso nel testo del fondatore? |
| S-06 | PRI-08 descrizione | "A volta le cose semplici…" | "A volte le cose semplici…" | Refuso nel testo del fondatore? |
| S-07 | GRI-01 descrizione | "curata da Alessio il nostro macellaio" | "curata da Alessio, il nostro macellaio" | Virgola. |
| S-08 | Struttura | Bistecche e Filetto sotto "SECONDI" | Sezione separata "Griglia / From the grill" | Quale categoria per la sala (`menu_item.category`)? |
| S-09 | Dolci | assenti | 7 dolci (§ 7) | I dolci sono in carta? Con questi prezzi? |
| S-10 | Bevande, nomi | "Vino al Calice Rosso", "Bionda alla Spina Lager Media", "bottiglia 0.75", "Caffè d'Orzo" | "Vino al calice · Rosso", "Bionda alla spina · Lager media", "bottiglia 0,75 l", "Caffè d'orzo" | Grafia per l'app (proposta: quella del sito, più coerente con il formato italiano). |
| S-11 | Ordine caffetteria | Caffè corretto per primo | Caffè per primo | Solo ordine di presentazione. |
| S-12 | Coperto | non indicato | 2,50 € | Confermare il coperto per M17. |
| S-13 | EN bevande | assente | presente (§ 11.2) | Usare i testi EN del sito? |

Altre domande sul menu (non dipendono dal sito):

| # | Domanda |
|---|---|
| M-01 | **Per etto (GRI-01..03):** il peso fatturato è crudo o cotto? Peso minimo? Arrotondamento all'etto o al grammo? Il cameriere inserisce il peso in sala? (Serve per l'unità per 100 g in M17.) |
| M-02 | **Varianti filetto:** in cassa (RCH) sono quattro articoli o un articolo con supplemento? |
| M-03 | **Caffè corretto:** con quale liquore o grappa? Scarica una delle grappe in elenco? |
| M-04 | **Grappa Poli Aromatizzata:** quale aromatizzazione (una o più)? |
| M-05 | **Acqua:** formato (es. 0,75 l), naturale e frizzante sono lo stesso articolo? |
| M-06 | **Coca-Cola:** formato (vetro, lattina, alla spina)? |
| M-07 | **Aliquote IVA** per piatti e bevande (per `menu_item.vat_rate`): dal commercialista. |
| M-08 | **EN Tagliere del Contadino:** l'EN dice "Tuscan pecorino cheeses", l'IT "Formaggi toscani": sono solo pecorini? |
| M-09 | **EN Insalata Mista:** l'EN aggiunge "with seasonal vegetables", assente nell'IT: quali verdure? |
| M-10 | **EN Bis di crostoni / Tagliatelle:** l'EN dice "slices of truffle" e "sliced, seasonal fresh truffle": tartufo fresco a lamelle (non olio o crema al tartufo)? |

## 11. Descrizioni EN (verbatim)

<details>
<summary>11.1 Piatti (testo del fondatore)</summary>

| Codice | EN |
|---|---|
| ANT-01 | A selection of cured Cinta Senese pork and game meats, bringing the most authentic flavours of the local area to your table. |
| ANT-02 | Beef tartare, hand-cut with a knife and prepared to order to bring out the quality of the meat and its authentic flavour. Served on a crispy Parmesan wafer and accompanied by antique wholegrain mustard. |
| ANT-03 | Tuscan pecorino cheeses paired with honey and preserves that bring all the goodness of the region straight to your table. |
| ANT-04 | Two toasted bread slices with very different flavours: one topped with Gorgonzola and slices of truffle, the other with Tuscan cheese, pears and honey. Two combinations that bring together bold flavours, creaminess and delicate sweet notes. |
| ANT-05 | Anchovies with Senese tarragon pesto: fragrant, full of flavour and with that unexpected little something extra. |
| ANT-06 | A true symbol of Senese cuisine, with an unmistakable classic flavour that brings the tastes of Siena straight to your table. |
| PRI-01 | Tagliatelle served with the intense aroma of sliced, seasonal fresh truffle. |
| PRI-02 | Traditional pici tossed in a rich, flavourful duck ragù. A rustic dish, the kind that tastes of home and proper Tuscan cooking. |
| PRI-03 | White Cinta Senese pork ragù, made without tomato and seasoned with our house's secret blend of herbs and spices. |
| PRI-04 | Tagliatelle served with wild boar ragù, full of the authentic, rustic flavours of Tuscan tradition. |
| PRI-05 | Pici with Tuscan pecorino cheese and black pepper, our Tuscan take on a great Italian classic. |
| PRI-06 | A historic, exclusive recipe from Osteria Dei Rossi, on the menu since 1992: a tomato-based sauce with Gorgonzola and chilli, bringing together bold, unmistakable flavours. |
| PRI-07 | Short pasta with yellow pumpkin, leeks and pecorino, a vegetarian dish with delicate flavours. |
| PRI-08 | The famous Tuscan peasant soup, steeped in history. Sometimes the simplest things are the best. |
| SEC-01 | An ancient Tuscan medieval recipe, where the intense flavour of wild boar meets the distinctive sweet-and-sour balance of dolce forte. |
| SEC-02 | A slow-cooked Cinta Senese pork stew, made without a tomato base, using meat from free-range pigs raised in the heart of the Crete Senesi. |
| SEC-03 | Grilled lamb chops, best enjoyed piping hot, just as tradition dictates. |
| SEC-04 | Slow-cooked, aromatic wild boar stew served with polenta: a true classic of Tuscan cooking. |
| SEC-05 | Crispy grilled chicken thighs served with our homemade spicy sauce. |
| SEC-06 | A dish rooted in traditional Senese home cooking, especially associated with Palio season. Served in a tomato sauce with sausage and chilli. |
| GRI-01 | The house speciality: a weekly selection hand-picked by Alessio, our trusted butcher. We choose the finest beef from breeds and farms around the world to offer a truly distinctive and unique grilling experience every time. |
| GRI-02 | Our unconventional take on the queen of the Tuscan table: a proper Florentine steak, breaded and fried until crispy on the outside and juicy on the inside. A one-of-a-kind speciality: we're the only ones in Siena and the surrounding province serving it this way. You have to try it at least once! |
| GRI-03 | A cut of beef similar to a Florentine steak, but without the tenderloin, perfect for those who love the authentic taste of grilled meat. |
| FIL-01 | A beef fillet medallion cooked on the grill, to enjoy just as it is or with one of our toppings. |
| FIL-01-TAR | For those who simply can't say no to truffle. |
| FIL-01-PEP | A bold green pepper sauce that gives the fillet an extra kick. |
| FIL-01-LAR | Delicate, flavourful cured pork fat from Colonnata, bringing a rich and satisfying pairing to the fillet. |
| CON-01 | Golden, crispy and impossible to stop eating. Do we really need to say more? |
| CON-02 | A Tuscan favourite: flavourful beans, perfect alongside our house dishes. |
| CON-03 | Boiled potatoes dressed with chopped parsley, oil, salt and pepper. Simple, honest and always right at home on the plate. |
| CON-04 | Swiss chard, chicory and spinach sautéed with garlic, olive oil and chilli. Greens with a bit of attitude. |
| CON-05 | Fresh mixed salad with seasonal vegetables, for something light and wholesome. |

</details>

<details>
<summary>11.2 Dolci e bevande (testi EN del sito)</summary>

| Codice | EN (sito) |
|---|---|
| DOL-01 | Manu's tiramisù. |
| DOL-02 | Tuscan almond biscuits with Vin Santo dessert wine. |
| DOL-03 | (none) — options: Chocolate; Wild berries; Caramel |
| DOL-04 | Chocolate fondant with a warm, melting centre. |
| DOL-05 | (none) — options: Chocolate; Wild berries; Caramel |
| DOL-06 | A trio of traditional Sienese sweets. |
| DOL-07 | Thinly sliced pears with dark chocolate shavings. |
| BEV-01 | L'Osteria red wine · 0.75 l bottle |
| BEV-02 | L'Osteria white wine · 0.75 l bottle |
| BEV-03 | Red wine by the glass |
| BEV-04 | White wine by the glass |
| BEV-05 | Draught lager · medium |
| BEV-06 | Draught lager · small |
| BEV-07 | Coca-Cola / Coca-Cola Zero |
| BEV-08 | Water |
| CAF-01 | Espresso with a dash of liqueur |
| CAF-02 | Espresso |
| CAF-03 | Barley coffee |
| CAF-04 | Decaf espresso |

Amari e grappe: nessun testo EN (nomi propri).

</details>

## 12. Conteggi

| Voce | Numero |
|---|---|
| Piatti con ricetta (menu del fondatore) | 29 (6 antipasti, 8 primi, 6 secondi, 3 griglia, 1 filetto, 5 contorni) |
| Varianti del filetto | 3 (4 `menu_item` proposti con il naturale) |
| Dolci (solo sito) | 7 |
| Articoli di rivendita | 21 righe di menu (8 bevande, 4 caffetteria, 9 amari e grappe) |
