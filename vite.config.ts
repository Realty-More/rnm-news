/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// YouTube feeds send no CORS headers, so during local work the dev server fetches them for the app.
const youtubeProxy = {
  '/yt': {
    target: 'https://www.youtube.com',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/yt/, ''),
  },
}

export default defineConfig({
  // Relative base: works on GitHub Pages project paths and inside the Capacitor Android shell.
  base: './',
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev') },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeManifestIcons: false,
      injectRegister: false,
      manifest: {
        id: './',
        name: 'Realtynmore',
        short_name: 'Realtynmore',
        description: 'Indian real estate news, interviews, videos and podcasts from RealtyNMore.',
        lang: 'en-IN',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#141416',
        theme_color: '#141416',
        categories: ['news', 'business'],
        // Long-press the app icon for these.
        shortcuts: [
          { name: 'Latest news', short_name: 'Latest', url: './#/news', icons: [{ src: 'icons/shortcut-news.png', sizes: '96x96', type: 'image/png' }] },
          { name: 'Videos', short_name: 'Videos', url: './#/videos', icons: [{ src: 'icons/shortcut-videos.png', sizes: '96x96', type: 'image/png' }] },
          { name: 'Search', short_name: 'Search', url: './#/search', icons: [{ src: 'icons/shortcut-search.png', sizes: '96x96', type: 'image/png' }] },
          { name: 'Saved stories', short_name: 'Saved', url: './#/saved', icons: [{ src: 'icons/shortcut-saved.png', sizes: '96x96', type: 'image/png' }] },
        ],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Only the Latin font files are needed for English headlines.
        globIgnores: ['**/*{cyrillic,greek,vietnamese,latin-ext}*'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // Breaking-news notifications (push and notificationclick handlers).
        importScripts: ['push-sw.js'],
        runtimeCaching: [
          {
            // Read-only news API: fresh first, cached copy when offline or slow.
            urlPattern: ({ url, request }) =>
              request.method === 'GET' &&
              url.origin === 'https://realtynmore.com' &&
              url.pathname.startsWith('/wp-json/wp/v2/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'rnm-api',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 150, maxAgeSeconds: 5 * 24 * 60 * 60, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url }) =>
              url.origin === 'https://realtynmore.com' && url.pathname.startsWith('/wp-content/uploads/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'rnm-images',
              // Some uploads (e.g. .avif) are served without CORS headers, so opaque responses (status 0) are allowed.
              expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'i.ytimg.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'yt-thumbs',
              expiration: { maxEntries: 120, maxAgeSeconds: 14 * 24 * 60 * 60, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.endsWith('/data/youtube.json'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'yt-feed',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 2, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  server: { port: 5173, proxy: youtubeProxy },
  preview: { port: 4173, proxy: youtubeProxy },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
})
