// Probe authenticated table access through the same public API used by the app.
//
//   node supabase/probe-security.mjs
//
// This complements `verify.sql` (privileged structural checks) and
// `probe-rls.mjs` (anonymous denial). It signs in as both demo roles, verifies
// their profiles, checks that every application table is reachable through
// PostgREST, and confirms that `app_config` remains inaccessible.
//
// The demo emails and the original demo password are defaults. If either
// password was changed, set PROBE_MEMBER_PASSWORD and PROBE_PRO_PASSWORD in
// `.env.local`; that file is gitignored and credentials are never printed.

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

const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
const missing = required.filter((name) => !env[name])
if (missing.length > 0) {
  throw new Error(`Missing .env.local values: ${missing.join(', ')}`)
}

const DEMO_PASSWORD = env.PROBE_DEMO_PASSWORD ?? 'TrainHub2026!'
const identities = [
  {
    name: 'member',
    role: 'member',
    email: env.PROBE_MEMBER_EMAIL ?? 'daniel@trainhub.com',
    password: env.PROBE_MEMBER_PASSWORD ?? DEMO_PASSWORD,
  },
  {
    name: 'professional',
    role: 'professional',
    email: env.PROBE_PRO_EMAIL ?? 'marco@trainhub.com',
    password: env.PROBE_PRO_PASSWORD ?? DEMO_PASSWORD,
  },
]

const READABLE_TABLES = [
  'profiles', 'exercises', 'workout_plans', 'workout_sessions', 'session_exercises',
  'set_logs', 'workout_runs', 'nutrition_plans', 'meals', 'availability', 'appointments',
  'threads', 'messages', 'rewards', 'checkins', 'checkin_tokens', 'body_metrics',
  'push_subscriptions',
]

let checks = 0
let failures = 0
const report = (ok, name, detail) => {
  checks += 1
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} ${detail}`)
}

for (const identity of identities) {
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: authData, error: authError } = await client.auth.signInWithPassword({
    email: identity.email,
    password: identity.password,
  })
  report(!authError && Boolean(authData.user), `${identity.name} sign-in`,
    authError ? `refused (${authError.message})` : 'authenticated')

  if (authError || !authData.user) continue

  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('id, role')
    .eq('id', authData.user.id)
    .single()
  report(
    !profileError && profile?.role === identity.role,
    `${identity.name} role`,
    profileError ? `error (${profileError.code ?? 'unknown'})` : `role=${profile?.role ?? 'missing'}`,
  )

  for (const table of READABLE_TABLES) {
    const { error } = await client.from(table).select('*').limit(1)
    report(
      !error,
      `${identity.name} reads ${table}`,
      error ? `error (${error.code ?? 'unknown'})` : 'allowed through RLS',
    )
  }

  const { error: configError } = await client.from('app_config').select('*').limit(1)
  report(
    configError?.code === '42501',
    `${identity.name} cannot read app_config`,
    configError ? `refused (${configError.code ?? 'unknown'})` : 'UNEXPECTEDLY ALLOWED',
  )

  await client.auth.signOut()
}

console.log(
  failures === 0
    ? `\nAll ${checks} authenticated probes PASS.`
    : `\n${failures} of ${checks} authenticated probes FAILED.`,
)
process.exit(failures === 0 ? 0 : 1)
