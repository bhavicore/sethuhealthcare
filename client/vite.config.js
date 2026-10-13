import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  server: {
    // In development the app and API share one origin: /api goes to the server.
    proxy: {
      '/api': process.env.SETHU_API_URL || 'http://localhost:4000',
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Sethu — Offline-First Health Referrals',
        short_name: 'Sethu',
        description:
          'Log PHC patient visits and generate QR referral cards that work with zero connectivity.',
        theme_color: '#0b5566',
        background_color: '#f6f8f9',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // App shell + JS/CSS precached so the app itself loads with zero connectivity;
        // patient data lives in IndexedDB (see src/lib/db.js), not in this cache.
        globPatterns: ['**/*.{js,css,html,svg,ico,png}'],
        // API calls must always reach the server, never the SPA fallback.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
})
