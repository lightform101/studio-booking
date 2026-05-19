/**
 * 後台優惠方案管理 API
 * GET    /api/admin/promotions        取得所有優惠
 * POST   /api/admin/promotions        新增優惠
 * PUT    /api/admin/promotions/:id    更新優惠
 * DELETE /api/admin/promotions/:id    刪除優惠
 */
const router   = require('express').Router();
const { pool } = require('../../config/database');
const verifyToken = require('../../middleware/auth');

router.use(verifyToken);

// 取得所有優惠（含場地名稱）
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, s.name AS studio_name
       FROM promotions p
       LEFT JOIN studios s ON p.studio_id = s.id
       ORDER BY p.sort_order ASC, p.id DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// 新增優惠
router.post('/', async (req, res, next) => {
  try {
    const {
      name, description, discount_type, discount_value,
      min_hours, studio_id, promo_code,
      applicable_days, start_hour, end_hour,
      valid_from, valid_to, is_active, sort_order
    } = req.body;

    if (!name)           return res.status(400).json({ success: false, message: '請輸入優惠名稱' });
    if (!discount_type)  return res.status(400).json({ success: false, message: '請選擇折扣類型' });
    if (discount_value == null) return res.status(400).json({ success: false, message: '請輸入折扣值' });

    const [result] = await pool.query(
      `INSERT INTO promotions
         (name, description, discount_type, discount_value, min_hours,
          studio_id, promo_code, applicable_days, start_hour, end_hour,
          valid_from, valid_to, is_active, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        name,
        description || null,
        discount_type,
        parseFloat(discount_value),
        parseInt(min_hours) || 1,
        studio_id ? parseInt(studio_id) : null,
        promo_code ? promo_code.trim().toUpperCase() : null,
        applicable_days || null,
        start_hour != null ? parseInt(start_hour) : null,
        end_hour   != null ? parseInt(end_hour)   : null,
        valid_from || null,
        valid_to   || null,
        is_active != null ? (is_active ? 1 : 0) : 1,
        parseInt(sort_order) || 0
      ]
    );
    res.json({ success: true, data: { id: result.insertId }, message: '優惠方案已新增' });
  } catch (err) { next(err); }
});

// 更新優惠
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      name, description, discount_type, discount_value,
      min_hours, studio_id, promo_code,
      applicable_days, start_hour, end_hour,
      valid_from, valid_to, is_active, sort_order
    } = req.body;

    if (!name)          return res.status(400).json({ success: false, message: '請輸入優惠名稱' });
    if (!discount_type) return res.status(400).json({ success: false, message: '請選擇折扣類型' });

    const [result] = await pool.query(
      `UPDATE promotions SET
         name=?, description=?, discount_type=?, discount_value=?, min_hours=?,
         studio_id=?, promo_code=?, applicable_days=?, start_hour=?, end_hour=?,
         valid_from=?, valid_to=?, is_active=?, sort_order=?
       WHERE id=?`,
      [
        name,
        description || null,
        discount_type,
        parseFloat(discount_value),
        parseInt(min_hours) || 1,
        studio_id ? parseInt(studio_id) : null,
        promo_code ? promo_code.trim().toUpperCase() : null,
        applicable_days || null,
        start_hour != null ? parseInt(start_hour) : null,
        end_hour   != null ? parseInt(end_hour)   : null,
        valid_from || null,
        valid_to   || null,
        is_active ? 1 : 0,
        parseInt(sort_order) || 0,
        id
      ]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ success: false, message: '找不到此優惠方案' });
    res.json({ success: true, message: '優惠方案已更新' });
  } catch (err) { next(err); }
});

// 刪除優惠
router.delete('/:id', async (req, res, next) => {
  try {
    const [result] = await pool.query('DELETE FROM promotions WHERE id=?', [req.params.id]);
    if (result.affectedRows === 0)
      return res.status(404).json({ success: false, message: '找不到此優惠方案' });
    res.json({ success: true, message: '優惠方案已刪除' });
  } catch (err) { next(err); }
});

module.exports = router;
