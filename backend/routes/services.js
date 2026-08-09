/**
 * 公開：攝影服務 API
 * GET /api/services  取得啟用中的攝影服務 + 合作攝影師
 */
const router   = require('express').Router();
const { pool } = require('../config/database');

function parseJson(v, fallback) {
  try { return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}

router.get('/', async (req, res) => {
  try {
    const [services] = await pool.query(
      `SELECT id, category, title, description, price_note, gallery, link_url, link_label
       FROM photo_services WHERE is_active = 1
       ORDER BY sort_order ASC, id ASC`
    );
    services.forEach(s => { s.gallery = parseJson(s.gallery, []); });

    const [photographers] = await pool.query(
      `SELECT id, name, specialty, avatar_url, portfolio_url, note
       FROM photographers WHERE is_active = 1
       ORDER BY sort_order ASC, id ASC`
    );

    res.json({ success: true, data: { services, photographers } });
  } catch (err) {
    // 資料表尚未建立時回傳空資料，避免前台報錯
    res.json({ success: true, data: { services: [], photographers: [] } });
  }
});

module.exports = router;
