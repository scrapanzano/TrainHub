# Passata di rifinitura UI/UX

Registro della passata di rifinitura sul branch `ux-refinement`. Ogni riga lega
un sintomo osservato all'euristica di Nielsen che viola e all'intervento che lo
risolve, con il file in cui si trova.

Le euristiche sono qui come criterio di ordinamento, non come adempimento: era
il modo più utile per raggruppare una lista lunga di difetti eterogenei. Questo
documento non è materiale per la relazione.

## Metodo

L'interfaccia di TrainHub è stata derivata dai prototipi Figma
(`doc/assets/`). I prototipi sono uno strumento di esplorazione, non un
oracolo: dove avevano problemi di usabilità, l'applicazione li ha ereditati
insieme al layout.

La valutazione si è svolta in due passaggi indipendenti, poi incrociati:

1. **Ispezione manuale sul dispositivo**, condotta dall'autore usando entrambi
   gli account demo. Il risultato è `doc/review.md`.
2. **Lettura sistematica del codice sorgente**, schermata per schermata, alla
   ricerca di violazioni che l'uso non fa emergere subito — stati vuoti mai
   raggiunti in demo, percorsi offline, controlli senza equivalente da
   tastiera.

Il secondo passaggio ha confermato quasi tutti i rilievi del primo e ne ha
aggiunti altri: tre paradigmi diversi per la stessa conferma distruttiva,
cinque frecce "indietro" disegnate a mano con due glifi diversi, due schermate
prive di qualsiasi via d'uscita.

**Vincoli posti in partenza.** Colore brand, struttura della top bar e della
bottom navigation sono rimasti invariati: l'obiettivo era una rifinitura, non
un redesign, e l'identità visiva del prototipo è parte del lavoro consegnato.

## Sintesi quantitativa

| | |
|---|---|
| File modificati | 56 |
| Righe aggiunte / rimosse | 2 726 / 972 |
| Commit | 5 lotti tematici, più documentazione e correzioni di review |
| Self-check `assert` | da 11 a 13 |
| `window.confirm` residui | 0 (erano 8) |

---

## 1. Far vedere lo stato del sistema

| Sintomo osservato | Intervento | File |
|---|---|---|
| Nessun anello di focus visibile fuori dai campi MUI: navigando da tastiera non si sa dove si è | Una regola su `MuiButtonBase` copre Button, IconButton, ListItemButton, CardActionArea, Chip e BottomNavigationAction; i link li prende `CssBaseline` | `src/theme/index.js` |
| Tre card della scheda cliente scrivono la stringa `"Loading…"` nello stesso grigio di `"No plan assigned yet"`: durante il primo fetch il professionista legge una risposta che non è ancora una risposta | `Skeleton` al posto del testo | `src/features/clients/ClientDetailScreen.jsx` |
| In pausa l'allenamento è visivamente identico a quello in corso, e le serie restano registrabili | Log bloccato in pausa, con l'avviso che ne dà il motivo | `src/features/workout/ExerciseDetailScreen.jsx` |
| Il dialogo di sessione completata compare solo tornando alla schermata live: chi registra l'ultima serie dal dettaglio esercizio non sa di aver finito | Alla chiusura della run si naviga alla schermata live, che alza il dialogo all'arrivo | `src/features/workout/ExerciseDetailScreen.jsx` |
| Bottone di refresh su tre query che già fanno polling ogni 60 s, privo di stato di attesa: premendolo non accade nulla di visibile | Rimosso | `src/features/progress/ClientProgressScreen.jsx` |
| Le notifiche non lette si distinguono solo per un punto da 8 px a fine riga | Fondo tenue (brand al 7 %) oltre al punto, e contatore sul filtro | `src/features/notifications/NotificationsScreen.jsx` |
| L'intestazione della conversazione scorre via: risalendo una chat lunga si perde di chi è | Intestazione ancorata sotto la top bar | `src/features/chat/ThreadScreen.jsx` |

## 2. Adeguare il sistema al mondo reale

