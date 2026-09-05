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
    // The label above a grouped list ("Today", "September 2026").  Declared here
    // rather than restyled per screen, so every grouped list agrees.
    overline: {
      fontSize: '0.75rem',
      fontWeight: 600,
      letterSpacing: '0.06em',
      lineHeight: 1.8,
    },
  },

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { scrollbarGutter: 'stable' },
        body: {
          overscrollBehaviorY: 'none',
          // Kills the double-tap-to-zoom gesture, which on a phone fires by
          // accident while tapping a button and makes the app feel like a web
          // page.  Pinch-zoom is deliberately left alone: blocking it would
          // fail WCAG 1.4.4, and nobody pinches by mistake.
          touchAction: 'manipulation',
        },
        // Focus was invisible everywhere outside MUI's own inputs.  ButtonBase
        // covers Button, IconButton, ListItemButton, CardActionArea, Chip and
        // BottomNavigationAction in one rule; links are the only other thing
        // that takes keyboard focus in this app.
        'a:focus-visible': {
          outline: `2px solid ${tokens['Action.Primary']}`,
          outlineOffset: 2,
          borderRadius: 4,
        },
      },
    },
    MuiButtonBase: {
      styleOverrides: {
        root: {
          '&.Mui-focusVisible': {
            outline: `2px solid ${tokens['Action.Primary']}`,
            outlineOffset: 2,
          },
        },
      },
    },
    // MUI's default asterisk inherits the label's grey, so a required field
    // looked exactly like an optional one.  It is the only signal these 23
    // fields have.
    MuiFormLabel: {
      styleOverrides: {
        asterisk: {
          color: tokens['Theme.Danger'],
          fontWeight: 700,
          '&.Mui-error': { color: tokens['Theme.Danger'] },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        // A chip with no `onClick` is a label, and it has to stop behaving like
        // a control. Without these it still takes the browser's grey tap flash
        // and selects its own text on a long press -- on a phone, both are
        // indistinguishable from having pressed something. Scoped to
        // non-clickable chips, because the notification filters are real
        // buttons and must keep their feedback.
        root: {
          '&:not(.MuiChip-clickable)': {
            cursor: 'default',
            userSelect: 'none',
            WebkitTapHighlightColor: 'transparent',
          },
        },
        label: { fontWeight: 500 },
      },
    },
    // Cards are 20; dialogs and bottom sheets inherited `shape.borderRadius`
    // (16) and read as a different family of surface.
    MuiDialog: { styleOverrides: { paper: { borderRadius: 20 } } },
    MuiDrawer: {
      styleOverrides: {
        paperAnchorBottom: { borderTopLeftRadius: 20, borderTopRightRadius: 20 },
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
