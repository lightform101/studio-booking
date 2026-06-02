/**
 * 公開：首頁輪播 API
 * GET /api/carousel  取得目前啟用的輪播圖（前台用）
 */
const router   = require('express').Router();
const { pool } = require('../config/database');

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, image_url, title, link_url
       FROM carousel_slides
       WHERE is_active = 1
       ORDER BY sort_order ASC, id ASC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    // 資料表尚未建立時回傳空陣列，避免前台報錯
    res.json({ success: true, data: [] });
  }
});

module.exports = router;
