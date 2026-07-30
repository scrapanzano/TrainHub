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
