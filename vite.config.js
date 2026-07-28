import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Vite rejects any request whose Host header it does not recognise, which is a
// DNS-rebinding guard, not a nuisance: without it a page on the internet could
// point a hostname at 127.0.0.1 and read this dev server's responses.  A tunnel
// forwards the ngrok hostname untouched, so the tunnel has to be named here or
// every request comes back "Blocked request. This host is not allowed."
//
// A leading dot matches the domain and all its subdomains, so this covers the
// static domain and the throwaway one `ngrok http 4173` mints without `--url`
// -- without pinning our own domain into a tracked file.  `.dev` is what free
// static domains use today; `.app` is what random tunnels still hand out.
const TUNNEL_HOSTS = ['.ngrok-free.dev', '.ngrok-free.app']

// https://vite.dev/config/
export default defineConfig({
  // `preview` is the one that matters: the service worker only exists in a
  // production build, so every PWA test on a real phone goes through here.
  // `server` is listed too for the occasional tunnelled dev session -- the two
  // have separate host lists and neither inherits the other.
  server: { allowedHosts: TUNNEL_HOSTS },
  preview: {
    allowedHosts: TUNNEL_HOSTS,
    // Default is `localhost`, which Node resolves to ::1 only on Windows, so
    // anything reaching for 127.0.0.1 is refused.  Binding every interface
    // fixes that and makes the server reachable from a phone on the same
    // Wi-Fi.  The Host check above still applies -- Vite waives it only for
    // literal IP addresses, which is what a LAN client sends.
    host: true,
  },
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
