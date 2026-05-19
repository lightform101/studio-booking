-- =============================================
-- 場地照片功能 Migration
-- =============================================

USE studio_booking;

-- 場地照片表
CREATE TABLE IF NOT EXISTS studio_images (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  studio_id   INT NOT NULL,
  filename    VARCHAR(255) NOT NULL COMMENT '儲存的檔名',
  original    VARCHAR(255) NULL COMMENT '原始檔名',
  url         VARCHAR(500) NOT NULL COMMENT '公開存取路徑',
  alt_text    VARCHAR(200) NULL COMMENT '圖片說明（SEO / alt）',
  sort_order  INT DEFAULT 0 COMMENT '排序，數字小在前',
  is_main     BOOLEAN DEFAULT FALSE COMMENT '是否為主圖',
  file_size   INT NULL COMMENT '檔案大小(bytes)',
  created_at  DATETIME DEFAULT NOW(),
  FOREIGN KEY (studio_id) REFERENCES studios(id) ON DELETE CASCADE,
  INDEX idx_studio_id (studio_id),
  INDEX idx_sort (studio_id, sort_order)
);
