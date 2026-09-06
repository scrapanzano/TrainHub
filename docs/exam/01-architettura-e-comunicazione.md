# Architettura e comunicazione fra i pezzi

La domanda più probabile non è "cosa fa il progetto" ma "come fanno queste parti
a parlarsi". Questo file risponde a quella.

---

## 1. I livelli, e perché la dipendenza va in una direzione sola

```
                 routes/index.jsx          l'albero delle rotte
                        |
                 layouts/AppLayout.jsx     la shell: top bar, bottom nav, guard
                        |
      features/<dominio>/*.jsx             le schermate (14 domini)
             |                    \
      data/<dominio>.js        components/*.jsx
             |                     (ricevono props, non sanno nulla)
      lib/supabase.js
             |
        Supabase (Postgres + Auth + Realtime)

      lib/  e  theme/  stanno sotto tutti: sono codice puro, senza React
```

Tre affermazioni, nell'ordine in cui conviene dirle a voce:

1. **`data/` sa di Supabase e non sa niente di React.** Sono funzioni `async`
   che o restituiscono dati o lanciano un errore. Nessun hook, nessun componente.
2. **`features/` sa di React e chiama `data/`.** Una schermata non scrive mai
   una query Supabase a mano: chiede la funzione del livello sotto.
3. **`components/` non sa né dell'uno né dell'altro.** Riceve props e disegna.

**Perché la regola esiste, con un esempio concreto.** `src/lib/week.js` calcola
il lunedì della settimana ISO e lo stato di una sessione a partire dalle sue run.
Serve a `src/data/workouts.js:61` (che decide quale finestra di run leggere) e
serve alle schermate che colorano le card. Può servire a entrambi solo perché sta
in `lib/`, cioè sotto tutti e due. Se fosse stato messo accanto alle schermate
del workout, il livello `data/` avrebbe dovuto importare da `features/`, e a quel
punto la direzione delle dipendenze diventa un cerchio.

Effetto collaterale utile: `week.js` e `timer.js` non importano React, quindi il
loro self-check gira con `node src/lib/week.selfcheck.js`, senza bundler.

