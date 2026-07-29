# LightForm Studio 攝影棚預約系統 — 專案技術文件

> 最後更新：2026-07-29
> 正式站：https://lightformstudio.com.tw
> 版本控管：GitHub `lightform101/studio-booking`（分支 `main`）
> 部署平台：Zeabur（連 GitHub 自動部署）

---

## 1. 技術棧

### 後端
| 類別 | 技術 |
|------|------|
| 語言 / 執行環境 | Node.js（JavaScript） |
| Web 框架 | Express.js 4 |
| 資料庫 | MySQL 8（透過 `mysql2` 連線池） |
| 認證 | JSON Web Token（`jsonwebtoken`）+ `bcryptjs` 密碼雜湊 |
| 排程 | `node-cron`（定時任務） |
| 檔案上傳 | `multer`（場地照片、輪播圖、活動附圖） |
| 影像處理 | `sharp` |
| Email | `nodemailer`（SMTP，設定存於 DB） |
| 安全 | `helmet`、`express-rate-limit`、`express-validator`、`cors` |
| 時間處理 | `dayjs` |

### 前端
- 純 **HTML + CSS + 原生 JavaScript**（無框架），直接由 Express 靜態託管
- 前台設計風格：日系清新（抹茶綠 + Zen Kaku Gothic New 字體）
- 響應式（RWD），支援手機／平板

### 第三方整合
| 服務 | 用途 | 對應檔案 |
|------|------|----------|
| 藍新金流 NewebPay | 線上金流（目前主要採 ATM 轉帳） | `services/newebpayService.js` |
| LINE Pay | 行動支付 | `services/linepayService.js` |
| 光貿 Amego | 電子發票開立 | `services/invoiceService.js` |
| TTLock | 門禁臨時密碼 | `services/ttlockService.js` |
| Google Calendar | 已確認預約同步行事曆 | `services/googleCalendarService.js` |
| LINE Messaging API | 管理員即時通知 | `services/lineService.js` |
| 三竹簡訊 Mitake | 簡訊通知（可選） | `services/smsService.js` |

---

## 2. 專案資料夾結構

```
0330預約系統/
├── index.html              前台首頁（場地介紹、輪播、活動專區、FAQ 分頁）
├── booking.html            預約流程頁（多步驟：類型→場地→時間→資料→付款）
├── confirmation.html       預約完成頁（QR Code 入場碼）
├── gallery.html            場地相簿頁
├── admin-login.html        後台登入
├── admin.html              後台管理主控台（單頁式，含所有管理頁）
├── tenant-editor.html      （開發中）多租戶網站編輯器
├── logo.png
├── Dockerfile              Zeabur 部署用
│
├── mockups/                本機預覽用檔案（不部署）
│
└── backend/
    ├── server.js           進入點：中介層、路由掛載、啟動時自動 migration、排程啟動
    ├── package.json
    ├── .env                環境變數（金鑰、DB、SMTP…；不進版控）
    │
    ├── config/
    │   └── database.js      MySQL 連線池
    │
    ├── routes/             API 路由
    │   ├── studios.js          公開：場地列表
    │   ├── availability.js     公開：查詢某場地某日可用時段
    │   ├── bookings.js         公開：建立/查詢/取消預約（含速率限制）
    │   ├── payment.js          金流回調（藍新 / LINE Pay）
    │   ├── promotions.js       公開：優惠方案 / 優惠碼驗證
    │   ├── carousel.js         公開：首頁輪播
    │   ├── events.js           公開：活動專區
    │   ├── appearance.js       公開：外觀設定 + 圖片上傳
    │   ├── line.js             LINE webhook（記錄加好友者的 userId）
    │   ├── site.js             （開發中）多租戶前台渲染
    │   └── admin/             後台 API（皆需 JWT）
    │       ├── auth.js            登入、我的資料、改密碼
    │       ├── bookings.js        預約 CRUD、開發票、發進門密碼、取消
    │       ├── studios.js         場地設定（含 TTLock Lock ID）
    │       ├── studio_images.js   場地照片管理
    │       ├── revenue.js         收入報表 / 使用率
    │       ├── settings.js        系統設定、SMTP/發票/TTLock 診斷、Migration
    │       ├── promotions.js      優惠方案管理
    │       ├── carousel.js        首頁輪播管理
    │       ├── events.js          活動專區管理
    │       ├── line.js            LINE 通知對象管理、測試推播
    │       ├── tenants.js / themes.js / orders.js  （開發中）多租戶平台
    │
    ├── models/            資料存取層
    │   ├── BookingModel.js     預約（含 SELECT FOR UPDATE 防並發）
    │   ├── StudioModel.js      場地
    │   └── （開發中）TenantModel / ThemeModel / SubscriptionModel …
    │
    ├── services/          業務邏輯與第三方整合（見上方「第三方整合」表）
    │   ├── bookingValidation.js  時段合法性（營業時間、封鎖、min/max 時數）
    │   ├── notifyService.js      通知調度（Email / SMS）
    │   ├── schedulerService.js   排程：取消逾時、24h 提醒、自動開票、標記完成
    │   └── …
    │
    ├── middleware/        auth（JWT）、requireSuperAdmin、auditLog、validation
    ├── migrations/        資料庫版本（001 ~ 030，啟動時自動執行，跳過 seed）
    ├── templates/emails/  Email HTML 模板（確認、付款、進門密碼、提醒、發票…）
    ├── themes/            （開發中）多租戶佈景：portfolio-dark / mag / min
    └── uploads/           使用者上傳檔（場地照、輪播、活動附圖）
```

