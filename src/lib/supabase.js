import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Failing here beats failing on the first query with an opaque network error.
if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local.',
  )
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // The app is installed as a PWA and uses no OAuth provider, so there is no
    // redirect fragment to auto-parse.  Note for Phase 1: the password-reset
    // email link IS a URL-borne session, so that flow has to call
    // `exchangeCodeForSession` explicitly rather than relying on this.
    detectSessionInUrl: false,
  },
})
