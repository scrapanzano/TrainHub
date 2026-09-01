# TrainHub — Report Plan

Working document to review chapters 1–3 against what the course actually
requires, and to give chapters 4–6 a structure before writing them. Not part
of the LaTeX build — delete or move once the report is done.

Course requirements, verbatim from `doc/context.md` §"Technical Report":

1. Competitor analysis — direct/indirect, screenshots, dimension table,
   feature table, competitive positioning
2. Interviews and Surveys — qualitative + quantitative, grouped (e.g. an
   Affinity Diagram)
3. Personas — at least two
4. Scenarios — at least one per persona
5. Navigation map — sticky notes first, then Figma
6. Paper prototype (wireframes) — photos included in the report
7. Digital prototype (Figma) — the interactive prototype

---

## Chapters 1–3 — review checklist

`Relazione/1-Introduction/` through `3-UserResearch/`, 387 lines across 8
`.tex` files, all written. Nothing here is a stub. Check against:

**Chapter 1 — Introduction** (not one of the seven mandatory elements, but
standard framing): preliminary features, the two target-user categories
(member / professional). Read it for whether it still matches what actually
shipped — it was written before Phase 5A's workout redesign, and Phase 5A
changed what "workout tracking" means (weekly-repeating runs, not a
one-shot session). Worth a sentence update, not a rewrite.

**Chapter 2 — Competitor Analysis** — covers requirement 1 in full:
`DirectCompetitors.tex` has four apps (Virgin Active, EvolutionFit,
Technogym, Virtuagym), each with screenshots, plus a dimensions table and a
features table; `IndirectCompetitors.tex` covers the fragmented-tool
category; the chapter's own conclusion states where TrainHub is
competitive. Check: are the four competitors still the most relevant ones,
and do the feature-table rows (diet management, chat, QR access, admin
dashboard) match what TrainHub itself now has — the table is also an
implicit claim about what the finished app does.

**Chapter 3 — User Research** — covers requirements 2, 3, 4 in full:
`QuestionnaireResults.tex` (76 responses), `AffinityDiagram.tex` (the
8-step process, three macro-themes), `Personas.tex` (four personas —
exceeds the minimum of two), `Scenarios.tex` (one scenario per persona,
matching the minimum of one-per-persona). Check: Marco's scenario
("confirms the pre-filled weights... marks the set as complete") describes
the pre-5A single-completion flow. Whether it needs a line acknowledging
the workout now repeats weekly is a judgment call — the scenario is about
the *interaction*, not the data model, so it may not need touching at all.

Nothing in 1–3 is missing content. The review is about currency (does it
still describe the app that exists) rather than completeness.

---

## Requirements NOT yet in the report

Requirements 5, 6, 7 — navigation map, paper prototype, digital prototype —
have no home yet. They belong in Chapter 4, which is currently an empty
file. This is the actual gap, not anything in 1–3.

---

## Chapter 4 — Application Design (currently empty)

Proposed structure, in build order — each step's output is what the next
step was validated against:

1. **From research to features** — one paragraph bridging Chapter 3's
   affinity-diagram themes to a revised feature list. Short; this is a
   transition, not new content.
2. **Navigation map** — sticky-note version, then the Figma version. Source:
   `doc/trainhub.md` (superseded, but it *is* the sticky-note-stage
   artifact — worth citing as the first draft) and section 4 of
   `docs/superpowers/specs/2026-07-27-trainhub-design.md`, which is the
   routing spec that superseded it. The role-unification decision (one
   codebase, two route trees under `/m/...` and `/p/...`) belongs here — it's
   a navigation decision, not an implementation detail.
3. **Paper prototype (wireframes)** — the `doc/assets/pt/*.png` and
   `doc/assets/gym_member/*.png` screens, plus `doc/assets/components/**`
   for the shared component sheet (buttons, cards, nav items — the pieces
   reused across screens). Photos of the actual paper sketches if you have
   them; the PNGs are the digitised version.
4. **Digital prototype (Figma)** — link or export, plus
   `doc/assets/variables.tokens.json` as the design-token source, since
   that's the artifact that ties the Figma file to the shipped MUI theme
   (`src/theme/tokens.js` imports it directly, so the two cannot drift).
