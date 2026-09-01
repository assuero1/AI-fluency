const CACHE_NAME = "ai-fluency-shell-v9";
const APP_SHELL = ["/offline", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("ai-fluency-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    // Learner pages are always requested from the network; offline never serves stale personal data.
    event.respondWith(fetch(request).catch(() => offlineNavigationFallback(request)));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || APP_SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
            return response;
          })
      )
    );
  }
});

function offlineNavigationFallback(request) {
  return caches.match("/offline").then(
    (cached) =>
      cached ??
      fetch(request).catch(
        () =>
          new Response("Você está offline. Reconecte para continuar.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" }
          })
      )
  );
}
