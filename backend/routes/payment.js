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
const GoogleCalSvc  = require('../services/googleCalendarService');
const { pool }      = require('../config/database');

// ─── 藍新金流：產生自動提交表單頁（付款中介頁）────────
// GET /api/payment/newebpay/form/:booking_no
router.get('/newebpay/form/:booking_no', async (req, res) => {
  try {
    const { booking_no } = req.params;

    // 憑證未設定：提示錯誤
    if (!process.env.NEWEBPAY_MERCHANT_ID || !process.env.NEWEBPAY_HASH_KEY || !process.env.NEWEBPAY_HASH_IV) {
      return res.status(503).send(`<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8">
        <title>付款系統未設定</title><style>body{font-family:sans-serif;text-align:center;padding:60px;}</style></head>
        <body><h2>⚠️ 付款系統尚未設定</h2><p>請管理員至 Zeabur 設定 NEWEBPAY 環境變數後再試。</p>
        <a href="javascript:history.back()">← 返回</a></body></html>`);
    }

    const booking = await BookingModel.findByNo(booking_no);
    if (!booking) {
      return res.status(404).send('<h2>找不到此訂單</h2>');
    }
    if (booking.status === 'confirmed') {
      return res.redirect('/confirmation.html?booking_no=' + booking_no);
    }

    const formData = NewebPaySvc.createPaymentUrl(booking);

    // 回傳自動提交的 HTML 表單頁面
    res.send(`<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>前往付款中...</title>
  <style>
    body { font-family: sans-serif; display:flex; flex-direction:column;
           align-items:center; justify-content:center; min-height:100vh;
           margin:0; background:#f5f5f5; color:#333; }
    .spinner { width:40px; height:40px; border:4px solid #ddd;
               border-top:4px solid #2563eb; border-radius:50%;
               animation:spin .8s linear infinite; margin-bottom:16px; }
    @keyframes spin { to { transform:rotate(360deg); } }
    p { font-size:.95rem; color:#666; }
  </style>
</head>
<body>
  <div class="spinner"></div>
  <p>正在前往付款頁面，請稍候...</p>
  <form id="pay-form" method="POST" action="${formData.gateway_url}">
    <input type="hidden" name="MerchantID" value="${formData.merchant_id}">
    <input type="hidden" name="TradeInfo"  value="${formData.trade_info}">
    <input type="hidden" name="TradeSha"   value="${formData.trade_sha}">
    <input type="hidden" name="Version"    value="${formData.version}">
  </form>
  <noscript>
    <p>請點擊下方按鈕前往付款：</p>
    <button onclick="document.getElementById('pay-form').submit()">前往藍新金流付款</button>
  </noscript>
  <script>document.getElementById('pay-form').submit();</script>
</body>
</html>`);
  } catch (err) {
    console.error('[NewebPay Form]', err);
    res.status(500).send('<h2>系統錯誤，請返回重試</h2>');
  }
});

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

    // 同步 Google 行事曆
    try { await GoogleCalSvc.createEvent(updated); }
    catch (e) { console.error('[GoogleCal] 建立事件失敗:', e.message); }

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

    // 同步 Google 行事曆
    try { await GoogleCalSvc.createEvent(updated); }
    catch (e) { console.error('[GoogleCal] 建立事件失敗:', e.message); }

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
