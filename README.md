# Nurture Garden｜藴育花園

Nurture Garden 是一個中英雙語的互動式 3D 花園體驗。玩家可在沙盒中組合素材、培育藴育物與花藝作品，並透過 VIVERSE 帳號同步收藏；也能製作互動明信片或盆栽 GLB 禮物，以密語跨裝置收禮。

## 專案狀態

- 前端：Vite + TypeScript + Three.js
- 帳號：VIVERSE SSO
- 帳號資料：VIVERSE Cloud Save，依 VIVERSE account ID 隔離
- 禮物服務：Google Cloud Run + Firestore + private Cloud Storage bucket
- 介面語言：繁體中文／英文（依瀏覽器語言，可在設定切換）
- Shared Garden 已移除，不在目前功能範圍內

## 2026-08-28 更新

- 新增登入啟動畫面：登入期間顯示奇幻花園背景、閃爍星光與寶石；登入完成後播放禮物盒花朵與雙語品牌文案。
- 取消 Guest Mode：偵測不到 VIVERSE 登入工作階段時會要求使用者登入，未登入不能進入花園或收取禮物。
- 修復隱藏版解鎖音效：Moonlight Pollen 與 Garden Fairy 共用相同的 `secretUnlock` 音效，並在 unlock 畫面顯示後播放。
- 更新密語字串：收禮欄位為「輸入通關密語」／`Enter the secret phrase`；送禮範例為「例如：thankyou」／`e.g. thankyou`。

## 快速開始

### 環境需求

- Node.js 20.19+（建議使用目前的 Node.js 20 LTS）
- npm

### 本機開發

```bash
cp .env.example .env.local
npm install
npm run dev
```

請使用 Vite 顯示的 localhost 網址，不要直接用 `file://` 開啟 `index.html`。

### 建置與預覽

```bash
npm run build
npm run preview
```

正式部署的靜態內容位於 `dist/`。`dist/` 是產物，不要手動修改或提交。

目前沒有獨立的自動化測試套件；提交 PR 前至少必須通過 `npm run build`，並完成下方的手動回歸檢查。

## 環境變數

請從 `.env.example` 建立個人的 `.env.local`。`.env.local` 不得提交，也不要把 token、帳密或雲端憑證寫進前端程式。

| 變數 | 用途 | 是否必要 |
| --- | --- | --- |
| `VITE_VIVERSE_CLIENT_ID` | 本機或非 Worlds hostname 環境使用的 VIVERSE App ID | 本機測試登入時需要 |
| `VITE_GIFT_API_BASE` | 已部署的 Gift API origin，例如 Cloud Run URL | 跨裝置送收禮需要 |
| `GIFT_VAULT_ALLOWED_ORIGIN` | 本機 Gift API middleware 的 CORS origin | 選用 |
| `GIFT_VAULT_DIR` | 本機 Gift API 的測試資料目錄 | 選用 |
| `VITE_POLYGON_UPLOAD_ENDPOINT` | Polygon Streaming 上傳端點 | 選用 |
| `VITE_POLYGON_CMS_URL` | Polygon Streaming CMS 網址 | 選用 |
| `PLS_*` | 本機 server-side `pls-cli` 的群組與轉檔選項 | 使用 Polygon Streaming 時需要 |

`PLS_*` 只由 Vite server middleware 讀取，不會透過 `import.meta.env` 暴露給瀏覽器。VIVERSE Worlds 部署時，程式會優先從 `<appId>-preview.world.viverse.app` 或正式 Worlds hostname 解析 App ID。

## 目錄與主要入口

