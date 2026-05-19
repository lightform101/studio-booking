# Studio Space 場地預約系統 — 完整技術規格文件

> 版本：v1.0 · 日期：2026-03-30
> 系統名稱：Studio Space 攝影棚預約系統
> 場地數量：2 間（Studio A / Studio B）

---

## 一、系統架構總覽

```
┌──────────────────────────────────────────────────────┐
│                     前台（Frontend）                   │
│  index.html · booking.html · confirmation.html        │
└─────────────────────┬────────────────────────────────┘
                      │ REST API / HTTPS
┌─────────────────────▼────────────────────────────────┐
│                後端 API Server（Node.js）              │
│  Express.js · 路由模組 · 業務邏輯 · 排程任務           │
└──┬──────────┬──────────┬──────────┬──────────────────┘
   │          │          │          │
   ▼          ▼          ▼          ▼
MySQL      藍新金流    電子發票    Email/SMS
資料庫     NewebPay    ECPay       通知服務
           +LINE Pay   Invoice
```

---

## 二、技術棧

| 層次         | 技術選擇             | 說明                        |
|------------|------------------|-----------------------------|
| 前端         | HTML5 + CSS3 + Vanilla JS | 純靜態，可部署至任何主機    |
| 後端         | Node.js 20+ + Express.js  | RESTful API                 |
| 資料庫       | MySQL 8.0                 | 主要資料儲存                |
| 快取         | Redis（可選）             | Session、預約鎖定           |
| 金流         | 藍新金流 NewebPay + LINE Pay | 台灣本地金流              |
| 電子發票     | 綠界 ECPay 電子發票        | 可換為 ezPay                |
| Email        | Nodemailer + SMTP         | 自動通知                    |
| 簡訊         | 每日簡訊 mitake API        | SMS 通知                    |
| 部署         | Ubuntu VPS / Docker        | Nginx 反向代理              |
| SSL          | Let's Encrypt              | 免費憑證                    |

---

## 三、資料庫設計（MySQL）

### 3.1 場地資料表 `studios`

```sql
CREATE TABLE studios (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  name         VARCHAR(100) NOT NULL,        -- 攝影棚甲
  name_en      VARCHAR(100),                 -- Studio A
  description  TEXT,
  hourly_rate  DECIMAL(10,2) NOT NULL,       -- 800.00
  min_hours    INT DEFAULT 2,
  max_hours    INT DEFAULT 8,
  capacity     INT DEFAULT 15,
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   DATETIME DEFAULT NOW(),
  updated_at   DATETIME DEFAULT NOW() ON UPDATE NOW()
);
```

### 3.2 場地設備資料表 `studio_features`

```sql
CREATE TABLE studio_features (
  id         INT PRIMARY KEY AUTO_INCREMENT,
  studio_id  INT REFERENCES studios(id),
  feature    VARCHAR(100) NOT NULL           -- 化妝間、更衣室 etc.
);
```

### 3.3 預約資料表 `bookings`

```sql
CREATE TABLE bookings (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  booking_no      VARCHAR(20) UNIQUE NOT NULL,     -- SS-2026033001
  studio_id       INT REFERENCES studios(id),
  contact_name    VARCHAR(100) NOT NULL,
  contact_phone   VARCHAR(20) NOT NULL,
  contact_email   VARCHAR(200) NOT NULL,
  purpose         VARCHAR(100),                    -- 商業攝影
  note            TEXT,
  booking_date    DATE NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  duration_hours  DECIMAL(4,1) NOT NULL,
  unit_price      DECIMAL(10,2) NOT NULL,
  total_amount    DECIMAL(10,2) NOT NULL,
  status          ENUM('pending_payment','confirmed','completed','cancelled')
                  DEFAULT 'pending_payment',
  payment_method  ENUM('credit','atm','cvs','linepay') NULL,
  payment_at      DATETIME NULL,
  payment_ref     VARCHAR(100) NULL,               -- 金流交易序號
  need_invoice    BOOLEAN DEFAULT FALSE,
  invoice_type    ENUM('personal','company','donate') NULL,
  invoice_carrier VARCHAR(50) NULL,               -- 手機條碼 /XXXXXXX
  invoice_tax_id  VARCHAR(8) NULL,                -- 統一編號
  invoice_company VARCHAR(200) NULL,
  invoice_donate  VARCHAR(10) NULL,               -- 捐贈碼
  invoice_no      VARCHAR(30) NULL,               -- 開立後的發票號碼
  invoice_at      DATETIME NULL,
  cancel_reason   TEXT NULL,
  cancel_at       DATETIME NULL,
  refund_amount   DECIMAL(10,2) NULL,
  refund_at       DATETIME NULL,
  created_at      DATETIME DEFAULT NOW(),
  updated_at      DATETIME DEFAULT NOW() ON UPDATE NOW()
);
```

