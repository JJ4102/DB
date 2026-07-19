/* Bitcoin Dashboard – Service Worker: App-Hülle offlinefähig halten */
const CACHE = "btc-dash-v2";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-180.png",
  "./icon-512.png",
  "https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.js",
  "https://cdn.jsdelivr.net/npm/hammerjs@2.0.8/hammer.min.js",
  "https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.2.0/dist/chartjs-plugin-zoom.umd.min.js"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // API-Aufrufe (Coinbase, GitHub) niemals cachen
  if (/api\.exchange\.coinbase\.com|api\.coinbase\.com|api\.github\.com/.test(url.host)) return;
  const isShell = url.origin === location.origin || url.host === "cdn.jsdelivr.net";
  if (!isShell) return;
  // Hülle: Cache sofort, Netz im Hintergrund auffrischen (Updates kommen beim nächsten Start an)
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(r => {
        if (r && r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()));
        return r;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
