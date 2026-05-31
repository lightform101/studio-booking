-- 020_promotions_fix_code_column.sql
-- 生產環境 promotions 表有一個舊版 `code` 欄位（NOT NULL 無預設值）
-- 新版已改用 `promo_code`，將舊欄位設為 nullable 避免 INSERT 失敗

ALTER TABLE promotions
  MODIFY COLUMN code VARCHAR(50) NULL DEFAULT NULL COMMENT '舊版優惠碼欄位（已棄用，由 promo_code 取代）';
