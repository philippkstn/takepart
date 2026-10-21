/*
 * Service Worker von TakePart. Er macht die App installierbar und zeigt ohne
 * Netz eine Hinweisseite – speichert aber bewusst nichts Live-Relevantes
 * zwischen: API, WebSocket und Seiten kommen immer frisch vom Server, damit
 * Abstimmungen und Ansichten nie veraltet sind.
 */
const OFFLINE = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TakePart – keine Verbindung</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#F6F4EF;color:#16181b}
@media (prefers-color-scheme:dark){body{background:#111315;color:#eceae6}}main{max-width:22rem;padding:24px;text-align:center}h1{font-size:1.3rem}p{opacity:.75;line-height:1.5}
button{margin-top:12px;padding:10px 18px;border-radius:8px;border:0;background:#cc4521;color:#fff;font:inherit;font-weight:600;cursor:pointer}</style></head>
<body><main><h1>Keine Verbindung</h1><p>TakePart braucht eine Internetverbindung. Sobald du wieder online bist, geht es weiter.</p>
<button onclick="location.reload()">Erneut versuchen</button></main></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  // Nur Seitenaufrufe abfangen – und auch die nur, wenn das Netz fehlt
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })),
  );
});
