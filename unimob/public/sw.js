// Service worker minimal : cache des ressources statiques versionnées uniquement.
// Les données (Supabase), les pages HTML, les pages privées et les documents ne sont JAMAIS mis en cache.
const CACHE = 'agence-static-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API Supabase, stockage : réseau uniquement
  const isStatic = url.pathname.startsWith('/assets/') || /\.(svg|png|webp|ico|woff2?)$/.test(url.pathname);
  if (!isStatic) return; // pages HTML : toujours le réseau
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      // Après un déploiement, un ancien fichier absent est remplacé par index.html (repli SPA) :
      // ne jamais mettre en cache une réponse HTML sous l'URL d'un fichier statique.
      const type = res.headers.get('content-type') || '';
      if (res.ok && !type.includes('text/html')) cache.put(req, res.clone());
      return res;
    }),
  );
});
