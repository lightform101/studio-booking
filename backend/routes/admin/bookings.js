/**
 * 後台：預約管理 Routes
 */
const router       = require('express').Router();
const auth         = require('../../middleware/auth');
const auditLog     = require('../../middleware/auditLog');
const BookingModel = require('../../models/BookingModel');
const NotifySvc    = require('../../services/notifyService');
const NewebPaySvc  = require('../../services/newebpayService');
const TTLockSvc    = require('../../services/ttlockService');
const EmailService = require('../../services/emailService');
const InvoiceSvc   = require('../../services/invoiceService');
const GoogleCalSvc = require('../../services/googleCalendarService');
const { validateSlot } = require('../../services/bookingValidation');
const { pool }     = require('../../config/database');
const dayjs        = require('dayjs');

router.use(auth);

// 列表（含篩選/分頁）
router.get('/', async (req, res, next) => {
  try {
    const { studio_id, status, date_from, date_to, search,
            page = 1, limit = 20 } = req.query;
    const result = await BookingModel.findAll({
      studio_id, status, date_from, date_to, search,
      page: parseInt(page), limit: parseInt(limit)
    });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// 儀表板統計
router.get('/dashboard', async (req, res, next) => {
  try {
    const stats = await BookingModel.getDashboardStats();
    res.json({ success: true, data: stats });
  } catch (err) { next(err); }
});

// 單筆詳情
router.get('/:id', async (req, res, next) => {
  try {
    const booking = await BookingModel.findById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: '找不到此預約' });
    res.json({ success: true, data: booking });
  } catch (err) { next(err); }
});

// 手動新增預約（後台）
router.post('/', async (req, res, next) => {
  try {
    const {
      studio_id, contact_name, contact_phone, contact_email,
      booking_date, start_time, end_time, duration_hours,
      purpose, note, admin_note, total_amount, status
    } = req.body;
    // payment_method 只接受合法的 ENUM 值，空字串轉 null
    const VALID_PM = ['credit','atm','cvs','linepay'];
    const payment_method = VALID_PM.includes(req.body.payment_method) ? req.body.payment_method : null;

    if (!studio_id || !contact_name || !contact_phone || !booking_date || !start_time || !end_time)
      return res.status(400).json({ success: false, message: '請填入必要欄位（場地、姓名、電話、日期、時段）' });

    // 取得場地費率
    const [[studio]] = await pool.query('SELECT hourly_rate FROM studios WHERE id=?', [studio_id]);
    if (!studio) return res.status(400).json({ success: false, message: '找不到此場地' });

    const hours    = +duration_hours || dayjs(`2000-01-01 ${end_time}`).diff(dayjs(`2000-01-01 ${start_time}`), 'hour');
    const unitPrice = studio.hourly_rate;
    const amount   = total_amount != null && total_amount !== '' ? +total_amount : unitPrice * hours;

    // 驗證營業時間、封鎖日期、min/max_hours
    const check = await validateSlot({ studio_id: +studio_id, booking_date, start_time, end_time, duration_hours: hours });
    if (!check.valid)
      return res.status(422).json({ success: false, message: check.message });

    // 含 transaction + FOR UPDATE 防衝突
    let booking;
    try {
      booking = await BookingModel.createWithLock({
        studio_id: +studio_id, contact_name, contact_phone,
        contact_email: contact_email || null,
        booking_date, start_time, end_time,
        duration_hours: hours,
        unit_price: unitPrice,
        total_amount: amount,
        purpose: purpose || null,
        note: note || null,
      });
    } catch (e) {
      if (e.code === 'CONFLICT')
        return res.status(409).json({ success: false, message: e.message });
      throw e;
    }

    // 若已指定付款方式，直接設為已確認；否則沿用前端傳來的 status
    const VALID_STATUS = ['pending_payment','confirmed','completed','cancelled'];
    const finalStatus = VALID_STATUS.includes(status) ? status
                        : (payment_method ? 'confirmed' : 'pending_payment');

    if (payment_method) {
      await pool.query(
        `UPDATE bookings SET status='confirmed', payment_method=?, payment_at=NOW() WHERE id=?`,
        [payment_method, booking.id]
      );
    } else if (finalStatus !== 'pending_payment') {
      await pool.query(`UPDATE bookings SET status=? WHERE id=?`, [finalStatus, booking.id]);
    }
    if (admin_note) await pool.query(`UPDATE bookings SET admin_note=? WHERE id=?`, [admin_note, booking.id]);

    const created = await BookingModel.findById(booking.id);

    // ── Google Calendar：後台直接新增且已確認的預約，同步行事曆（失敗不阻斷）──
    if (created.status === 'confirmed') {
      try {
        await GoogleCalSvc.createEvent(created);
      } catch (e) {
        console.warn('[GoogleCal] 後台新增預約同步失敗:', e.message);
      }
    }

    // ── LINE：推播新預約通知給管理員（失敗不阻斷）──
    try {
      const LineSvc = require('../../services/lineService');
      await LineSvc.pushToOwners(LineSvc.buildBookingAlert(created));
    } catch (e) { console.warn('[LINE] 後台新增預約通知失敗:', e.message); }

    await auditLog(req, 'create', 'booking', created.booking_no, `新增預約 ${created.contact_name} ${created.booking_date}`);
    res.status(201).json({ success: true, data: created, message: `預約 ${created.booking_no} 已建立` });
  } catch (err) { next(err); }
});

// 後台編輯預約
router.put('/:id', async (req, res, next) => {
  try {
    const booking = await BookingModel.findById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: '找不到此預約' });

    // 清理 ENUM 欄位：空字串 → null，不合法值也轉 null
    const VALID_PM = ['credit','atm','cvs','linepay'];
    const VALID_ST = ['pending_payment','confirmed','completed','cancelled'];
    const body = { ...req.body };
    if ('payment_method' in body)
      body.payment_method = VALID_PM.includes(body.payment_method) ? body.payment_method : null;
    if ('status' in body && !VALID_ST.includes(body.status)) delete body.status;

    // 若時段或場地有異動，重新驗證並檢查衝突
    const timeFields = ['studio_id','booking_date','start_time','end_time','duration_hours'];
    const timeChanged = timeFields.some(f => body[f] !== undefined && String(body[f]) !== String(booking[f]));
    if (timeChanged) {
      const newStudioId     = body.studio_id     ?? booking.studio_id;
      const newBookingDate  = body.booking_date  ?? booking.booking_date;
      const newStartTime    = body.start_time    ?? booking.start_time;
      const newEndTime      = body.end_time      ?? booking.end_time;
      const newDuration     = body.duration_hours ?? booking.duration_hours;

      const check = await validateSlot({
        studio_id: +newStudioId, booking_date: newBookingDate,
        start_time: newStartTime, end_time: newEndTime,
        duration_hours: +newDuration
      });
      if (!check.valid)
        return res.status(422).json({ success: false, message: check.message });

      // 衝突檢查（排除自身）
      const startH = parseInt(String(newStartTime).split(':')[0]);
      const endH   = parseInt(String(newEndTime).split(':')[0]);
      const [conflicts] = await pool.query(
        `SELECT id FROM bookings
         WHERE studio_id=? AND booking_date=? AND id != ?
         AND status IN ('pending_payment','confirmed')
         AND NOT (end_time <= ? OR start_time >= ?)`,
        [newStudioId, newBookingDate, req.params.id,
         `${String(endH).padStart(2,'0')}:00`, `${String(startH).padStart(2,'0')}:00`]
      );
      if (conflicts.length)
        return res.status(409).json({ success: false, message: '所選時段已有其他預約，請調整時間' });
    }

    // 若狀態改為 confirmed，一併更新 payment_at（不強制要求 payment_method）
    if (body.status === 'confirmed' && booking.status !== 'confirmed') {
      await pool.query(
        `UPDATE bookings SET payment_at=NOW() WHERE id=? AND payment_at IS NULL`,
        [req.params.id]
      );
    }
    const updated = await BookingModel.update(req.params.id, body);

    // ── TTLock 密碼管理 ──
    const wasConfirmed   = booking.status === 'confirmed';
    const nowConfirmed   = updated.status === 'confirmed';
    const slotChanged    = ['booking_date','start_time','end_time','studio_id']
      .some(f => body[f] !== undefined && String(body[f]) !== String(booking[f]));

    if (nowConfirmed && !wasConfirmed) {
      // 狀態首次改為 confirmed → 建立門鎖密碼（TTLock 內部會寄發進門碼 Email）
      try {
        await TTLockSvc.createTTLockForBooking(updated);
      } catch (e) {
        console.error('[Booking] TTLock 建立密碼失敗:', e.message);
      }
      // 發送預約確認通知（Email + SMS）
      try {
        await NotifySvc.send('booking_confirmed', updated);
      } catch (e) {
        console.error('[Booking] 確認通知發送失敗:', e.message);
      }
    } else if (nowConfirmed && wasConfirmed && slotChanged) {
      // 已 confirmed 但時段/場地變更 → 刪除舊密碼再建立新密碼
      try {
        await TTLockSvc.deleteTTLockForBooking(booking);
        console.log(`[Booking] TTLock 舊密碼已刪除 → 訂單 ${booking.booking_no}`);
      } catch (e) {
        console.error('[Booking] TTLock 刪除舊密碼失敗:', e.message);
      }
      try {
        // 重新查詢以取得最新時段資訊
        const refreshed = await BookingModel.findById(updated.id);
        await TTLockSvc.createTTLockForBooking(refreshed);
      } catch (e) {
        console.error('[Booking] TTLock 重建密碼失敗:', e.message);
      }
    }

    // ── Google Calendar：已確認的預約同步行事曆 ──
    if (updated.status === 'confirmed') {
      try {
        if (booking.status !== 'confirmed') {
          // 首次確認 → 建立事件
          await GoogleCalSvc.createEvent({ ...updated, studio_name: updated.studio_name || booking.studio_name });
        } else {
          // 已是確認狀態，有修改時間/內容 → 更新事件
          await GoogleCalSvc.updateEvent({ ...updated, studio_name: updated.studio_name || booking.studio_name });
        }
      } catch (e) { console.error('[GoogleCal] 同步失敗:', e.message); }
    }

    await auditLog(req, 'update', 'booking', updated.booking_no, `狀態: ${booking.status}→${updated.status}`);
    res.json({ success: true, data: updated, message: '預約已更新' });
  } catch (err) { next(err); }
});

