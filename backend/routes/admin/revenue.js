/**
 * 後台：收入報表 Routes
 */
const router            = require('express').Router();
const auth              = require('../../middleware/auth');
const requireSuperAdmin = require('../../middleware/requireSuperAdmin');
const BookingModel      = require('../../models/BookingModel');
const { pool }          = require('../../config/database');

router.use(auth);
// 收入報表：所有登入的管理員都可查看（不限 superadmin）

// 月度收入趨勢
router.get('/monthly', async (req, res, next) => {
  try {
    const months = parseInt(req.query.months) || 6;
    const rows   = await BookingModel.getMonthlyRevenue(months);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// 付款方式分佈
router.get('/payment-methods', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT payment_method, COUNT(*) AS count, SUM(total_amount) AS revenue
       FROM bookings
       WHERE status IN ('confirmed','completed') AND payment_method IS NOT NULL
       GROUP BY payment_method`
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// 本月使用率
router.get('/occupancy', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT
         studio_id,
         COUNT(*) AS booked_count,
         SUM(duration_hours) AS booked_hours
       FROM bookings
       WHERE status IN ('confirmed','completed')
         AND MONTH(booking_date)=MONTH(CURDATE())
         AND YEAR(booking_date)=YEAR(CURDATE())
       GROUP BY studio_id`
    );
    // 計算使用率（本月工作天 × 13 小時/天）
    const [[{ days }]] = await pool.query(
      `SELECT COUNT(*) AS days FROM (
         SELECT DISTINCT booking_date FROM bookings
         WHERE MONTH(booking_date)=MONTH(CURDATE())
           AND YEAR(booking_date)=YEAR(CURDATE())
       ) t`
    );
    const totalHoursPerStudio = Math.max(days, 1) * 13;
    const result = rows.map(r => ({
      ...r,
      occupancy_rate: Math.min(100, Math.round(r.booked_hours / totalHoursPerStudio * 100))
    }));
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

module.exports = router;
