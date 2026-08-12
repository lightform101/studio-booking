# CLAUDE.md — LightForm Studio 攝影棚預約系統

> 給 Claude Code 的專案指引。最後更新：2026-08-12

**專案路徑**：`/Users/ken710807/Desktop/網站製作/0330預約系統`
（⚠️ 曾從 `~/Desktop/0330預約系統` 搬遷至此，舊路徑已無內容）

**正式站**：https://lightformstudio.com.tw
**版控**：GitHub `lightform101/studio-booking`（分支 `main`）
**部署**：Zeabur — **push 到 main 即自動部署**

---

## 1. 技術棧

| 層 | 技術 |
|---|---|
| 執行環境 | Node.js ≥18（Docker: `node:18-alpine`） |
| 後端框架 | Express 4 |
| 資料庫 | MySQL 8（`mysql2` 連線池） |
| 認證 | JWT（`jsonwebtoken`）+ `bcryptjs` |
| 排程 | `node-cron` |
| 上傳/影像 | `multer`、`sharp` |
| Email | `nodemailer`（SMTP 設定存 DB `settings` 表） |
| 安全 | `helmet`、`express-rate-limit`、`express-validator`、`cors` |
| 時間 | `dayjs` |
| 前端 | **純 HTML + CSS + 原生 JS，無框架**，由 Express 靜態託管 |

**前台設計風格**：日系清新 —— 抹茶綠（`--sage:#8a9a7b` / `--sage-d:#6f8060`）、霧白底（`#f7f7f4`）、標題字 `Zen Kaku Gothic New`、內文 `Noto Sans TC`。新頁面請沿用這組 CSS 變數。

### 第三方整合
| 服務 | 用途 | 檔案 |
|---|---|---|
| 藍新 NewebPay | 金流（目前實際主用 ATM 轉帳） | `services/newebpayService.js` |
| LINE Pay | 行動支付 | `services/linepayService.js` |
| 光貿 Amego | 電子發票 | `services/invoiceService.js` |
| TTLock | 門禁臨時密碼 | `services/ttlockService.js` |
| Google Calendar | 已確認預約同步 | `services/googleCalendarService.js` |
| LINE Messaging API | 管理員即時通知 | `services/lineService.js` |
| 三竹簡訊 | SMS（可選） | `services/smsService.js` |

---

## 2. 目錄結構

```
0330預約系統/
├── index.html            前台首頁（場地、輪播、活動、FAQ 分頁）
├── booking.html          預約流程（類型→場地→時間→資料→付款）
├── confirmation.html     預約完成（QR Code）
├── gallery.html          場地相簿
├── services.html         攝影服務（5 子分頁）★新
├── shop.html             選物商店（2 子分頁）★新
├── admin-login.html      後台登入
├── admin.html            後台主控台（單頁式，5000+ 行，所有管理頁在此）
├── tenant-editor.html    多租戶編輯器（開發中，未進版控）
├── Dockerfile
├── SYSTEM-SPEC.md        2026-03 舊版規格（僅供參考）
├── project-overview.md   專案總覽（對外說明用）
├── mockups/              本機預覽檔（不部署、不進版控）
│
└── backend/
    ├── server.js         進入點：中介層、路由掛載、啟動時自動 migration、排程
    ├── config/database.js
    ├── routes/           公開 API
    │   studios · availability · bookings · payment · appearance
    │   promotions · carousel · events · line(webhook) · services · shop
    │   site.js（多租戶，開發中）
    ├── routes/admin/     後台 API（皆需 JWT）
    │   auth · bookings · studios · studio_images · revenue · settings
    │   promotions · carousel · events · line · services · shop
    │   tenants / themes / orders（開發中）
    ├── models/           BookingModel · StudioModel（+多租戶 models 開發中）
    ├── services/         見上方第三方整合表 + bookingValidation / notifyService / schedulerService
    ├── middleware/       auth · requireSuperAdmin · auditLog · validation
    │                     resolveTenant / renderTenantSite（開發中）
    ├── migrations/       001–032（啟動時自動執行）
    ├── templates/emails/ 6 個 HTML 信件模板
    ├── themes/           多租戶佈景（開發中）
    └── uploads/          上傳檔（studios / appearance / carousel / events）
```

---

## 3. 資料庫 Schema

| 資料表 | 用途 | 來源 |
|---|---|---|
| `admins` | 管理員（role、token_version） | 001, 011 |
| `studios` | 場地（+ `ttlock_lock_id`、`photo_rate`/`video_rate`、`panorama_url`） | 001, 005, 007, 031 |
| `studio_features` | 場地設備標籤 | 001 |
| `studio_images` | 場地照片 | 003 |
| `business_hours` | 營業時間（weekday，studio_id 可 NULL＝全場地） | 001 |
| `blocked_dates` | 封鎖日期/時段 | 001 |
| **`bookings`** | **核心預約表**（見下） | 001, 010, 012, 014 |
| `notifications` | 通知寄送紀錄（防重複） | 001 |
| `settings` | key-value 系統設定（SMTP、LINE、ATM、外觀、開關…） | 001, 004 |
| `promotions` | 優惠方案 | 006, 015–020 |
| `admin_audit_logs` | 後台操作稽核 | 013 |
| `carousel_slides` | 首頁輪播 | 021 |
| `events` | 活動專區（含 gallery JSON、video_url 外連） | 022 |
| `line_contacts` | LINE 通知對象（webhook 記錄 userId） | 023 |
| `photo_services` | 攝影服務（category: portrait/product/ecommerce/event） | 032 |
| `photographers` | 合作攝影師（外連作品集） | 032 |
| `shop_items` | 商品（category: furniture/goods；status: available/reserved/sold） | 032 |

