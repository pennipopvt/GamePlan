/* GamePlan offline shell. Browser localStorage holds all working project data.
   Network-first updates ensure GitHub deploys appear; cached shell keeps the app
   usable on repeat visits without a network connection. */
const CACHE='gameplan-offline-v16';
const ASSETS=[
 './','./index.html','./gameplan.js','./local-first-sync.js','./account-ui.js','./account-ui.css',
 './gameplan-mark.svg','./supabase/gameplan-cloud.js'
];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(name=>name.startsWith('gameplan-offline-')&&name!==CACHE).map(name=>caches.delete(name)));
  await self.clients.claim();
 })());
});
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin)return;
 const isApp=url.pathname.includes('/ProjectPlanner/');
 if(!isApp)return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  try{
   const response=await fetch(request);
   if(response.ok&&response.type==='basic')await cache.put(request,response.clone());
   return response;
  }catch(err){
   const cached=await cache.match(request,{ignoreSearch:true});
   if(cached)return cached;
   if(request.mode==='navigate'){
    const home=await cache.match('./index.html');
    if(home)return home;
   }
   throw err;
  }
 })());
});
