/* Service Worker — App offline verfügbar halten.
   Bei jeder Änderung an den Dateien CACHE hochzählen. */
const CACHE = 'depot-v1';
const ASSETS = [
  './', './index.html', './style.css', './app.js', './quotes.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  // cache:'reload' erzwingt frische Dateien vom Server. Ohne das würden sie aus
  // dem HTTP-Cache des Browsers geholt (GitHub Pages sendet max-age=600) — der
  // neue Cache enthielte dann die alte Version.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Stale-while-revalidate: sofort aus dem Cache liefern, im Hintergrund aktualisieren.
   Fremde Ursprünge (die Kursabrufe) laufen bewusst vorbei — die gehören nicht in
   den Offline-Cache, ein zwischengespeicherter Kurs von gestern wäre schlimmer
   als gar keiner. */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request).then((res) => {
        if (res && res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
