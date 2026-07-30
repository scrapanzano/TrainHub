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
