-- 017_promotions_all_missing_columns.sql
-- 一次補齊 promotions 資料表所有可能缺少的欄位
-- 若欄位已存在，ER_DUP_FIELDNAME 會被自動忽略

ALTER TABLE promotions
  ADD COLUMN studio_id INT NULL COMMENT '適用場地，NULL=全場地' AFTER min_hours;

ALTER TABLE promotions
  ADD COLUMN promo_code VARCHAR(50) NULL COMMENT '優惠碼，NULL=無需代碼自動套用' AFTER studio_id;

ALTER TABLE promotions
  ADD COLUMN applicable_days VARCHAR(20) NULL COMMENT '適用星期 JSON [0,1,2]，NULL=全週' AFTER promo_code;

ALTER TABLE promotions
  ADD COLUMN start_hour TINYINT NULL COMMENT '適用開始時段（小時），NULL=全天' AFTER applicable_days;

ALTER TABLE promotions
  ADD COLUMN end_hour TINYINT NULL COMMENT '適用結束時段（小時），NULL=全天' AFTER start_hour;
