# TrainHub — Design Specification

**Date:** 2026-07-27
**Team:** Davide Leone (723335), Andrea Bariselli (737436)
**Course:** Mobile Application Development — Univ. of Brescia
**Deadline:** 31 Aug 2026 (exam 1 Sep 2026)

---

## 1. Problem and Goal

TrainHub is a Progressive Web App that connects gym members with the fitness professionals working in their facility. It replaces the fragmented set of tools both sides use today — notes apps for workout logs, WhatsApp for coaching, spreadsheets for client management, plastic badges for entry — with one installable app.

Two deliverables are graded:

1. **The PWA**, judged on design quality and on correct application of PWA principles (installability, offline operation, custom responsive MUI theme).
2. **The technical report** in LaTeX, judged on the design process it documents.

Both must be in English.

## 2. Starting Point

`src/` is the stock Vite React template — no application code exists. What does exist:

- `doc/assets/` — the complete Figma wireframe set, roughly 25 screens across both roles, plus component-level wireframes and `variables.tokens.json` (W3C design tokens).
- `Relazione/` — LaTeX report with chapters 1–3 written: Introduction, Competitors Analysis (4 direct competitors with screenshots, plus the dimension and feature comparison tables the brief requires), User Research (questionnaire results, affinity diagram, 4 personas, 4 scenarios). Chapters 4, 5 and 6 are empty files.
- `vite.config.js` — `vite-plugin-pwa` in `generateSW` mode with an inline manifest. Icons are still missing.

## 3. Decisions

### 3.1 Two roles, not three

The report's user research produced four personas, one of which is Matteo Costa, a **nutritionist**, who gets his own scenario. The wireframes, however, only describe two roles — and `doc/assets/pt/09 - Nutrition Plan.png` already shows the trainer editing a nutrition plan.

Building a third role means a third routing tree, a third permission set, and six to eight extra screens, for a section that is not the project's focus.

**Decision:** one `professional` role carrying a `specialty` field (`personal_trainer`, `nutritionist`, or both). Same UI, same navigation; specialty gates which client-detail actions appear. Chapter 4 documents this as a deliberate *role unification*, which keeps Scenario 4 valid without inventing a parallel app.

### 3.2 Supabase with a local cache

The offline requirement is non-negotiable, and the app's most important moment — a member logging sets mid-workout — happens exactly where signal is worst. So the network cannot be on the critical path for writes.

**Decision:** Supabase for auth, Postgres and Realtime; **TanStack Query with `persistQueryClient`** over an IndexedDB persister for the client side.

This choice does most of the offline work for free. Query results persist to IndexedDB, so reads survive a cold start with no connection. Mutations issued while offline are *paused* rather than failed, persisted alongside the cache, and replayed by `resumePausedMutations()` when connectivity returns. That is the write outbox, already written and already tested by someone else. A hand-rolled sync queue would be more code and more bugs for the same behaviour.

### 3.3 `injectManifest`, not `generateSW`

Push notifications require `push` and `notificationclick` handlers in the service worker. A generated service worker has nowhere clean to put them.

**Decision:** switch `vite-plugin-pwa` to `strategies: 'injectManifest'` with a hand-written `src/sw.js`. Runtime caching stays declarative through Workbox: `NetworkFirst` for Supabase REST calls, `CacheFirst` for static assets and exercise imagery.

### 3.4 No global state library

Auth session state lives in a single `AuthProvider` wrapping Supabase's `onAuthStateChange`. Everything else is server state, which TanStack Query already owns. Redux or Zustand would add a store with nothing distinctive to keep in it.

### 3.5 ngrok with a static domain

Deployment is ngrok, per the course material. But a Web Push subscription is bound to its origin, and a free ngrok URL changes on every restart — which would silently invalidate every push subscription and break the Supabase Auth redirect allowlist each time the tunnel comes up.

**Decision:** claim ngrok's free static domain (one per account) and use it consistently:

```bash
ngrok http 4173 --url=wrinkly-mankind-doodle.ngrok-free.dev
```

That exact origin is registered in Supabase Auth → URL Configuration.

### 3.6 Scope: workout deep, everything else complete but simple

