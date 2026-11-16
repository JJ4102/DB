/* Bitcoin Dashboard – Service Worker
   Seite (HTML): immer zuerst frisch vom Server, der Cache dient nur als Offline-Ersatz –
   so ist ein Update beim nächsten Öffnen sichtbar.
   Übrige Hülle (Icons, Manifest, Chart.js): aus dem Cache, im Hintergrund aufgefrischt. */
const CACHE = "btc-dash-v20";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-180.png",
  "./icon-512.png",
  "https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.js"
];
self.addEventListener("install", e => {
  /* cache: "reload" umgeht den Browser-Cache – sonst landet beim Update die alte Seite im neuen Cache */
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
const put = (req, r) => { if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; };
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  // API-Aufrufe (Coinbase, GitHub) niemals cachen
  if (/api\.exchange\.coinbase\.com|api\.coinbase\.com|api\.github\.com/.test(url.host)) return;
  const isShell = url.origin === location.origin || url.host === "cdn.jsdelivr.net";
  if (!isShell) return;

  const isPage = req.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith(".html");
  if (isPage) {
    /* Netz zuerst (mit Revalidierung am Server); nach 4 s ohne Antwort oder offline → Cache */
    e.respondWith((async () => {
      const net = fetch(req, { cache: "no-cache" }).then(r => put(req, r));
      const timeout = new Promise(r => setTimeout(r, 4000));
      try {
        const r = await Promise.race([net, timeout]);
        if (r && r.ok) return r;
      } catch (_) {}
      return (await caches.match(req, { ignoreSearch: true })) || (await caches.match("./index.html")) || net;
    })());
    return;
  }
  e.respondWith(
    caches.match(req).then(cached => {
      const fresh = fetch(req).then(r => put(req, r)).catch(() => cached);
      return cached || fresh;
    })
  );
});
