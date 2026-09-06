# Quattro percorsi end-to-end

Da raccontare a voce, nominando i file nell'ordine in cui vengono attraversati.
Sono la risposta migliore alla domanda "fammi vedere come funziona".

---

## 1. Una serie registrata in cantina, senza rete

Lo scenario che giustifica metà delle scelte tecniche del progetto.

**1. Il tocco.** `ExerciseDetailScreen.jsx:149`, `onSubmit` del form.

```js
const id = createUuid()                    // chiave di idempotenza
const performedAt = new Date().toISOString()   // timestamp del client
logSet.mutate({ id, runId, sessionExerciseId, setNumber, reps, weight, performedAt, optimistic })
```

Entrambi generati **nell'handler** e non nel render: `react-hooks/purity` vieta
`crypto.randomUUID()` e `new Date()` nel corpo di un componente, perché
renderebbero il render impuro.

Il timestamp è del client perché questa scrittura può restare ferma per ore: il
`now()` del database registrerebbe una serie fatta alle 18 come fatta alle 23.

**2. L'aggiornamento ottimistico.** L'`onMutate` della mutation
(`ExerciseDetailScreen.jsx:101-114`) annulla i refetch in volo sui log della run e
aggiunge subito la riga in cache. È ciò che fa muovere il contatore da `1/3` a
`2/3` nell'istante del tocco. Senza, non succederebbe niente e il membro
registrerebbe la stessa serie due volte.

**3. La pausa.** La mutation ha `networkMode: 'offlineFirst'`
(`queryClient.js:33`), quindi non fallisce: si mette in pausa. La funzione da
eseguire non è nel componente, è registrata in `data/mutations.js:39` sotto la
chiave `logSet`.

**4. La persistenza.** Il `PersistQueryClientProvider` salva su IndexedDB, con
`shouldDehydrateMutation: (m) => m.state.status === 'pending'` (`App.jsx:34`).
Adesso il membro può chiudere l'app, spegnere il telefono, uscire dalla palestra.

**5. Il ritorno.** All'avvio, `createMigratingPersister.restoreClient`
(`cacheMigration.js:107`) ripristina la cache, controlla il buster e scarta le
scritture con contratto incompatibile. Poi
`onSuccess={() => queryClient.resumePausedMutations()}` (`App.jsx:44`) rigioca la
coda.

**6. L'ordine.** `logSet`, `startRun` e `endRun` condividono `scope:
{ id: 'workoutRun' }` (`mutations.js:37`), quindi vengono rigiocate **in serie**.
Senza, `resumePausedMutations` le lancerebbe in parallelo e una serie potrebbe
arrivare prima della run che referenzia: `set_logs.run_id` è una foreign key, la
scrittura fallirebbe e la serie sarebbe persa.

**7. Il server.** `data/workouts.js:127`, `rpc('log_workout_set_secure', …)`.
La funzione verifica che la run sia aperta e appartenga al chiamante, e fa
`on conflict (id) do nothing` più il confronto del contenuto: un replay esatto va
a buon fine, lo stesso id con dati diversi alza `23505`.

**8. Il ritorno a schermo.** L'`onSettled` registrato invalida `session` e `runs`
(`mutations.js:45-50`), quindi si riaggiornano insieme il contatore
dell'esercizio, le pillole della lista live, la barra della settimana sul piano e
la finestra di congratulazioni.

> **La frase che riassume tutto:** "la serie non aspetta la rete per esistere:
> esiste in cache col suo id, e la rete più tardi la trova già battezzata."

---

## 2. Un piano creato

**1. La bozza.** `CreatePlanFlow.jsx` tiene tre passi in stato locale:
`'meta' | 'session' | 'summary'`. Le sessioni si aggiungono, si riaprono, si
correggono, si cancellano. **Niente tocca il database** finché non si conferma:
lo dice il docblock del file.

Gli id delle sessioni e degli esercizi vengono generati mentre si compone la
bozza (`contracts.js`), non alla conferma, così un salvataggio ritentato produce
esattamente gli stessi id. È quello che il self-check
`workout/contracts.selfcheck.js` verifica: "id stabili fra due ricostruzioni".

**2. La conferma.** Una sola chiamata:

```js
createPlan.mutate({ id, memberId, replacesPlanId, name, goal, level, weeks, sessions })
```

`replacesPlanId` è l'id del piano che il client **crede** di sostituire.

**3. Il livello dati.** `data/workouts.js:171`, `rpc('create_workout_plan_secure')`
con otto parametri, di cui `p_sessions` è un `jsonb` con dentro tutte le sessioni
e i loro esercizi.

**4. Il server**, in ordine:

```
lock della riga del membro + owns_member(target)      -- chi sei e cosa puoi
has_active_subscription(member)                        -- abbonamento attivo
p_sessions non vuoto                                   -- niente piani vuoti
se p_plan_id esiste già: confronta i campi
    uguali -> restituisce il piano (replay legittimo)
    diversi -> 23505
