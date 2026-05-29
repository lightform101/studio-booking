-- 管理員操作稽核日誌
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id          BIGINT PRIMARY KEY AUTO_INCREMENT,
  admin_id    INT          NOT NULL COMMENT '操作者 admin.id',
  admin_name  VARCHAR(100) NOT NULL COMMENT '操作者姓名（快照，防帳號被刪後遺失）',
  action      VARCHAR(50)  NOT NULL COMMENT '動作：create / update / cancel / delete / login 等',
  target_type VARCHAR(50)  NOT NULL COMMENT '目標類型：booking / studio / settings / admin',
  target_id   VARCHAR(50)  DEFAULT NULL COMMENT '目標 ID 或 booking_no',
  detail      TEXT         DEFAULT NULL COMMENT '操作摘要（JSON 或文字）',
  ip          VARCHAR(45)  DEFAULT NULL,
  created_at  DATETIME     DEFAULT NOW(),
  INDEX idx_admin (admin_id),
  INDEX idx_target (target_type, target_id),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