---

## 3. 功能狀態

### ✅ 已完成（正式營運中）

**預約核心**
- 多步驟線上預約：拍攝類型 → 選場地 → 選日期時段 → 填資料 → 付款
- **防重複預約**：DB 交易 + `SELECT ... FOR UPDATE` 悲觀鎖，杜絕同時段被搶
- 時段合法性驗證：營業時間、封鎖日期、最少/最多時數、需提前 24 小時
- 付款鎖定：預約後 48 小時內需完成付款，逾時自動取消並釋出時段
- 客戶自助查詢／取消預約（以電話末 4 碼驗證）

**通知與整合**
- Email 通知：預約確認、待付款（含 ATM 帳號）、進門密碼、拍攝前一天提醒、取消、發票
- **TTLock 門禁**：已確認預約自動產生限時進門密碼並寄給客戶（4F、5F）
- **電子發票**：光貿 Amego 自動開立；品名「場地租借費」；支援個人載具/公司統編/捐贈；**後台可自填發票資訊補開**
- **Google Calendar**：已確認預約自動同步（前台付款、後台新增、後台編輯確認皆會同步）
- **LINE 通知（管理員）**：新預約 / 客戶付款完成即時推播給老闆

**後台管理**
- 儀表板、預約管理、排程日曆、收入報表
- 場地設定、場地照片、優惠方案、首頁輪播、活動專區
- LINE 通知設定、通知設定、發票設定、系統設定、外觀設定、頁面內容、帳號管理
- 操作稽核紀錄（audit log）

**前台網站**
- 日系清新改版、首頁輪播（後台可管理）、活動專區（課程/特惠/講座，含附圖與影片外連）
- 常見問題/優惠/立即預約三按鈕分頁、手機版優化

### 🚧 開發中 / 規劃中
- **多租戶 SaaS 平台**：租戶（tenants）、佈景主題（themes）、平台訂單/訂閱、租戶內容編輯器、AI 任務（migrations 024–030、`site.js`、`tenant-editor.html`、`provisionService.js`）
- **客戶端 LINE 通知（3b）**：客戶用 LINE 登入綁定後，確認信/進門密碼/提醒改走 LINE
- **連線速度優化**：以 UptimeRobot 定時 ping 避免容器冷啟動

---

## 4. 主要資料流程

### A. 客戶預約流程（前台）
```
1. 客戶進 booking.html
2. 前端呼叫 GET /api/studios            → 取得場地清單
3. 選日期後 GET /api/availability        → 回傳該場地該日「可用時段」與「已佔時段」
   （後端以整點掃描營業時間，扣掉已預約與封鎖時段）
4. 客戶選時段、填資料 → POST /api/bookings
   後端在「交易 + FOR UPDATE」中再次檢查衝突，通過才寫入 bookings（狀態 pending_payment）
   訂單編號格式：SS-YYYYMMDD-NNNNN
5. 回傳 ATM 付款資訊（48 小時內付款）
6. 付款完成（金流回調 /api/payment/...）→ 狀態轉 confirmed，並觸發：
   ├─ 建立 TTLock 進門密碼 + 寄密碼信
   ├─ 同步 Google Calendar
   ├─ 寄預約確認信
   └─ LINE 推播通知管理員
7. 拍攝前一天 09:00 → 排程自動寄「場地提醒信」（含進門密碼、地址）
8. 拍攝結束後 → 排程自動開立電子發票並寄出
```

### B. 資料存放位置
- **所有預約、場地、優惠、活動、輪播、發票、通知紀錄、稽核** → MySQL 資料庫（Zeabur 託管）
- **上傳圖片檔** → 伺服器 `backend/uploads/`（Zeabur volume）
- **系統設定/金鑰（SMTP、LINE、ATM 帳號、外觀…）** → DB `settings` 表（key-value）
- **敏感金鑰（DB 密碼、JWT、金流、發票 APP_KEY…）** → 環境變數（Zeabur 設定）

### C. 時段資料模型（重點）
- `bookings.status`：`pending_payment` → `confirmed` → `completed`／`cancelled`
- 衝突判斷以「同 `studio_id` + 同 `booking_date` + 時間區間重疊」為準
  → 平面/動態同棚共用同一 `studio_id`，故不會平面訂了動態還能訂
  → 4F 與 5F 為不同 `studio_id`，互相獨立

### D. 排程任務（`schedulerService.js`）
| 時間 | 任務 |
|------|------|
| 每 5 分鐘 | 取消逾時未付款預約、清除其行事曆事件 |
| 每天 09:00 | 寄拍攝前一天提醒信 |
| 每天 00:30 | 標記昨日預約為已完成 |
| 每小時 | 催繳即將到期的待付款訂單 |
| 每小時 10 分 | 自動開立已結束預約的電子發票 |

---

## 5. 重要注意事項

- **伺服器時區為 UTC**：涉及台灣時間的計算（如 TTLock 進門時段）一律以固定 `+08:00` 解析，避免 8 小時偏移。
- **啟動自動 migration**：`server.js` 啟動時自動執行 `migrations/` 內所有 `.sql`（**跳過 seed 檔**，避免還原已刪除/修改的資料）。
- **TTLock 無網關**：門鎖採離線演算法密碼，可建立但無法遠端刪除；同一時段重建會回 -1026，系統會自動延長時段重試。
- **本機預覽**：`mockups/` 內為離線預覽檔（以假資料模擬 API），不會部署、不影響正式站。
