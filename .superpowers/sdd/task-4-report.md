# Task 4 report — the unread badge

## What I implemented

Exactly the two steps in the brief, verbatim:

1. **`src/layouts/AppLayout.jsx`**
   - Added imports: `useQuery` from `@tanstack/react-query`, `fetchUnreadCount` from `../data/chat.js`, `queryKeys` from `../lib/queryKeys.js`.
   - Added the `unread` query directly below the two existing `useAuth`/`useLocation` hooks, **above** the component's early returns (`if (loading) return ...`, `if (!user) return ...`, `if (!profile) return ...`), so the hook is called unconditionally on every render.
   - `queryKey: queryKeys.unreadCount(user?.id)`, `queryFn: () => fetchUnreadCount(user.id)`, `enabled: Boolean(user?.id)`.
   - Passed `notificationCount={unread.data ?? 0}` to `<TopHeader>` in the returned shell.

2. **`src/components/TopHeader.jsx`**
   - Replaced the bell's `aria-label={`${notificationCount} notifications`}` with the brief's exact conditional: `'No unread messages'` at zero, `'N unread message'`/`'N unread messages'` otherwise (singular only at exactly 1).

No new files, no new dependencies, no data-layer changes — `fetchUnreadCount` and `queryKeys.unreadCount` already existed from Tasks 1–3 and were consumed as-is. Did not add any invalidation (both chat writes already invalidate `queryPrefixes.chat` per the brief).

## What I verified

`npm run lint` — exit 0, no output beyond the command echo:
```
> trainhub@0.0.0 lint
> eslint .
```

`npm run build` — succeeded, produced `dist/` including the service worker:
```
> trainhub@0.0.0 build
> vite build
...
✓ 1161 modules transformed.
...
✓ built in 527ms

PWA v1.3.0
Building src/sw.js service worker ("es" format)...
...
✓ built in 54ms

PWA v1.3.0
mode      injectManifest
format:   es
precache  67 entries (1111.22 KiB)
files generated
  dist/sw.js
```
(The `inlineDynamicImports option is deprecated` warning is emitted by the PWA plugin's SW build step and is pre-existing/unrelated to this change — not touched by this task.)

**Not verified (needs a human with database credentials):** the browser check described in the brief — Coach Andrea seeing the bell go 1 → 0 across a chat interaction, and Daniel seeing 0 → nonzero when Andrea sends. I did not run the app against a live Supabase instance.

## Files changed

- `C:\Users\Davide\Documents\Universita\TrainHub\src\components\TopHeader.jsx`
- `C:\Users\Davide\Documents\Universita\TrainHub\src\layouts\AppLayout.jsx`

## Self-review findings

- Confirmed the `useQuery` call sits above all three early returns — rules-of-hooks is satisfied, and lint (which includes `react-hooks`) passed clean, so this wasn't just eyeballed.
- Confirmed `queryKeys.unreadCount` (`['chat', 'unread', userId]`) and `fetchUnreadCount` (already carries `.retry(navigator.onLine)`) match what the brief assumed — read the actual source in `src/lib/queryKeys.js` and `src/data/chat.js` rather than trusting the brief blindly.
- The badge falls back to `0` while the query is loading or if it errors (`unread.data ?? 0`). This is not a "gate error state on `data === undefined`" violation — that rule governs screens that show an error state; a header badge silently showing 0 during a transient fetch failure is the correct degrade (no error UI is shown either way), and is exactly what the brief specified.
- No unrequested abstractions added; wired the existing prop exactly as specified, nothing extra.
- Staged and committed only the two files the brief names. Left `.superpowers/sdd/.gitignore`, `.superpowers/sdd/progress.md`, and `.superpowers/sdd/task-3-report.md` (pre-existing working-tree changes from earlier tasks/scratch bookkeeping) untouched and unstaged.
- Found this report file pre-populated with an unrelated stale "Task 4: Shared Screen States" report from a different phase's task numbering; overwrote it with this task's actual report.

## Issues or concerns

None. Task is complete as specified.
