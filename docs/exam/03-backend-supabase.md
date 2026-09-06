# Backend: Supabase, RLS, RPC

Il backend non è un server scritto da noi: è Postgres esposto via PostgREST, più
l'autenticazione, il Realtime e una Edge Function. Tutta la logica che non può
fidarsi del browser sta in SQL.

---

## 1. Le tabelle, per area

21 tabelle. Non serve elencarle a memoria, serve saperle raggruppare.

| Area | Tabelle |
|---|---|
| Account | `profiles` |
| Allenamento | `exercises`, `workout_plans`, `workout_sessions`, `session_exercises`, `workout_runs`, `set_logs` |
| Nutrizione | `nutrition_plans`, `nutrition_days`, `meals` |
| Organizzazione | `availability`, `appointments` |
| Comunicazione | `threads`, `messages`, `notifications` |
| Accesso alla struttura | `checkin_tokens`, `checkins` |
| Progressi e premi | `rewards`, `body_metrics` |
| Device e configurazione | `push_subscriptions`, `app_config` |

Lo schema è relazionale con **una eccezione dichiarata**: gli alimenti dentro un
pasto sono una colonna `jsonb` (`meals.items`), non una quarta tabella. Non
vengono mai interrogati da soli, non sono referenziati da nessuno e si leggono e
scrivono sempre insieme al pasto: un quarto livello di join non avrebbe comprato
niente.

### Le due distinzioni concettuali da saper spiegare

**Sessione contro run.** `workout_sessions` descrive *cosa va fatto* (il Chest
Day con i suoi esercizi). `workout_runs` registra *un tentativo*: quando è
iniziato, le pause, la percentuale finale, l'esito, la nota del membro. La stessa
sessione si allena ogni settimana, quindi lo stato non può stare sulla sessione:
è **derivato** dalle run della settimana corrente (`src/lib/week.js`,
`runStatusOf`).

Onestà da mettere in chiaro: la colonna `workout_sessions.status` del vecchio
disegno esiste ancora e viene perfino selezionata dal client, ma nessuno la legge
per decidere qualcosa. È rimasta perché toglierla è una migrazione distruttiva
che non comprava niente.

**Piano corrente contro storico.** Modificare un piano non lo sovrascrive: crea
un piano nuovo con `replaces_plan_id` che punta al precedente. Un indice unico
parziale garantisce che un piano possa essere sostituito **una volta sola**. Il
piano corrente è semplicemente il più recente (`order by created_at desc limit 1`).
Così una correzione di oggi non riscrive il significato di un allenamento fatto
un mese fa, che continua a puntare al piano con cui è stato eseguito.

---

## 2. I due cancelli: GRANT prima, policy poi

Questa è la domanda di sicurezza più probabile, ed è quella su cui è facile dire
una cosa a metà.

Il browser si connette a Supabase con la **publishable key** (o anon key). Quella
chiave finisce dentro il bundle JavaScript, quindi è pubblica per costruzione:
identifica il progetto e non concede niente da sola. Ogni richiesta porta con sé
l'identità dell'utente autenticato (il JWT), e Postgres risponde in **due fasi**:

1. **Il GRANT sulla tabella.** Il ruolo `authenticated` ha o non ha il privilegio
   di fare SELECT/INSERT/UPDATE su quella tabella.
2. **Le policy di Row Level Security.** Solo se il primo cancello è passato,
   Postgres valuta le policy riga per riga.

Le due conseguenze, entrambe silenziose dal punto di vista dell'applicazione:

- una tabella con policy perfette e **senza** grant risponde
  `42501 permission denied` a tutti, e sembra un bug delle policy;
- una policy la cui condizione **non nomina mai `auth.uid()`** è leggibile da
  chiunque abbia la chiave pubblica, cioè da chiunque. La fase 0 del progetto ha
  spedito esattamente questo caso, corretto poi da `patches/001`.

Il commento in cima a `policies.sql:5-11` racconta questa sequenza.

## 3. `owns_member`: un solo predicato per due ruoli

