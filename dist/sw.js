importScripts('push-worker.js');
const cacheName = 'casa-shell-v24';
const root = new URL(self.registration.scope);
const scoped = path => new URL(path,root).href;
const shell = scoped('index.html');
const assets = ['app.css','style.css?v=24','app.js?v=24','firebase-config.js','casa-icon-32.png',
  'casa-icon-180.png','casa-icon-192.png?v=9','casa-icon-512.png','manifest.webmanifest'].map(scoped);

self.addEventListener('install',event => {
  event.waitUntil((async()=>{
    const cache=await caches.open(cacheName);
    await cache.addAll(assets);
    const page=await fetch(root.href,{cache:'reload'});
    if (!page.ok || !(await page.clone().text()).includes('data-casa-shell')) throw new Error('App shell unavailable');
    await cache.put(shell,page);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('casa-shell-') && key !== cacheName).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch',event => {
  const request=event.request;
  if (request.method!=='GET') return;
  const url=new URL(request.url);
  if (request.mode==='navigate' && url.origin===root.origin &&
      [root.pathname,new URL(shell).pathname].includes(url.pathname)) {
    event.respondWith(fetch(request).catch(()=>caches.match(shell)));
  } else if (assets.includes(url.href) || (url.origin===root.origin && url.pathname.startsWith(root.pathname+'assets/') && url.pathname.endsWith('.woff2'))) {
    event.respondWith((async()=>{
      const cache=await caches.open(cacheName);
      const saved=await cache.match(request);
      if (saved) return saved;
      const response=await fetch(request);
      if (response.ok) await cache.put(request,response.clone());
      return response;
    })());
  }
});
