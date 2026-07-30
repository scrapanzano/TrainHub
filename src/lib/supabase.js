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
    // auth-js defaults to `implicit`, which returns a recovery session in the
    // URL *fragment* (`#access_token=…`) and never produces the `?code=` that
    // ResetPasswordScreen reads.  Leaving the default made every password-reset
    // link land on "Link not valid" -- the screen, its single-use-code handling
    // and its StrictMode guard were all written for PKCE while the client was
    // never told to use it.  Only `resetPasswordForEmail` and
    // `exchangeCodeForSession` care; password sign-in, `getSession`, `signOut`
    // and `updateUser` behave identically either way.
    //
    // The cost of PKCE is that the verifier lives in the requesting browser's
    // storage, so the emailed link must be opened in that same browser.  The
    // invalid-link copy already says so.
    flowType: 'pkce',
    // The app is installed as a PWA and uses no OAuth provider, so there is no
    // redirect fragment to auto-parse.  Note for Phase 1: the password-reset
    // email link IS a URL-borne session, so that flow has to call
    // `exchangeCodeForSession` explicitly rather than relying on this.
    detectSessionInUrl: false,
  },
})
