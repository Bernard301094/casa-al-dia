importScripts('push-worker.js');
const cacheName = 'casa-shell-v10';
const assets = ['app.css','style.css?v=10','app.js?v=10','casa-icon-32.png','casa-icon-180.png','casa-icon-192.png?v=9','casa-icon-512.png','manifest.webmanifest'];
self.addEventListener('install',event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets)).then(() => self.skipWaiting()));
});
self.addEventListener('activate',event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('casa-shell-') && key !== cacheName).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch',event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !assets.some(asset => new URL(asset,self.registration.scope).href === url.href)) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
