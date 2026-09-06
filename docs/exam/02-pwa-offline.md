# PWA e comportamento offline

Il capitolo che il corso valuta esplicitamente. Se la domanda è "fammi vedere
dove la tua app è una PWA", i file da aprire sono tre: `vite.config.js`,
`src/sw.js`, `src/lib/queryClient.js`.

---

## 1. Il manifest

Sta **inline** in `vite.config.js:41-63`, dentro la configurazione di
`vite-plugin-pwa`, non in un file `manifest.json` scritto a mano. Il plugin lo
genera nella build e inserisce il `<link rel="manifest">` nell'HTML.

```js
manifest: {
  name: 'TrainHub', short_name: 'TrainHub',
  description: '…',
  theme_color: '#FE6363', background_color: '#F9FAFB',
  display: 'standalone', orientation: 'portrait',
  start_url: '/', scope: '/', lang: 'en',
  icons: [ 64, 192, 512, + una maskable 512 ],
}
```

Cosa dire di ogni campo se te lo chiede:

- `display: 'standalone'` è ciò che toglie la barra del browser: l'app installata
  si apre in una finestra propria, con la sua icona nel launcher.
- `orientation: 'portrait'`: l'interfaccia è disegnata per una mano sola, non ha
  un layout orizzontale.
- `theme_color` e `background_color` sono gli stessi due valori dei token Figma
  (`#FE6363` brand, `#F9FAFB` sfondo), così icona e splash non divergono
  dall'interfaccia che introducono.
- l'icona `maskable` serve ad Android, che ritaglia l'icona nella forma del
  launcher: senza una versione con margine, il logo verrebbe tagliato.

## 2. Il service worker

Modalità **`injectManifest`**, non `generateSW` (`vite.config.js:37`). La
differenza, ed è la domanda: `generateSW` scrive il service worker per te, e non
c'è un posto pulito dove aggiungere codice. A TrainHub serve, perché lo stesso
file deve contenere anche gli handler `push` e `notificationclick`. Con
`injectManifest` il worker è mio (`src/sw.js`) e il plugin ci inietta solo la
lista dei file da precache, sostituendo `self.__WB_MANIFEST`.

`src/sw.js` è corto, 76 righe, e fa quattro cose:

```js
self.skipWaiting(); clientsClaim()          // il nuovo worker prende subito il controllo
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)        // i file della build
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))
```

L'ultima riga è quella che rende possibile l'avvio offline: è una single page
app, quindi *qualunque* navigazione viene risolta con la shell in cache. Digiti
`/m/workout` senza rete e la pagina si apre lo stesso, poi il router disegna la
schermata e TanStack Query tira fuori i dati da IndexedDB.

`skipWaiting` + `clientsClaim` vanno insieme a `registerType: 'autoUpdate'`: la
versione nuova sostituisce la vecchia senza aspettare che tutte le schede si
chiudano.

**Cosa c'è nel precache** (`injectManifest.globPatterns`, riga 75):

```js
globPatterns: ['**/*.{js,css,html}', 'assets/inter-latin*.woff2']
```

cioè `index.html`, tutti i chunk JS, il CSS, e **solo i sottoinsiemi latini** del
font. Il commento spiega perché non si prende tutto: Inter è distribuito in sette
sottoinsiemi unicode, il browser normalmente scarica solo quelli che gli servono,
e mettere tutto in precache annullerebbe quel vantaggio scaricando in anticipo
anche cirillico, greco e vietnamita. Le icone entrano da `includeAssets` e da
`manifest.icons`, quindi non vanno ripetute qui.

**Cosa non c'è, di proposito** (`sw.js:18-22`): nessuna regola di runtime caching
per le risposte di Supabase. Due motivi, entrambi buoni da citare: quei dati sono
già persistiti da TanStack Query, quindi una seconda copia aggiungerebbe solo
disallineamento; e una cache condivisa che conserva i dati di un utente dopo il
logout, su un telefono che qualcun altro può usare, è una fuga di dati.

## 3. Il livello dati: `offlineFirst`

`src/lib/queryClient.js` imposta i default per ogni query dell'app:

