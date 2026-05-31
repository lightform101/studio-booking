-- 016_promotions_min_hours.sql
-- 補齊 promotions 資料表缺少的 min_hours 欄位
-- 若欄位已存在，ER_DUP_FIELDNAME 會被自動忽略

ALTER TABLE promotions
  ADD COLUMN min_hours INT NOT NULL DEFAULT 1 COMMENT '最少預約幾小時才適用' AFTER discount_value;
