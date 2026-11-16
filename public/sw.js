'use strict';

// Service worker: makes Flix installable and lets the installed app open
// without a connection. Only same-origin static files are cached; /api/* and
// third-party requests (TMDB images, embeds) always go to the network.

const CACHE = 'flix-v1';
const SHELL = ['/', '/favicon.svg', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function put(request, response) {
  if (!response.ok) return;
  const cache = await caches.open(CACHE);
  const url = new URL(request.url);
  // CSS/JS URLs carry a ?v= content hash: drop older versions of the same file.
  if (url.search) {
    for (const old of await cache.keys()) {
      const o = new URL(old.url);
      if (o.pathname === url.pathname && o.search !== url.search) await cache.delete(old);
    }
  }
  await cache.put(request, response);
}

// Pages: network first so a deploy shows up straight away; cached shell offline.
async function page(event) {
  try {
    const res = await fetch(event.request);
    if (new URL(event.request.url).pathname === '/') event.waitUntil(put(new Request('/'), res.clone()));
    return res;
  } catch {
    return (await caches.match('/')) || Response.error();
  }
}

// Versioned assets never change, so the cache wins; everything else is
// served from cache and refreshed in the background.
async function asset(event) {
  const cached = await caches.match(event.request);
  const versioned = new URL(event.request.url).searchParams.has('v');
  if (cached && versioned) return cached;
  const network = fetch(event.request).then((res) => {
    event.waitUntil(put(event.request, res.clone()));
    return res;
  });
  if (cached) {
    event.waitUntil(network.catch(() => {}));
    return cached;
  }
  return network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') event.respondWith(page(event));
  else event.respondWith(asset(event));
});
