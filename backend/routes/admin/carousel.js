/**
 * 後台：首頁輪播管理
 * GET    /api/admin/carousel          取得所有輪播圖
 * POST   /api/admin/carousel          新增（上傳圖片 + 標題 + 連結）
 * PUT    /api/admin/carousel/:id      更新標題/連結/排序/啟用
 * DELETE /api/admin/carousel/:id      刪除（含圖片檔）
 */
const router   = require('express').Router();
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const auth     = require('../../middleware/auth');
const { pool } = require('../../config/database');

const ALLOWED_TYPES = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const UPLOAD_DIR    = path.join(__dirname, '../../uploads/carousel');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `slide_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    ALLOWED_TYPES.includes(ext) ? cb(null, true) : cb(new Error('僅支援 JPG/PNG/WEBP/GIF'));
  },
  limits: { fileSize: 20 * 1024 * 1024 }
});

router.use(auth);

// 取得全部
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM carousel_slides ORDER BY sort_order ASC, id ASC'
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// 新增（上傳圖片）
router.post('/', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '請選擇圖片' });
    const image_url  = `/uploads/carousel/${req.file.filename}`;
    const { title, link_url, sort_order } = req.body;
    const [result] = await pool.query(
      `INSERT INTO carousel_slides (image_url, title, link_url, sort_order, is_active)
       VALUES (?,?,?,?,1)`,
      [image_url, title || null, link_url || null, parseInt(sort_order) || 0]
    );
    res.json({ success: true, data: { id: result.insertId, image_url }, message: '輪播圖已新增' });
  } catch (err) {
    res.status(500).json({ success: false, message: `新增失敗：${err.sqlMessage || err.message}` });
  }
});

// 更新（標題/連結/排序/啟用）
router.put('/:id', async (req, res, next) => {
  try {
    const { title, link_url, sort_order, is_active } = req.body;
    const [result] = await pool.query(
      `UPDATE carousel_slides
       SET title=?, link_url=?, sort_order=?, is_active=?
       WHERE id=?`,
      [
        title || null,
        link_url || null,
        parseInt(sort_order) || 0,
        is_active != null ? (is_active ? 1 : 0) : 1,
        req.params.id
      ]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ success: false, message: '找不到此輪播圖' });
    res.json({ success: true, message: '已更新' });
  } catch (err) {
    res.status(500).json({ success: false, message: `更新失敗：${err.sqlMessage || err.message}` });
  }
});

// 刪除（含圖片檔）
router.delete('/:id', async (req, res, next) => {
  try {
    const [[row]] = await pool.query('SELECT image_url FROM carousel_slides WHERE id=?', [req.params.id]);
    if (!row) return res.status(404).json({ success: false, message: '找不到此輪播圖' });

    await pool.query('DELETE FROM carousel_slides WHERE id=?', [req.params.id]);

    // 刪除實體檔案（限制在 uploads 目錄內）
    try {
      const allowedDir = path.resolve(path.join(__dirname, '..', '..', 'uploads'));
      const filePath   = path.resolve(path.join(__dirname, '..', '..', row.image_url.replace(/^\//, '')));
      if (filePath.startsWith(allowedDir) && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) { /* 檔案刪除失敗不影響 */ }

    res.json({ success: true, message: '輪播圖已刪除' });
  } catch (err) { next(err); }
});

module.exports = router;
