# Task 5 report: Sync status — offline banner and failed writes

## Files

- Created: `src/components/OfflineBanner.jsx` — transcribed verbatim from the brief's code block, including all comments.
- Modified: `src/layouts/AppLayout.jsx` — added `import OfflineBanner from '../components/OfflineBanner.jsx'` alphabetically among the existing component imports, and rendered `<OfflineBanner />` between `<TopHeader profileHref={profileHref} />` and `<Box component="main" ...>` in the final `return`. No other lines touched.

Confirmed before writing: `AppLayout.jsx`'s guard/shell structure matched the brief's description exactly (four-branch guard, then `TopHeader` → `Box component="main"` with `Outlet` → `BottomNav`), and `theme/index.js` defines `palette.task.suspended` (`tokens['Theme.Status.Suspended']`) as described, so `bgcolor: 'task.suspended'` resolves correctly. `@mui/icons-material/CloudOff` resolves (package already installed, no new dependency added).

## Lint

`npm run lint` → exit 0, no warnings or errors.

## Commit

- Hash: `35c4f63d158304c6673c5dad39b37dc07c083c42`
- Message: `feat: show sync status for offline and failed writes`
- No `Co-Authored-By` trailer included.
- Staged/committed only the two files listed in the brief's Step 5.

## Step 4 (browser verification)

Skipped per instructions — no browser available in this environment. Deferred to a human with `npm run dev` (or `npm run build && npm run preview` for full PWA/service-worker behavior), sign in, then DevTools → Network → Offline, per the table in the brief.

## Self-review: what renders in each case

1. **Online, nothing pending** — `online = true`, `waiting = 0`, `failed = 0`. The `banner` expression's condition `!online || waiting > 0` is `false`, so `banner` is `null`. The `Snackbar` has `open={false}` (since `failed > 0` is false), so nothing visible renders — matches "nothing renders" from the brief's Step 4 table.
2. **Online, a write in flight (not paused)** — `online = true`. The in-flight mutation has `status: 'pending'` but `mutation.state.isPaused` is `false` (it's actively running, not paused for lack of network), so it's filtered out by `.filter(Boolean)` and `waiting` stays `0`. Condition is again `false` → nothing renders. This is exactly the case the brief's ambiguity note calls out: filtering on `isPaused` rather than raw `pending` status is what prevents the banner from flashing on every ordinary write.
3. **Offline, nothing pending** — `online = false`, `waiting = 0`. Condition `!online || waiting > 0` is `true` → banner renders. Since `online` is falsy, the ternary falls to the `waiting > 0 ? ... : 'Offline — your workout still works'` branch, and since `waiting` is `0`, the text shown is **"Offline — your workout still works"**.
4. **Offline, three paused writes** — `online = false`, `waiting = 3`. Banner renders; `online` falsy again selects the offline branch, and `waiting > 0` is true, so text is **"Offline — 3 changes will sync when you reconnect"** (plural applied via `plural(3)` → `'s'`).

Additional cases implicit in the logic but not asked for: if `online` flips back to `true` while `waiting` is still `> 0` (mid-reconnect sync), the banner stays visible with text "Syncing N changes…" until the paused mutations drain — this is intentional per the brief, not a bug. The failed-writes `Snackbar` is orthogonal to the `online`/`waiting` banner and can co-occur with any of the four states above; it opens whenever `failed > 0` and the user hasn't dismissed it, with no auto-hide, and stays dismissed (via `dismissed` state) until a fresh failed mutation appears — actually note: `dismissed` is never reset when `failed` returns to `0` and later increases again from a *different* cause; since `dismissed` is a simple boolean with no dependency on which mutation failed, once dismissed it stays dismissed for the lifetime of the component even if a new failure occurs later. This matches the brief's code exactly as given (no memoization of failure identity), so it's a faithful transcription, not a deviation — worth flagging to the human as a possible follow-up if a second, unrelated failure should reopen the snackbar.

## Fix: per-failure dismissal, nav clearance, and a genuinely sticky banner

The follow-up flagged above (and the header-scroll issue found separately) were confirmed as real defects and fixed.

**Finding 1 — latched dismissal (Critical).** `OfflineBanner.jsx`: replaced the boolean `dismissed` state with `dismissed: Set` of acknowledged mutation ids. `failed` (a count) became `failedIds` (the id list from `useMutationState`), and `unacknowledged = failedIds.filter(id => !dismissed.has(id))` drives both `Snackbar`'s `open` and the displayed count. Both `onClose` handlers now call `setDismissed(new Set(failedIds))`, acknowledging every currently-outstanding failure at once. Also replaced the flat `bottom: { xs: 72 }` pixel guess with `bottom: 'calc(56px + env(safe-area-inset-bottom) + 8px)'` so the snackbar clears the bottom nav's safe-area padding on any device.

**Finding 3 — banner scrolls out from under the sticky header (Important).** `TopHeader.jsx`: `AppBar` changed from `position="sticky"` to `position="static"`. `AppLayout.jsx`: `TopHeader` and `OfflineBanner` are now wrapped together in `<Box sx={{ position: 'sticky', top: 0, zIndex: 'appBar' }}>`, so the pair pins as one sticky block instead of the header alone.

### Lint / build

- `npm run lint` → exit 0, no output.
- `npm run build` → succeeded (vite client build + PWA service-worker build both completed, no errors).

### Reasoning checks

(a) **Second, different failure reopens the snackbar.** Dismissing sets `dismissed = new Set(failedIds)` at that moment. A later, distinct mutation failure adds a new id to `failedIds` that is not in `dismissed`, so `unacknowledged.length > 0` again and the snackbar reopens.

(b) **Two outstanding, dismiss acknowledges both; a third reopens it.** `setDismissed(new Set(failedIds))` snapshots *all* ids currently in `failedIds`, not just one, so dismissing with two outstanding failures marks both acknowledged in a single call. A third, new failure id is absent from that snapshot, so it is unacknowledged and reopens the snackbar.

(c) **No double-pinning.** `TopHeader`'s `AppBar` is now `position="static"` (no sticky behavior of its own); only the wrapping `Box` in `AppLayout.jsx` is `position: 'sticky'`. A single sticky ancestor pins the whole block once.

(d) **Silent when healthy.** Online with no paused writes: `!online || waiting > 0` is `false` → `banner` is `null`. No mutation has `status: 'error'`, so `failedIds` is empty, `unacknowledged.length` is `0`, and the `Snackbar`'s `open` is `false`. Nothing renders, unchanged from before.

### zIndex

`zIndex: 'appBar'` resolves via the MUI theme's `zIndex.appBar` (default `1100`), the same layer `AppBar` itself uses — it sits above ordinary page content (`Outlet` content has no explicit z-index, so it's in normal flow) but below `zIndex.drawer` (default `1200`), so a future MUI `Drawer`-based log-set sheet (`zIndex.drawer` = 1200, or `zIndex.modal` = 1300 if using `Modal`/`Dialog` variants) still stacks above this sticky header/banner block.

### Commit

- Hash: `983aab586f2d30694a5e541a9a65f43e9af2c861`
- Message: `fix: track per-failure dismissal and keep offline banner pinned under header`
- No `Co-Authored-By` trailer.
- Files staged/committed: `src/components/OfflineBanner.jsx`, `src/layouts/AppLayout.jsx`, `src/components/TopHeader.jsx` only.