5. **Deviations from the wireframes** — each phase plan under
   `docs/superpowers/plans/*.md` has a "Deviations from the wireframes"
   section recording every deliberate departure and why. Worth a short
   subsection collecting the notable ones rather than re-deriving them —
   e.g. the workout redesign replacing the wireframed single-session flow
   (`06`, `06A`, `06B`, `07 - Exercise Details`) with the run-based screens
   built in Phase 5A, decided in
   `docs/superpowers/specs/2026-08-05-trainhub-workout-redesign-design.md`.

---

## Chapter 5 — Implementation and Architecture (currently empty)

This is the largest chapter and the one with the most raw material already
sitting in `.superpowers/sdd/progress.md`. Proposed structure:

1. **Stack** — React 19 + Vite 8, plain JS/JSX (no TypeScript), MUI v9 +
   Emotion, React Router 8, TanStack Query v5, Supabase (Postgres, RLS,
   Realtime). One paragraph, this is `CLAUDE.md`'s own summary.
2. **Architecture** — the four-layer split (`data/` → `features/` →
   `components/`, `lib/` shared beneath) and *why* the dependency direction
   is enforced one way: it's what makes a pure module like `week.js`
   reusable from both a data-layer function and a React screen without
   `data/` importing React.
3. **PWA requirements, one subsection each** (these map directly to
   `doc/context.md`'s graded checklist, so structuring it this way doubles
   as proof of coverage):
   - Manifest & installability — `vite-plugin-pwa`, inline manifest in
     `vite.config.js`, the brand colours kept in sync with the Figma tokens.
   - Service worker & offline — hand-written `src/sw.js` in `injectManifest`
     mode, why (`generateSW` doesn't give enough control over the
     TanStack Query cache interplay — check the design spec's offline
     section for the actual stated reason). The precache-manifest numbers
     from the Phase 1 review are real, measured evidence, not a claim:
     largest chunk 819.35 kB → 438.56 kB after code-splitting the Supabase
     vendor bundle, precache 14 entries/938.53 KiB → 28 entries/944.48 KiB.
   - Offline-first data — TanStack Query `networkMode: 'offlineFirst'`,
     `persistQueryClient` over IndexedDB, paused mutations replayed by
     `resumePausedMutations`. This is where the "gate on `data === undefined`,
     never `isError`" rule earns a paragraph: it's the one line that makes a
     failed background refetch invisible to a user looking at good cached
     data.
   - Responsive theme — `createTheme` + `responsiveFontSizes`, the
     `palette.task.*` custom group, no CSS files/no colour literals rule.
   - Push notifications — VAPID keys, `app_config`, the Edge Function,
     Phase 4B.
4. **Data integrity under offline replay** — this is TrainHub's most
   distinctive engineering content and deserves real space:
   - client-generated ids for idempotent replay (`set_logs`, `messages`,
     `appointments`, `availability`)
   - `scope` on a mutation default when order matters, and the concrete
     failure it prevents (`resumePausedMutations` replays in parallel
     otherwise)
   - the `CreatePlanFlow` near-miss: chaining two writes via `onSuccess`
     would silently create an empty plan offline, because per-call
     `mutate(vars, {onSuccess})` callbacks are not persisted — fixed by
     firing both writes under one scope instead. Good concrete example of a
     defect caught in review rather than in production.
5. **Security: RLS as the actual boundary** — the two-gate model (table
   `GRANT` checked before any policy; a policy whose `using` clause never
   reaches `auth.uid()` is public to anyone holding the publishable key,
   which ships in the JS bundle) and why `verify.sql` cannot catch that
   second failure mode — it runs as the dashboard's privileged role and
   bypasses RLS entirely. `supabase/probe-rls.mjs` exists specifically to
   answer the question `verify.sql` structurally cannot. Phase 0 shipped a
   publicly-readable policy that only the anonymous probe caught — a real
   incident, worth naming as one.