### 3.4 封鎖日期資料表 `blocked_dates`

```sql
CREATE TABLE blocked_dates (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  studio_id   INT NULL REFERENCES studios(id),   -- NULL = 全部場地
  block_date  DATE NOT NULL,
  start_time  TIME NULL,                          -- NULL = 整天
  end_time    TIME NULL,
  reason      VARCHAR(200),
  created_at  DATETIME DEFAULT NOW()
);
```

### 3.5 通知記錄資料表 `notifications`

```sql
CREATE TABLE notifications (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  booking_id   INT REFERENCES bookings(id),
  type         ENUM('email','sms') NOT NULL,
  event        VARCHAR(50) NOT NULL,               -- booking_confirmed, reminder_24h etc.
  recipient    VARCHAR(200) NOT NULL,
  status       ENUM('sent','failed') DEFAULT 'sent',
  sent_at      DATETIME DEFAULT NOW(),
  error_msg    TEXT NULL
);
```

### 3.6 系統設定資料表 `settings`

```sql
CREATE TABLE settings (
  key_name    VARCHAR(100) PRIMARY KEY,
  key_value   TEXT,
  updated_at  DATETIME DEFAULT NOW() ON UPDATE NOW()
);
-- 範例資料
INSERT INTO settings VALUES
  ('site_name', 'Studio Space', NOW()),
  ('contact_email', 'contact@studiospace.tw', NOW()),
  ('newebpay_merchant_id', '', NOW()),
  ('newebpay_hash_key', '', NOW()),
  ('newebpay_hash_iv', '', NOW()),
  ('ecpay_merchant_id', '', NOW()),
  ('smtp_host', 'smtp.gmail.com', NOW()),
  ('sms_provider', 'mitake', NOW()),
  ('booking_lock_minutes', '120', NOW()),
  ('min_advance_hours', '24', NOW());
```

---

## 四、API 路由規格

### 4.1 前台 API（公開）

#### 取得場地列表
```
GET /api/studios
Response: [ { id, name, name_en, hourly_rate, min_hours, max_hours, capacity, features[] } ]
```

#### 查詢可用時段
```
GET /api/availability?studio_id=1&date=2026-04-05
Response: {
  date: "2026-04-05",
  studio_id: 1,
  available_slots: ["08:00","09:00","12:00","13:00",...],
  booked_slots: ["10:00","11:00"]
}
```

#### 建立預約（Step 1）
```
POST /api/bookings
Body: {
  studio_id, booking_date, start_time, duration_hours,
  contact_name, contact_phone, contact_email,
  purpose, note,
  need_invoice, invoice_type, invoice_carrier,
  invoice_tax_id, invoice_company, invoice_donate
}
Response: {
  booking_no, total_amount, expire_at,  // 付款期限
  payment_url  // 跳轉至金流頁面
}
```

#### 藍新金流 Notify（後端接收金流回調）
```
POST /api/payment/newebpay/notify
→ 驗證簽章 → 更新 booking.status = 'confirmed'
→ 觸發 Email + SMS 通知
→ 觸發電子發票開立（若需要）
```

#### LINE Pay 確認
```
GET /api/payment/linepay/confirm?transactionId=...&orderId=...
→ 呼叫 LINE Pay Confirm API → 更新訂單
```

#### 查詢訂單狀態
```
GET /api/bookings/:booking_no
Response: { booking_no, status, studio, date, time, amount, invoice_no }
```

