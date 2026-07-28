# Task 7 Report — Reset-password screen

## Files

- Created: `src/features/auth/ResetPasswordScreen.jsx` — transcribed verbatim from the brief's
  code block (Step 1), including all comments. No deviations.
- Modified: `src/routes/index.jsx` — added `import ResetPasswordScreen from
  '../features/auth/ResetPasswordScreen.jsx'` next to the existing `LoginScreen` /
  `ForgotPasswordScreen` imports, and replaced the `/reset-password` placeholder entry
  (`...screen('Reset Password')`) with `element: <ResetPasswordScreen />`, exactly as specified
  in Step 2.

Verified `PublicLayout.jsx` (the wrapping layout for this route) renders `BrandLogo` above its
`<Outlet />` — `ResetPasswordScreen` renders no logo of its own, so no duplication.

Confirmed `react-router` (not `react-router-dom`) is the installed package (`package.json` line
25: `"react-router": "^8.3.0"`) and is the import source already used elsewhere in the codebase
(`src/routes/index.jsx`, `src/layouts/PublicLayout.jsx`), matching the brief's import line.

## Lint

`npm run lint` → exit 0, no output (clean).

## Commit

- Hash: `d166ac8f6abf3e1c90886d2ba9286cde15fa394d`
- Message: `feat: add reset password screen with explicit code exchange`
- Both files committed together in one commit (`git add
  src/features/auth/ResetPasswordScreen.jsx src/routes/index.jsx`). No trailer of any kind was
  added — checked `git log -1` output, message is the subject line only.
- `git status --short` before staging showed only these two files affected by this task; the
  pre-existing `README.md` modification (present before this task started) was left untouched
  and unstaged.

## Step 3 (browser verification)

Deferred to the human, per instructions. No dev server was started, and no browser or reset
email was available in this environment. The 7-row verification table in the brief (missing
code, garbage code, real link, mismatched passwords, short password, valid submit, replay of a
used link) still needs to be run manually against a live Supabase project.

## Self-review — tracing every path through the state machine

State variable: `phase ∈ {'exchanging', 'invalid', 'ready', 'saving', 'done'}`, initialized to
`code ? 'exchanging' : 'invalid'`.

1. **No `code` in the URL.** `phase` starts at `'invalid'`. The `useEffect` guard `if (!code)
   return` means the effect body never runs and `active`/cleanup are irrelevant. Render hits the
   `phase === 'invalid'` branch immediately: heading, fallback text (`error` is `null`, so the
   default message "This reset link is missing its code." shows), and a working "Request a new
   link" button (`<Link to="/forgot-password">`). No blank screen, no dead button.

2. **`code` present but garbage.** `phase` starts at `'exchanging'` → renders "Verifying your
   link…" (a `role="status"` text node, not blank). The effect calls
   `exchangeCodeForSession(code)`. Two sub-paths:
   - Resolves with `{ error: exchangeError }` truthy → `setError(message)`, `setPhase('invalid')`.
     Falls into the invalid branch, now showing the real Supabase error message instead of the
     fallback. Button still present and functional.
   - Rejects (network/thrown) → caught by `.catch`, same landing in `'invalid'` with a fallback
     message when `cause.message` is absent. Same outcome, no strand.
   Both sub-paths check `active` first, so a call that resolves after the component has unmounted
   (route changed away) is a no-op — matches the guard pattern in `AuthProvider.jsx`.

3. **`code` valid.** Same `'exchanging'` render, then the exchange resolves with no error →
   `setPhase('ready')`. Falls through past both early-return `if` blocks to the default return,
   which renders the password form. Submit button is enabled (`disabled={phase === 'saving'}`,
   and phase is `'ready'`).

4. **Passwords don't match.** `onSubmit` clears the previous error, compares strings, sets
   `error` and returns *before* touching `phase`. Phase stays `'ready'`, button stays enabled
   (never got set to `'saving'`), user can immediately correct and resubmit. No strand.

5. **Password shorter than 8 characters** (and it matches its own confirmation, since the
   mismatch check runs first). Same shape: `setError`, return, phase untouched at `'ready'`,
   button still enabled.

6. **Valid submit, `updateUser` fails.** `phase` is set to `'saving'` first (button disables,
   label flips to "Saving…"), the await resolves with an error → `setError(message)`,
   `setPhase('ready')`. Button re-enables on the next render. No permanent disabled state — the
   only way into `'saving'` is from a submit, and every submit path that enters it also has an
   exit (`'ready'` on failure, `'done'` + navigate on success). There is no `await` without a
   subsequent `setPhase` call, so `'saving'` can never be the terminal state.

