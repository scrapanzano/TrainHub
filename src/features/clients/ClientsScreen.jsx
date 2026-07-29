import { useState } from 'react'
import { InputAdornment, Stack, TextField, Typography } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { useQuery } from '@tanstack/react-query'
import { fetchClients } from '../../data/clients.js'
import { queryKeys } from '../../lib/queryKeys.js'
import ClientCard from '../../components/ClientCard.jsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

export default function ClientsScreen() {
  const { user } = useAuth()
  const [search, setSearch] = useState('')

  const clients = useQuery({
    queryKey: queryKeys.clients(user.id),
    queryFn: () => fetchClients(user.id),
  })

  // Filtered here rather than on the server: this is one professional's roster,
  // so it is tens of rows, and a request per keystroke would be slower online
  // and would stop working entirely offline.
  const term = search.trim().toLowerCase()
  const visible = (clients.data ?? []).filter((client) =>
    term === '' ? true : client.full_name?.toLowerCase().includes(term),
  )

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} alignItems="baseline">
        <Typography variant="h1">Your Clients</Typography>
        {clients.data ? (
          <Typography variant="h3" component="span" color="text.secondary" noWrap>
            • {clients.data.length} in total
          </Typography>
        ) : null}
      </Stack>

      <TextField
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search Client…"
        // A placeholder is not an accessible name: it disappears the moment
        // anything is typed, and some readers never announce it at all.
        aria-label="Search clients"
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

      {clients.isPending ? <LoadingState /> : null}

      {clients.isError && clients.data === undefined ? (
        <ErrorState error={clients.error} onRetry={clients.refetch} />
      ) : null}

      {/* Two different nothings.  "No clients yet" for a professional who is
          searching would be a lie about their roster. */}
      {clients.data?.length === 0 ? (
        <EmptyState
          title="No clients yet"
          description="Members who choose you as their professional will appear here."
        />
      ) : null}

      {clients.data?.length > 0 && visible.length === 0 ? (
        <EmptyState title="No match" description={`No client's name contains "${search.trim()}".`} />
      ) : null}

      <Stack spacing={2}>
        {visible.map((client) => (
          <ClientCard key={client.id} client={client} to={`/p/clients/${client.id}`} />
        ))}
      </Stack>
    </Stack>
  )
}
