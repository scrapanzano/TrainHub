# Preparazione all'orale

Materiale per rispondere alle domande sul codice durante la presentazione del
progetto. La relazione racconta TrainHub dall'esterno; questi file servono a
parlarne dall'interno.

Ogni affermazione tecnica è ancorata a `percorso/file:riga`, così una risposta si
può verificare in dieci secondi mentre si ripassa. Se il codice cambia, i
riferimenti vanno ricontrollati.

## I file, nell'ordine in cui conviene leggerli

| File | Cosa contiene | Quando serve |
|---|---|---|
| [`00-cheatsheet.md`](00-cheatsheet.md) | una pagina: stack, livelli, numeri, le cinque regole | la mattina dell'esame |
| [`01-architettura-e-comunicazione.md`](01-architettura-e-comunicazione.md) | i sette livelli, l'avvio, il router, la shell, lo stato, le query key | "come comunicano i pezzi" |
| [`02-pwa-offline.md`](02-pwa-offline.md) | manifest, service worker, cache, coda offline, HTTPS | "dove la tua app è una PWA" |
| [`03-backend-supabase.md`](03-backend-supabase.md) | tabelle, RLS, i due cancelli, RPC, Realtime e push | "come proteggi i dati" |
| [`04-file-commentati.md`](04-file-commentati.md) | 15 file più 2 estratti SQL, commentati a blocchi | "aprimi questo file e commentalo" |
| [`05-flussi-end-to-end.md`](05-flussi-end-to-end.md) | quattro percorsi completi dal tocco alla riga nel database | "fammi vedere come funziona" |
| [`06-domande-e-trappole.md`](06-domande-e-trappole.md) | banco domande con risposte, più nove trappole | ripasso attivo |

## Come allenarsi

1. Leggi `01`, `02` e `03` una volta: sono la mappa.
2. Prendi un flusso da `05` e raccontalo ad alta voce senza guardare, poi apri i
   file nell'ordine in cui li hai nominati. Se un passaggio non lo trovi, il
   racconto è sbagliato lì.
3. Fatti aprire un file a caso fra i diciassette di `04` e commentalo usando solo
   quello che ricordi. Dove ti blocchi, quella sezione va riletta.
4. Il giorno prima, solo `00` e la Parte 2 di `06`.

## I quattro file da tenere aperti durante la presentazione

Se puoi scegliere tu cosa mostrare, questi quattro coprono quasi tutto il
programma del corso e sono i più facili da raccontare:

- `vite.config.js` — manifest e configurazione PWA
- `src/sw.js` — service worker, 76 righe
- `src/data/mutations.js` — la coda offline
- `supabase/policies.sql` — la sicurezza

## Cosa NON c'è qui dentro

Le schermate di nutrizione, calendario, chat, clienti e notifiche non sono
commentate riga per riga: seguono gli stessi schemi di quelle del workout, e chi
ha capito `ExerciseDetailScreen` sa leggerle. Se la domanda cade lì, la risposta è
la mappa di `01` più i due file `data/` e `features/` corrispondenti.
