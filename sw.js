// Service worker minimal : le jeu reste jouable hors connexion.
const CACHE = "gdt2-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./src/main.js",
  "./src/game.js",
  "./src/entities.js",
  "./src/levels.js",
  "./src/faces.js",
  "./src/sensors.js",
  "./src/storage.js",
  "./src/audio.js",
  "./src/ui.js",
  "./src/util.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  // Réseau d'abord (pour récupérer les mises à jour), cache en secours.
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
  );
});
