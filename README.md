# 321 App Core — 朗讀模組 v1.1.0

把「朗讀」這一整組功能收成一份，掛到任何 321 App 上。

抽出來的理由很實際：這一組功能在五個 App 裡**各自被重新做過一次**——破音字校正 4 次、
朗讀跟讀 4 次、串流切塊 3 次——而且每一次都重新踩了同一批坑。

---

## 一、檔案

```
321-app-core/
  tts.js      29 KB   朗讀核心（ES5，無相依）
  tts.css     4 KB    正在朗讀的那一句 ＋ 底部控制列
  README.md           這一份
```

**語法是 ES5**，不是為了復古，是為了讓 WPS WebView 那幾支 App（空中團契、晨讀321）
也能共用同一份。核心只做一次決定，全家都受益。

---

## 二、最小掛法

```html
<style>  /* …你自己的樣式… */
  /* ← tts.css 貼在這裡 */
</style>
...
<script>  /* ← tts.js 貼在這裡 */ </script>
<script>
TTS321.init({
  worker: 'https://azure-tts.spch321.workers.dev',
  voices: TTS_VOICES,           // 你的語音表
  defaultVoice: 'yunfan',
  settings: {
    get: function () { return S.set; },   // 要有 human / voice / rate / follow
    save: function () { save(); }
  }
});

function speakThisPage(){
  if (TTS321.isOn()) return TTS321.stop();
  var units = TTS321.fromDOM(document.getElementById('view'));
  TTS321.play(units, { title: '朗讀中' });
}
</script>
```

這樣就有：串流播放、逐句標示、自動跟讀、離線快取、鎖屏控制、冷啟動重試。

---

## 三、宿主契約

核心**不認識任何一個 App 的資料結構**。App 專屬的部分全部由 `init(cfg)` 提供。

### 一定要給

| 欄位 | 說明 |
|---|---|
| `worker` | TTS Worker 端點 |
| `voices` | `{ key: {name, label, desc} }`，`name` 是真正的 Azure 語音代碼 |
| `settings.get()` | 回傳 `{human, voice, rate, follow}`。`human=0` 走裝置內建語音；`follow=0` 關掉跟讀 |
| `settings.save()` | 設定改了要存起來 |

### 通常要給

| 欄位 | 預設 | 說明 |
|---|---|---|
| `lang` | `'zh-TW'` | 裝置內建語音的語言標記 |
| `chunk` | `{punct:'。！？；\n', min:110, max:300}` | **英文版一定要改**：`{punct:'.!?;', min:220, max:500}`——英文一句長得多 |
| `say` | `[]` | 破音字修正 `[[/天地/g,'天帝'], …]` |
| `t2s` | `null` | 繁→簡：單字表 `{繁:簡}` 或宿主自己的轉換函式 `fn(str)->str`。給了就**自動展開 say 的簡體版** |
| `stillHere` | `null` | `fn(scope) -> bool`。使用者翻到別頁時，核心就不再動畫面 |
| `clean` | `null` | `fn(text) -> text`。App 專屬的朗讀前清理（跳過原文、括號出處…） |
| `toast` | `null` | `fn(msg)` |
| `labels` | 中文 | 控制列文案，做英文版時整包換掉 |
| `media` | `null` | `{artist, album, icon}`　鎖屏／耳機／車機上顯示什麼。封面沒給就用頁面的 apple-touch-icon |

### 進階

| 欄位 | 預設 | 說明 |
|---|---|---|
| `elFor` | 用 `unit.el` | `fn(unit) -> el \| [el]`。自己已有句子結構的 App 用這個 |
| `preStart` / `preAhead` / `parallel` | 2 / 8 / 4 | 抓幾段就開播、往前預抓幾段、同時幾個請求 |
| `retry` | `[800, 1600]` | Worker 冷啟動的退避重試 |
| `holdScroll` | `6000` | 使用者自己捲過之後，幾毫秒內不搶畫面 |
| `onItem` | `null` | `fn(index, unit)` 每換一句回呼 |

---

## 四、API

```js
TTS321.init(cfg)                 // 掛上去，回傳 API 本身
TTS321.fromDOM(root, opt)        // 就地切句 → [{t, el, key}]
TTS321.play(units, {title, scope})
TTS321.stop() / .togglePause() / .step(±1) / .toggleFollow()
TTS321.rebind()                  // ★ 畫面重繪之後一定要呼叫
TTS321.prefetch(units, onDone, onProgress)   // 整課預先下載
TTS321.cacheCount(cb) / .cacheClear(cb)
TTS321.cacheHave(units, cb)      // 這幾段已經抓了幾段 → cb(已有, 全部)
TTS321.isOn() / .isPaused() / .index() / .total()
TTS321.voices() / .setVoice(key)
TTS321.chunks(text) / .sanitize(text)
TTS321.warmUp()
TTS321.version                   // '1.1.0'
```

### `fromDOM(root, opt)`

新 App 最花時間的那一段，其實是「把內容切成句子，而且每一句要綁得到畫面上的元素」——
沒有這一步就沒有逐句標示，也沒有跟讀。這個函式就地把 `root` 底下的文字切成句子、
包成 `<span class="ms" data-s="…">`，回傳 `[{t, el, key}]`。

