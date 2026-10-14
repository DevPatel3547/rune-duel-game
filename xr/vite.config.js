import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Installable-app config. Precache the app shell + core code; the big lazy 3D
// environment/emulator chunks are cached on first use (CacheFirst) instead of
// bloating the initial service-worker install.
// Where the site is served from. A GitHub Pages *project* site lives under
// /<repo>/, not at the domain root, so every asset URL — and, critically, the
// PWA manifest's id/scope/start_url and the service worker's navigate fallback
// — has to be prefixed or the installed app resolves to the wrong paths.
// Set at build time; defaults to root so local dev and any root-domain host
// are unaffected.
const BASE = process.env.VITE_BASE || '/';

// Building for the native iOS app (Capacitor). The app bundles every asset
// already, and WKWebView does not run service workers for app-scheme pages, so
// the offline PWA layer is left out rather than failing to register.
const NATIVE = !!process.env.VITE_NATIVE;

const pwa = VitePWA({
  registerType: 'autoUpdate',
  includeAssets: ['favicon-32.png', 'apple-touch-icon.png'],
  manifest: {
    name: 'Rune Duel — draw to cast',
    short_name: 'Rune Duel',
    description: 'Draw runes with your finger or mouse to cast spells and out-duel the wizard across the arena. No headset.',
    id: BASE,
    start_url: BASE,
    scope: BASE,
    display: 'standalone',
    orientation: 'any',
    theme_color: '#0a0612',
    background_color: '#0a0612',
    categories: ['games'],
    icons: [
      { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    // wizard.glb is the character mesh — precached so the opponent is never a
    // missing model on a cold or offline start.
    // Scanned textures are runtime-cached, NOT precached: ~3MB of material would
    // triple the service worker's install payload and delay first interaction,
    // and the game is fully playable while they stream in.
    // woff2 is precached deliberately: type is structural, and a UI that repaints
    // into its real face a second after load reads as broken.
    globPatterns: ['**/*.{css,html,woff2,json}', 'assets/index-*.js', 'assets/practice-*.js', '*.png', '*.glb', 'fonts/*.woff2'],
    maximumFileSizeToCacheInBytes: 3_000_000,
    navigateFallback: `${BASE}index.html`.replace('//', '/'),
    cleanupOutdatedCaches: true,
    runtimeCaching: [
      {
        // big lazily-loaded chunks (3D env rooms, xr emulator, online driver…)
        urlPattern: ({ request }) => request.destination === 'script',
        handler: 'CacheFirst',
        options: { cacheName: 'rd-chunks', expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 } },
      },
      {
        urlPattern: ({ request }) => request.destination === 'image' || request.destination === 'font',
        handler: 'CacheFirst',
        options: { cacheName: 'rd-assets', expiration: { maxEntries: 80 } },
      },
      {
        // the scanned PBR set — cached hard on first use so offline play keeps
        // full fidelity after one visit
        urlPattern: ({ url }) => url.pathname.includes('/tex/'),
        handler: 'CacheFirst',
        options: { cacheName: 'rd-tex', expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 60 } },
      },
    ],
  },
});

// Flat-screen first: the 3D game runs on plain http://localhost (and your LAN IP
// for phones) — no cert wall, loads instantly with mouse/touch drawing. Optional
// VR is opt-in via `npm run dev:vr` (WebXR needs https; that script enables a
// self-signed cert).
export default defineConfig(async () => {
  let httpsPlugin = null;
  if (process.env.RD_HTTPS) {
    try {
      const mod = await import('@vitejs/plugin-basic-ssl');
      httpsPlugin = mod.default();
    } catch {
      httpsPlugin = null;
    }
  }

  return {
    base: BASE,
    plugins: [react(), ...(NATIVE ? [] : [pwa]), ...(httpsPlugin ? [httpsPlugin] : [])],
    // Ensure a single copy of three across drei / fiber / xr.
    resolve: { dedupe: ['three', '@react-three/fiber'] },
    server: {
      host: true, // expose on the LAN so a phone on the same wifi can play
      proxy: {
        '/socket.io': { target: 'http://localhost:3001', ws: true },
        '/health': { target: 'http://localhost:3001' },
      },
    },
    build: {
      chunkSizeWarningLimit: 1600, // three.js is large
    },
  };
});