7. **Valid submit, `updateUser` succeeds.** `setPhase('done')` then `navigate('/m', { replace:
   true })`. `'done'` has no dedicated `if` branch, so it would fall through to the default
   (form) render if it rendered at all — but `navigate` triggers a route change to `/m`, and
   `ResetPasswordScreen` unmounts before or immediately after that render is visible. This
   matches the brief's code exactly (I did not add a `'done'` branch — the brief doesn't have
   one either, and the fallthrough is harmless because navigation supersedes it). No blank
   screen: worst case is one frame of the already-rendered form, not emptiness.

Conclusion: every reachable `phase` value maps to a non-blank render, and every state that
disables the submit button (`'saving'`) has exactly one entry point and is always followed by a
state transition (`'ready'` on failure or `'done'`+navigate on success) — nothing can strand the
user on a permanently disabled button or an empty screen.

One pre-existing constraint outside this task's scope, noted for completeness: like the rest of
the auth screens, the effect's `active` flag only prevents state updates after unmount — it does
not cancel the in-flight `exchangeCodeForSession` network call itself. This mirrors the same
tradeoff already made in `AuthProvider.jsx` and is not something this task was asked to change.

## Fix: StrictMode double-exchange burns the reset code

**Finding.** `src/main.jsx` wraps the app in `<StrictMode>`. React 19 double-invokes effects in
dev (mount → cleanup → mount). The exchange effect called `supabase.auth.exchangeCodeForSession(code)`
fresh on every invocation: the first call consumed the single-use PKCE code and succeeded, but its
`active` flag was already `false` so the result was discarded; the second call then failed because
the code was already spent, landing the live component on `phase = 'invalid'`. A valid reset link
opened under `npm run dev` showed "Link not valid" even though the user had just been silently
signed in.

**Fix.** Added a ref (`exchange = useRef(null)`) that caches `{ code, promise }` for the
in-flight/settled exchange. Each effect invocation checks whether `exchange.current?.code` matches
the current `code`; if not, it starts a new `exchangeCodeForSession(code)` call and caches it. Every
invocation — first mount, StrictMode's synthetic remount, or a real remount on a route change —
then attaches its own `.then`/`.catch` handler to that same shared promise, gated by its own
`active` flag. The exchange network call happens exactly once per code; every mount still gets a
result. Rejected the alternative of a ref that skips the second call outright, since that leaves the
live (post-remount) component with no handler on the first call's promise, stranding the UI on
"Verifying your link…" forever.

Changed only `src/features/auth/ResetPasswordScreen.jsx`: added `useRef` to the React import,
declared the `exchange` ref, and replaced the exchange effect body to reuse
`exchange.current.promise` instead of calling `exchangeCodeForSession` unconditionally. No changes
to the state machine's phases, validation, copy, or `src/lib/supabase.js`.

**Lint.** `npm run lint` → exit 0, no output.

**Commit.** `7a0a102` — `fix(auth): share the reset-code exchange promise across StrictMode
remounts`. No `Co-Authored-By` trailer.

**Traced sequences (re-reading the edited file):**

- (a) StrictMode double mount, valid code: mount 1 creates `exchange.current = { code, promise }`
  and calls `exchangeCodeForSession` (network call #1, only call); cleanup sets that mount's
  `active = false`; mount 2 sees `exchange.current.code === code` so reuses the cached promise and
  attaches a fresh handler with its own `active = true`. When the promise resolves with no error,
  mount 2's handler runs `setPhase('ready')` (mount 1's handler is a no-op since its `active` is
  `false`). Exchanged exactly once. Final `phase = 'ready'`.
- (b) Single mount (production build), valid code: only one invocation, `exchange.current` is
  `null` so it creates and calls the promise once, resolves with no error, `active` is still `true`,
  `setPhase('ready')` runs. Final `phase = 'ready'`.
- (c) Genuinely invalid/already-used code: single relevant call resolves with `{ error }` (or
  rejects); handler runs `setError(...)` then `setPhase('invalid')` (StrictMode would still call
  `exchangeCodeForSession` only once thanks to the cache — the second mount just reuses the same
  rejected/error result). Final `phase = 'invalid'`.
- (d) No `code` query param: `phase` initializes to `'invalid'`; the effect's `if (!code) return`
  guard fires before touching `exchange.current`, so no call is made on any mount. Final
  `phase = 'invalid'`.
