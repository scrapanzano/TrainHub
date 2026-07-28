# TrainHub Phase 0 — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the stock Vite template into a running TrainHub shell — themed, installable, offline-capable, with the full route tree navigable and a seeded Supabase backend behind it.

**Architecture:** A single `AppLayout` renders a top header, an `<Outlet />`, and a bottom navigation whose items come from a per-role config; `PublicLayout` covers the unauthenticated screens. Design tokens are resolved from the Figma export at module load and fed into `createTheme` + `responsiveFontSizes`, so the app and the Figma file cannot drift. Server state lives in TanStack Query, persisted to IndexedDB so reads survive a cold start offline; the service worker is hand-written (`injectManifest`) and precaches only the app shell, leaving API data to Query.

**Tech Stack:** React 19, Vite 8, plain JS + JSX (no TypeScript), ESM, MUI v9 + Emotion, React Router v7, TanStack Query v5, Supabase, Workbox.

## Global Constraints

- **Plain JavaScript + JSX only.** No TypeScript, no `.ts`/`.tsx` files. The project is `"type": "module"` — ESM everywhere.
- **Claude never runs `git commit` or `git push`.** The project is not yet a git repository. Every commit in this project is Davide's. Tasks end with a **Checkpoint**, not a commit.
- **Every source file Claude writes is passed through `/humanizer`** before the task is considered done.
- **English only** in all code, comments, identifiers, and UI copy.
- **`createTheme` + `responsiveFontSizes` are graded requirements** (`doc/context.md`: "MUI is mobile friendly but not natively responsive"). They must both appear in `src/theme/index.js`.
- **Brand `#FE6363`, background `#F9FAFB`** — already in the `vite.config.js` manifest. Keep them in sync with `doc/assets/variables.tokens.json`.
- **The service worker does not exist in `dev`.** Anything PWA-related is verified with `npm run build && npm run preview`.
- **ngrok must use its free static domain** (`--url=wrinkly-mankind-doodle.ngrok-free.dev`). A rotating URL invalidates push subscriptions and the Supabase Auth redirect allowlist.
- Wireframes in `doc/assets/**` are the visual spec. Match them rather than inventing layout.

### Deviation from the spec, with reason

The spec names `MemberLayout` and `ProfessionalLayout`. They would differ only in their bottom-navigation items. This plan uses **one `AppLayout` taking a `navItems` prop**, with two config arrays. Identical behaviour, roughly half the code, one place to fix a layout bug.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/theme/resolveTokens.js` | Pure function: flatten the W3C token tree and resolve `{Alias}` references. No imports — testable under bare Node. |
| `src/theme/resolveTokens.selfcheck.js` | Assert-based self-check for the resolver. |
| `src/theme/tokens.js` | Imports the Figma JSON, exports the resolved flat token map. |
| `src/theme/index.js` | `createTheme` + `responsiveFontSizes`. The only file that knows MUI's palette shape. |
| `src/lib/supabase.js` | Supabase client singleton. Knows env vars, nothing else. |
| `src/lib/queryClient.js` | `QueryClient` + IndexedDB persister config. |
| `src/features/auth/AuthProvider.jsx` | Session + profile context over `onAuthStateChange`. |
| `src/features/auth/useAuth.js` | Consumer hook. |
| `src/components/BrandLogo.jsx` | The TH monogram, inline SVG. |
| `src/components/TopHeader.jsx` | Greeting, notification bell, avatar. |
| `src/components/BottomNav.jsx` | Role-agnostic bottom bar, driven by a `navItems` array. |
| `src/components/Placeholder.jsx` | Temporary screen body, replaced screen by screen in later phases. |
| `src/layouts/PublicLayout.jsx` | Centred card shell for login / password screens. |
| `src/layouts/AppLayout.jsx` | Header + `<Outlet />` + bottom nav. |
| `src/routes/navItems.js` | The two bottom-nav configs. |
| `src/routes/index.jsx` | The full route tree. |
| `src/sw.js` | Hand-written service worker (precache, navigation fallback, image cache). |
| `supabase/schema.sql` | Tables and indexes. |
| `supabase/policies.sql` | Row Level Security. |
| `supabase/seed.sql` | Demo accounts and content. |
| `pwa-assets.config.js` | Icon generation config. |
| `public/logo.svg` | Icon source. |

---

## Prerequisites (Davide, before Task 4)

1. Create the Supabase project. Copy the project URL and anon key.
2. Claim the ngrok free static domain in the dashboard.
3. Register `https://<your-static-domain>` under Supabase → Authentication → URL Configuration.

Tasks 1–3 do not need any of this and can start immediately.

---

### Task 1: Design tokens → MUI theme

**Files:**
- Create: `src/theme/resolveTokens.js`, `src/theme/resolveTokens.selfcheck.js`, `src/theme/tokens.js`, `src/theme/index.js`
- Modify: `src/index.css`, `src/App.jsx`, `src/main.jsx`
- Delete: `src/App.css`, `src/assets/react.svg`, `public/vite.svg`

**Interfaces:**
- Produces: `resolveTokens(raw) -> Record<string, string>` — flat map, dotted keys (`'Color.Brand'`), hex string values. `tokens` — the resolved map for `doc/assets/variables.tokens.json`. `theme` (default export of `src/theme/index.js`) — a responsive MUI theme carrying an extra `palette.task` group.

- [ ] **Step 1: Install the runtime dependencies**

```bash
npm install @mui/icons-material @fontsource-variable/inter
```

`@fontsource-variable/inter` self-hosts the font. A Google Fonts CDN link would break the offline requirement.

- [ ] **Step 2: Write the failing self-check**

Create `src/theme/resolveTokens.selfcheck.js`:

```js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveTokens } from './resolveTokens.js'

const raw = JSON.parse(
  readFileSync(new URL('../../doc/assets/variables.tokens.json', import.meta.url)),
)
const tokens = resolveTokens(raw)

// A literal colour comes through as its hex string.
assert.equal(tokens['Color.Brand'], '#FE6363')

// A one-hop alias resolves to its target's hex.  Bg.Secondary -> {Color.Gray-Light}
assert.equal(tokens['Bg.Secondary'], '#F9FAFB')

// An alias can point at a token that lives at the top level, not inside a group.
// Border.Primary -> {Gray-Border}
assert.equal(tokens['Border.Primary'], '#E5E7EB')

// Groups nest arbitrarily deep.
assert.equal(tokens['Theme.Status.Suspended'], '#8794AF')

// Keys carrying spaces survive intact.
assert.equal(tokens['Task.Nutrition Consultation'], '#D9FFE4')

// Figma's own metadata keys are not tokens.
assert.ok(!('$extensions' in tokens))

// A dangling reference is a design-file bug and must be loud, not silently undefined.
assert.throws(
  () => resolveTokens({ A: { $type: 'color', $value: '{Nope.Missing}' } }),
  /Unknown token reference "Nope.Missing"/,
)

// A cycle would otherwise blow the stack.
assert.throws(
  () =>
    resolveTokens({
      A: { $type: 'color', $value: '{B}' },
      B: { $type: 'color', $value: '{A}' },
    }),
  /Circular token alias/,
)

console.log(`resolveTokens: OK (${Object.keys(tokens).length} tokens)`)
```

- [ ] **Step 3: Run it to confirm it fails**

```bash
node src/theme/resolveTokens.selfcheck.js
```

Expected: `ERR_MODULE_NOT_FOUND` — `src/theme/resolveTokens.js` does not exist yet.

- [ ] **Step 4: Write the resolver**

Create `src/theme/resolveTokens.js`:

```js
const ALIAS = /^\{(.+)\}$/

// Figma exports a nested tree; we want flat dotted keys.  A node is a token
// when it carries `$value`, otherwise it is a group to descend into.  Keys
// starting with `$` are Figma's own metadata and never tokens.
function flatten(node, prefix, out) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$')) continue
    if (!value || typeof value !== 'object') continue

    const path = prefix ? `${prefix}.${key}` : key
    if ('$value' in value) {
      out[path] = value.$value
    } else {
      flatten(value, path, out)
    }
  }
}

/**
 * Flattens a W3C design-token export and resolves `{Group.Name}` aliases
 * down to the hex string they ultimately point at.
 *
 * @param {object} raw Parsed contents of a Figma variables export.
 * @returns {Record<string, string>} Dotted key -> hex colour.
 */
export function resolveTokens(raw) {
  const flat = {}
  flatten(raw, '', flat)

  // `resolving` tracks the current chain only, so a token referenced twice
  // from different places is fine while a genuine cycle still throws.
  const resolving = new Set()

  const deref = (key) => {
    if (!(key in flat)) throw new Error(`Unknown token reference "${key}"`)

    const value = flat[key]
    if (typeof value !== 'string') return value.hex

    const alias = value.match(ALIAS)
    if (!alias) return value

    if (resolving.has(key)) throw new Error(`Circular token alias at "${key}"`)
    resolving.add(key)
    try {
      return deref(alias[1])
    } finally {
      resolving.delete(key)
    }
  }

  return Object.fromEntries(Object.keys(flat).map((key) => [key, deref(key)]))
}
```

