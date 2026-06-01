/**
 * 前台：預約 Routes
 * POST /api/bookings          建立預約
 * GET  /api/bookings/:no      查詢預約
 * POST /api/bookings/:no/cancel  取消預約
 */
const router        = require('express').Router();
const rateLimit     = require('express-rate-limit');
const BookingModel  = require('../models/BookingModel');
const StudioModel   = require('../models/StudioModel');
const NewebPaySvc   = require('../services/newebpayService');
const NotifySvc     = require('../services/notifyService');
const { validateSlot } = require('../services/bookingValidation');
const { bookingRules, validate } = require('../middleware/validation');
const dayjs         = require('dayjs');

// 建立預約專用速率限制（每小時 10 次/IP），僅套用在 POST /
// 查詢與取消不受此限，避免客戶被自己的查詢次數鎖住而無法取消自己的預約
const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { success: false, message: '預約請求過於頻繁，請稍後再試' }
});

// 各用途加價設定（可日後移入資料庫設定）
const PURPOSE_RATES = {
  '影片拍攝': 1200,   // 影片拍攝費率 NT$/hr
};

// ─── 建立預約 ────────────────────────────────────────
router.post('/', createLimiter, bookingRules, validate, async (req, res, next) => {
  try {
    const { studio_id, booking_date, start_time, duration_hours,
            payment_method, purpose } = req.body;

    // 驗證場地存在
    const studio = await StudioModel.findById(studio_id);
    if (!studio) return res.status(404).json({ success: false, message: '找不到此場地' });

    // 計算結束時間（支援半小時等非整數時長）
    const end_time = dayjs(`2000-01-01 ${start_time}`)
      .add(Math.round(parseFloat(duration_hours) * 60), 'minute')
      .format('HH:mm');

    // 依用途決定費率（影片拍攝等特殊用途可有不同費率）
    const purposeRate = PURPOSE_RATES[purpose] || 0;
    const unit_price  = Math.max(studio.hourly_rate, purposeRate);
    let total_amount = Math.round(unit_price * parseFloat(duration_hours));

    // 驗證營業時間、封鎖日期、min/max_hours
    const check = await validateSlot({ studio_id, booking_date, start_time, end_time, duration_hours: parseFloat(duration_hours) });
    if (!check.valid) return res.status(422).json({ success: false, message: check.message });

    // 驗證並套用優惠碼
    let promo_id = null;
    let discount_amount = 0;
    const { promo_code } = req.body;
    if (promo_code) {
      const { pool } = require('../config/database');
      const today = new Date().toISOString().slice(0, 10);
      const [[promo]] = await pool.query(
        `SELECT * FROM promotions
         WHERE promo_code = ? AND is_active = 1
           AND (valid_from IS NULL OR valid_from <= ?)
           AND (valid_to   IS NULL OR valid_to   >= ?)`,
        [promo_code.trim().toUpperCase(), today, today]
      );
      if (!promo) {
        return res.status(400).json({ success: false, message: '優惠碼無效或已過期' });
      }
      if (promo.studio_id && promo.studio_id !== parseInt(studio_id)) {
        return res.status(400).json({ success: false, message: '此優惠碼不適用於所選場地' });
      }
      if (promo.min_hours && parseFloat(duration_hours) < promo.min_hours) {
        return res.status(400).json({ success: false, message: `此優惠需預約至少 ${promo.min_hours} 小時` });
      }
      promo_id = promo.id;
      if (promo.discount_type === 'percent') {
        discount_amount = Math.round(total_amount * promo.discount_value / 100);
      } else if (promo.discount_type === 'fixed') {
        discount_amount = Math.min(promo.discount_value, total_amount);
      } else if (promo.discount_type === 'schedule') {
        // schedule 類型：依星期 + 時段決定是否適用，折扣值為百分比
        const bookingDay       = new Date(booking_date).getDay(); // 0=週日
        const bookingStartHour = parseInt(start_time.split(':')[0]);
        let applies = true;
        if (promo.applicable_days) {
          const days = JSON.parse(promo.applicable_days);
          if (!days.includes(bookingDay)) applies = false;
        }
        if (applies && promo.start_hour !== null && promo.end_hour !== null) {
          if (bookingStartHour < promo.start_hour || bookingStartHour >= promo.end_hour)
            applies = false;
        }
        if (!applies) {
          return res.status(400).json({ success: false, message: '此優惠不適用於所選時段或星期' });
        }
        discount_amount = Math.round(total_amount * promo.discount_value / 100);
      }
      total_amount = total_amount - discount_amount;
    }

    // 建立預約（含 transaction + SELECT FOR UPDATE 防並發衝突）
    let booking;
    try {
      booking = await BookingModel.createWithLock({
        ...req.body, end_time, unit_price, total_amount, promo_id, discount_amount
      });
    } catch (e) {
      if (e.code === 'CONFLICT') {
        return res.status(409).json({ success: false, message: e.message });
      }
      throw e;
    }

    // 產生付款連結（外部服務失敗不影響預約建立）
    let paymentUrl = null;
    try {
      if (!payment_method || payment_method !== 'linepay') {
        // 藍新：回傳自動提交表單的中介頁面 URL（需 GET 即可跳轉）
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        paymentUrl = `${baseUrl}/api/payment/newebpay/form/${booking.booking_no}`;
      } else {
        const LinePaySvc = require('../services/linepayService');
        const { paymentUrl: lp } = await LinePaySvc.requestPayment(booking);
        paymentUrl = lp;
      }
    } catch(e) {
      console.warn('⚠️  付款連結產生失敗（外部服務未設定）:', e.message);
    }

    // 發送通知（失敗不影響預約）
    try { await NotifySvc.send('payment_pending', booking); } catch(e) {}

    // 依實際付款截止時間動態產生提示文字（避免與設定的鎖定時間不一致）
    const hoursLeft = Math.max(1, Math.round(dayjs(booking.payment_expire).diff(dayjs(), 'hour')));
    res.status(201).json({
      success: true,
      message: `預約建立成功，請於 ${hoursLeft} 小時內完成付款`,
      data: {
        booking_no:     booking.booking_no,
        studio_name:    studio.name,
        booking_date,
        start_time,
        end_time,
        duration_hours: parseFloat(duration_hours),
        unit_price,
        total_amount:   booking.total_amount,
        payment_expire: booking.payment_expire,
        payment_url:    paymentUrl
      }
    });
  } catch (err) { next(err); }
});

