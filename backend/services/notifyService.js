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

// 事件 → 後台「通知事件設定」開關 key（未設定＝預設開啟，'0' 才停用）
const EVENT_SETTING = {
  booking_confirmed: 'notify_event_confirmed',
  reminder_24h:      'notify_event_reminder',
  booking_cancelled: 'notify_event_cancelled',
  payment_pending:   'notify_event_payment',
};

const NotifyService = {

  // 管理員 LINE 推播是否啟用（供 pushToOwners 呼叫端判斷）
  async ownersAlertEnabled() {
    return (await getSetting('notify_event_admin')) !== '0';
  },

  async send(event, booking) {
    // 事件層級開關：後台可個別關閉某類通知
    const evKey = EVENT_SETTING[event];
    if (evKey && (await getSetting(evKey)) === '0') {
      console.log(`[Notify] 事件「${event}」已於後台停用，略過發送`);
      return;
    }

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
