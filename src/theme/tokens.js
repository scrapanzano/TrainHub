import raw from '../../doc/assets/variables.tokens.json'
import { resolveTokens } from './resolveTokens.js'

// Imported straight from `doc/` on purpose: the Figma export stays the single
// source of truth, so re-exporting variables cannot leave the app behind.
export const tokens = resolveTokens(raw)