- [ ] **Step 5: Run the self-check again**

```bash
node src/theme/resolveTokens.selfcheck.js
```

Expected: `resolveTokens: OK (22 tokens)`

- [ ] **Step 6: Bind the resolver to the real token file**

Create `src/theme/tokens.js`:

```js
import raw from '../../doc/assets/variables.tokens.json'
import { resolveTokens } from './resolveTokens.js'

// Imported straight from `doc/` on purpose: the Figma export stays the single
// source of truth, so re-exporting variables cannot leave the app behind.
export const tokens = resolveTokens(raw)
```

- [ ] **Step 7: Build the theme**

Create `src/theme/index.js`:

```js
import { createTheme, responsiveFontSizes } from '@mui/material/styles'
import { tokens } from './tokens.js'

const theme = createTheme({
  palette: {
    primary: { main: tokens['Action.Primary'], contrastText: tokens['Color.White'] },
    background: { default: tokens['Bg.Secondary'], paper: tokens['Bg.Primary'] },
    text: { primary: tokens['Text.Primary'], secondary: tokens['Text.Secondary'] },
    success: { main: tokens['Theme.Success'] },
    warning: { main: tokens['Theme.Warning'] },
    error: { main: tokens['Theme.Danger'] },
    divider: tokens['Border.Primary'],
    action: { disabledBackground: tokens['Bg.Disabled'] },

    // Appointment cards are colour-coded by type; MUI has no slot for that,
    // so they ride along as a custom palette group.
    task: {
      training: tokens['Task.PT'],
      protocol: tokens['Task.Protocol Consultation'],
      nutrition: tokens['Task.Nutrition Consultation'],
      done: tokens['Task.Done'],
      suspended: tokens['Theme.Status.Suspended'],
    },
  },

  shape: { borderRadius: 16 },

  typography: {
    fontFamily: '"Inter Variable", system-ui, -apple-system, sans-serif',
    h1: { fontSize: '2.25rem', fontWeight: 800, letterSpacing: '-0.03em' },
    h2: { fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em' },
    h3: { fontSize: '1.25rem', fontWeight: 700 },
    body1: { fontSize: '1rem' },
    body2: { fontSize: '0.875rem' },
    button: { fontWeight: 600, textTransform: 'none' },
  },

  components: {
    // The wireframes use soft, borderless, generously rounded cards throughout.
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { borderRadius: 20, border: `1px solid ${tokens['Border.Primary']}` },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 999, paddingBlock: 12 } },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
  },
})

// Required by the course brief: MUI is mobile friendly but not natively
// responsive, so type scales are derived rather than fixed.
export default responsiveFontSizes(theme)
```

- [ ] **Step 8: Strip the template CSS**

Replace the entire contents of `src/index.css` with:

```css
/* MUI's CssBaseline owns the reset; this file only covers what it cannot. */
html {
  /* Keeps the layout stable when a scrollbar appears mid-navigation. */
  scrollbar-gutter: stable;
}

body {
  /* Stops iOS rubber-banding from revealing the page behind the app shell. */
  overscroll-behavior-y: none;
}
```

- [ ] **Step 9: Replace `App.jsx` with a theme probe**

Replace the entire contents of `src/App.jsx` with:

```jsx
import { Button, Card, Container, CssBaseline, Stack, ThemeProvider, Typography } from '@mui/material'
import theme from './theme/index.js'

// Temporary: proves the theme is wired end to end.  Task 9 replaces this
// with the router.
export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container sx={{ py: 4 }}>
        <Stack spacing={2}>
          <Typography variant="h1">TrainHub</Typography>
          <Typography color="text.secondary">Theme probe</Typography>
          <Card sx={{ p: 2 }}>
            <Typography variant="h3">Leg Day</Typography>
            <Typography variant="body2" color="text.secondary">6 exercises</Typography>
          </Card>
          <Button variant="contained">Start workout</Button>
        </Stack>
      </Container>
    </ThemeProvider>
  )
}
```

- [ ] **Step 10: Load the font in `main.jsx`**

In `src/main.jsx`, add below the existing `import './index.css'` line:

```js
import '@fontsource-variable/inter'
```

- [ ] **Step 11: Delete the template leftovers**

```bash
rm src/App.css src/assets/react.svg src/assets/vite.svg
```

Both stock logos live under `src/assets/` in this repo, not `public/`. Leave `src/assets/hero.png` and `public/icons.svg` alone — neither is stock Vite output, and `public/icons.svg` is the likely source for Task 2.

- [ ] **Step 12: Verify in the browser**

```bash
npm run dev
```

Open `http://localhost:5173`. Confirm all of:
- Page background is `#F9FAFB`, not white.
- "TrainHub" renders in Inter, extra-bold, tight tracking.
- The card has a 20px radius and a `#E5E7EB` hairline border.
- The button is a pill, `#FE6363`, with white non-uppercase label.
- Narrowing the window below 600px shrinks the `h1` — that is `responsiveFontSizes` working.

- [ ] **Step 13: Lint and humanize**

```bash
npm run lint
```

Expected: no errors. Then run `/humanizer` over every file created in this task.

- [ ] **Step 14: Checkpoint**

Report to Davide: theme live, token count, screenshot of the probe. **Do not commit** — see Global Constraints.

---

### Task 2: PWA icons and manifest

`doc/context.md` still lists manifest `icons` as an open TODO. Without them the install prompt never appears and Lighthouse fails the PWA category.

**Files:**
- Create: `public/logo.svg`, `pwa-assets.config.js`
- Modify: `vite.config.js`
- Generated: `public/pwa-64x64.png`, `public/pwa-192x192.png`, `public/pwa-512x512.png`, `public/maskable-icon-512x512.png`, `public/apple-touch-icon-180x180.png`, `public/favicon.ico`
- Also modify: `public/favicon.svg` (still the stock Vite mark, and it is what `index.html` links), `index.html` (title, icon links, `theme-color`)

**Interfaces:**
- Produces: a manifest whose `icons` array satisfies Lighthouse's installability check.

- [ ] **Step 1: Install the generator**

```bash
npm install -D @vite-pwa/assets-generator
```

This is the official companion to `vite-plugin-pwa`. Hand-rolling a `sharp` script would be more code for the same PNGs.

- [ ] **Step 2: Draw the source logo**

Create `public/logo.svg` — the TH monogram from `doc/assets/components/Logo.png`: a near-black `T`, a brand-red `H`, and a white dumbbell knocked out of the `H` crossbar. Padded to a 512 square so the maskable variant does not clip.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#F9FAFB"/>
  <g>
    <!-- T -->
    <path d="M96 128h176v44h-66v212h-44V172h-66z" fill="#111827"/>
    <!-- H -->
    <rect x="296" y="128" width="44" height="256" fill="#FE6363"/>
    <rect x="372" y="128" width="44" height="256" fill="#FE6363"/>
    <rect x="296" y="234" width="120" height="44" fill="#FE6363"/>
    <!-- dumbbell knocked out of the H crossbar -->
    <g fill="#FFFFFF">
      <rect x="316" y="246" width="80" height="20" rx="10"/>
      <rect x="302" y="234" width="14" height="44" rx="7"/>
      <rect x="396" y="234" width="14" height="44" rx="7"/>
    </g>
  </g>
</svg>
```

- [ ] **Step 3: Configure the generator**

Create `pwa-assets.config.js`:

```js
import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: minimal2023Preset,
  images: ['public/logo.svg'],
})
```

- [ ] **Step 4: Generate the icons**

```bash
npx pwa-assets-generator
```

- [ ] **Step 5: Confirm the files landed**

```bash
ls public
```

Expected to include: `apple-touch-icon-180x180.png`, `favicon.ico`, `maskable-icon-512x512.png`, `pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`.

- [ ] **Step 6: Wire the icons into the manifest**

In `vite.config.js`, replace the `manifest` object with:

```js
      manifest: {
        name: 'TrainHub',
        short_name: 'TrainHub',
        description: 'A PWA for bridging the gap between gym members and fitness professionals.',
        theme_color: '#FE6363',
        background_color: '#F9FAFB',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'en',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
```

And replace the `includeAssets` line with:

```js
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon-180x180.png'],
```

Then replace `public/favicon.svg` — it is still the stock Vite mark, and it is what `index.html` links — with a tab-sized TH variant, and fix `index.html`: `<title>` is still lowercase `trainhub`, and it needs `apple-touch-icon`, `theme-color`, and `viewport-fit=cover`.

- [ ] **Step 7: Verify the built manifest**

```bash
npm run build && cat dist/manifest.webmanifest
```

Expected: four `icons` entries, one carrying `"purpose": "maskable"`.

- [ ] **Step 8: Checkpoint**

Report: icons generated, manifest verified. Note in the report notes that the `context.md` icons TODO is now closed.

---

### Task 3: Hand-written service worker (`injectManifest`)

Push handlers in Phase 4 cannot live in a generated service worker, so the switch happens now — before any offline behaviour is verified against the generated one.

**Files:**
- Create: `src/sw.js`
- Modify: `vite.config.js`

**Interfaces:**
- Produces: a service worker that precaches the app shell, serves `index.html` for SPA navigations, and caches images. Phase 4 adds `push` and `notificationclick` handlers to the same file.

- [ ] **Step 1: Install the Workbox modules**

```bash
npm install -D workbox-core workbox-precaching workbox-routing workbox-strategies workbox-expiration
```

- [ ] **Step 2: Write the service worker**

Create `src/sw.js`:

```js
/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

// `registerType: 'autoUpdate'` expects the new worker to take over immediately
// rather than waiting for every tab to close.
self.skipWaiting()
clientsClaim()

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Single-page app: every navigation resolves to the precached shell, which is
// what lets a cold start work with no network at all.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

// Exercise imagery is immutable and heavy — worth keeping, worth capping.
registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: 'trainhub-images',
    plugins: [new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  }),
)

