-- 031_studio_panorama.sql
-- 場地 360° 環景導覽連結（支援 Kuula / 720雲 / Matterport 等 iframe 嵌入服務）

ALTER TABLE studios
  ADD COLUMN panorama_url VARCHAR(500) NULL COMMENT '360環景/3D導覽嵌入連結，NULL=不顯示';
