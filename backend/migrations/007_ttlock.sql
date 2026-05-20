-- TTLock 電子鎖整合
-- 場地新增 lock_id 欄位
ALTER TABLE studios
  ADD COLUMN IF NOT EXISTS ttlock_lock_id BIGINT DEFAULT NULL COMMENT 'TTLock 鎖 ID';

-- 訂單新增密碼記錄欄位
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS ttlock_passcode     VARCHAR(20)  DEFAULT NULL COMMENT '臨時進門密碼',
  ADD COLUMN IF NOT EXISTS ttlock_passcode_id  BIGINT       DEFAULT NULL COMMENT 'TTLock keyboardPwdId，用於刪除';
