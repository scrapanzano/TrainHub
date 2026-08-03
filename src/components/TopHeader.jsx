import { AppBar, Avatar, Badge, Box, IconButton, Toolbar, Typography } from '@mui/material'
import NotificationsIcon from '@mui/icons-material/Notifications'
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner'
import { Link } from 'react-router'
import { useAuth } from '../features/auth/useAuth.js'

function greeting(hour) {
  if (hour < 12) return 'Good Morning'
  if (hour < 18) return 'Good Afternoon'
  return 'Good Evening'
}

export default function TopHeader({ profileHref, notificationCount = 0, scanHref }) {
  const { profile } = useAuth()

  return (
    <AppBar position="static" color="inherit" elevation={0}>
      <Toolbar sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" noWrap>
            {greeting(new Date().getHours())}
          </Typography>
          <Typography variant="h3" component="p" noWrap>
            {profile?.full_name ?? ''}
          </Typography>
        </Box>

        {scanHref ? (
          <IconButton component={Link} to={scanHref} aria-label="Scan an access badge">
            <QrCodeScannerIcon />
          </IconButton>
        ) : null}

        <IconButton
          aria-label={
            notificationCount === 0
              ? 'No unread messages'
              : `${notificationCount} unread message${notificationCount === 1 ? '' : 's'}`
          }
        >
          <Badge badgeContent={notificationCount} color="primary">
            <NotificationsIcon />
          </Badge>
        </IconButton>

        <IconButton component={Link} to={profileHref} aria-label="Profile">
          <Avatar src={profile?.avatar_url ?? undefined} sx={{ width: 36, height: 36 }}>
            {profile?.full_name?.[0] ?? '?'}
          </Avatar>
        </IconButton>
      </Toolbar>
    </AppBar>
  )
}
