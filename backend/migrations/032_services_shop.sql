-- 032_services_shop.sql
-- 攝影服務 + 合作攝影師 + 商品（二手傢俱／優選好物）
-- 所有圖片一律使用外連網址，不佔用伺服器硬碟

-- 攝影服務（形象照／產品／網拍／活動紀錄）
CREATE TABLE IF NOT EXISTS photo_services (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  category    VARCHAR(20) NOT NULL DEFAULT 'portrait' COMMENT 'portrait=形象照 product=產品 ecommerce=網拍 event=活動紀錄',
  title       VARCHAR(200) NOT NULL          COMMENT '服務名稱',
  description TEXT NULL                      COMMENT '服務說明',
  price_note  VARCHAR(200) NULL              COMMENT '價格／方案，例：NT$3,000 起 或 來電洽詢',
  gallery     TEXT NULL                      COMMENT '作品圖片（JSON 陣列，外連網址）',
  link_url    VARCHAR(500) NULL              COMMENT '詢價／預約按鈕連結',
  link_label  VARCHAR(50) NULL               COMMENT '按鈕文字，預設：立即詢價',
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME DEFAULT NOW(),
  updated_at  DATETIME DEFAULT NOW() ON UPDATE NOW()
);

-- 合作攝影師（點名稱外連到其作品集）
CREATE TABLE IF NOT EXISTS photographers (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  name          VARCHAR(100) NOT NULL        COMMENT '攝影師名稱',
  specialty     VARCHAR(200) NULL            COMMENT '專長，例：人像 / 商業空間',
  avatar_url    VARCHAR(500) NULL            COMMENT '頭像（外連網址，可留空）',
  portfolio_url VARCHAR(500) NULL            COMMENT '作品集連結（點名稱後外連）',
  note          TEXT NULL                    COMMENT '簡介',
  sort_order    INT NOT NULL DEFAULT 0,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME DEFAULT NOW()
);

-- 商品（二手傢俱出清／優選好物）
CREATE TABLE IF NOT EXISTS shop_items (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  category       VARCHAR(20) NOT NULL DEFAULT 'furniture' COMMENT 'furniture=二手傢俱 goods=優選好物',
  title          VARCHAR(200) NOT NULL       COMMENT '商品名稱',
  description    TEXT NULL                   COMMENT '商品說明',
  price          INT NULL                    COMMENT '售價 NT$（NULL=面議）',
  original_price INT NULL                    COMMENT '原價（顯示劃線對比，可留空）',
  images         TEXT NULL                   COMMENT '商品圖片（JSON 陣列，外連網址）',
  condition_note VARCHAR(200) NULL           COMMENT '狀況說明，例：九成新、有使用痕跡',
  status         VARCHAR(20) NOT NULL DEFAULT 'available' COMMENT 'available=販售中 reserved=已預訂 sold=已售出',
  sort_order     INT NOT NULL DEFAULT 0,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at     DATETIME DEFAULT NOW(),
  updated_at     DATETIME DEFAULT NOW() ON UPDATE NOW()
);
