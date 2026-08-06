# TrainHub Phase 5A — The Workout Half, Rebuilt

**Status:** design approved 2026-08-05, ready for an implementation plan.
**Branch:** to be cut from `main` at the Phase 4B merge (`fac023d`).
**Source:** `doc/live_train_session.md`, Davide's own brainstorm, refined
question by question in the session of 2026-08-05.

## Goal

Make the member's workout half cyclical, honest about effort, and self-service.

Everything under `/m/workout` was built from wireframes `02 - Workout`,
`06 - Session`, `06A/06B - Session Started/Paused` and `07 - Exercise Details`.
Those wireframes describe a workout that happens **once**. A real training
protocol repeats every week for three or four months, which is the assumption
the current data model does not hold, and every defect below follows from it.

This phase is a rebuild of that half, not a set of patches. It also reaches
into the professional's plan editor, because the two sides create the same
object and only one of them should own the code that does it.

## What is broken today

Three of these Davide confirmed by hand on 2026-08-03. Five came out of reading
the code while designing this phase; they are latent because nothing in the app
repeats yet.

| # | Defect | Where |
|---|---|---|
| 1 | The session clock does not reset between two live sessions | `useLiveSession.js:4` — `localStorage` keyed by session, and React Router reuses the component across two matches of the same route |
| 2 | A session completes and awards 30 points with zero exercises done | `LiveSessionScreen.jsx:60-72`; `pointsForWorkout()` is a constant |
| 3 | The bell badge does not refresh within its 60s poll | `AppLayout.jsx:25-37` — **out of scope here**, deferred with the bell's missing tap target |
| 4 | No weekly dimension at all: a finished plan stays finished forever | `workout_sessions.status` is a single enum column |
| 5 | `loggedCount` is a lifetime count — week 2 would read `6/3` and nothing would ever complete again | `workouts.js:17`, the embedded `set_logs(count)` aggregate |
| 6 | The second completion of a session awards nothing, silently | `rewards` has `unique (member_id, code)`, `awardReward` uses `ignoreDuplicates: true` (`rewards.js:28`), and the code is `workout:${sessionId}` |
| 7 | A member cannot create their own plan | `WorkoutBuilderScreen.jsx:37` — it only adds a session to a plan that must already exist |
| 8 | An empty plan hides the coach's plan | `fetchActivePlan` takes the newest by `created_at` (`workouts.js:41`). True on the professional's side today: create a plan, stop before the first session, and the member's screen reads "This plan has no sessions" |
| 9 | End-of-session notes for the coach do not exist | `doc/live_train_session.md:63` believes they do. `SessionSummaryScreen.jsx` has no field and the schema has no column |

Defects 1, 2, 5, 6, 7, 8 and 9 are all closed by this phase. Defect 3 is
deliberately left alone: it belongs with the notification bell work, which is
queued behind this and needs its own design pass.

## What already exists

Do not rebuild these.

| Path | What it gives |
|---|---|
| `src/features/workout/timer.js` | `{ startedAt, pausedAt, pausedTotal }` and elapsed-time arithmetic over timestamps, clamped against a backwards clock correction. Tested. **Not to be touched.** |
| `src/features/workout/SessionForm.jsx` | Builds one session — name plus an ordered list of prescribed exercises. Already shared by both roles; its docstring says so. |
| `src/features/workout/status.js` | `setProgress`, `planProgress`, `sessionStatusOf` |
| `src/features/workout/summary.js` | `summariseSession`, `rewardProgress`, the `POINTS` table |
| `src/lib/format.js` | `todayISO()`, `localDayISO()` — the only correct way to reach a calendar day here |
| `src/data/mutations.js` | Where every replayable write is registered, and the only place the persister can find a rehydrated mutation's function |
| `src/data/workouts.js` | `createPlan`, `createSession`, `deleteSession`, `logSet`, `fetchExerciseCatalogue` |
| `src/features/clients/ClientWorkoutScreen.jsx:20-86` | `NewPlanForm` — the plan-metadata form, currently walled inside the professional's screen |

## Decisions taken before planning

Each was chosen against a stated alternative. The reasoning is what makes them
reviewable later.

### 1. Session state is derived, never stored

A session's status is computed from the runs that exist in the current ISO week,
not read from a column. There is no reset job and nothing to schedule — the week
turns over on its own because the question being asked changes.

