// ═══════════════════════════════════════════════════════
//  APEX Gym Tracker — Service Worker
//  Handles: offline caching, background sync
// ═══════════════════════════════════════════════════════

const CACHE_NAME = 'apex-v2';

// Files to cache for full offline support
const CACHE_FILES = [
  'gym-tracker.html',
  'manifest.json',
  // Chart.js — cache on first fetch (see fetch handler)
];

// ── INSTALL: cache core app shell ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(CACHE_FILES).catch(err => {
        // Non-fatal: app still works if some files fail to cache
        console.warn('[SW] Cache install partial failure:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: clean old caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: network-first for HTML, cache-first for assets ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET and cross-origin except CDN
  if (event.request.method !== 'GET') return;

  // Cache-first for CDN assets (Chart.js, fonts)
  const isCDN = url.hostname.includes('cdnjs.cloudflare.com') ||
                url.hostname.includes('fonts.googleapis.com') ||
                url.hostname.includes('fonts.gstatic.com');

  if (isCDN) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached || new Response('', {status: 503}));
      })
    );
    return;
  }

  // Network-first for main app files (so updates are fetched fresh)
  event.respondWith(
    fetch(event.request).then(response => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => {
      // Offline fallback: return cached version
      return caches.match(event.request).then(cached => {
        return cached || caches.match('gym-tracker.html');
      });
    })
  );
});

// ── PUSH: handle push notifications (future use) ──
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'APEX Reminder';
  const options = {
    body: data.body || 'Check in with your workout.',
    icon: data.icon || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🏋️</text></svg>',
    badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">💪</text></svg>',
    tag: data.tag || 'apex-notification',
    renotify: true,
    vibrate: [100, 50, 100],
    data: { url: data.url || 'gym-tracker.html' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// ── NOTIFICATION CLICK: focus or open app ──
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || 'gym-tracker.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Focus existing window if open
      const existing = clientList.find(c => c.url.includes('gym-tracker'));
      if (existing) return existing.focus();
      // Otherwise open new window
      return clients.openWindow(targetUrl);
    })
  );
});

// ── MESSAGE: handle commands from main thread ──
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