// Deliberately absent: any caching of Supabase REST responses.  TanStack Query
// already persists that data to IndexedDB (see src/lib/queryClient.js), so a
// second copy here would only add staleness — and a shared cache holding one
// user's data across a sign-out is a leak waiting to happen.
```

- [ ] **Step 3: Switch the plugin strategy**

In `vite.config.js`, inside the `VitePWA({ ... })` call, add alongside `registerType`:

```js
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
        // Icons and favicons already reach the precache through `includeAssets`
        // and `manifest.icons`, so sweeping png/ico/svg here too would list them
        // twice -- and would drag in `logo.svg` (only the icon generator's
        // source) and `icons.svg` (an unrelated leftover), neither of which is
        // ever served.
        //
        // Inter ships seven unicode-range subsets.  A browser only downloads
        // the ones it needs, but precaching defeats that and would fetch all
        // seven up front -- ~90 KiB of Cyrillic, Greek and Vietnamese glyphs
        // that an English/Italian app will never render.
        globPatterns: ['**/*.{js,css,html}', 'assets/inter-latin*.woff2'],
      },
      devOptions: { enabled: false, type: 'module' },
```

- [ ] **Step 4: Teach ESLint about the worker globals**

In `eslint.config.js`, add a block for the service worker so `self` and `__WB_MANIFEST` do not trip `no-undef`:

```js
  {
    files: ['src/sw.js'],
    languageOptions: {
      globals: { ...globals.serviceworker },
    },
  },
```

- [ ] **Step 5: Build and inspect the emitted worker**

```bash
npm run build
```

Expected: build succeeds; `dist/sw.js` exists. Confirm the manifest was injected, not left as a placeholder:

```bash
grep -c 'revision' dist/sw.js
```

Expected: a number greater than zero.

- [ ] **Step 6: Verify offline in a real browser**

```bash
npm run preview
```

Open `http://localhost:4173`, then in DevTools → Application → Service Workers confirm one is **activated and running**. Switch DevTools → Network to **Offline**, hard-reload, and confirm the theme probe still renders.

- [ ] **Step 7: Lint and humanize**

```bash
npm run lint
```

Then run `/humanizer` over `src/sw.js`.

- [ ] **Step 8: Checkpoint**

Report: service worker activated, offline reload confirmed.

---

### Task 4: Database schema

**Files:**
- Create: `supabase/schema.sql`

**Interfaces:**
- Produces: the tables every later phase reads and writes. Column names here are load-bearing — Tasks 5, 6 and every subsequent phase reference them verbatim.

- [ ] **Step 1: Write the schema**

Create `supabase/schema.sql`:

```sql
-- TrainHub schema.  Run once in the Supabase SQL editor, before policies.sql.

create type user_role       as enum ('member', 'professional');
create type pro_specialty   as enum ('personal_trainer', 'nutritionist', 'both');
create type session_status  as enum ('todo', 'in_progress', 'completed');
create type appointment_kind as enum ('training', 'protocol', 'nutrition');
create type appointment_status as enum ('pending', 'confirmed', 'cancelled', 'done');
create type subscription_status as enum ('active', 'expired', 'suspended');

-- One row per auth user.  `specialty` is null for members; for professionals it
-- carries the role-unification decision from the design spec (a nutritionist is
-- a professional with a different specialty, not a separate role).
create table profiles (
  id                  uuid primary key references auth.users on delete cascade,
  role                user_role not null default 'member',
  specialty           pro_specialty,
  full_name           text not null,
  avatar_url          text,
  bio                 text,
  assigned_pro_id     uuid references profiles(id) on delete set null,
  subscription_status subscription_status not null default 'active',
  subscription_until  date,
  created_at          timestamptz not null default now(),
  constraint specialty_only_for_professionals
    check ((role = 'professional') = (specialty is not null))
);
create index on profiles (assigned_pro_id);

-- Catalogue of exercises, shared across all plans.  `name` is unique so the
-- catalogue cannot accumulate duplicate entries, and so seeding can use
-- `on conflict (name) do nothing`.
create table exercises (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  muscle_group text not null,
  equipment    text,
  instructions text,
  video_url    text,
  image_url    text
);

create table workout_plans (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references profiles(id) on delete cascade,
  author_id   uuid references profiles(id) on delete set null,
  name        text not null,
  goal        text,
  level       text,
  weeks       int  not null default 4,
  expires_on  date,
  created_at  timestamptz not null default now()
);
create index on workout_plans (member_id);

create table workout_sessions (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references workout_plans(id) on delete cascade,
  name       text not null,
  position   int  not null,
  status     session_status not null default 'todo',
  unique (plan_id, position)
);
create index on workout_sessions (plan_id);

-- An exercise as it appears inside one session, with its prescription.
create table session_exercises (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references workout_sessions(id) on delete cascade,
  exercise_id   uuid not null references exercises(id) on delete restrict,
  position      int  not null,
  target_sets   int  not null default 3,
  target_reps   int  not null default 10,
  target_weight numeric(6,2),
  rest_seconds  int  not null default 90,
  notes         text,
  unique (session_id, position)
);
create index on session_exercises (session_id);

-- One row per set actually performed.  Written offline and replayed on
-- reconnect, so the client supplies `id` and the table tolerates re-inserts.
create table set_logs (
  id                  uuid primary key,
  session_exercise_id uuid not null references session_exercises(id) on delete cascade,
  member_id           uuid not null references profiles(id) on delete cascade,
  set_number          int  not null,
  reps                int  not null,
  weight              numeric(6,2),
  performed_at        timestamptz not null default now()
);
create index on set_logs (member_id, performed_at desc);
create index on set_logs (session_exercise_id);

create table nutrition_plans (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references profiles(id) on delete cascade,
  author_id  uuid references profiles(id) on delete set null,
  name       text not null,
  kcal_target int,
  protein_g  int,
  carbs_g    int,
  fat_g      int,
  created_at timestamptz not null default now()
);
create index on nutrition_plans (member_id);

create table meals (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references nutrition_plans(id) on delete cascade,
  name        text not null,
  time_of_day text not null,
  position    int  not null,
  items       jsonb not null default '[]'::jsonb,
  kcal        int,
  unique (plan_id, position)
);
create index on meals (plan_id);

-- Recurring weekly availability, stored as local wall-clock times.
create table availability (
  id          uuid primary key default gen_random_uuid(),
  pro_id      uuid not null references profiles(id) on delete cascade,
  weekday     int  not null check (weekday between 0 and 6),
  starts_at   time not null,
  ends_at     time not null,
  check (ends_at > starts_at)
);
create index on availability (pro_id);

create table appointments (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references profiles(id) on delete cascade,
  pro_id     uuid not null references profiles(id) on delete cascade,
  kind       appointment_kind not null,
  status     appointment_status not null default 'pending',
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  notes      text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index on appointments (member_id, starts_at);
create index on appointments (pro_id, starts_at);

-- Exactly one thread per member/professional pair.
create table threads (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references profiles(id) on delete cascade,
  pro_id     uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (member_id, pro_id)
);

create table messages (
  id         uuid primary key,
  thread_id  uuid not null references threads(id) on delete cascade,
  sender_id  uuid not null references profiles(id) on delete cascade,
  body       text not null,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index on messages (thread_id, created_at desc);

create table rewards (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references profiles(id) on delete cascade,
  code        text not null,
  title       text not null,
  description text,
  points      int  not null default 0,
  earned_at   timestamptz not null default now(),
  unique (member_id, code)
);

-- Written when a professional scans a member's QR access badge.
create table checkins (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references profiles(id) on delete cascade,
  scanned_by_id uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index on checkins (member_id, created_at desc);

create table push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index on push_subscriptions (user_id);

-- Supabase creates the auth user; this mirrors it into `profiles` so the app
-- never has to deal with a signed-in user that has no profile row.
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'member')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
```

- [ ] **Step 2: Run it**

Paste the whole file into the Supabase dashboard → SQL Editor → Run.

Expected: `Success. No rows returned.`

- [ ] **Step 3: Verify the tables exist**

In the SQL Editor:

```sql
select table_name from information_schema.tables
where table_schema = 'public' order by table_name;
```

