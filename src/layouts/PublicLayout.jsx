import { Box, Container, Stack } from '@mui/material'
import { Outlet } from 'react-router'
import BrandLogo from '../components/BrandLogo.jsx'

export default function PublicLayout() {
  return (
    // `relative` so a screen can pin a control to the top of the column; see
    // ForgotPasswordScreen's back arrow.
    <Container
      maxWidth="sm"
      sx={{ position: 'relative', minHeight: '100dvh', display: 'flex', alignItems: 'center' }}
    >
      <Stack spacing={4} sx={{ width: '100%', py: 6 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          {/* Sized off the column rather than in pixels, which is what keeps the
              phone at the wireframe's proportions without letting the mark grow
              to a banner on a wide window. */}
          <BrandLogo width="min(70%, 272px)" />
        </Box>
        <Outlet />
      </Stack>
    </Container>
  )
}
