-- =============================================
-- 外觀設定初始資料
-- =============================================
USE studio_booking;

INSERT INTO settings (key_name, key_value, description) VALUES
-- 色彩主題
('theme_primary',       '#1a1a2e',        '主色調（導覽列/側欄背景）'),
('theme_accent',        '#e94560',        '強調色（按鈕/連結/標籤）'),
('theme_gold',          '#c9a84c',        '金色裝飾'),
('theme_bg',            '#f8f8f8',        '頁面背景色'),
('theme_card_bg',       '#ffffff',        '卡片背景色'),
('theme_text',          '#1a1a2e',        '主要文字顏色'),
-- 字型
('theme_font',          'Noto Sans TC',   '前台字型'),
('theme_font_size',     'medium',         '字級大小 small/medium/large'),
-- 圓角
('theme_border_radius', '12',             '卡片圓角大小(px)'),
-- 網站資訊
('site_tagline',        '專業攝影棚空間・靈感的誕生地', '首頁 Hero 副標語'),
('hero_title',          '打造完美視覺的地方',           '首頁 Hero 主標題'),
('hero_subtitle',       '台北市最專業的攝影棚，提供高規格設備與靈活預約服務', '首頁 Hero 描述'),
('nav_show_phone',      '1',              '導覽列顯示電話')
ON DUPLICATE KEY UPDATE description=VALUES(description);
