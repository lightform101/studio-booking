/**
 * 公開：活動專區 API
 * GET /api/events  取得目前啟用的活動（前台用）
 */
const router   = require('express').Router();
const { pool } = require('../config/database');

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, category, description, image_url, gallery, video_url,
              event_date, date_note, capacity, price, link_url, link_label
       FROM events
       WHERE is_active = 1
       ORDER BY sort_order ASC, id DESC`
    );
    // gallery 由 JSON 字串轉為陣列
    rows.forEach(r => { try { r.gallery = r.gallery ? JSON.parse(r.gallery) : []; } catch { r.gallery = []; } });
    res.json({ success: true, data: rows });
  } catch (err) {
    // 資料表尚未建立時回傳空陣列，避免前台報錯
    res.json({ success: true, data: [] });
  }
});

module.exports = router;
