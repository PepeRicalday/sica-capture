import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json'

export default defineConfig({
  define: {
    '__APP_VERSION__': JSON.stringify(pkg.version),
    '__BUILD_HASH__': JSON.stringify('v2.5.2-audit-p2'),
    '__BUILD_DATE__': JSON.stringify(new Date().toISOString())
  },
  server: {
    host: true, // Expone el servidor a la red local (WIFI)
    port: 5176,
  },
  plugins: [
    react(),
    // basicSsl(), // Desactivado para local para evitar bloqueos de certificado en el navegador
    VitePWA({
      registerType: 'autoUpdate',
      filename: 'sw-sica-v2.5.2.js',
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
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        // CRÍTICO: skipWaiting fuerza al nuevo SW a tomar el control inmediatamente
        skipWaiting: true,
        clientsClaim: true,
        // Limpiar caches viejos automáticamente
        cleanupOutdatedCaches: true
      },
      devOptions: {
        enabled: false,   // NUNCA activar en dev — causa loops infinitos
        type: 'module'
      }
    })
  ],
  build: {
    chunkSizeWarningLimit: 1000
  }
})
