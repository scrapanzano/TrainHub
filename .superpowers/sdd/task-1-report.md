# Task 1 Report: Query Keys and Pure Formatters

## Files Created

- `src/lib/format.js` — Date/time rendering functions (`formatTimeRange`, `formatDate`, `todayISO`)
- `src/lib/queryKeys.js` — Query key factory functions (`queryKeys.activePlan`, `queryKeys.session`, `queryKeys.sessionExercise`, `queryKeys.appointmentsOnDay`)
- `src/lib/format.selfcheck.js` — Self-check test file (run with `node src/lib/format.selfcheck.js`)

## Failing Self-Check Output

Before creating `format.js`, running the self-check produced the expected error:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\Universita\TrainHub\src\lib\format.js' imported from D:\Universita\TrainHub\src\lib\format.selfcheck.js
    at finalizeResolution (node:internal/modules/esm/resolve:271:11)
    ...
```

This confirmed the test was written correctly and was ready to fail.

## Passing Self-Check Output

After implementing `format.js`, running the self-check again:

```
format: OK
```

All assertions passed:
- `formatTimeRange('2026-04-21T08:00:00Z', '2026-04-21T09:00:00Z')` returns properly formatted time range in local zone
- `formatDate('2026-04-21')` returns `'21/04/2026'`
- `formatDate(null)` and `formatDate(undefined)` return empty string
- `todayISO()` returns today's date as `'YYYY-MM-DD'` in local calendar

## Lint Result

```
> trainhub@0.0.0 lint
> eslint .
```

ESLint exited with code 0 and no output — all files pass linting.

## Commit

- **Hash:** `1fe67bb`
- **Message:** `feat: add query keys and date formatting helpers`
- **Files:** 3 created, 71 insertions

## Self-Review

**What I checked:**

1. ✓ Both `format.js` and `queryKeys.js` have zero imports (required for bare-Node self-check compatibility)
2. ✓ All code transcribed faithfully from the brief, including every comment
3. ✓ Self-check follows the ordered approach: wrote it first, ran it to fail, wrote implementation, ran it to pass
4. ✓ `formatDate()` parses date strings by hand to avoid UTC midnight pitfall that would shift dates west of Greenwich
5. ✓ `formatTimeRange()` uses locale-aware time formatting with 'en-GB' and computed expectations to handle any timezone
6. ✓ `todayISO()` constructs local calendar date (not UTC) with proper zero-padding
7. ✓ `queryKeys` object exports four factory functions with correct signatures
8. ✓ All ESLint rules pass (exit 0)
9. ✓ Conventional Commits format, no Co-Authored-By trailer

**No changes after verification.** Code written exactly as specified in the brief.

---

**Verification Status:** COMPLETE