The alternative was keeping `workout_sessions.status` and adding a `week_start`,
resetting lazily on read. That writes during a read, which offline means a
paused mutation and a status that stays wrong for as long as the member is in
the basement — and it leaves the weekly report and "completed on Tuesday" with
nowhere to live.

`workout_sessions.status` stops being read and written. The column stays: it is
not worth a destructive migration on a live database, and the patch says so.

### 2. Every press of play opens a run

`workout_runs` is the unit of work. A run owns its clock, its outcome and the
member's note, and every `set_logs` row points at one.

This is what makes the counting correct. `loggedCount` scoped to the open run
restarts at `0/3` every week and after every abandon, which no filter over
`performed_at` can do as cleanly — two runs of the same session inside one week
are a normal thing, not an edge case.

It also removes the need to ever delete a set. Abandoning marks the run
`abandoned` and leaves its rows in place. A `DELETE` would have to race the
replay queue: a set logged on the underground can land *after* the delete that
was meant to remove it, and there is no ordering that fixes that in general.

### 3. Stop is two actions, not one

`doc/live_train_session.md` uses "stop" for two different things — §67 discards
the data, §68 completes early with weighted points. They are different decisions
with different consequences and they get different buttons, inside one sheet
that states what each will do.

- **Termina** — outcome `partial`, sets kept, points weighted.
- **Abbandona** — outcome `abandoned`, zero points, the session returns to `todo`
  and can be done again the same week.

Hiding both behind one control is how defect 2 was born.

### 4. Finishing everything is automatic

The moment the last required set of the last exercise is logged, the run closes
with outcome `completed` and a congratulations dialog appears. The member does
not press stop to finish a workout they have finished.

### 5. Points follow sets, not exercises

```
points = floor(POINTS.workout * Σ min(logged, target) / Σ target)
```

Per-exercise counts are clamped to the target so an extra set cannot inflate the
total. Zero sets is zero points — defect 2, arithmetically.

Sets rather than exercises, though §68 reads either way: sets is the number the
member watches move all session, so the result is predictable, and two of three
sets on every exercise earning nothing would be a strange thing to tell someone
who trained for forty minutes.

The reward code changes from `workout:${sessionId}` to **`workout:${runId}`**.
Unique per run, so the same session earns again next week, and still replay-safe
against `unique (member_id, code)` — which is what the old code was protecting
and what defect 6 shows it over-protected.

### 6. The member's note is asked for once, at the summary

The congratulations dialog has one button and it leads to the existing summary
screen, extended with a note for the coach (`workout_runs.note`). The end of the
session is the only moment the member still remembers how it went; a note asked
for later, from a menu, is a note nobody writes.

Not inside the dialog: a dialog that asks you to type is a dialog you dismiss,
and on an iPhone the keyboard covers half of it.

### 7. Old plans are archived, never deleted

Creating a new plan leaves the previous one in the database, invisible.
This is already the behaviour — `fetchActivePlan` takes the newest — so it costs
nothing and loses nothing. Deleting would cascade through `workout_sessions`,
`session_exercises` and every `set_logs` beneath, emptying the progress charts
the professional uses.

No history screen. The data is there if one is ever wanted.

### 8. The coach's prescription is never edited by the member

§15 and §25 of the brainstorm contradict each other: the member cannot modify
the coach's plan, but "the weight can be adjusted by the client". Resolved by
noticing they are two different numbers.

`session_exercises.target_weight` is the advice and stays untouched. The weight
actually lifted goes on each `set_logs` row, as it already does in
`LogSetSheet.jsx:139`, with the target as the field's placeholder. No exception
to the editing rule, and the coach gets to see prescribed against lifted.

### 9. One screen per exercise, which grows a logging half during a run

Tapping an exercise card opens a full route carrying everything: the graphic
block, how to perform it, the coach's note, the sets already logged, the form
for the next set, and the rest timer. A compact bar stays pinned at the top with
the session name and the running clock, so the clock is never lost.

It is **one** route, `/m/workout/exercise/:sessionExerciseId`, the one that
exists today. When a run is open on the exercise's parent session it shows the
logging half; otherwise it is the reference card it is now. Nothing about the
exercise changes between the two states, so a second route keyed by run would be
the same screen twice, and the run is already derivable from the member.

