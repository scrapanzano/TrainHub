# Funzionamento della Sessione Live di Allenamento

## Introduzione
La funzionalità della sessione di allenamento live è una delle feature centrali di TrainHub, è quindi importante che venga pensata, progettata e implementata con criterio e attenzione.

Inoltre, anche la logica dietro la pagina principale deve essere adeguatamente definita.

Il cliente accede alla pagina principale di allenamento (m/workout). Da qui due possibilità:

* Se il cliente **non** ha un coach assegnato, il sistema chiede al cliente se voglia scegliere un coach. In caso **affermativo**, viene rimandato all'apposita pagina. In caso **negativo** viene comunque concesso al cliente di creare il proprio Workout Plan

* Se il cliente **ha** un coach assegnato, il sistema chiede al cliente se voglia prendere un appuntamento con il suo coach. Nella realtà questo appuntamento serve al coach per capire che Workout Plan creare. Anche in questo caso, il cliente può comunque creare il proprio Workout Plan autonomamente

### Struttura di un Workout Plan
In generale, è quello che in gergo viene chiamata scheda di allenamento, o più in termini tecnici *protocollo* di allenamento. Un protocollo di allenamento è suddiviso in diverse sessioni, normalmente sulla base di quante volte a settimana il cliente riesce ad andare in palestra. Ogni sessione è costituita da un insieme di esercizi che devono essere svolti per quella sessione. Non è possibile creare una sessione di allenamento senza almeno un esercizio al suo interno. Ogni esercizio ha un nome, il gruppo muscolare che allena, quante serie e ripetizioni per serie devono essere eseguite, quanto recupero deve essere fatto tra una serie e l'altra (possono essere 30s, come 1mn, come 1:30mn, ecc.. sono solo esempi di formato), una descrizione testuale sull'esecuzione (idealmente potrebbe essere integrato con un'immagine/video rappresentativo, **valutare**) e infine un peso in Kg (se l'esercizio prevede che vengano utilizzati dei pesi). Infatti, il peso può essere regolato dal cliente sulla base delle sue capacità.

Normalmente un Workout Plan dovrebbe essere **rinnovato** ogni 3/4 mesi, ma è variabile anche sulla base dell'**obiettivo** che vuole essere raggiunto e dal **livello** di **preparazione** fisica del cliente.

