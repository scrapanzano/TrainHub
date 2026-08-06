# TrainHub

A gym PWA built for the Mobile Application Development course, Università di
Brescia. Two roles — **member** (`/m/...`) and **professional** (`/p/...`) —
sharing one codebase, one theme and one offline strategy.

React 19 · Vite 8 · MUI v9 · TanStack Query v5 · React Router 8 · Supabase ·
plain JS/JSX, no TypeScript.

---

## Setup, step by step

You need **Node.js 20.19+** (or 22.12+), a free Supabase account, and about
twenty minutes. Steps 1–6 get the app running. Steps 7–8 are only needed for push
notifications, and everything else works without them.

### 1. Clone and install

```bash
git clone https://github.com/scrapanzano/TrainHub.git
cd TrainHub
npm install
```

### 2. Create a Supabase project

At [supabase.com](https://supabase.com) → **New project**. Pick any region;
`eu-central` is closest. Write down the database password — you will not need it
for this project, but Supabase will not show it again.

Wait for provisioning to finish before continuing. A project that is still
starting up answers SQL with confusing errors.

### 3. Fill in the environment file

```bash
cp .env.example .env.local
```

Open `.env.local` and fill the first two values from **Project Settings → API**:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable / anon key>
VITE_VAPID_PUBLIC_KEY=<leave empty for now — step 7>
```

> `VITE_*` variables are inlined into the JavaScript bundle, so they are public
> by design. Only the **publishable (anon)** key belongs here — never the secret
> service-role key. Row Level Security is what actually protects the data.

`.env.local` is gitignored and never leaves your machine.

### 4. Run the SQL, in this exact order

Open **SQL Editor** in the Supabase dashboard. Paste and run each file's whole
contents, one at a time.

| # | File | What it does |
|---|---|---|
| 1 | `supabase/schema.sql` | Tables, enums, and the trigger that mirrors `auth.users` into `profiles` |
| 2 | `supabase/policies.sql` | Row Level Security policies for every table |
| 3 | — | **Create the two demo users** (step 5 below) |
| 4 | `supabase/seed.sql` | Demo plan, meals, appointments, exercises, rewards |

**The order matters.** `schema.sql` installs the trigger that creates a
`profiles` row for each new user. Users created *before* it exists get no
profile, and the seed then fails on a foreign key.

### 5. Create the demo users

**Authentication → Users → Add user**, twice. Tick **Auto Confirm User** on both.

| Email | Password | Role |
|---|---|---|
| `daniel@trainhub.dev` | `TrainHub2026!` | member |
| `andrea@trainhub.dev` | `TrainHub2026!` | professional |

Without **Auto Confirm User**, sign-in fails with a generic
`Invalid login credentials` — Supabase's way of not leaking whether an address is
registered. It looks like a wrong password and is not.

Then go back and run `supabase/seed.sql` (step 4, row 4).

### 6. Apply the patches, then verify

`supabase/patches/` holds fixes and additions layered on top of the base schema.
Run **all fourteen in numeric order**, `001` through `014`. Several print their
own PASS/FAIL block — read it before moving to the next.

Two of them matter especially, because the workout half does not run without
either: `013-workout-runs.sql` creates the `workout_runs` table, and
`014-workout-run-pct.sql` adds a column `013` should have carried.

Finally run `supabase/verify.sql`. It prints one row per check.

- The **five schema and security rows** must all read `PASS`. Three of them
  expect 18 against 19 tables **on purpose** — `app_config` is policy-less and
  grant-less by design.
- **Seven seed-count rows read `FAIL` by design.** Four because
  `patches/005-demo-clients.sql` adds demo clients the original counts did not
  expect; three (`messages`, `rewards`, `checkins`) because real use during
  device testing grew them. The comment in the file explains why the
  expectations are deliberately not bumped.

Then, from your terminal:

```bash
node supabase/probe-rls.mjs
```

Every row must read `PASS`. This asks each table what it returns to a caller
holding only the publishable key — the question `verify.sql` structurally
**cannot** answer, because it runs as the dashboard's privileged role and
bypasses RLS entirely. Phase 0 shipped a policy that looked fine and was public
to the whole internet; no SQL check caught it.

### 7. Push notifications — VAPID keys *(optional)*

Skip this and everything works except push. Come back to it when you need it.

Generate a key pair:

```bash
npx web-push generate-vapid-keys
```

Put the **public** key into `.env.local` as `VITE_VAPID_PUBLIC_KEY`. Keep the
private key for the next step — it must never enter the repository.

Then, in the SQL editor, insert the two rows `patches/010` deliberately left
empty:

```sql
insert into app_config (key, value) values
  ('notify_function_url', 'https://<project-ref>.supabase.co/functions/v1/notify'),
  ('notify_secret',       '<a long random string you invent>')
on conflict (key) do update set value = excluded.value;
```

Also enable the **`pg_net`** extension under **Database → Extensions**. Without
it the database cannot call out to the Edge Function.

### 8. Deploy the Edge Function *(optional, follows step 7)*

```bash
npx supabase login          # interactive, opens a browser
npx supabase link --project-ref <project-ref>
npx supabase functions deploy notify
```

No installation needed — `npx supabase` resolves the CLI on demand.

Then set its secrets. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided
by the platform; these five are yours:

```bash
npx supabase secrets set \
  VAPID_SUBJECT="mailto:you@example.com" \
  VAPID_PUBLIC_KEY="<public key from step 7>" \
  VAPID_PRIVATE_KEY="<private key from step 7>" \
  NOTIFY_SECRET="<the same random string you put in app_config>"
```

`NOTIFY_SECRET` must match `app_config.notify_secret` exactly. It is what proves
to the function that a request really came from your database.

---

## Running it

```bash
npm run dev       # dev server on http://localhost:5173
npm run build     # production build into dist/
npm run preview   # serve the built dist/
npm run lint      # eslint over the repo
```

**The service worker does not exist in `dev`.** Anything about installing the
app, offline behaviour or caching must be tested with `npm run build && npm run
preview`, never with `npm run dev`.

### Verifying a change

There is no test runner and none is being added. The equivalent is:

```bash
npm run lint
npm run build
```

**Run both.** ESLint never resolves module paths; Vite does at build time. An MUI
icon glyph that the installed version does not ship passes lint and breaks the
build.

Non-trivial pure logic ships an `assert`-based self-check beside it. There are
ten — run them all after touching anything shared:

```bash
node src/lib/format.selfcheck.js
node src/lib/week.selfcheck.js
node src/theme/resolveTokens.selfcheck.js
node src/features/workout/timer.selfcheck.js
node src/features/workout/status.selfcheck.js
node src/features/workout/summary.selfcheck.js
node src/features/clients/subscription.selfcheck.js
node src/features/calendar/month.selfcheck.js
node src/features/progress/progress.selfcheck.js
node src/features/profile/pushSubscription.selfcheck.js
```

### Testing offline

With `npm run preview` running: open DevTools → **Network → Offline**, or use the
**Application → Service Workers → Offline** checkbox. Navigate, log a set, book
an appointment. Writes pause and replay on reconnect; reads serve from the
persisted cache.

### Testing on a real phone

The app must be served over HTTPS for a phone to install it or receive push, so
`localhost` will not do. Use ngrok:

```bash
npm run build && npm run preview
ngrok http 4173
```

On Windows: `winget install --id ngrok.ngrok`, then
`ngrok config add-authtoken <token>` from dashboard.ngrok.com. The PATH ngrok
adds is invisible to shells that were already open — restart the terminal.

Open the ngrok HTTPS URL on the phone. **On iPhone you must use Safari** and
*Share → Add to Home Screen*: Web Push does not exist for a site open in an iOS
browser tab, and Chrome for iOS cannot install a PWA at all. iOS 16.4+.

---

## Where the project's reasoning lives

Read these before changing anything substantial. They carry decisions and
failures the code does not explain.

| Path | What it is |
|---|---|
| `CLAUDE.md` | The operating rules. Every line of "Rules that exist because breaking them cost a day" is a defect that shipped. |
| `.superpowers/sdd/progress.md` | The implementation ledger — one entry per task, what each review found, what is still owed to a human. |
| `docs/ONBOARDING-AGENT.md` | The briefing for an AI agent joining the project. Also the fastest way for a person to get oriented. |
| `docs/superpowers/specs/` | One design spec per phase, each decision paired with the alternative it beat. |
| `docs/superpowers/plans/` | One implementation plan per phase. |
| `doc/context.md` | Course and PWA requirements. |
| `doc/assets/` | Figma wireframes and the design tokens `src/theme/tokens.js` imports directly. |

---

## Working agreement

- **Commits belong to Davide.** Conventional Commits, no `Co-Authored-By`
  trailer.
- **Never push or merge without being asked. Never delete a branch** — every
  phase branch is kept deliberately.
- Schema work always ends in a handoff: write the patch file, Davide applies it
  in the SQL editor and reports the PASS/FAIL block.
- Phases run spec → plan → task-by-task execution with a review per task → a
  whole-branch review at the end. That final review has caught a Critical in
  every phase so far.

## Status

Phases 0 through 5A are built and merged into `main`. Queued next, in dependency
order: the professional's side of the workout rebuild, the notification bell, and
the hardening pass plus the LaTeX report. `docs/ONBOARDING-AGENT.md` §6 has the
detail.
