// Service worker: cachea la app y el catálogo para abrir sin señal.
const VERSION = "inv-tg-v3";
const LOCAL = ["./", "index.html", "app.js", "styles.css", "catalogo.json", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
const CDN = [
  "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js",
  "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js",
  "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js",
];
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(LOCAL);
    await Promise.all(CDN.map((u) => c.add(new Request(u, { mode: "cors" })).catch(() => {})));
    self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    // Solo cachés viejas de esta app: las otras apps del sitio comparten el mismo origen.
    for (const k of await caches.keys()) if (k.startsWith("inv-tg-") && k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const mismo = url.origin === self.location.origin;
  const cdn = url.hostname === "www.gstatic.com" || url.hostname === "unpkg.com";
  if (!mismo && !cdn) return; // Firestore/Auth van directo a la red
  if (cdn) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => { const cp = res.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); return res; })));
    return;
  }
  // Propios: red primero (para tomar actualizaciones), caché si no hay señal
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const cp = res.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("index.html"))));
});