```js
TTS321.fromDOM(root, {
  sel:   'p,li,h2,h3,h4,blockquote,td',   // 要唸的區塊
  punct: '。！？；!?',                      // 切句的標點
  skip:  '.eyebrow,.flag',                 // 不唸的（眉標、標籤…）
  min:   1                                 // 太短的片段不獨立成句
})
```

已經自己有句子結構的 App（像創世記講義的 `span.ms[data-s]`）**不要用這個**，
直接給自己的 units 與 `elFor` 即可。

單一元素也可以用 `data-noread` 屬性排除。

---

## 五、樣式

只有兩樣東西：`.spk-now`（正在讀的那一句）和 `.spkbar`（控制列）。顏色全走 CSS 變數：

| 變數 | 預設 | 說明 |
|---|---|---|
| `--spk-now` | `#FFE9A8` | 正在讀那一句的底色 |
| `--spk-bar-bg` / `--spk-bar-fg` | 深藍 / 白 | 控制列 |
| `--spk-bar-on` | `#F0C462` | 跟讀開著時的顏色 |
| `--spk-bar-bottom` | `64px` | **底部分頁列的高度**，照你的 App 調（可整段 calc，含 `env(safe-area-inset-bottom)`）|
| `--spk-bar-gap-right` | `0px` | **右下角有浮動鈕（例如「小智」）就設它的寬度＋邊距** |
| `--spk-bar-z` | `60` | 宿主有更高的浮動層就疊上去 |
| `--spk-btn-bg` / `--spk-btn-size` / `--spk-btn-radius` / `--spk-btn-font` | 透明 / 32px / 8px / 16px | 按鈕外觀。宿主本來就有一套樣子的，覆寫這四個就能長得一模一樣 |

覆寫變數時，**選擇器要跟核心裡的 `:root[data-dark="…"]` 一樣重**，否則蓋不過它：

```css
:root, :root[data-dark="0"], :root[data-dark="1"]{ --spk-now:var(--hl-now); … }
```

主題：核心會自己跟著宿主走，支援 `data-dark="1"`（321 這一家的慣例）、
`data-theme="dark"`、`class="dark"`。只有在宿主完全沒有自己的主題開關時，
才去聽作業系統——否則會出現「App 是淺色的，標示卻是深色的」。

---

## 六、七個一定要知道的坑

這七個是各 App 分別踩過、代價最高的。核心已經處理掉了，但接的時候要知道為什麼。

### 1　畫面重繪之後一定要 `rebind()`

畫線、換色、寫筆記都會整個重繪，舊的句子元素失效，標示會消失**而且之後再也標不回來**。

```js
function render(){
  /* …你的渲染… */
  TTS321.rebind();      // ← 加這一行
}
```

### 2　手動捲動偵測不可以用 scroll 事件

自己的 smooth scroll 會觸發 scroll 事件，於是「使用者捲過了」永遠成立，跟讀就再也不動了。
核心改聽 `wheel`／`touchstart`／`touchmove`／`pointerdown`／方向鍵——那些只有真的輸入才會發生。

### 3　破音字表的繁體 pattern 在簡體模式下會全部失效

學神神學的教訓：SAYFIX 全是繁體 pattern，簡體模式下畫面文字已經是簡體，
整張表比對不到——**902 處校正有 733 處對簡體讀者完全失效**。

核心在 `buildSay()` 做掉：給 `t2s`（繁→簡單字表，`make_scmap.py` 本來就有），
每一條 pattern 自動多產生一份簡體版。

### 4　第一次朗讀失敗是 Worker 冷啟動，不是語音的 bug

領導力 App 的精確重現：冷開 App → 切簡體 → 真人語音失敗、掉到機器音 →
切繁體 → 正常 → 再切回簡體 → 也正常了。

**「只有一個 session 裡的第一次會失敗，不管選哪個」是冷啟動的指紋。**
核心的解法是開機預熱（`init` 後 1.2 秒發一個空包）＋ 退避重試（800ms、1600ms）。

### 5　抓不到的那一段要跳過，不能卡住

只往前推進的佇列，一段抓不到就永遠卡在那裡。核心每次從**目前位置**往前掃，
每段記重試次數，三次失敗才跳過去。

### 6　送去唸的字 ≠ 畫面上的字

畫面要留著原文、書名號、`8:28` 這些；送去唸的要換成「八章二十八節」，原文只唸一遍。
**核心在送出前統一 sanitize**，宿主只給畫面上的字就好——不必每支 App 都記得先清一次，
漏掉的下場是整段希伯來文照著亂唸。App 專屬的清理規則寫在 `clean` 裡。

### 7　iOS 只認手勢當下的 `play()`

所以 `play()` 裡會趁使用者按下按鈕的那一刻，把兩個 `<audio>` 都用一段無聲 mp3 解鎖。
這也是為什麼 **`TTS321.play()` 必須在使用者點擊的同步流程裡呼叫**——
不要放在 `await` 之後或 `setTimeout` 裡。

---

## 七、已驗證