// 前台查詢允許回傳的欄位白名單（排除 admin_note、ttlock、payment_ref 等內部欄位）
const BOOKING_PUBLIC_FIELDS = new Set([
  'id','booking_no','studio_id','studio_name','studio_name_en',
  'contact_name','contact_phone','contact_email',
  'booking_date','start_time','end_time','duration_hours',
  'unit_price','total_amount','discount_amount','promo_id',
  'purpose','note','status',
  'payment_method','payment_expire',
  'need_invoice','invoice_type','invoice_carrier','invoice_donate',
  'refund_amount','cancel_reason',
  'created_at',
]);

// ─── 查詢預約 ────────────────────────────────────────
router.get('/:no', async (req, res, next) => {
  try {
    const booking = await BookingModel.findByNo(req.params.no);
    if (!booking) return res.status(404).json({ success: false, message: '找不到此預約' });

    // 身份驗證：需提供電話末 4 碼（與取消一致）
    const phone  = String(req.query.phone || '').replace(/\D/g, '');
    const stored = String(booking.contact_phone || '').replace(/\D/g, '');
    if (!phone || phone.slice(-4) !== stored.slice(-4)) {
      return res.status(403).json({ success: false, message: '電話號碼末 4 碼不符' });
    }

    // 只回傳白名單欄位
    const data = Object.fromEntries(
      Object.entries(booking).filter(([k]) => BOOKING_PUBLIC_FIELDS.has(k))
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// ─── 取消預約（客戶）────────────────────────────────
router.post('/:no/cancel', async (req, res, next) => {
  try {
    const booking = await BookingModel.findByNo(req.params.no);
    if (!booking) return res.status(404).json({ success: false, message: '找不到此預約' });
    if (!['pending_payment','confirmed'].includes(booking.status)) {
      return res.status(400).json({ success: false, message: '此預約無法取消' });
    }

    // 身份驗證：確認末 4 碼電話號碼，防止訂單號外洩時他人取消
    const phone = String(req.body.contact_phone || '').replace(/\D/g, '');
    const stored = String(booking.contact_phone || '').replace(/\D/g, '');
    if (!phone || phone.slice(-4) !== stored.slice(-4)) {
      return res.status(403).json({ success: false, message: '電話號碼末 4 碼不符，無法取消' });
    }

    // 計算退款
    const bookingDt = dayjs(`${booking.booking_date} ${booking.start_time}`);
    const hoursUntil = bookingDt.diff(dayjs(), 'hour');
    let refund_amount = 0;
    let refund_trade_no = null;

    if (booking.status === 'confirmed') {
      if (hoursUntil >= 48) refund_amount = booking.total_amount;
      else if (hoursUntil >= 24) refund_amount = booking.total_amount * 0.5;

      // 執行退款
      if (refund_amount > 0) {
        const NewebPaySvc = require('../services/newebpayService');
        const refundResult = await NewebPaySvc.refund(booking, refund_amount);
        refund_trade_no = refundResult.trade_no;
      }
    }

    const updated = await BookingModel.cancel(booking.booking_no, {
      cancel_reason:  req.body.cancel_reason || '客戶主動取消',
      cancelled_by:   'customer',
      refund_amount,
      refund_trade_no
    });

    await NotifySvc.send('booking_cancelled', updated);

    res.json({
      success: true,
      message: refund_amount > 0
        ? `預約已取消，將退款 NT$ ${refund_amount}`
        : '預約已取消',
      data: { booking_no: booking.booking_no, refund_amount }
    });
  } catch (err) { next(err); }
});

module.exports = router;