Expected 15 rows: `appointments`, `availability`, `checkins`, `exercises`, `meals`, `messages`, `nutrition_plans`, `profiles`, `push_subscriptions`, `rewards`, `session_exercises`, `set_logs`, `threads`, `workout_plans`, `workout_sessions`.

- [ ] **Step 4: Checkpoint**

Report the table list back to Davide.

---

### Task 5: Row Level Security

Without RLS every table is world-readable through the anon key. This is the security boundary of the whole app, so it is not optional and not deferred.

**Files:**
- Create: `supabase/policies.sql`

**Interfaces:**
- Consumes: every table from Task 4.
- Produces: `is_professional()` and `my_pro_id()` SQL helpers, reused by later policies.

- [ ] **Step 1: Write the policies**

Create `supabase/policies.sql`:

```sql
-- TrainHub Row Level Security.  Run after schema.sql.
-- Rule of thumb: a member reaches only their own rows; a professional reaches
-- rows belonging to members assigned to them.

alter table profiles           enable row level security;
alter table exercises          enable row level security;
alter table workout_plans      enable row level security;
alter table workout_sessions   enable row level security;
alter table session_exercises  enable row level security;
alter table set_logs           enable row level security;
alter table nutrition_plans    enable row level security;
alter table meals              enable row level security;
alter table availability       enable row level security;
alter table appointments       enable row level security;
alter table threads            enable row level security;
alter table messages           enable row level security;
alter table rewards            enable row level security;
alter table checkins           enable row level security;
alter table push_subscriptions enable row level security;

-- SECURITY DEFINER so the helper can read `profiles` without recursing back
-- through the very policies it is being used to evaluate.
create function is_professional() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'professional'
  );
$$;

create function owns_member(target uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select target = auth.uid()
      or exists (
           select 1 from profiles
           where id = target and assigned_pro_id = auth.uid()
         );
$$;

-- profiles ------------------------------------------------------------------
create policy profiles_select_self on profiles
  for select using (id = auth.uid());

-- A member must be able to browse professionals in order to choose one.
-- The `auth.uid() is not null` guard is load-bearing: without it this policy
-- has no reference to the caller at all, so it grants every professional's
-- profile to anyone holding the publishable key -- which ships in the JS
-- bundle and is therefore public.
create policy profiles_select_professionals on profiles
  for select using (auth.uid() is not null and role = 'professional');

create policy profiles_select_own_clients on profiles
  for select using (assigned_pro_id = auth.uid());

create policy profiles_update_self on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- exercises -----------------------------------------------------------------
create policy exercises_select_all on exercises
  for select using (auth.uid() is not null);

create policy exercises_write_professionals on exercises
  for all using (is_professional()) with check (is_professional());

-- workout_plans -------------------------------------------------------------
create policy workout_plans_select on workout_plans
  for select using (owns_member(member_id));

create policy workout_plans_write on workout_plans
  for all using (owns_member(member_id)) with check (owns_member(member_id));

-- workout_sessions ----------------------------------------------------------
create policy workout_sessions_all on workout_sessions
  for all using (
    exists (select 1 from workout_plans p
            where p.id = plan_id and owns_member(p.member_id))
  ) with check (
    exists (select 1 from workout_plans p
            where p.id = plan_id and owns_member(p.member_id))
  );

-- session_exercises ---------------------------------------------------------
create policy session_exercises_all on session_exercises
  for all using (
    exists (select 1 from workout_sessions s
            join workout_plans p on p.id = s.plan_id
            where s.id = session_id and owns_member(p.member_id))
  ) with check (
    exists (select 1 from workout_sessions s
            join workout_plans p on p.id = s.plan_id
            where s.id = session_id and owns_member(p.member_id))
  );

-- set_logs ------------------------------------------------------------------
create policy set_logs_select on set_logs
  for select using (owns_member(member_id));

-- Only the member logs their own sets; a trainer may read but never invent them.
create policy set_logs_write_self on set_logs
  for all using (member_id = auth.uid()) with check (member_id = auth.uid());

-- nutrition_plans -----------------------------------------------------------
create policy nutrition_plans_select on nutrition_plans
  for select using (owns_member(member_id));

-- Nutrition plans are professional-authored by design (see report ch.1).
create policy nutrition_plans_write_pro on nutrition_plans
  for all using (is_professional() and owns_member(member_id))
  with check (is_professional() and owns_member(member_id));

-- meals ---------------------------------------------------------------------
create policy meals_select on meals
  for select using (
    exists (select 1 from nutrition_plans n
            where n.id = plan_id and owns_member(n.member_id))
  );

create policy meals_write_pro on meals
  for all using (
    is_professional() and exists (
      select 1 from nutrition_plans n
      where n.id = plan_id and owns_member(n.member_id))
  ) with check (
    is_professional() and exists (
      select 1 from nutrition_plans n
      where n.id = plan_id and owns_member(n.member_id))
  );

-- availability --------------------------------------------------------------
-- Readable by everyone signed in, because members need it to pick a slot.
create policy availability_select_all on availability
  for select using (auth.uid() is not null);

create policy availability_write_own on availability
  for all using (pro_id = auth.uid()) with check (pro_id = auth.uid());

-- appointments --------------------------------------------------------------
create policy appointments_select on appointments
  for select using (member_id = auth.uid() or pro_id = auth.uid());

create policy appointments_insert on appointments
  for insert with check (member_id = auth.uid() or pro_id = auth.uid());

create policy appointments_update on appointments
  for update using (member_id = auth.uid() or pro_id = auth.uid())
  with check (member_id = auth.uid() or pro_id = auth.uid());

-- threads -------------------------------------------------------------------
create policy threads_select on threads
  for select using (member_id = auth.uid() or pro_id = auth.uid());

create policy threads_insert on threads
  for insert with check (member_id = auth.uid() or pro_id = auth.uid());

-- messages ------------------------------------------------------------------
create policy messages_select on messages
  for select using (
    exists (select 1 from threads t
            where t.id = thread_id
              and (t.member_id = auth.uid() or t.pro_id = auth.uid()))
  );

-- You may only send as yourself, and only into a thread you belong to.
create policy messages_insert on messages
  for insert with check (
    sender_id = auth.uid()
    and exists (select 1 from threads t
                where t.id = thread_id
                  and (t.member_id = auth.uid() or t.pro_id = auth.uid()))
  );

create policy messages_update_read on messages
  for update using (
    exists (select 1 from threads t
            where t.id = thread_id
              and (t.member_id = auth.uid() or t.pro_id = auth.uid()))
  );

-- rewards -------------------------------------------------------------------
create policy rewards_select on rewards
  for select using (owns_member(member_id));

create policy rewards_insert_self on rewards
  for insert with check (member_id = auth.uid());

-- checkins ------------------------------------------------------------------
create policy checkins_select on checkins
  for select using (owns_member(member_id) or scanned_by_id = auth.uid());

-- Only a professional records a check-in, and only by scanning.
create policy checkins_insert_pro on checkins
  for insert with check (is_professional() and scanned_by_id = auth.uid());

-- push_subscriptions --------------------------------------------------------
create policy push_subscriptions_all on push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

- [ ] **Step 2: Run it**

Paste into the Supabase SQL Editor → Run. Expected: `Success. No rows returned.`

- [ ] **Step 3: Verify RLS is on everywhere**

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public' order by tablename;
```

Expected: `rowsecurity` is `true` on all 15 rows. Any `false` is a hole — fix before continuing.

- [ ] **Step 4: Verify the anon key sees nothing**

Supabase dashboard → Table Editor → `profiles`, switch the role selector from `service_role` to `anon`.

Expected: zero rows. If rows appear, a policy is too permissive.

- [ ] **Step 5: Checkpoint**

Report: RLS enabled on 15/15 tables, anon read returns empty.

---

### Task 6: Seed data

The exam is a live demo. The app must never open onto an empty screen, and the seeded content should match the names already drawn in the wireframes.

**Files:**
- Create: `supabase/seed.sql`

**Interfaces:**
- Consumes: the schema from Task 4.
- Produces: two signed-in-able accounts — `daniel@trainhub.dev` (member, "Daniel Aresta") and `andrea@trainhub.dev` (professional, "Coach Andrea") — plus a four-session workout plan, a nutrition plan, appointments, a thread and rewards.

- [ ] **Step 1: Create the two auth users**

In the Supabase dashboard → Authentication → Users → Add user, twice. Tick **Auto Confirm User** both times.

| Email | Password | Notes |
|---|---|---|
| `daniel@trainhub.dev` | `TrainHub2026!` | member |
| `andrea@trainhub.dev` | `TrainHub2026!` | professional |

The `on_auth_user_created` trigger from Task 4 creates both `profiles` rows automatically, defaulting to `member` — **but only for users created after `schema.sql` ran.** If the users were added first, `profiles` stays empty. The seed upserts rather than updates precisely so either order works; do not rely on the trigger having fired.

- [ ] **Step 2: Write the seed**

Create `supabase/seed.sql`:

