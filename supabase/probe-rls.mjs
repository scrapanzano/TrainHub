// Probe Row Level Security as a genuinely anonymous caller.
//
//   node supabase/probe-rls.mjs
//
// WHY THIS EXISTS
//
// `verify.sql` runs as the dashboard's privileged role, which bypasses RLS
// entirely. It proves policies EXIST; it cannot prove they are right. A policy
// whose `using` clause never mentions `auth.uid()` is readable by anyone
// holding the publishable key -- and that key ships inside the JS bundle, so it
// is public by construction. Phase 0 shipped exactly one of those, and no SQL
// check caught it.
//
// This asks the same question the attacker would: with nothing but the key that
// is already in every visitor's browser, what comes back?
//
// PASS is an empty array or a permission error. Rows returned to a caller who
// has never signed in are the failure.
//
// Reads `.env.local`, which is gitignored. Copy `.env.example` and refill it on
// a new machine.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.includes('=') && !line.trimStart().startsWith('#'))
    .map((line) => {
      const i = line.indexOf('=')
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()]
    }),
)

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

// Every table in the schema. Nothing here is anonymously readable by design --
// even `exercises` and `profiles` gate on `auth.uid() is not null`, which is
// deliberate and load-bearing.
const TABLES = [
  'profiles', 'exercises', 'workout_plans', 'workout_sessions', 'session_exercises',
  'set_logs', 'workout_runs', 'nutrition_plans', 'meals', 'availability', 'appointments',
  'threads', 'messages', 'rewards', 'checkins', 'checkin_tokens', 'body_metrics',
  'push_subscriptions', 'app_config',
]

let failures = 0
const report = (ok, name, detail) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(22)} ${detail}`)
}

// Connectivity control, first. Every table answering "empty" would look like
// perfect security and is also exactly what a wrong URL, a dead project or a
// rejected key produce. `app_config` is deliberately grant-less, so PostgREST
// must refuse it with 42501 -- a real answer from a live server, which is what
// makes every "empty" below meaningful rather than vacuous.
{
  const { error } = await supabase.from('app_config').select('*').limit(1)
  report(
    error?.code === '42501',
    'CONTROL app_config',
    error ? `refused (${error.code})` : 'ANSWERED — probe cannot be trusted',
  )
}

for (const table of TABLES) {
  const { data, error } = await supabase.from(table).select('*').limit(3)
  const rows = data?.length ?? 0
  report(
    rows === 0,
    table,
    rows > 0 ? `LEAKED ${rows} row(s)` : error ? `denied (${error.code ?? 'error'})` : 'empty',
  )
}

// `redeem_checkin_token` is `security definer` and gated on `is_professional()`.
// An anonymous caller must be REFUSED, not merely told the token is unknown:
// "unknown" would let anyone with the bundle enumerate valid badges.
{
  const { data, error } = await supabase.rpc('redeem_checkin_token', { p_token: 'PROBE0000' })
  report(
    Boolean(error),
    'redeem_checkin_token',
    error ? `refused (${error.code ?? 'error'})` : `ANSWERED: ${JSON.stringify(data)}`,
  )
}

console.log(failures === 0 ? '\nAll probes PASS.' : `\n${failures} PROBE FAILURE(S).`)
process.exit(failures === 0 ? 0 : 1)
