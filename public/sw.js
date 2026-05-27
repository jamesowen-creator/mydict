const CACHE_NAME = 'gotcha-v2';
const STATIC_ASSETS = [
  '/',
  '/english_dictionary.html',
  '/Gotcha_1.0.PNG',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;600;700&family=Noto+Sans+KR:wght@300;400;500;700&display=swap'
];

// Install: 정적 파일 캐싱
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[SW] 일부 파일 캐시 실패:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: 오래된 캐시 삭제
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: 캐시 우선, 없으면 네트워크
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // API 요청은 캐시하지 않고 바로 네트워크로
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        // 유효한 응답만 캐시
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const toCache = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, toCache));
        return response;
      }).catch(() => {
        // 오프라인 fallback: HTML 페이지 요청이면 캐시된 메인 페이지 반환
        if (request.destination === 'document') {
          return caches.match('/english_dictionary.html');
        }
      });
    })
  );
});
