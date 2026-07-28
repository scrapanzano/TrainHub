# Task 12 Report: Route-level code splitting

## File modified

`src/routes/index.jsx` — only file touched, as scoped by the brief.

## Step 1: Baseline build (before change)

Command: `npm run build`

Verbatim relevant output:

```
dist/manifest.webmanifest                                    0.56 kB
dist/index.html                                              0.72 kB │ gzip:   0.39 kB
dist/assets/inter-vietnamese-wght-normal-CBcvBZtf.woff2     10.25 kB
dist/assets/inter-greek-ext-wght-normal-DlzME5K_.woff2      11.23 kB
dist/assets/inter-cyrillic-wght-normal-DqGufNeO.woff2       18.74 kB
dist/assets/inter-greek-wght-normal-CkhJZR-_.woff2          18.99 kB
dist/assets/inter-cyrillic-ext-wght-normal-BOeWTOD4.woff2   25.96 kB
dist/assets/inter-latin-wght-normal-Dx4kXJAl.woff2          48.25 kB
dist/assets/inter-latin-ext-wght-normal-DO1Apj_S.woff2      85.06 kB
dist/assets/index-DXwKLnyY.css                               2.00 kB │ gzip:   0.63 kB
dist/assets/workbox-window.prod.es5-Bd17z0YL.js              5.65 kB │ gzip:   2.20 kB
dist/assets/index-D2dMRaof.js                              819.35 kB │ gzip: 243.30 kB

✓ built in 388ms

[plugin builtin:vite-reporter]
(!) Some chunks are larger than 500 kB after minification. ...

PWA v1.3.0
mode      injectManifest
format:   es
precache  14 entries (938.53 KiB)
files generated
  dist/sw.js
```

**Before numbers:**
- Precache: **14 entries (938.53 KiB)**
- Largest `dist/assets/*.js`: **`index-D2dMRaof.js` at 819.35 kB** (single bundled chunk)

Note: the brief's expectation text said "a single chunk near 669 KiB" — the actual baseline measured on this checkout was 819.35 kB. Recorded the actual measured value, not the brief's estimate.

## Step 2: Code change

In `src/routes/index.jsx`:
- Deleted exactly the four static imports for `MemberHomeScreen`, `WorkoutPlanScreen`, `SessionDetailScreen`, `ExerciseDetailScreen`.
- Kept the three auth imports (`LoginScreen`, `ForgotPasswordScreen`, `ResetPasswordScreen`) and their routes unchanged.
- Converted the four corresponding `/m` routes (`index`, `workout`, `workout/session/:sessionId`, `workout/exercise/:sessionExerciseId`) to use `lazy: async () => ({ Component: (await import(...)).default })`, matching the brief's snippet verbatim.
- Left every `screen('...')` placeholder route (both `/m` and all of `/p`) untouched.

## Step 3: Rebuild and compare (after change)

Command: `npm run build`

Verbatim relevant output:

```
dist/manifest.webmanifest                                    0.56 kB
dist/index.html                                              1.21 kB │ gzip:   0.51 kB
dist/assets/inter-vietnamese-wght-normal-CBcvBZtf.woff2     10.25 kB
dist/assets/inter-greek-ext-wght-normal-DlzME5K_.woff2      11.23 kB
dist/assets/inter-cyrillic-wght-normal-DqGufNeO.woff2       18.74 kB
dist/assets/inter-greek-wght-normal-CkhJZR-_.woff2          18.99 kB
dist/assets/inter-cyrillic-ext-wght-normal-BOeWTOD4.woff2   25.96 kB
dist/assets/inter-latin-wght-normal-Dx4kXJAl.woff2          48.25 kB
dist/assets/inter-latin-ext-wght-normal-DO1Apj_S.woff2      85.06 kB
dist/assets/index-DXwKLnyY.css                               2.00 kB │ gzip:   0.63 kB
dist/assets/RtlProvider-hPYE2-Sm.js                          0.27 kB │ gzip:   0.21 kB
dist/assets/useAuth-W8ObQDGY.js                              0.27 kB │ gzip:   0.21 kB
dist/assets/rolldown-runtime-Bh1tDfsg.js                     0.56 kB │ gzip:   0.36 kB
dist/assets/SessionCard-Za6s51VH.js                          1.42 kB │ gzip:   0.69 kB
dist/assets/ChevronRight-BbP8EttD.js                         1.75 kB │ gzip:   0.89 kB
dist/assets/SessionDetailScreen-CZwIeA3V.js                  2.25 kB │ gzip:   0.98 kB
dist/assets/ExerciseDetailScreen-CCE8h1nj.js                 2.43 kB │ gzip:   1.05 kB
dist/assets/Avatar-DuKzoQ5N.js                               2.88 kB │ gzip:   1.46 kB
dist/assets/ArrowBackIosNew-D8ZjMOk_.js                      3.41 kB │ gzip:   1.46 kB
dist/assets/MemberHomeScreen-B16Ic3mv.js                     3.73 kB │ gzip:   1.64 kB
dist/assets/workbox-window.prod.es5-Bd17z0YL.js              5.65 kB │ gzip:   2.20 kB
dist/assets/Chip-KhW4yXud.js                                 8.02 kB │ gzip:   2.66 kB
dist/assets/WorkoutPlanScreen-BrcEb0IV.js                   11.66 kB │ gzip:   3.58 kB
dist/assets/ScreenState-BILMxq3w.js                         12.58 kB │ gzip:   4.78 kB
dist/assets/index-ss7PjPdG.js                              335.11 kB │ gzip: 104.04 kB
dist/assets/supabase-CosY-Rmo.js                           438.56 kB │ gzip: 129.14 kB

✓ built in 329ms

PWA v1.3.0
mode      injectManifest
format:   es
precache  28 entries (944.48 KiB)
files generated
  dist/sw.js
```

