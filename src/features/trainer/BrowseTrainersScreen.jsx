import { useState } from 'react'
import {
  Alert, Avatar, Card, CardContent, Chip, IconButton, InputAdornment, Stack, TextField, Typography,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import AddIcon from '@mui/icons-material/Add'
import CheckIcon from '@mui/icons-material/Check'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { fetchProfessionals } from '../../data/profile.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'
import PageHeader from '../../components/PageHeader.jsx'

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
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')

  const professionals = useQuery({
    queryKey: queryKeys.professionals(),
    queryFn: fetchProfessionals,
  })

  const choose = useMutation({ mutationKey: mutationKeys.chooseProfessional })
  const savedOffline = choose.isPending && choose.isPaused

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
      <PageHeader
        title="Personal Trainer"
        backTo="/m/trainer"
        backLabel="Back to My Trainer"
      />

      {!profile?.assigned_pro_id ? (
        <Card>
          <CardContent>
            <Stack spacing={1} sx={{ alignItems: 'center', textAlign: 'center' }}>
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
        fullWidth
        slotProps={{
          htmlInput: { 'aria-label': 'Search professionals' },
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

      {/* Offline the mutation pauses and stays pending, which keeps every choose
          button disabled until reconnect. Say why, or the screen just looks
          dead. */}
      {savedOffline ? (
        <Alert severity="info">
          You are offline. This choice is saved on your device and will be sent when you reconnect.
        </Alert>
      ) : null}
      {choose.isError ? (
        <Alert severity="error">
          {choose.error?.message ?? 'Could not select this professional. Try again.'}
        </Alert>
      ) : null}

      {/* Two different nothings: an empty roster is not a filter that matched
          nobody, and telling a member to widen a search that has nothing to
          find would be a lie. */}
      {professionals.data?.length === 0 ? (
        <EmptyState
          title="No professionals yet"
          description="Certified coaches will appear here once they join."
        />
      ) : null}
      {professionals.data?.length > 0 && visible.length === 0 ? (
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
                <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
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
                          // `chooseProfessional` publishes the full updated
                          // profile before resolving, so AuthProvider already
                          // knows the assignment when this navigation renders.
                          onSuccess: () => navigate('/m/trainer'),
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