il piano più recente del membro == p_replaces_plan_id?
    no -> 40001 'the member plan changed before this save arrived'
insert del piano, poi loop su p_sessions -> _insert_session_bundle
```

Tutto dentro una funzione plpgsql, quindi **una transazione**: o esistono piano,
sessioni ed esercizi, o non esiste niente.

**5. Il ritorno.** `onSettled` invalida `plan` e `clients`
(`mutations.js:188-194`), perché la lista clienti del professionista deriva
l'obiettivo mostrato dal piano più recente di ciascuno.

**Il caso che vale la domanda.** Il membro è offline e si scrive una scheda; nel
frattempo il coach gliene assegna una. Quando il membro torna online la sua
scrittura viene rigiocata, ma il controllo del punto 4 vede che il piano più
recente non è più quello che lui credeva, e alza `40001` invece di seppellire il
lavoro del coach.

---

## 3. Un badge scansionato

**1. Il membro apre il badge.** `BadgeScreen.jsx` genera il codice in locale:

```js
const BADGE_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'   // niente 0/O, 1/I/L
crypto.getRandomValues(new Uint8Array(8))
```

8 caratteri da un alfabeto di 32 simboli sono 40 bit. L'alfabeto è di tipo
Crockford perché il codice deve poter essere **letto ad alta voce o digitato** se
la fotocamera non parte. E 256 è divisibile per 32, quindi `byte % 32` è uniforme:
niente bias del modulo.

**2. Il token viene registrato.** `data/checkin.js:38`, un insert su
`checkin_tokens`. `expires_at` **non** viene passato: è il default della colonna,
`now() + interval '60 seconds'`, calcolato sull'orologio del **database**. Un
telefono avanti di un'ora conierebbe altrimenti un badge già morto.

La funzione restituisce anche `lifetimeMs = expires_at - created_at`, due
timestamp entrambi del database, così il conto alla rovescia sullo schermo non
mescola due orologi.

Questa scrittura **non** è registrata in `data/mutations.js`, di proposito: un
token rigiocato un'ora dopo non vale niente per nessuno. Offline fallisce e la
schermata lo dice.

**3. Il QR.** La libreria `qrcode` produce un data URI
(`QRCode.toDataURL(token, { width: 320, margin: 1 })`), mostrato come `<img>`, con
il codice anche in chiaro sotto, in monospazio.

**4. Il professionista inquadra.** `ScannerScreen.jsx:52`,
`getUserMedia({ video: { facingMode: 'environment' } })`, poi un ciclo ogni 200 ms
che disegna il frame su un canvas nascosto e lo passa a `jsQR`. Il frame non
lascia il dispositivo.

**5. La validazione.** `rpc('redeem_checkin_token', { p_token })`. Il
professionista non legge mai `checkin_tokens`: la funzione è `security definer` e
controlla in ordine:

```
il chiamante è un professionista?           -> altrimenti 42501
il token esiste?                            -> 'unknown'
il proprietario è un membro?                -> 'unknown'
rilettura del token FOR UPDATE              (un altro scanner può averlo consumato)
già usato?                                  -> 'used'
scaduto?                                    -> 'expired'
abbonamento sospeso / scaduto?              -> 'suspended' / 'expired'
altrimenti: marca used_at, inserisce il check-in, inserisce 10 punti
```

**6. Il giorno.** `v_day := (now() at time zone 'Europe/Rome')::date`
(`patches/026`). Sia il check-in sia il premio vengono datati col giorno
italiano, non con quello del server: una scansione alle 00:10 non deve poter
pagare due volte, né essere scartata come doppione della sera prima. Il premio ha
codice `'checkin:' || v_day` e `rewards` ha già `unique (member_id, code)`, quindi
una seconda scansione lo stesso pomeriggio non aggiunge niente.

**7. Lo schermo.** `scanResult.js` mappa i cinque stati in una vista: solo `ok` è
`accepted`, e gli altri portano un titolo e una spiegazione. Ha un self-check che
verifica proprio che nessun altro stato sia mai accettato.

**Il limite da dichiarare prima che te lo chiedano:** la funzione verifica che chi
scansiona sia **un** professionista, non che quel membro sia **suo** cliente. È
coerente con una reception, dove chi è di turno fa entrare tutti, ed è scritto
fra le limitazioni note della relazione.

---

## 4. Una notifica push

**1. L'iscrizione.** `features/profile/pushSubscription.js`. Deve partire da un
gesto dell'utente (`NotificationSwitch`), perché iOS lo richiede:

```
pushSupported()      serviceWorker + PushManager + Notification
pushConfigured()     esiste VITE_VAPID_PUBLIC_KEY
Notification.requestPermission()
navigator.serviceWorker.ready
registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
savePushSubscription(...)   upsert su push_subscriptions, onConflict: 'endpoint'
```

La chiave VAPID pubblica arriva dall'ambiente e va convertita da base64url a
`Uint8Array`: è quello che fa `urlBase64ToUint8Array`, e ha un self-check perché è
il classico punto in cui si sbaglia il padding.

**2. L'evento.** Qualcuno scrive una riga: un messaggio, un cambio di stato di un
appuntamento, un piano nuovo. Sulla tabella c'è un trigger.

**3. Il database chiama la funzione.** `notify_user()` (`patches/020`) fa due
cose: inserisce la riga in `notifications`, così il centro notifiche ha la sua
storia anche se il push non parte, e poi legge da `app_config` l'URL della Edge
Function e il segreto condiviso e fa `net.http_post` (pg_net, asincrono). Se la
configurazione manca, esce in silenzio; e ogni eccezione viene inghiottita, perché
una notifica fallita non deve far fallire la scrittura che l'ha generata.

**4. La Edge Function.** `supabase/functions/notify/index.ts`, 91 righe in Deno.
Controlla l'header `x-notify-secret`, legge le subscription dell'utente con la
service role key, firma con le chiavi VAPID e le manda tutte con
`Promise.allSettled`. Gli endpoint che rispondono **404 o 410** vengono
cancellati: sono browser che hanno buttato via la subscription. Restituisce
`{ sent, failed, pruned }`.

È distribuita con `--no-verify-jwt` perché il suo chiamante è Postgres, che non ha
una sessione utente: al posto del JWT c'è il segreto condiviso.

**5. Il browser.** `src/sw.js:26`, handler `push`. Se il payload non è parsabile
si mostra comunque una notifica di default, perché un handler che finisce senza
mostrare niente fa comparire a Chrome il proprio avviso "questo sito è stato
aggiornato in background".

**6. Il tocco.** `src/sw.js:47`, `notificationclick`. L'URL del payload viene
risolto **contro la propria origine** e rifiutato se cade altrove, perché
`openWindow` non è limitato allo scope del worker. Poi: se c'è già una finestra
aperta la si naviga e le si dà il focus, e solo se non ce n'è nessuna se ne apre
una.

**Il punto che smonta l'assunzione sbagliata:** l'applicazione non invoca mai la
Edge Function. La chiama il database. Nel codice client non esiste nessun
`functions.invoke`.

---

## Come allenarti su questi quattro

Prendine uno e raccontalo ad alta voce senza guardare, poi apri i file nell'ordine
in cui li hai nominati. Se un passaggio non lo trovi, il racconto è sbagliato lì.