**After numbers:**
- Precache: **28 entries (944.48 KiB)**
- Largest `dist/assets/*.js`: **`supabase-CosY-Rmo.js` at 438.56 kB** (a vendor chunk, not the app entry — the app's own `index-ss7PjPdG.js` is 335.11 kB)

**Before/after summary:**

| Metric | Before | After |
|---|---|---|
| Precache entries | 14 | 28 |
| Precache total size | 938.53 KiB | 944.48 KiB |
| Largest `dist/assets/*.js` | 819.35 kB (`index-*.js`, monolithic bundle) | 438.56 kB (`supabase-*.js`, a vendor chunk) |

Matches the brief's expectation: entry count roughly doubled (one entry per new chunk), total precache size stayed essentially flat (938.53 → 944.48 KiB, a ~0.6% increase from the extra module-boundary overhead), and the largest single JS file dropped by nearly half (819.35 kB → 438.56 kB), with the previously-monolithic bundle now split into the four lazy screen chunks (`MemberHomeScreen`, `WorkoutPlanScreen`, `SessionDetailScreen`, `ExerciseDetailScreen`) plus their shared sub-chunks (`ScreenState`, `Chip`, `Avatar`, `SessionCard`, etc.) and the remaining vendor/app chunks.

## Step 4: Navigation verification — DEFERRED (browser part skipped)

Per explicit instruction, the browser-based verification (`npm run preview`, manual sign-in, navigating `/m` → `/m/workout` → session → exercise, DevTools Network/Offline checks) was **not performed** — no browser is available in this environment, and no preview server was started. This step is left for manual/human verification as originally scoped in the brief.

## Step 5: Lint

Command: `npm run lint`

Output:
```
> trainhub@0.0.0 lint
> eslint .
```
Exit code: **0**. No errors, no warnings. This confirms the four now-unused static imports were fully removed (an unused import left behind would have failed lint), and no other issue was introduced.

## Step 6: Commit

```
git add src/routes/index.jsx
git commit -m "perf: split member screens into lazy route chunks"
```

Result: **commit `da1a07f`** on branch `main`, message `perf: split member screens into lazy route chunks`, 1 file changed (16 insertions, 8 deletions). No `Co-Authored-By` trailer was added, per instructions.

Note: `README.md` had a pre-existing uncommitted modification (present before this task started, per the initial git status) and was deliberately left out of the `git add` / commit — only `src/routes/index.jsx` was staged and committed, matching the brief's scope.

## Self-review

- **Only `src/routes/index.jsx` changed.** Confirmed via `git status --short` before commit (`M  src/routes/index.jsx` only staged).
- **Every route still resolves to a component.**
  - The 3 auth routes (`/login`, `/forgot-password`, `/reset-password`) are unchanged, still statically imported and rendered via `element`.
  - The 4 converted `/m` routes (`index`, `workout`, `workout/session/:sessionId`, `workout/exercise/:sessionExerciseId`) now use `lazy: async () => ({ Component: ... })`, which is the documented React Router data-router API for resolving a route's component at navigation time — no `<Suspense>` boundary needed, matching the brief.
  - All remaining routes — the 5 untouched `/m` placeholders under `workout/*`, `nutrition/*`, `trainer/*`, `profile/*` and all 14 `/p` (professional) routes — are unchanged and continue to use `...screen('...')`, which spreads `{ element: <Placeholder name={...} /> }`.
  - The catch-all/redirect routes (`/` and `*` → `<Navigate to="/m" replace />`) are unchanged.
- **No placeholder route was converted by mistake.** Diffed the final file against the original: the only structural changes are the 4 import deletions and the 4 route-object conversions specified in the brief's Step 2 snippet, verbatim. Every `screen('...')` call site in both `/m` and `/p` subtrees is untouched, confirmed by re-reading the full file post-edit (lines 40-96 above) — none of the `...screen(...)` lines were touched, edited, or reformatted.
- **Build evidence is consistent with the change being real, not accidental.** The four lazy-loaded screens (`MemberHomeScreen`, `WorkoutPlanScreen`, `SessionDetailScreen`, `ExerciseDetailScreen`) each appear as their own named chunk in the "after" build output, which would not happen if they were still statically imported into the main bundle.
- **Risk flagged in the brief (PWA precache omission)** was not independently re-verified because Step 4's browser check was deferred; however, `vite.config.js` was not modified (confirmed — out of scope, and no edits were made to it), so `injectManifest.globPatterns` still includes `**/*.{js,css,html}`, and the precache entry count rising from 14 to 28 in the build output is direct evidence that the new chunks were picked up by the precache manifest at build time. Runtime offline behavior of the new chunks still needs the deferred manual check.
