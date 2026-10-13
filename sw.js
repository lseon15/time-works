// 오프라인 캐시 — 빌드(npm run web)가 VERSION 과 FILES 를 채운다.
// 앱 파일은 캐시에서 먼저 열고(오프라인에서도 열림) 뒤에서 새 버전을 받아 둔다. Supabase 요청은 건드리지 않는다.
const VERSION = 'tw-32b7437d1ad4';
const FILES = [
  "./",
  "./app/base.css",
  "./app/fills.css",
  "./app/fills.js",
  "./app/mobile.css",
  "./app/mobile.js",
  "./app/page-manage.css",
  "./app/page-manage.js",
  "./app/page-records.css",
  "./app/page-records.js",
  "./app/page-stats.css",
  "./app/page-stats.js",
  "./app/panel.css",
  "./app/panel.js",
  "./app/store-pwa.js",
  "./app/store-tauri.js",
  "./app/store.js",
  "./app/win.css",
  "./app/win.js",
  "./core/engine.js",
  "./core/migrate.js",
  "./core/rules.js",
  "./core/schema.js",
  "./core/seed.js",
  "./core/sync.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./index.html",
  "./manifest.webmanifest"
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
