const ALIAS = /^\{(.+)\}$/

// Figma exports a nested tree; we want flat dotted keys.  A node is a token
// when it carries `$value`, otherwise it is a group to descend into.  Keys
// starting with `$` are Figma's own metadata and never tokens.
function flatten(node, prefix, out) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$')) continue
    if (!value || typeof value !== 'object') continue

    const path = prefix ? `${prefix}.${key}` : key
    if ('$value' in value) {
      out[path] = value.$value
    } else {
      flatten(value, path, out)
    }
  }
}

/**
 * Flattens a W3C design-token export and resolves `{Group.Name}` aliases
 * down to the hex string they ultimately point at.
 *
 * @param {object} raw Parsed contents of a Figma variables export.
 * @returns {Record<string, string>} Dotted key -> hex colour.
 */
export function resolveTokens(raw) {
  const flat = {}
  flatten(raw, '', flat)

  // `resolving` tracks the current chain only, so a token referenced twice
  // from different places is fine while a genuine cycle still throws.
  const resolving = new Set()

  const deref = (key) => {
    if (!(key in flat)) throw new Error(`Unknown token reference "${key}"`)

    const value = flat[key]
    if (typeof value !== 'string') return value.hex

    const alias = value.match(ALIAS)
    if (!alias) return value

    if (resolving.has(key)) throw new Error(`Circular token alias at "${key}"`)
    resolving.add(key)
    try {
      return deref(alias[1])
    } finally {
      resolving.delete(key)
    }
  }

  return Object.fromEntries(Object.keys(flat).map((key) => [key, deref(key)]))
}