```sql
-- TrainHub demo data.  Run after the two auth users exist.
-- NOT idempotent: re-running duplicates the plan, sessions, meals, appointments
-- and check-ins. To re-seed, truncate those tables first (cascade handles the
-- children); profiles and auth users survive.
--
-- Every local is `v_`-prefixed on purpose.  PL/pgSQL defaults
-- `plpgsql.variable_conflict` to `error`, so a variable sharing a name with a
-- column in scope -- `plan_id`, `member_id`, `pro_id` all exist as columns
-- here -- aborts the block with "column reference is ambiguous".

do $$
declare
  v_member_id uuid;
  v_pro_id    uuid;
  v_plan_id   uuid;
  v_nut_id    uuid;
  v_thread_id uuid;
  v_chest_id  uuid;
  v_leg_id    uuid;
begin
  select id into v_member_id from auth.users where email = 'daniel@trainhub.dev';
  select id into v_pro_id    from auth.users where email = 'andrea@trainhub.dev';

  if v_member_id is null or v_pro_id is null then
    raise exception 'Create both demo auth users before running seed.sql';
  end if;

  -- Profiles --------------------------------------------------------------
  -- Upsert rather than update.  The `on_auth_user_created` trigger normally
  -- creates these rows, but it only fires for users inserted AFTER schema.sql
  -- ran -- and a plain UPDATE against a missing row succeeds silently at zero
  -- rows, so the failure would surface much later as a foreign key violation.
  -- The professional goes first: the member references it via assigned_pro_id.
  insert into profiles (id, role, specialty, full_name, bio)
  values (v_pro_id, 'professional', 'both', 'Coach Andrea',
          'Strength coach and nutritionist. 12 years on the gym floor.')
  on conflict (id) do update set
    role = excluded.role, specialty = excluded.specialty,
    full_name = excluded.full_name, bio = excluded.bio;

  insert into profiles (id, role, specialty, full_name, assigned_pro_id,
                        subscription_status, subscription_until)
  values (v_member_id, 'member', null, 'Daniel Aresta', v_pro_id, 'active',
          current_date + interval '8 months')
  on conflict (id) do update set
    role = excluded.role, specialty = excluded.specialty,
    full_name = excluded.full_name, assigned_pro_id = excluded.assigned_pro_id,
    subscription_status = excluded.subscription_status,
    subscription_until = excluded.subscription_until;

  -- Exercise catalogue ----------------------------------------------------
  insert into exercises (name, muscle_group, equipment, instructions) values
    ('Bench Press',      'Chest',      'Barbell',   'Lower to mid-chest, press to full extension.'),
    ('Incline Dumbbell Press', 'Chest', 'Dumbbell', 'Bench at 30 degrees. Control the descent.'),
    ('Cable Fly',        'Chest',      'Cable',     'Slight elbow bend held throughout.'),
    ('Back Squat',       'Legs',       'Barbell',   'Break at the hips, knees tracking over toes.'),
    ('Romanian Deadlift','Legs',       'Barbell',   'Hinge at the hips, keep the bar close.'),
    ('Leg Press',        'Legs',       'Machine',   'Do not lock the knees at the top.'),
    ('Pull-up',          'Back',       'Bodyweight','Full hang to chin over the bar.'),
    ('Barbell Row',      'Back',       'Barbell',   'Torso near 45 degrees, pull to the navel.'),
    ('Overhead Press',   'Shoulders',  'Barbell',   'Brace the core, press in a straight line.'),
    ('Lateral Raise',    'Shoulders',  'Dumbbell',  'Lead with the elbows, stop at shoulder height.')
  on conflict (name) do nothing;

  -- Workout plan, mirroring gym_member/02 - Workout.png --------------------
  insert into workout_plans (member_id, author_id, name, goal, level, weeks, expires_on)
  values (v_member_id, v_pro_id, 'Hypertrophy - Phase 1', 'Strength', 'Beginner', 6,
          current_date + interval '6 weeks')
  returning id into v_plan_id;

  insert into workout_sessions (plan_id, name, position, status) values
    (v_plan_id, 'Chest Day',    1, 'completed'),
    (v_plan_id, 'Leg Day',      2, 'in_progress'),
    (v_plan_id, 'Back Day',     3, 'todo'),
    (v_plan_id, 'Shoulder Day', 4, 'todo');

  select id into v_chest_id from workout_sessions
  where plan_id = v_plan_id and position = 1;
  select id into v_leg_id from workout_sessions
  where plan_id = v_plan_id and position = 2;

  insert into session_exercises (session_id, exercise_id, position, target_sets, target_reps, target_weight)
  select v_chest_id, id, row_number() over (order by name), 4, 10, 60
  from exercises where muscle_group = 'Chest';

  insert into session_exercises (session_id, exercise_id, position, target_sets, target_reps, target_weight)
  select v_leg_id, id, row_number() over (order by name), 4, 8, 80
  from exercises where muscle_group = 'Legs';

  -- Nutrition plan --------------------------------------------------------
  insert into nutrition_plans (member_id, author_id, name, kcal_target, protein_g, carbs_g, fat_g)
  values (v_member_id, v_pro_id, 'Lean Bulk', 2600, 170, 300, 75)
  returning id into v_nut_id;

  insert into meals (plan_id, name, time_of_day, position, kcal, items) values
    (v_nut_id, 'Breakfast', '07:30', 1, 520,
     '[{"food":"Oats","qty":"80 g"},{"food":"Whey","qty":"30 g"},{"food":"Banana","qty":"1"}]'),
    (v_nut_id, 'Lunch',     '13:00', 2, 820,
     '[{"food":"Chicken breast","qty":"200 g"},{"food":"Rice","qty":"120 g"},{"food":"Olive oil","qty":"10 g"}]'),
    (v_nut_id, 'Snack',     '17:00', 3, 380,
     '[{"food":"Greek yogurt","qty":"200 g"},{"food":"Almonds","qty":"25 g"}]'),
    (v_nut_id, 'Dinner',    '20:30', 4, 880,
     '[{"food":"Salmon","qty":"200 g"},{"food":"Potatoes","qty":"250 g"},{"food":"Salad","qty":"1 bowl"}]');

  -- Availability: weekday mornings and afternoons --------------------------
  insert into availability (pro_id, weekday, starts_at, ends_at)
  select v_pro_id, d, '09:00', '13:00' from generate_series(1, 5) d;
  insert into availability (pro_id, weekday, starts_at, ends_at)
  select v_pro_id, d, '14:00', '19:00' from generate_series(1, 5) d;

  -- Today's agenda, mirroring both Home Page wireframes --------------------
  insert into appointments (member_id, pro_id, kind, status, starts_at, ends_at) values
    (v_member_id, v_pro_id, 'training', 'done',
     current_date + time '10:00', current_date + time '11:00'),
    (v_member_id, v_pro_id, 'protocol', 'confirmed',
     current_date + time '11:30', current_date + time '12:00'),
    (v_member_id, v_pro_id, 'nutrition', 'confirmed',
     current_date + interval '2 days' + time '14:00',
     current_date + interval '2 days' + time '14:30');

  -- Chat ------------------------------------------------------------------
  -- RETURNING yields no row when ON CONFLICT DO NOTHING fires, so a re-run
  -- has to fall back to looking the thread up.
  insert into threads (member_id, pro_id) values (v_member_id, v_pro_id)
  on conflict (member_id, pro_id) do nothing
  returning id into v_thread_id;

  if v_thread_id is null then
    select id into v_thread_id from threads
    where member_id = v_member_id and pro_id = v_pro_id;
  end if;

  insert into messages (id, thread_id, sender_id, body, created_at) values
    (gen_random_uuid(), v_thread_id, v_pro_id,
     'Leg day is loaded for this week. Keep the squat at 80 kg.', now() - interval '3 hours'),
    (gen_random_uuid(), v_thread_id, v_member_id,
     'Got it. Lower back felt tight last time, is that normal?', now() - interval '2 hours'),
    (gen_random_uuid(), v_thread_id, v_pro_id,
     'Common at this stage. Add the hip mobility drill before you start.', now() - interval '1 hour');

  -- Rewards ---------------------------------------------------------------
  insert into rewards (member_id, code, title, description, points) values
    (v_member_id, 'first_session', 'First Session', 'Completed your first workout.', 50),
    (v_member_id, 'week_streak',   'Week Streak',   'Trained every scheduled day this week.', 120),
    (v_member_id, 'early_bird',    'Early Bird',    'Checked in before 8 AM five times.', 80)
  on conflict (member_id, code) do nothing;

  -- Check-in history --------------------------------------------------------
  insert into checkins (member_id, scanned_by_id, created_at)
  select v_member_id, v_pro_id, now() - (d || ' days')::interval
  from generate_series(1, 6) d;

  raise notice 'Seed complete for % and %', v_member_id, v_pro_id;
end $$;
```

- [ ] **Step 3: Run it**

Paste into the Supabase SQL Editor → Run.

Expected: `Success. No rows returned.` plus a `Seed complete for …` notice.

- [ ] **Step 4: Verify the data landed**