#### 取消預約
```
DELETE /api/bookings/:booking_no
Body: { cancel_reason }
→ 計算退款金額（依退款政策）
→ 呼叫藍新退款 API
→ 發送取消通知
```

### 4.2 後台 API（需驗證）

```
GET    /api/admin/bookings             取得預約列表（含篩選）
GET    /api/admin/bookings/:id         取得預約詳情
PATCH  /api/admin/bookings/:id         更新預約（狀態/備注）
DELETE /api/admin/bookings/:id         取消預約
GET    /api/admin/revenue              收入報表
GET    /api/admin/dashboard            儀表板統計
POST   /api/admin/blocked-dates        新增封鎖日
DELETE /api/admin/blocked-dates/:id    刪除封鎖日
GET    /api/admin/settings             取得系統設定
PUT    /api/admin/settings             更新系統設定
POST   /api/admin/test-email           測試 Email
POST   /api/admin/test-sms             測試 SMS
POST   /api/admin/resend-notification  重新發送通知
POST   /api/admin/studios              新增場地
PUT    /api/admin/studios/:id          更新場地
```

---

## 五、金流整合說明

### 5.1 藍新金流 NewebPay

```
整合步驟：
1. 申請藍新商店帳號（https://www.newebpay.com）
2. 取得 MerchantID、HashKey、HashIV
3. 前端建立表單，後端 AES-256-CBC 加密 TradeInfo
4. POST 至 https://ccore.newebpay.com/MPG/mpg_gateway（測試）
              https://core.newebpay.com/MPG/mpg_gateway（正式）
5. 接收 ReturnURL（前端跳轉）與 NotifyURL（後端接收）

支援付款方式：
- CREDIT：信用卡（含分期）
- WEBATM：網路 ATM
- VACC：虛擬帳號（ATM 轉帳）
- CVS：超商代碼
- LINEPAY：LINE Pay（可選擇整合在藍新或獨立）

加密範例（Node.js）：
const crypto = require('crypto');
function encryptTradeInfo(data, hashKey, hashIV) {
  const cipher = crypto.createCipheriv('aes-256-cbc',
    hashKey, hashIV);
  return cipher.update(data, 'utf8', 'hex') + cipher.final('hex');
}
```

### 5.2 LINE Pay

```
整合步驟：
1. 申請 LINE Pay 商家帳號
2. 取得 Channel ID 與 Channel Secret Key
3. 呼叫 Request API 建立訂單
4. 跳轉至 LINE Pay 付款頁面
5. 使用者付款後跳轉至 ConfirmURL
6. 後端呼叫 Confirm API 確認付款

API Endpoint（Sandbox）：
POST https://sandbox-api-pay.line.me/v3/payments/request
POST https://sandbox-api-pay.line.me/v3/payments/{transactionId}/confirm

Request Headers：
X-LINE-ChannelId: {channelId}
X-LINE-Authorization-Nonce: {nonce}
X-LINE-Authorization: {HMAC-SHA256 簽章}
```

---

## 六、電子發票整合（綠界 ECPay）

```
整合流程：
1. 申請綠界電子發票服務（需電商憑證）
2. 取得 MerchantID、HashKey、HashIV
3. 付款完成後呼叫開立 API：
   POST https://einvoice.ecpay.com.tw/B2CInvoice/Issue

開立參數：
- MerchantID
- RelateNumber（對應訂單號）
- CarruerType（載具類型）：0=無、1=手機條碼、2=自然人憑證
- CarruerNum（載具號碼）
- TaxType：1=應稅
- SalesAmount（含稅總額）
- InvoiceItems[]

發票類型處理：
- 個人無載具 → 雲端發票（寄 Email）
- 手機條碼  → 存入手機條碼載具
- 統一編號  → 開立三聯式發票
- 捐贈碼   → 捐贈發票
```

---

## 七、通知服務

### 7.1 Email 通知（Nodemailer）

