# Banco domande e trappole

Due parti. La prima sono le domande prevedibili con la risposta da dire a voce e
il file da citare. La seconda sono i punti in cui il codice fa una cosa non
ovvia: sono quelli su cui una domanda ti mette in difficoltà se non li hai
preparati, e quelli su cui fai una figura ottima se li hai preparati.

---

# Parte 1 — Banco domande

## A. Definizioni

**Che cos'è una PWA?**
Un'applicazione web che si installa e si comporta come una nativa: ha un manifest
che la descrive, un service worker che le permette di funzionare senza rete, e
gira su HTTPS. Non passa da uno store e non ha un binario.

**Che cos'è un service worker?**
Uno script che gira in un thread separato, senza accesso al DOM, fra la pagina e
la rete. Intercetta le richieste, gestisce le cache e sopravvive alla chiusura
della pagina: quando arriva un push è l'unica cosa viva dell'applicazione.
Il nostro è `src/sw.js`, 76 righe scritte a mano.

**Che cos'è il manifest?**
Il documento d'identità dell'app: nome, nome breve, descrizione, icone, colori,
orientamento, modalità di visualizzazione. È ciò che rende possibile
l'installazione. Il nostro è inline in `vite.config.js:41`.

**Cosa vuol dire `display: 'standalone'`?**
Che l'app installata si apre in una finestra propria, senza barra degli indirizzi.

**Che cos'è IndexedDB e perché non `localStorage`?**
Un database chiave-valore asincrono nel browser, con capienza molto maggiore e
capace di conservare oggetti strutturati. `localStorage` è sincrono, è limitato a
stringhe e a pochi megabyte. Noi usiamo IndexedDB per la cache delle query
(tramite `idb-keyval`) e `localStorage` solo per due sciocchezze: il ruolo usato a
freddo per scegliere il layout e il mute del rest timer.

**Che cos'è VAPID?**
La coppia di chiavi con cui il server firma i messaggi push, così il push service
sa chi li manda. La pubblica sta nel client (`VITE_VAPID_PUBLIC_KEY`), la privata
solo nella Edge Function.

**Che cos'è la Row Level Security?**
Un filtro che Postgres applica riga per riga in base a una condizione che può
usare l'identità del chiamante. In pratica: la stessa query, fatta da due utenti
diversi, restituisce insiemi di righe diversi.

## B. Meccanismi

**Come fa l'app a funzionare offline?**
Su due livelli separati. Il service worker precacha la shell, cioè HTML, JS, CSS,
icone e font, e risolve ogni navigazione con `index.html`: l'app si apre. I dati
sono un'altra cosa: TanStack Query persiste i risultati delle query su IndexedDB
per una settimana e serve prima la cache e poi la rete (`networkMode:
'offlineFirst'`). Le scritture non falliscono, si mettono in pausa, vengono
salvate con la cache e rigiocate al riaggancio.

**Cosa succede se registro una serie senza rete?**
Riga in cache subito (aggiornamento ottimistico), mutation in pausa, salvata su
IndexedDB. Al ritorno della connessione viene rigiocata, in ordine grazie allo
scope, e siccome porta un id generato dal client il server non crea un doppione.

**Come sai quali dati mostrare quando sei offline?**
Le query hanno il dato in cache. La regola è che una schermata mostra un errore
solo se `data === undefined`, cioè se il dato non è mai arrivato; un refetch
fallito su dati buoni non è una condizione d'errore.

**Come comunicano il membro e il professionista?**
Non comunicano fra client: leggono le stesse righe. Chi può leggerle lo decide il
predicato `owns_member()` nelle policy RLS. Sopra questo, per chat e notifiche,
c'è Supabase Realtime, che però fa solo da innesco: l'evento invalida la query, e
la query resta la fonte di verità.

**Come gestisci l'autenticazione?**
Supabase Auth. `AuthProvider` ripristina la sessione con `getSession()` (che legge
da local storage, quindi funziona a freddo anche offline), ascolta
`onAuthStateChange`, carica il profilo e lo espone via context. Il token viaggia
in ogni richiesta ed è quello che `auth.uid()` legge dentro le policy.

**Come proteggi le rotte?**
`AppLayout` riceve `requiredRole` e decide: spinner finché non sa, redirect a
`/login` se non c'è utente, redirect all'altra home se il ruolo non corrisponde.
Ma va detto subito che è comodità, non sicurezza: chi manipolasse il client
otterrebbe comunque zero righe, perché il filtro vero è nel database.

**Come fai il code splitting?**
`lazy` per rotta in `routes/index.jsx`: ogni schermata è un `import()` dinamico,
quindi un chunk separato che Vite produce in build.

**Come gestisci lo stato?**
Sessione nel context di `AuthProvider`, stato remoto in TanStack Query, stato di
schermata in `useState`. Niente store globale, perché tolta la sessione tutto ciò
che resta è dato del server.

## C. Scelte progettuali

