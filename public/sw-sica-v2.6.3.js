// ── SICA Capture SW Kill Switch v2.6.3 → v2.6.4 ──────────────
// Reemplaza el SW anterior para forzar actualización inmediata en
// todos los dispositivos con la versión cacheada v2.6.3.
// NO borra IndexedDB — los datos pendientes de sync se preservan.

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 1. Limpiar todos los caches de assets estáticos
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys.map(key => caches.delete(key)));

    // 2. Tomar control inmediato de todos los clientes
    await self.clients.claim();

    // 3. Forzar recarga en cada pestaña/ventana abierta
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach(client => client.navigate(client.url));
  })());
});

// Sin intercepción de fetch — todo va directo a la red
self.addEventListener('fetch', () => { return; });
