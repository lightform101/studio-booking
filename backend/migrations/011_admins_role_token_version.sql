-- P2-8: token_version — 停用帳號或改密時遞增，讓舊 token 立即失效
-- P2-9: role          — 區分 superadmin / admin，限制帳號管理操作

ALTER TABLE admins
  ADD COLUMN token_version INT UNSIGNED NOT NULL DEFAULT 1
    COMMENT '每次停用或改密時 +1，使既有 JWT 立即失效',
  ADD COLUMN role ENUM('superadmin','admin') NOT NULL DEFAULT 'admin'
    COMMENT 'superadmin 可新增/停用其他管理員';

-- 將第一個帳號設為 superadmin（請依實際 id 調整）
UPDATE admins SET role='superadmin' WHERE id=(SELECT MIN(id) FROM (SELECT id FROM admins) t);
