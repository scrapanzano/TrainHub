# TrainHub

A gym PWA built for the Mobile Application Development course, Università di
Brescia. Two roles — **member** (`/m/...`) and **professional** (`/p/...`) —
sharing one codebase, one theme and one offline strategy.

React 19 · Vite 8 · MUI v9 · TanStack Query v5 · React Router 8 · Supabase ·
plain JS/JSX, no TypeScript.

---

## Setup, step by step

You need **Node.js 20.19+** (or 22.12+), a free Supabase account, and about
twenty minutes. Steps 1–5 get the app running. Steps 6–7 are only needed for push
notifications, and everything else works without them.

> **Only setting up a second machine against a database that already exists?**
> Then none of the SQL below applies. The database lives in Supabase, not in this
> repository: steps 1 and 3 are the whole job — clone, `npm install`, and refill
> `.env.local` from **Project Settings → API**. Steps 2, 4 and 5 create a *new*
> database and are for a fresh Supabase project only.

> `supabase/INSTALL.md` is the authoritative runbook — the ordered install, the
> clean-slate procedure, what each patch does and which earlier version of a
> function it supersedes. What follows is the short form.

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
VITE_VAPID_PUBLIC_KEY=<leave empty for now — step 6>
```

> `VITE_*` variables are inlined into the JavaScript bundle, so they are public
> by design. Only the **publishable (anon)** key belongs here — never the secret
> service-role key. Row Level Security is what actually protects the data.

`.env.local` is gitignored and never leaves your machine.

### 4. Create the demo accounts

**Authentication → Users → Add user → Create new user**, four times. Tick
**Auto Confirm User** on every one.

| Email | Who |
|---|---|
| `marco@trainhub.com` | Marco Ferrari — professional, the main coach |
| `giulia@trainhub.com` | Giulia Ricci — professional, the second coach |
| `daniel@trainhub.com` | Daniel Aresta — the main demo member |
| `sofia@trainhub.com` | Sofia Bianchi — a member of Giulia's, with a self-authored plan |

Use whatever password you like, the same for all four. `probe-security.mjs`
falls back to `TrainHub2026!` unless you set `PROBE_DEMO_PASSWORD` in
`.env.local`.

Without **Auto Confirm User**, sign-in fails with a generic
`Invalid login credentials` — Supabase's way of not leaking whether an address is
registered. It looks like a wrong password and is not.

Five more members (`elena@`, `lorenzo@`, `alex@`, `pierfelice@`, `chiara@`) are
created by the seed as `auth.users` rows with no identity. They have no
credential and cannot sign in, by design.

> `trainhub.com` is a real domain nobody here controls. Auto Confirm skips the
> signup email, but **never trigger a password reset** against these addresses.

### 5. Run the SQL, in this exact order

Open **SQL Editor** in the Supabase dashboard. Paste and run each file's whole
contents, one at a time.

| # | File | What it does |
|---|---|---|
| 1 | `supabase/schema.sql` | Tables, enums, and the trigger that mirrors `auth.users` into `profiles` |
| 2 | `supabase/policies.sql` | Row Level Security policies for every table |
| 3 | `supabase/patches/001` … `025` | In numeric order, one at a time. **Skip `002` and `005`** — both are superseded by the seed and say so at the top. Most print their own PASS/FAIL block; read it before moving on |
| 4 | `supabase/seed.sql` | The whole demo dataset: two coaches, seven members, plans, workout history, nutrition, chat, appointments, check-ins |
| 5 | `supabase/verify.sql` | Schema, security and data-integrity checks |

**The seed runs after the patches, not before.** This is the one ordering that
actually fails: the seed calls `has_active_subscription()`, which `patches/023`
defines, and deletes from `notifications`, which `patches/020` creates. Run it
earlier and it aborts on a missing function.

Step 4 and steps 5.1–5.2 can happen in either order. `schema.sql` installs a
trigger that gives every new user a `profiles` row, and accounts created before
it exists get none — but the seed upserts those rows rather than updating them,
so it repairs the gap either way.

`seed.sql` is destructive and re-runnable by design: it deletes every demo row
and rebuilds it, anchored to the current ISO week. **Re-run it before every
demo** — the member's session states are derived from that week's workout runs,
so a seed left alone for a fortnight shows an app where every session reads
"To Do".

`verify.sql` prints one row per check and **every row must read `PASS`**. There
are no expected failures. It covers three things: schema and security (grants,
RLS, the hardened `security definer` operations), integrity (every row counts
violations and expects zero — a session with no exercises, a run whose
percentage disagrees with its own set logs, a reward worth other than what the
server would have paid), and whether the data can actually demonstrate the app.

Then, from your terminal:

```bash
node supabase/probe-rls.mjs        # what an anonymous caller can read
node supabase/probe-security.mjs   # what each signed-in role can read and write
```

Every row must read `PASS`. The first asks each table what it returns to a
caller holding only the publishable key — the question `verify.sql` structurally
**cannot** answer, because it runs as the dashboard's privileged role and
bypasses RLS entirely. Phase 0 shipped a policy that looked fine and was public
to the whole internet; no SQL check caught it.

### 6. Push notifications — VAPID keys *(optional)*

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

### 7. Deploy the Edge Function *(optional, follows step 6)*

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
  VAPID_PUBLIC_KEY="<public key from step 6>" \
  VAPID_PRIVATE_KEY="<private key from step 6>" \
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
thirteen — run them all after touching anything shared:

```bash
node src/lib/format.selfcheck.js
node src/lib/week.selfcheck.js
node src/lib/dayGroups.selfcheck.js
node src/theme/resolveTokens.selfcheck.js
node src/features/workout/timer.selfcheck.js
node src/features/workout/status.selfcheck.js
node src/features/workout/summary.selfcheck.js
node src/features/clients/subscription.selfcheck.js
node src/features/calendar/month.selfcheck.js
node src/features/progress/progress.selfcheck.js
node src/features/profile/pushSubscription.selfcheck.js
node src/features/nutrition/contracts.selfcheck.js
node src/features/rewards/grouping.selfcheck.js
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
