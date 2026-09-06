# I file, commentati

Quindici file più due estratti SQL. Sono quelli che ha senso vedere aperti,
perché ognuno è la porta d'ingresso di un argomento del corso.

Struttura fissa per ciascuno: **a cosa serve**, **il commento a blocchi**,
**cosa non fa**, **le domande che invita**.

Indice:

1. [`src/main.jsx` e `src/App.jsx`](#1-srcmainjsx-e-srcappjsx)
2. [`src/routes/index.jsx`](#2-srcroutesindexjsx)
3. [`src/layouts/AppLayout.jsx`](#3-srclayoutsapplayoutjsx)
4. [`src/features/auth/AuthProvider.jsx`](#4-srcfeaturesauthauthproviderjsx)
5. [`src/lib/queryClient.js` e `src/lib/cacheMigration.js`](#5-srclibqueryclientjs-e-srclibcachemigrationjs)
6. [`src/data/mutations.js`](#6-srcdatamutationsjs)
7. [`src/data/workouts.js`](#7-srcdataworkoutsjs)
8. [`src/sw.js`](#8-srcswjs)
9. [`vite.config.js`](#9-viteconfigjs)
10. [`src/theme/index.js`](#10-srcthemeindexjs)
11. [`src/features/workout/LiveSessionScreen.jsx`](#11-srcfeaturesworkoutlivesessionscreenjsx)
12. [`src/features/workout/ExerciseDetailScreen.jsx`](#12-srcfeaturesworkoutexercisedetailscreenjsx)
13. [`src/features/workout/RestTimer.jsx`](#13-srcfeaturesworkoutresttimerjsx)
14. [`src/lib/week.js` e `src/features/workout/timer.js`](#14-srclibweekjs-e-srcfeaturesworkouttimerjs)
15. [`src/features/checkin/ScannerScreen.jsx`](#15-srcfeaturescheckinscannerscreenjsx)
16. [SQL: `supabase/policies.sql`](#16-sql-supabasepoliciessql)
17. [SQL: `close_workout_run_secure`](#17-sql-close_workout_run_secure)

---

## 1. `src/main.jsx` e `src/App.jsx`

**A cosa servono.** `main.jsx` è il punto d'ingresso: monta React e registra il
service worker. `App.jsx` compone i provider nell'ordine giusto.

**Commento a blocchi — `main.jsx` (14 righe).**

```js
import '@fontsource-variable/inter'        // il font entra dal bundle, non da un CDN
import { registerSW } from 'virtual:pwa-register'
registerSW({ immediate: true })
createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
```

- `virtual:pwa-register` è un modulo **virtuale**: non esiste su disco, lo genera
  vite-plugin-pwa in fase di build. `immediate: true` registra il worker subito
  invece di aspettare l'evento `load`.
- `StrictMode` in sviluppo monta ogni componente due volte apposta, per far
  emergere gli effetti che non si puliscono. In produzione non fa niente.
- Il font è importato come pacchetto: è per questo che nel precache ci sono i
  `.woff2` sotto `assets/`.

**Commento a blocchi — `App.jsx` (52 righe).**

Riga 14, prima del componente:

```js
registerMutationDefaults(queryClient)
```

A module scope, e il commento sopra spiega il perché: il
`PersistQueryClientProvider` ripristina la cache e riprende le mutation in pausa
*mentre monta*, cioè prima che qualunque `useEffect` giri. Una mutation ripresa
senza il suo default non ha funzione da eseguire.

Poi l'albero dei provider:

```
ThemeProvider -> CssBaseline -> PersistQueryClientProvider -> AuthProvider -> RouterProvider
```

Le `persistOptions` (righe 22-43) sono la parte interessante:

- `persister` e `maxAge` presi da `queryClient.js`, così non ci sono due copie
  del valore che possono divergere;
- `buster: QUERY_CACHE_BUSTER`, la versione della cache;
- `shouldDehydrateMutation: (m) => m.state.status === 'pending'` invece del
  default `isPaused`, per la finestra in cui la fetch è ancora appesa e la
  mutation non è ancora marcata in pausa;
- `shouldDehydrateQuery: (q) => q.state.data !== undefined` invece del default
  `status === 'success'`, perché offline ogni query fallisce il refetch e passa
  in `error` pur tenendo i dati: col default, la seconda riapertura offline
  mostrerebbe un errore ovunque;
- `onSuccess={() => queryClient.resumePausedMutations()}`: quando il ripristino è
  finito, si rigioca la coda.

**Cosa non fa.** Non c'è nessun `<Suspense>`: l'attesa dei chunk è gestita dal
router. Non c'è nessuno store globale.

**Domande che invita.**
- *Cosa succede se sposti `registerMutationDefaults` dentro un `useEffect`?* Le
  scritture offline salvate prima di un reload vengono perse in silenzio.
- *A cosa serve `StrictMode`?* Doppio mount in sviluppo per scoprire effetti non
  puliti.
- *Perché il persister non sta nel componente?* Perché deve essere lo stesso
  oggetto che usa `AuthProvider` al logout per cancellare la cache.

---

## 2. `src/routes/index.jsx`

**A cosa serve.** Definisce l'intera navigazione: due alberi protetti, uno
pubblico, e i redirect.

**Commento a blocchi (280 righe, ma è quasi tutto ripetizione).**

- Righe 11-19, ramo pubblico: `PublicLayout` (una colonna centrata con il logo),
  tre rotte con `element` diretto. Non sono lazy perché il login è la prima cosa
  che serve.
- Righe 21-25, ramo membro: `path: '/m'`, elemento
  `<AppLayout navItems={memberNav} profileHref="/m/profile" requiredRole="member" />`,
  `errorElement: <RouteErrorScreen />`.
- Ogni figlio ha la stessa forma:

  ```js
  { path: 'workout',
    lazy: async () => ({ Component: (await import('…/WorkoutPlanScreen.jsx')).default }) }
  ```

  È il `lazy` di React Router (non `React.lazy`), che restituisce un oggetto con
  `Component`. Il router aspetta il modulo durante la transizione, quindi non
  serve `Suspense`.
- Righe 36-39 e 44-47: due rotte che sono solo `<Navigate to="/m/workout" replace />`.
  Sono i vecchi indirizzi di schermate che non esistono più.
- Riga 35, commento: `workout/session/new` va dichiarata **prima** di
  `workout/session/:sessionId`, altrimenti "new" verrebbe letto come un id.
- Righe 54-56: il riepilogo è chiavato sulla **run**, non sulla sessione, perché
  la stessa sessione si allena ogni settimana e un riepilogo che sa nominare solo
  la sessione mostrerebbe i numeri di questa settimana sotto l'allenamento della
  scorsa.
- Righe 63-65: il parametro di `workout/exercise/:sessionExerciseId` è un id di
  `session_exercises`, non di `exercises`: la prescrizione (serie, ripetizioni,
  recupero) esiste solo sulla riga di join.
- Righe 152-157: ramo professionista, identico nella forma.
- Righe 221-223: commento onesto sul fatto che l'ordine
  `calendar/availability` prima di `calendar/:appointmentId` è solo leggibilità,
  perché React Router ordina per specificità dei segmenti, non per dichiarazione.
- Righe 276-277: `/` e `*` mandano entrambi a `/m`, dove il guard rimbalza chi
  non deve stare lì.

**Cosa non fa.** Nessun `loader` e nessuna `action` di React Router: i dati li
prende TanStack Query dentro le schermate. Scelta consapevole, così la stessa
query serve la schermata, la cache persistita e l'invalidazione.

**Domande che invita.**
- *Come fai il code splitting?* `lazy` per rotta, un chunk per schermata.
- *Come proteggi le rotte?* `requiredRole` sulla shell, vedi file 3.
- *Perché due alberi e non uno con dei permessi?* Perché sono due prodotti
  diversi sopra gli stessi dati: l'URL dice già chi sei, e il guard è una riga.

---

## 3. `src/layouts/AppLayout.jsx`

**A cosa serve.** È la shell dell'app autenticata: header, banner, contenuto,
mini-player, bottom nav. E il guard.

**Commento a blocchi (235 righe).**

*Righe 27-29, la firma.* Tre props: `navItems`, `profileHref`, `requiredRole`.
L'unica differenza fra l'app del membro e quella del professionista è la prima:
per questo un solo layout serve entrambi.

*Righe 31-42, il contatore delle notifiche.* Una `useQuery` con
`enabled: Boolean(user?.id)` (niente da contare se non c'è nessuno) e
`refetchInterval: 60_000`. Il commento spiega che è un polling perché il badge
deve riflettere messaggi, appuntamenti e piani insieme: nessuno sottoscrive
Realtime su tutte le tabelle che generano notifiche.

*Righe 51-73, il canale Realtime.* Sottoscrizione a `postgres_changes` sugli
INSERT di `notifications` filtrati per `user_id`. Nel callback **non** si usano i
dati dell'evento: si invalida la famiglia `notifications`. Il commento è
esplicito: la query resta la fonte di verità, Realtime è solo l'innesco, e se la
sottoscrizione non arriva mai il polling tiene comunque il badge corretto. La
cleanup fa `supabase.removeChannel(channel)`.

*Righe 77-86, la run aperta.* Altra `useQuery`, abilitata solo per i membri
(`requiredRole === 'member'`), perché un professionista non ha un allenamento
proprio in corso. Da qui esce `showLiveBar`, che nasconde il mini-player quando
sei già sulla schermata live.

*Righe 94-102, l'altezza dell'header.* Un `ResizeObserver` su un elemento tenuto
in `useState` (callback ref) invece che in `useRef`. Il commento dice perché:
la shell monta diversi render dopo il primo, per via dei return anticipati, e un
effetto con dipendenze `[]` non osserverebbe niente.

*Righe 104-113, il tick del cronometro.* Un `setInterval` da un secondo che
**serve solo a forzare un re-render**: il valore trascorso è aritmetica sui
timestamp, quindi un tick saltato dal browser non costa niente. Non parte se non
c'è una run aperta o se è in pausa, e le dipendenze sono primitive (`runId`,
`runPaused`) perché un oggetto nuovo a ogni render smonterebbe e rifarebbe
l'intervallo ogni secondo.

*Righe 119-169, il guard, in ordine.*

```js
if (loading) return <LoadingState />
if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
if (!profile) { …pannello offline oppure "profilo non disponibile"… }
if (profile.role !== requiredRole) return <Navigate to={…} replace />
```

Le tre cose da dire: lo spinner evita di sbalzare su `/login` chi è già loggato
durante un avvio a freddo; `state.from` fa riprendere il viaggio dopo il login;
il pannello sul profilo mancante distingue una rete morta (con Riprova) da un
diniego (con Esci), perché senza il secondo bottone l'utente resterebbe
intrappolato, con ogni rotta che riporta lì.

*Righe 171-233, il layout.* Due blocchi `position: fixed`, uno in alto e uno in
basso, e in mezzo `<main>` con `<Outlet />`. Le altezze passano per due variabili
CSS. Il commento a riga 188 spiega `fixed` invece di `sticky`: una barra sticky
occupa comunque una riga nella colonna flex.

Nel blocco in basso il mini-player e la bottom nav sono nello stesso contenitore
"così non possono mai separarsi quando un allenamento è aperto", e il tempo
mostrato è `elapsedMs(...)` calcolato dai campi della run.

**Cosa non fa.** Non fa fetch dei dati delle schermate: quelle si servono da sole.
Non conosce nessuna rotta specifica, solo i due prefissi per notifiche e scanner.

**Domande che invita.**
- *Dove sta il controllo dei permessi lato client?* Qui, righe 119-169. E si
  aggiunge subito che è comodità, non sicurezza: la sicurezza è RLS.
- *Perché un `ResizeObserver`?* Perché l'header cambia altezza quando compaiono i
  banner, e il contenuto sotto deve riservarsi lo spazio giusto.
- *Cosa succede se `setInterval` viene rallentato in background?* Niente: il
  tempo è ricalcolato dai timestamp, l'intervallo serve solo a ridisegnare.

---

## 4. `src/features/auth/AuthProvider.jsx`

**A cosa serve.** Possiede la sessione Supabase e il profilo, e li espone via
context. Risponde a una sola domanda: *sappiamo già abbastanza per instradare?*

**Commento a blocchi (249 righe).**

*Righe 8-22, le costanti.* `PROFILE_COLUMNS` elenca le colonne lette.
`NO_PROFILE = { forUserId: undefined, data: null, error: null }`: la forma è il
punto. `forUserId` registra **di chi** è il profilo, così la prontezza si
ricalcola dallo stato corrente a ogni render invece di essere memorizzata in un
flag. Il commento racconta il bug che c'era: un flag salvato diventava obsoleto,
l'effetto del profilo girava prima che `getSession()` fosse risolta e dichiarava
"pronto" per un utente che nessuno aveva ancora cercato.

*Riga 22, la copia locale del profilo.* Il ruolo decide quale shell disegnare,
quindi serve **prima** di qualunque query, anche a freddo senza rete: viene
specchiato in `localStorage`. Il commento mette le mani avanti: questa copia
sceglie un layout, non concede niente, perché ogni lettura vera resta governata
da RLS.

*Riga 45, il riconoscimento dell'offline.*

```js
const isOfflineError = (error) => error?.code === '' || !navigator.onLine
```

postgrest cattura da sé i fallimenti di rete e **risolve** con un errore dal
`code` vuoto: la promise non viene mai rifiutata, quindi un `.catch` non vedrebbe
questo caso.

*Righe 56-94, primo effetto: la sessione.* `getSession()` risolve dal local
storage, quindi un avvio a freddo offline sa già chi è loggato. Poi
`onAuthStateChange`. Dentro quel callback **solo codice sincrono**: Supabase
avverte che aspettare il proprio client lì dentro blocca il lock dell'auth. Sul
`SIGNED_OUT` si puliscono profilo, `queryClient.clear()`, persister, e si toglie
la push subscription con un `setTimeout(…, 0)` per uscire dal lock.

*Righe 110-125, il nonce di refetch.* Il ritorno del focus sulla scheda o della
rete fa incrementare `refetchNonce`, che è una dipendenza dell'effetto sotto.
Serve perché una sospensione dell'abbonamento fatta dal professionista sarebbe
altrimenti invisibile alla sessione del membro fino a un riavvio completo.

*Righe 127-187, secondo effetto: il profilo.* La lettura ha
`.retry(navigator.onLine)`, con il commento canonico del progetto sui tre retry
con backoff 1/2/4 secondi. La gestione dell'errore è la parte da saper spiegare:

```
errore -> se ho già un profilo per QUESTO utente, lo tengo
       -> altrimenti, se sono offline, uso la copia in localStorage
       -> solo se non ho niente, è un errore vero (e AppLayout mostra il pannello)
```

C'è anche una `active` flag nella cleanup, il classico guard contro una risposta
che arriva dopo che l'effetto è stato sostituito.

*Righe 189-227, `signOut`.* L'ordine è deliberato e ogni passo ha un commento:
prima `disablePush()` (chi si logga dopo su questo telefono non deve ricevere le
notifiche del precedente), poi il profilo da `localStorage`, poi
`queryClient.clear()` e `persister.removeClient()`, e solo alla fine
`supabase.auth.signOut()`. Il commento lungo (208-218) spiega che senza questo la
cache resterebbe su IndexedDB in chiaro per una settimana, leggibile da DevTools,
su un dispositivo che qualcun altro può usare. E dichiara il compromesso: così si
buttano anche le mutation ancora in coda, ed è la scelta giusta su un logout
volontario.

*Righe 229-246, il valore del context.*

```js
const matches = profileState.forUserId === userId
loading: !sessionReady || (Boolean(session) && !matches)
```

Il profilo viene esposto solo se appartiene all'utente attualmente loggato,
altrimenti dopo un cambio account i dati di quello uscente resterebbero visibili
per un render.

**Cosa non fa.** Non decide le rotte (lo fa `AppLayout`), non gestisce il login
form (lo fa `LoginScreen`), non conserva permessi: solo sessione e profilo.

**Domande che invita.**
- *Come fa l'app a sapere chi sei senza rete?* `getSession()` legge da local
  storage, e il ruolo è specchiato in `localStorage`.
- *Perché il ruolo in `localStorage` non è un problema di sicurezza?* Perché
  serve solo a scegliere un layout: ogni dato reale passa comunque da RLS.
- *Cosa vuol dire `loading` qui?* Non "sto caricando qualcosa", ma "non so ancora
  abbastanza per instradare".

---

## 5. `src/lib/queryClient.js` e `src/lib/cacheMigration.js`

**A cosa servono.** Il primo crea il `QueryClient` con i default che rendono
l'app offline-first e il persister su IndexedDB. Il secondo protegge la coda di
scritture quando cambia il contratto del server.

**Commento a blocchi — `queryClient.js` (45 righe).** Tutto il file è spiegato in
`02-pwa-offline.md`, sezione 3 e 4. In sintesi:

| Riga | Cosa | Perché |
|---|---|---|
| 18 | `gcTime: ONE_WEEK` | non più corto di `CACHE_MAX_AGE`, altrimenti la persistenza non fa niente |
| 19 | `staleTime: 30s` | mezzo minuto di tregua prima di considerare vecchio un dato |
| 24 | `retry: navigator.onLine && n < 2` | offline si fallisce subito, altrimenti niente mostra mai lo stato offline |
| 28 | `networkMode: 'offlineFirst'` | prima la cache, poi la rete |
| 33-34 | idem per le mutation, `retry: 3` | offline si mettono in pausa invece di fallire |
| 39-43 | `createAsyncStoragePersister` su `idb-keyval` | IndexedDB è asincrono; `throttleTime: 1000` evita di riscrivere a ogni tasto |

**Commento a blocchi — `cacheMigration.js` (126 righe).**

- Riga 6: `QUERY_CACHE_BUSTER = 'trainhub-security-v4'`. Se il buster salvato non
  coincide, TanStack butterebbe tutto: qui invece si interviene prima.
- Righe 14-19: `COMPATIBLE_LEGACY_MUTATIONS`, quattro operazioni il cui contratto
  non è cambiato con la patch 015. Tutto il resto è **fail-closed**: una chiave
  vecchia sconosciuta è più sicuro chiederla di nuovo all'utente che spedirla
  dentro una funzione che non è più quella per cui era stata scritta.
- `migratePersistedClient` (26-48): funzione **pura**, riceve l'oggetto
  persistito e restituisce `{client, changed, discardedCount}`. Essendo pura ha
  un self-check che gira sotto Node.
- `saveMigrationNotice` (59-76): scrive un avviso in `localStorage` e lancia un
  `CustomEvent`, perché il ripristino è asincrono e la shell potrebbe già essere
  a schermo con la sua lettura pigra già fatta. `OfflineBanner` lo mostra.
- `createMigratingPersister` (103-126): il wrapper. La migrazione avviene dentro
  `restoreClient`, cioè **prima** che il provider possa riprendere qualunque
  mutation, e il client filtrato viene prima riscritto su IndexedDB così la coda
  incompatibile non può tornare al refresh.

**Domande che invita.**
- *Cosa succede alle scritture offline quando aggiorni l'app?* Quelle il cui
  contratto è cambiato vengono scartate, e l'utente lo viene a sapere.
- *Perché il persister è "async"?* Perché IndexedDB lo è.
- *Che differenza c'è fra `staleTime` e `gcTime`?* Il primo dice quando un dato è
  da riaggiornare, il secondo per quanto resta in memoria dopo che nessuno lo usa.

---

## 6. `src/data/mutations.js`

**A cosa serve.** È il registro di tutte le scritture: associa ogni chiave alla
sua funzione, al suo scope, e a cosa invalidare quando finisce. È il file che
rende possibile la coda offline.

**Commento a blocchi (438 righe, ma sono 26 blocchi tutti uguali).**

*Righe 16-30, il docblock.* Dice due cose che valgono da sole una domanda:

1. deve girare **prima** che il provider ripristini la cache;
2. i punti di chiamata **non devono** dichiarare `onSettled` nel proprio
   `useMutation`, perché le opzioni del punto di chiamata vengono spalmate per
   ultime e **sostituirebbero** l'handler registrato qui. Un `mutate(vars,
   { onSuccess })` per singola chiamata è invece un altro meccanismo e si somma.

*Riga 37, lo scope del workout.*

```js
const runScope = { id: 'workoutRun' }
```

condiviso da `logSet`, `startRun`, `pauseRun`, `resumeRun`, `endRun`,
`saveRunNote`. Il commento: `set_logs.run_id` è una foreign key, quindi la run
deve atterrare prima delle sue serie, e pause e riprese devono arrivare
nell'ordine in cui sono avvenute.

*Righe 53-94, `startRun`.* Il caso da raccontare, perché contiene un `onMutate`:

```js
onMutate: (variables) => {
  queryClient.setQueryData(queryKeys.openRun(variables.memberId), { …la run… })
  queryClient.setQueryData(queryKeys.runLogs(variables.id), [])
}
```

Motivo: la schermata live rimanda indietro se non trova una run aperta per la sua
sessione. Senza scrivere subito in cache, offline il membro verrebbe rimbalzato
sempre, e online sarebbe una gara che la navigazione vince quasi sempre. La
seconda riga semina la lista dei log vuota, così i contatori leggono `0/3` subito
invece di aspettare una richiesta che offline non parte proprio.

C'è anche `onError`, che toglie la run dalla cache se l'apertura fallisce
davvero: altrimenti resterebbe un mini-player per un allenamento che non esiste.

*Righe 124-163, `endRun`.* Lo specchio del precedente. `onMutate` chiude la run
in cache e semina la schermata di riepilogo, perché quella legge la run per id,
una chiave che nessuno ha mai popolato: finire un allenamento offline atterrerebbe
su una schermata vuota. E chiude la run della shell **solo se è la stessa**, così
un replay che arriva dopo non cancella l'allenamento in corso adesso.

*Righe 262-317, `sendMessage`.* Scope `chat`, perché nella chat l'ordine è il
contenuto. `onMutate` inserisce il messaggio ottimistico, con un
`cancelQueries` prima per evitare che un refetch in volo lo sovrascriva. Il
commento chiarisce una sottigliezza vera: la riga ottimistica sopravvive a un
reload grazie alla **cache persistita**, non a questo hook, perché una mutation
ripristinata riprende da `retryer.continue()` e non riesegue `onMutate`.

*Righe 356-378, avatar.* L'unica coppia con `networkMode: 'always'`, cioè le
uniche due scritture che **non** vanno in coda. Motivo tecnico preciso: portano un
`Blob`, il persister serializza con `JSON.stringify`, e un Blob diventa `{}`. Un
replay sovrascriverebbe l'immagine con il vuoto.

*Righe 432-437, il guard di bootstrap.* Confronta `mutationKeys` con i default
registrati e lancia un errore se qualcosa manca. Meglio esplodere all'avvio che
perdere la scrittura offline di un utente.

**Cosa non fa.** Non contiene SQL né chiamate Supabase: importa le funzioni dai
moduli `data/`. Non registra `mintCheckinToken`, `redeemCheckinToken` e le push
subscription, di proposito.

**Domande che invita.**
- *Come fa l'app a non perdere una serie registrata in cantina?* Questo file:
  chiave, funzione registrata, scope, id idempotente.
- *Cosa vuol dire "scope"?* Serializza il replay delle mutation con lo stesso
  scope invece di lanciarle in parallelo.
- *Cos'è `onMutate`?* Aggiornamento ottimistico: succede prima della rete.

---

## 7. `src/data/workouts.js`

**A cosa serve.** Esemplare del livello `data/`: quattro letture e due scritture
sul dominio allenamento. Nessun React qui dentro.

**Commento a blocchi (189 righe).**

*Righe 6-10, il commento di apertura.* La regola dei `.retry(navigator.onLine)`
su ogni lettura, spiegata una volta e valida per tutto il file.

*Righe 18-21, `SESSION_EXERCISE_COLUMNS`.* Una costante con la select annidata:

```
id, position, target_sets, target_reps, target_weight, rest_seconds, notes,
exercise:exercises ( … )
```

La sintassi `exercise:exercises ( … )` è l'**embedding** di PostgREST: segue la
foreign key e restituisce l'esercizio annidato dentro la riga di prescrizione. Un
join fatto dichiarando cosa vuoi, non scrivendo SQL.

Il commento sopra racconta un bug istruttivo: qui c'era un aggregato
`set_logs ( count )`, che però contava **da sempre**. Alla seconda settimana un
esercizio da tre serie leggeva `6/3` e non si completava più niente. Adesso il
conteggio si fa sui log di **una** run.

*Righe 39-78, `fetchActivePlan`.* La lettura più densa:

1. il piano più recente del membro (`order created_at desc, limit 1, maybeSingle`);
2. `if (!plan) return null` — un membro senza piano è uno stato ordinario, non un
   errore: le schermate lo disegnano come empty state;
3. le sessioni ordinate per `position`, con `session_exercises ( count )` per
   sapere quanti esercizi ha ciascuna;
4. `const weekStart = mondayOf(todayISO())`, calcolato **una volta sola** qui e
   restituito insieme ai dati, così ogni card deriva il proprio stato contro lo
   stesso lunedì: chi apre l'app alle 23:59:59 di domenica non deve avere metà
   lista in una settimana e metà nell'altra;
5. `fetchRunsSince(memberId, daysBefore(weekStart, 7))`: si rileggono **due**
   settimane, non una. Il commento spiega: una run lasciata aperta domenica scorsa
   è ancora aperta, e l'indice unico parziale impedisce di aprirne una seconda;
   nasconderla lascerebbe il membro con un tasto play che fallisce e niente sullo
   schermo che spieghi perché.

*Righe 81-98, `fetchSession`.* Da notare l'ultima riga: PostgREST **non ordina le
righe annidate**, quindi l'ordinamento degli esercizi si fa in JavaScript. La
sequenza scelta dal trainer è informazione.

*Righe 113-142, `logSet`.* Una `rpc('log_workout_set_secure', …)`. Il docblock
elenca i tre motivi per cui i parametri sono quelli: `id` è la chiave di
idempotenza, `performedAt` è del client perché la scrittura può restare in pausa
per ore, `runId` è la foreign key che impone lo scope condiviso.

*Righe 160-189, `createPlan`.* Una sola RPC che scrive piano, sessioni ed
esercizi in transazione, con `p_replaces_plan_id` come controllo di concorrenza
ottimistica.

**Cosa non fa.** Non fa caching (è TanStack Query a farlo), non conosce le
schermate, non decide cosa mostrare quando qualcosa manca: restituisce `null` e
lascia decidere sopra.

**Domande che invita.**
- *Come interroghi il database?* Client Supabase, PostgREST sotto, con embedding
  per le relazioni.
- *Perché non c'è un ORM?* PostgREST espone già le tabelle come API REST e RLS
  filtra le righe: un ORM in mezzo aggiungerebbe un livello senza toglierne uno.
- *Cosa succede se un membro non ha un piano?* `null`, ed è uno stato previsto.

---

## 8. `src/sw.js`

**A cosa serve.** Il service worker scritto a mano: precache, fallback di
navigazione, push, click sulla notifica. 76 righe.

**Commento a blocchi.** Tutto il file è già commentato nel sorgente; le quattro
sezioni sono spiegate in `02-pwa-offline.md` sezione 2 e `03-backend-supabase.md`
sezione 7. Da tenere pronte:

- righe 8-9: `skipWaiting()` + `clientsClaim()` vanno con `registerType:
  'autoUpdate'`, cioè il worker nuovo prende il controllo subito;
- riga 12: `precacheAndRoute(self.__WB_MANIFEST)`, dove `__WB_MANIFEST` è il
  segnaposto che il plugin sostituisce in build;
- riga 16: la `NavigationRoute` che risolve ogni navigazione con `index.html`, ed
  è ciò che permette l'avvio a freddo senza rete;
- righe 18-22: il commento sull'assenza deliberata di caching per Supabase;
- righe 26-45: `push`, con il fallback di payload perché una notifica va mostrata
  comunque, altrimenti Chrome ne mostra una propria;
- righe 47-75: `notificationclick`, con la risoluzione dell'URL contro la propria
  origine (difesa contro un payload ostile) e la logica "riusa una finestra
  aperta, naviga, e solo se non ce n'è nessuna apri".

**Cosa non fa.** Nessuna strategia di runtime caching. Nessuna sincronizzazione in
background (`Background Sync` non è disponibile ovunque, e la coda di TanStack
Query fa lo stesso lavoro dentro la pagina).

**Domande che invita.**
- *Che cos'è un service worker?* Uno script che gira in un thread separato, senza
  DOM, fra la pagina e la rete; sopravvive alla chiusura della pagina ed è l'unica
  cosa viva quando arriva un push.
- *Perché `injectManifest`?* Perché servono handler propri.
- *Come fa l'app ad aprirsi offline?* La `NavigationRoute` sulla shell precachata.

---

## 9. `vite.config.js`

**A cosa serve.** Build, dev server, e tutta la configurazione PWA. 80 righe, di
cui metà commenti.

**Commento a blocchi.**

*Righe 5-15, gli host del tunnel.* Vite rifiuta gli Host che non conosce, ed è una
protezione contro il DNS rebinding: senza, una pagina su internet potrebbe
puntare un hostname a 127.0.0.1 e leggere le risposte del dev server. Il punto
iniziale in `.ngrok-free.dev` copre il dominio e tutti i sottodomini, così il
dominio statico personale non finisce in un file versionato.

*Righe 19-32, `server` e `preview`.* Il commento dice che quello che conta è
`preview`, perché il service worker esiste solo in una build di produzione.
`host: true` lega tutte le interfacce, altrimenti il default `localhost` su
Windows risolve solo `::1` e il telefono sulla stessa Wi-Fi non arriva.

*Righe 35-40, il plugin.* `registerType: 'autoUpdate'`, `strategies:
'injectManifest'`, `srcDir: 'src'`, `filename: 'sw.js'`, più gli
`includeAssets` (favicon e icona Apple, che non stanno nel manifest).

*Righe 41-63, il manifest.* Vedi `02-pwa-offline.md`.

*Righe 64-76, `injectManifest.globPatterns`.* I due pattern e il ragionamento sui
sette sottoinsiemi di Inter.

*Riga 77, `devOptions: { enabled: false }`.* Niente service worker in sviluppo.

**Domande che invita.**
- *Perché il manifest è qui e non in un file?* Lo genera il plugin, e i colori
  restano vicini alla configurazione.
- *Cosa cambia fra `dev`, `build` e `preview`?* In `dev` non c'è service worker;
  `preview` serve la build vera ed è l'unico modo di provare la PWA.

---

## 10. `src/theme/index.js`

**A cosa serve.** Il tema MUI: palette, tipografia, forma, override dei
componenti. È il requisito esplicito del corso.

**Commento a blocchi (134 righe).**

*Righe 1-2.* `createTheme` e `responsiveFontSizes` da `@mui/material/styles`, e i
token da `./tokens.js`.

*Righe 5-24, la palette.* Ogni voce è un token, non un colore scritto a mano.
Alla fine il gruppo custom:

```js
task: {
  training: tokens['Task.PT'],
  protocol: tokens['Task.Protocol Consultation'],
  nutrition: tokens['Task.Nutrition Consultation'],
  done: tokens['Task.Done'],
  suspended: tokens['Theme.Status.Suspended'],
}
```

MUI non ha uno slot per "tipo di appuntamento", quindi viaggia come gruppo
aggiuntivo della palette. Le card degli appuntamenti leggono `palette.task.*`.

*Righe 26-44, forma e tipografia.* `borderRadius: 16` come base, il font `"Inter
Variable"` con fallback di sistema, e la scala h1/h2/h3 con `letterSpacing`
negativo sui titoli grandi. `button: { textTransform: 'none' }` toglie il
maiuscolo automatico di MUI.

*Righe 46-129, gli override.* Ognuno ha una motivazione scritta:

- `touchAction: 'manipulation'` sul body: elimina il doppio tap che zooma per
  sbaglio mentre si preme un bottone. Il pinch resta, e il commento dice perché:
  bloccarlo violerebbe **WCAG 1.4.4**, che richiede l'ingrandimento fino al 200%.
- Un anello di focus su `MuiButtonBase`, che in una regola sola copre Button,
  IconButton, ListItemButton, CardActionArea, Chip e BottomNavigationAction. Senza,
  navigando da tastiera non si capiva dove si era.
- L'asterisco dei campi obbligatori colorato di rosso: il default MUI eredita il
  grigio dell'etichetta, e in 23 campi era l'unico segnale disponibile.
- I Chip non cliccabili perdono cursore, selezione del testo e flash di tap:
  altrimenti su un telefono sembrano bottoni.
- Card a `elevation: 0` con bordo e raggio 20, dialog e drawer anch'essi a 20,
  bottoni a pillola (`borderRadius: 999`).

*Riga 134.* `export default responsiveFontSizes(theme)`, con il commento che cita
il corso: MUI è mobile friendly ma non nativamente responsive, quindi le scale
tipografiche vanno derivate.

**La catena dei token, se te la chiede.**

```
doc/assets/variables.tokens.json     esportato da Figma, con alias tipo "{Color.Brand}"
        |
src/theme/resolveTokens.js           risolve gli alias e converte in esadecimale
        |
src/theme/tokens.js                  importa il JSON e lo appiattisce
        |
src/theme/index.js                   createTheme(...)
```

Il file JSON è **importato direttamente dalla cartella `doc/`**: Figma e app non
possono divergere, perché leggono lo stesso file. `resolveTokens` ha un
self-check che verifica, fra le altre cose, che `Color.Brand` valga `#FE6363`.

**Cosa non fa.** Non ci sono file CSS nel progetto: nessun `.css`, `.scss` o
modulo di stile. Tutto passa da `sx`, da `styleOverrides` o dal tema.

**Domande che invita.**
- *Dove sta il tema custom?* Qui, ed è `createTheme` + `responsiveFontSizes`.
- *Come garantisci che i colori siano quelli del design?* Vengono dal file di
  token esportato da Figma, importato direttamente.
- *Come gestisci l'accessibilità?* Anello di focus, asterischi visibili, zoom
  pinch mai bloccato, stato mai affidato al solo colore.

---

## 11. `src/features/workout/LiveSessionScreen.jsx`

**A cosa serve.** La schermata dell'allenamento in corso: cronometro, elenco
esercizi con i contatori, e la chiusura della run.

**Commento a blocchi (306 righe).**

*Righe 34-38, lo stato locale.* Tre booleani: `ending` (il foglio di conferma),
`abandoning` (la conferma dell'abbandono) e `leaving`, che merita la sua riga di
commento: viene messo a true nel momento in cui il membro decide di finire e non
viene **mai** rimesso a false, perché questa schermata sta uscendo di scena e deve
smettere di decidere dove mandare l'utente.

*Righe 40-65, le quattro query.* Run aperta, sessione con i suoi esercizi, log
della run (`enabled` solo se c'è una run), e le run precedenti della settimana,
che servono solo a sapere se il premio di oggi è già stato riscosso.

*Riga 50.* `const run = openRun.data?.session_id === sessionId ? openRun.data : null`
— la run aperta conta solo se appartiene **a questa** sessione.

*Righe 70-88, gli stati.* Prima tutti i `isPending`, poi gli errori, tutti nella
forma `isError && data === undefined`. Il commento a riga 76 è la spiegazione
canonica della regola.

*Righe 90-101, il redirect.* Se non c'è run aperta per questa sessione non c'è
niente di live da mostrare, quindi si torna alla schermata della sessione, dove
c'è il tasto play. Ma **non mentre si sta finendo**: `endRun` toglie la run dalla
cache nel suo `onMutate`, quindi questa schermata si ridisegna senza run nello
stesso commit della navigazione al riepilogo, e un `<Navigate replace>` reso in
quel momento sostituirebbe il riepilogo riportando indietro. È un bug reale che è
stato corretto, e il commento lo racconta.

*Righe 103-123, i calcoli derivati.* `countsByExercise`, `setProgress`,
`runComplete`, `completionPct`, `pointsForRun` vengono tutti da `summary.js` e
`status.js`, moduli puri con self-check. Poi due regole di prodotto:

- `alreadyPaid`: un premio per sessione al giorno. L'allenamento non viene mai
  bloccato, si può sempre fare e i dati arrivano comunque al coach; sono solo i
  punti a essere razionati, perché solo i punti si possono coltivare.
- `membershipActive`: con l'abbonamento inattivo la run si chiude lo stesso e
  arriva al coach, ma il server non scrive nessun premio, quindi l'interfaccia
  quota zero punti invece di prometterne di inesistenti.

*Righe 125-150, `finish(outcome)`.* Tre passaggi, ognuno commentato:

```js
setLeaving(true)                    // prima della scrittura: onMutate è sincrono
end.mutate({ id, memberId, sessionId, endedAt, outcome, pct })
navigate(…, { replace: true })      // adesso, non in onSuccess
```

L'ultima riga è la più importante: offline la scrittura si mette in pausa e
`onSuccess` non arriva mai, quindi navigare lì lascerebbe il membro fermo su un
allenamento che ha già chiuso.

*Righe 152-207, l'intestazione sticky.* `top: 'var(--trainhub-header-height, 56px)'`,
non `top: 0`: la barra dell'app è `fixed` e pubblica la propria altezza, quindi
con zero il cronometro scivolava sotto.

*Righe 209-261, la lista.* Ogni esercizio è una card con un chip `2/3` o una
spunta. Il commento a riga 228 spiega perché non c'è più l'evidenziazione
dell'esercizio "corrente": imponeva un ordine che la palestra non rispetta, perché
la macchina è occupata e si fa un'altra cosa.

*Righe 263-303, i tre overlay.* `EndRunSheet` (con `partial` o `abandoned`),
`ConfirmDialog` per l'abbandono (saltato se non è stata registrata nessuna serie,
perché non c'è niente da perdere) e `CongratsDialog`, che compare da solo quando
tutto è completo.

**Domande che invita.**
- *Dov'è il cronometro?* Il valore arriva da `useLiveSession`, e il tempo è
  aritmetica sui timestamp della run.
- *Cosa succede se chiudo l'app durante l'allenamento?* Niente: lo stato è sulla
  riga `workout_runs`, non nel browser. Riaprendo, la run è ancora aperta.
- *Perché navighi prima che la scrittura vada a buon fine?* Offline non andrebbe
  mai a buon fine subito.

---

## 12. `src/features/workout/ExerciseDetailScreen.jsx`

**A cosa serve.** La scheda di un esercizio, che durante un allenamento cresce una
metà per registrare le serie. È il file dove si vede meglio l'aggiornamento
ottimistico.

**Commento a blocchi (433 righe, tre componenti nello stesso file).**

*`Fact` (righe 27-45).* Una riga della prescrizione, resa come `dt`/`dd` dentro
una `<dl>`, così l'accoppiata etichetta-valore sopravvive per uno screen reader
invece di diventare testo sciolto. Il separatore è un bordo e non un `<hr>`
perché una `<dl>` può contenere solo coppie e i loro `div`.

*`ExerciseArt` (righe 56-69).* Il segnaposto dell'illustrazione, costruito dal
tema invece che da un file. Il commento è la giustificazione della scelta: immagini
vere andrebbero licenziate, ospitate e fatte stare in un precache che deve
funzionare in cantina, e non darebbero al membro niente più delle istruzioni.
`exercises.image_url` resta nello schema, inutilizzata e disponibile.

*`LogPanel` (righe 72-241), il cuore.*

- riga 77: `bodyweight` — quattro esercizi del catalogo non hanno carico, e
  `null` è come il database lo ha sempre registrato. Chiedere comunque un peso li
  renderebbe impossibili da registrare, e quindi renderebbe la run incompletabile.
- righe 89-92, il guard contro il doppio tap: una `useRef` azzerata da un effetto
  quando il numero di serie cambia. Il commento dice che **non** si usa
  `isPending` di proposito: offline la mutation resta pending fino al riaggancio,
  e usarla bloccherebbe ogni serie dopo la prima proprio nella situazione per cui
  la funzione esiste.
- righe 94-99: `useMutation({ mutationKey: mutationKeys.logSet })` **senza**
  `mutationFn`. Il commento spiega che la funzione è registrata in
  `data/mutations.js`, che è anche dove una mutation ripristinata da IndexedDB la
  ritrova; dichiararla anche qui creerebbe una seconda fonte di verità che il
  persister non vede.
- righe 101-114, `onMutate`: `cancelQueries` sui log della run, poi si aggiunge la
  riga ottimistica. Il commento chiarisce anche perché la lista viene **seminata**
  se assente: una run aperta offline non ha mai fatto la fetch dei log, e non fare
  niente lascerebbe la serie invisibile e, per via del guard sopra, bloccherebbe
  il form.
- righe 116-123, `onError`: si rimuove **solo quella riga** invece di ripristinare
  uno snapshot, perché con due scritture in volo il ripristino della prima
  cancellerebbe lo stato ottimistico della seconda.
- righe 149-187, `onSubmit`: `createUuid()` e `new Date()` sono generati **nel
  handler**, e il commento cita la regola di lint (`react-hooks/purity` vieta
  entrambi nel corpo del render). L'id è la chiave di idempotenza, il timestamp è
  del client perché la scrittura può restare ferma per ore.
  Ultima riga: il peso **non** viene azzerato dopo l'invio, perché la serie
  successiva è quasi sempre allo stesso carico e ridigitarlo ogni volta è il modo
  più rapido per far smettere di registrare.
- righe 203-234, i campi: `inputMode: 'numeric'` accanto a `type="number"`, perché
  è `inputMode` a far comparire davvero il tastierino su un telefono.

*Il componente pagina (righe 243-433).*

- righe 254-279: run aperta, log, e la sessione intera, quest'ultima solo per
  rispondere a "l'allenamento è finito del tutto", perché questa schermata conosce
  un esercizio solo;
- righe 290-294: quando la run risulta completa si naviga alla schermata live con
  `replace`, perché è lì che vive la finestra di congratulazioni, che sa dei punti
  e sa chiudere la run;
- righe 296-306: gli stati, di nuovo con `data === undefined`;
- righe 370-413: la metà di logging esiste **solo** se c'è una run per questa
  sessione. Fuori da un allenamento la schermata è la scheda di consultazione che
  è sempre stata.

**Domande che invita.**
- *Cos'è un aggiornamento ottimistico?* Scrivo in cache prima della rete e
  correggo se fallisce; qui è l'unica cosa che rende utile registrare offline.
- *Perché non usi `isPending` per bloccare il doppio invio?* Perché offline resta
  pending per sempre.
- *Perché `useRef` e non `useState` per il guard?* Perché non deve provocare un
  render, serve solo fra due eventi.

---

## 13. `src/features/workout/RestTimer.jsx`

**A cosa serve.** Il recupero fra le serie. È il file che contiene tutti i limiti
di piattaforma incontrati sul dispositivo vero.

**Commento a blocchi (280 righe).**

*Righe 39-41, `duckOtherAudio`.*

```js
if (navigator.audioSession) navigator.audioSession.type = 'transient'
```

`navigator.audioSession` è WebKit, da Safari 16.4. Il docblock elenca le quattro
categorie: `transient` abbassa l'audio altrui per la durata del suono (ed è
quello che fa il timer di sistema), `transient-solo` lo mette in pausa,
`playback` prende del tutto la sessione, `ambient` si mescola ma viene zittito
dall'interruttore silenzioso. Il guard c'è perché l'API non esiste altrove.

*Righe 47-74, il docblock del componente.* Da leggere quasi come sta: il numero
sullo schermo è la differenza fra adesso e un istante bersaglio, mai un contatore
decrementato da un intervallo; il suono passa da un elemento `<audio>` sbloccato
dentro il tap che avvia il recupero. E poi la tabella dei limiti:

| Meccanismo | Esito |
|---|---|
| `<audio>` sbloccato da un gesto | funziona, e ignora l'interruttore silenzioso di iOS |
| Web Audio | zittito da quell'interruttore su iOS |
| Vibration API | non esiste in Safari su iOS |
| notifiche locali programmate | nessuna API web |
| `setInterval` in background | rallentato ovunque, congelato su iOS |

Conclusione onesta scritta nel file: il suono è affidabile finché la scheda è
viva, non lo è con l'app in background o il telefono bloccato, e nulla sul web lo
rende tale. Per questo la fine è **anche** annunciata a uno screen reader e
scritta a schermo.

*Righe 79-83, lo stato.* `custom` è un **override**, non una copia della prop
`seconds`. Il commento spiega perché: rispecchiare una prop nello stato richiede
un effetto per tenerle allineate, e quell'effetto è sia un render a cascata sia la
cosa che annullerebbe silenziosamente una regolazione fatta dal membro.

*Righe 94-116, il tick.* Un intervallo da 250 ms che calcola
`Math.ceil((target - Date.now()) / 1000)`. Il suono parte quando arriva a zero, e
la `useRef rung` impedisce che un tick in ritardo lo faccia suonare due volte.

*Righe 128-158, `start()`, cioè lo sblocco.* La parte da saper raccontare:

```js
el.muted = true
el.play().then(() => { el.pause(); el.currentTime = 0; el.muted = false })
```

Un elemento `<audio>` può essere riprodotto senza gesto solo se è già stato
riprodotto **con** un gesto. Ma riprodurlo udibile qui, anche per pochi
millisecondi, basta a impadronirsi della sessione audio del telefono e a
interrompere la musica del membro all'inizio del recupero invece che alla fine.
Quindi si sblocca **muto**: su iOS `muted` è scrivibile e `volume` è di sola
lettura, quindi è l'unica leva disponibile.

*Righe 223-243, il numero grande.* È un `<button>` quando il timer è fermo (si
tocca per digitare i secondi) e un `<p role="timer">` quando corre, con
`aria-live="assertive"` solo nell'istante in cui arriva a zero.

**Domande che invita.**
- *Perché non hai usato la Web Audio API?* L'ho usata, ed è muta sugli iPhone col
  silenzioso inserito, perché Safari la instrada sulla categoria ambient.
- *Cosa succede se blocco il telefono durante il recupero?* Il numero resta
  corretto perché è derivato dai timestamp; il suono può non arrivare, e per
  questo la fine è anche testuale.
- *Perché non una notifica programmata?* Sul web non esiste.

---

## 14. `src/lib/week.js` e `src/features/workout/timer.js`

**A cosa servono.** Sono i due moduli puri del progetto: niente React, niente
import di rete, self-check che girano con `node`.

**Commento a blocchi — `timer.js` (52 righe).**

Quattro funzioni su uno stato di tre campi
(`{ startedAt, pausedAt, pausedTotal }`), che sono anche tre colonne di
`workout_runs`:

```js
elapsedMs(state, now) = max(0, (pausato ? pausedAt : now) - startedAt - pausedTotal)
```

Il commento di apertura è la tesi: il tempo trascorso è aritmetica sui timestamp e
non un contatore, perché un contatore guidato da `setInterval` va alla deriva e si
ferma del tutto quando il telefono si blocca o il browser rallenta la scheda in
background, che è precisamente ciò che accade durante una serie.

Due clamp a zero, entrambi motivati: un orologio corretto all'indietro renderebbe
`pausedTotal` negativo, e un totale negativo viene sottratto da ogni lettura
successiva, gonfiando il cronometro per sempre invece che una volta sola.

**Commento a blocchi — `week.js` (134 righe).**

- `mondayOf(dayISO)` costruisce la data dai **pezzi locali**
  (`new Date(year, month-1, day)`) e non da `new Date('YYYY-MM-DD')`, che è
  mezzanotte UTC e cade sul giorno prima a ovest di Greenwich. E rimappa la
  domenica: `getDay()` la chiama 0, quindi diventa 7 prima della sottrazione,
  altrimenti la domenica aprirebbe la settimana che sta per cominciare invece di
  chiudere quella appena finita.
- `weekdayOf(dayISO)` restituisce l'indice del giorno nella stessa convenzione in
  cui è memorizzato `nutrition_days.weekdays`, così il client non deve tradurre.
- `daysBefore(dayISO, n)` esiste perché nessuno scriva
  `Date.now() - n * 86_400_000`: un giorno all'anno dura 23 ore e un altro 25.
- `earnedOn(runs, dayISO)`: la regola dei punti, un premio per sessione al giorno,
  con il commento che spiega la filosofia (si razionano solo i punti, perché solo
  i punti si possono coltivare) e i due casi limite: una run abbandonata o a zero
  non consuma la giornata, e una run scritta prima della patch 014 (`pct` nullo)
  viene letta come già pagata.
- `runStatusOf(runs, weekStartISO)`: la funzione che sostituisce la colonna di
  stato. Precedenza in tre punti, tutti motivati nel docblock: una run **aperta**
  vince sempre, qualunque settimana abbia iniziato; altrimenti decide la run più
  recente **chiusa dentro questa settimana**; `abandoned` non è uno stato, è
  l'assenza di uno stato. Il confronto è sul **giorno locale**, e l'ordinamento
  passa per `Date.parse` invece che per confronto di stringhe.

**Domande che invita.**
- *Perché il tempo non è un contatore?* Perché i browser congelano gli intervalli.
- *Che problema c'è con `new Date('2026-03-15')`?* È mezzanotte UTC, quindi a ovest
  di Greenwich rappresenta il giorno prima.
- *Dove sta lo stato di una sessione?* In nessun posto: è calcolato dalle sue run.

---

## 15. `src/features/checkin/ScannerScreen.jsx`

**A cosa serve.** Lo scanner del professionista: accede alla fotocamera, decodifica
il QR in locale, e chiede al database di validare il token. È il file da aprire se
la domanda è sulle **API native del dispositivo**.

**Commento a blocchi (187 righe).**

*Righe 9-21, i ref e lo stato.* `videoRef` e `canvasRef` sono i due elementi che
servono alla decodifica. `lastToken` evita che lo stesso QR venga riscosso in
continuazione nei secondi in cui resta inquadrato: il ciclo gira cinque volte al
secondo. `cooldownTimer` riarma `lastToken` dopo un errore, ma con un ritardo,
altrimenti durante un guasto di rete il ciclo martellerebbe la RPC a ogni tick.

*Righe 23-43, `redeem`.* Una `useCallback` che chiama `redeemCheckinToken`,
mette il risultato a schermo e, in caso di errore, arma il cooldown di 3 secondi.

*Righe 45-101, l'effetto della fotocamera.* Il pezzo interessante:

```js
stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
videoRef.current.srcObject = stream
await videoRef.current.play()

timer = setInterval(() => {
  canvas.width = video.videoWidth; canvas.height = video.videoHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  const frame = context.getImageData(0, 0, canvas.width, canvas.height)
  const code = jsQR(frame.data, frame.width, frame.height)
  if (code) redeem(code.data)
}, 200)
```

Da spiegare: `facingMode: 'environment'` chiede la camera posteriore;
`willReadFrequently: true` dice al browser che leggeremo spesso i pixel e gli
permette di scegliere un backend adatto; il canvas è il buffer intermedio perché
`jsQR` lavora su un array di pixel, non su un elemento video; e **il frame non
lascia mai il dispositivo**: la decodifica è locale, al server va solo la stringa.

La cleanup, con il suo commento: `stream.getTracks().forEach(t => t.stop())`,
perché una fotocamera lasciata accesa è un bug visibile, l'indicatore del telefono
resta illuminato dopo che la schermata è sparita. Ci sono anche `cancelled` e i
due `clearTimeout`/`clearInterval`.

*Righe 133-134.* Il canvas è renderizzato con `display: none`: non è
un'interfaccia, è il buffer.

*Righe 154-184, l'inserimento manuale.* La via d'uscita quando la fotocamera non
parte o il permesso è negato. Il codice viene normalizzato
(`trim().toUpperCase().replace(/\s+/g, '')`) come il generatore lo produce, e
`lastToken` viene azzerato di proposito, perché premere di nuovo il bottone è una
richiesta esplicita di ricontrollare lo stato del token sul server.

**Cosa non fa.** Non legge `checkin_tokens`: il professionista non ha accesso a
quella tabella. La validazione è tutta dentro la RPC `redeem_checkin_token`, che
risponde con uno di cinque stati (`ok`, `unknown`, `used`, `expired`, `suspended`).

**Domande che invita.**
- *Quali API native del dispositivo usi?* `getUserMedia` per la fotocamera,
  Notification e Push per le notifiche, `crypto.getRandomValues` per i token.
- *Il QR viene mandato al server?* No, viene decodificato in locale.
- *Come gestisci il permesso negato?* Alert esplicito più inserimento manuale del
  codice, che per questo è fatto di 8 caratteri leggibili.

---

## 16. SQL: `supabase/policies.sql`

**A cosa serve.** Abilita RLS su tutte le tabelle, definisce i due helper e scrive
le policy. È il file da aprire alla domanda sulla sicurezza.

**Commento a blocchi.**

*Righe 1-11, l'intestazione.* Dichiara la regola generale (un membro raggiunge
solo le proprie righe, un professionista quelle dei membri assegnati) e avverte
che questo file è **il primo passo di una sequenza**, non lo stato finale:
`patches/001` sostituisce una policy che non nominava `auth.uid()` ed era quindi
pubblica, e `patches/015` e `022` revocano i grant di scrittura su tredici tabelle.

*Righe 13-32.* `alter table … enable row level security` su tutte e venti le
tabelle di `schema.sql`.

*Righe 34-59, i due helper.* Il commento sopra è la spiegazione di `search_path =
''` riportata in `03-backend-supabase.md` sezione 3: Postgres risolve un nome non
qualificato passando prima da `pg_temp`, e un membro potrebbe creare una `profiles`
temporanea che dice quello che gli fa comodo.

*Righe 61 in poi, le policy.* Sono quasi tutte di una riga:

```sql
create policy workout_plans_select on workout_plans
  for select using (owns_member(member_id));
```

Una merita di essere letta ad alta voce, righe 65-69: il commento dice che il
guard `auth.uid() is not null` sulla policy che permette a un membro di sfogliare
i professionisti è **portante**, perché senza di esso la condizione non nomina mai
il chiamante e quindi regala il profilo di ogni professionista a chiunque abbia la
chiave pubblica, che viaggia dentro il bundle JavaScript.

**Domande che invita.**
- *Cos'è la Row Level Security?* Un filtro che Postgres applica riga per riga, in
  base a una condizione che può usare l'identità del chiamante.
- *Cosa succede se sbagli una policy?* O nessuno vede niente, o vedono tutti: il
  secondo caso è successo, ed è stato trovato da una sonda anonima.
- *Perché `security definer`?* Perché l'helper deve leggere `profiles` senza
  ricadere nelle policy che sta aiutando a valutare.

---

## 17. SQL: `close_workout_run_secure`

**A cosa serve.** Chiude un allenamento: calcola percentuale, esito e punti dai
set effettivamente registrati, e scrive il premio nella stessa transazione. Sta in
`supabase/patches/023-subscription-enforcement.sql:114-187`.

**Commento a blocchi.**

*Firma.* Tre parametri: `p_run_id`, `p_ended_at`, `p_outcome`. Restituisce
`setof workout_runs`. `language plpgsql security definer set search_path = ''`.

*Riga 123-125, il lock e l'autorizzazione.*

```sql
select run.* into v_row from public.workout_runs run
where run.id = p_run_id and run.member_id = auth.uid() for update;
if not found then raise exception 'run not found' using errcode = '42501'; end if;
```

Una riga fa due lavori: il `for update` blocca la riga contro una seconda chiusura
concorrente, e `member_id = auth.uid()` è l'autorizzazione. Un id di qualcun altro
dà "not found", che non rivela se la run esiste.

*Riga 126.* `v_reward_day := (v_row.started_at at time zone 'Europe/Rome')::date`
— il giorno del premio è il **giorno italiano** dell'inizio, non il giorno del
server.

*Righe 130-136, l'idempotenza.* Se la run è già chiusa: se lo è **allo stesso
modo** si restituisce la riga senza fare niente (un replay è legittimo), se lo è
diversamente si alza `40001`.

*Righe 141-154, il calcolo.* Due query:

```sql
v_target := sum(item.target_sets)                       -- quanto era prescritto
v_done   := sum(least(coalesce(logged.amount,0), item.target_sets))
```

Il `coalesce` dentro il `least` è la correzione della patch 016, e vale una
domanda: `LEAST` in Postgres **ignora i NULL**, quindi un esercizio senza nessun
log (`amount` nullo per via del left join) sarebbe stato letto come completo.
Il `least` serve invece a non far contare più del prescritto chi registra serie in
eccesso.

*Righe 155-160, le tre decisioni.*

```sql
v_pct     := floor(100.0 * v_done / v_target)
v_outcome := abbandonato se lo dice il client;
             completed se v_done >= v_target;
             altrimenti partial
v_points  := 0 se abbandonato o senza target, altrimenti floor(30.0 * v_done / v_target)
```

Il punto politico: **il client non può imporre `completed`**. Può solo dichiarare
di aver abbandonato. Percentuale e punti sono ricalcolati dalle righe che
esistono davvero.

*Righe 162-168.* Se la run era in pausa, la pausa finale viene accreditata prima
di scrivere, poi l'UPDATE con `ended_at`, `outcome`, `pct`, `paused_at = null`.

*Righe 170-184, il premio.* Nella stessa transazione, e solo se i punti sono
maggiori di zero **e** `has_active_subscription(member_id)`. La `on conflict
(member_id, workout_session_id, reward_day) … do nothing` è ciò che realizza il
tetto di un premio per sessione al giorno lato database, indipendentemente da
quello che il client crede.

**Domande che invita.**
- *Chi calcola la percentuale?* Il database, dalle righe di `set_logs`.
- *Un utente può falsificare i punti?* No: la funzione ignora ciò che il client
  dice, tranne la dichiarazione di abbandono, che può solo togliere.
- *Cosa succede se la chiamata viene rigiocata?* Una chiusura identica restituisce
  la riga; una diversa alza `40001`; il premio è protetto dal vincolo unico.
