-- 005_studio_rates.sql
-- 新增場地分類費率欄位：平面攝影、動態攝影
ALTER TABLE studios ADD COLUMN photo_rate DECIMAL(10,2) NULL COMMENT '平面攝影費率';
ALTER TABLE studios ADD COLUMN video_rate DECIMAL(10,2) NULL COMMENT '動態攝影費率';