**`bookings` 關鍵欄位**
`booking_no`(SS-YYYYMMDD-NNNNN) · `studio_id` · `booking_date` · `start_time`/`end_time` · `duration_hours` · `status`(pending_payment→confirmed→completed/cancelled) · `payment_expire` · `total_amount`/`discount_amount`/`promo_id` · 發票欄位(`need_invoice`/`invoice_type`/`invoice_no`/`invoice_status`…) · TTLock(`ttlock_passcode`/`ttlock_passcode_id`) · `google_event_id`

---

## 4. 核心功能模組

### 預約核心
- **防重複預約**：`BookingModel.createWithLock()` 用 **transaction + `SELECT ... FOR UPDATE`** 悲觀鎖，同場地同日鎖定後再判斷時段重疊。
- **時段驗證**：`services/bookingValidation.js` — 營業時間、封鎖日期、min/max_hours。
- **提前預約限制**：`middleware/validation.js`，預設需提前 24 小時（`MIN_ADVANCE_HOURS`）。
- **付款鎖定**：`settings.booking_lock_minutes`（目前 2880 = 48 小時），逾時排程自動取消。
- 同棚的平面/動態共用同一 `studio_id` → 天然互斥；4F 與 5F 是不同 `studio_id` → 互相獨立。

### 排程（`services/schedulerService.js`）
| Cron | 工作 |
|---|---|
| `*/5 * * * *` | 取消逾時未付款、刪對應行事曆事件 |
| `0 9 * * *` | 寄「拍攝前一天提醒信」（含進門密碼＋地址） |
| `30 0 * * *` | 標記昨日預約為 completed |
| `0 * * * *` | 催繳即將到期的待付款 |
| `10 * * * *` | 自動開立已結束預約的電子發票 |

### 通知
`notifyService.send(event, booking)` 統一調度 Email/SMS，事件：`booking_confirmed`、`payment_pending`、`reminder_24h`、`booking_cancelled`、`invoice_issued`。
LINE 推播另走 `lineService.pushToOwners()`（只通知管理員，客戶端 LINE 尚未做）。

### 後台（admin.html 單頁）
儀表板／預約管理／排程日曆／收入報表／場地設定／場地照片／優惠方案／首頁輪播／活動專區／**攝影服務**／**選物商店**／LINE 通知／通知設定／發票設定／系統設定（外觀・頁面內容・帳號管理）

---

## 5. 開發與部署慣例（重要）

### 部署流程
```bash
# 專案根目錄
git add <明確列出檔案>        # ⚠️ 不要用 git add -A
git commit -m "..."
git push origin main          # → Zeabur 自動部署（約 1–3 分鐘）
```
驗證：`curl -s -o /dev/null -w "%{http_code}" https://lightformstudio.com.tw/api/health`
部署中會短暫 404/502，屬正常。

### ⚠️ 最重要的一條：小心 commit `backend/server.js`
`server.js` 內含**尚未進版控的多租戶 WIP** 的 require。曾因 commit 它而讓正式站掛掉（`Cannot find module './routes/admin/tenants'`）。
現已用 `optionalRequire()` 包住那 5 個模組（缺檔會警告並略過），但：
- commit `server.js` 前，先確認**沒有新增未進版控的 require**
- 推送前建議跑「模擬部署環境」實測：
```bash
git worktree add -f /tmp/dc HEAD
ln -s "$PWD/backend/node_modules" /tmp/dc/backend/node_modules
JWT_SECRET=t node -e "process.chdir('/private/tmp/dc/backend');require('/private/tmp/dc/backend/server.js')"
git worktree remove /tmp/dc --force
```

### Migration
- **啟動時自動執行** `migrations/` 內所有 `.sql`（`server.js` 的 `runMigrationsOnStart`）
- **會跳過檔名含 `seed` 的檔案**——避免把已刪除/修改的資料（例如刪掉的場地）還原
- 可忽略錯誤：`ER_DUP_FIELDNAME`、`ER_TABLE_EXISTS_ERROR`、`ER_DUP_ENTRY`
- `ALTER TABLE ... AFTER 某欄` 若該欄尚不存在會失敗 → 拆成後續 migration（見 015 vs 018 的教訓）

### 時區（踩過的坑）
伺服器跑 **UTC**。凡涉及「台灣牆上時間」的換算，**一律用固定 `+08:00` 解析**，不可依賴伺服器本地時區：
```js
new Date(`${dateStr}T${hhmm}:00+08:00`).getTime()
```
顯示則用 `Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',...})`。

