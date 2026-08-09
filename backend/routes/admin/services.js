/**
 * 後台：攝影服務 + 合作攝影師管理
 * 服務    GET/POST /api/admin/services        PUT/DELETE /api/admin/services/:id
 * 攝影師  GET/POST /api/admin/services/photographers   PUT/DELETE /api/admin/services/photographers/:id
 * 圖片一律外連網址，不上傳檔案
 */
const router   = require('express').Router();
const auth     = require('../../middleware/auth');
const { pool } = require('../../config/database');

const VALID_CATEGORIES = ['portrait', 'product', 'ecommerce', 'event'];

router.use(auth);

// 將前端傳來的圖片陣列/多行文字轉為 JSON 字串
function toGalleryJson(input) {
  let arr = [];
  if (Array.isArray(input)) arr = input;
  else if (typeof input === 'string' && input.trim()) {
    arr = input.split(/\r?\n|,/).map(s => s.trim()).filter(Boolean);
  }
  arr = arr.filter(u => /^https?:\/\//i.test(u));
  return arr.length ? JSON.stringify(arr) : null;
}

// ─── 合作攝影師（必須放在 /:id 之前，否則會被誤判為 id）───

router.get('/photographers', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM photographers ORDER BY sort_order ASC, id ASC');
    res.json({ success: true, data: rows });
  } catch (err) { res.json({ success: true, data: [] }); }
});

router.post('/photographers', async (req, res) => {
  try {
    const { name, specialty, avatar_url, portfolio_url, note, sort_order } = req.body || {};
    if (!name) return res.status(400).json({ success: false, message: '請輸入攝影師名稱' });
    const [r] = await pool.query(
      `INSERT INTO photographers (name, specialty, avatar_url, portfolio_url, note, sort_order, is_active)
       VALUES (?,?,?,?,?,?,1)`,
      [name.trim(), specialty || null, avatar_url || null, portfolio_url || null, note || null, parseInt(sort_order) || 0]
    );
    res.json({ success: true, data: { id: r.insertId }, message: '攝影師已新增' });
  } catch (err) {
    res.status(500).json({ success: false, message: `新增失敗：${err.sqlMessage || err.message}` });
  }
});

router.put('/photographers/:id', async (req, res) => {
  try {
    const { name, specialty, avatar_url, portfolio_url, note, sort_order, is_active } = req.body || {};
    if (!name) return res.status(400).json({ success: false, message: '請輸入攝影師名稱' });
    const [r] = await pool.query(
      `UPDATE photographers SET name=?, specialty=?, avatar_url=?, portfolio_url=?, note=?, sort_order=?, is_active=?
       WHERE id=?`,
      [name.trim(), specialty || null, avatar_url || null, portfolio_url || null, note || null,
       parseInt(sort_order) || 0, is_active ? 1 : 0, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ success: false, message: '找不到此攝影師' });
    res.json({ success: true, message: '已更新' });
  } catch (err) {
    res.status(500).json({ success: false, message: `更新失敗：${err.sqlMessage || err.message}` });
  }
});

router.delete('/photographers/:id', async (req, res, next) => {
  try {
    const [r] = await pool.query('DELETE FROM photographers WHERE id=?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ success: false, message: '找不到此攝影師' });
    res.json({ success: true, message: '已刪除' });
  } catch (err) { next(err); }
});

// ─── 攝影服務 ───────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM photo_services ORDER BY sort_order ASC, id ASC');
    rows.forEach(r => { try { r.gallery = r.gallery ? JSON.parse(r.gallery) : []; } catch { r.gallery = []; } });
    res.json({ success: true, data: rows });
  } catch (err) { res.json({ success: true, data: [] }); }
});

router.post('/', async (req, res) => {
  try {
    const { category, title, description, price_note, gallery, link_url, link_label, sort_order } = req.body || {};
    if (!title) return res.status(400).json({ success: false, message: '請輸入服務名稱' });
    const cat = VALID_CATEGORIES.includes(category) ? category : 'portrait';
    const [r] = await pool.query(
      `INSERT INTO photo_services (category, title, description, price_note, gallery, link_url, link_label, sort_order, is_active)
       VALUES (?,?,?,?,?,?,?,?,1)`,
      [cat, title.trim(), description || null, price_note || null, toGalleryJson(gallery),
       link_url || null, link_label || null, parseInt(sort_order) || 0]
    );
    res.json({ success: true, data: { id: r.insertId }, message: '服務已新增' });
  } catch (err) {
    res.status(500).json({ success: false, message: `新增失敗：${err.sqlMessage || err.message}` });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { category, title, description, price_note, gallery, link_url, link_label, sort_order, is_active } = req.body || {};
    if (!title) return res.status(400).json({ success: false, message: '請輸入服務名稱' });
    const cat = VALID_CATEGORIES.includes(category) ? category : 'portrait';
    const [r] = await pool.query(
      `UPDATE photo_services SET category=?, title=?, description=?, price_note=?, gallery=?,
              link_url=?, link_label=?, sort_order=?, is_active=?
       WHERE id=?`,
      [cat, title.trim(), description || null, price_note || null, toGalleryJson(gallery),
       link_url || null, link_label || null, parseInt(sort_order) || 0, is_active ? 1 : 0, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ success: false, message: '找不到此服務' });
    res.json({ success: true, message: '已更新' });
  } catch (err) {
    res.status(500).json({ success: false, message: `更新失敗：${err.sqlMessage || err.message}` });
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const [r] = await pool.query('DELETE FROM photo_services WHERE id=?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ success: false, message: '找不到此服務' });
    res.json({ success: true, message: '已刪除' });
  } catch (err) { next(err); }
});

module.exports = router;
