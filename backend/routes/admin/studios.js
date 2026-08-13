/**
 * 後台：場地設定 Routes
 */
const router      = require('express').Router();
const auth        = require('../../middleware/auth');
const auditLog    = require('../../middleware/auditLog');
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
    if (!Array.isArray(hours) || !hours.length)
      return res.status(400).json({ success: false, message: '請提供營業時間資料' });

    // 正規化為 HH:MM:SS
    const norm = (t, fallback) => {
      const s = String(t || '').trim();
      if (/^\d{2}:\d{2}$/.test(s))       return s + ':00';
      if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s;
      return fallback;
    };

    for (const h of hours) {
      const weekday = parseInt(h.weekday);
      if (!(weekday >= 0 && weekday <= 6))
        return res.status(400).json({ success: false, message: `星期值不正確：${h.weekday}` });

      const open  = norm(h.open_time,  '09:00:00');
      const close = norm(h.close_time, '21:00:00');
      const isOpen = h.is_open ? 1 : 0;
      if (isOpen && close <= open)
        return res.status(400).json({ success: false, message: `星期 ${weekday}：結束時間必須晚於開始時間` });

      // 先更新全場地設定（studio_id IS NULL）；若該天沒有資料列則新增
      const [r] = await pool.query(
        'UPDATE business_hours SET open_time=?, close_time=?, is_open=? WHERE weekday=? AND studio_id IS NULL',
        [open, close, isOpen, weekday]
      );
      if (r.affectedRows === 0) {
        await pool.query(
          'INSERT INTO business_hours (studio_id, weekday, open_time, close_time, is_open) VALUES (NULL,?,?,?,?)',
          [weekday, open, close, isOpen]
        );
      }
      // 同步覆寫各場地的個別設定，避免舊的場地專屬時段蓋過全場地設定
      await pool.query(
        'UPDATE business_hours SET open_time=?, close_time=?, is_open=? WHERE weekday=? AND studio_id IS NOT NULL',
        [open, close, isOpen, weekday]
      );
    }
    await auditLog(req, 'update', 'settings', 'business_hours', '更新營業時間');
    res.json({ success: true, message: '營業時間已更新' });
  } catch (err) {
    res.status(500).json({ success: false, message: `儲存失敗：${err.sqlMessage || err.message}` });
  }
});

module.exports = router;