The navigation map is built out in full — no dead routes, nothing the report claims that the app cannot show. Within that, the workout section gets the real engineering: live session tracking, set logging, rest timer, offline sync, progress history. Nutrition, chat, calendar and rewards are complete and functional, but their logic stays straightforward.

## 4. Navigation Map

Departures from `doc/trainhub.md`, which was a first sketch rather than a specification:

- Role unification, as above.
- **Profile moves out of the bottom navigation** to the top-bar avatar on both sides. This matches every wireframe and frees a fifth tab that would otherwise crowd the bar.
- **Booking is a bottom sheet, not a route** — `gym_member/Modal/BookingSheet.png` already draws it that way, and it keeps the user in context.
- **`/p/scan` is new**, the counterpart to the member's access badge.

```
PUBLIC
  /login                          pt/01
  /forgot-password                pt/02
  /reset-password                 pt/03

MEMBER — bottom nav: Home · Workout · Nutrition · Trainer
  /m                              gym_member/01 - Home Page
  /m/workout                      gym_member/02 - Workout
      /session/:id                session detail, exercise list
      /session/:id/live           gym_member/06, 06A, 06B
      /session/:id/summary        post-session summary
      /exercise/:id               gym_member/07 - Exercise Details
      /builder                    create / edit own workout
  /m/nutrition                    gym_member/03 - Nutrition
      /meal/:id                   gym_member/03B
  /m/trainer                      gym_member/04 - PT
      /browse                     gym_member/04B  choose professional
      /appointments               gym_member/04C
      /chat                       thread with assigned professional
      [BookingSheet modal]        book training session / consultation
  /m/profile                      gym_member/05 - Profile   (top-bar avatar)
      /badge                      gym_member/05A  QR access badge
      /subscription               gym_member/05B
      /rewards                    gym_member/05C
      /settings                   change password, logout

PROFESSIONAL — bottom nav: Home · Clients · Calendar · Chat
  /p                              pt/04 - Home Page  (today's agenda)
  /p/clients                      pt/05 - Clients
      /:id                        pt/08 - Client Detail
      /:id/workout                assign / edit workout plan
      /:id/nutrition              pt/09 - Nutrition Plan editor
      /:id/progress               pt/10 - Progress Tracking
  /p/calendar                     pt/06, 06B
      /:id                        appointment detail / edit
      /availability               availability settings
  /p/chat                         pt/07 - Chat  (thread list)
      /:id                        thread
  /p/scan                         QR scanner — member check-in
  /p/profile                      pt/11 - Profile   (top-bar avatar)
      /settings                   pt/12 - Change Password, logout
```

## 5. Architecture

```
src/
  main.jsx                  registerSW + provider composition
  sw.js                     hand-written service worker (injectManifest)
  theme/                    createTheme + responsiveFontSizes, palette from design tokens
  routes/                   route tree, lazy per section
  layouts/                  PublicLayout, MemberLayout, ProfessionalLayout
  components/               design-system primitives mirroring doc/assets/components/**
  features/
    auth/ workout/ nutrition/ appointments/ chat/ clients/ rewards/ checkin/
  data/                     one repository module per domain, plain async functions
  lib/supabase.js           client singleton
```

Each unit has one job and a narrow interface. `data/` modules know about Supabase and nothing about React. `features/` modules know about React and call `data/`. `components/` knows about neither — it renders props. Screens stay small enough to read in one sitting; when one grows past that, it is doing too much.

**Routing.** React Router v7, declarative, with `lazy()` per section so each tab ships as its own chunk.

**Theme.** `createTheme` + `responsiveFontSizes` is an explicitly graded requirement — the course material notes that "MUI is mobile friendly but not natively responsive". The palette is generated from `doc/assets/variables.tokens.json` so the app and the Figma file cannot drift. Component overrides carry the rounded-card look the wireframes use throughout.

**Design work** runs through Claude Design (MCP). Every file Claude writes is passed through `/humanizer`.

### 5.1 Data model

`profiles` · `workout_plans` · `workout_sessions` · `exercises` · `session_exercises` · `set_logs` · `nutrition_plans` · `meals` · `appointments` · `availability` · `threads` · `messages` · `rewards` · `checkins` · `push_subscriptions`

