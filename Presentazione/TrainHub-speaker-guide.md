# TrainHub — speaker guide

Durata prevista: circa **36 minuti**, lasciando spazio alle domande. Le 33 slide seguono i sei capitoli della relazione; il testo è abbastanza completo da orientare chi guarda, ma durante l’esposizione va sviluppato senza leggerlo parola per parola.

| Slide | Tempo | Punto da sviluppare a voce |
|---:|:---:|---|
| 1 | 0:45 | Presentare corso, progetto e gruppo. Definire TrainHub come un unico ambiente per il rapporto quotidiano tra membro e professionista. |
| 2 | 0:45 | Anticipare il percorso: problema, mercato, ricerca, design, implementazione e risultato finale. |
| 3 | 1:15 | Spiegare che il problema non è l’assenza di strumenti, ma la frammentazione tra workout, nutrizione, messaggi, prenotazioni e accesso. |
| 4 | 1:10 | Delimitare lo scope: quattro attività centrali e due ruoli con esigenze differenti. TrainHub non vuole sostituire un gestionale ERP completo. |
| 5 | 1:00 | Distinguere concorrenti diretti e indiretti e chiarire le dimensioni usate nel confronto. |
| 6 | 1:20 | Commentare la matrice per tendenze, senza leggere ogni cella: le differenze maggiori riguardano nutrizione, comunicazione e strumenti professionali. |
| 7 | 1:00 | Presentare il posizionamento: sufficiente integrazione per eliminare i passaggi tra servizi, ma un’esperienza più focalizzata delle grandi suite. |
| 8 | 1:10 | Descrivere il questionario ramificato e il campione di 81 risposte. Ricordare che i professionisti sono soltanto sette. |
| 9 | 1:00 | Inquadrare il pubblico prevalente: membri giovani e attivi, senza assumere che tutti abbiano la stessa familiarità digitale. |
| 10 | 1:10 | Collegare frequenza di allenamento e strumenti di monitoraggio: un’attività ricorrente richiede inserimenti rapidi e ripetibili. |
| 11 | 1:10 | Evidenziare l’uso di fogli, PDF e messaggistica da parte dei professionisti. Le percentuali sono indicative, non generalizzabili. |
| 12 | 1:00 | Mostrare le tre priorità emerse: workout personalizzato, analisi dei progressi e gestione professionale della dieta. |
| 13 | 1:00 | Spiegare i tre cluster del diagramma di affinità e il passaggio da problemi dispersi a una direzione progettuale comune. |
| 14 | 1:10 | Presentare le quattro personas come casi diversi per età, competenza digitale e responsabilità, non come utenti medi. |
| 15 | 1:15 | Scegliere uno scenario membro e uno professionale per mostrare come contesto e obiettivo producano un requisito d’interazione verificabile. |
| 16 | 1:00 | Riassumere i principi che guidano il design: velocità, centralità del cliente, ruoli distinti e conservazione del contesto. |
| 17 | 1:10 | Illustrare le destinazioni principali del membro e indicare i rami secondari senza seguire ogni collegamento. |
| 18 | 1:10 | Mostrare come l’area professionale ruoti attorno a clienti e calendario, con chat, notifiche e scanner disponibili trasversalmente. |
| 19 | 1:00 | Spiegare cosa è stato verificato su carta: profondità dei flussi, posizione delle azioni e ricorrenza dei componenti, prima dello stile visuale. |
| 20 | 1:00 | Descrivere gerarchia, colori semantici, componenti e continuità tra Figma e tema Material UI. |
| 21 | 1:00 | Percorrere rapidamente l’esperienza membro dalla Home ai servizi del profilo, sottolineando la progressione overview–detail. |
| 22 | 1:30 | Approfondire il flusso centrale: scelta sessione, avvio run, registrazione set, pausa e riepilogo calcolato sul lavoro realmente svolto. |
| 23 | 1:10 | Collegare nutrizione, professionista e badge allo stesso contesto, spiegando anche la presenza del codice manuale come fallback. |
| 24 | 1:10 | Mostrare il passaggio professionale da agenda generale a cliente, piano e progresso, mantenendo visibile l’identità selezionata. |
| 25 | 1:10 | Presentare le deviazioni come raffinamenti emersi dall’implementazione: run ripetibili, piani versionati, editor con conferma e notifiche persistenti. |
| 26 | 1:20 | Spiegare la responsabilità di ogni tecnologia. La UI descrive l’interazione; il database rende effettive le regole decisive. |
| 27 | 1:10 | Illustrare l’organizzazione del codice e la strategia dello stato remoto: query key condivise, invalidazione e ripresa delle mutazioni. |
| 28 | 1:20 | Distinguere piano e run, poi motivare versionamento, Row Level Security, privilegi limitati e operazioni atomiche. |
| 29 | 1:20 | Separare ciò che resta disponibile offline dalle operazioni che richiedono una verifica attuale del server. |
| 30 | 1:20 | Presentare Realtime, notifiche e QR come funzioni migliorative con fallback, non come dipendenze che bloccano l’intera applicazione. |
| 31 | 1:30 | Ripercorrere il workout end-to-end e spiegare come il flusso attraversi routing, cache, database, calcoli derivati e viste di entrambi i ruoli. |
| 32 | 1:00 | Riassumere il risultato e discutere sviluppi futuri concreti, distinguendoli da ciò che è già realizzato. |
| 33 | 0:15 | Ringraziare e aprire alle domande. |

## Indicazioni pratiche

- La slide 22 è il centro funzionale e merita più tempo delle altre.
- Nelle slide 17 e 18 indicare i rami principali delle navigation map senza leggere tutti i nodi.
- Nella slide 11 dichiarare esplicitamente il limite del campione professionale.
- Le slide 26–31 raccontano l’implementazione come conseguenza delle scelte progettuali, non come elenco di tecnologie.
- Per restare vicino ai 30 minuti, accorciare le slide 5, 9, 14, 19, 20 e 25. Per arrivare a 40 minuti, approfondire 6, 10–13, 22 e 26–31.
