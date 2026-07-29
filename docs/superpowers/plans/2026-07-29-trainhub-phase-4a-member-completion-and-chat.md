# TrainHub Phase 4A — Member Completion and Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every remaining route in the app except `/p/scan` — the member's nutrition, trainer and profile sections, appointment booking, account settings including the logout that has been deferred since Phase 1, and a realtime chat working in both directions.

**Architecture:** No new architecture. Reads flow `data/` → TanStack Query → screen; writes are registered with `setMutationDefaults` so they replay after a reload. Chat adds one genuinely new mechanism: a Supabase Realtime subscription that pushes new `messages` rows into the existing query cache, so the transport changes but the cache does not.

**Tech Stack:** React 19, React Router 8, MUI v9, TanStack Query v5 with `persistQueryClient`, Supabase JS v2 (Postgres + RLS + Realtime), Vite 8.

## Global Constraints

- Plain JS + JSX. **No TypeScript**, no `.ts`/`.tsx` files. ESM only (`"type": "module"`); no `require`.
- **No new runtime dependencies in this plan.** Phase 4B adds two (`jsqr` and `qrcode`) with explicit authorisation; 4A needs none. If a task seems to need one, stop and report.
- All user-facing copy in **English**. (The `BookingSheet.png` wireframe is drawn in Italian; that is the designer's mock, not the product language.)
- MUI components and the theme in `src/theme/index.js` carry all styling. No CSS files, no colour literals — use `palette.*`, including the custom `palette.task.*` group.
- **Reads gate their error state on `data === undefined`, never on `isError` alone** (`networkMode: 'offlineFirst'`).
- Every Supabase **read** carries `.retry(navigator.onLine)`. **Writes must not** — they pause offline and replay.
- Every write is registered in `src/data/mutations.js` via `setMutationDefaults` with a key from `src/lib/mutationKeys.js`. A rehydrated mutation with no registered default is discarded **silently**.
- Call sites must **not** pass `onSettled` to `useMutation` — `defaultMutationOptions` spreads the call site last, so it replaces the registered handler. Per-call `mutate(vars, { onSuccess })` is a different mechanism and is safe.
- One `<h1>` per screen, section headings `<h2>`, card titles `<h3>`. Use `component=` to fix the level without changing the visual variant.
- **No `eslint-disable` of any kind.** Two tasks in Phase 3 were sent back for suppressing a `react-hooks` rule instead of fixing the code. If lint objects, the code is wrong.
- `npm run lint` must exit 0 **and `npm run build` must succeed** at the end of every task. Lint is not sufficient: ESLint never resolves module paths, so a MUI icon glyph that the installed `@mui/icons-material@9.2.0` does not ship passes lint and breaks the build. Phase 3 shipped exactly that. Before importing an icon name you have not seen used elsewhere in this repo, confirm it exists in `node_modules/@mui/icons-material/`.
- No test runner exists and none is added. Non-trivial pure logic ships an `assert`-based `*.selfcheck.js` run with `node <path>`.
- Commits: Conventional Commits, **no `Co-Authored-By` trailer** — the repository history is Davide's alone.
- Row Level Security governs every write. A client-side filter is not a security measure.
- Dates: compute in the frame you mean. `new Date('YYYY-MM-DD')` is UTC midnight and renders as the previous day west of Greenwich; `localDayISO(timestamp)` in `src/lib/format.js` maps an instant to the viewer's local calendar day. Phase 3 shipped this bug twice.

---

## What already exists

Do not rebuild these.

| Path | What it gives you |
|---|---|
| `src/data/workouts.js` | `fetchActivePlan`, `fetchSession`, `createPlan`, `createSession`, `deleteSession`, … |
| `src/data/appointments.js` | `fetchAppointmentsOnDay`, `fetchAgendaOnDay`, `fetchAppointmentsInRange`, `fetchAppointment`, `createAppointment`, `setAppointmentStatus` |
| `src/data/nutrition.js` | `fetchNutritionPlan(memberId) -> {plan, meals} \| null`, `saveNutritionPlan`, `saveMeal`, `deleteMeal` |
| `src/data/clients.js` | `fetchClients`, `fetchClient` |
| `src/data/availability.js` | `fetchAvailability(proId)`, `addAvailability`, `deleteAvailability` |
| `src/data/mutations.js` | `registerMutationDefaults(queryClient)` — every write registered here |
| `src/lib/queryKeys.js` | `queryKeys`, `queryPrefixes` |
| `src/lib/format.js` | `formatTimeRange`, `formatDate`, `todayISO`, `localDayISO` |
| `src/features/calendar/month.js` | `monthGrid`, `weekStrip`, `shiftMonth`, `monthLabel`, `WEEKDAY_INITIALS` — Monday-first, UTC-safe, self-checked |
| `src/features/clients/subscription.js` | `subscriptionStateOf(profile, todayISO) -> {label, color}` |
| `src/components/WeekStrip.jsx`, `MonthGrid.jsx` | Date strip and month grid, both presentational |
| `src/components/AppointmentCard.jsx` | Takes `appointment`, `person`, optional `to` |
| `src/components/ScreenState.jsx` | `LoadingState`, `ErrorState`, `EmptyState` |
| `src/components/TopHeader.jsx` | Greeting, a `notificationCount` prop **nothing currently passes**, avatar linking to the profile |
| `src/features/auth/useAuth.js` | `useAuth()` → `{session, user, profile, profileError, loading, signOut}` |
| `src/features/calendar/NewAppointmentSheet.jsx` | The professional's booking `Drawer` — read it before building the member's |

Routes still declared as `<Placeholder />` in `src/routes/index.jsx`, all replaced by this plan except `/p/scan`:
`/m/nutrition`, `/m/nutrition/meal/:mealId`, `/m/trainer`, `/m/trainer/browse`, `/m/trainer/appointments`, `/m/trainer/chat`, `/m/profile`, `/m/profile/badge` *(4B)*, `/m/profile/subscription`, `/m/profile/settings`, `/p/chat`, `/p/chat/:threadId`, `/p/scan` *(4B)*, `/p/profile`, `/p/profile/settings`.

Schema and RLS facts (from `supabase/schema.sql` and `supabase/policies.sql` — do not re-derive):

- `threads` is `(id, member_id, pro_id, created_at)` with `unique (member_id, pro_id)` — exactly one thread per pair.
- `messages` is `(id, thread_id, sender_id, body, read_at, created_at)`. **`id` has no default**: the client supplies it, which is what makes a replayed send idempotent.
- `messages_insert` requires `sender_id = auth.uid()` **and** membership of the thread. `messages_update_read` permits either party to update a row in their own thread — that is how `read_at` is set.
- `threads_insert` permits either party to create the pair.
- **`profiles_update_self` is `using (id = auth.uid())`**, so a member may set their own `assigned_pro_id`. That is what makes `/m/trainer/browse` possible, and it is also why a professional cannot claim a client.
- `profiles_select_professionals` is `using (auth.uid() is not null and role = 'professional')` — a signed-in member can browse professionals. The `auth.uid() is not null` guard is load-bearing; Phase 0 shipped it missing and every professional's profile was public.
- `availability_select_all` is readable by anyone signed in — the member's booking sheet needs it.
- `appointments_insert` permits `member_id = auth.uid()`, so a member can book.
- `nutrition_plans` and `meals` are readable by the member through `owns_member`. `meals.items` is `jsonb` holding `[{food, qty}]`.

## Deviations from the wireframes

1. **No "Call" control** on `gym_member/04 -PT.png`. There is no phone number anywhere in the schema. Only Chat is built. (Same deviation already recorded for `pt/08` in Phase 3.)
2. **No "View Full PDF Plan"** on `03 - Nutrition.png`. There is no PDF, no storage bucket and no generator; a button that downloads nothing is worse than no button. (Already recorded for `pt/09`.)
3. **No "Edit Profile" / "Personal Details" form** on `05 -Profile.png`. `profiles` holds `full_name`, `avatar_url` and `bio`; editing them is real work with no route of its own in the navigation map, and the graded features are elsewhere. The profile screen shows the values; changing them is out of scope for 4A and noted as future work in report chapter 6.
4. **The specialty filter chips** on `04B -PT.png` read "Weight Loss / Hypertrophy / Muscle Gain" — those are training goals, not the `pro_specialty` enum (`personal_trainer`, `nutritionist`, `both`). The filter is built on the real enum, so the chips read "All / Personal Trainer / Nutritionist".
5. **"8 years of experience"** on the same wireframe has no column. `profiles.bio` is shown instead, which the seed fills with exactly that kind of sentence.
6. **The member's appointment month grid** reuses `MonthGrid` from Phase 3 rather than the two-colour dot legend the wireframe draws. One marker colour per day is the first appointment's kind, as on the professional's calendar; the legend is dropped because a 5px dot cannot carry two.
7. **Subscription "Membership ID"** is rendered from the first eight characters of `profiles.id`, not the wireframe's `#274982`. There is no membership-number column and inventing one would be a fiction the database cannot back.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `supabase/patches/007-realtime-messages.sql` | Add `messages` to the `supabase_realtime` publication |
| `src/data/chat.js` | Thread and message reads, the send write, the read-receipt write |
| `src/data/profile.js` | The member's own profile writes: choose a professional, change password |
| `src/features/chat/useThreadMessages.js` | One thread's messages, kept live by a Realtime subscription |
| `src/features/chat/MessageBubble.jsx` | One message, sent or received |
| `src/features/chat/MessageComposer.jsx` | The send box, shared by both roles |
| `src/features/chat/ThreadScreen.jsx` | One conversation — used by both `/m/trainer/chat` and `/p/chat/:threadId` |
| `src/features/chat/ThreadListScreen.jsx` | `/p/chat` — the professional's inbox |
| `src/features/nutrition/MemberNutritionScreen.jsx` | `/m/nutrition` |
| `src/features/nutrition/MealDetailScreen.jsx` | `/m/nutrition/meal/:mealId` |
| `src/features/trainer/MyTrainerScreen.jsx` | `/m/trainer` |
| `src/features/trainer/BrowseTrainersScreen.jsx` | `/m/trainer/browse` |
| `src/features/trainer/MemberAppointmentsScreen.jsx` | `/m/trainer/appointments` |
| `src/features/trainer/BookingSheet.jsx` | The member's booking bottom sheet |
| `src/features/profile/ProfileScreen.jsx` | `/m/profile` and `/p/profile` — one screen, two link sets |
| `src/features/profile/SubscriptionScreen.jsx` | `/m/profile/subscription` |
| `src/features/profile/SettingsScreen.jsx` | `/m/profile/settings` and `/p/profile/settings` |

**Modified:**

| Path | Change |
|---|---|
| `src/lib/queryKeys.js` | Add the chat, trainer and profile keys and prefixes |
| `src/lib/mutationKeys.js` | Add `sendMessage`, `markThreadRead`, `chooseProfessional` |
| `src/data/mutations.js` | Register the three new writes |
| `src/components/TopHeader.jsx` | Feed the bell its real unread count |
| `src/layouts/AppLayout.jsx` | Pass the unread count through |
| `src/routes/index.jsx` | Wire thirteen real screens, lazily |

---

## Task 1: Chat data layer and Realtime

**Files:**
- Create: `supabase/patches/007-realtime-messages.sql`
- Create: `src/data/chat.js`
- Create: `src/features/chat/useThreadMessages.js`
- Modify: `src/lib/queryKeys.js`, `src/lib/mutationKeys.js`, `src/data/mutations.js`

**Interfaces:**
- Consumes: `supabase` from `src/lib/supabase.js`, `queryClient` from `src/lib/queryClient.js`.
- Produces:
  - `ensureThread({memberId, proId}) -> {id}`
  - `fetchMemberThread(memberId) -> {id, pro} | null`
  - `fetchThreads(proId) -> Array<{id, member, lastMessage, unreadCount}>`
  - `fetchMessages(threadId) -> Array<{id, sender_id, body, read_at, created_at}>`
  - `sendMessage({id, threadId, senderId, body}) -> row`
  - `markThreadRead({threadId, readerId}) -> void`
  - `useThreadMessages(threadId) -> UseQueryResult` — kept live by Realtime
  - `queryKeys.memberThread`, `.threads`, `.threadMessages`, `.unreadCount`; `queryPrefixes.chat`
  - `mutationKeys.sendMessage`, `.markThreadRead`

`messages.id` has no database default. The client supplies it for the same reason `set_logs` does: a send that pauses offline is replayed by `resumePausedMutations`, and a plain insert would fail that replay with a primary-key violation the user would see as a lost message.

- [ ] **Step 1: Write the Realtime patch**

Create `supabase/patches/007-realtime-messages.sql`:

```sql
-- Put `messages` on the Realtime publication.
--
-- Supabase streams a table's changes only if the table belongs to the
-- `supabase_realtime` publication.  A fresh project adds tables to it as they
-- are created, but `drop schema public cascade` -- used earlier in this project
-- to restart a half-applied schema -- removes them again, and nothing in the app
-- noticed because nothing used Realtime until now.  A missing publication entry
-- produces no error: the subscription connects, reports SUBSCRIBED, and simply
-- never fires.  That is the worst possible failure mode, so this file also
-- prints what the publication holds afterwards.
--
-- `replica identity full` makes the old row available on UPDATE payloads.  The
-- chat only reacts to INSERT, but read receipts are UPDATEs and a later feature
-- that wants them will need this; setting it now costs nothing on a table this
-- size.
--
-- Idempotent: guarded, so a second run changes nothing.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

alter table public.messages replica identity full;

-- Must list `messages`.  If it does not, the chat will look connected and stay
-- silent.
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;
```

- [ ] **Step 2: Add the keys**

Add to `queryKeys` in `src/lib/queryKeys.js`:

```js
  memberThread: (memberId) => ['chat', 'memberThread', memberId],
  threads: (proId) => ['chat', 'threads', proId],
  threadMessages: (threadId) => ['chat', 'messages', threadId],
  unreadCount: (userId) => ['chat', 'unread', userId],
  professionals: () => ['professionals'],
  memberAppointments: (memberId, fromISO, toISO) => ['appointments', memberId, 'range', fromISO, toISO],
```

Add to `queryPrefixes`:

```js
  // Every chat key starts with 'chat', so one prefix invalidates the thread
  // list, the open conversation and the unread badge together.
  chat: ['chat'],
  professionals: ['professionals'],
```

Add to `mutationKeys` in `src/lib/mutationKeys.js`:

```js
  sendMessage: ['sendMessage'],
  markThreadRead: ['markThreadRead'],
  chooseProfessional: ['chooseProfessional'],
```

- [ ] **Step 3: Write the chat data module**

Create `src/data/chat.js`:

```js
import { supabase } from '../lib/supabase.js'

// postgrest retries a failed GET three times with 1s/2s/4s backoff, which turns
// "offline" into seven seconds of nothing.  Retry only when the browser thinks
// there is a network.  Applied to every read below.

const MESSAGE_COLUMNS = 'id, thread_id, sender_id, body, read_at, created_at'

/**
 * The member's thread with their assigned professional, creating it on first
 * use.
 *
 * `threads` carries `unique (member_id, pro_id)`, so the upsert is idempotent:
 * two devices opening the chat at once land on the same row rather than racing
 * to create two.  `ignoreDuplicates` is deliberately NOT set -- it would return
 * no row on the second call, and the caller needs the id every time.
 */
export async function ensureThread({ memberId, proId }) {
  const { data, error } = await supabase
    .from('threads')
    .upsert({ member_id: memberId, pro_id: proId }, { onConflict: 'member_id,pro_id' })
    .select('id')
    .single()

  if (error) throw error
  return data
}

/**
 * The member's thread, if one exists.
 *
 * Returns null rather than throwing when the member has no professional or has
 * never messaged: both are ordinary states the screen renders as an empty one.
 */
export async function fetchMemberThread(memberId) {
  const { data, error } = await supabase
    .from('threads')
    .select('id, pro:profiles!threads_pro_id_fkey ( id, full_name, avatar_url )')
    .eq('member_id', memberId)
    .maybeSingle()
    .retry(navigator.onLine)

  if (error) throw error
  return data
}

/**
 * The professional's inbox.
 *
 * The messages are embedded whole and rolled up here rather than asked for as
 * aggregates: PostgREST cannot express "count the unread ones from the other
 * party" in an embed, and this is one professional's own threads.
 *
 * ponytail: fetches every message in every thread. Fine at demo scale (tens of
 * rows); if a thread ever grows long, move the last-message and unread count
 * into a database view and select from that instead.
 */
export async function fetchThreads(proId) {
  const { data, error } = await supabase
    .from('threads')
    .select(
      `id, created_at,
       member:profiles!threads_member_id_fkey ( id, full_name, avatar_url ),
       messages ( ${MESSAGE_COLUMNS} )`,
    )
    .eq('pro_id', proId)
    .retry(navigator.onLine)

  if (error) throw error

  return (data ?? [])
    .map(({ messages, ...thread }) => {
      // PostgREST does not order embedded rows, so sort here rather than
      // trusting insertion order.
      const ordered = [...(messages ?? [])].sort((a, b) =>
        a.created_at < b.created_at ? -1 : 1,
      )
      return {
        ...thread,
        lastMessage: ordered.at(-1) ?? null,
        // Unread means: sent by the other party and never marked read.
        unreadCount: ordered.filter((m) => m.sender_id !== proId && m.read_at === null).length,
      }
    })
    // Most recently active first; a thread with no messages yet sorts last.
    .sort((a, b) => {
      const at = a.lastMessage?.created_at ?? ''
      const bt = b.lastMessage?.created_at ?? ''
      return at < bt ? 1 : -1
    })
}

/** One conversation, oldest first, which is the order it is rendered in. */
export async function fetchMessages(threadId) {
  const { data, error } = await supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('thread_id', threadId)
    .order('created_at')
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/**
 * How many messages are waiting for this user, across every thread they are in.
 *
 * RLS already scopes `messages` to threads the caller belongs to, so no join is
 * needed here -- "not sent by me and not yet read" is the whole condition.
 */
export async function fetchUnreadCount(userId) {
  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .neq('sender_id', userId)
    .is('read_at', null)
    .retry(navigator.onLine)

  if (error) throw error
  return count ?? 0
}

/**
 * Send one message.
 *
 * The caller supplies `id`.  `messages.id` has no database default precisely so
 * this can be an upsert that ignores duplicates: a send that pauses offline is
 * replayed on reconnect, and a plain insert would fail that replay with a
 * primary-key violation the user would read as a lost message.
 *
 * `created_at` is left to the column default on purpose, unlike `set_logs`: a
 * message's meaningful time is when it reached the other person, and a chat
 * that reorders itself around a phone's clock is worse than one that stamps a
 * queued message late.
 */
export async function sendMessage({ id, threadId, senderId, body }) {
  const { data, error } = await supabase
    .from('messages')
    .upsert(
      { id, thread_id: threadId, sender_id: senderId, body },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select(MESSAGE_COLUMNS)
    .maybeSingle()

  if (error) throw error
  // `ignoreDuplicates` returns no row on a replay.  That is success.
  return data
}

/**
 * Mark everything the other party sent in this thread as read.
 *
 * Idempotent by construction: rows already carrying a `read_at` are excluded by
 * the filter, so a replay updates nothing.
 */
export async function markThreadRead({ threadId, readerId }) {
  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('thread_id', threadId)
    .neq('sender_id', readerId)
    .is('read_at', null)

  if (error) throw error
}
```

- [ ] **Step 4: Register the writes**

Add the imports and registrations to `src/data/mutations.js`:

```js
import { markThreadRead, sendMessage } from './chat.js'
```

```js
  queryClient.setMutationDefaults(mutationKeys.sendMessage, {
    mutationFn: sendMessage,
    // Serialise replays.  Messages are the one thing in this app whose ORDER is
    // the content: two queued sends replayed in parallel can land out of order
    // and the conversation reads wrong.
    scope: { id: 'chat' },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.chat })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.markThreadRead, {
    mutationFn: markThreadRead,
    scope: { id: 'chat' },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.chat })
    },
  })
```

- [ ] **Step 5: Write the Realtime hook**

Create `src/features/chat/useThreadMessages.js`:

```js
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase.js'
import { fetchMessages } from '../../data/chat.js'
import { queryKeys, queryPrefixes } from '../../lib/queryKeys.js'

/**
 * One thread's messages, kept live.
 *
 * The query is the source of truth; Realtime only pushes new rows into it. That
 * keeps every existing guarantee -- the persisted cache, the offline gate, the
 * `data === undefined` error rule -- and makes the socket an optimisation
 * rather than a second, divergent data path. If the subscription never fires,
 * the screen still works; it just stops updating on its own.
 *
 * @param {?string} threadId Null until the thread is known.
 */
export function useThreadMessages(threadId) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: queryKeys.threadMessages(threadId),
    queryFn: () => fetchMessages(threadId),
    enabled: Boolean(threadId),
  })

  useEffect(() => {
    if (!threadId) return

    const channel = supabase
      .channel(`messages:${threadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          queryClient.setQueryData(queryKeys.threadMessages(threadId), (current) => {
            // Undefined means the first fetch has not landed; there is nothing
            // to append to, and the fetch will include this row anyway.
            if (!current) return current
            // The sender already has this row from its own optimistic insert,
            // and Realtime re-delivers on reconnect. Both make duplicates
            // possible, and a duplicated message is a visible bug.
            if (current.some((message) => message.id === payload.new.id)) return current
            return [...current, payload.new]
          })
          // The inbox row, its unread badge and the header bell all count
          // messages. Invalidate the whole family through the prefix rather
          // than naming each key: prefix matching cannot be defeated by a
          // caller that omits an id.
          queryClient.invalidateQueries({ queryKey: queryPrefixes.chat })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [threadId, queryClient])

  return query
}
```

Two things in that hook are load-bearing and easy to "simplify" wrongly:

- **The duplicate guard.** The sender already holds the row from its own insert, and Realtime re-delivers on reconnect. Both produce a second copy of a message the user can see, which is a visible bug rather than a silent one.
- **The `if (!current) return current` guard.** Appending to an undefined cache would fabricate a one-message conversation that the first real fetch then contradicts.

- [ ] **Step 6: Verify and hand off**

Run `npm run lint` (exit 0) and `npm run build` (must succeed).

This task ends with a human step; no agent has database credentials. Report:

> Run `supabase/patches/007-realtime-messages.sql` in the Supabase SQL editor. The
> final `select` must list `messages`. If it does not, chat will connect and stay
> silent — Realtime reports SUBSCRIBED for a table that is not on the publication.

- [ ] **Step 7: Commit**

```bash
git add supabase/patches/007-realtime-messages.sql src/data/chat.js src/features/chat/useThreadMessages.js src/lib/queryKeys.js src/lib/mutationKeys.js src/data/mutations.js
git commit -m "feat(chat): add the chat data layer and realtime subscription"
```

---

## Task 2: The conversation screen

**Files:**
- Create: `src/features/chat/MessageBubble.jsx`
- Create: `src/features/chat/MessageComposer.jsx`
- Create: `src/features/chat/ThreadScreen.jsx`
- Modify: `src/routes/index.jsx` (replace `/m/trainer/chat`)

**Interfaces:**
- Consumes: `useThreadMessages`, `ensureThread`, `fetchMemberThread`, `sendMessage`, `markThreadRead`, `useAuth`.
- Produces: `<MessageBubble message mine />`, `<MessageComposer onSend pending paused />`, and `ThreadScreen`, which serves **both** `/m/trainer/chat` and `/p/chat/:threadId`.

One screen for both roles. The only difference between a member's conversation and a professional's is which thread it opens and whom it names — the messages, the composer and the read receipts are identical, and two copies would drift.

- [ ] **Step 1: The bubble**

Create `src/features/chat/MessageBubble.jsx`:

```jsx
import { Box, Paper, Stack, Typography } from '@mui/material'
import DoneIcon from '@mui/icons-material/Done'
import DoneAllIcon from '@mui/icons-material/DoneAll'

