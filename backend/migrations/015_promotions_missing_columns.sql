-- 015_promotions_missing_columns.sql
-- 補齊 promotions 資料表缺少的欄位
-- 若欄位已存在，ALTER TABLE 會拋出 ER_DUP_FIELDNAME（可安全忽略）

ALTER TABLE promotions
  ADD COLUMN description TEXT NULL COMMENT '優惠說明（前台顯示）' AFTER name;

ALTER TABLE promotions
  ADD COLUMN valid_from DATE NULL COMMENT '優惠開始日期，NULL=即日起' AFTER end_hour;

ALTER TABLE promotions
  ADD COLUMN valid_to DATE NULL COMMENT '優惠截止日期，NULL=無限期' AFTER valid_from;
