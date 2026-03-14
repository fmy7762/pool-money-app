const CACHE_NAME = 'shared-expense-app-v3';
const urlsToCache = [
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'https://fonts.googleapis.com/icon?family=Material+Icons+Round'
];

// インストール時にキャッシュする
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

// ネットワークリクエストの処理（ネットワーク優先）
self.addEventListener('fetch', event => {
  // GAS APIはキャッシュしない
  if (event.request.url.includes('script.google.com')) {
    return;
  }

  // Googleフォントはキャッシュ優先（外部リソースなので変更なし）
  if (event.request.url.includes('fonts.googleapis.com') || 
      event.request.url.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(event.request).then(response => {
        return response || fetch(event.request).then(fetchRes => {
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, fetchRes.clone());
            return fetchRes;
          });
        });
      })
    );
    return;
  }

  // index.html / app.js / style.css などはネットワーク優先
  // → GitHubを更新したら即反映される
  event.respondWith(
    fetch(event.request)
      .then(fetchRes => {
        // 取得成功したら最新をキャッシュに保存して返す
        return caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, fetchRes.clone());
          return fetchRes;
        });
      })
      .catch(() => {
        // オフライン時はキャッシュから返す
        return caches.match(event.request);
      })
  );
});

// 古いキャッシュの削除
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});
