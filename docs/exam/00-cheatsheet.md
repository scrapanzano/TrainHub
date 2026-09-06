# TrainHub — foglio unico

Da rileggere la mattina dell'esame. Tutto il resto sta negli altri file di
`docs/exam/`.

## Che cos'è

PWA per una palestra, due ruoli sopra un solo codebase e un solo database:
**member** (`/m/...`) e **professional** (`/p/...`). Il membro segue o si crea
una scheda, registra l'allenamento dal vivo, consulta la dieta, prenota, chatta,
entra col QR. Il professionista prepara schede e diete, guarda i progressi,
gestisce agenda e clienti, scansiona i badge.

## Stack

| Cosa | Versione | A che serve |
|---|---|---|
| React | 19.2 | componenti e hook |
| Vite | 8.1 | dev server, build, code splitting |
| MUI + Emotion | 9.2 | componenti e tema |
| React Router | 8.3 | due alberi di rotte, `lazy` per schermata |
| TanStack Query | 5.101 | stato remoto, cache, coda offline |
| supabase-js | 2.110 | auth, Postgres, Realtime, RPC |
| vite-plugin-pwa | 1.3 | manifest e lista dei file da precache |
| Workbox | 7.4 | precache e navigation route dentro `sw.js` |

JavaScript e JSX, **niente TypeScript**. Niente Redux né Zustand.
Il pacchetto è `react-router`, non `react-router-dom` (dalla v7 è unificato).

## I sette livelli di `src/`

```
routes/     l'albero delle rotte, due rami: /m e /p
layouts/    la shell per chi è autenticato + il layout delle pagine pubbliche
features/   le schermate, una cartella per dominio (14)
components/ pezzi riutilizzabili, ricevono props e basta (16)
data/       lettura e scrittura su Supabase, funzioni async pure (13 moduli)
lib/        supabase client, query key, cache, date, uuid
theme/      createTheme + responsiveFontSizes, palette dai token Figma
```

**Regola di dipendenza, una sola direzione:** `data/` non importa React;
`features/` importa `data/`; `components/` non conosce nessuno dei due.
Per questo `lib/week.js` può essere usato sia da una funzione `data/` sia da una
schermata: sta sotto entrambi.

## Numeri

- ~14.900 righe di JS/JSX in 119 file, più 17 self-check
- 21 tabelle, 26 patch SQL applicate in ordine
- 4 destinazioni nella bottom bar per ruolo, profilo dietro l'avatar
- cache persistita per **7 giorni**, `staleTime` 30 secondi
- token del badge: 8 caratteri, alfabeto da 32 simboli, **60 secondi** di vita
- punti: 30 per un allenamento completo, 10 per un check-in

## Le cinque regole non ovvie

1. **Lo stato d'errore si decide su `data === undefined`, mai su `isError`.**
   Con `offlineFirst` un refetch fallito lascia i dati buoni in cache: una
   schermata d'errore sopra dati usabili dice "l'app è rotta" mentre sta facendo
   esattamente il suo mestiere.
2. **Ogni lettura ha `.retry(navigator.onLine)`, nessuna scrittura ce l'ha.**
   postgrest ritenta tre volte con backoff 1/2/4 secondi: offline diventerebbero
   sette secondi di schermo vuoto. Le scritture invece devono mettersi in pausa.
3. **Ogni scrittura è registrata in `src/data/mutations.js`.** Il persister
   salva la mutation in pausa *per chiave* e ritrova la funzione da lì. Una
   mutation ripristinata senza default viene scartata in silenzio.
4. **Se l'ordine conta, la mutation ha uno `scope`.** `resumePausedMutations`
   altrimenti rigioca in parallelo e la scrittura vecchia può vincere.
5. **RLS è il confine di sicurezza, ma non è il primo cancello.** Postgres
   controlla il GRANT sulla tabella *prima* di valutare qualsiasi policy: una
   tabella con policy perfette e senza grant risponde `42501 permission denied`.

## Le tre cose che il corso valuta esplicitamente

- **Manifest e installabilità**: manifest inline in `vite.config.js`,
  `display: 'standalone'`, `orientation: 'portrait'`, colori uguali ai token.
- **Service worker**: scritto a mano (`src/sw.js`), modalità `injectManifest`,
  perché deve contenere anche `push` e `notificationclick`.
- **Tema responsive**: `createTheme` + `responsiveFontSizes` in
  `src/theme/index.js`, palette generata da `doc/assets/variables.tokens.json`.

## Se la domanda ti coglie impreparato

Tre risposte oneste che valgono più di un'invenzione:

- "Quel pezzo non l'ho scritto io, ma so cosa fa e come si collega al resto."
- "Non lo ricordo a memoria, ma so dove sta: è in `src/…`."
- "Questa cosa il progetto non la fa, e la scelta è dichiarata in relazione."