| Sintomo osservato | Intervento | File |
|---|---|---|
| **"Resume" indica due azioni diverse**: nel mini-player e nella card della sessione *naviga*, sul controllo di pausa *fa ripartire il cronometro* | Il primo diventa "Back to workout"; il secondo resta "Resume" | `src/components/LiveSessionBar.jsx`, `src/features/workout/SessionDetailScreen.jsx` |
| "This Week's Goal" suggerisce un obiettivo fissato dal professionista; è il conteggio delle sessioni del piano | "This week" | `src/features/progress/ClientProgressScreen.jsx` |
| "Suspend membership" non dice cosa perde il cliente | Una riga sotto il bottone: tiene i piani, smette di prenotare e di guadagnare punti | `src/features/clients/ClientDetailScreen.jsx` |
| `window.confirm` mostra sempre "OK" e "Annulla", qualunque cosa si stia confermando | Il bottone porta il verbo dell'azione: Discard, Remove, Delete, Abandon | `src/components/ConfirmDialog.jsx` |

## 3. Controllo dell'utente e libertà

| Sintomo osservato | Intervento | File |
|---|---|---|
| `AvailabilityScreen` e `ScannerScreen` non offrono **nessuna** via d'uscita in-app | `PageHeader` con freccia indietro | `src/features/calendar/AvailabilityScreen.jsx`, `src/features/checkin/ScannerScreen.jsx` |
| Anche la conversazione si lasciava solo con il gesto di sistema | `PageHeader`, con uno slot `leading` nuovo per l'avatar | `src/features/chat/ThreadScreen.jsx`, `src/components/PageHeader.jsx` |
| Lo stato vuoto "Tap to write one" chiede all'utente di indovinare che la card sia premibile | La card resta l'azione, e il testo lo dichiara | `src/features/clients/ClientDetailScreen.jsx` |
| Le password si digitano alla cieca su cinque campi; le impostazioni ne chiedono due identiche senza modo di verificarle | `PasswordField`, con etichetta che nomina il campo per gli screen reader | `src/components/PasswordField.jsx` |

## 4. Assicurare consistenza

| Sintomo osservato | Intervento | File |
|---|---|---|
| **Tre paradigmi per la stessa conferma distruttiva**: 8 `window.confirm` nativi, 3 `Dialog` MUI, 4 bottom sheet | Un solo `ConfirmDialog` per tutte e otto | `src/components/ConfirmDialog.jsx` + 6 chiamanti |
| **Cinque intestazioni fatte a mano**, con due glifi di freccia a due dimensioni diverse | Regola unica: una schermata raggiunta da un solo genitore porta la freccia verso quello, e nient'altro disegna quella riga a mano. Tre convertite; due lasciate di proposito, con il motivo scritto nel componente | `src/components/PageHeader.jsx` + 3 schermate |
| La stessa azione "aggiungi appuntamento" è un mini-`Fab` da un lato e una card full-width dall'altro | Vince la card, su entrambi i lati | `src/features/calendar/CalendarScreen.jsx` |
| Nel dettaglio esercizio le due categorie hanno pesi visivi diversi (piena vs contornata), come se una fosse selezionata | Stessa variante per entrambe | `src/features/workout/ExerciseDetailScreen.jsx` |
| Dialoghi e bottom sheet ereditano raggio 16, le card ne hanno 20: superfici della stessa famiglia con angoli diversi | Allineati a 20 | `src/theme/index.js` |
| `WEEKDAY_INITIALS` duplicato in due file con lo stesso significato | `WEEKDAY_SHORT` e `formatWeekdays` condivisi | `src/lib/format.js` |

## 5. Riconoscimento piuttosto che uso della memoria

| Sintomo osservato | Intervento | File |
|---|---|---|
| I quattro tipi di notifica esistono solo come parola grigia a fine terza riga: la lista va letta, non scorsa | Un'icona e una tinta per tipo; il tipo resta nell'etichetta per screen reader | `src/features/notifications/NotificationsScreen.jsx` |
| La chat è un'icona senza bordo che galleggia fra il bottone abbonamento e il titolo "Overview": unico accesso a un'intera funzione, e sembra un glifo smarrito | Card come le altre, affiancata da una nuova card "Appointments" | `src/features/clients/ClientDetailScreen.jsx` |
| I premi ottenuti sono senza data: quattro "Completed Upper Body A" identici sono indistinguibili | Data mostrata (`earned_at` era già letto dal database e scartato) e raggruppamento per mese | `src/features/rewards/RewardsScreen.jsx` |
| Una conversazione lunga è una colonna ininterrotta: nulla dice dove finisce ieri | Separatori di data e raggruppamento dei messaggi consecutivi | `src/features/chat/ThreadScreen.jsx` |
| "+160 points to next reward" non dice a quale premio | Il premio è nominato | `src/features/rewards/RewardsScreen.jsx` |

