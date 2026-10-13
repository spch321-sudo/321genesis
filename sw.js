/* 321創世記講義 Service Worker  v1.1.202610130937
   · 新版裝好後停在 waiting，等頁面上「有新版本了」那條按下去（SKIP_WAITING）才換——
     正在讀經、寫領受時不會被強制重整（與頁面的 UI321.update 配合）
   · 網頁、程式、資料：網路優先（cache:'no-cache'），離線才用快取
   · 圖片等其他同源資源：快取優先
   · 音訊、影片、帶 Range 的請求、以及跨網域（小智、語音、圖庫、詩歌庫）一律不攔 */
const VER = '1.1.202610130937';
const CACHE = 'gn321-' + VER;
const SHELL = ['./', './index.html', './en.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u =>
    fetch(new Request(u, { cache: 'reload' })).then(r => { if (r && r.ok) return c.put(u, r); }).catch(() => {})
  ))));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.indexOf('gn321-') === 0 && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', e => {
  const d = e.data;
  if (d === 'skip' || (d && (d.type === 'SKIP_WAITING' || d.t === 'skip'))) self.skipWaiting();
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.headers.has('range') || /\.(mp3|m4a|aac|wav|ogg|opus|flac|mp4|mov|webm)$/i.test(url.pathname)) return;
  const nav = req.mode === 'navigate';
  if (nav || /\.(html|js|json|css)$/i.test(url.pathname) || url.pathname.endsWith('/')) {
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(r => {
      if (r && r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(nav ? (url.pathname.endsWith('en.html') ? './en.html' : './index.html') : req, cp)); }
      return r;
    }).catch(() => caches.match(nav ? (url.pathname.endsWith('en.html') ? './en.html' : './index.html') : req)
      .then(m => m || caches.match(req)).then(m => m || new Response('offline', { status: 503 }))));
    return;
  }
  e.respondWith(caches.match(req).then(m => m || fetch(req).then(r => {
    if (r && r.ok && r.type === 'basic') { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
    return r;
  })));
});
