import { Box, Container, Stack } from '@mui/material'
import { Outlet } from 'react-router'
import BrandLogo from '../components/BrandLogo.jsx'

export default function PublicLayout() {
  return (
    <Container maxWidth="sm" sx={{ minHeight: '100dvh', display: 'flex', alignItems: 'center' }}>
      <Stack spacing={4} sx={{ width: '100%', py: 6 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <BrandLogo size={72} />
        </Box>
        <Outlet />
      </Stack>
    </Container>
  )
}