/**
 * One message.
 *
 * @param {object}  props
 * @param {object}  props.message The row.
 * @param {boolean} props.mine    Written by the signed-in user.
 */
export default function MessageBubble({ message, mine }) {
  const time = new Date(message.created_at).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <Stack direction="row" justifyContent={mine ? 'flex-end' : 'flex-start'}>
      <Paper
        elevation={0}
        sx={{
          maxWidth: '80%',
          px: 2,
          py: 1.25,
          borderRadius: 3,
          // The sender's own messages take the brand colour; the other party's
          // stay on paper, so the two sides are distinguishable without reading.
          bgcolor: mine ? 'primary.main' : 'background.paper',
          color: mine ? 'primary.contrastText' : 'text.primary',
          border: mine ? 'none' : 1,
          borderColor: 'divider',
        }}
      >
        <Typography sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {message.body}
        </Typography>

        <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end" sx={{ mt: 0.5 }}>
          <Typography variant="body2" sx={{ opacity: 0.7 }}>
            {time}
          </Typography>
          {/* Only the sender is told whether their message was read; showing a
              receipt on the other party's message would be meaningless. MUI
              hides an SvgIcon from screen readers without titleAccess. */}
          {mine ? (
            <Box sx={{ display: 'flex', opacity: 0.8 }}>
              {message.read_at ? (
                <DoneAllIcon fontSize="small" titleAccess="Read" />
              ) : (
                <DoneIcon fontSize="small" titleAccess="Sent" />
              )}
            </Box>
          ) : null}
        </Stack>
      </Paper>
    </Stack>
  )
}
```

- [ ] **Step 2: The composer**

Create `src/features/chat/MessageComposer.jsx`:

```jsx
import { useState } from 'react'
import { Alert, IconButton, Stack, TextField } from '@mui/material'
import SendIcon from '@mui/icons-material/Send'

