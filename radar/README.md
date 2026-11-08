# BEYBLADE X 搶購雷達 v0.4.1

此資料夾是 GitHub Pages 的 `/radar/` 網站。

- `index.html`：主頁面（手機優先、簡化操作）
- `assets/`：CSS、JavaScript、圖示
- `data/stores.json`：合併後門市清單（Google Sheet 主資料＋補充資料）
- `data/stores-supplemental.json`：UXUX11 公開 LINE 名錄的額外據點
- `data/regions.json`：目前載入的縣市選項
- `data/products.json`：誠品追蹤商品
- `data/draw-events.json`：已核實活動資料（目前為空，不放過期活動）
- `data/draw-sources.json`：UXUX11 與 BeyBuilder 外部來源及快照資訊
- `scripts/sync_funbox_stores.py`：Google Sheets CSV 匯入程式；會保留並合併補充門市
- `source-research.md`：第三方資料來源研究、能證實與不能證實的部分
- `manifest.webmanifest`、`service-worker.js`：PWA 支援

## 資料合併規則

Google Sheet 的 68 筆門市資料是主要來源；UXUX11 名錄新增 10 個據點作補充（其中台東家樂福與台東秀泰共用 LINE ID）。BeyBuilder 僅作抽選商品／門市歷史目錄探索來源，不把舊活動當成目前有效抽選。

自動同步設定請看專案根目錄 `GOOGLE_SHEETS_AUTO_SYNC_SETUP.md`。目前自動同步只更新門市資料，尚未自動擷取第三方網站的活動內容或誠品即時庫存。
