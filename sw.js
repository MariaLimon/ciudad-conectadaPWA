const CACHE_NAME = 'reportes-cache-v2';
const API_URL = 'https://apiciudadconectada.somee.com/api';

const STATIC_ASSETS = [
  '/', 
  '/Home.html',
  '/DetalleReporte.html',
  '/Perfil.html',
  '/Notificaciones.html',
  '/Login.html',
  '/RegistrarUsuario.html',
  '/app.css',
  '/app.js',
  'Logo_CiudadConectada.jpg',
  'https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700;800;900&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined'
];

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 🔹 Normalizar paths (para evitar errores con /Home.html?)
  const cleanPath = url.pathname.replace(/\/$/, '');

  // 1. Archivos estáticos desde cache
  if (STATIC_ASSETS.includes(cleanPath)) {
    event.respondWith(
      caches.match(cleanPath).then(res => {
        return (
          res ||
          fetch(event.request).catch(() =>
            new Response("Offline", {
              status: 503,
              headers: { "Content-Type": "text/plain" }
            })
          )
        );
      })
    );
    return;
  }

  // 2. API requests
  if (url.href.startsWith(API_URL)) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({ ok: false, message: "No connection" }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        )
      )
    );
    return;
  }

  // 3. Todo lo demás
  event.respondWith(
    fetch(event.request).catch(() =>
      new Response("Offline", {
        status: 503,
        headers: { "Content-Type": "text/plain" }
      })
    )
  );
});