`ExerciseDetailScreen.jsx` therefore grows rather than dies, and
`LogSetSheet.jsx` is deleted into it.

A taller bottom sheet was the cheaper option and is wrong here: it covers the
clock, and the phone's back gesture dismisses it — which, one-handed in a gym,
happens by accident.

### 10. The rest timer rings, within what the platform allows

Countdown computed from a timestamp rather than accumulated by ticks, preset
from `rest_seconds`, editable, with a sound played through a Web Audio context
unlocked on the first tap. A speaker icon beside the countdown mutes it, and the
choice is remembered in `localStorage` — a gym is either loud or on headphones,
and walking back through settings every session is not acceptable.

The honest limits, which belong in the report's chapter on PWA constraints:

| | |
|---|---|
| Web Audio | Works, needs a user gesture to unlock first |
| Vibration API | Does not exist in Safari on iOS |
| Scheduled local notifications | No web API, at all |
| `setInterval` in a backgrounded tab | Throttled by every browser |

So: with the app open and the screen awake, the sound is reliable. With the
phone locked it may be late or not arrive. Because the countdown is derived from
a timestamp, the *time* is always right on return even when the ticks were
skipped — only the sound is at risk.

Server-scheduled push was considered and dropped: the Phase 4B infrastructure
can deliver a notification but nothing exists to fire one ninety seconds from
now, and building a scheduler for a rest timer is out of proportion.

### 11. A mini-player, not a system overlay

§100 asks for a lock-screen overlay in the style of Spotify. That runs through
the Media Session API, which only attaches to real audio playback; holding it
open with a silent looping track is unreliable in a PWA on iOS and costs battery
for the whole workout.

Instead, while a run is open, a fixed bar sits above the bottom navigation on
**every** member screen — Home, Nutrition, Trainer, Profile — showing the
session name, the clock, and a tap target back into the workout. It solves the
real problem ("I left the workout and cannot find it again") and it works. The
open run lives in the database, so the bar survives a reload, a cleared cache
and a different phone.

### 12. The coach/self-service fork lives in the empty state

`/m/workout` with no plan shows the right fork depending on whether a
professional is assigned: *Choose a coach* or *Book with Andrea*, each beside
*Build it myself*. With a plan present the screen stays clean and the same two
paths are reachable from the overflow menu's *Create a new Workout Plan* —
which is what §58 describes anyway.

A permanent banner above an active plan would be noise over the thing the member
came to see.

### 13. Plan creation is one flow, shared by both roles

`NewPlanForm` comes out of `ClientWorkoutScreen.jsx` as `PlanForm.jsx`, beside
the already-shared `SessionForm.jsx`. Above them, `CreatePlanFlow.jsx` runs two
steps — plan metadata, then the first session — and both roles mount it. Only
`memberId`, `authorId` and where it lands afterwards differ.

**Nothing is written until there is a plan and a first session.** One submit at
the end, `createPlan` then `createSession`. This is what closes defect 8, and it
closes it on the professional's side too, where it exists today. It also
enforces §15's rule that no session may exist without at least one exercise.

### 14. Editing is a mode, not a second screen

The overflow menu enters edit mode on the same list: cards grow a delete
control, an *Add* button appears at the end, and a Cancel/Done bar appears at the
top. Deleting asks for confirmation and names how many exercises go with it.

The same pattern serves the plan (its sessions) and the session (its exercises).
A dedicated `/edit` route would be a second screen repeating the list the member
just left.

Per §94-97: editable when `todo` or `completed`, never while a run is open.
Per §29 and §92: only the plan's author sees the edit entry, and exercise names
and muscle groups come from the catalogue and are never editable.

### 15. The weekly report is the plan screen

§66 asks that unfinished sessions be tracked in a weekly report. With runs, the
plan screen already is one: the banner counts the week's closed sessions and
each card states its own outcome — "Completed Monday", "Stopped at 60%",
"To Do — skipped last week".

**A `partial` counts towards the bar**, and the card discloses the percentage.
Counting only `completed` would mean a member who ended one session early never
sees the week reach 100%, which reads as an unfinished week rather than as the
finished-early week it was. `planProgress` therefore counts sessions with any
closed, non-abandoned run this week — the bar answers "is the week done", the
cards answer "how well".

No new screen. The professional's side already has `ClientProgressScreen`.

### 16. One open run per member, enforced by the database

