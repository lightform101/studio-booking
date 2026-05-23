/**
 * 管理員操作稽核日誌
 * 用法：await auditLog(req, 'update', 'booking', bookingId, '將狀態改為 confirmed');
 */
const { pool } = require('../config/database');

async function auditLog(req, action, targetType, targetId, detail) {
  try {
    const admin = req.admin;
    if (!admin) return;
    await pool.query(
      `INSERT INTO admin_audit_logs (admin_id, admin_name, action, target_type, target_id, detail, ip)
       VALUES (?,?,?,?,?,?,?)`,
      [
        admin.id,
        admin.name || admin.email,
        action,
        targetType,
        targetId != null ? String(targetId) : null,
        detail   != null ? (typeof detail === 'object' ? JSON.stringify(detail) : String(detail)) : null,
        req.ip || req.headers['x-forwarded-for'] || null,
      ]
    );
  } catch (e) {
    console.error('[AuditLog] 寫入失敗:', e.message);
  }
}

module.exports = auditLog;
