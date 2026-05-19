/**
 * 通知統一調度服務
 * 根據事件類型決定發送 Email / SMS
 */
const EmailSvc = require('./emailService');
const SmsSvc   = require('./smsService');
const { pool } = require('../config/database');

async function getSetting(key) {
  try {
    const [[row]] = await pool.query('SELECT key_value FROM settings WHERE key_name=?', [key]);
    return row?.key_value;
  } catch { return '1'; }
}

const NotifyService = {

  async send(event, booking) {
    const emailEnabled = await getSetting('notify_email_enabled');
    const smsEnabled   = await getSetting('notify_sms_enabled');

    const tasks = [];

    switch (event) {
      case 'booking_confirmed':
        if (emailEnabled !== '0') tasks.push(EmailSvc.sendBookingConfirmed(booking));
        if (smsEnabled !== '0')   tasks.push(SmsSvc.sendBookingConfirmed(booking));
        break;

      case 'payment_pending':
        if (emailEnabled !== '0') tasks.push(EmailSvc.sendPaymentPending(booking));
        break;

      case 'reminder_24h':
        if (emailEnabled !== '0') tasks.push(EmailSvc.sendReminder24h(booking));
        if (smsEnabled !== '0')   tasks.push(SmsSvc.sendReminder24h(booking));
        break;

      case 'booking_cancelled':
        if (emailEnabled !== '0') tasks.push(EmailSvc.sendBookingCancelled(booking));
        if (smsEnabled !== '0')   tasks.push(SmsSvc.sendBookingCancelled(booking));
        break;

      case 'invoice_issued':
        if (emailEnabled !== '0') tasks.push(EmailSvc.sendInvoiceIssued(booking));
        break;

      default:
        console.warn(`[Notify] 未知事件: ${event}`);
    }

    const results = await Promise.allSettled(tasks);
    results.forEach((r, i) => {
      if (r.status === 'rejected') console.error(`[Notify] 任務 ${i} 失敗:`, r.reason);
    });
  }
};

module.exports = NotifyService;
