# TrainHub

A Progressive Web App that connects gym members with fitness professionals.

University project for the *Mobile Application Development* course, Master's
degree in Computer Science — University of Brescia, academic year 2025/2026.

| | |
|---|---|
| **Authors** | Davide Leone (723335), Andrea Bariselli (737436) |
| **Deliverables** | this PWA + a LaTeX technical report (`Relazione/`) |
| **Language** | English (app, code and report) |

## What it does

Members and professionals normally juggle several disconnected tools: one app
for the workout plan, a spreadsheet for the diet, WhatsApp for talking to the
trainer, a plastic card for entering the gym. TrainHub puts all of it behind a
single login, with two distinct sections of the app:

- **Gym Member** — follow the workout plan assigned by a trainer, log sets
  during a live session (this works with no network — a weight room is the
  worst possible place to rely on connectivity), read the nutrition plan, book
  appointments, chat with the assigned professional and show a QR access badge
  at the gym door.
- **Professional** (personal trainer and/or nutritionist) — see today's agenda,
  manage clients, assign and edit workout and nutrition plans, track client
  progress, manage the calendar and availability, chat, and scan a member's
  access badge.

Being a PWA is a course requirement, not a detail: the app must be installable
on a phone and must keep working offline.

## Status

**Phase 0 (foundations) complete.** The app builds, installs, runs offline and
routes both roles to their own section, but every screen is still a placeholder
naming itself. Real screens land in phases 1–4. See `docs/` (not tracked in
this repository) for the design spec and the phase plans.

## Stack

| Layer | Choice |
|---|---|
| UI | React 19, plain JS + JSX (no TypeScript) |
| Build | Vite 8, ESM |
| Components | MUI v9 + Emotion, custom theme built from the Figma design tokens |
| Routing | React Router (data router) |
| Backend | Supabase — Postgres, Row Level Security, Auth, Realtime |
| Data layer | TanStack Query, persisted to IndexedDB (`idb-keyval`) |
| PWA | `vite-plugin-pwa` in `injectManifest` mode, hand-written Workbox service worker |

Two choices worth knowing before you read the code:

- **`injectManifest`, not `generateSW`.** The service worker is `src/sw.js` and
  is written by hand, because the push and `notificationclick` handlers coming
  in phase 4 cannot live inside a generated worker.
- **TanStack Query is also the offline write queue.** With
  `networkMode: 'offlineFirst'` a mutation fired with no connection is *paused
  and persisted* instead of failing, and `resumePausedMutations()` replays it on
  reconnect. No hand-rolled sync queue exists, and none is needed.

## Setup

Requires **Node.js 20.19+** (or 22.12+) and a free Supabase project.

```bash
npm install
cp .env.example .env.local
```

Fill `.env.local` with the values from your Supabase project
(*Project Settings → API*):

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable key>
```

> `VITE_*` variables are inlined into the JavaScript bundle, so they are public
> by design. Only the publishable (anon) key belongs here — never the secret
> service-role key. Row Level Security is what actually protects the data.

Then run the SQL files **in this order** in the Supabase SQL editor:

| Order | File | What it does |
|---|---|---|
| 1 | `supabase/schema.sql` | 15 tables, enums, and the trigger mirroring `auth.users` into `profiles` |
| 2 | `supabase/policies.sql` | Row Level Security policies for every table |
| 3 | — | Create the two demo users (see below) |
| 4 | `supabase/seed.sql` | Demo workout plan, meals, appointments, exercises, rewards |
| 5 | `supabase/verify.sql` | 19 checks; every row must read `PASS` |

Step 3 is manual, in *Authentication → Users → Add user*. Create both accounts
with **Auto Confirm User** ticked — without it sign-in fails with a generic
`Invalid login credentials`, which is Supabase's way of not leaking whether an
address is registered.

| Email | Password | Role |
|---|---|---|
| `daniel@trainhub.dev` | `TrainHub2026!` | member |
| `andrea@trainhub.dev` | `TrainHub2026!` | professional |

The order matters. `schema.sql` installs the trigger that creates a `profiles`
row for each new user, so users created *before* it exists get no profile and
the seed then fails on a foreign key.

`supabase/patches/` holds fixes to apply on top of an already-provisioned
database, so an existing project does not need to be rebuilt from scratch.

## Testing the application

### Everyday development

```bash
npm run dev
```

Vite dev server on <http://localhost:5173>, with hot module replacement.

**The service worker does not exist in dev mode.** Nothing offline, no install
prompt, no precaching — that is deliberate, a worker caching your source files
between edits makes development miserable. Every PWA behaviour has to be tested
against a production build instead.

### Testing the PWA (build + preview)

```bash
npm run build
npm run preview
```

<http://localhost:4173> serves the real `dist/` output, service worker
included. This is the only way to exercise install, offline and caching.

What to check in Chrome DevTools:

| Where | Expected |
|---|---|
| **Application → Service Workers** | one worker, *activated and is running* |
| **Application → Manifest** | name, theme colour `#FE6363`, all icon sizes, no warnings |
| **Application → Cache Storage** | the precache holds the app shell (~14 entries, no duplicates) |
| **Application → IndexedDB** | `trainhub-query-cache`, written by the query persister |
| **Install icon in the address bar** | present; installing opens TrainHub in its own window |