```sql
create function is_professional() returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role = 'professional');
$$;

create function owns_member(target uuid) returns boolean
language sql security definer stable set search_path = '' as $$
  select target = auth.uid()
      or exists (select 1 from public.profiles
                 where id = target and assigned_pro_id = auth.uid());
$$;
```

e sopra ci si costruiscono le policy, tutte uguali:

```sql
create policy workout_runs_select on workout_runs
  for select using (owns_member(member_id));
```

Undici tabelle usano questo predicato. Se ti chiedono "come fai a impedire che un
professionista veda i clienti di un altro", la risposta è una riga sola: la
seconda metà di `owns_member`.

### Perché `security definer` e perché `search_path = ''`

`security definer` significa che la funzione gira con i privilegi di chi l'ha
creata, non del chiamante: serve perché la funzione deve leggere `profiles` senza
ricadere dentro le stesse policy che sta aiutando a valutare (sarebbe una
ricorsione).

`search_path = ''` con i nomi qualificati `public.profiles` è una **misura di
sicurezza**, non uno stile. Postgres risolve un nome non qualificato passando
prima da `pg_temp`, e qualunque utente autenticato può creare tabelle
temporanee. Un membro che crea una `profiles` temporanea con il proprio id e
`role = 'professional'` farebbe dire di sì a una funzione che gira come
proprietario e bypassa RLS. `patches/011` è la patch che ripara i database creati
prima di questa correzione.

## 4. Ogni scrittura è una RPC

Da `patches/015` in poi, i privilegi diretti di INSERT/UPDATE/DELETE sono stati
**revocati** su tredici tabelle, e ogni scrittura passa da una funzione
`security definer` chiamata via `supabase.rpc(...)`. Le convenzioni: nome che
finisce in `_secure`, `set search_path = ''`, `revoke execute … from public, anon`
e `grant execute … to authenticated`.

Restano scrivibili direttamente sei tabelle, e ognuna ha una ragione: `profiles`
(solo quattro colonne aggiornabili), `exercises` (catalogo condiviso, scrivibile
dai professionisti), `availability`, `messages` (INSERT libera, UPDATE limitata a
`read_at`), `checkin_tokens` (solo INSERT del proprio token), `push_subscriptions`.

**Perché una RPC e non tre scritture dal client.** Prendi la creazione di un
piano: piano, sessioni ed esercizi devono esistere insieme o non esistere. Tre
insert dal browser possono interrompersi a metà e lasciare un piano senza
sessioni, che è esattamente lo stato che l'app rifiuta di mostrare. Dentro una
funzione plpgsql sono una transazione sola.

Stessa cosa per la chiusura di un allenamento: percentuale, esito e premio devono
essere calcolati e scritti insieme, e devono essere calcolati **dal server**,
perché è l'unico che non può essere modificato dall'utente.

## 5. Idempotenza e concorrenza

Tre meccanismi diversi, che spesso vengono confusi in uno.

**Id generato dal client.** `workout_runs`, `set_logs` e `messages` hanno
`id uuid primary key` **senza** `default gen_random_uuid()`: l'id lo porta chi
scrive. Un replay atterra sulla stessa riga. Diversi RPC accettano anche l'id per
tabelle che avrebbero un default (piano, sessioni, appuntamenti).

**Confronto del contenuto dopo il conflitto.** Non basta `on conflict do
nothing`: se lo stesso id arriva con contenuto diverso, è un errore, non un
replay. Le RPC di creazione confrontano i campi e alzano `23505` se non
combaciano. Così un retry dopo una risposta persa riesce, ma una collisione di id
non passa in silenzio.

**Compare-and-swap sul piano precedente.** Chi crea un piano manda anche l'id del
piano che crede di sostituire. La RPC rilegge qual è il più recente per quel
membro e, se non coincide, alza `40001` con il messaggio *"the member plan changed
before this save arrived"*. È il caso del membro offline e del professionista che
nel frattempo ha caricato una scheda nuova.