```javascript
// 通知事件與對應 Email 模板
const EMAIL_EVENTS = {
  'booking_confirmed': {
    subject: '【Studio Space】預約成功確認 - {booking_no}',
    template: 'booking-confirmed.html'
  },
  'payment_pending': {
    subject: '【Studio Space】請於 2 小時內完成付款 - {booking_no}',
    template: 'payment-pending.html'
  },
  'reminder_24h': {
    subject: '【Studio Space】明天的場地提醒 - {booking_no}',
    template: 'reminder-24h.html'
  },
  'booking_cancelled': {
    subject: '【Studio Space】預約取消確認 - {booking_no}',
    template: 'booking-cancelled.html'
  },
  'refund_processed': {
    subject: '【Studio Space】退款已處理 - {booking_no}',
    template: 'refund-processed.html'
  },
  'invoice_issued': {
    subject: '【Studio Space】您的電子發票 - {invoice_no}',
    template: 'invoice-issued.html'
  }
};
```

### 7.2 SMS 通知（每日簡訊 mitake）

```
API：https://sms.mitake.com.tw/b2c/mtk/SmSend
Method：POST
帳號 + 密碼 驗證

簡訊範本：
[Studio Space] 您的預約 {booking_no} 已確認！
日期：{date} {start_time}–{end_time}
場地：{studio_name}
如有問題請聯繫 02-XXXX-XXXX
```

### 7.3 排程任務（node-cron）

```javascript
// 每小時執行：催繳即將到期的待付款訂單
cron.schedule('0 * * * *', sendPaymentReminders);

// 每天 09:00 執行：發送 24 小時前提醒
cron.schedule('0 9 * * *', send24hReminders);

// 每 5 分鐘：取消超時未付款訂單
cron.schedule('*/5 * * * *', cancelExpiredBookings);

// 每天 00:00：將昨日已完成的預約標記為 completed
cron.schedule('0 0 * * *', markCompletedBookings);
```

---

## 八、退款政策邏輯

```javascript
function calculateRefundAmount(booking, cancelTime) {
  const bookingDateTime = new Date(`${booking.booking_date} ${booking.start_time}`);
  const hoursUntil = (bookingDateTime - cancelTime) / (1000 * 60 * 60);

  if (hoursUntil >= 48) return booking.total_amount;        // 100% 退款
  if (hoursUntil >= 24) return booking.total_amount * 0.5;  // 50% 退款
  return 0;                                                  // 不退款
}
```

---

## 九、預約鎖定機制（防止雙重預約）

```javascript
// 建立預約時先取得時段鎖（使用 Redis 或 DB 交易）
async function lockTimeSlot(studioId, date, startTime, endTime) {
  // 使用 SELECT FOR UPDATE 或 Redis SETNX
  // 確保同一時段只有一筆進行中的預約
}

// 預約流程：
// 1. 查詢該時段是否有 confirmed 或 pending_payment 的訂單
// 2. 若無，鎖定時段，建立 pending_payment 訂單
// 3. 設定 2 小時付款期限（expire_at）
// 4. 付款成功 → confirmed；超時未付 → 自動取消 → 釋放時段
```

---

## 十、後台登入安全

```
- 管理員帳號儲存於資料庫，密碼使用 bcrypt 雜湊
- JWT Token 驗證（有效期 24 小時）
- 所有後台 API 需在 Header 帶入 Authorization: Bearer {token}
- 登入失敗 5 次鎖定 15 分鐘（使用 Rate Limiting）
- 建議後台網址使用非公開路徑（如 /admin-xxxxxx）
```

---

## 十一、目錄結構（後端）

