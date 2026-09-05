import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Regenerate every PNG in public/ from public/logo.svg:
//
//   npx pwa-assets-generator
//
// A one-off, not a build step: the icons are committed. The package arrives as
// an optional peer of vite-plugin-pwa, so it is already installed and is not
// listed in package.json.
//
// Only the padding is interesting here. The preset's default is 0.3 for every
// asset type, which is why the first icon set drew the mark at 44% of the
// square and looked lost inside the OS container. Each number below is the
// largest that still satisfies the platform that consumes that asset.
export default defineConfig({
  images: ['public/logo.svg'],
  preset: {
    // pwa-64/192/512 and favicon.ico. Nothing masks these, so logo.svg's own
    // 84% fill is the final geometry and no further padding is wanted.
    transparent: { ...minimal2023Preset.transparent, padding: 0 },

    // Android may crop a maskable icon to anything inside the centred circle of
    // 80% diameter, so the mark's *diagonal* is what has to fit: 529 units at
    // full size against a 410-unit circle, hence 0.77 scale.
    maskable: {
      ...minimal2023Preset.maskable,
      padding: 0.23,
      resizeOptions: { background: '#FFFFFF' },
    },

    // iOS rounds the corners rather than cropping, and forbids transparency.
    // A little breathing room keeps the mark clear of the corner radius.
    apple: {
      ...minimal2023Preset.apple,
      padding: 0.06,
      resizeOptions: { background: '#FFFFFF' },
    },
  },
})
