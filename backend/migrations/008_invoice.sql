-- 008: 發票狀態欄位（光貿 Amego 串接）
ALTER TABLE bookings
  ADD COLUMN invoice_status ENUM('not_needed','pending','issued','failed')
    NOT NULL DEFAULT 'not_needed'
    COMMENT '發票狀態'
  AFTER invoice_donate;
