/**
 * 公開：商品 API（二手傢俱出清／優選好物）
 * GET /api/shop  取得啟用中的商品
 */
const router   = require('express').Router();
const { pool } = require('../config/database');

router.get('/', async (req, res) => {
  try {
    const [items] = await pool.query(
      `SELECT id, category, title, description, price, original_price,
              images, condition_note, status
       FROM shop_items WHERE is_active = 1
       ORDER BY sort_order ASC, id DESC`
    );
    items.forEach(i => {
      try { i.images = i.images ? JSON.parse(i.images) : []; } catch { i.images = []; }
    });
    res.json({ success: true, data: items });
  } catch (err) {
    res.json({ success: true, data: [] });
  }
});

module.exports = router;
