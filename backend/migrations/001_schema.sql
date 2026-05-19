-- =============================================
-- Studio Space 預約系統 資料庫 Schema
-- 執行方式: mysql -u root -p studio_booking < migrations/001_schema.sql
-- =============================================

CREATE DATABASE IF NOT EXISTS studio_booking CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE studio_booking;

-- 管理員帳號
CREATE TABLE IF NOT EXISTS admins (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  name         VARCHAR(100) NOT NULL,
  email        VARCHAR(200) UNIQUE NOT NULL,
  password     VARCHAR(255) NOT NULL,
  is_active    BOOLEAN DEFAULT TRUE,
  last_login   DATETIME NULL,
  created_at   DATETIME DEFAULT NOW(),
  updated_at   DATETIME DEFAULT NOW() ON UPDATE NOW()
);

-- 場地
CREATE TABLE IF NOT EXISTS studios (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  name          VARCHAR(100) NOT NULL,
  name_en       VARCHAR(100),
  description   TEXT,
  hourly_rate   DECIMAL(10,2) NOT NULL DEFAULT 800.00,
  min_hours     INT NOT NULL DEFAULT 2,
  max_hours     INT NOT NULL DEFAULT 8,
  capacity      INT NOT NULL DEFAULT 15,
  size_sqm      INT COMMENT '坪數',
  sort_order    INT DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    DATETIME DEFAULT NOW(),
  updated_at    DATETIME DEFAULT NOW() ON UPDATE NOW()
);

-- 場地設備標籤
CREATE TABLE IF NOT EXISTS studio_features (
  id         INT PRIMARY KEY AUTO_INCREMENT,
  studio_id  INT NOT NULL,
  feature    VARCHAR(100) NOT NULL,
  FOREIGN KEY (studio_id) REFERENCES studios(id) ON DELETE CASCADE
);

-- 營業時間設定
CREATE TABLE IF NOT EXISTS business_hours (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  studio_id    INT NULL COMMENT 'NULL=全場地',
  weekday      TINYINT NOT NULL COMMENT '0=週日 1=週一 ... 6=週六',
  open_time    TIME NOT NULL DEFAULT '09:00:00',
  close_time   TIME NOT NULL DEFAULT '21:00:00',
  is_open      BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (studio_id) REFERENCES studios(id) ON DELETE CASCADE
);

-- 封鎖日期（停用/維護）
CREATE TABLE IF NOT EXISTS blocked_dates (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  studio_id   INT NULL COMMENT 'NULL=全部場地',
  block_date  DATE NOT NULL,
  start_time  TIME NULL COMMENT 'NULL=整天',
  end_time    TIME NULL,
  reason      VARCHAR(200),
  created_by  INT NULL REFERENCES admins(id),
  created_at  DATETIME DEFAULT NOW(),
  FOREIGN KEY (studio_id) REFERENCES studios(id) ON DELETE CASCADE,
  INDEX idx_block_date (block_date),
  INDEX idx_studio_date (studio_id, block_date)
);

-- 預約主表
CREATE TABLE IF NOT EXISTS bookings (
  id               INT PRIMARY KEY AUTO_INCREMENT,
  booking_no       VARCHAR(20) UNIQUE NOT NULL COMMENT 'SS-YYYYMMDDNNNN',
  studio_id        INT NOT NULL,

  -- 聯絡資訊
  contact_name     VARCHAR(100) NOT NULL,
  contact_phone    VARCHAR(20) NOT NULL,
  contact_email    VARCHAR(200) NOT NULL,
  purpose          VARCHAR(100) NULL,
  note             TEXT NULL,
  admin_note       TEXT NULL COMMENT '後台備注',

  -- 時間
  booking_date     DATE NOT NULL,
  start_time       TIME NOT NULL,
  end_time         TIME NOT NULL,
  duration_hours   DECIMAL(4,1) NOT NULL,

  -- 金額
  unit_price       DECIMAL(10,2) NOT NULL,
  total_amount     DECIMAL(10,2) NOT NULL,

  -- 狀態
  status           ENUM('pending_payment','confirmed','completed','cancelled')
                   NOT NULL DEFAULT 'pending_payment',
  payment_expire   DATETIME NULL COMMENT '付款期限',

  -- 付款資訊
  payment_method   ENUM('credit','atm','cvs','linepay') NULL,
  payment_at       DATETIME NULL,
  payment_trade_no VARCHAR(100) NULL COMMENT '金流交易序號',
  payment_ref      VARCHAR(200) NULL COMMENT '額外付款參考',

  -- 電子發票
  need_invoice     BOOLEAN DEFAULT FALSE,
  invoice_type     ENUM('personal','company','donate') NULL,
  invoice_carrier  VARCHAR(50) NULL COMMENT '手機條碼 /XXXXXXX',
  invoice_tax_id   VARCHAR(8) NULL COMMENT '統一編號',
  invoice_company  VARCHAR(200) NULL,
  invoice_donate   VARCHAR(10) NULL COMMENT '捐贈碼',
  invoice_no       VARCHAR(30) NULL COMMENT '發票號碼',
  invoice_random   VARCHAR(4) NULL COMMENT '隨機碼',
  invoice_at       DATETIME NULL,

  -- 取消/退款
  cancel_reason    TEXT NULL,
  cancel_at        DATETIME NULL,
  cancelled_by     ENUM('customer','admin','system') NULL,
  refund_amount    DECIMAL(10,2) NULL,
  refund_at        DATETIME NULL,
  refund_trade_no  VARCHAR(100) NULL,

  created_at       DATETIME DEFAULT NOW(),
  updated_at       DATETIME DEFAULT NOW() ON UPDATE NOW(),

  FOREIGN KEY (studio_id) REFERENCES studios(id),
  INDEX idx_booking_no (booking_no),
  INDEX idx_studio_date (studio_id, booking_date),
  INDEX idx_status (status),
  INDEX idx_email (contact_email),
  INDEX idx_payment_expire (payment_expire)
);

-- 通知記錄
CREATE TABLE IF NOT EXISTS notifications (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  booking_id   INT NULL REFERENCES bookings(id),
  type         ENUM('email','sms') NOT NULL,
  event        VARCHAR(50) NOT NULL COMMENT 'booking_confirmed | reminder_24h | ...',
  recipient    VARCHAR(200) NOT NULL,
  subject      VARCHAR(300) NULL COMMENT 'Email 主旨',
  status       ENUM('sent','failed','pending') DEFAULT 'pending',
  sent_at      DATETIME NULL,
  error_msg    TEXT NULL,
  retry_count  INT DEFAULT 0,
  created_at   DATETIME DEFAULT NOW(),
  INDEX idx_booking (booking_id),
  INDEX idx_status (status),
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
);

-- 系統設定
CREATE TABLE IF NOT EXISTS settings (
  key_name     VARCHAR(100) PRIMARY KEY,
  key_value    TEXT,
  description  VARCHAR(300) NULL,
  updated_at   DATETIME DEFAULT NOW() ON UPDATE NOW()
);
