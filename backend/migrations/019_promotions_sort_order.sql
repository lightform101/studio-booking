-- 019_promotions_sort_order.sql
-- 補齊 promotions 缺少的 sort_order 及其他可能遺漏欄位

ALTER TABLE promotions
  ADD COLUMN sort_order INT NOT NULL DEFAULT 0 COMMENT '排序（數字小優先）' AFTER is_active;

ALTER TABLE promotions
  ADD COLUMN created_at DATETIME DEFAULT NOW() AFTER sort_order;

ALTER TABLE promotions
  ADD COLUMN updated_at DATETIME DEFAULT NOW() ON UPDATE NOW() AFTER created_at;