Pressing play with a run already open raises a sheet naming what is open and for
how long, offering to return to it or to abandon it and start the new one.
Nothing is closed silently — closing a session on the member's behalf is
deciding, for them, how many points they earned.

Beneath the UI, a partial unique index makes it true rather than merely
intended: two phones signed into one account cannot open two runs.

### 17. The clock lives on the run

`timer.js`'s three keys become three columns. The module and its self-check do
not change; only where the state comes from does. The clock is then correct
after a cleared cache or on a second device, the mini-player can read it from
any screen, and defect 1 disappears because the key is the run and a new run is
a new row.

### 18. `expires_on` is no longer shown

§21 says the validity period is deliberately not tracked, yet the banner prints
`Expiration: 21/04/2026`. The banner drops it and keeps "Duration: N weeks". The
column stays in the schema, written by nobody and read by nobody.

### 19. Exercise imagery is drawn, not fetched

A graphic block built from the theme — a muscle-group icon on a tinted field —
exactly as the wireframes show it, where the exercise thumbnail is a grey
placeholder. No files to license, host, or fit into a service worker precache
that has to work in a basement. `exercises.image_url` and `video_url` stay
unused and available.

## Data model

`supabase/patches/013-workout-runs.sql`. No agent holds credentials: this is
applied by hand in the Supabase SQL editor and carries its own PASS/FAIL block,
in the shape of `011` and `012`.

```sql
create type run_outcome as enum ('completed', 'partial', 'abandoned');

create table workout_runs (
  id              uuid primary key,          -- client-generated, so a replay upserts
  session_id      uuid not null references workout_sessions(id) on delete cascade,
  member_id       uuid not null references profiles(id) on delete cascade,
  started_at      timestamptz not null,      -- client's clock: this write can sit
  paused_at       timestamptz,               -- paused for hours before it lands
  paused_total_ms int not null default 0,
  ended_at        timestamptz,
  outcome         run_outcome,
  note            text
);
create index on workout_runs (member_id, started_at desc);
create index on workout_runs (session_id, started_at desc);

-- At most one open workout per member, enforced here rather than only in the UI.
create unique index on workout_runs (member_id) where ended_at is null;

alter table set_logs add column run_id uuid references workout_runs(id) on delete cascade;
create index on set_logs (run_id);
```

`started_at`, `paused_at` and `ended_at` are all supplied by the client for the
same reason `set_logs.performed_at` is (`workouts.js:135`): the write may be
replayed on reconnect, and `now()` at insert time would record a workout that
started at 18:00 as starting at 23:00.

**Security.** Policies on the model of `set_logs`: the member reads and writes
their own runs, the professional reads their own clients' via `owns_member`.
Every `using` clause names `auth.uid()` — a policy that does not is public to
anyone holding the publishable key, which ships in the JS bundle.

The `GRANT` must be issued explicitly. Postgres checks the table grant *before*
it evaluates any policy, so a table with perfect policies and no grant answers
`42501 permission denied`; see `patches/006-restore-public-grants.sql`.

`verify.sql`'s schema and security counts move from 18 tables to 19 and must be
updated in the same patch, or the next run reads FAIL for the wrong reason.

## Deriving state

New pure module **`src/lib/week.js`**, with `week.selfcheck.js` beside it, run
under bare Node like the other nine.

It lives in `lib/` rather than beside the workout screens because `data/` reads
it, and `features/` calls `data/`, never the other way round. It is date logic
with no React in it, exactly like `format.js` -- its only import.

```
mondayOf(dayISO)              the ISO week's Monday, in the local frame
daysBefore(dayISO, n)         n days earlier, in the local frame
runStatusOf(runs, weekISO)    'in_progress' | 'completed' | 'partial' | 'todo'
```

`daysBefore` exists so no caller reaches for `Date.now() - n * 86_400_000`,
which is wrong across a daylight-saving boundary -- one day a year is 23 hours
and another 25 -- nor for `toISOString()`, which converts to UTC and
reintroduces the off-by-one-day this module exists to prevent.

- `in_progress` — a run exists with `ended_at` null.
- `completed` / `partial` — a closed run with that outcome and `started_at`
  inside the current week.
- `todo` — everything else. An `abandoned` run does not count; the session is
  there to be done again.