```sql
select
  (select count(*) from profiles)          as profiles,
  (select count(*) from exercises)         as exercises,
  (select count(*) from workout_sessions)  as sessions,
  (select count(*) from session_exercises) as session_exercises,
  (select count(*) from meals)             as meals,
  (select count(*) from appointments)      as appointments,
  (select count(*) from messages)          as messages,
  (select count(*) from rewards)           as rewards;
```

Expected: `2, 10, 4, 6, 4, 3, 3, 3`.

- [ ] **Step 5: Checkpoint**

Report the counts. Confirm the demo credentials are recorded somewhere Davide can find them on exam day.

---

### Task 7: Supabase client and `AuthProvider`

**Files:**
- Create: `src/lib/supabase.js`, `src/features/auth/AuthProvider.jsx`, `src/features/auth/useAuth.js`, `.env.local`, `.env.example`
- Modify: `src/App.jsx`, `.gitignore`

**Interfaces:**
- Produces: `supabase` — the client singleton. `AuthProvider` — a context provider. `useAuth()` returning `{ session, user, profile, loading, signOut }`, where `profile` carries `role` (`'member' | 'professional'`) and `specialty`.

- [ ] **Step 1: Install the client**

```bash
npm install @supabase/supabase-js
```

- [ ] **Step 2: Create the environment files**

Create `.env.example` (committed, no secrets):

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Create `.env.local` with the real values from the Supabase dashboard → Project Settings → API.

Append to `.gitignore`:

```
.env.local
```

The anon key is public by design — RLS is what protects the data — but keeping it out of the repository is still the right habit.

- [ ] **Step 3: Write the client singleton**

Create `src/lib/supabase.js`:

```js
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Failing here beats failing on the first query with an opaque network error.
if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local.',
  )
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // The app is installed as a PWA, so there is no OAuth redirect to parse.
    detectSessionInUrl: false,
  },
})
```

- [ ] **Step 4: Write the provider**

> **Superseded — read the shipped files, not this block.** Review found two
> Important defects in the code below and it was rewritten. `AuthContext` also
> moved to its own `src/features/auth/AuthContext.js`, because exporting a
> component and a non-component from one module makes Vite Fast Refresh fall
> back to a full reload. The two defects were:
>
> 1. The profile fetch destructured only `data` and had no `.catch()`. A denied
>    or missing row was swallowed; an offline fetch — the normal case for a PWA —
>    became an unhandled rejection. Either way `profile` stayed null forever with
>    `loading` false, and nothing could tell "still loading" from "never coming".
>    There is now a `profileError` in the context value.
> 2. `loading` went false as soon as the session resolved, which is strictly
>    before the profile fetch even starts. That left a real window where
>    `loading === false`, `user` was set and `profile` was still null — and
>    `AppLayout`'s role guard reads exactly those fields, so it would have
>    misrouted on every sign-in. `loading` is now derived from two readiness
>    flags and answers one question: do we know enough to route yet?
>
> `useAuth()` returns `{ session, user, profile, profileError, loading, signOut }`.

Create `src/features/auth/AuthProvider.jsx`:

```jsx
import { createContext, useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase.js'

export const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    // getSession resolves from local storage first, so a cold start offline
    // still knows who is signed in.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      // Supabase warns against awaiting its own client inside this callback:
      // doing so deadlocks the auth lock.  Only synchronous state here; the
      // profile fetch happens in the effect below.
      setSession(next)
      setLoading(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const userId = session?.user?.id ?? null

  useEffect(() => {
    if (!userId) {
      setProfile(null)
      return
    }

    let active = true
    supabase
      .from('profiles')
      .select('id, role, specialty, full_name, avatar_url, assigned_pro_id, subscription_status')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (active) setProfile(data ?? null)
      })

    return () => {
      active = false
    }
  }, [userId])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, profile, loading, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}
```

- [ ] **Step 5: Write the hook**

Create `src/features/auth/useAuth.js`:

```js
import { useContext } from 'react'
import { AuthContext } from './AuthProvider.jsx'

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
```

- [ ] **Step 6: Extend the probe to prove auth works**

Replace the contents of `src/App.jsx` with:

```jsx
import { useState } from 'react'
import {
  Button, Container, CssBaseline, Stack, TextField, ThemeProvider, Typography,
} from '@mui/material'
import theme from './theme/index.js'
import { AuthProvider } from './features/auth/AuthProvider.jsx'
import { useAuth } from './features/auth/useAuth.js'
import { supabase } from './lib/supabase.js'

// Temporary probe: Task 9 replaces this with the router.
function AuthProbe() {
  const { user, profile, loading, signOut } = useAuth()
  const [email, setEmail] = useState('daniel@trainhub.dev')
  const [password, setPassword] = useState('TrainHub2026!')
  const [error, setError] = useState(null)

  if (loading) return <Typography>Loading…</Typography>

  if (user) {
    return (
      <Stack spacing={2}>
        <Typography variant="h2">{profile?.full_name ?? user.email}</Typography>
        <Typography color="text.secondary">
          role: {profile?.role ?? '…'} · specialty: {profile?.specialty ?? 'none'}
        </Typography>
        <Button variant="outlined" onClick={signOut}>Sign out</Button>
      </Stack>
    )
  }

  const signIn = async () => {
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    setError(signInError?.message ?? null)
  }

  return (
    <Stack spacing={2}>
      <TextField label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <TextField
        label="Password" type="password" value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button variant="contained" onClick={signIn}>Sign in</Button>
      {error && <Typography color="error">{error}</Typography>}
    </Stack>
  )
}

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <Container sx={{ py: 4 }}>
          <AuthProbe />
        </Container>
      </AuthProvider>
    </ThemeProvider>
  )
}
```

- [ ] **Step 7: Verify both accounts**

```bash
npm run dev
```

Sign in as `daniel@trainhub.dev`. Expected: `Daniel Aresta`, `role: member · specialty: none`.

Sign out, sign in as `andrea@trainhub.dev`. Expected: `Coach Andrea`, `role: professional · specialty: both`.

Reload the page while signed in. Expected: still signed in — session persistence works.

- [ ] **Step 8: Lint and humanize**

```bash
npm run lint
```

Then run `/humanizer` over every file created in this task.

- [ ] **Step 9: Checkpoint**

Report: both roles authenticate, profile resolves, session survives reload.

---

### Task 8: TanStack Query with IndexedDB persistence

This is the offline read cache and, from Phase 2 onward, the write outbox. `networkMode: 'offlineFirst'` is the load-bearing setting: it makes an offline mutation *pause and persist* rather than fail, which is what lets a member log sets in a basement weights room.

**Files:**
- Create: `src/lib/queryClient.js`
- Modify: `src/App.jsx`

**Interfaces:**
- Produces: `queryClient` and `persister`, consumed by `PersistQueryClientProvider` in `src/App.jsx` and by every `useQuery`/`useMutation` from Phase 1 on.

- [ ] **Step 1: Install**

```bash
npm install @tanstack/react-query @tanstack/react-query-persist-client @tanstack/query-async-storage-persister idb-keyval
```

`idb-keyval` is a ~600-byte IndexedDB wrapper. It exists because `localStorage` is synchronous and size-capped, and a full workout history will not fit.

- [ ] **Step 2: Configure the client and persister**

Create `src/lib/queryClient.js`:

```js
import { QueryClient } from '@tanstack/react-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { del, get, set } from 'idb-keyval'

const ONE_WEEK = 1000 * 60 * 60 * 24 * 7

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // gcTime must outlive the persisted cache, otherwise entries are
      // evicted from memory before they can ever be restored.
      gcTime: ONE_WEEK,
      staleTime: 1000 * 30,
      retry: 2,
      refetchOnWindowFocus: false,
      // Serve cached data immediately and only then reach for the network,
      // instead of failing fast when offline.
      networkMode: 'offlineFirst',
    },
    mutations: {
      // Offline mutations pause and persist rather than error.  Phase 2 pairs
      // this with setMutationDefaults + resumePausedMutations to replay them.
      networkMode: 'offlineFirst',
      retry: 3,
    },
  },
})

export const persister = createAsyncStoragePersister({
  storage: { getItem: get, setItem: set, removeItem: del },
  key: 'trainhub-query-cache',
  throttleTime: 1000,
})
```

- [ ] **Step 3: Wrap the app**

In `src/App.jsx`, add these two imports alongside the existing ones at the top of the file:

```jsx
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { persister, queryClient } from './lib/queryClient.js'
```

Then replace the whole `App` component (leave `AuthProbe` untouched) with:

```jsx
export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 * 7 }}
        onSuccess={() => {
          // Anything queued while offline goes out as soon as the restored
          // cache is in place.
          queryClient.resumePausedMutations()
        }}
      >
        <AuthProvider>
          <Container sx={{ py: 4 }}>
            <AuthProbe />
          </Container>
        </AuthProvider>
      </PersistQueryClientProvider>
    </ThemeProvider>
  )
}
```

- [ ] **Step 4: Prove the cache actually persists**

Temporarily add to `AuthProbe`, above its `return`:

