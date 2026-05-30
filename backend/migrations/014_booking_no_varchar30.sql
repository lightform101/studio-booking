-- booking_no 欄位擴大為 VARCHAR(30)，以容納 TMP 暫存號格式
ALTER TABLE bookings
  MODIFY COLUMN booking_no VARCHAR(30) UNIQUE NOT NULL
    COMMENT 'SS-YYYYMMDD-NNNNN（正式）或 TMP-xxxxx（暫存）';
