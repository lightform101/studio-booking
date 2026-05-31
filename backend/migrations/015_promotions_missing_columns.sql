-- 015_promotions_missing_columns.sql
-- 補齊 promotions 資料表缺少的欄位
-- 若欄位已存在，ALTER TABLE 會拋出 ER_DUP_FIELDNAME（可安全忽略）

ALTER TABLE promotions
  ADD COLUMN description TEXT NULL COMMENT '優惠說明（前台顯示）' AFTER name;

-- valid_from / valid_to 已移至 018_promotions_valid_dates.sql 補齊
-- (因 015 執行時 end_hour 欄位尚不存在，AFTER end_hour 會失敗)
