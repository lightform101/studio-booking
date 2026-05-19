/**
 * 後台：場地設定 Routes
 */
const router      = require('express').Router();
const auth        = require('../../middleware/auth');
const StudioModel = require('../../models/StudioModel');
const { pool }    = require('../../config/database');

router.use(auth);

// 取得所有場地（後台，含非啟用）
router.get('/', async (req, res, next) => {
  try {
    const [studios] = await pool.query('SELECT * FROM studios ORDER BY sort_order ASC');
    for (const s of studios) {
      const [f] = await pool.query('SELECT feature FROM studio_features WHERE studio_id=?', [s.id]);
      s.features = f.map(r => r.feature);
    }
    res.json({ success: true, data: studios });
  } catch (err) { next(err); }
});

// 新增場地
router.post('/', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: '請填入場地名稱' });
    const studio = await StudioModel.create(req.body);
    res.status(201).json({ success: true, data: studio, message: `場地「${studio.name}」已建立` });
  } catch (err) { next(err); }
});

// 刪除場地
router.delete('/:id', async (req, res, next) => {
  try {
    await StudioModel.delete(req.params.id);
    res.json({ success: true, message: '場地已刪除' });
  } catch (err) {
    // 若是有效預約衝突，回傳 409
    if (err.message.includes('有效預約')) {
      return res.status(409).json({ success: false, message: err.message });
    }
    next(err);
  }
});

// 更新場地
router.put('/:id', async (req, res, next) => {
  try {
    const studio = await StudioModel.update(req.params.id, req.body);
    if (!studio) return res.status(404).json({ success: false, message: '找不到此場地' });
    res.json({ success: true, data: studio });
  } catch (err) { next(err); }
});

// 取得/更新封鎖日期
router.get('/:id/blocked-dates', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM blocked_dates WHERE studio_id=? OR studio_id IS NULL ORDER BY block_date ASC',
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

router.post('/blocked-dates', async (req, res, next) => {
  try {
    const { studio_id, block_date, start_time, end_time, reason } = req.body;
    const [result] = await pool.query(
      'INSERT INTO blocked_dates (studio_id, block_date, start_time, end_time, reason, created_by) VALUES (?,?,?,?,?,?)',
      [studio_id || null, block_date, start_time || null, end_time || null, reason, req.admin.id]
    );
    res.status(201).json({ success: true, data: { id: result.insertId } });
  } catch (err) { next(err); }
});

router.delete('/blocked-dates/:id', async (req, res, next) => {
  try {
    await pool.query('DELETE FROM blocked_dates WHERE id=?', [req.params.id]);
    res.json({ success: true, message: '已刪除封鎖日期' });
  } catch (err) { next(err); }
});

// 取得/更新營業時間
router.get('/business-hours', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM business_hours WHERE studio_id IS NULL ORDER BY weekday ASC'
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

router.put('/business-hours', async (req, res, next) => {
  try {
    const { hours } = req.body; // [{ weekday, open_time, close_time, is_open }]
    for (const h of hours) {
      await pool.query(
        'UPDATE business_hours SET open_time=?, close_time=?, is_open=? WHERE weekday=? AND studio_id IS NULL',
        [h.open_time, h.close_time, h.is_open ? 1 : 0, h.weekday]
      );
    }
    res.json({ success: true, message: '營業時間已更新' });
  } catch (err) { next(err); }
});

module.exports = router;