```text
.
├── public/assets/                 # 正式使用的 GLB 與貼圖素材
├── src/
│   ├── main.ts                    # Vite 前端入口與 viewport 處理
│   ├── alchemy-sandbox-fragment.html
│   │                              # 目前主要 UI、沙盒與禮物流程
│   ├── app/AlchemySandboxApp.ts   # 組裝帳號、儲存、3D viewer 與主畫面
│   ├── auth/ViverseAuthService.ts # VIVERSE SSO 與基本 profile
│   ├── storage/ViverseGardenStorage.ts
│   │                              # account-scoped VIVERSE Cloud Save
│   ├── render/FlowerModelViewer.ts
│   │                              # 3D 預覽、GLB 匯出與壓縮
│   └── polygonStreaming/          # Polygon Streaming adapter
├── tools/                         # 本機 Gift API／Polygon middleware
├── google-cloud/
│   ├── gift-api/                  # 可部署至 Cloud Run 的獨立 Node.js API
│   └── deploy-gift-api.sh         # Google Cloud 部署腳本
├── marketing/                     # 簡報、展示與行銷素材
├── .env.example
├── vite.config.ts
└── package.json
```

`src/main.ts` 目前只啟動 `AlchemySandboxApp`。`src/` 內其餘早期 prototype 模組仍保留供參考，但若沒有從這條入口鏈匯入，就不屬於目前執行中的遊戲流程。修改前請先確認實際 import 關係，避免在未使用的 prototype 上修正問題。

## 資料與同步邊界

### VIVERSE Cloud Save

登入後，以下帳號資料會寫入 VIVERSE Cloud Save：

- 三類收藏：藴育物、花藝作品、花園 History
- 已刪除收藏的同步標記
- 發現紀錄
- 「我的珍藏」禮物清單與 metadata；舊版 local-only 禮物可能仍含內嵌 binary

Cloud Save snapshot 目前為 `v4`，包含 `ownerId`。儲存 key 由 account ID 雜湊產生，讀寫時也會再次檢查 owner，避免切換帳號後混用資料。登入完成後會立即載入，頁面可見時登入帳號約每 30 秒重新同步；視窗重新聚焦或網路恢復時也會觸發同步。

不要移除 `ownerId`、把資料改回共用 key，或在尚未確認目前帳號時套用舊 snapshot。這些是帳號收藏隔離的重要防線。

### 瀏覽器本機資料

- `localStorage`：只保存登入模式提示 `art-of-my-life:auth-mode:v1` 與是否看過教學 `nurture-garden-tutorial-seen-v1`。
- IndexedDB `nurture-garden-gift-vault-v1`：保存已建立／開啟過的禮物 GLB 快取，避免 Cloud Save 直接承載大型 binary。珍藏的歸屬仍由帳號 Cloud Save 清單與 `ownerId` 判定。
- `.nurture-garden-gift-vault/`：未設定 `VITE_GIFT_API_BASE` 時，本機開發 middleware 使用的測試禮物資料。

清除瀏覽器資料可能使本機 GLB 快取消失，但不應改變雲端珍藏的帳號歸屬；再次開啟禮物時才按需從 Gift API 下載 GLB。

## 禮物流程

互動明信片與盆栽植物都提供兩條路徑：

1. `下載 GLB`：只在瀏覽器直接產生與下載，不上傳 Gift API，也不受 Gift API 的 28 MiB 上傳限制。
2. `禮物準備完成`：以 Meshopt／WebP 等方式建立 cloud 版本，再上傳 Gift API；保留密語收禮、雲端珍藏與跨裝置取得能力，GLB 必須小於或等於 28 MiB。

盆栽必須先完成並插入小卡，才會顯示可用的 GLB 下載動作。收到的禮物不提供「下載收到的 GLB」按鈕。

目前不提供 Guest Mode；未登入時會先顯示 VIVERSE 登入提示，登入後才能進入花園、拆禮物及使用「我的珍藏」。

### 本機 Gift API

未設定 `VITE_GIFT_API_BASE` 時，`npm run dev` 會使用 `/api/gifts` middleware，資料寫入 `.nurture-garden-gift-vault/`。這只適合單機開發，不支援真正跨裝置。

### Google Cloud Gift API

正式服務位於 `google-cloud/gift-api/`，使用：

- Cloud Run：HTTP API
- Firestore：密語與禮物 metadata
- private Cloud Storage bucket：GLB 與 preview

部署前需要 Google Cloud Billing Account、`gcloud` 登入權限，以及正確的 VIVERSE origin：

```bash
bash google-cloud/deploy-gift-api.sh YOUR_PROJECT_ID YOUR_VIVERSE_ORIGIN
```

