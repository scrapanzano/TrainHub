import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveTokens } from './resolveTokens.js'

const raw = JSON.parse(
  readFileSync(new URL('../../doc/assets/variables.tokens.json', import.meta.url)),
)
const tokens = resolveTokens(raw)

// A literal colour comes through as its hex string.
assert.equal(tokens['Color.Brand'], '#FE6363')

// A one-hop alias resolves to its target's hex.  Bg.Secondary -> {Color.Gray-Light}
assert.equal(tokens['Bg.Secondary'], '#F9FAFB')

// An alias can point at a token that lives at the top level, not inside a group.
// Border.Primary -> {Gray-Border}
assert.equal(tokens['Border.Primary'], '#E5E7EB')

// Groups nest arbitrarily deep.
assert.equal(tokens['Theme.Status.Suspended'], '#8794AF')

// Keys carrying spaces survive intact.
assert.equal(tokens['Task.Nutrition Consultation'], '#D9FFE4')

// Figma's own metadata keys are not tokens.
assert.ok(!('$extensions' in tokens))

// A dangling reference is a design-file bug and must be loud, not silently undefined.
assert.throws(
  () => resolveTokens({ A: { $type: 'color', $value: '{Nope.Missing}' } }),
  /Unknown token reference "Nope.Missing"/,
)

// A cycle would otherwise blow the stack.
assert.throws(
  () =>
    resolveTokens({
      A: { $type: 'color', $value: '{B}' },
      B: { $type: 'color', $value: '{A}' },
    }),
  /Circular token alias/,
)

console.log(`resolveTokens: OK (${Object.keys(tokens).length} tokens)`)
