// NorthKit service worker (S3-6, ADR 0004). Keeps what a phone needs to check kit out and in,
// report it missing and count a location with no signal: the app's static files, and the
// phone screens the person has opened (or that a screen asked it to keep). It never caches
// API calls or any other page, and never holds unsent work: that lives in IndexedDB, sent by
// the page. Same origin only; nothing is fetched from anywhere else. The offline copy pattern
// is NorthKeep's service worker, copied and trimmed to these screens (see the CHANGELOG).

const VERSION = 'v1';
const STATIC = `northkit-static-${VERSION}`;
const PAGES = `northkit-pages-${VERSION}`;

// The screens that work offline: the move hub, check out, check in, report missing, My kit,
// the stocktake list and the counting screen (one page serves every count), and the list of
// changes not sent yet.
const OFFLINE_PAGE = /^\/(move(\/(out|in|missing))?|my-kit|stocktake(\/count)?|sync)\/?$/;
const STATIC_FILE =
  /^\/(_next\/static\/|fonts\/|favicon|icon|apple-touch-icon|mark\.svg|manifest\.webmanifest)/;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith('northkit-') && name !== STATIC && name !== PAGES)
          await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const key = request.url.split('?')[0];
  try {
    const response = await fetch(request);
    // Only a real page: never a sign-in redirect or an error saved as the offline copy.
    if (response.ok && !response.redirected) cache.put(key, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (STATIC_FILE.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else if (request.mode === 'navigate' && OFFLINE_PAGE.test(url.pathname)) {
    event.respondWith(networkFirst(request, PAGES));
  }
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  // A page that loaded while this worker was installing is missed by the claim in `activate`
  // and would stay uncontrolled until a reload; it asks to be claimed instead
  // (lib/offline/ready.ts). Claiming again is harmless for pages already controlled.
  if (data.type === 'claim') event.waitUntil(self.clients.claim());
  // A screen asks for itself to be kept; the reply (if a port came with it) says how many are kept.
  if (data.type === 'keep-pages' && Array.isArray(data.paths)) {
    const reply = event.ports && event.ports[0];
    event.waitUntil(
      (async () => {
        const cache = await caches.open(PAGES);
        let kept = 0;
        for (const path of data.paths.slice(0, 20)) {
          if (typeof path !== 'string' || !OFFLINE_PAGE.test(path)) continue;
          const key = new URL(path, self.location.origin).href;
          try {
            const response = await fetch(path, { credentials: 'same-origin' });
            if (response.ok && !response.redirected) {
              await cache.put(key, response);
              kept += 1;
              continue;
            }
          } catch {
            // Offline already: the pages kept earlier stay.
          }
          if (await cache.match(key)) kept += 1;
        }
        if (reply) reply.postMessage({ kept });
      })(),
    );
  }
  // Signing out: forget the kept pages, which hold the person's name and depots.
  if (data.type === 'forget-pages') event.waitUntil(caches.delete(PAGES));
});
