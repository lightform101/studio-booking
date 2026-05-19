/**
 * 前台：預約 Routes
 * POST /api/bookings          建立預約
 * GET  /api/bookings/:no      查詢預約
 * POST /api/bookings/:no/cancel  取消預約
 */
const router        = require('express').Router();
const BookingModel  = require('../models/BookingModel');
const StudioModel   = require('../models/StudioModel');
const NewebPaySvc   = require('../services/newebpayService');
const NotifySvc     = require('../services/notifyService');
const { bookingRules, validate } = require('../middleware/validation');
const dayjs         = require('dayjs');

// 各用途加價設定（可日後移入資料庫設定）
const PURPOSE_RATES = {
  '影片拍攝': 1200,   // 影片拍攝費率 NT$/hr
};

// ─── 建立預約 ────────────────────────────────────────
router.post('/', bookingRules, validate, async (req, res, next) => {
  try {
    const { studio_id, booking_date, start_time, duration_hours,
            payment_method, purpose } = req.body;

    // 驗證場地存在
    const studio = await StudioModel.findById(studio_id);
    if (!studio) return res.status(404).json({ success: false, message: '找不到此場地' });

    // 計算結束時間
    const startH   = parseInt(start_time.split(':')[0]);
    const endH     = startH + parseFloat(duration_hours);
    const end_time = `${String(endH).padStart(2,'0')}:00`;

    // 依用途決定費率（影片拍攝等特殊用途可有不同費率）
    const purposeRate = PURPOSE_RATES[purpose] || 0;
    const unit_price  = Math.max(studio.hourly_rate, purposeRate);
    const total_amount = unit_price * parseFloat(duration_hours);

    // 檢查時段衝突
    const occupied = await BookingModel.findOccupiedSlots(studio_id, booking_date);
    const conflict = occupied.some(o => {
      const oS = parseInt(o.start_time);
      const oE = parseInt(o.end_time);
      return !(endH <= oS || startH >= oE);
    });
    if (conflict) {
      return res.status(409).json({
        success: false, message: '所選時段已被預約，請選擇其他時段'
      });
    }

    // 建立預約
    const booking = await BookingModel.create({
      ...req.body, end_time, unit_price, total_amount
    });

    // 產生付款連結（外部服務失敗不影響預約建立）
    let paymentUrl = null;
    try {
      if (!payment_method || payment_method !== 'linepay') {
        paymentUrl = await NewebPaySvc.createPaymentUrl(booking);
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

    res.status(201).json({
      success: true,
      message: '預約建立成功，請於 2 小時內完成付款',
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

// ─── 查詢預約 ────────────────────────────────────────
router.get('/:no', async (req, res, next) => {
  try {
    const booking = await BookingModel.findByNo(req.params.no);
    if (!booking) return res.status(404).json({ success: false, message: '找不到此預約' });
    // 隱藏敏感欄位
    delete booking.payment_trade_no;
    res.json({ success: true, data: booking });
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