Sulla base di quanto appena detto quindi, un Workout Plan è unico nel suo periodo di validità. Creare un nuovo Workout Plan significa sostituire quello precedente (**valutare** l'eventuale possibilità di poter tenere salvati i vecchi Workout Plan). 

Per semplicità, non viene tracciato effettivamente il periodo di validità di un workout plan, quindi non ha una vera e propria data di scadenza oltre la quale è necessario creare un nuovo Workout Plan (autonomamente o dal proprio coach).

**Un cliente può sovrascrivere il Workout Plan creato dal suo Coach?** Realisticamente non è un problema, perché è a discrezione del cliente stesso.

**Un cliente può modificare un Workout Plan creato dal suo coach?** Quindi aggiungere/rimuovere sessioni, aggiungere/rimuovere esercizi dalle sessioni. Direi di **no**.

**Un coach può modificare un Workout Plan creato dal suo cliente?** Anche in questo caso direi di **no**.

Per semplicità in generale, direi che una volta creato il Wokrout Plan è modificabile solo dal creatore stesso.

#### Esempio di Workout Plan

* **Nome:** Ipertrofia
* **Livello:** Intermedio
* **Durata:** 3 mesi 
* **Sessioni:**
   *   **Petto + Spalle:**
       * Distensioni con manubri a panca inclinata (petto): (serie) x (ripetizioni), (recupero)
       * Croci con manubru a panca inclinata (petto): (serie) x (ripetizioni), (recupero)
       * Spinte con manubri su panca (spalle): ...
       * Alzate laterali (spalle): ...
    *  **Schiena + Bicipiti:**  
       * Pull Down (dorsali): ...
       * ...
    * [...]

## Struttura della pagina Workout Plan (lato cliente)
I seguenti elementi sono disposti in verticale se non esplicitamente specificato:
* A sinistra intestazione della pagina: **Workout Plan**
* Banner informativo (tipo come quello attuale), che contiene:
  *  **Nome del Workout Plan**
  * **Livello**
  * **Numero di Sessioni che contiene**
  * **Nome del creatore del Workout Plan**
  * **Durata**
  * **Barra di avanzamento delle sessioni completate**: qui c'è da aprire una parentesi importante. Di solito le sessioni di allenamento hanno cadenza settimanale, quindi ogni lunedì va resettata la barra di avanzamento, perché è iniziata una nuova settimana di allenamento
  * Nell'angolo tutto a destra nel banner metterei un hamburger menu allineato con il nome del Workout Plan (tre punti verticali) che apre un menu con le seguenti voci (**DA VALUTARE BENE**):
    * **Crea Nuovo Workout Plan:** permette di creare un nuovo Workout Plan rendendo **chiaro** che quello attuale verrà sovrascritto prima di proseguire. E' possibile procedere autonomamente con la creazione dello stesso, o affidarsi al proprio coach prenotando una consulenza (se il coach non è assegnato è richiesto che venga fatto)
    * **Modifica Workout Plan:** voce visibile se si è il creatore del suddetto Workout Plan. Con modifica si intende che è possibile aggiungere/rimuovere le sessioni di allenamento. Bisogna rendere **chiaro** che rimuovere una sessione di allenamento elimina se stessa e tutti gli esercizi associati ad essa (attraverso un modale annulla/conferma)
* (Ora dobbiamo elencare le sessioni di cui il Workout Plan è costituito) A sinistra intestazione della sezione: **Training Sessions**. Macroscopicamente una sessione di allenamento è costituita da: nome, numero di esercizi e stato (da svolgere/in svolgimento/completato). In particolare:
  * **Da svolgere:** rappresenta una sessione di allenamento non ancora svolta per quella settimana
  * **In svolgimento:** sessione di allenamento fatta partire come sessione live (rappresenta quindi l'allenamento che sta facendo in quel momento il cliente)
  * **Completata:** rappresenta una sessione di allenamento completata in quella settimana (potremmo inserire in quale giorno è stata completata). Completare una sessione permette anche al cliente (in teoria come già è implementato) di inserire delle note a fine allenamento utili per il coach (se ne ha uno)

**Vincoli sugli stati di una sessione di allenamento:** 
* **Da svolgere:** una sessione di allenamento torna da svolgere ad inizio settimana. Un workout plan si conclude anche con sessioni di allenamento ancora da svolgere, ma dovrà essere adeguatamente tracciato nel resoconto settimanale
* **In svolgimento:** è uno stato mutualmente esclusivo, quindi può esistere al più una sessione di allenamento in questo stato. Iniziare una nuova sessione di allenamento implica che le altre sessioni si trovino o nello stato *da svolgere* o nello stato *completata*. E' possibile abbandonare una sessione di allenamento in questo stato, segnalando però che i dati per questa sessione andranno persi (e non vengono acquisiti punti)
* **Completata:** è possibile completare una sessione di allenamento solo se la suddetta sessione si trova nello stato *in svolgimento*. Una sessione di allenamento risulta completata se vengono svolti tutti gli esercizi. E' possibile completare preventivamente una sessione di allenamento attraverso un comando manuale, ma se una sessione di allenamento viene marcata completata preventivamente, deve essere adeguatamente tracciata. Inoltre, i punti guadagnati da una sessione completata preventivamente, devono essere pesati in base alla percentuale di completamento della sessione stessa

Manterrei quindi la struttura a card arrotondate una sotto l'altra. Card ovviamente cliccabili che permettono di aprire i dettagli di una sessione di allenamento.

**Cosa succede alla pagina se si vuole modificare un Workout Plan?** Cerchiamo il modo più ottimale per renderla più funzionale ed efficiente possibile. Se diventasse tipo un form modificabile? O se ci sono idee migliori le ascolto volentieri

### Struttura della pagina di una Training Session
* Banner informativo (stile Workout Plan) che contiene:
  * **Nome della sessione di allenamento**
  * **Numero di esercizi da cui è composta la sessione di allenamento**
  * **Stato della sessione di allenamento (da svolgere/in svolgimento/completato):** qui potremmo rappresentarlo sia con la dicitura esplicita testuale, che anche implicitamente con il tasto **play/pausa/stop:**
    * Tasto **play:** avvia la sessione di allenamento, dopo aver ricevuto conferma dal cliente tramite modale esplicito (annulla, conferma)
    * Tasto **pausa:** mette in pausa una sessione di allenamento avviata (qui non penso serva una conferma esplicita, perché non è un'azione distruttiva, **valutare**)
    * Tasto **stop:** interrompe manualmente una sessione di allenamento avviata, dopo aver ricevuto conferma dal cliente tramite modale esplicito (annulla, conferma)
  * **Barra di avanzamento degli esercizi completati**
  * Nell'angolo tutto a destra nel banner metterei lo stesso hamburger menu (tre punti verticali) come in Workout Plan (**CI PENSIAMO DOPO**)   
  * (Ora dobbiamo elencare le sessioni di cui il Workout Plan è costituito) A sinistra intestazione della sezione: **Exercises**. Macroscopicamente un esercizio è costituito da:
    * **Nome**
    * **Gruppo muscolare allenato**
    * (serie) x (ripetizioni)
    * tempo di recupero

Manterrei quindi la struttura a card arrotondate una sotto l'altra. Card ovviamente cliccabili che permettono di aprire i dettagli dell'esercizio (dando accesso a tutte le informazioni estese).   

**Cosa succede alla pagina se si vuole modifare una Training Session?** Cerchiamo il modo più ottimale per renderla più funzionale ed efficiente possibile. Se diventasse tipo un form modificabile? O se ci sono idee migliori le ascolto volentieri. Ovviamente nome esercizio e gruppo muscolare sono derivati direttamente dal database e non sono modificabili.
  
**Vincoli di modifica in base agli stati di una sessione di allenamento:**
* **Da svolgere:** è possibile modificarla
* **In svolgimento:** non è possibile modificarla
* **Completata:** è possibile modificarla

**Cosa succede alla pagina se si avvia la sessione di allenamento?** 
* **Banner:** cambia lo stato testuale, il bottone da **play** diventa la coppia **pausa + stop**, compare un timer ben visibile che tiene traccia della durata della sessione d'allenamento, direi anche che scompare l'hamburger menu coi tre puntini verticali. Sarebbe bello che il banner una volta chiusa l'applicazione diventasse un overlay visibile dal menu a tendina o dalla schermata di blocco (stile spotify/youtube)
* **Sezione Exercises:** *NON* si illumina più alcuna card degli esercizi, imponeva una sequenzialità che non può essere sempre rispettata (es. il macchinario è occupato, passo all'esercizio successivo ed a questo ritorno successivamente). Da fuori la card fa comparire l'indicazione di quante serie sono già state svolte, se si raggiunge il numero prefissato, la card si disattiva/fa comparire una dicitura chiara sul fatto che l'esercizio sia stato completato. La card è ancora cliccabile e all'interno si trovano le informazioni per esteso già definite in precedenza, con l'aggiunta della stessa indicazione delle serie svolte, una sezione per poter registrare la serie appena fatta (con indicazione del peso se previsto dall'esercizio) e la possibilità di avviare un timer per il recupero già preimpostato sul recupero consigliato dall'esercizio, ma è comunque possibile modificarlo. Sarebbe inoltre carino che il timer faccia suonare il telefono una volta finito.
  * **Vincolo sul log degli esercizi:** ovviamente non è possibile registrare più serie di quante previste, quindi la sezione si disattiva o si sostituisce con una dicitura chiara che l'esercizio è stato completato