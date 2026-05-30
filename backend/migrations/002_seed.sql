-- =============================================
-- 初始資料（種子資料）
-- 執行方式: mysql -u root -p studio_booking < migrations/002_seed.sql
-- =============================================

-- 管理員帳號 (密碼: Admin@1234，已 bcrypt 雜湊)
INSERT INTO admins (name, email, password) VALUES
('系統管理員', 'admin@studiospace.tw',
 '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lHHi')
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- 場地資料
INSERT INTO studios (id, name, name_en, description, hourly_rate, min_hours, max_hours, capacity, size_sqm, sort_order) VALUES
(1, 'LightForm Studio 101-4F', 'LightForm Studio 101-4F',
 '寬敞的專業商業攝影空間，適合服裝拍攝、品牌廣告、形象照及大型商品攝影。配備業界頂規燈光設備，多款專業背景紙可供更換。',
 800.00, 2, 8, 15, 60, 1),
(2, '攝影棚乙', 'Studio B',
 '靈活彈性的多功能拍攝空間，適合個人寫真、Podcast 錄製、YouTube 頻道、產品拍攝及小型影片製作。',
 600.00, 2, 8, 8, 30, 2)
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- 場地設備
INSERT INTO studio_features (studio_id, feature) VALUES
(1, '化妝間'), (1, '更衣室'), (1, '置物空間'), (1, '無線網路'),
(1, '停車場'), (1, '無障礙入口'), (1, 'Profoto B10 ×4'), (1, '16色背景紙'),
(2, '化妝間'), (2, '休息區'), (2, '投影設備'), (2, '無線網路'),
(2, '飲水機'), (2, '白板'), (2, 'LED 持續燈 ×6'), (2, '防音處理');

-- 預設營業時間（全場地，週一到週日 09:00–21:00）
INSERT INTO business_hours (studio_id, weekday, open_time, close_time, is_open) VALUES
(NULL, 0, '09:00:00', '21:00:00', TRUE),
(NULL, 1, '09:00:00', '21:00:00', TRUE),
(NULL, 2, '09:00:00', '21:00:00', TRUE),
(NULL, 3, '09:00:00', '21:00:00', TRUE),
(NULL, 4, '09:00:00', '21:00:00', TRUE),
(NULL, 5, '09:00:00', '21:00:00', TRUE),
(NULL, 6, '09:00:00', '21:00:00', TRUE);

-- 系統設定
INSERT INTO settings (key_name, key_value, description) VALUES
('site_name',            'LightForm Studio',           '網站名稱'),
('site_email',           'contact@lightformstudio.com.tw',  '聯絡信箱'),
('site_phone',           '02-XXXX-XXXX',            '聯絡電話'),
('site_address',         '台北市...',               '地址'),
('booking_lock_minutes', '120',                     '付款等待時間（分鐘）'),
('min_advance_hours',    '24',                      '最少提前預約時數'),
('notify_email_enabled', '1',                       'Email 通知開關'),
('notify_sms_enabled',   '1',                       'SMS 通知開關'),
('invoice_auto_issue',   '1',                       '付款後自動開立發票'),
('invoice_auto_email',   '1',                       '發票自動寄送 Email'),
('overtime_rate_30min',  '400',                     '超時每30分鐘費率')
ON DUPLICATE KEY UPDATE key_value=VALUES(key_value);
