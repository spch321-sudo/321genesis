# 321創世記講義

創世記全書五十章：逐節原文解經、講章逐字稿、321 生命應用。

線上版：**https://spch321-sudo.github.io/321genesis/**

## 這個 repo 裡有什麼

```
index.html              整支 App（含全部講義內容，約 5.9 MB）
manifest.webmanifest    PWA 設定：名稱、圖示、啟動畫面顏色
sw.js                   Service Worker，讓 App 離線也能讀
icons/                  圖示（64／180／192／512／1024）
.nojekyll               告訴 GitHub Pages 不要用 Jekyll 處理檔案
404.html                任何找不到的網址都導回 App
```

`index.html` 是**單一檔案**：經文、解經、講章、爭議議題、繁簡對照表全部在裡面，
不連任何 CDN，也沒有外部字型。所以它下載一次就能永久離線使用。

## 怎麼發佈（三選一）

### 一、網頁上傳，最省事

1. 到 GitHub 開一個新的 repository，名字建議 `321genesis`，選 **Public**
2. 進去按 **Add file → Upload files**，把這個資料夾裡的**全部檔案**拖進去
   （包含 `icons` 資料夾與 `.nojekyll`；若拖曳時看不到 `.nojekyll`，
   改用 **Add file → Create new file**，檔名就打 `.nojekyll`，內容留空）
3. 按 **Commit changes**
4. 進 **Settings → Pages**，Source 選 **Deploy from a branch**，
   分支選 `main`、資料夾選 `/ (root)`，按 **Save**
5. 等一到兩分鐘，網址就會出現在同一頁上

### 二、用指令列

```bash
cd 321genesis                      # 這個資料夾
git init
git add -A
git commit -m "321創世記講義 App"
git branch -M main
git remote add origin https://github.com/spch321-sudo/321genesis.git
git push -u origin main
```

推上去之後一樣要去 **Settings → Pages** 把來源設成 `main` / `/ (root)`。

### 三、更新內容時

把新的 `index.html` 蓋上去，重新 commit 就好。
`sw.js` 裡的版本字串每次重新打包都會變，使用者一開啟就會自動換成新版，
不需要叫他們清除快取。

## 手機上「加到主畫面」

- **iPhone**：用 Safari 打開網址 → 分享鍵 → 加入主畫面
- **Android**：用 Chrome 打開網址 → 右上角選單 → 安裝應用程式／加到主畫面

加完之後圖示會出現在桌面，開起來沒有網址列，跟一般 App 一樣，而且可以離線讀。

## 兩個外部服務（可有可無）

App 裡的**真人語音朗讀**與**問小智**會連到這兩個網址：

- `https://azure-tts.spch321.workers.dev`
- `https://xiaozhi-proxy.spch321.workers.dev`

這兩個是既有的 Cloudflare Worker，跟這個 repo 無關，也不必一起放上來。
連不上的時候 App 會自動改用手機內建的語音，其餘功能完全不受影響。

## 授權與內容

- 聖經經文採用**和合本（神版）**
- 講義內容為 321 聖經講義・創世記，50 章／1533 節／解經 530 區塊／講章 50 篇／爭議議題 304 條
