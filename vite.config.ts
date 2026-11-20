
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      registerType: 'autoUpdate',

      includeAssets: ['mpr-apple-touch-icon.png'],

      manifest: {
        name: 'MPR | Event Management',
        short_name: 'MPR',
        description: 'MPR Convention and Event Management Portal',
        theme_color: '#101827',
        background_color: '#101827',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',

        icons: [
          {
            src: '/mpr-icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/mpr-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/mpr-icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },

      workbox: {
        globPatterns: [
          '**/*.{js,css,html,ico,png,svg,woff2}'
        ]
      }
    })
  ]
});
