# TrainHub — database install and demo runbook

Everything in `supabase/` is applied **by hand in the Supabase SQL editor**. No
agent holds credentials, so every step below is yours.

There are two things you might be doing:

- **[A. Fresh install](#a-fresh-install)** — an empty Supabase project.
- **[B. Before a demo](#b-before-a-demo)** — the database already exists and you
  want the data to be current again. This is one step.
- **[C. Clean slate](#c-clean-slate)** — the project exists but you want to throw
  the old demo accounts away and start again from A.

---

## A. Fresh install

Run these in order. Stop at the first error; nothing below assumes a failed step
somewhere above.

### 1. Create the four accounts that sign in

**Authentication → Users → Add user → Create new user.** For each one, tick
**Auto Confirm User** — it skips the confirmation email, which matters because
`trainhub.com` is a real domain you do not control.

| Email | Who | Password |
|---|---|---|
| `marco@trainhub.com` | Marco Ferrari — professional, main coach | your choice |
| `giulia@trainhub.com` | Giulia Ricci — professional, second coach | your choice |
| `daniel@trainhub.com` | Daniel Aresta — the main demo member | your choice |
| `sofia@trainhub.com` | Sofia Bianchi — second member, Giulia's client | your choice |

The same password for all four is fine and makes the demo easier. If you set
`PROBE_DEMO_PASSWORD` in `.env.local`, `probe-security.mjs` will use it.

> **Never test the password-reset flow against these addresses.** The mail would
> leave for a domain that is not yours. This is the whole reason the demo
> accounts used to be on `.dev`; the constraint has not gone away, it is just
> written down now.

The other five members — Elena, Lorenzo, Alex, Pierfelice, Chiara — are created
by `seed.sql` as `auth.users` rows with **no** `auth.identities` row. They have
no credential and cannot sign in, by design.

### 2. Schema and policies

In the **SQL editor**, in this order:

1. `schema.sql`
2. `policies.sql`

### 3. Patches 001 → 025

In numeric order, one file at a time. Each one ends with its own PASS/FAIL
block — read it before moving on.

**Skip `002` and `005`.** Both are superseded by `seed.sql` and say so at the
top of the file. They are kept because they are part of the applied history of
the live database, not because they should be run again.

See [the patch map](#the-patch-map) below for what each one does and which
earlier version it replaces.

### 4. Seed

Run `seed.sql`. It prints a table of row counts when it finishes.

It is **destructive and re-runnable**: it deletes every demo row and rebuilds
it. It never *deletes* from `auth.users`, `profiles` or `exercises`, so the
accounts and their uuids survive any number of re-runs — it upserts the
profiles, tops up the exercise catalogue, and creates the five members who
never sign in.

### 5. Verify

Run `verify.sql`. **Every row must read PASS.** There are no expected failures.

### 6. Probe RLS from outside

`verify.sql` runs as the dashboard's privileged role and bypasses RLS entirely,
so it cannot tell you whether the policies are right. These two connect through
the same public API the browser uses. Both need `.env.local`.

```bash
node supabase/probe-rls.mjs        # what an anonymous caller can read
node supabase/probe-security.mjs   # what each signed-in role can read and write
```

`probe-rls.mjs` is the one that catches a policy whose `using` clause never
mentions `auth.uid()` — such a policy is public to anyone holding the
publishable key, which ships in the JS bundle. `verify.sql` structurally cannot
see that.

---

## B. Before a demo

```
SQL editor → seed.sql → Run
```

That is all. Session state is **derived** from the workout runs inside the
current ISO week, so a seed left alone for a week produces an app where every
session reads "To Do" and every progress bar is empty. Re-running re-anchors
everything — runs, check-ins, appointments, chat — to today.

Follow it with `verify.sql` if you want the proof.

---

## C. Clean slate

Throwing the old `@trainhub.dev` accounts away and starting over is cleaner than
renaming them: it cannot leave a stale profile behind. It only has to be done in
the right order.

**Why the order matters.** `profiles.id` is `references auth.users on delete
cascade`, so deleting a user takes everything with it. But four foreign keys are
`on delete restrict`, not cascade:

- `rewards.run_id` -> `workout_runs`
- `rewards.workout_session_id` -> `workout_sessions`
- `workout_plans.replaces_plan_id` -> `workout_plans`
- `nutrition_plans.replaces_plan_id` -> `nutrition_plans`

RESTRICT is checked immediately rather than at end of statement, and the cascade
reaches `workout_plans` before it reaches `rewards` -- the plans foreign key is
the older of the two -- so it tries to delete a run while a reward still points
at it, and fails with `violates foreign key constraint "rewards_run_fk"`.

`seed.sql` cannot do this cleanup for you: it is one transaction and it aborts on
`Missing auth user ...`, which rolls its own deletes back.

### 1. Cut the RESTRICT edges

SQL editor:

```sql
begin;
delete from public.rewards;
delete from public.set_logs;
delete from public.workout_runs;
delete from public.workout_plans where replaces_plan_id is not null;
delete from public.workout_plans;
delete from public.meals;
delete from public.nutrition_days;
delete from public.nutrition_plans where replaces_plan_id is not null;
delete from public.nutrition_plans;
commit;
```

### 2. Delete the users

**Authentication -> Users**, delete every demo account. Appointments, chat,
check-ins, notifications, availability, body metrics and badge tokens all cascade
away on their own.

### 3. Carry on from A

Go to [step 1 of the fresh install](#1-create-the-four-accounts-that-sign-in) and
create the four accounts. There is no rename to do -- the rename statement inside
`seed.sql` simply matches nothing.

### Two side effects

- **Push notifications stop.** `push_subscriptions` cascades, so an installed PWA
  loses its subscription and has to re-enable notifications from the app. The
  configuration in `app_config` is not tied to any user and survives.
- **Uploaded avatars are orphaned.** `storage.objects` has no foreign key to
  `profiles`, so nothing removes them. Delete them by hand under Storage ->
  `avatars` if you had uploaded any.

---

## The cast

| Name | Email | Signs in | Coach | Membership | Exists to show |
|---|---|---|---|---|---|
| Marco Ferrari | `marco@trainhub.com` | yes | — | — | the professional with a full roster, agenda, scanner |
| Giulia Ricci | `giulia@trainhub.com` | yes | — | — | a second coach: her roster shows **only** her two clients |
| Daniel Aresta | `daniel@trainhub.com` | yes | Marco | active, +8 months | the complete member: all four session states this week, rewards, badge, chat |
| Sofia Bianchi | `sofia@trainhub.com` | yes | Giulia | active, +5 months | a **self-authored** workout plan (`patches/017`), and the other side of Giulia's chat |
| Elena Mingotti | `elena@trainhub.com` | no | Marco | active, +6 months | a superseded plan chain, ten weeks of history, a weight trend |
| Lorenzo Mamone | `lorenzo@trainhub.com` | no | Marco | active, **+12 days** | a membership about to lapse |
| Alex Giustacchini | `alex@trainhub.com` | no | Marco | **suspended** | runs recorded but no reward points, badge refused |
| Pierfelice Rocco | `pierfelice@trainhub.com` | no | Marco | **expired** | the lapsed state, distinct from suspended |
| Chiara Neri | `chiara@trainhub.com` | no | Giulia | active, +4 months | a real client with **no workout plan** — the empty state |

Not seeded on purpose: a member with no coach. It is a real state, but it is not
signed-in-able and so cannot be shown. Register a fresh account mid-demo
instead — that is the actual path a new member takes.

---

## The patch map

Applied in order on top of `schema.sql` + `policies.sql`. Several patches
re-create a function an earlier patch defined; the **Supersedes** column is
what tells you which copy is the live one.

| # | What it does | Supersedes |
|---|---|---|
| 001 | Closes an anonymous read leak on `profiles` — a policy whose `using` never mentioned `auth.uid()`. | `policies.sql` |
| 002 | ~~Re-bases the demo agenda onto today.~~ **Do not run** — `seed.sql` does this. | — |
| 003 | Derives `rewards.points` on the server instead of trusting the client. | — |
| 004 | Adds `body_metrics`. | — |
| 005 | Four demo clients. **Do not run after `seed.sql`** — its second half writes sessions with no exercises. | — |
| 006 | Restores the table `GRANT`s. RLS is the *second* gate; without a grant a table answers `42501` before any policy is read. | — |
| 007 | Puts `messages` on the Realtime publication. | — |
| 008 | Column grants so a thread member cannot rewrite the other party's message body. | — |
| 009 | The QR access badge: `checkin_tokens` and `redeem_checkin_token`. | — |
| 010 | Push notifications, database half: `app_config`, `notify_user`, the four notify triggers. | — |
| 011 | Hardens the three oldest `security definer` functions against `pg_temp` shadowing. | `009`, `policies.sql` helpers |
| 012 | A professional booking an appointment notifies the member. | — |
| 013 | `workout_runs` — one row per attempt at a session. The Phase 5A redesign. | — |
| 014 | Adds `workout_runs.pct`. | — |
| 015 | **The big one.** Rewrites every sensitive write as a checked `security definer` RPC and revokes direct table grants. | `003`, and the write policies from `policies.sql` |
| 016 | Fixes the completion count: `LEAST(COALESCE(logged, 0), target_sets)`. | `015`'s `close_workout_run_secure` |
| 017 | Lets a member author their own workout plan, not only their coach. | `015`'s `create_workout_plan_secure` |
| 018 | One plan-creation call carries any number of sessions. | `017`'s `create_workout_plan_secure` |
| 019 | Grows the exercise catalogue to Biceps, Triceps and Core. | — |
| 020 | A real notification centre: the `notifications` table, and the triggers that fill it. | `010`'s notify functions |
| 021 | Fixes the appointment push's timezone; adds bulk read/delete. | `020`'s `notify_on_appointment_status` |
| 022 | Nutrition plans move to Day Types: `nutrition_days`, `meals.day_id`, `create_nutrition_plan_secure`. | the old flat `meals.plan_id` |
| 023 | Gives `subscription_status` teeth: `has_active_subscription`, the professional-only status write, and the guard threaded into plan creation, booking and reward points. | `016`'s and `018`'s and `022`'s operations |
| 024 | Ten points for checking in at the gym. | `015`'s `redeem_checkin_token` |
| 025 | The `avatars` storage bucket and its four policies. | — |

**Where the live version of each much-rewritten function is:**

| Function | Live in |
|---|---|
| `create_workout_plan_secure` | **023** (8-argument form from 018) |
| `close_workout_run_secure` | **023** (carries 016's `LEAST` fix) |
| `create_nutrition_plan_secure` | **023** (shape from 022) |
| `create_appointment_secure` | **023** |
| `redeem_checkin_token` | **024** |
| `notify_on_appointment_status` | **021** |

The patches are deliberately **not** squashed into a single consolidated schema.
The safe way to squash is to have the database generate the file
(`pg_dump --schema-only`) and verify it by rebuilding an empty database — there
is no test database here, and hand-transcribing twenty-five patches is the
unverifiable version of that. The evidence that the risk is real is in this
repo: `schema.sql` is already a partial hand-consolidation, and it never gained
the `notifications` table that `020` adds.

---

## What `seed.sql` guarantees

It is not just "some rows". Every row is one the application itself could have
written, and `verify.sql` re-derives that independently afterwards. In
particular:

- **Every workout session carries at least one prescribed exercise.**
  `_insert_session_bundle` raises `22023` otherwise, and a session with no
  exercises makes every run on it score 0% and pay nothing — which is exactly
  what `patches/005` had seeded.
- **`pct`, `outcome` and reward points are recomputed, never typed.** The seed's
  helper uses the same expressions as `close_workout_run_secure`.
- **`rewards.code` only ever takes the two shapes the app generates**:
  `workout:<run id>` and `checkin:<date>`.
- **Notifications are not inserted.** They are produced by the `patches/020`
  triggers firing on the seeded messages, appointments and plans — which is both
  honest and a live proof that those triggers work.
- **`workout_sessions.status` is not written.** Nothing has read or written it
  since Phase 5A; it survives in the schema for old rows only.

While it runs, `seed.sql` parks `app_config`'s `notify_function_url` and
`notify_secret` and puts them back before it commits. Without that, seeding
would fire fifty-odd real web pushes at every subscribed device.

---

## When something has gone wrong

**The dashboard says `Failed to delete selected users: Database error loading
user`.** GoTrue cannot read a user whose token columns are NULL, so it can
neither open nor delete the row. Four columns in `auth.users` --
`confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change`
-- have no `DEFAULT` in the auth schema, and `patches/005` inserted its four
demo clients without them. GoTrue scans them into plain Go `string` fields and a
NULL scan fails.

`seed.sql` repairs this for every affected row on each run. If you need to get
past it before the seed can run -- for instance while emptying the project --
either run the repair on its own:

```sql
update auth.users set confirmation_token = '' where confirmation_token is null;
update auth.users set recovery_token = '' where recovery_token is null;
update auth.users set email_change = '' where email_change is null;
update auth.users set email_change_token_new = '' where email_change_token_new is null;
```

or delete the rows from SQL, which bypasses GoTrue entirely:

```sql
delete from auth.users where email like '%@trainhub.dev';
```

Do the [step 1 cleanup](#1-cut-the-restrict-edges) first if you are deleting, or
the RESTRICT foreign keys will stop the cascade.

**A demo client shows up with an `@trainhub.dev` address.** `seed.sql` renames
the four legacy no-identity rows, but it refuses to rename onto an address that
already exists. Delete the stale `auth.users` row from the dashboard and re-run
the seed.

**`verify.sql` says there are eight members instead of seven.** Someone signed
up during a demo. Delete that `auth.users` row, or accept it — the check exists
to make drift visible, not to forbid it.

**The seed aborts with `Missing auth user ...`.** One of the four sign-in
accounts from step 1 does not exist under that exact address. The message names
which one.

**You deleted a sign-in account by accident.** Recreate it from the dashboard
with the same address and Auto Confirm, then re-run `seed.sql`. Everything that
cascaded away — plans, runs, logs, chat, rewards — is rebuilt. The uuid changes,
which is fine because nothing outside the database stores it.