**Perché una PWA e non un'app nativa?**
È il tema del corso, e per questo prodotto regge: un'unica base di codice per
Android e iOS, distribuzione senza store, aggiornamento immediato. I limiti li
conosciamo e li abbiamo incontrati davvero, e sono nel file sul rest timer:
niente notifiche locali programmate, vibrazione assente su iOS, timer di
background congelati.

**Perché non TypeScript?**
Una scelta di scopo. Il progetto è di due persone su poche settimane, e la
disciplina l'abbiamo messa altrove: ESLint con le regole di `react-hooks`,
diciassette self-check sulla logica pura, e soprattutto i vincoli nel database,
che sono l'unico posto dove non possono essere aggirati. Un tipo in JavaScript
non avrebbe impedito nessuno dei difetti che abbiamo effettivamente trovato.

**Perché non Redux?**
Perché non c'era niente da metterci dentro: quasi tutto lo stato dell'app è dato
del server, e TanStack Query lo gestisce già con cache, invalidazione, stato di
caricamento e coda offline.

**Perché Supabase e non un backend scritto da voi?**
Perché dà autenticazione, Postgres, API REST generata, Realtime e funzioni
serverless senza scrivere un server, e soprattutto perché mette la sicurezza nel
posto giusto: le policy stanno accanto ai dati, non in un middleware che si può
dimenticare di chiamare.

**Perché un service worker scritto a mano invece che generato?**
Perché deve contenere anche gli handler `push` e `notificationclick`, e in un
worker generato non c'è un posto pulito dove metterli.

**Perché due alberi di rotte invece di uno con i permessi?**
Perché sono due prodotti diversi sopra gli stessi dati. Il prefisso dice già chi
sei, il guard diventa una riga, e nessuna schermata deve chiedersi "e se invece
fosse un professionista".

**Perché lo stato della sessione è calcolato e non memorizzato?**
Perché una scheda si ripete ogni settimana. Una colonna di stato andrebbe
azzerata da qualcuno il lunedì, e quel qualcuno sarebbe un job schedulato che
può non girare. Calcolarlo dalle run della settimana corrente è sempre giusto,
senza che nessuno faccia niente.

**Perché ogni scrittura passa da una funzione SQL?**
Perché diverse scritture sono più righe che devono esistere insieme, e perché
alcuni valori, come i punti, non possono essere decisi dal client. Dentro una
funzione plpgsql sono una transazione, e il client non può che chiedere.

## D. Domande sul processo

**Come avete testato?**
Non c'è un test runner, ed è una scelta dichiarata. La logica pura, quella dove
un errore è silenzioso, ha diciassette script con `assert` che girano con `node`
e coprono date e settimane, il cronometro, i riepiloghi e i punti, le bozze di
piano, gli esiti della scansione, lo stato dell'abbonamento, la codifica delle
chiavi push, la griglia del calendario e la migrazione della cache. Poi lint e
build sono entrambi obbligatori, il database ha uno script di verifica e due
sonde di sicurezza, e ogni funzionalità è stata provata a mano su telefono vero
con entrambi i ruoli.

**Perché lint non basta?**
Perché ESLint non risolve i percorsi dei moduli. Un'icona MUI che la libreria
installata non esporta passa il lint e rompe la build. È successo.

**Qual è la parte di cui siete più soddisfatti?**
Il fatto che un allenamento registrato senza rete arrivi al server intero,
nell'ordine giusto e senza duplicati. Sono tre meccanismi che devono funzionare
insieme: id generati dal client, funzioni registrate al centro, scope sull'ordine.

**Cosa non funziona / cosa rifareste?**
La scansione del badge verifica che chi scansiona sia un professionista, non che
il membro sia un suo cliente. Non c'è una schermata di storico per i piani
sostituiti, che pure il database conserva. I progressi esistono solo lato
professionista. E l'app è servita da un tunnel, non da un deploy vero.

---

# Parte 2 — Trappole

Nove punti in cui il codice fa una cosa che sembra sbagliata e non lo è.
Per ognuno: cosa vedi, perché è così, e la risposta in una frase.

### 1. `isError` non è la condizione d'errore

**Cosa vedi:** `if (isError && data === undefined) return <ErrorState … />`

**Perché:** con `networkMode: 'offlineFirst'` un refetch fallito lascia in cache i
dati buoni. Una schermata d'errore sopra dati usabili dice all'utente offline che
l'app è rotta, mentre sta facendo esattamente il mestiere per cui è stata
costruita.

**In una frase:** una richiesta fallita non è un dato assente.

### 2. Solo le letture ritentano

**Cosa vedi:** `.retry(navigator.onLine)` su ogni funzione di lettura in `data/`,
e su nessuna scrittura.

**Perché:** postgrest ritenta di suo tre volte con backoff 1/2/4 secondi. Quando il
browser sa già di essere offline, quei sette secondi sono solo schermo vuoto.
Le scritture invece non devono ritentare: devono mettersi in pausa ed essere
rigiocate dopo, ed è un meccanismo diverso.

**In una frase:** le letture falliscono in fretta, le scritture aspettano.

### 3. Le mutation hanno uno `scope`

