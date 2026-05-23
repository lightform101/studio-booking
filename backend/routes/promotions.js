/**
 * 公開優惠方案 API
 * GET  /api/promotions        取得目前有效的優惠清單（前台用）
 * POST /api/promotions/apply  驗證優惠碼並計算折扣
 */
const router    = require('express').Router();
const rateLimit = require('express-rate-limit');
const { pool }  = require('../config/database');

const promoApplyLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 分鐘
  max: 5,
  message: { success: false, message: '優惠碼驗證過於頻繁，請稍後再試' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 取得目前有效優惠清單（前台展示）
router.get('/', async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [rows] = await pool.query(
      `SELECT p.*, s.name AS studio_name
       FROM promotions p
       LEFT JOIN studios s ON p.studio_id = s.id
       WHERE p.is_active = 1
         AND (p.valid_from IS NULL OR p.valid_from <= ?)
         AND (p.valid_to   IS NULL OR p.valid_to   >= ?)
       ORDER BY p.sort_order ASC, p.id DESC`,
      [today, today]
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// 驗證優惠碼 + 計算折扣（預約頁用）
router.post('/apply', promoApplyLimiter, async (req, res, next) => {
  try {
    const { promo_code, studio_id, booking_date, start_hour, hours } = req.body;
    if (!promo_code) return res.status(400).json({ success: false, message: '請輸入優惠碼' });

    const today = new Date().toISOString().slice(0, 10);
    const [[promo]] = await pool.query(
      `SELECT * FROM promotions
       WHERE promo_code = ? AND is_active = 1
         AND (valid_from IS NULL OR valid_from <= ?)
         AND (valid_to   IS NULL OR valid_to   >= ?)`,
      [promo_code.trim().toUpperCase(), today, today]
    );

    if (!promo) return res.status(404).json({ success: false, message: '優惠碼無效或已過期' });

    // 場地限制
    if (promo.studio_id && promo.studio_id !== parseInt(studio_id)) {
      return res.status(400).json({ success: false, message: '此優惠碼不適用於所選場地' });
    }
    // 最少時數
    if (hours && hours < promo.min_hours) {
      return res.status(400).json({ success: false, message: `此優惠需預約至少 ${promo.min_hours} 小時` });
    }
    // schedule 類型：驗證星期 + 時段
    if (promo.discount_type === 'schedule' && booking_date && start_hour !== undefined) {
      const bookingDay = new Date(booking_date).getDay();
      const startH     = parseInt(start_hour);
      let applies = true;
      if (promo.applicable_days) {
        const days = JSON.parse(promo.applicable_days);
        if (!days.includes(bookingDay)) applies = false;
      }
      if (applies && promo.start_hour !== null && promo.end_hour !== null) {
        if (startH < promo.start_hour || startH >= promo.end_hour) applies = false;
      }
      if (!applies) {
        return res.status(400).json({ success: false, message: '此優惠不適用於所選時段或星期' });
      }
    }

    res.json({ success: true, data: promo, message: `優惠碼「${promo.name}」已套用` });
  } catch (err) { next(err); }
});

module.exports = router;
