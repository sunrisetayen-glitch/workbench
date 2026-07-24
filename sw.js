// Service Worker：全站预缓存 + 离线秒开 + iOS 适配
const CACHE = 'media-workbench-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/platforms.js',
  './js/recommend.js',
  './js/search.js',
  './js/ui.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

// 安装时全量预缓存（保证离线秒开）
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// 激活时清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 缓存优先策略：命中缓存即返回，同时后台更新（保证冷启动极快 + 内容新鲜）
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // 跳过 chrome-extension 等非 http(s) 请求
  const url = new URL(req.url);
  if (!url.protocol.startsWith('http')) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      // 后台更新缓存（不阻塞响应）
      const fetchAndCache = fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
      // 有缓存直接返回（极速），没有则等网络
      return cached || fetchAndCache;
    })
  );
});
