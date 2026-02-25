import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'
import pkg from './package.json'

const buildHash = Date.now().toString(36);

export default defineConfig({
  define: {
    '__APP_VERSION__': JSON.stringify(pkg.version),
    '__BUILD_HASH__': JSON.stringify(buildHash),
    '__BUILD_DATE__': JSON.stringify(new Date().toISOString())
  },
  server: {
    host: true, // Expone el servidor a la red local (WIFI)
    port: 5174,
  },
  plugins: [
    react(),
    basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      filename: 'sw-v113.js',
      manifest: {
        name: 'SICA Captura | S.R.L. Unidad Conchos',
        short_name: 'SICA Captura',
        description: 'Aplicación operativa oficial S.R.L. Unidad Conchos',
        theme_color: '#0b1120',
        background_color: '#0b1120',
        display: 'standalone',
        icons: [
          { src: '/icon.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024 // 10 MiB limit to accommodate large logos
      },
      devOptions: {
        enabled: true,
        type: 'module'
      }
    })
  ],
  build: {
    chunkSizeWarningLimit: 1000
  }
})