### Testing offline behaviour

1. `npm run build && npm run preview`, then load <http://localhost:4173> once,
   so the service worker installs and the shell is precached.
2. DevTools → **Network → Offline** (throttling dropdown).
3. Reload. The app must still render — routing, theme and the last cached data
   included. It is served entirely from the service worker.
4. From phase 2 on, also: log a workout session while offline, go back online,
   and confirm the sets reach Supabase. That is the paused-mutation replay.

Airplane mode on a real phone is the stricter version of the same test, and the
one that counts for the report.

### Testing on a real phone

`localhost` is not reachable from your phone, and a service worker only
registers over HTTPS (or `localhost`). A tunnel solves both:

```bash
npm run build
npm run preview
ngrok http 4173 --url=your-ngrok-url
```

Open that HTTPS URL on the phone and use *Add to Home screen*. The app should
launch with no browser chrome (`display: standalone`).

Use the **static** ngrok domain, not a random one. Push subscriptions are bound
to their origin, so a URL that changes on every restart invalidates every
subscription and has to be re-added to the Supabase Auth redirect allowlist
each time. The free plan includes one static domain — replace the one above
with yours.

### Lighthouse audit

DevTools → **Lighthouse** → *Progressive Web App* + *Performance*, run against
`http://localhost:4173` (never against `npm run dev` — the scores are
meaningless without the service worker and the minified bundle).

### Sanity checks

```bash
npm run lint                              # ESLint over the repo
node src/theme/resolveTokens.selfcheck.js # design-token resolver self-check
```

The second one prints `resolveTokens: OK (22 tokens)`. It asserts that the
Figma token file still resolves — aliases included — and fails loudly if a
re-export from Figma renames or breaks a token the theme depends on.

There is no test runner: for a project this size, a self-check that runs under
bare Node buys more than a framework would.

### Walking both roles

Sign in as `daniel@trainhub.dev` to get the member section (`/m`), as
`andrea@trainhub.dev` to get the professional one (`/p`). Each screen names
itself, so you can tell at a glance which route you landed on.

Two things worth checking explicitly, because both are guards that are easy to
break:

- Visit `/m/profile/badge`. **No bottom-bar tab should be highlighted.** Home
  lives at `/m`, which is a prefix of every route in the section, so a naive
  prefix match lights Home up on screens no tab represents.
- Sign in as the professional and navigate to `/m`. You should be redirected to
  `/p`, once, with no flicker and no loop.

## Project layout

```
src/
  main.jsx              service-worker registration + mount
  App.jsx               provider stack: theme, query cache, auth, router
  sw.js                 hand-written service worker (injectManifest input)
  theme/                design tokens, resolver, createTheme + responsiveFontSizes
  routes/               route tree and the per-role bottom-bar entries
  layouts/              signed-in shell (with the role guard) and public shell
  components/           shared UI
  features/auth/        session provider over Supabase onAuthStateChange
  lib/                  Supabase client, TanStack Query client + persister
supabase/
  schema.sql  policies.sql  seed.sql  verify.sql  patches/
Relazione/              LaTeX technical report
doc/                    Figma exports and course material (untracked except the tokens)
```

## Notes on the repository

- `doc/` is mostly untracked — it holds course material and Figma exports. The
  one exception is `doc/assets/variables.tokens.json`, which is committed
  because `src/theme/` imports it at build time: the Figma export stays the
  single source of truth for the palette, so a fresh clone would otherwise not
  build.
- `docs/` (design spec, phase plans) and `Relazione/main.pdf` are untracked on
  purpose — the first is working material, the second is a build artefact of the
  LaTeX sources.
