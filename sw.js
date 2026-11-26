// Kur-Coach Service Worker: Precache, stale-while-revalidate, nie Supabase cachen
const CACHE_VERSION = 'v15';
const CACHE = `kur-coach-${CACHE_VERSION}`;

// Liste pflegen, wenn Dateien dazukommen (z. B. gym.js in M2). Fehlende Dateien blockieren die Installation nicht.
const PRECACHE = [
  './', './index.html', './app.js', './styles.css', './manifest.webmanifest',
  './config.js', './calc.js', './db.js', './kurlog.js', './gym.js',
  './vendor/supabase.js',
  './data/checklisten.json', './data/evidenz.json', './data/uebungen.json', './data/freizeit.json', './data/kurzbefehl.json',
  './ui/icons.js', './ui/util.js', './ui/daten.js', './ui/sheet.js', './ui/profilform.js',
  './ui/login.js', './ui/onboarding.js', './ui/heute.js', './ui/checkliste.js', './ui/studio.js', './ui/studio-sess.js', './ui/studio-timer.js', './ui/studio-ende.js', './ui/einstellungen.js', './ui/freizeit.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(new Request(u, { cache: 'reload' }))))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('kur-coach-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;               // Supabase & Fremdes: direkt ins Netz
  if (url.hostname.endsWith('supabase.co')) return;

  if (req.mode === 'navigate') {
    const scope = new URL(self.registration.scope).pathname;
    const istApp = url.pathname === scope || url.pathname === scope + 'index.html';
    if (!istApp) return;                                          // z. B. tests.html: normal aus dem Netz
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const treffer = await cache.match('./index.html', { ignoreSearch: true });
      const netz = fetch(req).then((r) => { if (r.ok) cache.put('./index.html', r.clone()); return r; }).catch(() => null);
      if (treffer) { e.waitUntil(netz); return treffer; }
      return (await netz) || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })());
    return;
  }

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const treffer = await cache.match(req);
    const netz = fetch(req).then((r) => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
    if (treffer) { e.waitUntil(netz); return treffer; }
    return (await netz) || new Response('', { status: 504 });
  })());
});
