/* Leme One PWA — versão segura, sem cache de dados, login ou API. 
   Mantém requisições online para evitar dados desatualizados na Cloudflare. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", event => {
  // Para as páginas do GitHub Pages, segue a rede normalmente.
  // A API Cloudflare, outros domínios e requisições não-GET não são interceptados.
  if (event.request.method !== "GET") return;
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request));
});
