# Task 9: Rewards — Report

## Status: DONE

## Files created
- `src/data/rewards.js` — `fetchRewards(memberId)` and `awardReward({memberId, code, title, points})`, transcribed verbatim from the brief (Step 1). Read carries `.retry(navigator.onLine)`; the write does not.
- `src/features/rewards/RewardsScreen.jsx` — the Rewards screen: points card with progress bar, reward catalogue list, points-system table, and the earned-rewards list, transcribed verbatim from the brief (Step 4). Uses `LoadingState`/`ErrorState`/`EmptyState` from `src/components/ScreenState.jsx`, gates the error branch on `data === undefined`, one `<h1>` ("Rewards"), one `<h2>` ("Earned"), `<h3>` for card titles.
- `supabase/patches/003-award-points-server-side.sql` — trigger `set_reward_points()` that derives `rewards.points` server-side from the `code` prefix (`workout:` → 30, `checkin:` → 10, `referral:` → 60, else 0), overriding whatever the client sends. Written but **not run** — no database access available in this environment; running it is deferred to the human operator.

## Files modified
- `src/lib/mutationKeys.js` — added `awardReward: ['awardReward']`.
- `src/data/mutations.js` — imported `awardReward` from `./rewards.js` and registered its mutation defaults inside `registerMutationDefaults`, with `onSettled` invalidating `queryPrefixes.rewards`. The two existing registrations (`logSet`, `setSessionStatus`) were left untouched.
- `src/features/workout/LiveSessionScreen.jsx` — imported `pointsForWorkout` from `./summary.js` and `useAuth` from `../auth/useAuth.js`; added `const { user } = useAuth()` and `const award = useMutation({ mutationKey: mutationKeys.awardReward })` beside the existing `setStatus` mutation; extended `onStop` to call `award.mutate({ memberId: user.id, code: \`workout:${sessionId}\`, title: \`Completed ${session.name}\`, points: pointsForWorkout() })` before `live.clear()` and the navigation call.
- `src/routes/index.jsx` — replaced the `profile/rewards` placeholder entry with a lazy import of `RewardsScreen.jsx`, matching the pattern used by the other converted routes.

## Verification
- `npm run lint` — exit 0, no output (clean).
- `npm run build` — succeeded. Production build completed (`✓ built in 339ms`), including a new `RewardsScreen-*.js` chunk (8.62 kB / gzip 2.97 kB) and the PWA service worker build (`injectManifest`, 38 precache entries). The only warning emitted (`inlineDynamicImports option is deprecated`) comes from `vite-plugin-pwa`'s internal service-worker build step and is unrelated to this change — it is present on `main` before this task and not something these files touch.

## SQL patch
`supabase/patches/003-award-points-server-side.sql` was written exactly per the brief's Step 6 but **was not executed** — this task has no database access. Running it against the project's Supabase instance is left to the human.

## Commit
- Hash: `ec9637a2fe0cd06438bc5887fdf04c5c57712bd9`
- Message: `feat: add rewards with server-derived points`
- No `Co-Authored-By` trailer (verified via `git show -s --format='%H%n%B' HEAD`).
- Staged and committed exactly the seven files listed in the brief's Step 8 (`src/data/rewards.js`, `src/features/rewards/RewardsScreen.jsx`, `src/lib/mutationKeys.js`, `src/data/mutations.js`, `src/features/workout/LiveSessionScreen.jsx`, `src/routes/index.jsx`, `supabase/patches/003-award-points-server-side.sql`). The pre-existing unstaged modification to `README.md` (present before this task started, per the initial git status) was deliberately left out of the commit.

## Self-review
- **`LiveSessionScreen`'s new `award` mutation does not declare `onSettled`.** Confirmed by reading the final file: `const award = useMutation({ mutationKey: mutationKeys.awardReward })` takes no options object beyond the key. This respects the JSDoc warning on `registerMutationDefaults` — `onSettled` is registered once, centrally, in `src/data/mutations.js`, so it fires both online and on replay after a reload, and a call-site override could not silently shadow it.
- **The award fires before the navigation.** In the rewritten `onStop`, the call order is: `setStatus.mutate(...)` → `award.mutate(...)` → `live.clear()` → `navigate(...)`. `useMutation().mutate()` is fire-and-forget (does not block), so "before" here means "issued before" in source order, which is what the brief's code block specifies — the award request is queued (and, per React Query's offline-first mutation queue, persisted if offline) prior to the navigation call that leaves the screen.
- Idempotency: `awardReward` relies on `unique (member_id, code)` plus `upsert(..., { onConflict: 'member_id,code', ignoreDuplicates: true })`; a `null` return from a duplicate code is the intended, documented outcome, not an error path — matches the brief's resolved ambiguity.
- No new runtime dependencies were added; no CSS files or inline colour literals were introduced (the one colour reference, `color: 'primary.main'`, is a theme token, not a literal, matching the pattern already used elsewhere, e.g. `borderColor: isCurrent ? 'primary.main' : 'divider'` in `LiveSessionScreen.jsx`).
- `AppLayout` is not rendered inside `RewardsScreen.jsx` — the screen returns only its own `Stack` content, consistent with the other converted screens.
