import { Box, ButtonBase, Stack, Typography } from '@mui/material'

/**
 * Seven selectable days.
 *
 * @param {object}   props
 * @param {Array}    props.days     From `weekStrip()`: `{dateISO, day, weekday}`.
 * @param {string}   props.selected `'YYYY-MM-DD'`.
 * @param {Function} props.onSelect `(dateISO) => void`
 * @param {object}   props.markers  `{[dateISO]: 'training'|'protocol'|'nutrition'}`
 */
export default function WeekStrip({ days, selected, onSelect, markers = {} }) {
  return (
    <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', pb: 1 }}>
      {days.map((cell) => {
        const isSelected = cell.dateISO === selected
        return (
          <ButtonBase
            key={cell.dateISO}
            onClick={() => onSelect(cell.dateISO)}
            // The single-letter weekday repeats three times a week and the
            // number alone does not say which month, so the button carries the
            // full date as its accessible name.
            aria-label={cell.dateISO}
            aria-current={isSelected ? 'date' : undefined}
            sx={{
              flex: '0 0 auto',
              width: 52,
              borderRadius: 3,
              py: 1,
              bgcolor: isSelected ? 'primary.main' : 'background.paper',
              color: isSelected ? 'primary.contrastText' : 'text.primary',
              border: 1,
              borderColor: 'divider',
            }}
          >
            <Stack spacing={0.25} sx={{ alignItems: 'center', width: '100%' }}>
              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                {cell.weekday}
              </Typography>
              <Typography variant="h3" component="span">
                {cell.day}
              </Typography>
              {/* Decoration: the day's own list below states what is booked. */}
              <Box
                aria-hidden
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  bgcolor: markers[cell.dateISO] ? `task.${markers[cell.dateISO]}` : 'transparent',
                }}
              />
            </Stack>
          </ButtonBase>
        )
      })}
    </Stack>
  )
}
