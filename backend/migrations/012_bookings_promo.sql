-- 預約表：新增優惠碼關聯欄位
ALTER TABLE bookings ADD COLUMN discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER total_amount;
ALTER TABLE bookings ADD COLUMN promo_id INT DEFAULT NULL AFTER discount_amount;