// 更新備注
router.patch('/:id/note', async (req, res, next) => {
  try {
    await BookingModel.updateAdminNote(req.params.id, req.body.admin_note);
    res.json({ success: true, message: '備注已更新' });
  } catch (err) { next(err); }
});

// 後台取消預約
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const booking = await BookingModel.findById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: '找不到此預約' });
    if (!['pending_payment','confirmed'].includes(booking.status)) {
      return res.status(400).json({ success: false, message: '此預約無法取消' });
    }

    const { cancel_reason, refund_type } = req.body;
    let refund_amount = 0, refund_trade_no = null;

    if (booking.status === 'confirmed' && refund_type !== 'none') {
      if (refund_type === 'full')
        refund_amount = booking.total_amount;
      else if (refund_type === 'half')
        refund_amount = booking.total_amount * 0.5;
      else {
        // 依退款政策自動計算
        const hoursUntil = dayjs(`${booking.booking_date} ${booking.start_time}`).diff(dayjs(), 'hour');
        if (hoursUntil >= 48)      refund_amount = booking.total_amount;
        else if (hoursUntil >= 24) refund_amount = booking.total_amount * 0.5;
      }
      if (refund_amount > 0) {
        const refund = await NewebPaySvc.refund(booking, refund_amount);
        refund_trade_no = refund.trade_no;
      }
    }

    const updated = await BookingModel.cancel(booking.booking_no, {
      cancel_reason: cancel_reason || '後台管理員取消',
      cancelled_by: 'admin', refund_amount, refund_trade_no
    });
    await NotifySvc.send('booking_cancelled', updated);

    // ── Google Calendar：刪除行事曆事件 ──
    try { await GoogleCalSvc.deleteEvent(booking); }
    catch (e) { console.error('[GoogleCal] 刪除事件失敗:', e.message); }

    // ── TTLock：取消時刪除臨時密碼 ──
    let ttlockWarning = null;
    if (booking.ttlock_passcode_id) {
      try {
        await TTLockSvc.deleteTTLockForBooking(booking);
      } catch (e) {
        console.error('[Booking] TTLock 刪除密碼失敗:', e.message);
        ttlockWarning = '門鎖密碼刪除失敗，請至 TTLock 後台手動確認並刪除';
      }
    }

    await auditLog(req, 'cancel', 'booking', booking.booking_no, `退款: ${refund_amount} 原因: ${cancel_reason || '後台取消'}`);
    res.json({
      success: true,
      message: '預約已取消',
      data: { refund_amount },
      ...(ttlockWarning && { ttlock_warning: ttlockWarning }),
    });
  } catch (err) { next(err); }
});

