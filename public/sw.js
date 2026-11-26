/*
 * Service worker de Viajo: app instalable + uso sin conexión + Web Push.
 *
 * CACHÉS (versionados con VERSION; al activar se borran los "viajo-*" que no sean de esta versión):
 *   viajo-shell-<v>   HTML (clave única = raíz del scope), manifest e íconos.
 *   viajo-assets-<v>  assets hasheados de Vite (assets/*), tope MAX_ASSETS (los más viejos salen primero).
 *   viajo-data-<v>    public/data/*.json (índice + una línea por archivo).
 *   viajo-tiles-<v>   teselas vectoriales de tiles.openfreemap.org, tope MAX_TILES con LRU simple.
 *   viajo-mapres-<v>  glyphs, sprites y TileJSON/estilo, tope MAX_MAPRES.
 *
 * ESTRATEGIAS:
 *   HTML / navegación ......... network-first (timeout 4 s) con fallback al HTML cacheado.
 *   assets/* (hasheados) ...... cache-first (el hash cambia con el contenido: nunca quedan viejos).
 *   data/*.json ............... stale-while-revalidate.
 *   manifest, íconos, resto ... stale-while-revalidate.
 *   teselas / glyphs / sprites  cache-first con tope; TileJSON (/planet) network-first.
 *   API del municipio (ws.rosario.gob.ar), worker de push y cualquier otro origen:
 *      NO se intercepta (ni respondWith ni caché): los datos en vivo son siempre frescos.
 *
 * ASSETS HASHEADOS SIN MANIFEST: Vite no genera un precache manifest, así que se descubren así:
 *   1) en "install" se baja el HTML y se extraen con regex las URLs a assets/ (script, css, modulepreload);
 *   2) todo lo demás (chunks dinámicos, worker de maplibre) entra a la caché la primera vez que se pide
 *      (cache-first en runtime). Los hashes viejos se podan por tope de entradas y al subir VERSION.
 *
 * ACTUALIZACIÓN: no hay skipWaiting automático; la página avisa "Hay una versión nueva · Actualizar"
 *   y, al tocar, envía {type:'SKIP_WAITING'}; el SW nuevo toma el control y la página recarga.
 *   En la primera instalación no hay SW previo, así que activa solo. El push no se ve afectado.
 */
const VERSION = 'v1';
const SHELL = `viajo-shell-${VERSION}`;
const ASSETS = `viajo-assets-${VERSION}`;
const DATA = `viajo-data-${VERSION}`;
const TILES = `viajo-tiles-${VERSION}`;
const MAPRES = `viajo-mapres-${VERSION}`;
const CURRENT = [SHELL, ASSETS, DATA, TILES, MAPRES];
const MAX_TILES = 300;
const MAX_MAPRES = 150;
const MAX_ASSETS = 60;
const NAV_TIMEOUT = 4000;

const scopeUrl = () => self.registration.scope; // p. ej. https://host/viajo/
const rel = (p) => new URL(p, scopeUrl()).href;

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys(); // orden de inserción: los más viejos primero
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    const assets = await caches.open(ASSETS);
    const pre = [];
    try {
      const res = await fetch(scopeUrl(), { cache: 'no-cache' });
      if (res.ok) {
        const html = await res.clone().text();
        await shell.put(scopeUrl(), res);
        for (const m of html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)) pre.push(new URL(m[1], scopeUrl()).href);
      }
    } catch { /* sin red al instalar: se arma en runtime */ }
    await Promise.allSettled([
      ...['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'].map((p) => shell.add(rel(p))),
      ...pre.map((u) => assets.add(u)),
      caches.open(DATA).then((c) => c.add(rel('data/lineas.json'))),
    ]);
    // Sin skipWaiting: la actualización la dispara el usuario (mensaje SKIP_WAITING).
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('viajo-') && !CURRENT.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ------------------------------------------------------------ estrategias */
const okToCache = (res) => res && res.ok && res.status === 200;

async function networkFirstNav(request) {
  const cache = await caches.open(SHELL);
  const key = scopeUrl();
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), NAV_TIMEOUT)),
    ]);
    if (okToCache(res)) cache.put(key, res.clone());
    return res;
  } catch {
    const hit = await cache.match(key);
    if (hit) return hit;
    return fetch(request); // sin caché: que el navegador siga o muestre su error
  }
}

async function cacheFirst(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) {
    if (max) { // LRU simple: re-insertar para que quede al final del orden
      await cache.delete(request);
      await cache.put(request, hit.clone());
    }
    return hit;
  }
  const res = await fetch(request);
  if (okToCache(res)) {
    await cache.put(request, res.clone());
    if (max) await trim(cacheName, max);
  }
  return res;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (okToCache(res)) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw e;
  }
}

async function staleWhileRevalidate(event, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(event.request);
  const net = fetch(event.request).then((res) => {
    if (okToCache(res)) cache.put(event.request, res.clone());
    return res;
  });
  if (hit) { event.waitUntil(net.catch(() => {})); return hit; }
  return net;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);

  // Teselas y recursos del mapa (OpenFreeMap)
  if (url.hostname === 'tiles.openfreemap.org') {
    if (/\.(pbf|mvt)$/.test(url.pathname) || /\/\d+\/\d+\/\d+(\.\w+)?$/.test(url.pathname)) {
      event.respondWith(cacheFirst(req, TILES, MAX_TILES));
    } else if (url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/sprites/')) {
      event.respondWith(cacheFirst(req, MAPRES, MAX_MAPRES));
    } else {
      event.respondWith(networkFirst(req, MAPRES)); // TileJSON / estilo: pueden cambiar de versión
    }
    return;
  }

  // Cualquier otro origen (API del municipio, worker de push, etc.): nunca se cachea.
  if (url.origin !== self.location.origin) return;
  if (!url.href.startsWith(scopeUrl())) return;
  const path = url.pathname.slice(new URL(scopeUrl()).pathname.length); // relativo al scope

  if (path === 'sw.js') return; // lo gestiona el navegador (chequeo de actualización)

  if (req.mode === 'navigate' || path === '' || path === 'index.html') {
    event.respondWith(networkFirstNav(req));
  } else if (path.startsWith('assets/')) {
    event.respondWith(cacheFirst(req, ASSETS, MAX_ASSETS));
  } else if (path.startsWith('data/')) {
    event.respondWith(staleWhileRevalidate(event, DATA));
  } else {
    event.respondWith(staleWhileRevalidate(event, SHELL));
  }
});

/* ------------------------------------------------------------ push (sin cambios) */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: 'Viajo', body: event.data ? event.data.text() : '' }; }
  event.waitUntil(
    self.registration.showNotification(d.title || 'Viajo', {
      body: d.body || '',
      tag: d.tag || 'viajo',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: d.url || './' },
      renotify: true,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) { c.navigate?.(url); return c.focus(); }
      return self.clients.openWindow(url);
    }),
  );
});
