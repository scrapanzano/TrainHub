import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'TrainHub',
        short_name: 'TrainHub',
        description: 'A PWA for bridging the gap between gym members and fitness professionals.',
        theme_color: '#FE6363',
        background_color: '#F9FAFB',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'en',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        // Icons and favicons already reach the precache through `includeAssets`
        // and `manifest.icons`, so sweeping png/ico/svg here too would list them
        // twice -- and would drag in `logo.svg` (only the icon generator's
        // source) and `icons.svg` (an unrelated leftover), neither of which is
        // ever served.
        //
        // Inter ships seven unicode-range subsets.  A browser only downloads
        // the ones it needs, but precaching defeats that and would fetch all
        // seven up front -- ~90 KiB of Cyrillic, Greek and Vietnamese glyphs
        // that an English/Italian app will never render.
        globPatterns: ['**/*.{js,css,html}', 'assets/inter-latin*.woff2'],
      },
      devOptions: { enabled: false, type: 'module' },
    })
  ]
})
