import { CssBaseline, ThemeProvider } from '@mui/material'
import { RouterProvider } from 'react-router'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import theme from './theme/index.js'
import router from './routes/index.jsx'
import { AuthProvider } from './features/auth/AuthProvider.jsx'
import { CACHE_MAX_AGE, persister, queryClient } from './lib/queryClient.js'
import { registerMutationDefaults } from './data/mutations.js'

// At module scope, not in an effect: `PersistQueryClientProvider` restores the
// cache and resumes paused mutations as it mounts, which is before any effect
// runs.  A mutation resumed without its default has no function and is dropped.
registerMutationDefaults(queryClient)

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: CACHE_MAX_AGE,
          dehydrateOptions: {
            // Persist anything that HAS data, not only what is currently
            // `success`.  Offline every query refetches, fails and flips to
            // `error` while keeping its data in memory -- and the default
            // predicate (`status === 'success'`) would then rewrite the stored
            // cache without it.  The first offline reopen would work and the
            // second would show an error on every screen.
            shouldDehydrateQuery: (query) => query.state.data !== undefined,
          },
        }}
        onSuccess={() => queryClient.resumePausedMutations()}
      >
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </PersistQueryClientProvider>
    </ThemeProvider>
  )
}
