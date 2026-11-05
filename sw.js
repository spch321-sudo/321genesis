/* 321創世記講義 Service Worker  v1.1.202610131024
   · 新版裝好後停在 waiting，等頁面上「有新版本了」那條按下去（SKIP_WAITING）才換——
     正在讀經、寫領受時不會被強制重整（與頁面的 UI321.update 配合）
   · 網頁、程式、資料：網路優先（cache:'no-cache'），離線才用快取
   · 圖片等其他同源資源：快取優先
   · 音訊、影片、帶 Range 的請求、以及跨網域（小智、語音、圖庫、詩歌庫）一律不攔 */
const VER = '1.2.202610162200-tri10171929-gxa1019-gx1021c-vp1023-co1-gp1103-au1103-xz1103-xf1103-xm1103-vk1103-rf1105';
const CACHE = 'gn321-' + VER;
const SHELL = ['./', './index.html', './sc.html', './en.html', './xz2.js', './coread.js', './peerjs.min.js'];

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
/* -rf1105（互動聖經 v2.58.3）：網頁與程式 network-first，但網路超過 SHELL_WAIT（1 秒）還沒回應，
   且「自己這一版」的快取裡有同一份，就先用快取開起來；網路那份繼續下載並更新快取。
   弱網路不必乾等。只有導覽請求才可以退回 index.html，程式檔絕不拿網頁頂替。
   快取只查自己這個 App 的 CACHE（同網域底下還有很多 App）。 */
const SHELL_WAIT = 1000;
async function shellFetch(req, nav) {
  const net = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res && res.ok && res.status === 200 && res.type !== 'opaque') {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
    }
    return res;
  });
  const own = () => caches.open(CACHE).then(c => c.match(req, { ignoreSearch: true }));
  try {
    const first = await Promise.race([net, new Promise(ok => setTimeout(() => ok(null), SHELL_WAIT))]);
    if (first) return first;
    const hit = await own();
    if (hit) { net.catch(() => {}); return hit; }
    return await net;
  } catch (err) {
    let hit = await own();
    if (!hit && nav) hit = await caches.match('./index.html');
    if (hit) return hit;
    throw err;
  }
}

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
  /* -rf1105：網頁與程式走 shellFetch（慢網路先用快取）；version.json 維持網路優先，不可拿快取先頂 */
  if (true && !url.pathname.endsWith('/version.json') && (req.mode === 'navigate' || url.pathname.endsWith('/') || /\.(html|js|json)$/i.test(url.pathname))) {
    e.respondWith(shellFetch(req, req.mode === 'navigate'));
    return;
  }
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
