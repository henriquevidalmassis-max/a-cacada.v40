const CACHE='a-cacada-v41-ws';

const STATIC_ASSETS=[
  './',
  './index.html',
  './background.png',
  './manifest.json',
  './config.js'
];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(c=>c.addAll(STATIC_ASSETS))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(
        keys
          .filter(k=>k!==CACHE)
          .map(k=>caches.delete(k))
      ))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const req=event.request;

  if(req.method!=='GET') return;

  const url=new URL(req.url);

  if(url.origin!==self.location.origin) return;

  const critical=
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/config.js') ||
    url.pathname.endsWith('/sw.js');

  if(critical){
    event.respondWith(
      fetch(req,{cache:'no-store'})
        .then(r=>{
          const copy=r.clone();
          caches.open(CACHE).then(c=>c.put(req,copy));
          return r;
        })
        .catch(()=>caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(r=>r||fetch(req))
  );
});