6. **A platform-constraints case study: the rest-timer audio.** This is
   already written up as a self-contained story in
   `.superpowers/sdd/progress.md` (search "rest timer silent") — three
   distinct causes found in sequence on a real iPhone, not from
   documentation:
   1. `AudioContext` built inside a timer callback rather than inside the
      user gesture that must create it.
   2. Safari on iOS routes Web Audio through the *ambient* category, which
      the hardware ring/silent switch mutes — fixed by switching to an
      `<audio>` element, which uses the *media* playback path instead.
   3. Once audible, the unlock itself briefly seized the phone's audio
      session, cutting off the member's own music — fixed by unlocking
      **muted** (the only lever available, since `volume` is read-only on
      iOS) and setting `navigator.audioSession.type = 'transient'` before
      playing, which ducks other audio instead of stopping it — the same
      category the system timer uses.
   The comparison table already drafted in the ledger is reusable as-is:
   `<audio>` unlocked by a gesture works and ignores the silent switch;
   `navigator.audioSession` is WebKit-only; Web Audio is muted by the
   switch; the Vibration API is absent in Safari on iOS; there is no
   scheduled-local-notification API on the web at all; `setInterval` in the
   background is throttled everywhere and frozen on iOS. This is exactly
   the kind of measured-not-assumed material the report should lead with —
   it's a defensible, first-hand claim about PWA limits.
7. **Verification approach** — no test runner; instead ten `assert`-based
   `*.selfcheck.js` files for pure logic (list in `CLAUDE.md`), `npm run
   lint` + `npm run build` both required (lint alone missed a real defect —
   an MUI icon glyph that lint doesn't resolve but Vite's bundler does),
   `probe-rls.mjs` for the security boundary, and the spec→plan→per-task
   review→whole-branch review process — worth naming that the whole-branch
   review caught a Critical in every phase so far, always something no
   single task owned. That's a genuine finding about process, not just
   code.
8. **Lighthouse** — re-run needed (see Open Items below); screenshots go
   here (Lighthouse panel, DevTools → Application → Manifest and Service
   Workers).

---

## Chapter 6 — Conclusions and Future Developments (currently empty)

1. **What was built** — the phase table: 0–3 (design system, PWA shell,
   auth, member workout half v1, full professional side), 4A (member
   nutrition/trainer/profile/booking/chat), 4B (QR badge, scanner, push,
   PR #3), 5A (member workout half rebuilt around weekly-repeating runs,
   PR #4, merge `53f732d`). All merged to `main`.
2. **Evaluation against the original goals** — the fragmentation problem
   named in Chapter 1/2 (multiple apps, spreadsheets, WhatsApp) mapped
   against what actually shipped: workout tracking, diet plans, booking,
   chat, QR access, all in one PWA, offline-capable. Honest framing: this
   is where the report should say what's genuinely done versus deferred,
   not just what was attempted.
3. **Known limitations, stated plainly rather than hidden**:
   - the professional's side of the workout rebuild doesn't exist yet —
     `workout_runs.note`, written by the member, is read by nobody. This is
     the acknowledged, on-the-record debt of Phase 5A, not an oversight
     discovered late.
   - the notification bell has never been clickable; the badge doesn't
     refresh within its poll window. Deferred pending its own design pass.
   - deliberately out of scope, each with a reason on file already: a
     history screen for archived plans, a member-side progress screen,
     real exercise imagery/video, dropping the now-unused
     `workout_sessions.status` / `workout_plans.expires_on` columns,
     reordering sessions or exercises.
4. **Lessons learned** — this is where the RLS two-gate lesson, the
   offline-replay-ordering lesson, and the iOS-audio-category lesson from
   Chapter 5 can be revisited at a higher level: process takeaways rather
   than the technical detail already given. E.g. "a whole-branch review
   caught something no per-task review could, in every phase" is a
   process conclusion, not an implementation detail.
5. **Future developments** — in the order they're actually queued:
   professional-side workout rebuild, notification bell redesign, further
   hardening (Lighthouse re-run, cross-device pass). State it as a
   roadmap, not a wishlist — it's the literal next-work queue.

---

## Open items before chapters 4–6 can be finished, not just structured

- **Lighthouse has not been re-run since the Phase 5A redesign.** The
  numbers in Chapter 5 need a fresh capture, run against `npm run build &&
  npm run preview` (the service worker does not exist under `npm run dev`,
  so a dev-server Lighthouse run would misreport offline/installability).
- **Section 7 of `docs/superpowers/2026-07-30-device-verification.md`** —
  the workout-flow verification checklist — is stale, still describing the
  pre-5A single-session flow. Rewriting it against the current flow is
  useful independently of the report, but its rewritten form is also good
  primary-source material for Chapter 5 §7.
- Figma navigation-map and digital-prototype exports/links for Chapter 4 —
  not something the codebase has a pointer to; needs to come from wherever
  the Figma file lives.
