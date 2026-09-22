/* ============================================================================
 * 321 App Core — 朗讀模組  tts.js  v1.1.0
 * ----------------------------------------------------------------------------
 * 這一份把「朗讀」這一整組功能從創世記講義 App 抽出來，收成一個可以掛到任何
 * 321 App 上的模組。抽出來的理由很實際：這一組功能在五個 App 裡各自被重新做過
 * 一次（破音字校正 4 次、朗讀跟讀 4 次、串流切塊 3 次），而且每一次都重新踩了
 * 同一批坑。
 *
 * 包含的功能
 *   · 串流播放      先抓兩段就開播，邊播邊抓，不必等整課下載完
 *   · 逐句標示      播到哪一句，畫面上那一句就亮起來
 *   · 自動跟讀      畫面跟著捲，使用者自己捲過之後先不搶
 *   · 離線          音檔逐段存 IndexedDB，可整課預先下載
 *   · 鎖屏播放      MediaSession ＋ Wake Lock
 *   · 冷啟動        開機預熱 ＋ 退避重試，第一次朗讀不會掉到機器音
 *   · 破音字        一張表，繁體 pattern 自動展開簡體
 *   · 重繪重綁      畫線／換色／寫筆記重繪之後，標示會自己回到原位
 *
 * 語法：ES5。不是為了復古，是為了讓 WPS WebView 那幾支 App（空中團契、晨讀321）
 * 也能共用同一份——核心只做一次決定，全家都受益。
 *
 * 掛法：見 README.md 的「宿主契約」。核心不認識任何一個 App 的資料結構，
 * App 專屬的部分全部由 cfg 的幾個函式提供。
 * ==========================================================================*/