// 重新發送通知
router.post('/:id/resend-notification', async (req, res, next) => {
  try {
    const booking = await BookingModel.findById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: '找不到此預約' });
    const { event = 'booking_confirmed' } = req.body;
    await NotifySvc.send(event, booking);
    res.json({ success: true, message: '通知已重新發送' });
  } catch (err) { next(err); }
});

// ─── 手動補開電子發票 ────────────────────────────────
// POST /api/admin/bookings/:id/issue-invoice
router.post('/:id/issue-invoice', async (req, res, next) => {
  try {
    const [[booking]] = await pool.query(
      `SELECT b.*, s.name AS studio_name
       FROM bookings b
       JOIN studios s ON b.studio_id = s.id
       WHERE b.id = ?`,
      [req.params.id]
    );
    if (!booking) return res.status(404).json({ success: false, message: '找不到此預約' });
    if (booking.invoice_status === 'issued') {
      return res.json({
        success: true,
        message: `發票已存在：${booking.invoice_no}`,
        invoice_no: booking.invoice_no,
        invoice_random: booking.invoice_random,
      });
    }

    // 後台若帶入發票資訊 → 先寫回預約（可補開客戶當初未勾發票的訂單）
    const body = req.body || {};
    if (body.invoice_type) {
      const VALID = ['cloud', 'personal', 'company', 'donate'];
      const type  = VALID.includes(body.invoice_type) ? body.invoice_type : 'cloud';
      const taxId   = String(body.invoice_tax_id  || '').trim();
      const carrier = String(body.invoice_carrier || '').trim();
      const company = String(body.invoice_company || '').trim();
      const donate  = String(body.invoice_donate  || '').trim();

      // 後端驗證
      if (type === 'company' && !/^\d{8}$/.test(taxId))
        return res.status(400).json({ success: false, message: '統一編號須為 8 碼數字' });
      if (type === 'personal' && carrier && !/^\/[A-Z0-9+\-.]{7}$/.test(carrier))
        return res.status(400).json({ success: false, message: '手機載具格式錯誤' });
      if (type === 'donate' && !donate)
        return res.status(400).json({ success: false, message: '請輸入捐贈碼' });

      await pool.query(
        `UPDATE bookings
         SET need_invoice=1, invoice_type=?, invoice_tax_id=?, invoice_company=?,
             invoice_carrier=?, invoice_donate=?, invoice_status='pending'
         WHERE id=?`,
        [type, taxId || null, company || null, carrier || null, donate || null, booking.id]
      );
      // 重新讀取，帶入最新發票欄位
      const [[fresh]] = await pool.query(
        `SELECT b.*, s.name AS studio_name FROM bookings b JOIN studios s ON b.studio_id=s.id WHERE b.id=?`,
        [booking.id]
      );
      Object.assign(booking, fresh);
    }

    if (!booking.need_invoice) {
      return res.status(400).json({ success: false, message: '此預約未勾選發票，請於上方選擇發票類型後再開立' });
    }

    const result = await InvoiceSvc.issue(booking);
    res.json({
      success:        true,
      message:        '發票開立成功',
      invoice_no:     result.invoice_no,
      invoice_random: result.random_number,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── 刪除已取消的預約 ──────────────────────────────────
// DELETE /api/admin/bookings/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const booking = await BookingModel.findById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: '找不到此預約' });
    if (booking.status !== 'cancelled') {
      return res.status(400).json({ success: false, message: '只能刪除已取消的預約' });
    }
    await pool.query('DELETE FROM notifications WHERE booking_id = ?', [booking.id]);
    await pool.query('DELETE FROM bookings WHERE id = ?', [booking.id]);
    await auditLog(req, 'delete', 'booking', booking.booking_no, `刪除已取消預約 ${booking.contact_name}`);
    res.json({ success: true, message: `預約 ${booking.booking_no} 已刪除` });
  } catch (err) { next(err); }
});

// ─── 批次刪除已取消的預約 ──────────────────────────────
// DELETE /api/admin/bookings（body: { ids: [1,2,3] } 或 { all_cancelled: true }）
router.delete('/', async (req, res, next) => {
  try {
    let ids = [];
    if (req.body.all_cancelled) {
      const [rows] = await pool.query(`SELECT id FROM bookings WHERE status='cancelled'`);
      ids = rows.map(r => r.id);
    } else if (Array.isArray(req.body.ids) && req.body.ids.length) {
      // 確保全是已取消狀態
      const [rows] = await pool.query(
        `SELECT id FROM bookings WHERE id IN (?) AND status='cancelled'`,
        [req.body.ids]
      );
      ids = rows.map(r => r.id);
    }
    if (!ids.length) return res.json({ success: true, message: '沒有可刪除的已取消預約', deleted: 0 });
    await pool.query('DELETE FROM notifications WHERE booking_id IN (?)', [ids]);
    await pool.query('DELETE FROM bookings WHERE id IN (?)', [ids]);
    await auditLog(req, 'delete', 'booking', 'BATCH', `批次刪除 ${ids.length} 筆已取消預約`);
    res.json({ success: true, message: `已刪除 ${ids.length} 筆取消預約`, deleted: ids.length });
  } catch (err) { next(err); }
});

module.exports = router;
