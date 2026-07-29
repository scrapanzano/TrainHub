import { Box, ButtonBase, Typography } from '@mui/material'
import { WEEKDAY_INITIALS } from '../features/calendar/month.js'

/**
 * A whole month, Monday first, with a dot on every day that has something on it.
 *
 * @param {object}   props
 * @param {Array}    props.cells    From `monthGrid()`: `{dateISO, day, inMonth}`.
 * @param {string}   props.selected `'YYYY-MM-DD'`.
 * @param {Function} props.onSelect `(dateISO) => void`
 * @param {object}   props.markers  `{[dateISO]: 'training'|'protocol'|'nutrition'}`
 */
export default function MonthGrid({ cells, selected, onSelect, markers = {} }) {
  return (
    <Box>
      <Box
        aria-hidden
        sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', mb: 0.5 }}
      >
        {WEEKDAY_INITIALS.map((initial, index) => (
          <Typography
            // Three of the seven initials repeat, so the index is the key.
            key={index}
            variant="body2"
            color="text.secondary"
            align="center"
          >
            {initial}
          </Typography>
        ))}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 0.5 }}>
        {cells.map((cell) => {
          const isSelected = cell.dateISO === selected
          return (
            <ButtonBase
              key={cell.dateISO}
              onClick={() => onSelect(cell.dateISO)}
              aria-label={cell.dateISO}
              aria-current={isSelected ? 'date' : undefined}
              sx={{ borderRadius: '50%', py: 0.5, flexDirection: 'column' }}
            >
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: isSelected ? 'primary.main' : 'transparent',
                  color: isSelected
                    ? 'primary.contrastText'
                    : // A padding day belongs to a neighbouring month: still
                      // reachable, but visibly not part of this one.
                      cell.inMonth
                      ? 'text.primary'
                      : 'text.secondary',
                  opacity: cell.inMonth || isSelected ? 1 : 0.5,
                }}
              >
                <Typography variant="body2">{cell.day}</Typography>
              </Box>
              <Box
                aria-hidden
                sx={{
                  width: 5,
                  height: 5,
                  mt: 0.25,
                  borderRadius: '50%',
                  bgcolor: markers[cell.dateISO] ? `task.${markers[cell.dateISO]}` : 'transparent',
                }}
              />
            </ButtonBase>
          )
        })}
      </Box>
    </Box>
  )
}
