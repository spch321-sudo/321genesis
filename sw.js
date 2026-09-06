/* 321創世記講義 · Service Worker（離線可用）
   版本字串在每次 make_site.py 重新打包時都會變，
   一變就會清掉舊快取、重新抓一份新的，使用者不必手動清除。 */
const V = '創世記-0b4df6348420';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-180.png', './icons/icon-64.png',
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 只接管自己網域的 GET；Worker API（語音、小智）一律直接走網路，不進快取。
   策略是「網路優先、失敗才用快取」——這樣更新內容會馬上看到，斷線也還能讀。 */
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  if (new URL(r.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(r)
      .then(resp => {
        const copy = resp.clone();
        caches.open(V).then(c => c.put(r, copy)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(r).then(hit => hit || caches.match('./index.html')))
  );
});
