-- 018_promotions_valid_dates.sql
-- 補齊 valid_from / valid_to（015 因 AFTER end_hour 時 end_hour 尚不存在而失敗）
-- end_hour 已由 017 補齊，此次可正確加入

ALTER TABLE promotions
  ADD COLUMN valid_from DATE NULL COMMENT '優惠開始日期，NULL=即日起' AFTER end_hour;

ALTER TABLE promotions
  ADD COLUMN valid_to DATE NULL COMMENT '優惠截止日期，NULL=無限期' AFTER valid_from;
