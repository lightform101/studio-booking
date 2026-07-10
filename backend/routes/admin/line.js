/**
 * 後台：LINE 通知管理
 * GET  /api/admin/line/contacts        取得已加好友的 LINE 聯絡人
 * PUT  /api/admin/line/contacts/:id     設定是否為通知對象
 * POST /api/admin/line/test             發送測試推播給通知對象
 */
const router   = require('express').Router();
const auth     = require('../../middleware/auth');
const { pool } = require('../../config/database');
const LineSvc  = require('../../services/lineService');

router.use(auth);

// 聯絡人清單
router.get('/contacts', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, user_id, display_name, notify_enabled, created_at FROM line_contacts ORDER BY notify_enabled DESC, id DESC'
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    // 資料表未就緒
    res.json({ success: true, data: [] });
  }
});

// 設定通知對象開關
router.put('/contacts/:id', async (req, res, next) => {
  try {
    const enabled = req.body.notify_enabled ? 1 : 0;
    const [r] = await pool.query('UPDATE line_contacts SET notify_enabled=? WHERE id=?', [enabled, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ success: false, message: '找不到此聯絡人' });
    res.json({ success: true, message: enabled ? '已設為通知對象' : '已取消通知' });
  } catch (err) { next(err); }
});

// 測試推播
router.post('/test', async (req, res) => {
  try {
    const result = await LineSvc.pushToOwners('🔔 這是一則測試通知！\n若您收到這則訊息，代表 LINE 通知已設定成功。');
    if (result.skipped) return res.json({ success: false, message: `未發送：${result.skipped}` });
    res.json({ success: true, message: `已發送給 ${result.sent}/${result.total} 位通知對象` });
  } catch (err) {
    res.status(500).json({ success: false, message: `測試失敗：${err.message}` });
  }
});

module.exports = router;