```js
gcTime: ONE_WEEK,          // non più corto della durata della cache persistita
staleTime: 1000 * 30,
retry: (failureCount) => navigator.onLine && failureCount < 2,
refetchOnWindowFocus: false,
networkMode: 'offlineFirst',
```

- **`networkMode: 'offlineFirst'`**: serve prima il dato in cache, poi eventualmente
  va in rete. Il contrario del default, che offline fallisce subito.
- **`retry` condizionato a `navigator.onLine`**: se ritentassi mentre sono offline
  la query resterebbe in pausa, `isPending` non diventerebbe mai falso e nessuna
  schermata potrebbe mostrare il proprio stato offline. Quando il browser sa già
  che non c'è rete, si fallisce subito; ci penserà `refetchOnReconnect`.
- **`gcTime` non più corto di `CACHE_MAX_AGE`**: se una query inattiva viene
  sfrattata dalla memoria prima, non può più essere persistita, e la persistenza
  smette di funzionare senza dire niente.

### La conseguenza sulle schermate

Se un refetch fallisce ma il dato buono è ancora lì, **non è un errore da
mostrare**. Per questo ogni schermata scrive:

```js
if (isError && data === undefined) return <ErrorState … />
```

e non `if (isError)`. Lo trovi identico in `LiveSessionScreen.jsx:79`,
`ExerciseDetailScreen.jsx:300`, `MemberHomeScreen.jsx:84`. È la regola numero uno
del progetto.

## 4. La persistenza su IndexedDB

```js
const indexedDbPersister = createAsyncStoragePersister({
  storage: { getItem: get, setItem: set, removeItem: del },  // idb-keyval
  key: 'trainhub-query-cache',
  throttleTime: 1000,
})
export const persister = createMigratingPersister(indexedDbPersister)
```

È il persister **async** (`@tanstack/query-async-storage-persister`), perché
IndexedDB è asincrono; quello sync serve per `localStorage`. `idb-keyval` è una
libreria minima che dà `get`/`set`/`del` su IndexedDB, così il persister non deve
sapere niente di transazioni.

In `App.jsx` il provider riceve `maxAge` (una settimana), il `buster` e due
filtri:

```js
shouldDehydrateMutation: (m) => m.state.status === 'pending',
shouldDehydrateQuery:    (q) => q.state.data !== undefined,
```

Entrambi sono **più larghi del default**, e i commenti dicono perché:

- sulle mutation, il default persiste solo quelle già marcate `isPaused`; c'è una
  finestra in cui la fetch è ancora appesa e la mutation non è ancora "in pausa",
  e un reload dentro quella finestra perderebbe la scrittura tenendo però la riga
  ottimistica sullo schermo;
- sulle query, il default persiste solo quelle in stato `success`; ma offline
  ogni query fa un refetch, fallisce e passa in `error` pur tenendo i dati in
  memoria. Col default, la seconda riapertura offline mostrerebbe un errore su
  ogni schermata.

## 5. La coda delle scritture

Tre ingredienti, e vanno raccontati insieme.

**1. Le mutation si mettono in pausa invece di fallire.** `networkMode:
'offlineFirst'` vale anche per le mutation (`queryClient.js:33`).

**2. La funzione da eseguire è registrata al centro, non al punto di chiamata.**
`src/data/mutations.js` associa ogni chiave alla sua `mutationFn` con
`setMutationDefaults`. Il punto di chiamata scrive solo
`useMutation({ mutationKey: mutationKeys.logSet })`, senza `mutationFn`
(`ExerciseDetailScreen.jsx:94-99`). Motivo: il persister salva la mutation **per
chiave**; dopo un reload ritrova la funzione solo attraverso quella
registrazione. Una mutation ripristinata senza default viene scartata in silenzio.

Il file si difende da solo: in fondo (`mutations.js:432-437`) c'è un controllo che
lancia `Missing durable mutation defaults: …` se qualcuno aggiunge una chiave e
si dimentica di registrarla.

**3. L'ordine, quando conta, è imposto da uno `scope`.**

```js
const runScope = { id: 'workoutRun' }   // logSet, startRun, pause, resume, endRun, saveRunNote
```