**Le due eccezioni, dichiarate.** L'autenticazione e le sottoscrizioni Realtime
sono legate alla sessione del browser e al ciclo di vita dei componenti, quindi
stanno vicino ai provider e agli hook che le possiedono (`AuthProvider.jsx`,
`useThreadMessages.js`, l'effetto in `AppLayout.jsx:51-73`).

---

## 2. L'avvio: chi monta cosa, e in che ordine

`src/main.jsx` fa tre cose e basta:

```js
import { registerSW } from 'virtual:pwa-register'
registerSW({ immediate: true })          // registra il service worker
createRoot(...).render(<StrictMode><App /></StrictMode>)
```

`src/App.jsx` compone i provider, dall'esterno all'interno:

```
ThemeProvider (tema MUI)
└── CssBaseline (reset)
    └── PersistQueryClientProvider (cache TanStack + IndexedDB)
        └── AuthProvider (sessione Supabase + profilo)
            └── RouterProvider (le rotte)
```

**Il dettaglio che vale una domanda:** `registerMutationDefaults(queryClient)` è
chiamato a **module scope** (`App.jsx:14`), non dentro un effetto. Motivo scritto
nel commento sopra: `PersistQueryClientProvider` ripristina la cache e riprende
le mutation in pausa *mentre monta*, cioè prima che qualunque effetto giri. Una
mutation ripresa senza il suo default non ha una funzione da chiamare e viene
buttata via.

---

## 3. Il router come contratto

`src/routes/index.jsx` è un `createBrowserRouter` con quattro voci di primo
livello:

- il ramo pubblico (`PublicLayout`): `/login`, `/forgot-password`,
  `/reset-password`;
- il ramo membro: `path: '/m'`, elemento `<AppLayout … requiredRole="member" />`;
- il ramo professionista: `path: '/p'`, stesso `AppLayout` con `navItems`
  diversi e `requiredRole="professional"`;
- due catch-all: `/` e `*` mandano a `/m`.

Tre cose da saper dire:

**`lazy` per schermata.** Ogni figlio ha
`lazy: async () => ({ Component: (await import('…')).default })`. È il `lazy` di
React Router, non `React.lazy`, quindi non serve nessun `<Suspense>`: il router
attende il modulo durante la transizione. Effetto: ogni sezione è un chunk
separato e la prima vista scarica una frazione dell'app.

**Un solo `errorElement`.** `RouteErrorScreen` è agganciato a tutti e tre i rami:
un errore imprevisto dà una schermata con una via d'uscita invece di una pagina
bianca.

**Il guard è la shell, non un componente a parte.** Non esiste `<RequireAuth>`:
è `AppLayout` che riceve `requiredRole` e decide (vedi sezione 4). Una scelta,
non una dimenticanza: la shell deve comunque leggere il profilo per disegnare
l'header, quindi far decidere anche a lei costa zero letture in più.

Due rotte sono redirect storici: `workout/session/new` e
`workout/session/:sessionId/exercise/new` mandano a `/m/workout`. Le schermate
che stavano lì non esistono più (oggi si sostituisce il piano intero), e i
redirect restano perché un vecchio link o un vecchio bookmark non deve dare 404.

---

## 4. La shell: `AppLayout.jsx`

Un solo layout serve entrambi i ruoli. Riceve tre props: `navItems`,
`profileHref`, `requiredRole`.

**Il guard, in ordine (righe 119-169):**

```
loading            -> spinner, così un utente già loggato non viene sbalzato
                      su /login a ogni avvio a freddo
!user              -> <Navigate to="/login" state={{from: pathname}} replace>
!profile           -> pannello a tutta pagina: "sei offline" (con Riprova)
                      oppure "profilo non disponibile" (con Esci)
role !== required  -> <Navigate> verso la home dell'altro ruolo
```

Il `state.from` serve a riprendere il viaggio dopo il login invece di scaricare
tutti sulla home. Il `replace` tiene l'URL da cui si è rimbalzati fuori dalla
cronologia, altrimenti il tasto Indietro rifà il redirect.

**Cosa contiene la shell**: `TopHeader` (avatar, campanella con badge, e per il
professionista l'icona dello scanner), `OfflineBanner`, `MembershipBanner`,
l'`<Outlet />` con la schermata corrente, il mini-player `LiveSessionBar` quando
c'è un allenamento aperto, e `BottomNav`.

**Due dettagli di layout che sono domande in agguato:**

- Header e bottom bar sono `position: fixed`, non `sticky`. Motivo nel commento a
  riga 188: una barra sticky occupa comunque una riga nella colonna flex, quindi
  la pagina scorrerebbe solo *sotto* di lei, mai *dietro*.
- L'altezza dell'header non è una costante: i due banner appaiono e scompaiono.
  Viene misurata con un `ResizeObserver` e pubblicata come variabile CSS
  `--trainhub-header-height`, che `main` usa come `padding-top` e che la card
  del cronometro usa come `top` per lo sticky.

---

## 5. Lo stato: chi possiede cosa

Non c'è nessuna libreria di stato globale. La divisione è netta:

| Tipo di stato | Dove vive | Esempio |
|---|---|---|
| Sessione e profilo | `AuthProvider` (React context) | chi sei, che ruolo hai |
| Stato remoto | TanStack Query | piano, run, messaggi, appuntamenti |
| Stato di schermata | `useState` locale | il testo nel campo "reps" |
| Preferenza del device | `localStorage` | il mute del rest timer |

Alla domanda "perché non Redux": tolta la sessione, tutto ciò che resta è dato
del server, e TanStack Query lo gestisce già con cache, invalidazione, stato di
caricamento e coda offline. Uno store globale sarebbe un contenitore senza niente
di suo da conservare.

### Le query key sono l'indirizzo condiviso

`src/lib/queryKeys.js` è l'unico posto dove le chiavi vengono scritte. Sono
array: `['runs', 'open', memberId]`, `['session', sessionId]`.

Il punto è il **prefisso**. `invalidateQueries({ queryKey: ['runs'] })` colpisce
la run aperta, la finestra di due settimane e i log di ogni run caricata, perché
`partialMatchKey` confronta solo la lunghezza della chiave che gli passi. È così
che due schermate che non si conoscono restano d'accordo: chi scrive invalida una
famiglia, chi legge si riaggiorna.

Il commento a `queryKeys.js:45-50` dice anche perché si invalida la famiglia e
non il singolo id: un chiamante che dimentica l'id produrrebbe
`['session', undefined]`, che non corrisponde a niente e fallisce in silenzio.

C'è anche un caso di **versionamento della chiave**: `nutritionPlan` è
`['nutritionPlan', 'v2', memberId]`. La patch 022 ha cambiato la forma della
risposta (`{plan, meals}` è diventato `{plan, days}`); una voce di cache vecchia
sotto la chiave vecchia semplicemente non viene più letta, invece di far esplodere
tre schermate che destrutturano `days`.

### Un esempio completo di propagazione

Chiudo un allenamento. `endRun` è registrata in `mutations.js:124-163` e nel suo
`onSettled` invalida tre famiglie: `runs`, `plan`, `rewards`. Risultato:

- la schermata del piano ricalcola lo stato settimanale delle sessioni;
- la home ricalcola qual è il prossimo allenamento;
- la pagina dei premi mostra i punti appena guadagnati;
- il mini-player nella shell sparisce, perché legge `openRun`.

Nessuna di queste schermate sa che le altre esistono.

---

## 6. Come comunicano i due ruoli

Non c'è messaggistica fra client. Il collegamento è **la stessa riga letta da due
lati**, e chi può leggerla lo decide il database:

```sql
create function owns_member(target uuid) returns boolean
  select target = auth.uid()
      or exists (select 1 from public.profiles
                 where id = target and assigned_pro_id = auth.uid());
```

Una policy costruita su questo predicato (`policies.sql:110-111` per
`workout_runs`) dice in una riga: il membro vede le proprie righe, il
professionista assegnato vede le stesse righe, nessun altro vede niente. Il
professionista non riceve una copia dei dati del cliente: legge le stesse righe.

Sopra questo ci sono due canali di aggiornamento in tempo reale:

- **Supabase Realtime** per la chat (`useThreadMessages.js`) e per il contatore
  delle notifiche (`AppLayout.jsx:51-73`). L'evento non porta i dati alla
  schermata: fa da innesco, e la fonte di verità resta la query.
- **Un polling di 60 secondi** come rete di sicurezza, perché una rete mobile può
  chiudere il socket senza dirlo.

---

## 7. Il percorso completo di una lettura, in sei righe

```
ExerciseDetailScreen.jsx        useQuery({queryKey: sessionExercise(id), queryFn})
        |
data/workouts.js                fetchSessionExercise(id)
        |                       .select(...).single().retry(navigator.onLine)
lib/supabase.js                 il client, creato una volta sola
        |
PostgREST                       GET /rest/v1/session_exercises?id=eq...
        |
Postgres                        GRANT -> policy RLS -> righe
        |
TanStack Query                  mette in cache sotto la chiave, persiste su IndexedDB
```

E il percorso di una scrittura è nel file `05-flussi-end-to-end.md`, perché lì
succedono le cose interessanti.