兩支性質相反的 App 各掛一次：一支從來沒有這組功能，一支這組功能最複雜。

### 啟示錄 App（從零掛上）

原本只有「整頁文字一次唸完」，沒有串流、沒有逐句標示、沒有跟讀。
接合層就是 README 第二節那 15 行。

| 驗什麼 | 結果 |
|---|---|
| JS 語法 | 4 個 script 區塊，`node --check` 全過 |
| 就地切句 | 掛載前 `span.ms` 0 個 → 播放時 14 個 |
| 串流 | 14 段，實際發出 11 個請求（邊播邊抓，不是一次抓完） |
| 逐句標示 | 同一時間只有 1 個 `.spk-now`，文字正確 |
| 往下推進 | index 1 → 2 → 3 |
| 自動捲動 | `scrollY` 0 → 420 |
| 手動捲動讓開 | 使用者捲到 160 後，2.2 秒內沒有被搶回 |
| 關掉跟讀 | 圖示 ⇳ → ⇕，畫面不再捲 |
| 上一句／下一句／暫停／停止 | 全部正常；停止後標示與控制列一起清掉 |
| 主題 | App 淺色 ＋ OS 深色 → 標示跟 App 走，不跟 OS 走 |
| 主控台錯誤 | 0 |

### 創世記講義 App（最嚴格的那一支）

核心原本就是從這支抽出來的，所以這一輪是**把它自己換回核心**——
它有既有的句子結構（`.mks[data-k]`）、畫線重繪、繁簡切換、英文版、教學提詞機，
四樣都得繼續成立。舊的內嵌實作 350 行整節刪掉，接合層剩 60 行（多的是這支 App
自己的原文處理規則）。

| 驗什麼 | 結果 |
|---|---|
| JS 語法 | 繁體版、英文版各 2 個 script 區塊，全過 |
| 既有句子結構 | 第 1 課 286 句 `.mks` 全部對得到，207 段每段都綁得到畫面 |
| 開播延遲 | 267 ms（只抓了 8 段就開口） |
| 邊播邊抓 | ✓ 抓的段數 < 總段數 |
| 抓不到的段 | 跳過去，不卡住 |
| **畫線重繪後標示回得來** | ✓ 回到同一句，且與新畫的線並存 |
| 原文只唸一遍 | ✓ 有拼音唸拼音，沒拼音整段略過 |
| 破音字 | ✓「天地」唸成 ㄉㄧˋ，「慢慢地」不受影響 |
| 翻到別課 | ✓ 不再動畫面 |
| 整課預先下載 | ✓ 176 段全下載，按鈕顯示「已有 13/176 → ✓ 已下載」 |
| 教學提詞機裡朗讀 | ✓ |
| 簡體模式 | ✓ 破音字仍然生效 |
| 英文版 | ✓ en-US-Andrew、切塊 220–500 字、`8:28` → chapter 8 verse 28、裝置語音 en-US |
| 鎖屏中繼資料 | ✓ 課名／卷名／團契名都掛上 |
| **換基座前後的畫面** | 控制列的位置、大小、顏色、z-index、標示底色、文字**逐項比對一致**（深淺色各驗一次）|
| 主控台錯誤 | 0（只剩沙箱連不到 Worker 的那一筆） |

換基座前後的截圖並排比對：一般使用者看不出換過。

## 八、版本

**v1.1.0**　創世記講義 App 遷移過來時補上的：

- `cacheHave(units, cb)`——「這一課已經下載了幾段」，一次交易查完
- `media: {artist, album, icon}`——鎖屏／耳機／車機上的中繼資料
- `isPaused()`
- `t2s` 也接受轉換函式（詞組表那種，不只單字表）
- **送出前統一 sanitize**（見坑 6）。原本要宿主自己先清，漏掉就整段原文亂唸
- 跟讀鈕改成問「這一輪的第一個單位標示得到嗎」，而不是問宿主有沒有給 `elFor`——
  同一支 App 可能一頁有句子結構、另一頁沒有
- 切換跟讀時會 toast（`labels.followOn` / `followOff`）
- 進度字「3/14」改成跟著控制列自己的字色走再調暗，不再寫死白色——
  有些 App 的控制列在深色模式反而是淺底深字
- 按鈕外觀開放四個變數，宿主可以長得跟原本一模一樣
- `--spk-bar-z`；離線時不預熱

**v1.0.0**　從創世記講義 App 抽出，折進四個 App 的教訓（冷啟動重試、簡體破音字展開、
重繪重綁、意圖事件偵測手動捲動），新增 `fromDOM()` 讓沒有句子結構的 App 也能直接用。

升版規則：**改 core 就是改全部**。任何一個 App 發現的 bug，修在 core，其他 App 升版拿，
不准在 App 裡就地補。每個 App 的 README 要記自己用的是哪一版。

### 誰用了哪一版

| App | 版本 | 怎麼拿到的 |
|---|---|---|
| 創世記講義（繁／簡／英） | v1.1.0 | `build_app.py` 建檔時內嵌 `{{CORE_TTS_JS}}` / `{{CORE_TTS_CSS}}` |
| 啟示錄 | v1.1.0 | 手工貼進 `index.core.html` |
