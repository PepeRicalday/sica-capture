import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

// Fuente única de la versión: package.json. Antes estaba escrita a mano aquí,
// en el nombre del SW y en el <title> de index.html; los tres se desincronizaron
// (config decía 2.6.6, index.html 2.6.1 y package.json 2.6.4 en el mismo build).
// Con VersionGuard comparando versiones, esa deriva es grave: la app se anuncia
// con una versión que no es la publicada y el refresco forzado nunca dispara.
const APP_VERSION = pkg.version

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const supabaseUrl = env.VITE_SUPABASE_URL || 'https://dumfyrgwnshcgeibffvr.supabase.co'
  const escapedUrl = supabaseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return {
    define: {
      '__V2_APP_VERSION__': JSON.stringify(APP_VERSION),
      '__V2_BUILD_HASH__': JSON.stringify(`v${APP_VERSION}`),
      '__BUILD_DATE__': JSON.stringify(new Date().toISOString())
    },
    server: {
      host: true, // Expone el servidor a la red local (WIFI)
      port: 5176,
    },
    plugins: [
      react(),
      // basicSsl(): desactivado en local para evitar bloqueos de certificado.
      // Sustituye %APP_VERSION% en index.html para que el <title> siga a package.json.
      {
        name: 'html-app-version',
        transformIndexHtml(html: string) {
          return html.replace(/%APP_VERSION%/g, APP_VERSION)
        }
      },
      VitePWA({
        registerType: 'autoUpdate',
        filename: `sw-sica-v${APP_VERSION}.js`,
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
          // woff2 únicamente — los navegadores modernos no necesitan woff legacy
          globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
          // index.html se sirve SIEMPRE desde la red (NetworkFirst más abajo).
          // Es el documento que apunta a los chunks con hash; si queda cacheado,
          // la tableta sigue pidiendo chunks que ya no existen en el servidor
          // y nunca alcanza la versión nueva.
          navigateFallback: null,
          globIgnores: [
            // index.html FUERA del precache: precacheado, el dispositivo queda
            // anclado a una lista de chunks que el servidor ya borró (404).
            'index.html',
            // Kill switches de versiones anteriores (sw-sica-v2.6.1.js, v2.6.3).
            // NO se borran: un equipo anclado en 2.6.3 tiene registrado ese
            // nombre exacto, y al revalidarlo recibe el kill switch que lo purga
            // y recarga. Borrarlos daría 404 y dejaría a esos equipos huérfanos
            // sin ruta de recuperación. Solo se excluyen del precache, para no
            // arrastrarlos como assets de la versión vigente.
            'sw-sica-v*.js',
          ],
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          // El navegador SIEMPRE revalida el SW contra la red, así que este
          // archivo es el único punto de entrada que no puede quedar atrapado
          // en caché. Al activarse una versión nueva, purga todo lo anterior.
          importScripts: ['/sw-purge.js'],
          runtimeCaching: [
            // Documento de navegación — SIEMPRE red primero, para que las
            // referencias a los chunks vigentes se revaliden en cada carga.
            // La caché solo actúa como respaldo sin conexión.
            {
              urlPattern: ({ request }: { request: Request }) => request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'sica-capture-html-cache',
                networkTimeoutSeconds: 5,
                expiration: { maxEntries: 5 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            // Catálogos (puntos, módulos, zonas): NetworkFirst con respaldo
            // amplio. En campo la conexión cae y el operador debe poder
            // seguir capturando contra el último catálogo conocido.
            {
              urlPattern: new RegExp(`^${escapedUrl}\\/rest\\/v1\\/(puntos|modulos|zonas|modulo_zonas|ciclos_agricolas).*`),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'sica-capture-catalogos-cache',
                networkTimeoutSeconds: 6,
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 60 * 60 * 24 * 7,   // 7 días
                },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            // Resto de la API Supabase — NetworkFirst, 24 h.
            {
              urlPattern: new RegExp(`^${escapedUrl}\\/rest\\/v1\\/.*`),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'supabase-api-cache',
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 60 * 60 * 24,
                },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ]
        },
        devOptions: {
          enabled: false,   // NUNCA activar en dev — causa loops infinitos
          type: 'module'
        }
      })
    ],
    build: {
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks: {
            // Vendors pesados — cargados solo cuando la ruta los necesita
            'vendor-supabase': ['@supabase/supabase-js'],
            'vendor-leaflet': ['leaflet', 'react-leaflet'],
            'vendor-recharts': ['recharts'],
            'vendor-dexie': ['dexie', 'dexie-react-hooks'],
          },
        },
      },
    }
  }
})
