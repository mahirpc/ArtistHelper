// service-worker.js — offline app shell via stale-while-revalidate.
// Scope-relative throughout so this works whether GitHub Pages serves the
// site from the domain root or from a /<repo-name>/ subpath.

const CACHE_VERSION = "artref-v1";
const SCOPE = self.registration ? self.registration.scope : self.location.href;

const APP_SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/styles.css",
  "js/app.js",
  "js/canvas-engine.js",
  "js/gl-filters.js",
  "js/grid-renderer.js",
  "js/sighting-tools.js",
  "js/paper-calibration.js",
  "js/export.js",
  "js/storage.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
].map((p) => new URL(p, SCOPE).toString());

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let CDN requests (jsPDF, fonts) hit the network directly

  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached || caches.match(new URL("index.html", SCOPE).toString()));
      return cached || network;
    })
  );
});
