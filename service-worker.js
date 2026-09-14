// service-worker.js — offline app shell.
// Scope-relative throughout so this works whether GitHub Pages serves the
// site from the domain root or from a /<repo-name>/ subpath.
//
// Strategy split on purpose: HTML/CSS/JS are the app's actual *code*, so they
// use network-first — always get the latest deploy when online, and only
// fall back to the cache when the network fails (offline). Serving a stale
// cached JS file next to a fresh HTML file (or vice versa) is exactly the
// kind of mismatch that produces confusing "it worked yesterday" bugs, so
// code is never allowed to go stale silently. Icons rarely change and carry
// no correctness risk, so those stay cache-first for speed.

const CACHE_VERSION = "artref-v2";
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

const CODE_EXTENSIONS = [".html", ".js", ".css", ".webmanifest", ".json"];
function isAppCode(pathname) {
  return pathname === "/" || pathname.endsWith("/") || CODE_EXTENSIONS.some((ext) => pathname.endsWith(ext));
}

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

  if (req.mode === "navigate" || isAppCode(url.pathname)) {
    // Network-first: never serve stale app code while online.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.open(CACHE_VERSION).then(async (cache) =>
            (await cache.match(req)) || (await cache.match(new URL("index.html", SCOPE).toString()))
          )
        )
    );
    return;
  }

  // Static assets (icons): cache-first, refresh in the background.
  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