```jsx
  // Temporary persistence probe — removed in Task 9.
  const { data: exerciseCount } = useQuery({
    queryKey: ['exercises', 'count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('exercises')
        .select('*', { count: 'exact', head: true })
      return count
    },
  })
```

and render `<Typography>exercises: {exerciseCount ?? '…'}</Typography>` inside the signed-in branch. Add `import { useQuery } from '@tanstack/react-query'` at the top.

- [ ] **Step 5: Verify online, then offline**

```bash
npm run dev
```

Sign in. Expected: `exercises: 10`.

Then in DevTools → Application → IndexedDB → `keyval-store`, confirm a `trainhub-query-cache` entry exists.

Now switch DevTools → Network to **Offline** and reload. Expected: `exercises: 10` still renders, served from IndexedDB with no network at all. This is the whole point of the task — if it shows `…`, persistence is not wired.

- [ ] **Step 6: Remove the probe query**

Delete the `useQuery` block, its `Typography`, and the now-unused import added in Step 4.

- [ ] **Step 7: Lint and humanize**

```bash
npm run lint
```

Then run `/humanizer` over `src/lib/queryClient.js`.

- [ ] **Step 8: Checkpoint**

Report: offline reload served cached data.

---

### Task 9: Route shell, layouts and bottom navigation

**Files:**
- Create: `src/components/BrandLogo.jsx`, `src/components/TopHeader.jsx`, `src/components/BottomNav.jsx`, `src/components/Placeholder.jsx`, `src/layouts/PublicLayout.jsx`, `src/layouts/AppLayout.jsx`, `src/routes/navItems.js`, `src/routes/index.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `theme` from Task 1, and `useAuth()` from Task 7 returning
  `{ session, user, profile, profileError, loading, signOut }`. `loading === false`
  means the role is settled *or* definitively unavailable — when it is false and
  `profile` is still null, `profileError` says why, and the guard must render a
  failure state rather than routing.
- Produces: `router` (default export of `src/routes/index.jsx`), the full route tree from the design spec with `Placeholder` bodies. Phase 1 onward replaces placeholders screen by screen, leaving the tree untouched.

- [ ] **Step 1: Install the router**

```bash
npm install react-router
```

React Router v7 ships everything from `react-router`; `react-router-dom` is only a compatibility shim.

- [ ] **Step 2: The brand mark**

Create `src/components/BrandLogo.jsx`:

```jsx
import { useTheme } from '@mui/material/styles'

/** The TH monogram from doc/assets/components/Logo.png, as inline SVG. */
export default function BrandLogo({ size = 32 }) {
  const theme = useTheme()
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" role="img" aria-label="TrainHub">
      <path d="M96 128h176v44h-66v212h-44V172h-66z" fill={theme.palette.text.primary} />
      <g fill={theme.palette.primary.main}>
        <rect x="296" y="128" width="44" height="256" />
        <rect x="372" y="128" width="44" height="256" />
        <rect x="296" y="234" width="120" height="44" />
      </g>
      <g fill={theme.palette.background.paper}>
        <rect x="316" y="246" width="80" height="20" rx="10" />
        <rect x="302" y="234" width="14" height="44" rx="7" />
        <rect x="396" y="234" width="14" height="44" rx="7" />
      </g>
    </svg>
  )
}
```

- [ ] **Step 3: The top header**

Matches `doc/assets/components/Top Header.png`: greeting above the name, bell with a badge, avatar linking to the profile.

Create `src/components/TopHeader.jsx`:

```jsx
import { AppBar, Avatar, Badge, Box, IconButton, Toolbar, Typography } from '@mui/material'
import NotificationsIcon from '@mui/icons-material/Notifications'
import { Link } from 'react-router'
import { useAuth } from '../features/auth/useAuth.js'

function greeting(hour) {
  if (hour < 12) return 'Good Morning'
  if (hour < 18) return 'Good Afternoon'
  return 'Good Evening'
}

export default function TopHeader({ profileHref, notificationCount = 0 }) {
  const { profile } = useAuth()

  return (
    <AppBar position="sticky" color="inherit" elevation={0}>
      <Toolbar sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" noWrap>
            {greeting(new Date().getHours())}
          </Typography>
          <Typography variant="h3" noWrap>
            {profile?.full_name ?? ''}
          </Typography>
        </Box>

        <IconButton aria-label={`${notificationCount} notifications`}>
          <Badge badgeContent={notificationCount} color="primary">
            <NotificationsIcon />
          </Badge>
        </IconButton>

        <IconButton component={Link} to={profileHref} aria-label="Profile">
          <Avatar src={profile?.avatar_url ?? undefined} sx={{ width: 36, height: 36 }}>
            {profile?.full_name?.[0] ?? '?'}
          </Avatar>
        </IconButton>
      </Toolbar>
    </AppBar>
  )
}
```

- [ ] **Step 4: The bottom navigation**

Note the active-item logic. `/m` is a prefix of `/m/workout`, so a naive `startsWith` would light up Home on every screen. Picking the **longest** matching path is what makes it correct.

Create `src/components/BottomNav.jsx`:

```jsx
import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material'
import { Link, useLocation } from 'react-router'

export default function BottomNav({ items }) {
  const { pathname } = useLocation()

  // Every item's path is a prefix of the section root, so the most specific
  // match wins rather than the first one found.
  const current = items.reduce((best, item, index) => {
    const matches = pathname === item.to || pathname.startsWith(`${item.to}/`)
    if (!matches) return best
    if (best === -1) return index
    return item.to.length > items[best].to.length ? index : best
  }, -1)

  return (
    <Paper
      elevation={0}
      sx={{
        position: 'sticky', bottom: 0, borderTop: 1, borderColor: 'divider',
        // Keeps the bar clear of the iOS home indicator.
        pb: 'env(safe-area-inset-bottom)',
      }}
    >
      <BottomNavigation value={current} showLabels>
        {items.map(({ to, label, icon: Icon }) => (
          <BottomNavigationAction
            key={to}
            component={Link}
            to={to}
            label={label}
            icon={<Icon />}
          />
        ))}
      </BottomNavigation>
    </Paper>
  )
}
```

- [ ] **Step 5: The navigation configs**

Icons chosen to match `doc/assets/components/Bottom Bar.png`. "My Trainer" has no Material equivalent for the wireframe's `PT` lettermark, so `FitnessCenter`'s sibling `SportsMartialArts` stands in until Phase 4 swaps in a custom glyph.

Create `src/routes/navItems.js`:

```js
import HomeIcon from '@mui/icons-material/Home'
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter'
import RestaurantIcon from '@mui/icons-material/Restaurant'
import SportsMartialArtsIcon from '@mui/icons-material/SportsMartialArts'
import PeopleIcon from '@mui/icons-material/People'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import ChatBubbleIcon from '@mui/icons-material/ChatBubble'

export const memberNav = [
  { to: '/m',           label: 'Home',       icon: HomeIcon },
  { to: '/m/workout',   label: 'Workout',    icon: FitnessCenterIcon },
  { to: '/m/nutrition', label: 'Nutrition',  icon: RestaurantIcon },
  { to: '/m/trainer',   label: 'My Trainer', icon: SportsMartialArtsIcon },
]

export const professionalNav = [
  { to: '/p',          label: 'Home',     icon: HomeIcon },
  { to: '/p/clients',  label: 'Clients',  icon: PeopleIcon },
  { to: '/p/calendar', label: 'Calendar', icon: CalendarMonthIcon },
  { to: '/p/chat',     label: 'Chat',     icon: ChatBubbleIcon },
]
```

- [ ] **Step 6: The placeholder screen**

Create `src/components/Placeholder.jsx`:

```jsx
import { Box, Typography } from '@mui/material'

/**
 * Stands in for a screen that has not been built yet.  Replaced one at a time
 * across phases 1-4; the route tree never changes.
 */
export default function Placeholder({ name }) {
  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h1">{name}</Typography>
      <Typography color="text.secondary">Not built yet.</Typography>
    </Box>
  )
}
```

- [ ] **Step 7: The layouts**

Create `src/layouts/PublicLayout.jsx`:

```jsx
import { Box, Container, Stack } from '@mui/material'
import { Outlet } from 'react-router'
import BrandLogo from '../components/BrandLogo.jsx'