## 6. Assicurare flessibilità ed efficienza d'uso

| Sintomo osservato | Intervento | File |
|---|---|---|
| Il piano del cliente è una lista morta: il professionista non può aprire una sessione né vederne gli esercizi, mentre il cliente ha il drill-down completo | Sessioni in accordion, esercizi caricati all'apertura della riga | `src/features/clients/ClientWorkoutScreen.jsx` |
| Il professionista non ha una vista appuntamenti per cliente, e la rotta non esiste | Nuova schermata, divisa fra futuri e passati; nessuna query nuova | `src/features/clients/ClientAppointmentsScreen.jsx` |
| Il calendario nasce collassato: la schermata che serve a mostrare un mese mostra una settimana, e la scelta si azzera a ogni ritorno | Sempre espanso; stato e toggle rimossi | `src/features/calendar/CalendarScreen.jsx` |
| Recupero minimo fissato a 15 s | Portato a 10 s | `src/features/workout/RestTimer.jsx` |
| I punti hanno una sola sorgente, chiudere un allenamento: chi passa in palestra senza allenarsi non guadagna nulla | Il check-in vale 10 punti, una volta al giorno; il badge lo dichiara sotto il QR, dove i punti si guadagnano davvero | `supabase/patches/024-checkin-points.sql`, `src/features/profile/BadgeScreen.jsx` |
| La lista dei premi non ha limite: un anno di allenamenti sono centinaia di card impilate | Prime dieci, poi "Show all" | `src/features/rewards/RewardsScreen.jsx` |
| Il doppio tap fa zoomare per sbaglio mentre si preme un bottone | `touch-action: manipulation` | `src/theme/index.js` |

## 7. Visualizzare tutte e sole le informazioni necessarie

| Sintomo osservato | Intervento | File |
|---|---|---|
| **"This Week's Goal" dice lo stesso numero tre volte** — contatore, fila di pallini, barra — e i pallini da 28 px in uno `Stack` che non va a capo escono dallo schermo già con sei sessioni | Barra e legenda; il resto rimosso | `src/features/progress/ClientProgressScreen.jsx` |
| Le card appuntamento scrivono lo stato due volte: un cerchio vuoto a sinistra (controllo "segna fatto" mai realizzato) e un chip due righe sotto | Cerchio rimosso, chip spostato in fondo alla riga | `src/components/AppointmentCard.jsx` |
| "Body & Nutrition Check-in" chiede al professionista di digitare una misurazione che l'app non usa altrove, sulla schermata destinata a leggere cosa ha fatto il cliente | Sezione rimossa, insieme al codice che serviva solo lei | `src/features/progress/ClientProgressScreen.jsx` |
| Ogni notifica ripete la data completa, anche quando dieci righe di fila sono dello stesso giorno | Raggruppate per giorno; in riga resta l'ora | `src/features/notifications/NotificationsScreen.jsx` |
| Ogni bolla di chat ripete orario e ricevuta: tre messaggi rapidi producono tre timestamp identici in colonna | Solo l'ultimo di una sequenza li porta | `src/features/chat/MessageBubble.jsx` |
| I pasti del piano alimentare sono testo grigio concatenato, cioè il contenuto reso come metadato della card | Righe strutturate con colonna oraria in cifre tabulari | `src/features/nutrition/NutritionPlanEditorScreen.jsx` |

## 8. Prevenire gli errori