Row Level Security on every table: a member reads only their own rows; a professional reads rows belonging to clients assigned to them. A seed script creates the two demo accounts the wireframes depict — Daniel Aresta (member) and Coach Andrea (professional) — so the app is never empty during a demo.

### 5.2 Push notifications

A database trigger on inserts into `messages` and `appointments` calls a Supabase Edge Function, which sends the notification through `web-push` using VAPID keys. `src/sw.js` handles delivery and click-through routing.

### 5.3 QR access badge

The member's badge screen renders a QR encoding a signed, short-lived token. The professional's scanner reads it with the native `BarcodeDetector` API and writes a `checkins` row.

`BarcodeDetector` is Chromium-only. If the exam demo runs on iOS or Safari, a `jsQR` fallback (~20 KB) is added during phase 4.

### 5.4 Error handling

Query and mutation errors surface as MUI snackbars, never as blank screens. Offline is a first-class state, not an error: the UI shows a persistent "offline — changes will sync" indicator, and paused mutations render optimistically so the user is never blocked. Auth errors redirect to `/login` with the attempted route preserved.

## 6. Testing

No test runner is configured and none is being added — the graded artefact is a demo, and the verification that matters is manual and device-based:

- `npm run build && npm run preview` behind ngrok, installed on a real Android phone, confirmed running standalone.
- Lighthouse PWA audit all green; the screenshots go into chapter 5.
- **Offline round trip:** log a complete workout session with DevTools offline, return online, confirm every set reaches Postgres.
- **Push round trip:** send a chat message from the professional account, confirm the member's device shows a notification with the app closed.
- **QR round trip:** member opens `/m/profile/badge`, professional scans it from `/p/scan`, confirm a `checkins` row appears.
- Both demo accounts walk their entire navigation tree with no dead routes.
- `npm run lint` clean; `pdflatex main.tex` compiles with no missing-figure warnings.

Non-trivial pure logic — session timer arithmetic, volume and progress aggregation, the token signing and expiry check — gets a small assert-based self-check rather than a test framework.

## 7. Schedule

| Phase | Dates | Deliverable |
|---|---|---|
| 0 — Foundations | 27–29 Jul | ngrok static domain; Supabase project, schema, RLS, seed; MUI theme from tokens; PWA manifest icons; routing shell, both layouts, bottom nav; `injectManifest` switchover |
| 1 — Auth + member core | 30 Jul – 5 Aug | Login / forgot / reset; member shell; Home; Workout Plan; session detail; exercise detail |
| 2 — Workout deep | 6–12 Aug | Live session, set logging, summary, offline sync verified, workout builder, rewards |
| 3 — Professional side | 13–19 Aug | Agenda home, clients, client detail, workout assignment, nutrition editor, progress, calendar, availability |
| 4 — Connective features | 20–24 Aug | Realtime chat, push VAPID end to end, QR badge and scanner, member nutrition, profile and subscription |
| 5 — Hardening + report | 25–28 Aug | Lighthouse and offline audits, install test on device; chapters 4, 5, 6; slide deck |
| 6 — Buffer | 29–31 Aug | Andrea's refinement pass, final compile, handover copy |

Running ahead pulls phase 5 work forward. Running behind, the compressible items are the workout builder, rewards, and the full-month calendar view — in that order.

## 8. Report Work

The existing six-chapter structure matches `Vroom.md`, the strongest of the provided examples, and needs extension rather than restructuring.

- **Chapter 4 — Application Design:** navigation map figure, the role-unification decision, paper prototype photographs, digital prototype walkthrough, design system (tokens, typography, components).
- **Chapter 5 — Implementation & Architecture:** PWA anatomy (manifest, service worker, caching strategies, install flow), React and MUI architecture, Supabase data layer and RLS, offline strategy, push notifications, QR check-in, Lighthouse results.
- **Chapter 6 — Conclusions & Future Developments.**
- Add `\listoffigures` and `\listoftables` to `main.tex`.

## 9. Inputs Needed From the Team

1. ngrok free static domain claimed; Supabase project created, URL and anon key shared.
2. VAPID keys generated (`npx web-push generate-vapid-keys`).
3. Paper prototype sketches photographed into `Relazione/4-ApplicationDesign/img/PaperPrototype/`.
4. Git repository initialised when wanted. **All commits and pushes stay Davide's** — Claude never commits.
