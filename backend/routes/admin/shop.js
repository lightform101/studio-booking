/**
 * 後台：商品管理（二手傢俱出清／優選好物）
 * GET/POST /api/admin/shop     PUT/DELETE /api/admin/shop/:id
 * 圖片一律外連網址，不上傳檔案
 */
const router   = require('express').Router();
const auth     = require('../../middleware/auth');
const { pool } = require('../../config/database');

const VALID_CATEGORIES = ['furniture', 'goods'];
const VALID_STATUS     = ['available', 'reserved', 'sold'];

router.use(auth);

// 圖片：接受陣列或「一行一個網址」的文字，只保留 http(s) 開頭
function toImagesJson(input) {
  let arr = [];
  if (Array.isArray(input)) arr = input;
  else if (typeof input === 'string' && input.trim()) {
    arr = input.split(/\r?\n|,/).map(s => s.trim()).filter(Boolean);
  }
  arr = arr.filter(u => /^https?:\/\//i.test(u));
  return arr.length ? JSON.stringify(arr) : null;
}
const toIntOrNull = v => (v === '' || v === null || v === undefined) ? null : parseInt(v);

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM shop_items ORDER BY sort_order ASC, id DESC');
    rows.forEach(r => { try { r.images = r.images ? JSON.parse(r.images) : []; } catch { r.images = []; } });
    res.json({ success: true, data: rows });
  } catch (err) { res.json({ success: true, data: [] }); }
});

router.post('/', async (req, res) => {
  try {
    const { category, title, description, price, original_price, images,
            condition_note, status, sort_order } = req.body || {};
    if (!title) return res.status(400).json({ success: false, message: '請輸入商品名稱' });
    const cat = VALID_CATEGORIES.includes(category) ? category : 'furniture';
    const st  = VALID_STATUS.includes(status) ? status : 'available';
    const [r] = await pool.query(
      `INSERT INTO shop_items
         (category, title, description, price, original_price, images, condition_note, status, sort_order, is_active)
       VALUES (?,?,?,?,?,?,?,?,?,1)`,
      [cat, title.trim(), description || null, toIntOrNull(price), toIntOrNull(original_price),
       toImagesJson(images), condition_note || null, st, parseInt(sort_order) || 0]
    );
    res.json({ success: true, data: { id: r.insertId }, message: '商品已新增' });
  } catch (err) {
    res.status(500).json({ success: false, message: `新增失敗：${err.sqlMessage || err.message}` });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { category, title, description, price, original_price, images,
            condition_note, status, sort_order, is_active } = req.body || {};
    if (!title) return res.status(400).json({ success: false, message: '請輸入商品名稱' });
    const cat = VALID_CATEGORIES.includes(category) ? category : 'furniture';
    const st  = VALID_STATUS.includes(status) ? status : 'available';
    const [r] = await pool.query(
      `UPDATE shop_items SET category=?, title=?, description=?, price=?, original_price=?,
              images=?, condition_note=?, status=?, sort_order=?, is_active=?
       WHERE id=?`,
      [cat, title.trim(), description || null, toIntOrNull(price), toIntOrNull(original_price),
       toImagesJson(images), condition_note || null, st, parseInt(sort_order) || 0,
       is_active ? 1 : 0, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ success: false, message: '找不到此商品' });
    res.json({ success: true, message: '已更新' });
  } catch (err) {
    res.status(500).json({ success: false, message: `更新失敗：${err.sqlMessage || err.message}` });
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const [r] = await pool.query('DELETE FROM shop_items WHERE id=?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ success: false, message: '找不到此商品' });
    res.json({ success: true, message: '已刪除' });
  } catch (err) { next(err); }
});

module.exports = router;