/**
 * The send box.
 *
 * @param {object}   props
 * @param {Function} props.onSend `(body) => void`
 * @param {boolean}  props.pending A send is in flight.
 * @param {boolean}  props.paused  The send is parked offline.
 * @param {?Error}   props.error   The last failure, if any.
 */
export default function MessageComposer({ onSend, pending, paused, error }) {
  const [body, setBody] = useState('')
  const empty = body.trim() === ''

  const submit = (event) => {
    event.preventDefault()
    if (empty) return
    onSend(body.trim())
    // Cleared immediately rather than on success: offline the mutation pauses
    // and never resolves, and a composer that will not clear until reconnect
    // makes the app feel broken in exactly the case it was built for. The
    // message is already queued and rendered.
    setBody('')
  }

  return (
    <Stack spacing={1}>
      {paused ? (
        <Alert severity="info">
          You are offline. This message is saved on your device and will be sent when you reconnect.
        </Alert>
      ) : null}
      {error ? (
        <Alert severity="error">{error.message ?? 'The message could not be sent.'}</Alert>
      ) : null}

      <Stack component="form" direction="row" spacing={1} onSubmit={submit}>
        <TextField
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write a message…"
          aria-label="Message"
          fullWidth
          multiline
          maxRows={4}
        />
        {/* Not disabled while pending: offline a mutation stays pending until it
            reconnects, and blocking the second message would be the same trap
            the log-set sheet hit in Phase 2. */}
        <IconButton type="submit" color="primary" disabled={empty} aria-label="Send message">
          <SendIcon />
        </IconButton>
      </Stack>
    </Stack>
  )
}
```

- [ ] **Step 3: The screen**

Create `src/features/chat/ThreadScreen.jsx`:

```jsx
import { useEffect, useRef } from 'react'
import { Avatar, Box, Stack, Typography } from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { ensureThread, fetchMemberThread } from '../../data/chat.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'
import MessageBubble from './MessageBubble.jsx'
import MessageComposer from './MessageComposer.jsx'
import { useThreadMessages } from './useThreadMessages.js'

/**
 * One conversation.
 *
 * Serves both roles. A member has exactly one thread — with their assigned
 * professional — so theirs is looked up by member id and created on first use;
 * a professional arrives from the inbox with the thread id already in the URL.
 */
export default function ThreadScreen() {
  const { threadId: threadIdParam } = useParams()
  const { user, profile } = useAuth()
  const isMember = profile?.role === 'member'

  // Only the member needs the lookup; the professional already has the id.
  const memberThread = useQuery({
    queryKey: queryKeys.memberThread(user.id),
    queryFn: () => fetchMemberThread(user.id),
    enabled: isMember,
  })

  const threadId = isMember ? (memberThread.data?.id ?? null) : threadIdParam

  const messages = useThreadMessages(threadId)
  const send = useMutation({ mutationKey: mutationKeys.sendMessage })
  const markRead = useMutation({ mutationKey: mutationKeys.markThreadRead })
  const createThread = useMutation({ mutationFn: ensureThread })

  // Mark the other party's messages read once, when the thread is opened and
  // something is actually unread. Guarded on the id so re-renders and the
  // Realtime pushes that follow do not fire a write per message.
  const markedFor = useRef(null)
  useEffect(() => {
    if (!threadId || markedFor.current === threadId) return
    if (!messages.data?.some((m) => m.sender_id !== user.id && m.read_at === null)) return
    markedFor.current = threadId
    markRead.mutate({ threadId, readerId: user.id })
  }, [threadId, messages.data, user.id, markRead])

  // A member whose professional has never messaged them has no thread row yet.
  // Create it on first open so the composer has somewhere to write.
  useEffect(() => {
    if (!isMember) return
    if (memberThread.isPending || memberThread.data || !profile?.assigned_pro_id) return
    if (createThread.isPending || createThread.isSuccess) return
    createThread.mutate(
      { memberId: user.id, proId: profile.assigned_pro_id },
      { onSuccess: () => memberThread.refetch() },
    )
  }, [isMember, memberThread, profile?.assigned_pro_id, user.id, createThread])

  if (isMember && memberThread.isPending) return <LoadingState />
  if (isMember && memberThread.isError && memberThread.data === undefined) {
    return <ErrorState error={memberThread.error} onRetry={memberThread.refetch} />
  }

  // A member with no professional has nobody to talk to. That is a real state,
  // and the fix is a route, not an error.
  if (isMember && !profile?.assigned_pro_id) {
    return (
      <EmptyState
        title="No trainer yet"
        description="Choose a professional from the Trainer tab and you can message them here."
      />
    )
  }

  const other = isMember ? memberThread.data?.pro : null

  return (
    <Stack sx={{ height: '100%', p: 2 }} spacing={2}>
      {other ? (
        <Stack direction="row" spacing={2} alignItems="center">
          <Avatar src={other.avatar_url ?? undefined}>{other.full_name?.[0] ?? '?'}</Avatar>
          <Typography variant="h1" sx={{ fontSize: '1.5rem' }}>
            {other.full_name}
          </Typography>
        </Stack>
      ) : (
        <Typography variant="h1">Chat</Typography>
      )}

      {messages.isPending ? <LoadingState /> : null}
      {messages.isError && messages.data === undefined ? (
        <ErrorState error={messages.error} onRetry={messages.refetch} />
      ) : null}
      {messages.data?.length === 0 ? (
        <EmptyState title="No messages yet" description="Say hello." />
      ) : null}

      <Stack spacing={1.5} sx={{ flexGrow: 1 }}>
        {(messages.data ?? []).map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            mine={message.sender_id === user.id}
          />
        ))}
      </Stack>

      <Box sx={{ position: 'sticky', bottom: 0, bgcolor: 'background.default', pt: 1 }}>
        <MessageComposer
          pending={send.isPending}
          paused={send.isPending && send.isPaused}
          error={send.error}
          onSend={(body) =>
            send.mutate({
              // Generated here, in the handler: this write can pause offline and
              // replay, and the id is what makes the replay a no-op instead of a
              // second message. A render-time call would be impure and would
              // defeat it.
              id: crypto.randomUUID(),
              threadId,
              senderId: user.id,
              body,
            })
          }
        />
      </Box>
    </Stack>
  )
}
```

- [ ] **Step 4: Wire the route**

In `src/routes/index.jsx`, replace `{ path: 'trainer/chat', ...screen('Chat') }`:

```jsx
      {
        path: 'trainer/chat',
        lazy: async () => ({ Component: (await import('../features/chat/ThreadScreen.jsx')).default }),
      },
