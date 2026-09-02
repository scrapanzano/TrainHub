import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material'
import { Link, useLocation } from 'react-router'

/**
 * The section's tab bar.
 *
 * Not sticky itself: `AppLayout` pins it together with the live-session
 * mini-player as one block, so the two cannot drift apart when a workout is
 * open.
 */
export default function BottomNav({ items }) {
  const { pathname } = useLocation()

  // Home's path IS the section root ("/m", "/p"), so it prefixes every route in
  // the section -- including screens no tab represents, like /m/profile/badge
  // and /p/scan. Letting it match by prefix would light up Home there. It owns
  // exactly one route; every other tab owns a subtree.
  const rootPath = items.reduce((a, b) => (b.to.length < a.to.length ? b : a)).to

  const current = items.reduce((best, item, index) => {
    const matches =
      pathname === item.to ||
      (item.to !== rootPath && pathname.startsWith(`${item.to}/`))

    if (!matches) return best
    if (best === -1) return index
    // Tab subtrees do not overlap today, but the most specific match is the
    // right answer if one is ever nested inside another.
    return item.to.length > items[best].to.length ? index : best
  }, -1)

  return (
    <Paper
      elevation={0}
      sx={{
        borderTop: 1, borderColor: 'divider',
        // Keeps the bar clear of the iOS home indicator.
        pb: 'env(safe-area-inset-bottom)',
      }}
    >
      <BottomNavigation value={current} showLabels>
        {items.map(({ to, label, icon: Icon }) => (
          <BottomNavigationAction
            key={to}
            component={Link}
            to={to}
            label={label}
            icon={<Icon />}
            sx={{
              minWidth: 0,
              px: 0.5,
              '& .MuiBottomNavigationAction-label': { whiteSpace: 'nowrap' },
            }}
          />
        ))}
      </BottomNavigation>
    </Paper>
  )
}
