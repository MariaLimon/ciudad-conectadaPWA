const CACHE_NAME = "cc-cache-v5";
const API_CACHE = "cc-api-cache-v5";

const STATIC_ASSETS = [
  "/",
  "/Home.html",
  "/DetalleReporte.html",
  "/Perfil.html",
  "/Notificaciones.html",
  "/Login.html",
  "/RegistrarUsuario.html",
  "/app.css",
  "/app.js",
  "/icons/icono_144x144.png",
  "https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700;800;900&display=swap",
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined"
];

const API_BASE = "https://ciudad-conectada.onrender.com/api";

// -------------------------------------------
// INSTALL → Cache estático
// -------------------------------------------
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// -------------------------------------------
// ACTIVATE → limpieza de caches viejos
// -------------------------------------------
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => 
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME && key !== API_CACHE)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// -------------------------------------------
// FETCH HANDLER
// -------------------------------------------
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  // Archivos estáticos → Cache first
  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(url.pathname).then(res => res || fetch(request))
    );
    return;
  }

  // API → Network first, fallback a cache
  if (url.href.startsWith(API_BASE)) {
    event.respondWith(apiNetworkThenCache(request));
    return;
  }

  // Todo lo demás
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});

// -------------------------------------------
// MÉTODO PARA API CACHE
// -------------------------------------------
async function apiNetworkThenCache(request) {
  try {
    const networkResponse = await fetch(request);

    // Guarda en cache solo si la respuesta es válida
    if (networkResponse.ok) {
      const cache = await caches.open(API_CACHE);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;

  } catch (error) {
    // sin internet → devolver versión cacheada
    const cached = await caches.match(request);

    if (cached) return cached;

    // si no hay cache → devolver respuesta vacía
    return new Response(JSON.stringify({
      ok: true,
      offline: true,
      message: "Datos cargados offline",
      data: []
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }
}

// -------------------------------------------
// BACKGROUND SYNC
// -------------------------------------------
self.addEventListener("sync", event => {
  if (event.tag === "sync-report-actions") {
    event.waitUntil(processSyncQueue());
  }
});

// Lee la cola desde el SW
async function processSyncQueue() {
  const clientsList = await self.clients.matchAll();
  const client = clientsList[0];

  // Pedirle a la página la cola actual
  client.postMessage({ type: "SYNC_NOW" });
}


