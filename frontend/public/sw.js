const CACHE_NAME = 'navigator-pwa-v13';
const SHELL_ASSETS = ['/', '/index.html', '/manifest.json', '/favicon.svg', '/offline-bundle.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

async function matchOrOfflineResponse(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  return new Response('Offline', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/plain' },
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // Never intercept or cache private auth, admin APIs, or privacy-sensitive visitor query photos
  if (
    url.pathname.startsWith('/api/admin') ||
    url.pathname.startsWith('/api/auth') ||
    url.pathname.includes('/queries/')
  ) {
    return;
  }

  // Network-first with safe cache fallback for public venue/graph GET APIs & static landmark thumbnails
  if (
    url.pathname.startsWith('/api/venues') ||
    (url.pathname.startsWith('/media/') && /\.(webp|jpe?g|png|svg)$/i.test(url.pathname))
  ) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok && res.type !== 'opaque') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => matchOrOfflineResponse(req)),
    );
    return;
  }

  // SPA navigation fallback to cached index.html when offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put('/index.html', copy)).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const shell = await caches.match('/index.html');
          return shell || matchOrOfflineResponse(req);
        }),
    );
    return;
  }

  // Network-first with safe cache fallback for same-origin JS/CSS/font bundles
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const ct = res.headers.get('content-type') || '';
          const isBadHtmlForAsset = url.pathname.startsWith('/assets/') && ct.includes('text/html');
          if (res && res.ok && !isBadHtmlForAsset) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => matchOrOfflineResponse(req)),
    );
  }
});
