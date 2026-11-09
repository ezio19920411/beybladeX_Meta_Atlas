const CACHE_NAME = 'beyblade-x-radar-v0.4.8';
const APP_SHELL = ['./','./index.html','./manifest.webmanifest','./data/regions.json','./data/stores.json','./data/products.json','./data/draw-batches.json','./data/source-metadata.json'];

self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).catch(()=>{}).then(()=>self.skipWaiting())));

self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('beyblade-x-radar-')&&k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  const data=/\/data\/.*\.json$/.test(url.pathname);
  const page=event.request.mode==='navigate'||url.pathname.endsWith('/index.html')||url.pathname.endsWith('/radar/');
  if(data||page){
    event.respondWith(fetch(event.request).then(response=>{
      if(response.ok)caches.open(CACHE_NAME).then(c=>c.put(event.request,response.clone()));
      return response;
    }).catch(()=>caches.match(event.request).then(cached=>cached||caches.match('./index.html'))));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
