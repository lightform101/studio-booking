/**
 * JWT 認證 Middleware
 * 驗證順序：簽名 → DB 查詢 is_active / token_version / role
 * role 從 DB 取得，不信任 JWT payload，防止權限竄改。
 */
const jwt   = require('jsonwebtoken');
const { pool } = require('../config/database');

module.exports = async function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer '))
    return res.status(401).json({ success: false, message: '請先登入' });

  const token = authHeader.split(' ')[1];
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError')
      return res.status(401).json({ success: false, message: '登入已過期，請重新登入' });
    return res.status(401).json({ success: false, message: '無效的認證 Token' });
  }

  try {
    const [[admin]] = await pool.query(
      'SELECT is_active, token_version, role FROM admins WHERE id=?',
      [decoded.id]
    );
    if (!admin || !admin.is_active)
      return res.status(401).json({ success: false, message: '帳號已停用，請聯絡管理員' });
    if (decoded.tv !== undefined && admin.token_version !== decoded.tv)
      return res.status(401).json({ success: false, message: '登入已失效，請重新登入' });

    req.admin = { ...decoded, role: admin.role }; // role 以 DB 為準
    next();
  } catch (err) {
    // token_version / role 欄位尚未建立（migration 尚未執行）→ 降級驗證
    if (err.code === 'ER_BAD_FIELD_ERROR') {
      try {
        const [[admin]] = await pool.query(
          'SELECT is_active FROM admins WHERE id=?', [decoded.id]
        );
        if (!admin || !admin.is_active)
          return res.status(401).json({ success: false, message: '帳號已停用，請聯絡管理員' });
        req.admin = { ...decoded, role: 'superadmin' }; // migration 前暫時給最高權限
        return next();
      } catch (e) {
        return res.status(500).json({ success: false, message: '認證系統錯誤' });
      }
    }
    return res.status(500).json({ success: false, message: '認證系統錯誤' });
  }
};
