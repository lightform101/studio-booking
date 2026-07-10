-- 022_events.sql
-- 活動專區（課程 / 特惠活動 / 講座），由後台管理

CREATE TABLE IF NOT EXISTS events (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  title       VARCHAR(200) NOT NULL          COMMENT '活動標題',
  category    VARCHAR(20) NOT NULL DEFAULT 'other' COMMENT '類別：course=課程 promo=特惠 talk=講座 other=其他',
  description TEXT NULL                      COMMENT '活動說明',
  image_url   VARCHAR(500) NULL              COMMENT '主視覺圖片',
  gallery     TEXT NULL                      COMMENT '說明附圖（JSON 陣列，每張 ≤1MB）',
  video_url   VARCHAR(500) NULL              COMMENT '影片外連網址（YouTube/Vimeo，不佔硬碟）',
  event_date  DATE NULL                      COMMENT '活動日期（單日活動）',
  date_note   VARCHAR(100) NULL              COMMENT '日期補充文字（例：每週六開課、報名至 7/31）',
  capacity    INT NULL                       COMMENT '人數上限（NULL=不顯示）',
  price       INT NULL                       COMMENT '費用 NT$（0=免費，NULL=不顯示）',
  link_url    VARCHAR(500) NULL              COMMENT '報名/詳情連結（可留空）',
  link_label  VARCHAR(50) NULL               COMMENT '連結按鈕文字（預設：立即報名）',
  sort_order  INT NOT NULL DEFAULT 0         COMMENT '排序，數字小優先',
  is_active   TINYINT(1) NOT NULL DEFAULT 1  COMMENT '是否顯示',
  created_at  DATETIME DEFAULT NOW(),
  updated_at  DATETIME DEFAULT NOW() ON UPDATE NOW()
);