var TTS321 = (function () {
  'use strict';

  /* ── 預設值 ────────────────────────────────────────────────────────── */

  var DEF = {
    worker: '',
    db: 'r321_tts',
    store: 'a',
    voices: {},
    defaultVoice: '',
    lang: 'zh-TW',
    /* 中文一句約 110 字；英文一句長得多，所以每個 App 自己給 */
    chunk: { punct: '。！？；\n', min: 110, max: 300 },
    sil: { s: 140, c: 140, e: 260 },
    say: [],              // 破音字修正 [[RegExp, '替代字'], …]
    t2s: null,            // 繁→簡：單字表 {繁:簡} 或 fn(str)->str；給了就自動展開 say 的簡體版
    preStart: 2,          // 抓到幾段就開播
    preAhead: 8,          // 往前預抓幾段
    parallel: 4,          // 同時幾個請求
    retry: [800, 1600],   // 退避重試（毫秒）；Worker 冷啟動用
    holdScroll: 6000,     // 使用者自己捲過之後，幾毫秒內不搶畫面
    labels: {
      bar: '朗讀中', buffering: '緩衝中…', prev: '上一句', next: '下一句',
      pause: '暫停', resume: '繼續', stop: '停止', follow: '自動捲動',
      followOn: '朗讀時自動捲動', followOff: '不自動捲動，畫面由你控制',
      fallback: '真人語音連不上，改用裝置語音',
      nosupport: '這台裝置不支援朗讀'
    },
    media: null,          // { artist, album, icon } 鎖屏／耳機／車機上顯示什麼
    settings: null,       // { get: fn -> {human,voice,rate,follow}, save: fn }
    elFor: null,          // fn(unit) -> DOM element | null
    stillHere: null,      // fn(scope) -> bool   還在同一頁嗎
    clean: null,          // fn(text) -> text    App 專屬的朗讀前清理
    toast: null,          // fn(msg)
    onItem: null          // fn(index, unit)     每換一句回呼（選用）
  };

  var C = null;                       // 生效中的設定
  var SPK = { on: false, tok: 0 };    // 播放狀態
  var PL = null;                      // 串流佇列
  var AUP = null;                     // 兩個 <audio> 輪流用
  var LAST = [];                      // 目前標示中的元素
  var SAY = [];                       // 展開後的破音字表
  var BAR = null;

  /* ── 小工具 ────────────────────────────────────────────────────────── */

  function ext(a, b) { for (var k in b) if (b.hasOwnProperty(k)) a[k] = b[k]; return a; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function set() { return (C && C.settings && C.settings.get && C.settings.get()) || {}; }
  function save() { if (C && C.settings && C.settings.save) C.settings.save(); }
  function toast(m) { if (C && C.toast) C.toast(m); }
  function L(k) { return (C && C.labels && C.labels[k]) || DEF.labels[k] || ''; }

  function voiceName() {
    var s = set(), v = C.voices[s.voice] || C.voices[C.defaultVoice];
    if (!v) { for (var k in C.voices) { v = C.voices[k]; break; } }
    return v ? v.name : '';
  }
  function rateAttr() {
    var r = set().rate || 0;
    return (r >= 0 ? '+' : '') + (r * 5) + '%';
  }

  /* ── 破音字表：繁體 pattern 自動展開簡體 ──────────────────────────────
   * 學神神學的教訓：SAYFIX 全是繁體 pattern，簡體模式下畫面文字已經是簡體，
   * 整張表比對不到——902 處校正有 733 處對簡體讀者完全失效。
   * 核心在這裡做掉，App 只要給一張繁→簡單字表（make_scmap.py 本來就有）。
   * ------------------------------------------------------------------- */

  /* C.t2s 可以是一張單字表 {繁:簡}，也可以是宿主自己的轉換函式（詞組表那種）。 */
  function t2s(str) {
    if (!C.t2s) return str;
    if (typeof C.t2s === 'function') { try { return C.t2s(str); } catch (e) { return str; } }
    var out = '', i;
    for (i = 0; i < str.length; i++) out += (C.t2s[str.charAt(i)] || str.charAt(i));
    return out;
  }

  function buildSay() {
    SAY = [];
    var seen = {};
    function add(re, to) {
      var k = String(re) + '\u0000' + to;
      if (seen[k]) return;
      seen[k] = 1; SAY.push([re, to]);
    }
    for (var i = 0; i < (C.say || []).length; i++) {
      var pair = C.say[i], re = pair[0], to = pair[1];
      add(re, to);
      if (C.t2s && re instanceof RegExp) {
        var srcS = t2s(re.source), toS = t2s(to);
        if (srcS !== re.source || toS !== to) add(new RegExp(srcS, re.flags || 'g'), toS);
      }
    }
  }

  /* ── 送去合成之前的整理 ───────────────────────────────────────────── */

  function sanitize(t) {
    t = String(t == null ? '' : t).replace(/<[^>]+>/g, ' ');
    t = t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
         .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    if (C.clean) t = C.clean(t);                    // App 專屬清理（原文、括號出處…）
    for (var i = 0; i < SAY.length; i++) t = t.replace(SAY[i][0], SAY[i][1]);
    t = t.replace(/\s+([，。！？；、,.!?;])/g, '$1');
    return t.replace(/\s{2,}/g, ' ').replace(/^\s+|\s+$/g, '');
  }

  function chunks(t) {
    t = sanitize(t);
    if (!t) return [];
    var out = [], buf = '', i, ch, cfg = C.chunk;
    for (i = 0; i < t.length; i++) {
      ch = t.charAt(i); buf += ch;
      if (cfg.punct.indexOf(ch) >= 0 && buf.length >= cfg.min) { out.push(buf); buf = ''; }
    }
    if (buf.replace(/^\s+|\s+$/g, '')) out.push(buf);
    var fin = [];
    for (i = 0; i < out.length; i++) {
      var s = out[i];
      while (s.length > cfg.max) { fin.push(s.slice(0, cfg.max)); s = s.slice(cfg.max); }
      if (s) fin.push(s);
    }
    return fin.length ? fin : [t];
  }

  /* 送去合成的字 ≠ 畫面上的字。
     畫面要留著原文、書名號、8:28 這些；送去唸的要換成「八章二十八節」。
     核心在這裡統一做，宿主只要給畫面上的字就好——
     否則每個 App 都要自己記得先 sanitize 一次，漏掉就整段原文照著亂唸。 */
  function speechText(u) {
    if (typeof u === 'string') return sanitize(u);
    if (u._s == null) u._s = sanitize(u.t);
    return u._s;
  }

  /* ── IndexedDB 音檔快取 ───────────────────────────────────────────── */

  function db(cb) {
    try {
      if (!window.indexedDB) return cb(null);
      var r = indexedDB.open(C.db, 1);
      r.onupgradeneeded = function () {
        try {
          if (!r.result.objectStoreNames.contains(C.store)) r.result.createObjectStore(C.store);
        } catch (e) {}
      };
      r.onsuccess = function () { cb(r.result); };
      r.onerror = function () { cb(null); };
    } catch (e) { cb(null); }
  }

  function cacheGet(k, cb) {
    db(function (d) {
      if (!d) return cb(null);
      try {
        var q = d.transaction(C.store).objectStore(C.store).get(k);
        q.onsuccess = function () { cb(q.result || null); };
        q.onerror = function () { cb(null); };
      } catch (e) { cb(null); }
    });
  }

  function cachePut(k, blob) {
    db(function (d) {
      if (!d) return;
      try { d.transaction(C.store, 'readwrite').objectStore(C.store).put(blob, k); } catch (e) {}
    });
  }

  function cacheCount(cb) {
    db(function (d) {
      if (!d) return cb(0);
      try {
        var q = d.transaction(C.store).objectStore(C.store).count();
        q.onsuccess = function () { cb(q.result || 0); };
        q.onerror = function () { cb(0); };
      } catch (e) { cb(0); }
    });
  }

  /* 這幾段已經下載了幾段？——一次交易查完，不逐段開連線。
     用在「預先下載」按鈕上：進頁時要能說出「已有 12/45」。 */
  function cacheHave(units, cb) {
    units = units || [];
    if (!units.length) return cb(0, 0);
    var pre = voiceName() + '|' + rateAttr() + '|';
    db(function (d) {
      if (!d) return cb(0, units.length);
      try {
        var st = d.transaction(C.store).objectStore(C.store);
        var n = 0, done = 0, i;
        for (i = 0; i < units.length; i++) {
          (function (u) {
            var k = pre + speechText(u);
            var q = st.getKey ? st.getKey(k) : st.count(k);
            q.onsuccess = function () {
              if (q.result !== undefined && q.result !== 0) n++;
              if (++done === units.length) cb(n, units.length);
            };
            q.onerror = function () { if (++done === units.length) cb(n, units.length); };
          })(units[i]);
        }
      } catch (e) { cb(0, units.length); }
    });
  }

  function cacheClear(cb) {
    db(function (d) {
      if (!d) return cb && cb();
      try {
        var q = d.transaction(C.store, 'readwrite').objectStore(C.store).clear();
        q.onsuccess = function () { cb && cb(); };
        q.onerror = function () { cb && cb(); };
      } catch (e) { cb && cb(); }
    });
  }

  /* ── 取音檔：快取 → Worker（退避重試）───────────────────────────────
   * 領導力 App 的教訓：一個 session 裡「只有第一次」會失敗，換語言再換回來就好——
   * 那是 Worker 冷啟動的指紋，不是哪個語音的 bug。解法是開機預熱 ＋ 退避重試。
   * ------------------------------------------------------------------- */

  function post(text) {
    return fetch(C.worker, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voice: voiceName(), rate: rateAttr(),
        sil: C.sil.s, silc: C.sil.c, sile: C.sil.e, text: text
      })
    }).then(function (res) {
      if (!res.ok) throw new Error('TTS ' + res.status);
      return res.blob();
    });
  }

  function fetchAudio(piece) {
    var key = voiceName() + '|' + rateAttr() + '|' + piece;
    return new Promise(function (resolve, reject) {
      cacheGet(key, function (hit) {
        if (hit) return resolve(hit);
        var n = 0;
        function attempt() {
          post(piece).then(function (blob) {
            cachePut(key, blob); resolve(blob);
          }, function (err) {
            if (n >= C.retry.length) return reject(err);
            var wait = C.retry[n++];
            setTimeout(attempt, wait);
          });
        }
        attempt();
      });
    });
  }

  /* 開機就先戳一下，把冷啟動的代價吃在使用者按下播放之前 */
  function warmUp() {
    if (!C || !C.worker) return;
    /* 離線時不必預熱——Worker 也連不上，只會在主控台留下一筆紅字 */
    try { if (navigator.onLine === false) return; } catch (e) {}
    try { post('.').then(function () {}, function () {}); } catch (e) {}
  }

  /* ── 兩個 <audio> 輪流接力 ────────────────────────────────────────── */

  var SILENT = 'data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCA';

  function pair() {
    if (!AUP) {
      AUP = [];
      for (var i = 0; i < 2; i++) {
        var a = new Audio();
        a.preload = 'auto'; a.loop = false;
        a.setAttribute('playsinline', '');
        a.addEventListener('play', function () { mediaState('playing'); });
        a.addEventListener('pause', function () { if (!SPK.on) mediaState('paused'); });
        AUP.push(a);
      }
    }
    return AUP;
  }

  /* ── MediaSession（鎖屏控制）與 Wake Lock ─────────────────────────── */

  var wake = null;

  /* 鎖屏上的封面：宿主沒指定就用頁面自己的 apple-touch-icon／icon */
  function appIcon() {
    if (C.media && C.media.icon) return C.media.icon;
    try {
      var l = document.querySelector('link[rel="apple-touch-icon"], link[rel="icon"]');
      return (l && l.getAttribute('href')) || '';
    } catch (e) { return ''; }
  }

  function mediaSetup(title) {
    try {
      if (!navigator.mediaSession || !window.MediaMetadata) return;
      var m = C.media || {}, ic = appIcon();
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: title || L('bar'),
        artist: m.artist || '',
        album: m.album || '',
        artwork: ic ? [{ src: ic, sizes: '180x180', type: 'image/png' }] : []
      });
      navigator.mediaSession.setActionHandler('play', function () { if (SPK.pause) togglePause(); });
      navigator.mediaSession.setActionHandler('pause', function () { if (!SPK.pause) togglePause(); });
      navigator.mediaSession.setActionHandler('stop', stop);
      navigator.mediaSession.setActionHandler('previoustrack', function () { step(-1); });
      navigator.mediaSession.setActionHandler('nexttrack', function () { step(1); });
      /* 車機／耳機只給快轉鍵的，也讓它當上下一句用 */
      navigator.mediaSession.setActionHandler('seekbackward', function () { step(-1); });
      navigator.mediaSession.setActionHandler('seekforward', function () { step(1); });
    } catch (e) {}
    try {
      if (navigator.wakeLock && !wake) {
        navigator.wakeLock.request('screen').then(function (w) { wake = w; }, function () {});
      }
    } catch (e) {}
  }

  function mediaState(s) {
    try { if (navigator.mediaSession) navigator.mediaSession.playbackState = s; } catch (e) {}
  }

  function wakeRelease() {
    try { if (wake) { wake.release(); wake = null; } } catch (e) {}
  }

  /* ── 逐句標示與跟讀 ───────────────────────────────────────────────
   * 手動捲動偵測不可以用 scroll 事件——自己的 smooth scroll 會觸發它，
   * 於是「使用者捲過了」永遠成立，跟讀就再也不動了。改聽真正的輸入意圖事件。
   * ------------------------------------------------------------------- */

  function clearMark() {
    for (var i = 0; i < LAST.length; i++) {
      try { LAST[i].classList.remove('spk-now'); } catch (e) {}
    }
    LAST = [];
  }

  function mark(unit) {
    if (!unit || !PL) return;
    if (C.stillHere && !C.stillHere(PL.scope)) return;   // 不在這一頁就不動畫面
    clearMark();
    var els = C.elFor ? C.elFor(unit) : (unit.el || null);
    if (!els) return;
    if (!(els instanceof Array)) els = [els];
    if (!els.length) return;

    /* 收起來的摺疊區塊，讀到就打開 */
    try {
      var dt = els[0].closest && els[0].closest('details');
      if (dt && !dt.open) dt.open = true;
    } catch (e) {}

    for (var i = 0; i < els.length; i++) els[i].classList.add('spk-now');
    LAST = els;

    if (set().follow === 0) return;
    if (Date.now() < (SPK.hold || 0)) return;
    try { els[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    catch (e) { try { els[0].scrollIntoView(); } catch (e2) {} }
  }

  function bindIntent() {
    var evs = ['wheel', 'touchstart', 'touchmove', 'pointerdown'];
    for (var i = 0; i < evs.length; i++) {
      window.addEventListener(evs[i], function () {
        if (SPK.on) SPK.hold = Date.now() + C.holdScroll;
      }, { passive: true });
    }
    window.addEventListener('keydown', function (e) {
      if (!SPK.on) return;
      var k = e.key;
      if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'PageUp' || k === 'PageDown' ||
          k === 'Home' || k === 'End' || k === ' ') SPK.hold = Date.now() + C.holdScroll;
    });
  }

  /* 畫面重繪之後把標示點回原位。
     畫線／換色／寫筆記都會整個重繪，舊元素失效，不重綁就再也標不回來。 */
  function rebind() {
    if (!SPK.on || !PL) return;
    var u = PL.units[PL.i];
    if (!u) return;
    var hold = SPK.hold;
    SPK.hold = Date.now() + 1;      // 重綁不搶畫面
    mark(u);
    SPK.hold = hold;
  }

  /* ── 控制列 ───────────────────────────────────────────────────────── */

  function drawBar() {
    if (!SPK.on) { if (BAR) { BAR.parentNode && BAR.parentNode.removeChild(BAR); BAR = null; } return; }
    if (!BAR) {
      BAR = document.createElement('div');
      BAR.id = 'spkbar'; BAR.className = 'spkbar';
      document.body.appendChild(BAR);
      BAR.addEventListener('click', function (e) {
        var a = e.target.getAttribute && e.target.getAttribute('data-a');
        if (a === 'prev') step(-1);
        else if (a === 'next') step(1);
        else if (a === 'pause') togglePause();
        else if (a === 'stop') stop();
        else if (a === 'follow') toggleFollow();
      });
    }
    var st = SPK.buffering ? '<span class="pv">' + esc(L('buffering')) + '</span>'
      : (SPK.total ? '<span class="pv">' + ((SPK.i || 0) + 1) + '/' + SPK.total + '</span>' : '');
    /* 只要這一輪真的標示得到畫面上的元素，就該有「跟讀」開關——
       同一支 App 可能一頁有句子結構、另一頁沒有（整頁唸完那種），
       所以要問這一輪的第一個單位，不是問宿主有沒有給 elFor。 */
    var canFollow = false;
    try {
      var u0 = PL && PL.units && PL.units[0];
      if (u0) {
        var e0 = C.elFor ? C.elFor(u0) : u0.el;
        canFollow = !!(e0 && (!(e0 instanceof Array) || e0.length));
      }
    } catch (e) { canFollow = false; }
    var fol = canFollow
      ? '<button data-a="follow" class="' + (set().follow === 0 ? '' : 'on') + '" title="' +
        esc(L('follow')) + '">' + (set().follow === 0 ? '⇕' : '⇳') + '</button>' : '';
    BAR.innerHTML = '<span class="dot"></span><b>' + esc(SPK.title) + '</b>' + st +
      '<button data-a="prev" title="' + esc(L('prev')) + '">⏮</button>' +
      '<button data-a="pause" title="' + esc(SPK.pause ? L('resume') : L('pause')) + '">' +
      (SPK.pause ? '▶' : '⏸') + '</button>' +
      '<button data-a="next" title="' + esc(L('next')) + '">⏭</button>' +
      fol +
      '<button data-a="stop" title="' + esc(L('stop')) + '">✕</button>';
  }

  /* ── 串流播放 ─────────────────────────────────────────────────────── */

  function pump() {
    if (!PL || PL.tok !== SPK.tok) return;
    var end = Math.min(PL.units.length, Math.max(C.preStart, PL.i + 1 + C.preAhead));
    for (var k = PL.i; k < end && PL.running < C.parallel; k++) {
      if ((PL.try[k] || 0) < 3) grab(k);
    }
  }

  function grab(k) {
    if (!PL || PL.tok !== SPK.tok) return;
    if (PL.blobs[k] || PL.pend[k]) return;
    PL.pend[k] = 1; PL.running++;
    var my = SPK.tok;
    fetchAudio(speechText(PL.units[k])).then(function (b) {
      if (PL && PL.tok === my) PL.blobs[k] = b;
    }, function () {
      if (PL && PL.tok === my) { PL.fail++; PL.try[k] = (PL.try[k] || 0) + 1; }
    })['then'](function () {
      if (!PL || PL.tok !== my) return;
      PL.pend[k] = 0; PL.running--;
      var n = 0;
      for (var i = 0; i < PL.blobs.length; i++) if (PL.blobs[i]) n++;
      SPK.prep = n;
      drawBar(); pump();
    });
  }

  function playAt(k) {
    if (!PL || PL.tok !== SPK.tok) return;
    if (k >= PL.units.length) return stop();
    var b = PL.blobs[k];
    if (!b) {
      if ((PL.try[k] || 0) >= 3) {          // 這一段真的抓不到，跳過去，不要卡住整課
        PL.i = k; SPK.i = k; return playAt(k + 1);
      }
      SPK.buffering = true; SPK.i = k; drawBar(); pump();
      return setTimeout(function () { playAt(k); }, 150);
    }
    SPK.buffering = false;
    PL.i = k; SPK.i = k;
    var els = pair(), a = els[PL.cur];
    a.src = URL.createObjectURL(b);
    a.onended = function () {
      if (!PL || PL.tok !== SPK.tok) return;
      try { URL.revokeObjectURL(a.src); } catch (e) {}
      PL.cur = 1 - PL.cur;
      playAt(k + 1);
    };
    a.onerror = function () {
      if (PL && PL.tok === SPK.tok) { PL.cur = 1 - PL.cur; playAt(k + 1); }
    };
    var p = a.play(); if (p && p['catch']) p['catch'](function () {});
    mark(PL.units[k]);
    if (C.onItem) { try { C.onItem(k, PL.units[k]); } catch (e) {} }
    drawBar(); pump();
    var nb = PL.blobs[k + 1];
    if (nb) {
      var nx = els[1 - PL.cur];
      try { nx.src = URL.createObjectURL(nb); nx.load(); } catch (e) {}
    }
  }

  function waitAndStart() {
    var my = SPK.tok;
    (function tick() {
      if (!PL || PL.tok !== my || !SPK.on) return;
      var ready = PL.blobs[0] && (PL.blobs[1] || PL.units.length < 2);
      if (ready) return playAt(0);
      if (PL.fail >= 3 && !PL.blobs[0]) {
        var txt = [];
        for (var i = 0; i < PL.units.length; i++) txt.push(PL.units[i].t);
        stop(); toast(L('fallback'));
        return native(txt.join('\n'));
      }
      setTimeout(tick, 120);
    })();
  }

  /* ── 裝置內建語音（離線／Worker 掛掉時的退路）──────────────────────── */

  function native(t) {
    if (!window.speechSynthesis) return toast(L('nosupport'));
    try { speechSynthesis.cancel(); } catch (e) {}
    var u = new window.SpeechSynthesisUtterance(sanitize(t));
    u.lang = C.lang;
    u.rate = 0.94 + (set().rate || 0) * 0.05;
    try {
      var vs = speechSynthesis.getVoices(), base = C.lang.split('-')[0], v = null, i;
      for (i = 0; i < vs.length; i++) if (vs[i].lang.replace('_', '-') === C.lang) { v = vs[i]; break; }
      if (!v) for (i = 0; i < vs.length; i++) if (vs[i].lang.indexOf(base) === 0) { v = vs[i]; break; }
      if (v) u.voice = v;
    } catch (e) {}
    try { speechSynthesis.speak(u); } catch (e) {}
  }

  /* ── 對外 API ─────────────────────────────────────────────────────── */

  function play(units, opts) {
    if (!C) throw new Error('TTS321.init() 還沒呼叫');
    opts = opts || {};
    units = (units || []).filter(function (u) { return u && speechText(u); });
    if (!units.length) return;

    if (!set().human) {
      var txt = [];
      for (var i = 0; i < units.length; i++) txt.push(units[i].t);
      return native(txt.join('\n'));
    }
    stop();
    var my = ++SPK.tok;
    SPK = {
      on: true, pause: false, tok: my, i: 0, prep: 0,
      total: units.length, title: opts.title || L('bar'), hold: 0
    };
    PL = {
      tok: my, units: units, blobs: [], pend: [], try: [], i: 0, cur: 0,
      scope: opts.scope || null, fail: 0, running: 0
    };
    var els = pair(), k;
    for (k = 0; k < els.length; k++) {
      try { els[k].pause(); els[k].removeAttribute('src'); els[k].load(); } catch (e) {}
    }
    /* iOS 只認手勢當下的 play()：趁這一刻把兩個播放器都解鎖 */
    for (k = 0; k < els.length; k++) {
      try {
        els[k].src = SILENT;
        var p = els[k].play(); if (p && p['catch']) p['catch'](function () {});
      } catch (e) {}
    }
    setTimeout(function () {
      for (var i = 1; i < els.length; i++) { try { els[i].pause(); } catch (e) {} }
    }, 0);

    mediaSetup(SPK.title);
    drawBar();
    pump();
    waitAndStart();
  }

  function stop() {
    SPK.tok++; SPK.on = false; SPK.pause = false; SPK.buffering = false;
    PL = null;
    try {
      var els = pair();
      for (var i = 0; i < els.length; i++) { els[i].pause(); els[i].onended = null; els[i].onerror = null; }
    } catch (e) {}
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {}
    wakeRelease();
    mediaState('paused');
    clearMark();
    drawBar();
  }

  function togglePause() {
    if (!SPK.on) return;
    SPK.pause = !SPK.pause;
    try {
      var a = pair()[PL ? PL.cur : 0];
      if (SPK.pause) a.pause();
      else { var p = a.play(); if (p && p['catch']) p['catch'](function () {}); }
    } catch (e) {}
    mediaState(SPK.pause ? 'paused' : 'playing');
    drawBar();
  }

  function step(d) {
    if (!SPK.on || !PL) return;
    var k = Math.max(0, Math.min(PL.units.length - 1, PL.i + d));
    try { pair()[PL.cur].pause(); } catch (e) {}
    PL.cur = 1 - PL.cur;
    SPK.pause = false;
    playAt(k);
  }

  function toggleFollow() {
    var s = set();
    s.follow = (s.follow === 0) ? 1 : 0;
    save(); drawBar();
    toast(L(s.follow !== 0 ? 'followOn' : 'followOff'));
    if (s.follow !== 0) { SPK.hold = 0; rebind(); }
  }

  /* 整課預先下載：抓完就進 IndexedDB，之後離線也能聽 */
  function prefetch(units, onDone, onProgress) {
    units = units || [];
    var ok = 0, fail = 0, idx = 0, live = 0;
    if (!units.length) return onDone && onDone(0, 0);
    function next() {
      while (live < C.parallel && idx < units.length) {
        (function (u) {
          live++; idx++;
          fetchAudio(speechText(u)).then(function () { ok++; }, function () { fail++; })['then'](function () {
            live--;
            if (onProgress) onProgress(ok + fail, units.length);
            if (ok + fail >= units.length) { if (onDone) onDone(ok, fail); }
            else next();
          });
        })(units[idx]);
      }
    }
    next();
  }

  /* ── 從畫面直接生出朗讀單元 ───────────────────────────────────────
   * 新 App 最花時間的一段，其實是「把內容切成句子，而且每一句要綁得到畫面上的
   * 元素」——沒有這一步就沒有逐句標示，也沒有跟讀。
   *
   * 這個函式就地把 root 底下的文字切成句子、包成 <span class="ms">，回傳
   * [{t, el}]。App 不必改自己的渲染方式，掛上去就有跟讀。
   *
   * 已經自己有句子結構的 App（像創世記講義的 span.ms[data-s]）不要用這個，
   * 直接給自己的 units 與 elFor 即可。
   * ------------------------------------------------------------------- */

  function fromDOM(root, opt) {
    opt = opt || {};
    var sel = opt.sel || 'p,li,h2,h3,h4,blockquote,td',
        punct = opt.punct || '。！？；!?',
        skip = opt.skip || '',
        minLen = opt.min || 1;
    if (!root) return [];

    var blocks = root.querySelectorAll(sel), units = [], seq = 0;

    for (var b = 0; b < blocks.length; b++) {
      var el = blocks[b];
      if (skip && el.closest && el.closest(skip)) continue;
      if (el.querySelector && el.querySelector(sel)) continue;   // 只取最內層，不重複唸
      if (el.getAttribute('data-noread') != null) continue;

      /* 已經包過就沿用，不要每次重切（重切會讓畫線之類的標記失效）*/
      var had = el.querySelectorAll('span.ms');
      if (had.length) {
        for (var h = 0; h < had.length; h++) {
          var ht = had[h].textContent.replace(/^\s+|\s+$/g, '');
          if (ht.length >= minLen) units.push({ t: ht, el: had[h], key: had[h].getAttribute('data-s') });
        }
        continue;
      }

      var txt = el.textContent;
      if (!txt || !txt.replace(/^\s+|\s+$/g, '')) continue;

      /* 切句：標點跟著前一句走 */
      var parts = [], buf = '', i, ch;
      for (i = 0; i < txt.length; i++) {
        ch = txt.charAt(i); buf += ch;
        if (punct.indexOf(ch) >= 0) { parts.push(buf); buf = ''; }
      }
      if (buf.replace(/^\s+|\s+$/g, '')) parts.push(buf);
      if (!parts.length) continue;

      /* 重建這個區塊的內容——只在這裡動 DOM，動完就不再動 */
      el.textContent = '';
      for (i = 0; i < parts.length; i++) {
        var sp = document.createElement('span');
        sp.className = 'ms';
        sp.setAttribute('data-s', String(seq));
        sp.textContent = parts[i];
        el.appendChild(sp);
        var pt = parts[i].replace(/^\s+|\s+$/g, '');
        if (pt.length >= minLen) units.push({ t: pt, el: sp, key: String(seq) });
        seq++;
      }
    }
    return units;
  }

  function init(cfg) {
    C = ext(ext({}, DEF), cfg || {});
    C.chunk = ext(ext({}, DEF.chunk), (cfg && cfg.chunk) || {});
    C.sil = ext(ext({}, DEF.sil), (cfg && cfg.sil) || {});
    C.labels = ext(ext({}, DEF.labels), (cfg && cfg.labels) || {});
    buildSay();
    bindIntent();
    if (cfg && cfg.warmUp !== false) setTimeout(warmUp, 1200);
    return API;
  }

  var API = {
    init: init,
    play: play,
    fromDOM: fromDOM,
    stop: stop,
    togglePause: togglePause,
    step: step,
    toggleFollow: toggleFollow,
    rebind: rebind,
    prefetch: prefetch,
    warmUp: warmUp,
    chunks: chunks,
    sanitize: sanitize,
    cacheCount: cacheCount,
    cacheHave: cacheHave,
    cacheClear: cacheClear,
    isOn: function () { return !!SPK.on; },
    isPaused: function () { return !!SPK.pause; },
    index: function () { return PL ? PL.i : -1; },
    total: function () { return PL ? PL.units.length : 0; },
    voices: function () { return C ? C.voices : {}; },
    setVoice: function (k) { var s = set(); s.voice = k; save(); stop(); },
    version: '1.1.0'
  };
  return API;
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TTS321;
