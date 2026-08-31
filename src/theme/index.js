import { createTheme, responsiveFontSizes } from '@mui/material/styles'
import { tokens } from './tokens.js'

const theme = createTheme({
  palette: {
    primary: { main: tokens['Action.Primary'], contrastText: tokens['Color.White'] },
    background: { default: tokens['Bg.Secondary'], paper: tokens['Bg.Primary'] },
    text: { primary: tokens['Text.Primary'], secondary: tokens['Text.Secondary'] },
    success: { main: tokens['Theme.Success'] },
    warning: { main: tokens['Theme.Warning'] },
    error: { main: tokens['Theme.Danger'] },
    divider: tokens['Border.Primary'],
    action: { disabledBackground: tokens['Bg.Disabled'] },

    // Appointment cards are colour-coded by type; MUI has no slot for that,
    // so they ride along as a custom palette group.
    task: {
      training: tokens['Task.PT'],
      protocol: tokens['Task.Protocol Consultation'],
      nutrition: tokens['Task.Nutrition Consultation'],
      done: tokens['Task.Done'],
      suspended: tokens['Theme.Status.Suspended'],
    },
  },

  shape: { borderRadius: 16 },

  typography: {
    fontFamily: '"Inter Variable", system-ui, -apple-system, sans-serif',
    h1: { fontSize: '2.25rem', fontWeight: 800, letterSpacing: '-0.03em' },
    h2: { fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em' },
    h3: { fontSize: '1.25rem', fontWeight: 700 },
    body1: { fontSize: '1rem' },
    body2: { fontSize: '0.875rem' },
    button: { fontWeight: 600, textTransform: 'none' },
  },

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { scrollbarGutter: 'stable' },
        body: { overscrollBehaviorY: 'none' },
      },
    },
    // The wireframes use soft, borderless, generously rounded cards throughout.
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { borderRadius: 20, border: `1px solid ${tokens['Border.Primary']}` },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 999, paddingBlock: 12 } },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
  },
})

// Required by the course brief: MUI is mobile friendly but not natively
// responsive, so type scales are derived rather than fixed.
export default responsiveFontSizes(theme)
