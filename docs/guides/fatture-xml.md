# Fatture elettroniche (file XML): guida

Per chi gestisce l'app per il locale (DigiAlto, titolare e amministratore). Spiega come caricare il file della fattura elettronica del fornitore, che cosa ne legge l'app, che cosa rifiuta, che cosa fare se la stessa fattura arriva due volte e come copiare il lotto che il fornitore ha scritto nel file. Il cuoco e il cameriere non vedono le fatture. La progettazione è in `docs/plans/2026-11-14-p2-7-xml-invoice-upload.md` e in `docs/adr/adr-044-fatturapa-xml-import.md`. I nomi delle schermate sono quelli dell'app.

Gli esempi usano nomi inventati ("Fornitore Demo 1", "Farina Demo", fattura "FT 12", lotto "L-DEMO-0001"). Questa guida non dice che cosa la legge chieda a un locale: per i doveri sulle fatture e per la loro conservazione vale quello che dice il vostro commercialista. La copia del file che l'app tiene è una copia di lavoro: **non sostituisce la conservazione digitale (conservazione) delle fatture, che resta dove è oggi**.

## Dove trovare il file

Il file è quello che il fornitore ha emesso, non un PDF e non una foto. Ha il nome che finisce con `.xml`, oppure con `.xml.p7m` se è firmato. Lo trovate:

- nel portale "Fatture e Corrispettivi", tra le fatture ricevute, scaricando il file della fattura;
- nell'e-mail (PEC) o nel programma dove il locale riceve le fatture;
- dal commercialista, che di solito li ha tutti.

Non aprite il file con un programma e non cambiatelo: caricatelo com'è. Se scaricate la fattura dal portale in formato PDF, quello è un altro file: va caricato come un PDF.

## Caricare il file

1. Aprite «Fatture».
2. Nella scheda «Carica una fattura» toccate il campo «Carica PDF, foto o file XML» e scegliete il file. Sotto il nome compare «Fattura elettronica»: è solo un promemoria, la lettura vera la fa l'app sul contenuto.
3. Toccate «Carica». L'app legge il file subito, in pochi secondi, senza attendere: non c'è nessuna lettura con l'intelligenza artificiale per questi file, quindi niente errori di lettura.
4. Se tutto va bene l'app scrive il numero, la data, il fornitore e il totale, e vi propone «Controlla ora ›». La fattura si controlla e si approva con «Approva fattura», esattamente come una fattura da foto.

Il file può essere grande al massimo 4 MB. Se lo supera, quasi sempre contiene un PDF allegato: scaricate dal portale la fattura senza allegati, oppure caricate il PDF.

Nell'elenco delle fatture, ogni fattura nata da un file porta il segno «XML» oppure «XML firmato».

## Che cosa legge l'app

Nella pagina di controllo trovate il riquadro «Dati dal file XML» (su telefono si apre e si chiude toccando il titolo):

- il fornitore con la sua partita IVA, il numero e la data della fattura, la «Scadenza pagamento» se il file la indica;
- il «Riepilogo IVA», una riga per ogni aliquota (o per ogni natura, per le operazioni senza IVA) con l'imponibile e l'IVA, e il «Totale documento»;
- «Scarica il file originale ›», per riavere il file così com'era; si scarica e non si apre nel browser.

Ogni riga della fattura è letta dal file: descrizione, quantità, unità, prezzo e aliquota IVA. Il prezzo è quello netto, cioè già con gli eventuali sconti di riga; il prezzo di listino e lo sconto sono scritti sotto la riga. Se il fornitore ha indicato un codice articolo (per esempio "Cod. EAN 8000000000001"), l'app lo usa per riconoscere l'articolo la volta dopo, insieme agli abbinamenti che avete già fatto.

L'intestatario deve essere il locale: se nel file c'è un'altra partita IVA, l'app lo dice e non salva nulla.

Tutto il resto del controllo è quello di sempre: abbinare le righe agli ingredienti, correggere un valore, indicare l'ubicazione e approvare. Un valore letto dal file si può correggere (sotto il campo c'è scritto "Dal file XML: cambialo solo se il fornitore ha sbagliato"); l'app tiene traccia delle correzioni.

Se il fornitore non è ancora nell'elenco, il controllo mostra "Fornitore nuovo" con il nome e la partita IVA scritti nel file. Toccate «Crea fornitore»: il modulo è già compilato, lo controllate e confermate. Fino ad allora l'approvazione resta ferma.

Alcune cose del file l'app non le importa e ve le elenca nel riquadro «Nel file c'è anche»: per esempio gli allegati, i riferimenti a bolle e ordini, le righe solo descrittive senza importo, un arrotondamento aggiunto come riga, uno sconto sul totale del documento, il pagamento a rate (vale la scadenza della prima rata). Il riquadro compare solo se c'è qualcosa da dire. Se c'è uno sconto sul totale, il totale può non tornare con le righe: l'approvazione resta ferma finché non correggete il totale.

