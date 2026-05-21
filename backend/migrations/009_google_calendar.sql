ALTER TABLE bookings ADD COLUMN google_event_id VARCHAR(255) NULL COMMENT 'Google Calendar 事件 ID' AFTER invoice_status;
