# Task 4 report: Offline-replayable mutation registration

## Files created

- `src/lib/mutationKeys.js` — exports `mutationKeys` with `logSet: ['logSet']` and
  `setSessionStatus: ['setSessionStatus']`. Transcribed verbatim from the brief,
  including the comment explaining why mutation keys are load-bearing (not just
  cache bookkeeping) for the persister's `setMutationDefaults` lookup.
- `src/data/mutations.js` — exports `registerMutationDefaults(queryClient)`.
  Registers `mutationFn: logSet` for `mutationKeys.logSet` with an `onSettled`
  that invalidates `queryKeys.sessionLogs(variables.sessionId)` and
  `queryKeys.session(variables.sessionId)`; registers `mutationFn:
  setSessionStatus` for `mutationKeys.setSessionStatus` with an `onSettled`
  that invalidates `queryKeys.session(variables.sessionId)` and `['plan']`.
  Transcribed verbatim from the brief.

## Files modified

- `src/App.jsx` — added `import { registerMutationDefaults } from
  './data/mutations.js'` beside the existing imports, then a module-scope call
  `registerMutationDefaults(queryClient)` placed immediately after all imports
  and immediately before `export default function App()`. No other lines
  changed.

## Lint and build

- `npm run lint` — exit 0, no output (clean).
- `npm run build` — succeeded. Vite client build completed (1106 modules
  transformed), followed by the `vite-plugin-pwa` `injectManifest` service
  worker build (`dist/sw.js`, 28 precache entries). No errors; one pre-existing
  deprecation warning from Vite (`inlineDynamicImports` → `codeSplitting:
  false`) unrelated to this change.

## Commit

- Hash: `7c9d9bc9607853db3b552b85b0a99fe4ed0f1701`
- Message: `feat: register mutation defaults so offline writes survive a reload`
- Files staged and committed: `src/lib/mutationKeys.js`, `src/data/mutations.js`,
  `src/App.jsx` (exactly the three files the brief names — the pre-existing
  unrelated modification to `README.md` was left untouched/unstaged).
- No `Co-Authored-By` or any other trailer was added, per the constraint that
  the repository history belongs to one author.

## Self-review

`registerMutationDefaults(queryClient)` sits at module scope in `src/App.jsx`,
directly after the import block and directly before `export default function
App()` — i.e. it runs once, synchronously, the first time the module is
evaluated (on script load), before the `App` component itself is ever
constructed or rendered, and therefore before `PersistQueryClientProvider`
mounts.

That position is the one that works because `PersistQueryClientProvider`
restores the persisted cache and calls `resumePausedMutations()` (via the
`onSuccess` callback already wired in `App.jsx`) as part of its mount
lifecycle — which happens *after* the module has finished loading but *before*
any `useEffect` in any descendant component has a chance to run. If the
registration were instead placed inside a `useEffect` (even one in `App`
itself, executed after the first render), it would run after
`PersistQueryClientProvider` has already resumed the rehydrated mutations from
IndexedDB. Those resumed mutations look up their `mutationFn` by key via
`setMutationDefaults` at the moment they resume; if no default has been
registered yet for that key, TanStack Query has nothing to call and silently
discards the mutation — exactly the failure mode the brief describes (an
offline-logged set vanishing on reload with no console error). Calling
`registerMutationDefaults` at module scope guarantees the defaults exist
before `PersistQueryClientProvider` — and hence `resumePausedMutations` — ever
runs, regardless of React's render/effect timing.

I verified the three consumed interfaces (`logSet`, `setSessionStatus` from
`src/data/workouts.js`; `queryKeys` from `src/lib/queryKeys.js`; `queryClient`
from `src/lib/queryClient.js`) by reading each file in full before writing
code, and confirmed `logSet`'s destructured argument list has no issue
accepting an extra `sessionId` property (it is simply ignored, as the brief
states). No `mutationFn` was declared at any `useMutation` call site — those
are out of scope for this task and were not touched. No new runtime
dependencies were added; only existing exports were imported. Code is plain JS
+ JSX, ESM `import`/`export` throughout, matching project constraints.

## Fix: prefix invalidation and the onSettled override warning

### Finding 1 & 3 — prefix-based invalidation

Added `queryPrefixes` to `src/lib/queryKeys.js` (below `queryKeys`, unmodified):
`{ plan: ['plan'], session: ['session'], sessionLogs: ['sessionLogs'], rewards: ['rewards'] }`,
with a comment explaining `invalidateQueries` matches by prefix via
`partialMatchKey`, so invalidating the family is immune to a caller forgetting
to pass an id (which would otherwise produce e.g. `['sessionLogs', undefined]`
and silently match nothing).

In `src/data/mutations.js`, the import changed from `queryKeys` to
`queryPrefixes`. `logSet`'s `onSettled` now invalidates
`queryPrefixes.sessionLogs` and `queryPrefixes.session` (dropped the
`(_data, _error, variables)` params, now unused). `setSessionStatus`'s
`onSettled` now invalidates `queryPrefixes.session` and `queryPrefixes.plan`
(replacing the inline literal `['plan']`).

### Finding 2 — onSettled override warning

Added a final paragraph to the JSDoc on `registerMutationDefaults` warning
that call sites must not declare their own `onSettled` in `useMutation`
options, since `defaultMutationOptions` spreads the call site's options last
and would silently replace (not compose with) the registered handler — the
invalidations would then only fire on offline replay, never online. Notes
that per-call `mutate(vars, { onSuccess })` is a different, safe mechanism.

### Verification

- `npm run lint` — exit 0, clean.
- `npm run build` — succeeded (client build + `injectManifest` service worker
  build, 28 precache entries), no new errors. Same pre-existing
  `inlineDynamicImports` deprecation warning as before, unrelated to this
  change.
- `queryKeys` is no longer imported in `mutations.js` — replaced entirely by
  `queryPrefixes`; grep confirms no remaining reference to `queryKeys` in that
  file.
- Prefix match confirmed: `queryPrefixes.session` is `['session']`,
  `queryKeys.session(someId)` is `['session', someId]` — prefix matches.
  `queryPrefixes.plan` is `['plan']`, `queryKeys.activePlan(someId)` is
  `['plan', someId]` — prefix matches.
- Grepped `useMutation` across `src/` — no call site exists in the codebase
  yet (only the JSDoc's own reference to the term), so no call site declares
  a conflicting `onSettled`.

### Commit

- Message: `fix: invalidate query prefixes instead of literal/partial keys`
- No `Co-Authored-By` trailer, per repository convention.
