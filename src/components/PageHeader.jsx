import { Box, IconButton, Stack, Typography } from '@mui/material'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import { Link } from 'react-router'

/**
 * Consistent title and explicit parent navigation for secondary screens.
 *
 * The rule this component exists to serve: a screen reached from exactly one
 * parent carries a back arrow to it, and nothing else hand-rolls that row.
 * Five screens used to draw it themselves with two arrow glyphs at two sizes,
 * and two offered no way back at all.
 *
 * Four kinds of screen deliberately carry no arrow, because none of them has a
 * single parent to point at:
 *   - the eight bottom-nav roots, which are the parents;
 *   - the top-bar destinations, Profile and Notifications, reachable from
 *     every screen in the app and therefore from no particular one;
 *   - `NewPlanScreen`, whose draft may only be left through a confirmation --
 *     an arrow would be a second exit that discards it silently;
 *   - `SessionSummaryScreen`, which ends a workout behind a full-width
 *     "Back to plan" button that is the point of the screen.
 * `LiveSessionScreen` draws its own arrow inside the sticky clock card, where
 * it sits beside the pause and stop controls it belongs with.
 *
 * @param {object}   props
 * @param {string}   props.title        The screen's name.
 * @param {string}   [props.subtitle]   One line under it, usually context.
 * @param {string}   props.backTo       Where the arrow goes.
 * @param {string}   props.backLabel    What a screen reader announces for it.
 * @param {string}   [props.titleVariant] Typography variant for the title.
 * @param {React.ReactNode} [props.leading]  Sits between the arrow and the
 *                                           title, for a screen that is about
 *                                           a person (an avatar) rather than a
 *                                           subject.
 * @param {React.ReactNode} [props.action]   Trailing control, right-aligned on
 *                                           the title row (a menu, a toggle).
 * @param {React.ReactNode} [props.children] Extra rows under the title, inside
 *                                           the same header block.
 */
export default function PageHeader({
  title,
  subtitle = null,
  backTo,
  backLabel,
  titleVariant = 'h1',
  leading = null,
  action = null,
  children = null,
}) {
  return (
    <Stack spacing={1} sx={{ minWidth: 0, width: '100%', textAlign: 'left' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', minWidth: 0 }}>
        <IconButton
          component={Link}
          to={backTo}
          aria-label={backLabel}
          edge="start"
          sx={{ mt: -0.5, flexShrink: 0 }}
        >
          <ArrowBackIosNewIcon fontSize="small" />
        </IconButton>

        {leading ? <Box sx={{ flexShrink: 0, display: 'flex' }}>{leading}</Box> : null}

        <Stack spacing={0.25} sx={{ minWidth: 0, pt: 0.25, flexGrow: 1 }}>
          <Typography variant={titleVariant}>{title}</Typography>
          {subtitle ? (
            <Typography color="text.secondary">{subtitle}</Typography>
          ) : null}
        </Stack>

        {action ? (
          <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0, alignItems: 'center' }}>
            {action}
          </Stack>
        ) : null}
      </Stack>

      {children}
    </Stack>
  )
}
