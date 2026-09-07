# 本機訪客模式（Local Guest Mode）

開發模式限定的登入捷徑，讓沒有 VIVERSE 帳號、或不想每次都走 SSO 的本機測試可以直接進入花園。

## 啟用方式

兩種擇一：

1. 在網址加上 `?guest=1`

   ```
   http://localhost:5173/?guest=1
   ```

2. 在 `.env.local` 設定環境變數，之後直接開 `http://localhost:5173/` 即可

   ```
   VITE_LOCAL_GUEST=true
   ```

啟用後不會出現登入視窗，右上角帳號會顯示 **Local Guest**，主控台會印出
`[NurtureGarden] Local guest mode active; progress is stored in this browser only.`

## 生效範圍

- 只在 `npm run dev`（`import.meta.env.DEV`）下有效。
- `npm run build` 產出的正式版完全不會啟用，即使網址帶 `?guest=1` 或環境變數設為 `true`。
- 實作位置：[src/app/AlchemySandboxApp.ts](../src/app/AlchemySandboxApp.ts) 的 `localGuestEnabled()` 與 `viverseAccount` 介面；遊戲片段本身沒有任何訪客分支，看到的仍是一般帳號流程。

## 資料存放

| 項目 | 訪客模式 | 正式帳號 |
| --- | --- | --- |
| 藴育收藏、花園快照、隱藏版紀錄 | 瀏覽器 `localStorage`，key 為 `nurture-garden:local-guest-save:v1` | VIVERSE Cloud Save |
| 帳號 ID | `peggy`（沿用 `ViverseAuthService` 的 demo guest） | VIVERSE account ID |
| 跨裝置同步 | 無 | 有 |

「立即同步」按鈕在訪客模式會直接回報成功，因為存檔就在本機。

### 重設訪客進度

在瀏覽器主控台執行：

```js
localStorage.removeItem('nurture-garden:local-guest-save:v1'); location.reload();
```

或在帳號視窗使用「清除所有花園歷史」。

## 限制

- 送禮、收禮需要 Gift API；本機 Vite 內建的 `/api/gifts` middleware 可以用，但跨裝置收禮仍需部署的服務。
- 訪客存檔不會遷移到 VIVERSE 帳號。切回正式登入時，請把 `?guest=1` 拿掉並將 `VITE_LOCAL_GUEST` 清空或設為 `false`。
- 訪客模式下 `VIVERSE 頭像` 為空白預設樣式。

## 用訪客模式測試綻放動畫

小雛菊與玻璃玫瑰藴育出來時會播放一次 `bloom` 動畫，並在 3D 物件下方出現「↻ 重播綻放」按鈕。

1. 以訪客模式進入花園，跳過或完成教學。
2. **小雛菊**：灑下「種子」與「水」，等待 6 小時遊戲時間（1× 約 45 秒，可拉高時間流動加速）。花色隨機四選一，**暖黃色的小雛菊**才有動畫，其餘三色為靜態模型。
3. **玻璃玫瑰**：先取得任一花朵與發光寶石（礦石＋火），再讓「花朵＋發光寶石」相遇，等待 9 小時遊戲時間。
4. 結果彈窗會播放綻放，按「↻ 重播綻放」可重看。採收後建立花藝作品，放進盆裡的這兩種花也會綻放一次。

模型與工具：`public/assets/flowers/yellow_jasmine_flower_bloom.glb`、`public/assets/collectibles/glass_rose_bloom.glb`，由 [tools/rigging](../tools/rigging/README.md) 產生。