```

- [ ] **Step 5: Verify**

`npm run lint` (exit 0), `npm run build` (succeeds).

In the browser as Daniel, open `/m/trainer/chat`: the three seeded messages appear, Coach Andrea's on the left and Daniel's on the right, with a single tick on his own. Send one — it appears immediately. Then sign in as Coach Andrea in a second browser profile and confirm the message arrives **without a reload**; that is the Realtime path and it is the only way to prove patch 007 landed.

- [ ] **Step 6: Commit**

```bash
git add src/features/chat src/routes/index.jsx
git commit -m "feat(chat): add the conversation screen"
```

---

## Task 3: The professional's inbox

**Files:**
- Create: `src/features/chat/ThreadListScreen.jsx`
- Modify: `src/routes/index.jsx` (replace `/p/chat` and `/p/chat/:threadId`)

**Interfaces:**
- Consumes: `fetchThreads`, `queryKeys.threads`.
- Produces: the `/p/chat` screen. `/p/chat/:threadId` renders the `ThreadScreen` built in Task 2.

Mirrors `pt/07 - Chat.png`: a search field, an **All / To Read** filter, then one row per client showing the last message, its time, and an unread badge.

- [ ] **Step 1: Write the screen**

Create `src/features/chat/ThreadListScreen.jsx`:

```jsx
import { useState } from 'react'
import {
  Avatar, Badge, Card, CardActionArea, CardContent, Chip, InputAdornment, Stack, TextField, Typography,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { fetchThreads } from '../../data/chat.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

export default function ThreadListScreen() {
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)

  const threads = useQuery({
    queryKey: queryKeys.threads(user.id),
    queryFn: () => fetchThreads(user.id),
  })

  const term = search.trim().toLowerCase()
  const visible = (threads.data ?? []).filter((thread) => {
    if (unreadOnly && thread.unreadCount === 0) return false
    if (term === '') return true
    return thread.member?.full_name?.toLowerCase().includes(term)
  })

  const unreadTotal = (threads.data ?? []).reduce((sum, t) => sum + t.unreadCount, 0)

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="h1">Chat</Typography>

      <TextField
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search…"
        // A placeholder is not an accessible name: it vanishes as soon as
        // anything is typed and some readers never announce it.
        aria-label="Search conversations"
        fullWidth
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          },
        }}
      />

      <Stack direction="row" spacing={1}>
        <Chip
          label="All"
          color={unreadOnly ? 'default' : 'primary'}
          onClick={() => setUnreadOnly(false)}
          aria-pressed={!unreadOnly}
        />
        <Chip
          label={unreadTotal > 0 ? `To Read ${unreadTotal}` : 'To Read'}
          color={unreadOnly ? 'primary' : 'default'}
          onClick={() => setUnreadOnly(true)}
          aria-pressed={unreadOnly}
        />
      </Stack>

      {threads.isPending ? <LoadingState /> : null}
      {threads.isError && threads.data === undefined ? (
        <ErrorState error={threads.error} onRetry={threads.refetch} />
      ) : null}

      {/* Three different nothings. Telling a professional they have no
          conversations because they filtered to unread would be a lie. */}
      {threads.data?.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          description="Threads with your clients appear here."
        />
      ) : null}
      {threads.data?.length > 0 && visible.length === 0 ? (
        <EmptyState
          title={unreadOnly ? 'Nothing unread' : 'No match'}
          description={
            unreadOnly
              ? 'Every conversation is up to date.'
              : `No client's name contains "${search.trim()}".`
          }
        />
      ) : null}

      <Stack spacing={2}>
        {visible.map((thread) => (
          <Card key={thread.id}>
            <CardActionArea component={Link} to={`/p/chat/${thread.id}`}>
              <CardContent>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Badge badgeContent={thread.unreadCount} color="primary">
                    <Avatar src={thread.member?.avatar_url ?? undefined}>
                      {thread.member?.full_name?.[0] ?? '?'}
                    </Avatar>
                  </Badge>

                  <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="h3" noWrap>
                      {thread.member?.full_name ?? 'Unknown client'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {thread.lastMessage?.body ?? 'No messages yet'}
                    </Typography>
                  </Stack>

                  {thread.lastMessage ? (
                    <Typography variant="body2" color="text.secondary">
                      {new Date(thread.lastMessage.created_at).toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Typography>
                  ) : null}
                </Stack>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Stack>
    </Stack>
  )
}
```

- [ ] **Step 2: Wire both routes**

In `src/routes/index.jsx`, replace the two `/p/chat` placeholders:

```jsx
      {
        path: 'chat',
        lazy: async () => ({
          Component: (await import('../features/chat/ThreadListScreen.jsx')).default,
        }),
      },
      {
        path: 'chat/:threadId',
        lazy: async () => ({ Component: (await import('../features/chat/ThreadScreen.jsx')).default }),
      },
```

- [ ] **Step 3: Verify**

`npm run lint`, `npm run build`.

As Coach Andrea, open `/p/chat`: one row for Daniel with the last seeded message and an unread badge of 1 (Daniel's message is the only one he sent that is unread). Tap it — the conversation opens, the badge clears after the read receipt lands, and the **To Read** filter then shows "Nothing unread". Type `zzz` in the search to see the "No match" state rather than "No conversations yet".

- [ ] **Step 4: Commit**

```bash
git add src/features/chat/ThreadListScreen.jsx src/routes/index.jsx
git commit -m "feat(chat): add the professional's inbox"
```

---

## Task 4: The unread badge

**Files:**
- Modify: `src/components/TopHeader.jsx`, `src/layouts/AppLayout.jsx`

**Interfaces:**
- Consumes: `fetchUnreadCount`, `queryKeys.unreadCount`.
- Produces: nothing new; wires an existing prop.

`TopHeader` already takes `notificationCount` and already renders a `Badge` with it — **nothing has ever passed it**, so every wireframe's bell badge has been decorative since Phase 0. One query fills it.

- [ ] **Step 1: Query it in the layout**

In `src/layouts/AppLayout.jsx`, add the import and the query, and pass the result down. Place the `useQuery` **above** the early returns — a hook cannot be called conditionally, and the guards in this component return early.

```jsx
import { useQuery } from '@tanstack/react-query'
import { fetchUnreadCount } from '../data/chat.js'
import { queryKeys } from '../lib/queryKeys.js'
```

```jsx
  const unread = useQuery({
    queryKey: queryKeys.unreadCount(user?.id),
    queryFn: () => fetchUnreadCount(user.id),
    // Nothing to count until somebody is signed in.
    enabled: Boolean(user?.id),
  })
```

and in the returned shell:

```jsx
        <TopHeader profileHref={profileHref} notificationCount={unread.data ?? 0} />
```

- [ ] **Step 2: Fix the bell's accessible name**

`TopHeader` currently labels the button `${notificationCount} notifications`, which reads "0 notifications" and is a plural that is wrong at one. Replace it:

```jsx
        <IconButton
          aria-label={
            notificationCount === 0
              ? 'No unread messages'
              : `${notificationCount} unread message${notificationCount === 1 ? '' : 's'}`
          }
        >
```

- [ ] **Step 3: Verify**

`npm run lint`, `npm run build`.

As Coach Andrea the bell shows 1 before opening the chat and 0 after; as Daniel it shows 0 until Andrea sends something. The count is invalidated by `queryPrefixes.chat`, which both chat writes already fire.

- [ ] **Step 4: Commit**

```bash
git add src/components/TopHeader.jsx src/layouts/AppLayout.jsx
git commit -m "feat(chat): show the unread count in the header"
```

---

## Task 5: The member's nutrition plan

**Files:**
- Create: `src/features/nutrition/MemberNutritionScreen.jsx`, `src/features/nutrition/MealDetailScreen.jsx`
- Modify: `src/routes/index.jsx`

**Interfaces:**
- Consumes: `fetchNutritionPlan(memberId)` (built in Phase 3), `queryKeys.nutritionPlan`, `weekStrip`, `todayISO`, `localDayISO`.
- Produces: the two `/m/nutrition` screens. No new data functions — the professional's editor and the member's view read the same thing.

Mirrors `03 - Nutrition.png`: the green macro summary, a week strip, then a card per meal. `03B -Nutrition.png` is the empty state, and it is a real screen rather than a footnote: a member whose trainer has not written a plan sees "you haven't a Nutrition Plan yet" and a button that takes them to booking.

The week strip is **decorative here**: `meals` are a daily template with no date column, so every day shows the same plan. It is rendered because the wireframe does, and the selected day drives nothing — say so in a comment rather than wiring a filter that would silently do nothing.

- [ ] **Step 1: The plan screen**

Create `src/features/nutrition/MemberNutritionScreen.jsx`:

```jsx
import { useState } from 'react'
import { Box, Button, Card, CardActionArea, CardContent, Divider, Stack, Typography } from '@mui/material'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { fetchNutritionPlan } from '../../data/nutrition.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { todayISO } from '../../lib/format.js'
import { weekStrip } from '../calendar/month.js'
import WeekStrip from '../../components/WeekStrip.jsx'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

/** One macro figure under the calorie target. */
function Macro({ label, grams }) {
  return (
    <Stack alignItems="center" sx={{ flexGrow: 1 }}>
      <Typography variant="h3" component="p">
        {grams ?? '—'}
        {grams == null ? '' : 'g'}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  )
}

export default function MemberNutritionScreen() {
  const { user } = useAuth()
  // Decorative: `meals` is a daily template with no date column, so every day
  // shows the same plan. The strip is drawn because the wireframe draws it; the
  // selection deliberately drives nothing rather than pretending to filter.
  const [selected, setSelected] = useState(todayISO())

  const nutrition = useQuery({
    queryKey: queryKeys.nutritionPlan(user.id),
    queryFn: () => fetchNutritionPlan(user.id),
  })

  if (nutrition.isPending) return <LoadingState />
  if (nutrition.isError && nutrition.data === undefined) {
    return <ErrorState error={nutrition.error} onRetry={nutrition.refetch} />
  }

  // `undefined` means not loaded; `null` means loaded and there is none. This
  // branch is the wireframe 03B, not a footnote.
  if (nutrition.data === null) {
    return (
      <Stack spacing={3} sx={{ p: 2 }}>
        <Typography variant="h1">Nutrition Plan</Typography>
        <Card>
          <CardContent>
            <Stack spacing={1} alignItems="center" sx={{ textAlign: 'center' }}>
              <Typography variant="h3" color="primary">
                You do not have a nutrition plan yet
              </Typography>
              <Typography color="text.secondary">
                Book an appointment with your professional and start your nutrition journey.
              </Typography>
            </Stack>
          </CardContent>
        </Card>
        <Button
          component={Link}
          to="/m/trainer/appointments"
          variant="contained"
          size="large"
          fullWidth
        >
          Book Appointment
        </Button>
      </Stack>
    )
  }

  const { plan, meals } = nutrition.data

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h1">Nutrition Plan</Typography>

      <Card sx={{ bgcolor: 'task.nutrition', border: 'none' }}>
        <CardContent>
          <Stack spacing={1} alignItems="center">
            <Typography variant="h2" component="p">
              {plan.name}
            </Typography>
            <Typography variant="h2" component="p">
              {plan.kcal_target ?? '—'} kcal
            </Typography>
            <Divider flexItem />
            <Stack direction="row" sx={{ width: '100%', pt: 1 }}>
              <Macro label="Proteins" grams={plan.protein_g} />
              <Macro label="Carbs" grams={plan.carbs_g} />
              <Macro label="Fats" grams={plan.fat_g} />
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Your Week
        </Typography>
        <WeekStrip days={weekStrip(selected)} selected={selected} onSelect={setSelected} />
      </Box>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Daily Meals
        </Typography>

        <Stack spacing={2}>
          {meals.map((meal) => (
            <Card key={meal.id}>
              <CardActionArea component={Link} to={`/m/nutrition/meal/${meal.id}`}>
                <CardContent>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Typography variant="h3" noWrap>
                        {meal.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {String(meal.time_of_day).slice(0, 5)}
                        {meal.kcal == null ? '' : ` • ${meal.kcal} kcal`}
                      </Typography>
                    </Stack>
                    <ChevronRightIcon color="primary" />
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
      </Box>
    </Stack>
  )
}
```

- [ ] **Step 2: The meal screen**

Create `src/features/nutrition/MealDetailScreen.jsx`. It reads the member's plan and picks the meal out of it rather than adding a `fetchMeal` — the plan is already in the cache from the screen the user just came from, so this costs no request.

```jsx
import { Card, CardContent, Divider, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { fetchNutritionPlan } from '../../data/nutrition.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

export default function MealDetailScreen() {
  const { mealId } = useParams()
  const { user } = useAuth()

  // Reuses the plan query rather than adding a per-meal read: the member came
  // from the plan screen, so this is served from cache and works offline.
  const nutrition = useQuery({
    queryKey: queryKeys.nutritionPlan(user.id),
    queryFn: () => fetchNutritionPlan(user.id),
  })

  if (nutrition.isPending) return <LoadingState />
  if (nutrition.isError && nutrition.data === undefined) {
    return <ErrorState error={nutrition.error} onRetry={nutrition.refetch} />
  }

  const meal = nutrition.data?.meals.find((m) => m.id === mealId)

  // A meal id that is not in the plan means it was deleted, or the URL was
  // typed. Either way this is an empty state, not a crash.
  if (!meal) {
    return (
      <EmptyState
        title="Meal not found"
        description="This meal is no longer part of your plan."
      />
    )
  }

  const items = Array.isArray(meal.items) ? meal.items : []

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Stack spacing={0.5}>
        <Typography variant="h1">{meal.name}</Typography>
        <Typography color="text.secondary">
          {String(meal.time_of_day).slice(0, 5)}
          {meal.kcal == null ? '' : ` • ${meal.kcal} kcal`}
        </Typography>
      </Stack>

      <Card>
        <CardContent>
          {items.length === 0 ? (
            <Typography color="text.secondary">
              Your professional has not listed the items for this meal yet.
            </Typography>
          ) : (
            <Stack divider={<Divider />} spacing={1.5}>
              {items.map((item, index) => (
                <Stack key={index} direction="row" spacing={2} alignItems="baseline">
                  <Typography sx={{ flexGrow: 1 }}>{item.food}</Typography>
                  <Typography color="text.secondary">{item.qty}</Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>
    </Stack>
  )
}
```

- [ ] **Step 3: Wire the routes**

```jsx
      {
        path: 'nutrition',
        lazy: async () => ({
          Component: (await import('../features/nutrition/MemberNutritionScreen.jsx')).default,
        }),
      },
      {
        path: 'nutrition/meal/:mealId',
        lazy: async () => ({
          Component: (await import('../features/nutrition/MealDetailScreen.jsx')).default,
        }),
      },
```

- [ ] **Step 4: Verify and commit**

`npm run lint`, `npm run build`. As Daniel, `/m/nutrition` shows "Lean Bulk", 2600 kcal, the three macros and four meal cards; tapping Breakfast lists Oats / Whey / Banana with quantities. To see the 03B empty branch, open it as a client with no nutrition plan.

```bash
git add src/features/nutrition src/routes/index.jsx
git commit -m "feat(member): add the nutrition plan and meal screens"
```

---

## Task 6: The trainer section

**Files:**
- Create: `src/data/profile.js`, `src/features/trainer/MyTrainerScreen.jsx`, `src/features/trainer/BrowseTrainersScreen.jsx`
- Modify: `src/lib/mutationKeys.js` *(key added in Task 1)*, `src/data/mutations.js`, `src/routes/index.jsx`

**Interfaces:**
- Consumes: `useAuth`, `queryKeys.professionals`.
- Produces:
  - `fetchProfessionals() -> Array<{id, full_name, avatar_url, bio, specialty}>`
  - `chooseProfessional({memberId, proId}) -> row`
  - the `/m/trainer` and `/m/trainer/browse` screens.

`profiles_update_self` is what makes this possible: a member may update their own row, and `assigned_pro_id` is on it. A professional cannot do the reverse, which is why Phase 3 has no "add client".

- [ ] **Step 1: The data module**

Create `src/data/profile.js`:

```js
import { supabase } from '../lib/supabase.js'

/**
 * Every professional a member can choose from.
 *
 * `profiles_select_professionals` permits this for any signed-in user. Its
 * `auth.uid() is not null` guard is what keeps it from being public -- a policy
 * whose `using` clause never mentions the caller is readable by anyone holding
 * the publishable key, which ships in the bundle. Phase 0 shipped that hole.
 */
export async function fetchProfessionals() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, bio, specialty')
    .eq('role', 'professional')
    .order('full_name')
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/**
 * Assign a professional to the member.
 *
 * Scoped to the member's own row by `profiles_update_self`; passing anyone
 * else's id is rejected by the database, not by this function.
 */
export async function chooseProfessional({ memberId, proId }) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ assigned_pro_id: proId })
    .eq('id', memberId)
    .select('id, assigned_pro_id')
    .single()

  if (error) throw error
  return data
}
```

Register it in `src/data/mutations.js`:

```js
import { chooseProfessional } from './profile.js'
```

```js
  queryClient.setMutationDefaults(mutationKeys.chooseProfessional, {
    mutationFn: chooseProfessional,
    onSettled: () => {
      // A different professional means a different thread, so the whole chat
      // family is stale -- the member's thread lookup, its messages and the
      // unread badge.
      //
      // What this canNOT refresh is the member's own profile: AuthProvider
      // holds it outside the query cache, so `assigned_pro_id` in the shell
      // stays stale until the app reloads. The call site does that reload; see
      // the note there and in "Deferred beyond Phase 4".
      queryClient.invalidateQueries({ queryKey: queryPrefixes.chat })
    },
  })
```

- [ ] **Step 2: `/m/trainer`**

Create `src/features/trainer/MyTrainerScreen.jsx`:

```jsx
import { Avatar, Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useQuery } from '@tanstack/react-query'
import { Link, Navigate } from 'react-router'
import { fetchProfessionals } from '../../data/profile.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

export default function MyTrainerScreen() {
  const { profile } = useAuth()

  // Reuses the professionals list to name the assigned one: it is a handful of
  // rows, already cached by the browse screen, and it avoids a second read.
  const professionals = useQuery({
    queryKey: queryKeys.professionals(),
    queryFn: fetchProfessionals,
    enabled: Boolean(profile?.assigned_pro_id),
  })

  // No professional yet is not an empty state, it is a different screen.
  if (!profile?.assigned_pro_id) return <Navigate to="/m/trainer/browse" replace />

  if (professionals.isPending) return <LoadingState />
  if (professionals.isError && professionals.data === undefined) {
    return <ErrorState error={professionals.error} onRetry={professionals.refetch} />
  }

  const pro = professionals.data.find((p) => p.id === profile.assigned_pro_id)

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h1">Personal Trainer</Typography>

      <Stack spacing={1.5} alignItems="center" sx={{ textAlign: 'center' }}>
        <Avatar src={pro?.avatar_url ?? undefined} sx={{ width: 112, height: 112 }}>
          {pro?.full_name?.[0] ?? '?'}
        </Avatar>
        <Typography variant="h2" component="p">
          {pro?.full_name ?? 'Your professional'}
        </Typography>
        {pro?.bio ? (
          <Typography color="text.secondary" sx={{ maxWidth: 320 }}>
            {pro.bio}
          </Typography>
        ) : null}
      </Stack>

      <Stack spacing={2}>
        {/* No "Call": there is no phone number in the schema. */}
        <Card>
          <CardActionArea component={Link} to="/m/trainer/chat">
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="center">
                <ChatBubbleOutlineIcon color="primary" />
                <Typography variant="h3" sx={{ flexGrow: 1 }}>
                  Chat
                </Typography>
                <ChevronRightIcon color="primary" />
              </Stack>
            </CardContent>
          </CardActionArea>
        </Card>

        <Card>
          <CardActionArea component={Link} to="/m/trainer/appointments">
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="center">
                <CalendarMonthIcon color="primary" />
                <Typography variant="h3" sx={{ flexGrow: 1 }}>
                  View Appointments
                </Typography>
                <ChevronRightIcon color="primary" />
              </Stack>
            </CardContent>
          </CardActionArea>
        </Card>
      </Stack>
    </Stack>
  )
}
```

- [ ] **Step 3: `/m/trainer/browse`**

Create `src/features/trainer/BrowseTrainersScreen.jsx`:

```jsx
import { useState } from 'react'
import {
  Alert, Avatar, Card, CardContent, Chip, IconButton, InputAdornment, Stack, TextField, Typography,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import AddIcon from '@mui/icons-material/Add'
import CheckIcon from '@mui/icons-material/Check'
import { useMutation, useQuery } from '@tanstack/react-query'
import { fetchProfessionals } from '../../data/profile.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

// The wireframe's chips read "Weight Loss / Hypertrophy / Muscle Gain", which
// are training goals, not the `pro_specialty` enum. Filtering on something the
// database does not store would be a control that cannot work, so these are the
// real values. `both` matches either filter.
const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'personal_trainer', label: 'Personal Trainer' },
  { value: 'nutritionist', label: 'Nutritionist' },
]

export default function BrowseTrainersScreen() {
  const { user, profile } = useAuth()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')

  const professionals = useQuery({
    queryKey: queryKeys.professionals(),
    queryFn: fetchProfessionals,
  })

  const choose = useMutation({ mutationKey: mutationKeys.chooseProfessional })

  const term = search.trim().toLowerCase()
  const visible = (professionals.data ?? []).filter((pro) => {
    if (filter !== 'all' && pro.specialty !== filter && pro.specialty !== 'both') return false
    if (term === '') return true
    return pro.full_name?.toLowerCase().includes(term)
  })

  if (professionals.isPending) return <LoadingState />
  if (professionals.isError && professionals.data === undefined) {
    return <ErrorState error={professionals.error} onRetry={professionals.refetch} />
  }

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="h1">Personal Trainer</Typography>

      {!profile?.assigned_pro_id ? (
        <Card>
          <CardContent>
            <Stack spacing={1} alignItems="center" sx={{ textAlign: 'center' }}>
              <Typography variant="h3" color="primary">
                You have not selected a professional yet
              </Typography>
              <Typography color="text.secondary">
                Choose one of our certified coaches and start your fitness journey.
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      ) : null}

      <TextField
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search Trainer…"
        aria-label="Search professionals"
        fullWidth
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          },
        }}
      />

      <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', pb: 1 }}>
        {FILTERS.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            color={filter === option.value ? 'primary' : 'default'}
            onClick={() => setFilter(option.value)}
            aria-pressed={filter === option.value}
          />
        ))}
      </Stack>

      {choose.isError ? (
        <Alert severity="error">
          {choose.error?.message ?? 'Could not select this professional. Try again.'}
        </Alert>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          title="No match"
          description="No professional matches this search and filter."
        />
      ) : null}

      <Stack spacing={2}>
        {visible.map((pro) => {
          const current = pro.id === profile?.assigned_pro_id
          return (
            <Card key={pro.id}>
              <CardContent>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Avatar src={pro.avatar_url ?? undefined} sx={{ width: 48, height: 48 }}>
                    {pro.full_name?.[0] ?? '?'}
                  </Avatar>
                  <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="h3" noWrap>
                      {pro.full_name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {pro.bio ?? 'Certified professional'}
                    </Typography>
                  </Stack>

                  <IconButton
                    color="primary"
                    disabled={current || choose.isPending}
                    aria-label={current ? `${pro.full_name} is your professional` : `Choose ${pro.full_name}`}
                    onClick={() =>
                      choose.mutate(
                        { memberId: user.id, proId: pro.id },
                        {
                          // AuthProvider holds the profile outside the query
                          // cache, so invalidating would not refresh the role
                          // or the assignment the whole shell reads. A reload
                          // is the honest way to pick up a profile change until
                          // AuthProvider exposes a refresh.
                          onSuccess: () => window.location.assign('/m/trainer'),
                        },
                      )
                    }
                  >
                    {current ? <CheckIcon /> : <AddIcon />}
                  </IconButton>
                </Stack>
              </CardContent>
            </Card>
          )
        })}
      </Stack>
    </Stack>
  )
}
```

- [ ] **Step 4: Wire the routes, verify, commit**

```jsx
      {
        path: 'trainer',
        lazy: async () => ({
          Component: (await import('../features/trainer/MyTrainerScreen.jsx')).default,
        }),
      },
      {
        path: 'trainer/browse',
        lazy: async () => ({
          Component: (await import('../features/trainer/BrowseTrainersScreen.jsx')).default,
        }),
      },
```

`npm run lint`, `npm run build`. As Daniel, `/m/trainer` names Coach Andrea with her bio and two cards. To exercise the browse path, clear `assigned_pro_id` for Daniel in the SQL editor (`update profiles set assigned_pro_id = null where full_name = 'Daniel Aresta';`), reload — `/m/trainer` redirects to browse — pick Andrea, and confirm the app returns to `/m/trainer` with her assigned. **Put it back if you clear it**, since Phase 1–3 screens depend on the link.

```bash
git add src/data/profile.js src/features/trainer src/data/mutations.js src/routes/index.jsx
git commit -m "feat(member): add the trainer section and professional picker"
```

---

## Task 7: Member appointments and booking

**Files:**
- Create: `src/features/trainer/MemberAppointmentsScreen.jsx`, `src/features/trainer/BookingSheet.jsx`
- Modify: `src/routes/index.jsx`

**Interfaces:**
- Consumes: `fetchAppointmentsInRange` **is the professional's** — this screen needs the member's, so it uses `fetchAppointmentsOnDay`'s sibling shape. Add `fetchMemberAppointmentsInRange(memberId, fromISO, toISO)` to `src/data/appointments.js`, mirroring the professional's function but filtering on `member_id` and embedding the **professional**.
- Produces: `/m/trainer/appointments`, and a member-side `BookingSheet`.

Mirrors `04C - PT.png`: a month grid with per-day dots, the selected day's appointments, and a "Book for today" card that opens the sheet. The sheet mirrors `Modal/BookingSheet.png`, in English.

**The one rule the professional's sheet does not have:** a member books **their own** professional, so there is no client picker and `pro_id` comes from `profile.assigned_pro_id`. A member with none cannot book, and the screen says so rather than showing a dead form.

- [ ] **Step 1: The member's range read**

Append to `src/data/appointments.js`:

```js
// The member's side of the range query. Same bounds arithmetic as the
// professional's; the filter and the embed are the other way round.
const MEMBER_AGENDA_COLUMNS =
  'id, kind, status, starts_at, ends_at, notes, pro:profiles!appointments_pro_id_fkey ( id, full_name, avatar_url )'

export async function fetchMemberAppointmentsInRange(memberId, fromISO, toISO) {
  const [fy, fm, fd] = fromISO.split('-').map(Number)
  const [ty, tm, td] = toISO.split('-').map(Number)
  const from = new Date(fy, fm - 1, fd, 0, 0, 0, 0)
  // One day past the end, so the last day's appointments are included.
  const to = new Date(ty, tm - 1, td + 1, 0, 0, 0, 0)

  const { data, error } = await supabase
    .from('appointments')
    .select(MEMBER_AGENDA_COLUMNS)
    .eq('member_id', memberId)
    .gte('starts_at', from.toISOString())
    .lt('starts_at', to.toISOString())
    .order('starts_at')
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}
```

- [ ] **Step 2: The booking sheet**

Create `src/features/trainer/BookingSheet.jsx`. Read `src/features/calendar/NewAppointmentSheet.jsx` first — this is the same shape with the client picker removed, and it must carry the same closed→open reset, which is the defect Phase 3 shipped and had to fix.

```jsx
import { useState } from 'react'
import { Alert, Button, Drawer, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { useAuth } from '../auth/useAuth.js'

const KINDS = [
  { value: 'training', label: 'Personal Training' },
  { value: 'protocol', label: 'Protocol Consultation' },
  { value: 'nutrition', label: 'Nutrition Consultation' },
]

const DURATIONS = [30, 45, 60, 90, 120]

/** `'2026-07-29'` + `'14:00'` + 60 → two ISO timestamps in the local zone. */
function slotToISO(dayISO, timeHHMM, minutes) {
  const [year, month, day] = dayISO.split('-').map(Number)
  const [hour, minute] = timeHHMM.split(':').map(Number)
  // Built from local parts so "14:00" means the member's two o'clock.
  const start = new Date(year, month - 1, day, hour, minute, 0, 0)
  const end = new Date(start.getTime() + minutes * 60_000)
  return { startsAt: start.toISOString(), endsAt: end.toISOString() }
}

export default function BookingSheet({ open, onClose, defaultDayISO }) {
  const { user, profile } = useAuth()

  const [kind, setKind] = useState('training')
  const [day, setDay] = useState(defaultDayISO)
  const [time, setTime] = useState('09:00')
  const [minutes, setMinutes] = useState(60)
  const [notes, setNotes] = useState('')

  // The sheet is rendered whether open or not -- only the Drawer's `open`
  // toggles visibility -- so it never unmounts and useState's initialiser runs
  // exactly once. Without this reset the date silently keeps whatever day was
  // selected on first mount, and the form keeps the previous booking's values.
  // Compared during render rather than in an effect: on the render where `open`
  // flips, an effect fires in the same commit with stale state.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setKind('training')
      setDay(defaultDayISO)
      setTime('09:00')
      setMinutes(60)
      setNotes('')
    }
  }

  const create = useMutation({ mutationKey: mutationKeys.createAppointment })
  const savedOffline = create.isPending && create.isPaused

  const onSubmit = (event) => {
    event.preventDefault()
    const { startsAt, endsAt } = slotToISO(day, time, Number(minutes))

    create.mutate(
      {
        // Generated in the handler, not during render: this write can pause
        // offline and replay, and the id is what makes the replay a no-op
        // instead of a second booking.
        id: crypto.randomUUID(),
        memberId: user.id,
        proId: profile.assigned_pro_id,
        kind,
        // A member requests; the professional confirms. The professional's own
        // sheet books straight to 'confirmed' because they own the diary.
        status: 'pending',
        startsAt,
        endsAt,
        notes,
      },
      { onSuccess: () => onClose() },
    )
  }

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-labelledby': 'new-booking-title',
          sx: { borderTopLeftRadius: 24, borderTopRightRadius: 24, p: 2 },
        },
      }}
    >
      <Stack component="form" spacing={2} onSubmit={onSubmit}>
        <Typography id="new-booking-title" variant="h2">
          New Booking
        </Typography>

        <TextField
          select
          label="Type"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          fullWidth
        >
          {KINDS.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>

        <Stack direction="row" spacing={1}>
          {/* Native date and time inputs: the platform already ships a correct,
              accessible, locale-aware picker on every device this runs on. */}
          <TextField
            label="Date"
            type="date"
            value={day}
            onChange={(event) => setDay(event.target.value)}
            required
            sx={{ flexGrow: 1 }}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="Start"
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            required
            sx={{ width: 130 }}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Stack>

        <TextField
          select
          label="Duration"
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
          fullWidth
        >
          {DURATIONS.map((option) => (
            <MenuItem key={option} value={option}>
              {option} minutes
            </MenuItem>
          ))}
        </TextField>

        <TextField
          label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Focus on core and mobility"
          multiline
          minRows={2}
          fullWidth
        />

        {savedOffline ? (
          <Alert severity="info">
            You are offline. This request is saved on your device and will be sent when you
            reconnect.
          </Alert>
        ) : null}
        {create.isError ? (
          <Alert severity="error">
            {create.error?.message ?? 'The appointment could not be requested.'}
          </Alert>
        ) : null}

        <Button type="submit" variant="contained" size="large" fullWidth disabled={create.isPending}>
          {savedOffline ? 'Saved offline' : create.isPending ? 'Requesting…' : 'Confirm booking'}
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </Stack>
    </Drawer>
  )
}
```

- [ ] **Step 3: The appointments screen**

Create `src/features/trainer/MemberAppointmentsScreen.jsx`:

```jsx
import { useState } from 'react'
import { Box, Card, CardActionArea, CardContent, IconButton, Stack, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useQuery } from '@tanstack/react-query'
import { fetchMemberAppointmentsInRange } from '../../data/appointments.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { formatDate, todayISO } from '../../lib/format.js'
import AppointmentCard from '../../components/AppointmentCard.jsx'
import MonthGrid from '../../components/MonthGrid.jsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'
import { monthGrid, monthLabel, shiftMonth } from '../calendar/month.js'
import BookingSheet from './BookingSheet.jsx'