An open run wins whatever week it began in. One left open last Sunday is still
open, and `workout_runs_one_open_per_member` blocks a second, so hiding it
would strand the member with a play button that fails and nothing on screen
saying why. The plan therefore reads back a fortnight and lets `runStatusOf`
decide what counts.

The week comparison is made on the LOCAL day, never on the raw ISO string: a
session started at 23:30 on Sunday carries a UTC timestamp dated Monday, and a
string comparison would file it under the week that had not begun yet.

Dates go through `todayISO()` and `localDayISO()`. Never `new Date('YYYY-MM-DD')`
— that is UTC midnight and renders as the previous day west of Greenwich.

## Writes and their ordering

New registrations in `src/data/mutations.js`: `startRun`, `pauseRun`,
`resumeRun`, `endRun`.

`startRun`, `logSet` and `endRun` **share one `scope`**. `set_logs.run_id` is a
foreign key, and `resumePausedMutations` replays in parallel unless a scope says
otherwise — an unscoped replay can land a set before the run it references and
fail on the constraint. `logSet` carries no scope today; it gains one here.

`startRun` and `endRun` take a client-generated id and upsert on it, so a
replayed write lands on the same row rather than opening a second run and
tripping the partial unique index.

## Screens

### `/m/workout` — the plan

Header, then a banner carrying the plan name, level, session count, author,
duration in weeks, and a progress bar over **this week's** sessions. An overflow
menu at the banner's top right: *Create a new Workout Plan* (always, stating
plainly that the current one is replaced) and *Edit Workout Plan* (author only).

Below, `Training Sessions` — rounded cards, one per session, each with its name,
exercise count, and its state for this week. Tapping opens the session.

With no plan, the screen is the fork of decision 12 instead.

### `/m/workout/session/:sessionId` — one session

Banner with the session name, exercise count, textual state and the play control.
Play asks for confirmation before opening a run. Below, `Exercises` as rounded
cards: name, muscle group, sets x reps, rest.

An overflow menu carries *Edit session*, hidden while a run is open.

### `/m/workout/session/:sessionId/live` — the run

The banner gains the clock and swaps play for pause plus stop; the overflow menu
disappears. Per §101 **no card is highlighted as "current"** — the old
implementation outlined the first unfinished exercise, imposing an order the gym
does not respect when a machine is occupied. Each card shows its sets done and,
when it reaches its target, says so and stops offering to log more.

Pause needs no confirmation; it is not destructive. Stop opens the sheet of
decision 3.

### `/m/workout/exercise/:sessionExerciseId` — one exercise

The screen of decision 9, unchanged in route. Read-only as it is today, plus a
logging half — sets so far, the form for the next one, the rest timer — whenever
a run is open on this exercise's parent session. `LogSetSheet.jsx` is deleted
into it.

Per §102, once the target is reached the form is replaced by a plain statement
that the exercise is done. Nothing lets a member log a fourth set of three.

### `/m/workout/run/:runId/summary` — after

Keyed on the run, not the session. The same session comes round again every
week, and a route that could only name the session would show this week's
numbers under last week's heading. The existing summary otherwise, with
weighted points and the note field of decision 6.

### The mini-player

Mounted in `AppLayout.jsx`, member role only, driven by `fetchOpenRun`. The same
query answers the exclusivity check of decision 16, so it is one read, not two.

## Deviations from the wireframes

Recorded here so they are not re-litigated later.

1. **No "current exercise" highlight** during a run (`06A - Session Started`).
   §101 is explicit: sequencing cannot always be honoured in a real gym.
2. **`07 - Exercise Details` becomes a working screen**, not a reference card.
   The wireframe shows a title, a clock and a progress bar over an empty body;
   the body is where logging and the rest timer now live.
3. **No expiry line** in the plan banner, per decision 18.
4. **A mini-player above the bottom bar**, which no wireframe has, per
   decision 11.
5. **Exercise thumbnails stay graphic blocks**, as the wireframes draw them, per
   decision 19.

## Acceptance

`npm run lint` **and** `npm run build`. Lint never resolves module paths and
Vite does; an icon glyph `@mui/icons-material@9.2.0` does not ship passes the
first and breaks the second.

Self-checks under bare Node, including the new one:

```
node src/lib/week.selfcheck.js
node src/features/workout/summary.selfcheck.js
node src/features/workout/status.selfcheck.js
node src/features/workout/timer.selfcheck.js
```