**Cosa vedi:** `scope: { id: 'workoutRun' }` su sei mutation diverse.

**Perché:** `resumePausedMutations` rigioca in parallelo. `set_logs.run_id` è una
foreign key, quindi una serie che arriva prima della sua run viola il vincolo e va
persa. Lo scope serializza il replay.

**In una frase:** dove l'ordine è parte del significato, lo scope lo impone.

### 4. La funzione della mutation non sta dove la si chiama

**Cosa vedi:** `useMutation({ mutationKey: mutationKeys.logSet })`, senza
`mutationFn`.

**Perché:** il persister salva la mutation **per chiave**; dopo un reload ritrova la
funzione solo attraverso `setMutationDefaults`. Dichiararla anche al punto di
chiamata creerebbe una seconda fonte di verità che il persister non vede.

E il corollario: **non si scrive `onSettled` nel `useMutation` del punto di
chiamata**, perché le opzioni locali vengono spalmate per ultime e
sostituirebbero l'handler registrato, facendo sparire le invalidazioni online
mentre continuano a funzionare sul replay.

**In una frase:** la scrittura deve poter essere ritrovata da sola dopo un reload.

### 5. `position` è un indice della bozza, e può esserlo solo perché il piano si scrive intero

**Cosa vedi:** in `features/workout/contracts.js:34` la posizione è `index + 1`,
cioè semplicemente il posto che la sessione occupa nella bozza.

**Perché è lecito:** perché non si aggiunge mai una sessione a un piano che esiste
già. Un piano si compone in locale e si scrive tutto insieme, quindi le posizioni
partono sempre da uno su una lista completa.

**La trappola che questo evita:** ci sono quattro vincoli `unique (parent,
position)` nello schema, uno per sessioni, esercizi, day type e pasti. Se si
aggiungesse in modo incrementale, la posizione andrebbe calcolata come
`max(posizioni) + 1` e **non** come `length + 1`: i due valori coincidono solo
finché le posizioni sono contigue, quindi la prima cancellazione li fa divergere e
la scrittura successiva collide. È una delle ragioni per cui l'aggiunta
incrementale è stata tolta e sostituita dal piano sostitutivo.

**In una frase:** contare gli elementi non è lo stesso che leggere l'ultima
posizione usata, ed è per questo che il piano si scrive intero.

### 6. Le date non si costruiscono da una stringa

**Cosa vedi:** `new Date(year, month - 1, day)` invece di `new Date('2026-03-15')`,
e `daysBefore()` invece di una sottrazione in millisecondi.

**Perché:** `new Date('YYYY-MM-DD')` è mezzanotte **UTC**, quindi a ovest di
Greenwich rappresenta il giorno prima: è la differenza fra azzerare la scheda il
lunedì e azzerarla la domenica sera. E sottrarre `n * 86_400_000` sbaglia
attraverso il cambio dell'ora legale, perché un giorno all'anno dura 23 ore e un
altro 25.

**In una frase:** calcola nel fuso che intendi, sempre.

### 7. Il tempo trascorso non è un contatore

**Cosa vedi:** `elapsedMs = now - startedAt - pausedTotal`, e un `setInterval` che
serve solo a ridisegnare.

**Perché:** ogni browser rallenta gli intervalli in una scheda in background, e iOS
li congela del tutto. Un contatore incrementato a mano perderebbe i minuti in cui
il telefono è in tasca, cioè quasi tutto l'allenamento. Con i timestamp, un tick
saltato non costa niente.

**In una frase:** lo stato è quando le cose sono successe, non quante volte ho
contato.

### 8. Il GRANT viene prima della policy

**Cosa vedi:** `patches/006-restore-public-grants.sql`.

**Perché:** Postgres controlla il privilegio sulla tabella prima di valutare
qualsiasi policy. Una tabella con policy perfette e senza grant risponde
`42501 permission denied` a tutti, e sembra un problema di RLS.

E il rovescio: una policy la cui condizione **non nomina mai `auth.uid()`** è
pubblica per chiunque abbia la chiave del bundle. La fase 0 ne ha spedita una.

**In una frase:** RLS è il confine, ma non è il primo cancello.

### 9. `verify.sql` non può sostituire la sonda anonima

**Cosa vedi:** tre strumenti di verifica invece di uno.

**Perché:** `verify.sql` gira con i privilegi del dashboard, che **bypassano RLS**.
Può dimostrare che una policy esiste, non che sia corretta dal punto di vista
dell'app. `probe-rls.mjs` fa la domanda dell'attaccante, con in mano solo la chiave
pubblica; `probe-security.mjs` fa quella opposta, entrando come i due account demo
per scoprire una policy troppo stretta.

**In una frase:** un controllo che gira con i privilegi sbagliati non può vedere il
problema che stai cercando.

---

## Tre risposte oneste che valgono più di un'invenzione

- "Quel pezzo non l'ho scritto io, ma so cosa fa e come si collega al resto."
- "Non lo ricordo a memoria, ma so dove sta: è in `src/…`."
- "Questa cosa il progetto non la fa, ed è una scelta dichiarata in relazione."