| Sintomo osservato | Intervento | File |
|---|---|---|
| Il bottone "Book for this day" compare anche sui giorni passati; il rifiuto si scopre uno sheet dopo | Non compare | `src/features/trainer/MemberAppointmentsScreen.jsx` |
| Il picker apre su un 09:00 fisso: prenotando più tardi nello stesso giorno l'avviso "scegli un orario futuro" compare prima che l'utente tocchi qualcosa | Default alla prossima mezz'ora sul giorno corrente | `src/features/trainer/BookingSheet.jsx` |
| Si registra una serie senza peso: il professionista non distingue un campo dimenticato da un'omissione voluta | Campo obbligatorio | `src/features/workout/ExerciseDetailScreen.jsx` |
| L'asterisco dei campi obbligatori eredita il grigio dell'etichetta — 23 campi su 12 file senza alcun segnale | Rosso e grassetto, dal tema | `src/theme/index.js` |
| "Delete all" su una riga che non va a capo, accanto a "Select" e con lo stesso peso, a un tap dallo svuotare la lista | Spostato in un menu overflow | `src/features/notifications/NotificationsScreen.jsx` |
| Il bottone sospendi/riattiva è il terzo elemento della schermata, sopra tutto il contenuto, dove cade il pollice scorrendo | A fondo pagina, con il colore dell'operazione | `src/features/clients/ClientDetailScreen.jsx` |

## 9. Correggere gli errori, non solo rilevarli

| Sintomo osservato | Intervento | File |
|---|---|---|
| Nel riepilogo del piano in bozza, con zero giorni resta un vuoto e solo il bottone disabilitato lascia intuire il motivo | Stato vuoto che lo dichiara | `src/features/nutrition/NutritionPlanSummary.jsx` |
| Un controllo disabilitato senza motivo è peggio del difetto che risolve | Il blocco del log in pausa spiega perché e cosa fare | `src/features/workout/ExerciseDetailScreen.jsx` |
| `window.confirm` non può dare peso visivo all'azione distruttiva né distinguerla dall'annullamento | Annulla a sinistra e silenzioso, verbo distruttivo a destra e colorato | `src/components/ConfirmDialog.jsx` |

## 10. Fornire aiuto e documentazione

| Sintomo osservato | Intervento | File |
|---|---|---|
| **"How to perform" è una sezione in fondo che sparisce del tutto quando `instructions` è nullo**: un esercizio senza indicazioni è indistinguibile da uno le cui indicazioni sono state superate scorrendo | Icona ⓘ accanto al titolo, che risponde in entrambi i casi | `src/features/workout/ExerciseDetailScreen.jsx` |

---

## Verifica finale: revisione dell'intero branch

Alla passata è seguita una revisione automatica dell'intero branch, indipendente
da chi lo aveva scritto. Ha prodotto **sette rilievi, tutti confermati**
rileggendo il codice: nessun falso positivo. Due erano difetti che la verifica
manuale sul dispositivo non aveva fatto emergere.

**Il campo peso obbligatorio bloccava quattro esercizi.** Il catalogo contiene
`Pull-up`, `Plank`, `Hanging Leg Raise` e `Russian Twist`, prescritti senza
carico. Rendendo il peso obbligatorio, la validazione nativa del form impediva
di registrare anche una sola serie per quegli esercizi: la sessione non poteva
mai arrivare a completa. Il difetto nasce da un'assunzione — "il dataset non ha
esercizi a corpo libero" — creduta senza verificarla contro `seed.sql`. Il
campo ora non compare quando l'attrezzatura è `Bodyweight`, e la serie si
registra con `NULL`, che è come il database ha sempre codificato il corpo
libero.

**L'upload dell'avatar poteva sovrascrivere la foto con un oggetto vuoto.** La
scrittura era registrata come rigiocabile dopo un riavvio, ma trasporta un
`Blob`, e il persister serializza in JSON: un `Blob` sopravvive come `{}`. Se
la connessione cadeva a upload iniziato, il riavvio successivo avrebbe caricato
un file vuoto e vi avrebbe puntato `avatar_url`. Le due scritture dell'avatar
sono ora le uniche dell'applicazione dichiarate `networkMode: 'always'`:
falliscono invece di accodarsi.

Gli altri cinque: il nome del professionista mostrato al posto di quello del
cliente su una schermata dedicata al cliente; due scritture sullo stesso record
senza `scope`, che replicate in parallelo potevano invertirsi; un foglio modale
che poteva restare bloccato su "Uploading…"; l'intestazione della sessione live
rimasta ancorata a `top: 0` dopo che la barra superiore era diventata `fixed`;
e un orario di default che dopo le 23:50 tornava a proporre le 09:00 del
mattino già passato.

