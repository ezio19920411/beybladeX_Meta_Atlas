# BEYBLADE X 搶購雷達（MVP v0.2）

手機優先的靜態網站原型，整合誠品線上與 Funbox 門市資訊。Funbox 主資料已由使用者提供的全台門市名單匯入，預設顯示台中市，並保留其他縣市選擇。

## v0.2 更新

- 匯入 **68 家 Funbox 門市、15 個縣市**。
- 每家門市包含使用者提供的 Facebook 粉專網址、LINE 官方帳號 ID。
- 由 LINE ID 建立加好友連結，門市卡片增加 Facebook 粉專入口。
- 地區選單支援全台名單，預設仍為台中市（11 家）。
- 保留舊資料可確認的台中門市地址與電話；其他店點未提供的地址不自行猜測。
- 所有 Facebook／LINE 網址均標示尚未逐一人工測試；縣市歸屬是依店名／商場位置推定。
- 更新頁面快取版本與文件。

## 已完成功能

- 手機版首頁、總覽、Funbox 門市、誠品商品、資料管理。
- 縣市／門市／商品關鍵字篩選，URL 可分享篩選狀態。
- 逐項處理活動：開啟官方活動頁後返回，仍由使用者確認是否完成。
- 誠品商品清單與人工核對紀錄。
- JSON 匯出／匯入備份、PWA manifest 與 service worker。
- 門市資料：`data/stores.json`（網站載入）及 `data/stores.csv`（方便人工維護）。

## 尚未完成（不假裝具備）

- 尚未自動讀取 Funbox Facebook 貼文或各店 LINE 推播。
- 尚未自動檢查誠品商品庫存／價格。
- 尚未提供關閉頁面後的背景推播。
- 尚未逐一測試 68 個 Facebook 網址與 LINE 好友連結。
- 不會自動登入、按下抽選、下單、付款或繞過驗證／排隊。

## 本機預覽

Windows 可雙擊 `預覽網站.bat`（需安裝 Python），或執行：

```bash
python -m http.server 8000
```

再開啟 `http://localhost:8000`。不要直接雙擊 `index.html`，因為頁面使用 `fetch()` 載入 JSON。

## 部署到既有 GitHub Pages repository

建議放在 `radar/` 子資料夾，不要覆蓋原本圖鑑首頁：

1. 解壓縮 ZIP。
2. 將本專案全部內容（包含 `index.html`、`assets/`、`data/`、`manifest.webmanifest`、`service-worker.js`、`spec.md` 等）放進 repository 的 `radar/` 資料夾。
3. Commit 到 `main`。
4. 既有 Pages workflow 必須將 `radar/` 一併複製到 `_site/radar/`，例如 `cp -R radar _site/radar`。
5. Actions 成功後開啟 `https://你的帳號.github.io/你的repository/radar/`。

## 資料維護

- `data/regions.json`：全台縣市選項，預設 `TW-TXG` 台中市。
- `data/stores.json`：網站實際載入的門市資料。
- `data/stores.csv`：同一份門市資料的試算表格式。
- `data/source-metadata.json`：資料來源、版本及驗證注意事項。
- `data/products.json`：誠品追蹤商品。
- `data/draw-events.json`：初始抽選／販售活動，目前為空陣列，避免將未核實活動誤標為開放。

更新門市資料時，請同步維護 `stores.json`；CSV 供人工閱讀、核對與編輯參考。之後可再做成由 Google Sheet 匯出 CSV 自動轉成 JSON 的同步流程。

## 注意

本專案不是 Funbox、誠品或 Takara Tomy 官方服務。門市社群連結由使用者提供，尚未逐一驗證；販售及抽選方式以各店最新公告為準。網站不要求也不保存誠品／LINE 密碼、登入 Cookie 或驗證碼。