export default function MemberAppointmentsScreen() {
  const { user, profile } = useAuth()
  const [selected, setSelected] = useState(todayISO())
  const [booking, setBooking] = useState(false)

  // The visible month follows the selected day, so tapping a padding cell moves
  // the grid to the month that day belongs to without any extra state.
  const [year, month] = selected.split('-').map(Number)
  const cells = monthGrid(year, month)
  const rangeFrom = cells[0].dateISO
  const rangeTo = cells.at(-1).dateISO

  const appointments = useQuery({
    queryKey: queryKeys.memberAppointments(user.id, rangeFrom, rangeTo),
    queryFn: () => fetchMemberAppointmentsInRange(user.id, rangeFrom, rangeTo),
  })

  // `toLocaleDateString('sv-SE')` is ISO 8601 formatting of the LOCAL day.
  // `toISOString().slice(0,10)` would give the UTC day and put a late-evening
  // appointment on the wrong date east of Greenwich.
  const dayOf = (appointment) => new Date(appointment.starts_at).toLocaleDateString('sv-SE')

  const markers = {}
  for (const appointment of appointments.data ?? []) {
    const key = dayOf(appointment)
    if (!markers[key]) markers[key] = appointment.kind
  }

  const onDay = (appointments.data ?? []).filter((a) => dayOf(a) === selected)

  const step = (delta) => {
    const next = shiftMonth(year, month, delta)
    const lastDay = monthGrid(next.year, next.month).filter((cell) => cell.inMonth).at(-1)
    const [, , day] = selected.split('-').map(Number)
    // Keep the day of the month where it exists and clamp where it does not:
    // stepping back from 31 March must land on 28 February, not 3 March.
    const target = Math.min(day, lastDay.day)
    setSelected(
      `${next.year}-${String(next.month).padStart(2, '0')}-${String(target).padStart(2, '0')}`,
    )
  }

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="h1" sx={{ minWidth: 0 }} noWrap>
          {monthLabel(year, month)}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <IconButton onClick={() => step(-1)} aria-label="Previous month">
          <ChevronLeftIcon color="primary" />
        </IconButton>
        <IconButton onClick={() => step(1)} aria-label="Next month">
          <ChevronRightIcon color="primary" />
        </IconButton>
      </Stack>

      <MonthGrid cells={cells} selected={selected} onSelect={setSelected} markers={markers} />

      <Stack direction="row" spacing={1} alignItems="baseline">
        <Typography variant="h2">
          {selected === todayISO() ? 'Today' : formatDate(selected)}
        </Typography>
        {appointments.data ? (
          <Typography variant="h3" component="span" color="text.secondary">
            • {onDay.length} activities
          </Typography>
        ) : null}
      </Stack>

      {appointments.isPending ? <LoadingState /> : null}
      {appointments.isError && appointments.data === undefined ? (
        <ErrorState error={appointments.error} onRetry={appointments.refetch} />
      ) : null}
      {appointments.data && onDay.length === 0 ? (
        <EmptyState title="Nothing booked" description="This day is free." />
      ) : null}

      <Stack spacing={2}>
        {onDay.map((appointment) => (
          <AppointmentCard key={appointment.id} appointment={appointment} person={appointment.pro} />
        ))}
      </Stack>

      {/* A member with no professional has nobody to book with. Say so rather
          than opening a form whose write the database would reject. */}
      {profile?.assigned_pro_id ? (
        <Card sx={{ borderColor: 'primary.main' }}>
          <CardActionArea onClick={() => setBooking(true)}>
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="center">
                <AddIcon color="primary" />
                <Stack>
                  <Typography variant="h3">Book for this day</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Workout or consultation
                  </Typography>
                </Stack>
              </Stack>
            </CardContent>
          </CardActionArea>
        </Card>
      ) : (
        <EmptyState
          title="No professional yet"
          description="Choose one from the Trainer tab before booking."
        />
      )}

      <BookingSheet
        open={booking}
        onClose={() => setBooking(false)}
        defaultDayISO={selected}
      />
    </Stack>
  )
}
```

- [ ] **Step 4: Wire, verify, commit**

```jsx
      {
        path: 'trainer/appointments',
        lazy: async () => ({
          Component: (await import('../features/trainer/MemberAppointmentsScreen.jsx')).default,
        }),
      },