```
studio-booking/
├── server.js                  # 入口
├── config/
│   ├── database.js            # MySQL 連線設定
│   └── env.js                 # 環境變數管理
├── routes/
│   ├── bookings.js            # 預約相關 API
│   ├── studios.js             # 場地 API
│   ├── payment/
│   │   ├── newebpay.js        # 藍新金流
│   │   └── linepay.js         # LINE Pay
│   ├── invoice.js             # 電子發票
│   ├── notifications.js       # 通知
│   └── admin/                 # 後台 API
│       ├── auth.js
│       ├── bookings.js
│       ├── revenue.js
│       └── settings.js
├── services/
│   ├── bookingService.js      # 業務邏輯
│   ├── emailService.js        # Email 發送
│   ├── smsService.js          # SMS 發送
│   ├── invoiceService.js      # 發票開立
│   └── schedulerService.js    # 排程任務
├── models/
│   ├── Booking.js
│   ├── Studio.js
│   └── Notification.js
├── middleware/
│   ├── auth.js                # JWT 驗證
│   └── validation.js          # 參數驗證
├── templates/
│   ├── emails/                # Email HTML 模板
│   └── sms/                   # SMS 文字模板
├── public/                    # 前端靜態檔案
│   ├── index.html
│   ├── booking.html
│   ├── confirmation.html
│   └── admin.html
└── package.json
```

---

## 十二、環境變數 (.env)

```env
# 伺服器
NODE_ENV=production
PORT=3000
BASE_URL=https://yourdomain.com

# 資料庫
DB_HOST=localhost
DB_PORT=3306
DB_NAME=studio_booking
DB_USER=booking_user
DB_PASS=your_password

# JWT
JWT_SECRET=your_jwt_secret_key

# 藍新金流
NEWEBPAY_MERCHANT_ID=
NEWEBPAY_HASH_KEY=
NEWEBPAY_HASH_IV=
NEWEBPAY_ENV=sandbox   # sandbox | production

# LINE Pay
LINEPAY_CHANNEL_ID=
LINEPAY_CHANNEL_SECRET=
LINEPAY_ENV=sandbox    # sandbox | production

# 電子發票（綠界）
ECPAY_MERCHANT_ID=
ECPAY_HASH_KEY=
ECPAY_HASH_IV=
ECPAY_ENV=sandbox

# Email (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your_app_password
EMAIL_FROM_NAME=Studio Space
EMAIL_FROM=noreply@studiospace.tw

# SMS（每日簡訊）
MITAKE_USERNAME=
MITAKE_PASSWORD=
MITAKE_SENDER=StudioSP

# Redis（可選）
REDIS_URL=redis://localhost:6379
```

---

## 十三、部署步驟（Ubuntu VPS）

```bash
# 1. 安裝 Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. 安裝 MySQL 8
sudo apt-get install -y mysql-server

# 3. 建立資料庫
mysql -u root -p
CREATE DATABASE studio_booking;
CREATE USER 'booking_user'@'localhost' IDENTIFIED BY 'password';
GRANT ALL ON studio_booking.* TO 'booking_user'@'localhost';

# 4. 複製專案並安裝套件
git clone https://github.com/yourrepo/studio-booking.git
cd studio-booking
npm install

# 5. 執行資料庫 migration
npm run migrate

# 6. 設定環境變數
cp .env.example .env
nano .env  # 填入各服務金鑰

# 7. 安裝 Nginx 反向代理
sudo apt-get install -y nginx
# 設定 nginx.conf 轉發 3000 至 80/443

# 8. 申請 SSL 憑證
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com

# 9. 使用 PM2 守護程序
npm install -g pm2
pm2 start server.js --name studio-booking
pm2 startup && pm2 save
```

---

## 十四、前台頁面清單

| 頁面 | 檔案 | 說明 |
|------|------|------|
| 首頁 | `index.html` | 場地介紹、預約流程、FAQ |
| 預約頁 | `booking.html` | 4 步驟預約表單 |
| 確認頁 | `confirmation.html` | 付款成功、QR Code、時程 |
| 後台 | `admin.html` | 管理員後台（需登入） |

---

## 十五、後續開發優先順序

1. **Phase 1（MVP）**：後端 Node.js API + MySQL + 藍新金流 + Email 通知
2. **Phase 2**：LINE Pay 整合 + SMS 通知 + 排程任務
3. **Phase 3**：電子發票 ECPay 串接 + 後台登入驗證
4. **Phase 4**：LINE Pay + 退款自動化 + 數據報表優化
5. **Phase 5**：行動版 PWA 優化 + Google Calendar 整合

---

*本文件由 Studio Space 系統設計規劃，如需修改場地、金流或通知相關設定，請更新對應章節。*