## Che cosa rifiuta

Ogni file rifiutato si vede subito, con il motivo e che cosa fare, e **non viene salvato niente**: una fattura non si può cancellare, quindi un file sbagliato non deve diventarlo. Si rifiutano:

- le note di credito (TD04): "È una nota di credito (TD04): Costì non la registra ancora. Passala al commercialista.";
- gli altri tipi di documento che non sono una fattura d'acquisto ordinaria o differita: acconti, parcelle, integrazioni e autofatture, fatture semplificate;
- le fatture con ritenuta d'acconto o cassa previdenziale, con scissione dei pagamenti (riguarda solo la Pubblica Amministrazione), in una valuta diversa dall'euro, o con una riga a importo negativo (uno sconto o un reso scritto su una riga a parte);
- le fatture con più di 200 righe e i file con più di 10 fatture;
- i file danneggiati, i file XML che non sono una fattura elettronica, i file firmati che non si riescono ad aprire (in quel caso provate con la versione `.xml` della stessa fattura);
- una fattura intestata a un'altra partita IVA, o emessa dal locale stesso.

Un file che contiene più fatture (un lotto di fatture dello stesso fornitore) diventa una fattura per ciascuna. Se anche una sola è da rifiutare, l'app non salva nessuna delle altre.

Per tutto quello che l'app rifiuta, la strada resta quella di oggi: caricate il PDF o la foto, oppure passate il documento al commercialista.

## La stessa fattura due volte

- **Lo stesso file due volte.** Il secondo viene rifiutato con "Questo file è già stato caricato." e il collegamento «Apri la fattura ›» che porta alla prima. Vale anche per il file firmato e per lo stesso file senza firma. Se la prima fattura era stata rifiutata, potete caricarlo di nuovo.
- **Prima la foto, poi il file XML** (il caso più comune: la foto alla consegna, il file qualche giorno dopo). L'app riconosce che è la stessa fattura (stesso fornitore, stesso numero, stessa data) e scrive "Fattura letta, ma sembra già caricata", con «Apri ›». Nella pagina di controllo, in alto, vedete la copia da foto o PDF e il confronto dei totali ("Importi uguali" oppure i due importi). Con «Usa il file XML al posto del PDF» e poi «Usa il file XML» la copia da foto viene rifiutata (resta in archivio) e la fattura da approvare diventa quella del file, che è la più esatta. Gli abbinamenti già memorizzati per il fornitore valgono anche per le righe del file, se il codice o la descrizione coincidono; quelli fatti a mano sulla foto vanno rifatti dove non coincidono.
- **La foto era già approvata.** Non si sostituisce niente: la fattura del file si rifiuta con «Rifiuta questo file» e il file resta in archivio.
- **Prima il file XML, poi la foto.** La foto risulta un doppione del file: la rifiutate con «Rifiuta questa copia».
- **Non è davvero un doppione.** Con «Non è un doppione» dichiarate che le due fatture sono diverse, come per le foto.

## Il lotto scritto dal fornitore

Le fatture elettroniche non hanno una casella per il lotto e per la scadenza. Alcuni fornitori però li scrivono lo stesso, in un punto libero della riga, con un'etichetta loro ("LOTTO", "LOT", "SCAD"). Quando succede, la riga mostra «Dal fornitore» con l'etichetta scritta nel file e il valore. L'app non interpreta l'etichetta: siete voi a decidere che cosa è.

- Un valore di testo (per esempio "L-DEMO-0001") ha il pulsante «Usa come lotto». Un tocco e il lotto è sulla riga: sparisce «Lotto mancante».
- Una data ha il pulsante «Usa come scadenza».
- Se la riga ha già un lotto diverso, l'app lo mostra e il pulsante diventa «Sostituisci con questo lotto» (o «Sostituisci con questa scadenza»).

Dopo l'approvazione i lotti non si possono più cambiare, come per le fatture da foto. Per vedere dove sono finiti, c'è la guida `docs/guides/tracciabilita.md`.

## Il file firmato (.p7m)

Un file che finisce con `.xml.p7m` è la fattura chiusa in una busta firmata. L'app apre la busta e legge la fattura, ma **non controlla la firma**: lo dice la pagina di controllo con «File firmato (firma non verificata da Costì)». La verifica della firma è un'altra cosa e non fa parte di questa versione.

## Che cosa non fa

- Non riceve le fatture da sola dal sistema fiscale: il file lo caricate voi. L'arrivo automatico è un passo successivo, non ancora previsto.
- Non registra le note di credito e non accetta le righe negative.
- Non sostituisce la conservazione digitale delle fatture, che resta dove è oggi.
- Non legge gli allegati dentro il file.
- Non dice che cosa la legge chieda: per le questioni fiscali vale quello che dice il commercialista.