### 新增系統設定 key
必須同時加到兩份白名單，否則讀不到或寫不進：
- 前台可讀：`routes/appearance.js` → `PUBLIC_KEYS`
- 後台可寫：`routes/admin/settings.js` → `ALLOWED_SETTING_KEYS`

### 嵌入第三方 iframe
`server.js` 的 helmet CSP 有 **`frameSrc` 白名單**（YouTube／Vimeo／Kuula／720雲／Matterport／Google）。
使用新服務要先把網域加進去，否則瀏覽器會直接擋掉（曾因缺 `frame-src` 導致活動影片無法播放）。

### 圖片策略
- **上傳到伺服器**：場地照片、首頁輪播、活動主圖與附圖（`multer` → `backend/uploads/`）
- **一律外連網址**：攝影服務作品圖、商品圖、攝影師頭像（不佔硬碟，後台貼網址，一行一個）
- 活動附圖限制每張 ≤1MB；輪播與場地圖採**延遲載入**（只先載第一張）

### 本機預覽慣例
新功能先做 `mockups/*-preview.html`（注入假資料 mock `window.fetch`）給使用者確認，**確認後才部署**。`mockups/` 不進版控。

---

## 6. 已知問題與待辦

### 🔴 已知問題
| 問題 | 說明 | 狀態 |
|---|---|---|
| **冷啟動延遲** | Zeabur 容器閒置後休眠，第一位訪客要等 2–4 秒 | 未解。建議用 UptimeRobot 每 5 分鐘 ping `/api/health` 保溫（使用者尚未設定） |
| **TTLock 無網關** | 無法遠端刪除密碼（errcode -2012）；`-1026`（同時段重建）已用「自動延長 1 小時重試」規避 | 需加購 TTLock Gateway 才能根治 |
| **TTLock 只能整點** | 官方限制：密碼有效時間分秒必須為 0。實際結果是**客戶可提前 1 小時進入**（無法做到「提前 10 分鐘」） | 已與使用者確認維持現狀 |
| **提醒信文案不精確** | `reminder-24h` 寫「前後 15 分鐘」，實際是整點對齊後的前後約 1 小時 | 未修，使用者尚未回覆 |
| **首頁輪播圖過大** | 使用者上傳過 1.8MB 圖檔，影響首屏 | 未確認是否已處理 |

### 🚧 開發中（未進版控、未部署）
**多租戶 SaaS 平台（Phase 0）** — 以下檔案存在於本機但**不在 git**：
```
migrations/024–030（tenants, themes, tenant_content, tenant_modules,
                    orders_subscriptions, ai_jobs, seed_themes）
models/  TenantModel, ThemeModel, TenantContentModel,
         PlatformOrderModel, SubscriptionModel
routes/  site.js, admin/tenants.js, admin/themes.js, admin/orders.js
middleware/ resolveTenant.js, renderTenantSite.js
services/   provisionService.js, themeRenderer.js
themes/     portfolio-dark / portfolio-mag / portfolio-min
tenant-editor.html
```
`provisionService.js:48` 有 TODO：開通信模板尚未撰寫。
👉 **要部署這組功能時，必須把上述檔案一起進版控**，否則 `optionalRequire` 會全部略過。

### ⬜ 待辦
- [ ] **UptimeRobot 保溫**（解冷啟動）
- [ ] **客戶端 LINE 通知（階段 3b）**：客戶用 LINE 登入綁定後，確認信／進門密碼／提醒改走 LINE
- [ ] **攝影服務／選物商店開放**：目前 `nav_services_enabled`、`nav_shop_enabled` 皆未設定＝**前台灰階不開放**；使用者填完內容後在後台一鍵開放（可用 `?preview=1` 先預覽）
- [ ] Tuya 智慧插座整合（預約結束 30 分鐘自動關燈／冷氣）— 使用者已註冊 Tuya 開發者平台，卡在資料中心綁定（台灣帳號→ Singapore Data Center）
- [ ] 頁腳「隱私權政策／退款政策／服務條款」仍是空連結 `#`

---

## 7. 常用指令

```bash
# 語法檢查（後端）
node --check backend/server.js

# 檢查前端內嵌 JS 語法
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const s=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n;\n');new Function(s);console.log('OK')"

# 確認沒有「已追蹤檔案 require 未追蹤模組」（部署前必跑）
git ls-files backend --others --exclude-standard   # 看哪些後端檔案未進版控

# 線上健康檢查
curl -s https://lightformstudio.com.tw/api/health
```

## 8. 溝通慣例
- 使用者以**繁體中文**溝通，回覆請用繁體中文。
- 新功能習慣：**先做本機預覽 → 使用者確認 → 才部署**。使用者若說「先不要推上網」，就只在本機驗證。
- 使用者無法看到終端機輸出，重要結果要在回覆中說明。
- 涉及後台操作的步驟，請寫清楚「在哪個選單、點哪個按鈕」。
