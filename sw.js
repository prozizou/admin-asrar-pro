// sw.js — SW du panneau admin. Cache DYNAMIQUE + mise à jour immédiate.
// Change SW_VERSION à chaque déploiement → purge de l'ancien cache + reload auto.
const SW_VERSION = 'admin-v20';
const CACHE = 'asrar-admin-' + SW_VERSION;
const SHELL = ['/', '/index.html', '/admin.css',
  '/admin-core.js', '/admin-dashboard.js', '/admin-content.js', '/admin-market.js', '/admin-users.js', '/admin-fonts.js', '/admin-referral.js', '/admin-stats.js', '/admin-formation-access.js',
  '/pwa.js', '/manifest.json',
  '/assets/logo-mark.png', '/assets/favicon.png', '/assets/icon-192.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.map((k) => (k !== CACHE ? caches.delete(k) : null))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Jamais de cache pour l'API ni les domaines externes (Firebase, Cloudinary, Google).
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // Network-first : toujours le frais en ligne, cache en secours hors-ligne.
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.status === 200) { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
      return res;
    }).catch(() => caches.match(req).then((c) => c || caches.match('/index.html')))
  );
});