`set_logs.run_id` è una foreign key: la run deve arrivare prima delle sue serie.
`resumePausedMutations` rigioca in parallelo se non c'è uno scope, quindi senza
questo il riaggancio dopo un allenamento in seminterrato fallirebbe sul vincolo e
le serie andrebbero perse. Stesso ragionamento per lo scope `chat` (l'ordine dei
messaggi *è* il contenuto) e per `appointmentStatus` (due cambi di stato
rigiocati in parallelo possono atterrare al contrario).

**Il quarto ingrediente implicito: l'idempotenza.** Ogni scrittura ripetibile
porta un id generato dal client (`createUuid()`, sempre dentro un event handler
perché `react-hooks/purity` lo vieta nel corpo del render). Un replay atterra
sulla stessa riga invece di crearne una seconda; la RPC confronta anche il
contenuto e rifiuta lo stesso id con dati diversi.

E il timestamp è del client per lo stesso motivo (`workouts.js:120-122`): una
scrittura può restare in pausa per ore, e il `now()` del database registrerebbe
una serie fatta alle 18:00 come fatta alle 23:00.

## 6. Le scritture che NON vanno in coda

Non tutto ha senso rigiocarlo. Restano fuori, deliberatamente:

| Scrittura | Perché no |
|---|---|
| `mintCheckinToken` | un token che vive 60 secondi, rigiocato un'ora dopo, non vale niente (`data/checkin.js:28-31`) |
| `redeemCheckinToken` | registrerebbe un ingresso che non è mai avvenuto |
| `savePushSubscription` | ha senso solo adesso, con il browser che sta chiedendo il permesso |
| `uploadAvatar` / `clearAvatar` | `networkMode: 'always'`: portano un `Blob`, e il persister serializza con `JSON.stringify`, che di un Blob lascia `{}`. Un replay sovrascriverebbe l'immagine con il nulla (`mutations.js:356-367`) |

Offline queste falliscono subito e l'interfaccia dice che serve la connessione.

## 7. La migrazione della cache fra versioni

`src/lib/cacheMigration.js`. Il problema: cambiare la funzione di una mutation
persistita senza cambiare il contratto salvato significa rigiocare le variabili
di ieri dentro il codice di oggi. La patch 015 ha cambiato di proposito diversi
contratti di scrittura.

Soluzione: la cache porta una versione esplicita
(`QUERY_CACHE_BUSTER = 'trainhub-security-v4'`) e, se la versione trovata è
diversa, le scritture in coda vengono ispezionate **prima** che TanStack Query le
ripristini. Sopravvivono solo quelle in una whitelist di quattro operazioni il
cui contratto non è cambiato; tutto il resto viene scartato (fail-closed) e
l'utente viene avvisato una volta sola tramite `OfflineBanner`.

Il wrapper `createMigratingPersister` fa la migrazione dentro `restoreClient`,
cioè prima che il provider possa riprendere qualunque mutation.

## 8. HTTPS, installabilità, e il dominio fisso

Un browser propone l'installazione solo da un'origine sicura. In sviluppo e in
demo l'app passa da un tunnel HTTPS ngrok, con un **dominio statico** e non
quello casuale che viene generato a ogni riavvio. Il motivo non è la comodità:

- una subscription Web Push è legata all'origine che l'ha creata;
- Supabase Auth confronta l'indirizzo di redirect con una lista.

Un'origine che cambia invaliderebbe ogni device registrato e romperebbe il link
di recupero password ogni volta che il tunnel si rialza.

In `vite.config.js:15` i due host del tunnel sono dichiarati in
`server.allowedHosts` e `preview.allowedHosts`. Vite rifiuta gli Host che non
conosce, ed è una protezione contro il DNS rebinding, non un fastidio.

**Il service worker non esiste in `dev`** (`devOptions: { enabled: false }`). Un
server che ricarica a ogni battuta e una cache che risponde prima della rete sono
difficili da conciliare. Quindi installabilità, avvio offline e push si provano
sempre con:

```bash
npm run build && npm run preview
```

che è anche la configurazione usata il giorno della presentazione.
