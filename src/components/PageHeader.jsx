import { IconButton, Stack, Typography } from '@mui/material'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import { Link } from 'react-router'

/**
 * Consistent title and explicit parent navigation for secondary screens.
 *
 * The rule this component exists to enforce: every screen that is not a
 * bottom-nav root carries a back arrow, and every bottom-nav root carries
 * none.  Five screens used to hand-roll this row with two different arrow
 * glyphs at two different sizes, and two secondary screens offered no way
 * back at all.
 *
 * @param {object}   props
 * @param {string}   props.title        The screen's name.
 * @param {string}   [props.subtitle]   One line under it, usually context.
 * @param {string}   props.backTo       Where the arrow goes.
 * @param {string}   props.backLabel    What a screen reader announces for it.
 * @param {string}   [props.titleVariant] Typography variant for the title.
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