Una successiva ricerca di asserzioni non verificate nei commenti ha trovato un
invariante dichiarato ma non vero — la regola sulla freccia indietro, scritta
come se valesse per ogni schermata non radice, mentre quattro categorie di
schermata ne sono legittimamente escluse. Il commento è stato riscritto per
descrivere la regola reale, e la sola schermata che aveva davvero un genitore
unico senza via di ritorno ha ricevuto la freccia.

## Compromesso dichiarato: lo zoom

`doc/review.md` chiedeva di disabilitare lo zoom in-app per avvicinare la resa
a quella di un'applicazione nativa. La richiesta è stata accolta solo in parte.

| Opzione | Effetto | Costo |
|---|---|---|
| `user-scalable=no` nel viewport | Blocca pinch **e** doppio tap | Viola **WCAG 1.4.4** (livello AA), che richiede l'ingrandimento fino al 200 % |
| `touch-action: manipulation` | Blocca **solo** il doppio tap | Nessuno |

È stata adottata la seconda. Il fastidio riportato nasce dal doppio tap che
zooma per errore mentre si preme un bottone; il pinch deliberato non disturba
nessuno, e bloccarlo avrebbe scambiato un problema estetico con una barriera di
accessibilità. Disabilitare lo zoom **non è** un requisito PWA: installabilità e
funzionamento offline sono indipendenti da questa impostazione.

## Nota sui prototipi

Tre interventi riguardano elementi corretti nel prototipo e sbagliati una volta
implementati, e mostrano il limite della prototipazione statica:

- **Il cerchio vuoto sulle card appuntamento** era pensato come controllo rapido
  "segna come fatto". Quel controllo non è mai stato realizzato, e il cerchio è
  rimasto come decorazione che somiglia a una checkbox.
- **Il calendario a doppio stato** (collassato/espanso) ha senso su una tavola
  Figma, dove entrambi gli stati sono visibili affiancati. Nell'applicazione
  produce una schermata che si apre nello stato meno utile.
- **La fila di pallini** dell'obiettivo settimanale è disegnabile per un numero
  fissato di sessioni. Con sei o più, e senza mandare a capo, esce dallo
  schermo.

## Punti per il check-in

`doc/review.md` osservava che i punti avevano una sola sorgente: chiudere un
allenamento. Chi passa in palestra e non si allena non guadagnava nulla.

Il check-in vale ora **10 punti, una volta al giorno**. Il rapporto con i 30 di
un allenamento completo è il messaggio: presentarsi conta, allenarsi conta tre
volte tanto.

Tre cose che la patch `024` deliberatamente **non** aggiunge, e che vale la
pena citare perché sono decisioni e non omissioni:

- **Nessun indice nuovo.** `rewards` ha già `unique (member_id, code)`, quindi
  un codice `checkin:<data>` è una riga per membro per giorno per costruzione.
  Una seconda scansione lo stesso pomeriggio va in conflitto e non fa nulla.
- **Nessun controllo sull'abbonamento.** `redeem_checkin_token` rifiuta già i
  membri sospesi o scaduti e si ferma prima di registrare il check-in, quindi
  ciò che viene dopo quel punto è già protetto. Ripetere il test implicherebbe
  che i due possano dissentire.
- **Nessuna modifica a ciò che vede lo scanner.** Il professionista riceve le
  stesse cinque informazioni di prima: i punti sono affare del cliente.

## Rimandato

Una voce resta aperta e va dichiarata.

- **`save_body_metric_secure`** resta nel database senza chiamanti, dopo la
  rimozione della sezione di check-in corporeo. Lo schema non è stato toccato:
  rimuovere una funzione è una migrazione, e non era in scope.

## Handoff applicato

`supabase/patches/025-avatar-storage.sql` — bucket `avatars` e le sue quattro
policy, applicata e verificata (tutti i controlli PASS). Confina ogni utente
nella propria cartella confrontando il primo segmento del path con
`auth.uid()`, e include un controllo che `verify.sql` strutturalmente non può
fare: che nessuna policy di scrittura ometta `auth.uid()`.
