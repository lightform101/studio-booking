/**
 * 後台：預約管理 Routes
 */
const router       = require('express').Router();
const auth         = require('../../middleware/auth');
const BookingModel = require('../../models/BookingModel');
const NotifySvc    = require('../../services/notifyService');
const NewebPaySvc  = require('../../services/newebpayService');
const TTLockSvc    = require('../../services/ttlockService');
const EmailService = require('../../services/emailService');
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

    const booking = await BookingModel.create({
      studio_id: +studio_id, contact_name, contact_phone,
      contact_email: contact_email || null,
      booking_date, start_time, end_time,
      duration_hours: hours,
      unit_price: unitPrice,
      total_amount: amount,
      purpose: purpose || null,
      note: note || null,
    });

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

    // 若狀態改為 confirmed 且有付款方式，一併更新 payment_at
    if (body.status === 'confirmed' && body.payment_method && booking.status !== 'confirmed') {
      await pool.query(
        `UPDATE bookings SET payment_at=NOW() WHERE id=? AND payment_at IS NULL`,
        [req.params.id]
      );
    }
    const updated = await BookingModel.update(req.params.id, body);

    // ── TTLock：狀態首次改為 confirmed 時建立臨時密碼 ──
    if (body.status === 'confirmed' && booking.status !== 'confirmed') {
      try {
        // 取得該場地的 lock_id
        const [[studio]] = await pool.query(
          'SELECT ttlock_lock_id, name FROM studios WHERE id = ?', [updated.studio_id]
        );
        const lockId = studio?.ttlock_lock_id;

        if (lockId) {
          const dateStr   = dayjs(updated.booking_date).format('YYYY-MM-DD');
          // 開始前 15 分鐘、結束後 15 分鐘
          const startDate = dayjs(`${dateStr} ${String(updated.start_time).slice(0,5)}`).subtract(15,'minute').valueOf();
          const endDate   = dayjs(`${dateStr} ${String(updated.end_time).slice(0,5)}`).add(15,'minute').valueOf();

          const { passcode, passkeyId } = await TTLockSvc.createPasscode({
            lockId,
            name: `${updated.booking_no} ${updated.contact_name}`,
            startDate,
            endDate,
          });

          // 存入訂單
          await pool.query(
            'UPDATE bookings SET ttlock_passcode=?, ttlock_passcode_id=? WHERE id=?',
            [passcode, passkeyId, updated.id]
          );
          updated.ttlock_passcode    = passcode;
          updated.ttlock_passcode_id = passkeyId;

          // 寄送進門密碼 Email
          await EmailService.sendAccessCode({ ...updated, studio_name: studio.name }, passcode);
          console.log(`[Booking] TTLock 密碼已建立並寄出 → 訂單 ${updated.booking_no}`);
        } else {
          console.warn(`[Booking] 場地 ${updated.studio_id} 尚未設定 ttlock_lock_id，略過`);
        }
      } catch (e) {
        // TTLock 失敗不影響主流程，僅記錄
        console.error('[Booking] TTLock 建立密碼失敗:', e.message);
      }
    }

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

    // ── TTLock：取消時刪除臨時密碼 ──
    if (booking.ttlock_passcode_id && booking.studio_id) {
      try {
        const [[studio]] = await pool.query(
          'SELECT ttlock_lock_id FROM studios WHERE id = ?', [booking.studio_id]
        );
        if (studio?.ttlock_lock_id) {
          await TTLockSvc.deletePasscode({
            lockId:        studio.ttlock_lock_id,
            keyboardPwdId: booking.ttlock_passcode_id,
          });
        }
      } catch (e) {
        console.error('[Booking] TTLock 刪除密碼失敗:', e.message);
      }
    }

    res.json({ success: true, message: '預約已取消', data: { refund_amount } });
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

module.exports = router;
