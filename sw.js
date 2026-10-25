/* Talk Buddy – 서비스 워커
   - 앱 파일(HTML/CSS/JS/아이콘)을 캐시해서 오프라인에서도 화면이 뜨게 함
   - OpenAI API 요청은 가로채지 않음 (항상 네트워크)
   - 같은 출처 파일은 "캐시 먼저 보여주고 뒤에서 갱신" (stale-while-revalidate) */
const CACHE = 'talkbuddy-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/scenarios.js',
  './js/scenarios_ja.js',
  './js/storage.js',
  './js/api.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('openai.com')) return; // API는 항상 네트워크

  if (url.origin === self.location.origin) {
    // 앱 파일: 캐시 먼저, 백그라운드 갱신
    e.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(req, { ignoreSearch: true });
        const fetching = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
        return cached || (await fetching) || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
      })
    );
    return;
  }

  // 폰트 등 외부 리소스: 네트워크 먼저, 실패하면 캐시
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req))
  );
});