```

`npm run lint`, `npm run build`. As Daniel, `/m/trainer/appointments` shows the month with dots on the seeded days. Select a day, tap the booking card, request a 60-minute training — it appears in the list as "Not confirmed yet", and Coach Andrea sees it on `/p` and `/p/calendar` with Confirm available. **Step from 31 March back a month** and confirm the selection lands on 28 February.

```bash
git add src/data/appointments.js src/features/trainer src/routes/index.jsx
git commit -m "feat(member): add appointments and booking"
```

---

## Task 8: Profile and subscription

**Files:**
- Create: `src/features/profile/ProfileScreen.jsx`, `src/features/profile/SubscriptionScreen.jsx`
- Modify: `src/routes/index.jsx`

**Interfaces:**
- Consumes: `useAuth`, `subscriptionStateOf`, `formatDate`, `todayISO`.
- Produces: `/m/profile`, `/p/profile`, `/m/profile/subscription`. No new reads — `useAuth().profile` already holds everything both screens show.

One `ProfileScreen` for both roles, differing only in its link list. Mirrors `gym_member/05 -Profile.png` and `pt/11 - Profile.png`.

Per the deviations list, there is **no Edit Profile form**: the screen displays `full_name`, the email from the session, and the membership links.

- [ ] **Step 1: The profile screen**

Create `src/features/profile/ProfileScreen.jsx`:

```jsx
import { Avatar, Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import QrCode2Icon from '@mui/icons-material/QrCode2'
import InfoOutlineIcon from '@mui/icons-material/InfoOutlined'
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents'
import SettingsIcon from '@mui/icons-material/Settings'
import { Link } from 'react-router'
import { useAuth } from '../auth/useAuth.js'

function Row({ icon, label, to }) {
  return (
    <Card>
      <CardActionArea component={Link} to={to}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center">
            <Stack sx={{ color: 'primary.main' }}>{icon}</Stack>
            <Typography variant="h3" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
              {label}
            </Typography>
            <ChevronRightIcon color="primary" />
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}

export default function ProfileScreen() {
  const { user, profile } = useAuth()
  const isMember = profile?.role === 'member'

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h1">Profile</Typography>

      <Stack spacing={1} alignItems="center" sx={{ textAlign: 'center' }}>
        <Avatar src={profile?.avatar_url ?? undefined} sx={{ width: 112, height: 112 }}>
          {profile?.full_name?.[0] ?? '?'}
        </Avatar>
        <Typography variant="h2" component="p">
          {profile?.full_name ?? ''}
        </Typography>
        <Typography color="text.secondary">{user?.email ?? ''}</Typography>
      </Stack>

      {isMember ? (
        <Stack spacing={2}>
          <Typography variant="h2">Membership</Typography>
          <Row icon={<QrCode2Icon />} label="Access Badge" to="/m/profile/badge" />
          <Row icon={<InfoOutlineIcon />} label="Subscription" to="/m/profile/subscription" />
          <Row icon={<EmojiEventsIcon />} label="Rewards" to="/m/profile/rewards" />
        </Stack>
      ) : null}

      <Stack spacing={2}>
        <Typography variant="h2">Account &amp; Security</Typography>
        <Row
          icon={<SettingsIcon />}
          label="Settings"
          to={isMember ? '/m/profile/settings' : '/p/profile/settings'}
        />
      </Stack>
    </Stack>
  )
}
```

`QrCode2`, `InfoOutlined`, `EmojiEvents` and `Settings` all exist in the installed `@mui/icons-material@9.2.0`. Confirm before you import anything else.

`/m/profile/badge` is a placeholder until Phase 4B. The row is still built, because the navigation map declares the route and a profile screen missing its badge link would have to be revisited.

- [ ] **Step 2: The subscription screen**

Create `src/features/profile/SubscriptionScreen.jsx`:

```jsx
import { Card, CardContent, Chip, Divider, Stack, Typography } from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import { formatDate, todayISO } from '../../lib/format.js'
import { subscriptionStateOf } from '../clients/subscription.js'
import { useAuth } from '../auth/useAuth.js'

// What the gym includes. Static copy: there is no products table and inventing
// one for a fixed list would be a schema nobody writes to.
const INCLUDED = ['Gym Access', 'Locker Rooms', 'Sauna and Wellness Area']

export default function SubscriptionScreen() {
  const { profile } = useAuth()
  const state = subscriptionStateOf(profile, todayISO())

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h1">Subscription</Typography>

      <Card>
        <CardContent>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={2} alignItems="center">
              <Typography variant="h3" sx={{ flexGrow: 1 }}>
                Annual Membership
              </Typography>
              <Chip
                size="small"
                label={state.label}
                sx={{ bgcolor: state.color, color: 'common.white' }}
              />
            </Stack>

            <Divider />

            <Stack direction="row" spacing={2}>
              <Typography color="text.secondary" sx={{ flexGrow: 1 }}>
                Valid until
              </Typography>
              <Typography>
                {profile?.subscription_until ? formatDate(profile.subscription_until) : '—'}
              </Typography>
            </Stack>

            <Stack direction="row" spacing={2}>
              <Typography color="text.secondary" sx={{ flexGrow: 1 }}>
                Membership ID
              </Typography>
              {/* The wireframe shows "#274982". There is no membership-number
                  column, and inventing one would be a fiction the database
                  cannot back, so this is the real row id, shortened. */}
              <Typography>#{String(profile?.id ?? '').slice(0, 8)}</Typography>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h3" sx={{ mb: 1.5 }}>
            Included Inside Membership
          </Typography>
          <Stack spacing={1}>
            {INCLUDED.map((item) => (
              <Stack key={item} direction="row" spacing={1.5} alignItems="center">
                <CheckIcon color="success" fontSize="small" />
                <Typography color="text.secondary">{item}</Typography>
              </Stack>
            ))}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  )
}
```

- [ ] **Step 3: Wire, verify, commit**

Replace three placeholders — `/m/profile`, `/m/profile/subscription`, and `/p/profile` (which renders the same `ProfileScreen`).

`npm run lint`, `npm run build`. As Daniel, `/m/profile` shows his name and email with three membership rows; `/m/profile/subscription` shows the date eight months out and a green Active chip. As Coach Andrea, `/p/profile` shows her name with **no** Membership section — a professional has no badge, subscription or rewards.

```bash
git add src/features/profile src/routes/index.jsx
git commit -m "feat: add the profile and subscription screens"
```

---

## Task 9: Settings, password change and logout

**Files:**
- Create: `src/features/profile/SettingsScreen.jsx`
- Modify: `src/routes/index.jsx`

**Interfaces:**
- Consumes: `useAuth().signOut`, `supabase.auth.updateUser`.
- Produces: `/m/profile/settings` and `/p/profile/settings`.

**This closes the decision recorded after Phase 1**: there has been no logout in the UI since the project began — `signOut` is wired only to `AppLayout`'s profile-failure branch, and switching demo accounts has meant clearing `localStorage` by hand. Phase 4A owns it, and this is the task.

Mirrors `pt/12 - Change Password.png`. One screen for both roles.

The password change goes through `supabase.auth.updateUser({ password })`, not through any table — `auth.users` is not writable from the client and must not be. Supabase enforces its own minimum length and returns a message; the screen shows it rather than inventing rules that could disagree with the server's.

- [ ] **Step 1: The screen**

Create `src/features/profile/SettingsScreen.jsx`:

```jsx
import { useState } from 'react'
import { Alert, Button, Card, CardContent, Divider, Stack, TextField, Typography } from '@mui/material'
import LogoutIcon from '@mui/icons-material/Logout'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from '../auth/useAuth.js'

