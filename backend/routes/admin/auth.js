/**
 * 後台認證 Routes
 * POST /api/admin/auth/login
 * GET  /api/admin/auth/me
 */
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { pool } = require('../../config/database');
const auth    = require('../../middleware/auth');
const rateLimit = require('express-rate-limit');

// 登入失敗限制
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5,
  message: { success: false, message: '嘗試次數過多，請 15 分鐘後再試' }
});

// 登入
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: '請填入帳號與密碼' });

    const [[admin]] = await pool.query(
      'SELECT * FROM admins WHERE email=? AND is_active=TRUE', [email]
    );
    if (!admin || !await bcrypt.compare(password, admin.password)) {
      return res.status(401).json({ success: false, message: '帳號或密碼錯誤' });
    }

    await pool.query('UPDATE admins SET last_login=NOW() WHERE id=?', [admin.id]);

    const token = jwt.sign(
      { id: admin.id, email: admin.email, name: admin.name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    res.json({
      success: true, message: '登入成功',
      data: { token, name: admin.name, email: admin.email }
    });
  } catch (err) { next(err); }
});

// 取得當前登入者資訊
router.get('/me', auth, async (req, res) => {
  res.json({ success: true, data: req.admin });
});

// 變更密碼
router.post('/change-password', auth, async (req, res, next) => {
  try {
    const { old_password, new_password } = req.body;
    const [[admin]] = await pool.query(
      'SELECT * FROM admins WHERE id=?', [req.admin.id]
    );
    if (!await bcrypt.compare(old_password, admin.password)) {
      return res.status(400).json({ success: false, message: '舊密碼不正確' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ success: false, message: '新密碼至少需要 8 個字元' });
    }
    const hashed = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE admins SET password=? WHERE id=?', [hashed, req.admin.id]);
    res.json({ success: true, message: '密碼已更新' });
  } catch (err) { next(err); }
});

// 列出所有管理員（需登入）
router.get('/admins', auth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, email, is_active, last_login, created_at FROM admins ORDER BY id ASC'
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// 新增管理員（需登入）
router.post('/admins', auth, async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: '請填寫姓名、Email 和密碼' });
    if (password.length < 8)
      return res.status(400).json({ success: false, message: '密碼至少需要 8 個字元' });
    const [[exist]] = await pool.query('SELECT id FROM admins WHERE email=?', [email]);
    if (exist)
      return res.status(409).json({ success: false, message: '此 Email 已被使用' });
    const hashed = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO admins (name, email, password) VALUES (?,?,?)', [name, email, hashed]
    );
    res.json({ success: true, message: '管理員已建立', data: { id: result.insertId } });
  } catch (err) { next(err); }
});

// 停用 / 啟用管理員（需登入，不能停用自己）
router.put('/admins/:id', auth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (id === req.admin.id)
      return res.status(400).json({ success: false, message: '不能修改自己的狀態' });
    const { is_active } = req.body;
    await pool.query('UPDATE admins SET is_active=? WHERE id=?', [is_active ? 1 : 0, id]);
    res.json({ success: true, message: is_active ? '已啟用' : '已停用' });
  } catch (err) { next(err); }
});

module.exports = router;
