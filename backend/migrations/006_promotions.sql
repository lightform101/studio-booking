-- 006_promotions.sql
-- 優惠方案資料表

CREATE TABLE IF NOT EXISTS promotions (
  id              INT PRIMARY KEY AUTO_INCREMENT,
  name            VARCHAR(100) NOT NULL          COMMENT '優惠名稱',
  description     TEXT                           COMMENT '優惠說明',
  discount_type   ENUM('percent','fixed','schedule') NOT NULL COMMENT 'percent=百分比 fixed=固定金額 schedule=時段平日',
  discount_value  DECIMAL(10,2) NOT NULL         COMMENT '折扣值：percent=折扣% fixed=折抵NT$ schedule=折扣%',
  min_hours       INT DEFAULT 1                  COMMENT '最少預約幾小時才適用',
  studio_id       INT NULL                       COMMENT 'NULL=全場地適用',
  promo_code      VARCHAR(50) NULL               COMMENT '優惠碼，NULL=無需代碼自動套用',
  applicable_days VARCHAR(20) NULL               COMMENT '適用星期 JSON [0,1,2] 0=週日，NULL=全週',
  start_hour      TINYINT NULL                   COMMENT '適用開始時段（小時），NULL=全天',
  end_hour        TINYINT NULL                   COMMENT '適用結束時段（小時），NULL=全天',
  valid_from      DATE NULL                      COMMENT '優惠開始日期，NULL=即日起',
  valid_to        DATE NULL                      COMMENT '優惠截止日期，NULL=無限期',
  is_active       BOOLEAN DEFAULT TRUE,
  sort_order      INT DEFAULT 0,
  created_at      DATETIME DEFAULT NOW(),
  updated_at      DATETIME DEFAULT NOW() ON UPDATE NOW(),
  FOREIGN KEY (studio_id) REFERENCES studios(id) ON DELETE SET NULL
);
