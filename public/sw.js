const CACHE = "nonogram-__BUILD_HASH__";
const APP_SHELL = ["/", "/manifest.json", "/favicon.svg", "/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Only cache same-origin GETs. In particular, never intercept Turnstile.
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Navigation: network-first, fallback to cached app shell
  if (e.request.mode === "navigate") {
    e.respondWith(
      (async () => {
        try {
          const response = await fetch(e.request);
          if (response.ok) {
            const cache = await caches.open(CACHE);
            await cache.put(e.request, response.clone());
          }
          return response;
        } catch {
          return (await caches.match("/")) || (await caches.match("/index.html"));
        }
      })()
    );
    return;
  }

  const cacheableStatic = APP_SHELL.includes(url.pathname) ||
    url.pathname.startsWith("/assets/") ||
    /\.(?:css|js|svg|png|ico|json|webmanifest)$/.test(url.pathname);
  if (!cacheableStatic) return;

  // Static assets: cache-first, update in background
  const update = fetch(e.request).then(async (response) => {
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(e.request, response.clone());
    }
    return response;
  });
  e.waitUntil(update.then(() => undefined).catch(() => undefined));
  e.respondWith(caches.match(e.request).then((cached) => cached || update));
});
