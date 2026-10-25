const V="dejedrive-v5",SHELL=["./","index.html","style.css","app.js","manifest.webmanifest","assets/logo.png","assets/icon-192.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=="GET"||u.origin!==location.origin)return; // API Apps Script tidak pernah di-cache
  e.respondWith(caches.match(r,{ignoreSearch:true}).then(hit=>{
    const net=fetch(r).then(res=>{if(res.ok)caches.open(V).then(c=>c.put(r,res.clone()));return res}).catch(()=>hit||caches.match("index.html"));
    return hit||net;
  }));
});
