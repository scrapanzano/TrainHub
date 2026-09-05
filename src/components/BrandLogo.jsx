import Box from '@mui/material/Box'
import { useTheme } from '@mui/material/styles'

/**
 * The TH monogram from `doc/assets/components/Logo.png`, as inline SVG, drawn
 * in the brand asset's own 269x192 space so the shape here and the shape in
 * `public/logo.svg` cannot drift.
 *
 * The T is painted twice: a fat background-coloured stroke first, cutting the
 * gap the brand asset keeps between the T and the H behind it, then the fill on
 * top so the dark edge lands where the asset puts it rather than half a stroke
 * inside it. That makes the component background-dependent, which is fine while
 * it only ever sits on `background.default`; a use over `paper` would need the
 * gap colour passed in.
 *
 * @param {object} props
 * @param {string|number} [props.width] Any CSS width. The height follows from
 *                                      the viewBox, so callers size one axis.
 */
export default function BrandLogo({ width = 160 }) {
  const theme = useTheme()
  const gap = theme.palette.background.default
  const t = 'M26 0h133v6a26 26 0 0 1-26 26H96v160H64V32H0v-6A26 26 0 0 1 26 0z'

  return (
    <Box
      component="svg"
      viewBox="0 0 269 192"
      role="img"
      aria-label="TrainHub"
      sx={{ width, height: 'auto', display: 'block' }}
    >
      <g fill={theme.palette.primary.main}>
        <rect x="128" y="0" width="32" height="192" />
        <path d="M224 0h32v160a32 32 0 0 1-32 32z" />
        <rect x="128" y="80" width="128" height="32" />
        <rect x="115" y="84" width="10" height="24" rx="5" />
        <rect x="259" y="84" width="10" height="24" rx="5" />
      </g>
      <g fill={gap}>
        <rect x="125" y="79" width="12" height="34" rx="6" />
        <rect x="247" y="79" width="12" height="34" rx="6" />
        <rect x="139" y="74" width="10" height="44" rx="5" />
        <rect x="235" y="74" width="10" height="44" rx="5" />
        <rect x="139" y="91" width="106" height="10" rx="5" />
      </g>
      <path d={t} fill={gap} stroke={gap} strokeWidth="7" strokeLinejoin="round" />
      <path d={t} fill={theme.palette.text.primary} />
    </Box>
  )
}
