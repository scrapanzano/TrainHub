# Nutrition Plan
La parte di nutrizione gioca un ruolo secondario all'interno di TrainHub, ma necessità comunque che le sue informazioni siano organizzate in maniera logica e coerente.

Il Personal Trainer è la figura che si occupa della creazione (può anche visualizzarlo) del Nutrition Plan, mentre il cliente lo può solo visualizzare.

## Struttura di un Nutrition Plan (fonte Gemini)
Un piano alimentare professionale si divide solitamente in un'anagrafica tecnica, con i parametri bersaglio, e in un'agenda operativa che distribuisce gli alimenti nella settimana.

## 1. Parametri Generali del Piano
* **Obiettivo/Titolo:** Definisce lo scopo del percorso (es. "Fase di Definizione", "Mantenimento", "Ricondizionamento", "Ipertrofia").
* **Calorie Target:** Il fabbisogno calorico giornaliero stabilito (es. 2100 kcal).
* **Macronutrienti Totali:** La ripartizione di base, espressa sia in percentuale che in grammi (es. 50% Carboidrati [260g], 30% Proteine [155g], 20% Grassi [45g]).
* **Indicazioni Accessorie:** Target di idratazione (es. 2,5 litri di acqua), integrazione consigliata e gestione dei condimenti (es. "Totale di 3 cucchiai di olio extravergine d'oliva al giorno da distribuire").

## 2. Organizzazione Settimanale (Giorni Tipo)
Invece di legare i menù a specifici giorni della settimana (Lunedì, Martedì), un approccio molto più funzionale e logico utilizza i **"Giorni Tipo"** o **"Menù"** (es. Giorno A, Giorno B, Giorno C). 

Questo permette di:
- Incrociare liberamente le giornate a seconda degli impegni.
- Ripetere lo stesso menù per più giorni consecutivi (es. Lunedì e Martedì = Giorno A) per ottimizzare la spesa e la preparazione in anticipo (*meal prep*).

## 3. Dettaglio dei Pasti
All'interno della giornata, inserire le calorie e i macronutrienti per singolo pasto non è strettamente obbligatorio, ma è estremamente utile per chi vuole flessibilità: conoscendo il "peso" del pasto, diventa facile usare un'app per sostituire un alimento rispettando i macro.

### Esempio di Giorno Tipo (Menù A)

| Pasto | Alimento e Grammatura a crudo | Macro del Pasto (Opzionale) | Alternative rapide |
| :--- | :--- | :--- | :--- |
| **Colazione** | 150g Yogurt greco 0%, 40g Avena, 15g Mandorle | 270 kcal (18g P, 30g C, 9g G) | 200g Albume, 4 Fette biscottate, 15g Noci |
| **Spuntino** | 1 Frutto di stagione (es. 150g Mela) | 80 kcal (0g P, 20g C, 0g G) | 150g Pera o 2 Kiwi |
| **Pranzo** | 80g Riso basmati, 150g Pollo, 200g Zucchine | 460 kcal (40g P, 65g C, 5g G) | 80g Farro, 150g Tacchino |
| **Spuntino** | 30g Parmigiano o Grana | 120 kcal (10g P, 0g C, 9g G) | 1 Uovo intero e 10g Mandorle |
| **Cena** | 200g Salmone, 250g Patate, Verdura a piacere | 580 kcal (45g P, 40g C, 25g G) | 250g Branzino, 60g Pane integrale, 10g Olio |

*Nota: Questa impostazione a moduli con le relative alternative garantisce flessibilità senza obbligare a calcoli complessi ogni giorno, mantenendo il controllo costante sull'introito nutrizionale.*

## Struttura implementata in TrainHub del Nutrition Plan
Attualmente il Nutrition Plan è costituito da:
* **Informazioni Generali:** 
    * Plan name
    * Kcal
    * Protein g
    * Carbs g
    * Fat g
* **Daily Meals:**
    * **Informazioni Generali:**
        * Name
        * Time
        * kcal
    * **Food:**
        * Name
        * Quantity

## Struttura attuale della pagina Nutrition lato Client
La pagina è attualmente strutturata in questo modo:
* **Hero Section:** informazioni generali del Nutrition Plan
* **Your Week:** picker smart del giorno della settimana, attualmente inutile, perché ogni giorno mostra gli stessi *Daily Meals*
* **Daily Meals:** elenco tramite card di ogni *Meal*. La card è cliccabile e permette di mostrare la pagina dedicata ai dettagli del singolo *Meal*

## Struttura attuale della pagina Nutrition Plan di un cliente lato Personal Trainer
Attualmente, la pagina è strutturata allo stesso modo di quella lato cliente, tranne per il picker smart del giorno della settimana, che non è presente. Il problema è che la pagina mostra una vista di modifica, quindi il Personal Trainer non ha una vista di *sola visualizzazione*. Potrebbe essere una scelta implementativa, ma non mi fa troppo impazzire. 

## Flusso lato Client
Il cliente accede alla pagina *Nutrition* e qui le possibilità sono due:
1. Il cliente **non** ha un Nutrition Plan:
    * Se il cliente **ha** associato un Personal Trainer, allora viene invitato a fissare un appuntamento con esso
    * Se il cliente **non** ha associato un Personaò Trainer, allora viene invitato a sceglierne uno
2. Il cliente **ha** un Nutrition Plan:
    * Vede direttamente nella pagina il suo Nutrition Plan

## Flusso lato Personal Trainer
Il Personal Trainer accede alla pagina del Nutrition Plan del cliente e qui le possibilità sono due:
1. Il cliente **non** ha un Nutrition Plan: il Personal Trainer può procedere alla creazione dello stesso
2. Il cliente **ha** un Nutrition Plan: 
    * Il Personal Trainer visualizza il Nutrition Plan del cliente
    * Il Personal Trainer può rimpiazzare il Nutrition Plan attuale creandone uno nuovo da zero

Manteniamo le stesse scelte prese per Workout Plan:
* Nessun edit, si sostituisce direttamenet il piano vecchio. Ovviamente, bisogna rendere esplicito che il vecchio piano verrà sovrascritto da quello nuovo, e solo nel momento in cui la procedura di creazione del nuovo piano verrà portata a termine
* E' possibile annullare in qualasiasi momento l'operazione
Insomma, il flusso possiamo riciclarlo, ma ragioniamoci assieme.