export default function PublicLayout() {
  return (
    <Container maxWidth="sm" sx={{ minHeight: '100dvh', display: 'flex', alignItems: 'center' }}>
      <Stack spacing={4} sx={{ width: '100%', py: 6 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <BrandLogo size={72} />
        </Box>
        <Outlet />
      </Stack>
    </Container>
  )
}
```

Create `src/layouts/AppLayout.jsx`:

```jsx
import { Box } from '@mui/material'
import { Navigate, Outlet } from 'react-router'
import BottomNav from '../components/BottomNav.jsx'
import TopHeader from '../components/TopHeader.jsx'
import { useAuth } from '../features/auth/useAuth.js'

/**
 * The signed-in shell for both roles.  The only difference between a member's
 * app and a professional's is `navItems`, so one layout serves both.
 *
 * @param {object}  props
 * @param {Array}   props.navItems     Bottom-bar entries for this role.
 * @param {string}  props.profileHref  Where the avatar links.
 * @param {string}  props.requiredRole Role this section is reserved for.
 */
export default function AppLayout({ navItems, profileHref, requiredRole }) {
  const { user, profile, loading } = useAuth()

  // Hold the shell until the session is known, otherwise a signed-in user is
  // briefly bounced to /login on every cold start.
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />

  // The profile arrives one tick after the session; do not judge the role yet.
  if (profile && profile.role !== requiredRole) {
    return <Navigate to={profile.role === 'professional' ? '/p' : '/m'} replace />
  }

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <TopHeader profileHref={profileHref} />
      <Box component="main" sx={{ flexGrow: 1, pb: 2 }}>
        <Outlet />
      </Box>
      <BottomNav items={navItems} />
    </Box>
  )
}
```

- [ ] **Step 8: The route tree**

Create `src/routes/index.jsx`:

```jsx
import { createBrowserRouter, Navigate } from 'react-router'
import AppLayout from '../layouts/AppLayout.jsx'
import PublicLayout from '../layouts/PublicLayout.jsx'
import Placeholder from '../components/Placeholder.jsx'
import { memberNav, professionalNav } from './navItems.js'

// Every screen starts as a placeholder; phases 1-4 replace them one by one.
const screen = (name) => ({ element: <Placeholder name={name} /> })

const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: '/login', ...screen('Login') },
      { path: '/forgot-password', ...screen('Forgot Password') },
      { path: '/reset-password', ...screen('Reset Password') },
    ],
  },

  {
    path: '/m',
    element: <AppLayout navItems={memberNav} profileHref="/m/profile" requiredRole="member" />,
    children: [
      { index: true, ...screen('Home') },

      { path: 'workout', ...screen('Workout Plan') },
      { path: 'workout/session/:sessionId', ...screen('Session Detail') },
      { path: 'workout/session/:sessionId/live', ...screen('Live Session') },
      { path: 'workout/session/:sessionId/summary', ...screen('Session Summary') },
      { path: 'workout/exercise/:exerciseId', ...screen('Exercise Details') },
      { path: 'workout/builder', ...screen('Workout Builder') },

      { path: 'nutrition', ...screen('Nutrition') },
      { path: 'nutrition/meal/:mealId', ...screen('Meal Details') },

      { path: 'trainer', ...screen('My Trainer') },
      { path: 'trainer/browse', ...screen('Choose a Professional') },
      { path: 'trainer/appointments', ...screen('My Appointments') },
      { path: 'trainer/chat', ...screen('Chat') },

      { path: 'profile', ...screen('Profile') },
      { path: 'profile/badge', ...screen('Access Badge') },
      { path: 'profile/subscription', ...screen('Subscription') },
      { path: 'profile/rewards', ...screen('Rewards') },
      { path: 'profile/settings', ...screen('Settings') },
    ],
  },

  {
    path: '/p',
    element: (
      <AppLayout navItems={professionalNav} profileHref="/p/profile" requiredRole="professional" />
    ),
    children: [
      { index: true, ...screen("Today's Agenda") },

      { path: 'clients', ...screen('Clients') },
      { path: 'clients/:clientId', ...screen('Client Detail') },
      { path: 'clients/:clientId/workout', ...screen('Assign Workout') },
      { path: 'clients/:clientId/nutrition', ...screen('Nutrition Plan') },
      { path: 'clients/:clientId/progress', ...screen('Progress Tracking') },

      { path: 'calendar', ...screen('Calendar') },
      { path: 'calendar/availability', ...screen('Availability') },
      { path: 'calendar/:appointmentId', ...screen('Appointment Detail') },

      { path: 'chat', ...screen('Chat') },
      { path: 'chat/:threadId', ...screen('Thread') },

      { path: 'scan', ...screen('Scan Access Badge') },

      { path: 'profile', ...screen('Profile') },
      { path: 'profile/settings', ...screen('Settings') },
    ],
  },

  { path: '/', element: <Navigate to="/m" replace /> },
  { path: '*', element: <Navigate to="/m" replace /> },
])

export default router
```

Note the ordering under `/p`: `calendar/availability` is declared before `calendar/:appointmentId` so the literal segment is not swallowed by the parameter.

- [ ] **Step 9: Mount the router**

Replace the entire contents of `src/App.jsx` with:

```jsx
import { CssBaseline, ThemeProvider } from '@mui/material'
import { RouterProvider } from 'react-router'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import theme from './theme/index.js'
import router from './routes/index.jsx'
import { AuthProvider } from './features/auth/AuthProvider.jsx'
import { persister, queryClient } from './lib/queryClient.js'

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 * 7 }}
        onSuccess={() => queryClient.resumePausedMutations()}
      >
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </PersistQueryClientProvider>
    </ThemeProvider>
  )
}
```

- [ ] **Step 10: Walk the tree**

```bash
npm run dev
```

The app now requires a real session, and the login screen is still a placeholder — so sign in through the browser console once:

```js
// DevTools console
const { supabase } = await import('/src/lib/supabase.js')
await supabase.auth.signInWithPassword({ email: 'daniel@trainhub.dev', password: 'TrainHub2026!' })
```

Then confirm:
- `/m` renders "Home" with the member bottom bar: Home · Workout · Nutrition · My Trainer.
- Tapping each tab navigates and **only the tapped tab highlights**. On `/m/workout` the Workout tab is active and Home is not — this is the longest-prefix logic from Step 4.
- Visiting `/p` while signed in as Daniel redirects to `/m`.
- Every path in Step 8 renders its placeholder rather than a blank screen.
- Sign in as Coach Andrea and repeat for `/p`; `/m` should redirect to `/p`.

- [ ] **Step 11: Lint and humanize**

```bash
npm run lint
```

Then run `/humanizer` over every file created in this task.

- [ ] **Step 12: Checkpoint**

Report: full route tree navigable for both roles, role guard verified in both directions.

---

### Task 10: Phase 0 acceptance

The point of this task is that the PWA requirements are verified on real hardware over real HTTPS, not asserted from `localhost`.

**Files:** none — verification only.

- [ ] **Step 1: Build and preview**

```bash
npm run build && npm run preview
```

Expected: build succeeds with no warnings about an oversized precache.

- [ ] **Step 2: Expose over HTTPS on the static domain**

In a second terminal:

```bash
ngrok http 4173 --url=wrinkly-mankind-doodle.ngrok-free.dev
```

A rotating URL would invalidate push subscriptions in Phase 4 and break the Supabase Auth redirect allowlist, so the static domain is not a convenience.

- [ ] **Step 3: Confirm the origin is registered with Supabase**

Supabase dashboard → Authentication → URL Configuration. `https://wrinkly-mankind-doodle.ngrok-free.dev` must appear under both **Site URL** and **Redirect URLs**.

- [ ] **Step 4: Install on a real Android phone**

Open `https://wrinkly-mankind-doodle.ngrok-free.dev` in Chrome on the phone. Expected: an install prompt or "Add to Home screen" in the menu. Install it.

Launch from the home screen and confirm:
- The TH monogram is the launcher icon.
- It opens **without browser chrome** — that is `display: standalone` working.
- The status bar picks up `#FE6363`.

- [ ] **Step 5: Lighthouse**

Desktop Chrome against the ngrok URL, DevTools → Lighthouse, Mobile, with the PWA-related audits enabled.

Expected: installability passes, `apple-touch-icon` present, `themed omnibox` passes, splash screen configured. Screenshot the panel — it goes into report chapter 5.

- [ ] **Step 6: Offline on the installed app**

With the app open on the phone, enable airplane mode and relaunch from the home screen.

Expected: the shell renders and the route tree still navigates. Placeholder screens are fine; a browser error page is not.

- [ ] **Step 7: Record what shipped**

Append to `docs/superpowers/plans/2026-07-27-trainhub-phase-0-foundations.md` a short "Phase 0 outcome" note: Lighthouse results, the install screenshot path, and anything deferred.

- [ ] **Step 8: Checkpoint**

Report Phase 0 complete. Phase 1 (Auth + member core, 30 Jul – 5 Aug) gets its own plan, written when Phase 0 closes — planning it now would be guessing.

---

## Notes for later phases

Carried forward so they are not rediscovered:

- **Phase 2** must call `queryClient.setMutationDefaults(['setLogs'], { mutationFn })` for every offline-capable mutation. Without a default `mutationFn`, a mutation restored from IndexedDB has no function to resume into and is silently dropped.
- **Phase 4** adds `push` and `notificationclick` handlers to `src/sw.js`. Because `src/sw.js` is built by Vite, `import.meta.env.VITE_*` is available inside it.
- **Phase 4** should replace `SportsMartialArtsIcon` with the `PT` lettermark from `doc/assets/components/PT.png`.
- `BarcodeDetector` is Chromium-only. If the exam demo runs on iOS or Safari, add the `jsQR` fallback.
- `set_logs.id` and `messages.id` are client-supplied UUIDs with no default, deliberately: an offline write that gets replayed twice must land on the same primary key rather than duplicate.
