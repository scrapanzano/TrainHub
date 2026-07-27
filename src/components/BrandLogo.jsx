import { useTheme } from '@mui/material/styles'

/** The TH monogram from doc/assets/components/Logo.png, as inline SVG. */
export default function BrandLogo({ size = 32 }) {
  const theme = useTheme()
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" role="img" aria-label="TrainHub">
      <path d="M96 128h176v44h-66v212h-44V172h-66z" fill={theme.palette.text.primary} />
      <g fill={theme.palette.primary.main}>
        <rect x="296" y="128" width="44" height="256" />
        <rect x="372" y="128" width="44" height="256" />
        <rect x="296" y="234" width="120" height="44" />
      </g>
      <g fill={theme.palette.background.paper}>
        <rect x="316" y="246" width="80" height="20" rx="10" />
        <rect x="302" y="234" width="14" height="44" rx="7" />
        <rect x="396" y="234" width="14" height="44" rx="7" />
      </g>
    </svg>
  )
}
