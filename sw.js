// Service worker: red primero para la app y el catálogo; caché solo como respaldo sin señal.
const VERSION = "inv-tg-v5";
const LOCAL = ["./", "index.html", "app.js", "styles.css", "catalogo.json", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
const CDN = [
  "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js",
  "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js",
  "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js",
];
self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all(LOCAL.map((u) => fetch(u, { cache: "no-store" }).then((r) => r.ok && c.put(u, r)).catch(() => {})));
    await Promise.all(CDN.map((u) => c.add(new Request(u, { mode: "cors" })).catch(() => {})));
  })());
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener("message", (e) => { if (e.data === "skipWaiting") self.skipWaiting(); });
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const mismo = url.origin === self.location.origin;
  const cdn = url.hostname === "www.gstatic.com" || url.hostname === "unpkg.com";
  if (!mismo && !cdn) return; // Firestore/Auth van directo a la red
  if (mismo && !url.pathname.startsWith(new URL("./", self.location).pathname)) return;
  if (cdn) { // librerías versionadas: caché primero
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => { const cp = res.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); return res; })));
    return;
  }
  // Propios (index.html, app.js, catalogo.json, etc.): SIEMPRE red primero, sin caché HTTP; caché solo sin señal
  e.respondWith(fetch(req, { cache: "no-store" }).then((res) => {
    if (res.ok) { const cp = res.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || (req.mode === "navigate" ? caches.match("index.html") : undefined)).then((r) => r || Response.error())));
});
