/**
 * 金流回調處理 Routes
 * POST /api/payment/newebpay/notify   藍新後端通知
 * GET  /api/payment/newebpay/return   藍新前端跳轉
 * GET  /api/payment/linepay/confirm   LINE Pay 確認
 * GET  /api/payment/linepay/cancel    LINE Pay 取消
 */
const router        = require('express').Router();
const BookingModel  = require('../models/BookingModel');
const NewebPaySvc   = require('../services/newebpayService');
const InvoiceSvc    = require('../services/invoiceService');
const NotifySvc     = require('../services/notifyService');
const { pool }      = require('../config/database');

// ─── 藍新金流後端通知（NotifyURL）───────────────────
router.post('/newebpay/notify', async (req, res, next) => {
  try {
    const result = NewebPaySvc.parseNotify(req.body);
    if (!result.success) {
      console.error('[NewebPay Notify] 驗證失敗:', result.error);
      return res.send('0|驗證失敗');
    }

    const { booking_no, trade_no, payment_type } = result;
    const booking = await BookingModel.findByNo(booking_no);
    if (!booking) return res.send('0|找不到訂單');
    if (booking.status === 'confirmed') return res.send('1|OK'); // 已處理

    const updated = await BookingModel.confirmPayment(booking_no, {
      payment_method:   mapPaymentType(payment_type),
      payment_trade_no: trade_no,
      payment_ref:      JSON.stringify(result.raw)
    });

    // 開立電子發票
    if (updated.need_invoice) {
      try { await InvoiceSvc.issue(updated); }
      catch (e) { console.error('[Invoice] 開立失敗:', e.message); }
    }

    // 發送確認通知
    await NotifySvc.send('booking_confirmed', updated);

    res.send('1|OK');
  } catch (err) {
    console.error('[NewebPay Notify Error]', err);
    res.send('0|系統錯誤');
  }
});

// ─── 藍新金流前端跳轉（ReturnURL）──────────────────
router.post('/newebpay/return', async (req, res) => {
  try {
    const result = NewebPaySvc.parseNotify(req.body);
    const params = new URLSearchParams({ booking_no: result.booking_no || '' });
    if (result.success) {
      return res.redirect(`/confirmation.html?${params}`);
    }
    params.set('error', '付款失敗');
    return res.redirect(`/booking.html?${params}`);
  } catch (err) {
    return res.redirect('/booking.html?error=付款處理異常');
  }
});

// ─── LINE Pay 確認回調 ──────────────────────────────
router.get('/linepay/confirm', async (req, res, next) => {
  try {
    const { transactionId, orderId } = req.query;
    if (!transactionId || !orderId) {
      return res.redirect('/booking.html?error=LINE Pay 參數錯誤');
    }

    const LinePaySvc = require('../services/linepayService');
    const result = await LinePaySvc.confirmPayment(transactionId, orderId);

    const booking = await BookingModel.findByNo(orderId);
    if (!booking) return res.redirect('/booking.html?error=找不到訂單');

    const updated = await BookingModel.confirmPayment(orderId, {
      payment_method:   'linepay',
      payment_trade_no: transactionId,
      payment_ref:      JSON.stringify(result)
    });

    if (updated.need_invoice) {
      try { await InvoiceSvc.issue(updated); }
      catch (e) { console.error('[Invoice] 開立失敗:', e.message); }
    }

    await NotifySvc.send('booking_confirmed', updated);
    res.redirect(`/confirmation.html?booking_no=${orderId}`);
  } catch (err) { next(err); }
});

// ─── LINE Pay 取消回調 ──────────────────────────────
router.get('/linepay/cancel', (req, res) => {
  res.redirect('/booking.html?error=LINE Pay 付款已取消');
});

// ─── Helper ─────────────────────────────────────────
function mapPaymentType(type) {
  const map = { CREDIT: 'credit', VACC: 'atm', CVS: 'cvs', LINEPAY: 'linepay' };
  return map[type] || 'credit';
}

module.exports = router;