## 6. L'abbonamento, applicato dal server

```sql
has_active_subscription(member_id) :=
  subscription_status not in ('suspended','expired')
  and (subscription_until is null or subscription_until >= current_date)
```

Chiamata in quattro punti: creazione piano workout, creazione piano nutrizione,
prenotazione (solo se a prenotare è il membro: un professionista può fissare un
appuntamento anche a un cliente scaduto), assegnazione dei punti alla chiusura di
una run. Il check-in ha il suo controllo gemello scritto a mano dentro
`redeem_checkin_token`, perché lì servono due esiti distinti (`suspended` e
`expired`) da mostrare allo scanner.

Nota che la funzione **non è concessa a `authenticated`**: è raggiungibile solo da
dentro altre funzioni definer. Un grant permetterebbe a qualunque utente loggato
di sondare lo stato di abbonamento di un UUID arbitrario.

Nota onesta: nessun job riscrive lo stato quando la data passa. È il confronto
sulla data a catturarlo, quindi il comportamento è corretto ma lo stato
memorizzato e quello effettivo possono leggersi diversi.

## 7. Realtime e push: chi chiama chi

**Realtime** è una sottoscrizione WebSocket a `postgres_changes`. Due usi:
i messaggi di una conversazione e il contatore delle notifiche. In entrambi i
casi l'evento **non porta i dati alla schermata**: fa da innesco per invalidare la
query, che resta la fonte di verità. Se il socket muore in silenzio, un polling da
60 secondi tiene comunque tutto allineato.

**Push**, e qui la domanda cattiva è "chi chiama la Edge Function":

```
INSERT su una tabella
      -> trigger Postgres (on_message_notify, on_appointment_status_notify, …)
      -> notify_user(): scrive la riga in `notifications`
                        e legge url e segreto da `app_config`
      -> net.http_post (pg_net, asincrono)
      -> Edge Function `notify` (Deno)
            firma con le chiavi VAPID, invia a ogni endpoint dell'utente,
            cancella gli endpoint che rispondono 404 o 410
      -> il push arriva al browser
      -> src/sw.js: handler `push` -> showNotification
      -> tocco -> handler `notificationclick` -> riusa la finestra aperta
```

Il browser **non** invoca mai la Edge Function: la chiama il database. La ricerca
`functions.invoke` in `src/` non trova niente.

Due dettagli difendibili in `sw.js`: la notifica viene mostrata anche se il
payload non è parsabile (altrimenti Chrome mostra il proprio avviso "questo sito
è stato aggiornato"), e l'URL del payload viene risolto contro la **propria**
origine e rifiutato se cade altrove, perché `openWindow` non è limitato allo scope
del worker e un URL assoluto ostile aprirebbe una pagina altrui con l'icona di
TrainHub.

`app_config` è l'unica tabella **senza grant e senza policy**: contiene l'URL e il
segreto della funzione, ed è raggiungibile solo da dentro il database.

## 8. Come si verifica che tutto questo sia vero

Tre strumenti, e il punto è che nessuno dei tre basta da solo.

| Strumento | Cosa prova | Cosa NON può provare |
|---|---|---|
| `verify.sql` | struttura, grant, esistenza delle policy, funzioni protette, e una serie di conteggi di integrità che devono valere zero | gira con i privilegi del dashboard, quindi **bypassa RLS**: sa che una policy esiste, non che sia giusta |
| `probe-rls.mjs` | fa le stesse domande che farebbe un attaccante, con in mano solo la chiave pubblica del bundle: ogni tabella deve rispondere zero righe | non dice se un utente legittimo riesce a leggere ciò che gli serve |
| `probe-security.mjs` | entra come i due account demo e verifica che le tabelle necessarie siano davvero raggiungibili | è il controllo opposto: coglie una policy troppo stretta |

L'esempio concreto: la policy pubblica della fase 0 è stata trovata **solo** dalla
sonda anonima. Nessun controllo SQL poteva vederla, perché tutti giravano con
privilegi che saltavano RLS.