By hand on `npm run preview` — the service worker does not exist in `dev` —
signed in as `daniel@trainhub.dev`:

1. No plan: the fork matches whether a professional is assigned.
2. Build a plan and abandon halfway: the coach's plan is still there.
3. Play: a run opens, and the mini-player is visible from Home and Nutrition.
4. Play on a second session: the choice sheet appears, nothing closes silently.
5. Log every set: congratulations, then the summary, then the note saves.
6. Reload mid-workout: the clock is right. Switch sessions: it starts at zero.
   **(defect 1)**
7. Stop at a third: the points are a third, not thirty. **(defect 2)**
8. Move the device clock to the following Monday: sessions return to `todo`, the
   pills read `0/3`, and completing one awards points again. **(defects 4, 5, 6)**
9. In airplane mode: log sets, open and close a run. On reconnect the run lands
   before its sets and nothing fails on the foreign key.
10. As `andrea@trainhub.dev`: the member's note is readable on the client.

## Human handoffs

- **Apply `supabase/patches/013-workout-runs.sql`.** Done 2026-08-06, eight rows
  PASS.
- **Apply `supabase/patches/014-workout-run-pct.sql`.** The `pct` column 013
  should have carried. Every run read selects it, so until this lands the whole
  workout half answers "column workout_runs.pct does not exist".
- **Re-run `verify.sql`** afterwards; its counts move from 18 tables to 19 and
  from 17 to 18. Done 2026-08-06, all five schema and security rows PASS.
- **Probe the new policies from an anonymous client.** `verify.sql` runs as the
  dashboard's privileged role and bypasses RLS, so it proves the policies exist
  and not that they are right. Phase 0 shipped one that looked fine and was
  public. **Still owed.**
- **The device walk above**, on a real phone, installed from Safari. **Still
  owed** — nothing in this phase has been exercised in a browser.

## What implementation changed

Recorded here rather than quietly, because a spec that no longer describes the
code is worse than no spec.

1. **`week.js` moved to `src/lib/`** and grew `daysBefore`, for the reasons now
   stated under "Deriving state".
2. **`patches/014` was needed** because 013 shipped without `pct`, which
   decision 15's card copy requires.
3. **The points and `pct` are not equal to the unit.** An earlier draft claimed
   they could never disagree. They can differ by one: a whole percentage is a
   lossy carrier, and one set of six is 16% while the award is floor(30/6) = 5
   rather than floor(30 × 0.16) = 4. What is true, and what the self-check pins,
   is that they can never tell opposite stories — no points without progress, no
   full award without a full session, neither moving while the other stands
   still. Deriving the points from the rounded percentage instead would lose
   real work to rounding.
4. **Three screens the spec did not name** turned out to be required by its own
   decisions: `AddSessionScreen` (decision 14's edit mode has to add sessions,
   and deleting the old builder took the only path that could),
   `AddExerciseScreen` (the same, for exercises), and `OpenRunSheet`
   (decision 16's choice sheet). With them, `addSessionExercise` and
   `deleteSessionExercise` in the data layer.
5. **Opening and closing a run must be written to the cache before the server
   answers.** This is not a refinement: without it the live screen finds no open
   run and redirects straight back, so starting a workout never worked at all —
   guaranteed offline, and a race the navigation usually won online. Both are
   now registered as `onMutate` handlers in `src/data/mutations.js` rather than
   left to each call site, so a screen cannot forget. The same applies to
   logging a set into a run whose logs were never fetched, which silently did
   nothing and then locked the form.
6. **The coach's side of decision 6 left this phase.** Davide split the
   professional's half into its own spec on 2026-08-06. `workout_runs.note` is
   therefore written and read by nobody until that spec lands — a known debt,
   not an oversight.

## Out of scope

- The notification bell — neither its stale badge (defect 3) nor its missing tap
  target. Queued behind this phase with its own design pass.
- A history screen for archived plans.
- A member-side progress screen; `ClientProgressScreen` remains professional-only.
- Surfacing the member's note to the coach. Moved into the professional's own
  spec, so the note is written and unread until then.
- Real exercise imagery or video.
- Removing `workout_sessions.status` or `workout_plans.expires_on` from the
  schema. Both stop being used; neither is worth a destructive migration.
- Reordering sessions or exercises. Edit mode adds and removes; `position`
  ordering stays as written.
