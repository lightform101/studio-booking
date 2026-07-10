-- 023_line.sql
-- LINE 通知：記錄加官方帳號好友 / 傳訊息過來的使用者（用於推播對象）

CREATE TABLE IF NOT EXISTS line_contacts (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  user_id        VARCHAR(64) NOT NULL UNIQUE  COMMENT 'LINE userId',
  display_name   VARCHAR(100) NULL            COMMENT 'LINE 顯示名稱',
  notify_enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否為通知對象（老闆/員工）',
  created_at     DATETIME DEFAULT NOW(),
  updated_at     DATETIME DEFAULT NOW() ON UPDATE NOW()
);

-- LINE 金鑰預設空值（實際由後台填入 settings）
INSERT INTO settings (key_name, key_value, description) VALUES
  ('line_channel_access_token', '', 'LINE Messaging API Channel Access Token'),
  ('line_channel_secret',       '', 'LINE Messaging API Channel Secret'),
  ('line_notify_enabled',       '1', '是否啟用 LINE 通知')
ON DUPLICATE KEY UPDATE key_name = key_name;
