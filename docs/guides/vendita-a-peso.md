# Vendita a peso: guida

Per chi gestisce l'app per il locale (DigiAlto, titolare o amministratore). Spiega come mettere un piatto "a peso", che cosa significa la porzione di riferimento, il limite "Peso massimo per riga", che cosa succede a scorte e costo e come correggere un peso. La progettazione è in `docs/plans/2026-11-11-p2-0b-sell-by-weight.md` e in `docs/adr/adr-035-sell-by-weight.md`. I nomi delle schermate sono quelli dell'app.

Gli esempi usano piatti e prezzi inventati ("Bistecca a peso (demo)"). I piatti veri, i prezzi per etto e le porzioni di riferimento li inserisce il titolare o lo chef: non sono scritti in questa guida.

## Mettere un piatto a peso

Solo titolare e amministratore possono farlo; cameriere e cuoco no.

1. Apri "Menu" e premi "Modifica" sul piatto (o crea un "Nuovo piatto").
2. Attiva "Venduto a peso".
3. Scrivi il "Prezzo per etto (100 g)": è il prezzo di 100 grammi, per esempio 4,25. Il numero che scrivi è quello che il cameriere vedrà ("4,25 € / 100 g").
4. Scrivi la "Porzione di riferimento (g)" (vedi sotto) e premi "Salva".

Senza porzione di riferimento il salvataggio è rifiutato: l'app non saprebbe quante scorte usa un piatto a peso. Cambiando un piatto da porzione a peso (o il contrario) serve sempre il nuovo prezzo nella stessa richiesta, così lo storico dei prezzi dice che cosa significava ogni numero. Se il piatto è "in spinta" (proposto con un prezzo speciale) l'unità non si cambia: l'app dice "Ferma la spinta prima di cambiare l'unità di prezzo." e basta fermare la spinta e riprovare. Un piatto passa di rado dal prezzo fisso al peso, per questo non c'è altro nell'app.

Il prezzo di una riga è il prezzo per etto per i grammi diviso 100, arrotondato una sola volta al centesimo (per eccesso a metà), dal database. Come l'arrotondamento e lo scontrino del registratore di cassa vadano d'accordo lo decide il commercialista; l'app non è un documento fiscale e lo scontrino fiscale è fuori dall'app.

## La porzione di riferimento

È il numero di grammi che corrisponde a una porzione della ricetta del piatto. Serve all'app per sapere quanto prendere dalle scorte: una riga di 1.200 g con una porzione di riferimento di 400 g usa 3 porzioni.

- Chiedi allo chef quanti grammi sono "una porzione" e se sono pesati prima o dopo la cottura. Deve essere lo stesso peso che il cameriere scrive in sala: se il cliente ordina "a crudo", scrivi grammi a crudo.
- Se la porzione di riferimento cambia, l'app scrive una nuova riga di condizioni da quel momento. Le righe già inserite e i report dei giorni passati non cambiano.
- Una porzione sbagliata fa scaricare e costare ogni piatto a peso nella frazione sbagliata: controlla gli avvisi di scorte negative e il conteggio.

## Peso massimo per riga

In "Tavoli, impostazioni", scheda "Peso massimo per riga", si decide il peso più alto che una riga può avere. Finché non lo cambi è 3.000 g ("predefinito 3.000 g"); puoi scegliere da 500 a 10.000 g, a passi di 10. Il minimo (50 g) e il passo (10 g) non si cambiano.

- Per tornare al valore predefinito premi "Ripristina".
- Il nuovo limite vale per i pesi inseriti da ora in poi. Le righe già inserite restano come sono, anche se superano il nuovo limite.
- In sala, da 3 volte la porzione di riferimento in su, il telefono chiede "Confermi 1.200 g?" prima di aggiungere: serve a fermare un 1.500 scritto al posto di 150.

## Scorte e costo

- Quando la riga va in cucina ("Invia"), le scorte scendono di peso ÷ porzione di riferimento, a partire dai lotti che scadono prima (FEFO). Il costo del piatto è fissato in quel momento sulla stessa frazione.
- Il cuoco vede il piatto con il suo peso ("Bistecca a peso (demo) 1,2 kg"), senza prezzi.
- Un report conta un piatto per riga e mostra anche il peso: in "Report", nei piatti, "Peso venduto" e "media per piatto"; nell'esportazione `peso_venduto_g` e `peso_medio_g`.
- Lo storno di una riga già inviata riporta la stessa frazione agli scarti, come per gli altri piatti.

## Correggere un peso

- **Prima di inviare in cucina:** tocca la riga, "Cambia il peso", scrivi il nuovo peso e "Salva". Il prezzo della riga segue il peso. Oppure "Rimuovi" e riaggiungi.
- **Dopo l'invio:** la riga non si modifica. Si usa "Storna" (con il motivo) e si aggiunge una riga nuova con il peso giusto. Non c'è una "ripesatura" in cucina.
- Se il telefono è senza rete la riga resta "In coda" e mostra il peso e il prezzo per etto; l'importo compare quando il server l'ha ricevuta.

## Dal segnaposto alla vendita a peso

Finché la vendita a peso non è attiva, i piatti a peso si vendono come piatti normali con una porzione e un prezzo segnaposto concordati con lo chef. Al passaggio:

1. Disattiva ogni piatto segnaposto e crea il piatto a peso, oppure porta lo stesso piatto a peso con un nuovo prezzo (nuova riga di prezzo).
2. Le righe e i report già registrati non vengono riscritti: per quei piatti i report prima e dopo il passaggio sono diversi, ed è normale.
3. Passa a peso solo dopo l'aggiornamento dell'app, quando i telefoni hanno la versione nuova: un telefono vecchio che aggiunge un piatto a peso senza peso riceve "Inserisci il peso." e la riga non viene creata.
