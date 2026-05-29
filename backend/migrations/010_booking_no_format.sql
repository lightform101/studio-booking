-- 訂單號格式說明更新
-- 舊格式：SS-YYYYMMDDNNNN（每日 COUNT+1，並發下有重複風險）
-- 新格式：SS-YYYYMMDD-NNNNN（使用 AUTO_INCREMENT PK，並發安全）
-- 範例：SS-20260523-00042

ALTER TABLE bookings
  MODIFY COLUMN booking_no VARCHAR(20) UNIQUE NOT NULL
    COMMENT 'SS-YYYYMMDD-NNNNN (uses auto_increment id, concurrency-safe)';
