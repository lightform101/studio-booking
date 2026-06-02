-- 021_carousel.sql
-- 首頁輪播區塊（最新消息 / 優惠圖片），由後台管理

CREATE TABLE IF NOT EXISTS carousel_slides (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  image_url   VARCHAR(500) NOT NULL          COMMENT '圖片路徑',
  title       VARCHAR(200) NULL              COMMENT '標題文字（顯示於圖片下方，可留空）',
  link_url    VARCHAR(500) NULL              COMMENT '點擊後前往的連結（可留空）',
  sort_order  INT NOT NULL DEFAULT 0         COMMENT '排序，數字小優先',
  is_active   TINYINT(1) NOT NULL DEFAULT 1  COMMENT '是否顯示',
  created_at  DATETIME DEFAULT NOW()
);