export default function SettingsScreen() {
  const { user, signOut } = useAuth()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [status, setStatus] = useState({ phase: 'idle', message: '' })

  // Checked here only to catch the typo before a round trip. The server owns
  // the real rules -- minimum length, reuse, leaked-password checks -- and its
  // message is what the user is shown when it refuses.
  const mismatch = confirm !== '' && password !== confirm

  const onSubmit = async (event) => {
    event.preventDefault()
    if (mismatch || password === '') return

    setStatus({ phase: 'saving', message: '' })
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setStatus({ phase: 'error', message: error.message })
      return
    }

    setPassword('')
    setConfirm('')
    setStatus({ phase: 'done', message: 'Your password has been changed.' })
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h1">Settings</Typography>

      <Card>
        <CardContent>
          <Stack component="form" spacing={2} onSubmit={onSubmit}>
            <Typography variant="h3">Change password</Typography>
            <Typography variant="body2" color="text.secondary">
              Signed in as {user?.email ?? ''}
            </Typography>

            <TextField
              label="New password"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                // Clear a stale result the moment the user starts over,
                // otherwise "Your password has been changed" sits above a form
                // being filled in again.
                if (status.phase !== 'idle') setStatus({ phase: 'idle', message: '' })
              }}
              autoComplete="new-password"
              required
              fullWidth
            />
            <TextField
              label="Confirm new password"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              error={mismatch}
              helperText={mismatch ? 'The two passwords do not match' : ' '}
              required
              fullWidth
            />

            {status.phase === 'error' ? <Alert severity="error">{status.message}</Alert> : null}
            {status.phase === 'done' ? <Alert severity="success">{status.message}</Alert> : null}

            <Button
              type="submit"
              variant="contained"
              disabled={mismatch || password === '' || status.phase === 'saving'}
            >
              {status.phase === 'saving' ? 'Saving…' : 'Change password'}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Divider />

      <Button
        variant="outlined"
        color="error"
        size="large"
        startIcon={<LogoutIcon />}
        onClick={signOut}
        fullWidth
      >
        Sign out
      </Button>
    </Stack>
  )
}
```

`signOut` from `useAuth` already clears the cached profile from `localStorage` before calling Supabase, so a failed network call still ends the local session rather than leaving a stale profile behind. Do not reimplement it here.

- [ ] **Step 2: Wire both routes, verify, commit**

Replace `/m/profile/settings` and `/p/profile/settings` with the same lazy import.

`npm run lint`, `npm run build`.

In the browser: as Daniel, open `/m/profile/settings`, type two different passwords and confirm the button stays disabled with the mismatch message. Then **sign out** — the app returns to `/login` — and sign in as Coach Andrea. That is the first time in this project that switching accounts has not required DevTools.

Leave the demo passwords alone unless you intend to change them; if you do change one, note the new value somewhere, because the seed does not set passwords and there is no way to read one back.

```bash
git add src/features/profile/SettingsScreen.jsx src/routes/index.jsx
git commit -m "feat: add settings with password change and sign out"
```

---

## Phase 4A Acceptance

Run after Task 9, before the final whole-branch review.

- [ ] `npm run lint` exits 0; `npm run build` succeeds.
- [ ] All eight existing self-checks still pass.
- [ ] `supabase/verify.sql`: the three security rows and the two grant rows read PASS. The four seed-count rows read FAIL by design once `patches/005` has run — see the comment in that file.
- [ ] `supabase/patches/007-realtime-messages.sql` has been run and its output lists `messages`.
- [ ] Every route in `src/routes/index.jsx` renders real content except `/m/profile/badge` and `/p/scan`, which are Phase 4B.
- [ ] **Chat round trip:** two browser profiles, Daniel and Coach Andrea, both on the conversation. A message sent by one appears for the other **without a reload**, and the unread badge clears when the thread is opened.
- [ ] **Offline round trip:** with DevTools offline, send a message, request an appointment and change nothing else. Each control reads "Saved offline". Reconnect; both land, and the message keeps its position in the conversation.
- [ ] **Offline cold start:** load `/m/nutrition`, `/m/trainer` and `/m/profile` online, then go offline and hard-reload each. The persisted cache serves them; no screen shows an error over data it already holds.
- [ ] Sign out works from both roles, and signing back in resumes on the right shell.

## Deferred to Phase 4B

- `/m/profile/badge` — the QR access badge, with `checkin_tokens` and the `qrcode` dependency.
- `/p/scan` — the scanner, with `BarcodeDetector` and the authorised `jsqr` fallback.
- Push notifications end to end: VAPID keys, `push_subscriptions` writes, the `push` and `notificationclick` handlers in `src/sw.js`, the Supabase Edge Function and the `messages` trigger that calls it.

## Deferred beyond Phase 4

- **Editing your own profile.** `full_name`, `avatar_url` and `bio` are displayed but not editable; the navigation map gives the form no route. Report chapter 6.
- **Availability is still not enforced when booking.** The member's sheet lets them request any slot, including outside the professional's hours. The professional confirms or cancels, so nothing incorrect reaches the diary — but the check belongs in the sheet.
- **`AuthProvider` has no refresh.** Choosing a professional reloads the page to pick up the changed profile. A `refreshProfile()` on the context would remove the reload and is worth doing if any other screen ever writes to `profiles`.