部署完成後，把輸出的 Cloud Run HTTPS URL 放入本機 `.env.local` 的 `VITE_GIFT_API_BASE`，重新執行 `npm run build`。不要把實際 project ID、bucket 名稱或憑證提交到 repo。

## Polygon Streaming（選用）

本機 `/api/polygon/upload` 會呼叫官方 `pls-cli`。若要使用：

```bash
npm run polygon:install-cli
./tools/bin/pls-cli login --email=YOUR_EMAIL --password=YOUR_PASSWORD
npm run polygon:status
```

登入 token 由 `pls-cli` 保存在使用者家目錄，不要寫入 `.env` 或前端。純靜態 `dist/` 無法執行 CLI；正式環境若需要此功能，必須另有可執行 `pls-cli` 的 server endpoint。

## 共編流程

### Branch 與 commit

- 從最新主分支建立短生命週期 branch，例如 `feature/gift-copy`、`fix/account-keepsakes`。
- 一個 branch 聚焦一個行為，避免把 UI、同步與物理反應的大型改動混在同一個 commit。
- Commit message 建議使用 `feat:`、`fix:`、`docs:`、`refactor:`、`chore:` 前綴。
- 不要直接修改 `dist/`、歷史 ZIP 或舊版輸出資料夾；只修改 source，再重新 build 驗證。

### 提交前

```bash
npm install
npm run build
```

再確認：

- `.env.local`、token、帳密、HAR、ZIP、`node_modules/`、`dist/` 沒有進入 staged files。
- 桌面與 mobile layout 都能操作，且未被需求要求修改的 viewport 沒有位移。
- 未登入時看不到「我的珍藏」；登入後才出現帳號自己的珍藏。
- 使用帳號 A／B 交叉登入，收藏數與內容不會互相出現。
- 登入會完成 Cloud Save restore，30 秒同步、重新聚焦及網路恢復後同步仍正常。
- 登入只先同步珍藏清單，不會預先下載每個 GLB；點開珍藏時才下載。
- 初次自動教學會等待登入完成；從「再看一次花園教學」重播時不顯示登入等待文案。
- 互動明信片與盆栽的直接下載、cloud gift、密語收禮都各測一次。
- 進入禮物畫面時沙盒計時與反應暫停，返回畫布後才繼續。

### Pull Request 說明至少包含

- 改了什麼，以及明確未改動的流程
- 使用的測試網址／裝置尺寸
- `npm run build` 結果
- 需要的環境變數或雲端設定變更
- UI 改動前後截圖；同步改動則附帳號 A／B 測試結果

## Git 收錄原則

應提交：

- `src/`、`public/assets/`、`tools/`、`google-cloud/gift-api/` source
- `package.json`、兩份 lockfile、TypeScript／Vite 設定
- `.env.example` 與文件

不應提交：

- `.env.local` 或任何 credential
- `node_modules/`、`dist/`
- `History/` 內的版本 ZIP
- `.deck-build/`、簡報 inspection 產物與 Office lock files
- 本機 gift vault、下載的 GLB、HAR 與臨時 build copy
- 示範影片、簡報轉圖與 `marketing/` binary；若團隊需要共同管理，請先設定 Git LFS，再明確調整 `.gitignore`

## 協作注意事項

- 主要遊戲程式目前集中在大型的 `src/alchemy-sandbox-fragment.html`。多人同時修改此檔很容易 conflict；開始前先分配區段，PR 儘量小。
- `ViverseAuthService` 與 `ViverseGardenStorage` 的變更會直接影響登入、帳號隔離與 Cloud Save，必須做雙帳號回歸。
- `FlowerModelViewer` 的匯出模式分成 direct-compatible 與 cloud-compressed；調整其中一條時不可假設另一條行為相同。
- `public/assets/` 是正式模型來源。不要用忽略所有 `*.glb` 的規則，否則部署會缺模型。
- Google Cloud Gift API 與 VIVERSE Cloud Save 是兩套不同服務：前者保存可由密語取得的禮物檔案，後者保存每個帳號自己的花園與珍藏清單。
