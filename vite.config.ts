
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      registerType: 'autoUpdate',

      includeAssets: ['mpr-icon.svg'],

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
            src: '/mpr-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any'
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
