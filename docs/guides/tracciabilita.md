# Tracciabilità: guida

Per chi gestisce l'app per il locale (DigiAlto, titolare, amministratore e cuoco). Spiega come ritrovare una consegna dal codice del lotto, che cosa significano «Lotto senza codice» e «Senza lotto», come leggere «Com'è andata» in «Da spingere» e che cosa vede il cuoco. La progettazione è in `docs/plans/2026-11-14-p2-2-trace-sell-through.md` e in `docs/adr/adr-043-trace-and-sell-through-reads.md`. I nomi delle schermate sono quelli dell'app.

Gli esempi usano nomi inventati ("Farina Demo", "Lasagne Demo", lotto "L-DEMO-0001"). Questa guida non dice che cosa la legge chieda a un locale: per i doveri di rintracciabilità e per i registri vale quello che dice il vostro consulente HACCP. L'app tiene il filo dei dati che le inserite, niente di più.

## Trovare un lotto

Aprite «Tracciabilità» nel menu Cucina (titolare, amministratore e cuoco; il cameriere non la vede).

1. Nella scheda «Da un lotto» scrivete il «Codice lotto». Basta l'inizio del codice, anche in minuscolo: "l-demo" trova "L-DEMO-0001".
2. Premete «Cerca». Ogni riga è una consegna: il codice, l'ingrediente, il fornitore e il giorno della consegna.
3. Toccate la riga. La pagina del lotto dice che cos'era, quanto ne è arrivato, dove è andato (in produzione, nei piatti, scartato) e quanto ne resta.
4. Più in basso trovate i "Lotti di produzione" fatti con quel lotto (ogni riga porta alla produzione), i «Piatti serviti» giorno per giorno con l'ora del primo e dell'ultimo, e gli «Annullati dopo l'invio».

Se non avete il codice, aprite «Cerca per ingrediente o fornitore» e scegliete l'ingrediente, il fornitore e le date. Dal lotto potete passare alla produzione e da questa ai piatti serviti. Il titolare e l'amministratore vedono anche la fattura e l'«Articolo» (il codice del fornitore e la descrizione scritta in fattura); il cuoco no, perché sono dati di acquisto.

Per risalire da un piatto, aprite la scheda «Da un piatto servito», scegliete il «Giorno» (e, per titolare e amministratore, il piatto) e premete «Cerca». La pagina del piatto dice da quali preparazioni è uscito e da quali lotti e fornitori vengono. Il tavolo è indicato con il suo nome, mai con il nome del cliente.

## Che cosa significa quando manca qualcosa

L'app non indovina mai: se non sa, lo scrive.

- **«Lotto senza codice»:** la consegna è stata registrata ma il fornitore non ha indicato il lotto, o nessuno l'ha scritto prima di approvare la fattura. Resta il fornitore, la fattura e il giorno. Il codice non si può aggiungere dopo l'approvazione, in questa versione: il registro delle scorte non si modifica.
- **«Senza lotto»:** in una produzione, una parte dell'ingrediente è stata presa quando a magazzino ne risultava zero, quindi l'app non sa da quale consegna veniva. Nella pagina del lotto, la frase "Da verificare a mano" dice quante produzioni dello stesso ingrediente hanno usato scorta senza lotto dopo la consegna: va controllato con le vostre carte.
- **«Alcuni dati mancano:»** è il riquadro che raccoglie queste due situazioni. La rintracciabilità è completa quanto lo sono i lotti inseriti.

## Il lotto in fattura

Quando controllate una fattura, ogni riga di magazzino senza lotto ha il segno «Lotto mancante». Sopra «Approva fattura» l'app scrive quante righe sono senza lotto e vi propone «Mostra la prima», che apre la riga e porta il cursore sul campo «Lotto»: copiate il codice dall'etichetta della confezione, se c'è. Potete sempre approvare lo stesso: il lotto è un promemoria, non un obbligo. Dopo l'approvazione non si può più aggiungere.

Nella pagina «Tracciabilità» la scheda «Lotti registrati» dice quante consegne degli ultimi 30 giorni hanno il lotto, e per fornitore quali ne hanno di meno: serve a capire con quali fornitori conviene chiederlo.

## «Com'è andata» in «Da spingere»

Sotto la lista «Da spingere» c'è «Com'è andata». Si apre su ieri; con «Giorno precedente» o con il campo «Giorno» scegliete un altro giorno passato. «Oggi (in corso)» mostra i numeri di adesso.

Per ogni piatto messo in evidenza nel giorno trovate:

- **quanti piatti sono stati venduti mentre era in evidenza** (non contano le righe annullate), e la fascia oraria della spinta; titolare e amministratore vedono anche il "Prezzo del giorno" se l'avete impostato;
- **per ogni preparato che era in scadenza all'avvio** (scadenza entro 24 ore): quante porzioni c'erano, quante ne sono state vendute (con la percentuale), scartate e rimaste, e "scartate dopo" quelle buttate dopo la fine della spinta. "altro" sono i conteggi e i pasti del personale che hanno mosso la scorta;
- se non c'era nessun preparato in scadenza all'avvio, la frase «Nessun lotto in scadenza all'avvio della spinta.».

Attenzione: le porzioni vendute del preparato comprendono anche gli altri piatti che lo usano, non solo quello messo in evidenza (c'è la nota sotto l'elenco). Due piatti in evidenza con lo stesso preparato mostrano la stessa scorta: i numeri non si sommano.

Il giorno è il giorno di lavoro dell'app, che finisce alle 02:00: un piatto inviato a mezzanotte e mezza conta sul giorno prima.

## Che cosa vede il cuoco

- La «Tracciabilità» senza prezzi, senza fattura e senza «Articolo».
- «Com'è andata» con i conteggi ma senza il "Prezzo del giorno".
- In «Produzione», sotto la previsione, «Prenotati (confermati)»: per Pranzo e Cena quanti coperti e quante prenotazioni sono confermati nel giorno scelto. Sono solo numeri: non compaiono nomi, telefoni o e-mail, e le richieste ancora da confermare non sono contate.

Il cameriere non vede la tracciabilità né «Com'è andata»; vede, come prima, i coperti prenotati nelle prenotazioni.

## Che cosa non fa

Niente etichette, niente codici QR, niente lettore di codici, niente foto delle etichette e niente file per l'ispettore: arriveranno più avanti. I produttori locali e la provenienza dei prodotti (per esempio una denominazione protetta) non sono ancora registrati: l'app mostra solo il fornitore, la fattura e il codice del fornitore.
