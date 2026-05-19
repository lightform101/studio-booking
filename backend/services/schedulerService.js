/**
 * 排程任務服務（node-cron）
 * 自動執行：取消超時訂單、發送提醒、標記完成
 */
const cron         = require('node-cron');
const BookingModel = require('../models/BookingModel');
const NotifySvc    = require('./notifyService');
const { pool }     = require('../config/database');
const dayjs        = require('dayjs');

const SchedulerService = {

  init() {
    console.log('⏰ 排程任務啟動');

    // ─── 每 5 分鐘：取消超時未付款訂單 ────────────
    cron.schedule('*/5 * * * *', async () => {
      try {
        const count = await BookingModel.cancelExpired();
        if (count > 0) console.log(`[Scheduler] 已取消 ${count} 筆超時訂單`);
      } catch (e) { console.error('[Scheduler] cancelExpired 錯誤:', e.message); }
    });

    // ─── 每天 09:00：發送 24 小時前提醒 ─────────
    cron.schedule('0 9 * * *', async () => {
      try { await this.send24hReminders(); }
      catch (e) { console.error('[Scheduler] send24hReminders 錯誤:', e.message); }
    });

    // ─── 每天 00:30：標記昨日已完成的預約 ─────────
    cron.schedule('30 0 * * *', async () => {
      try {
        const count = await BookingModel.markCompleted();
        if (count > 0) console.log(`[Scheduler] 標記 ${count} 筆預約為已完成`);
      } catch (e) { console.error('[Scheduler] markCompleted 錯誤:', e.message); }
    });

    // ─── 每小時：催繳即將到期的待付款訂單 ──────────
    cron.schedule('0 * * * *', async () => {
      try { await this.sendPaymentReminders(); }
      catch (e) { console.error('[Scheduler] sendPaymentReminders 錯誤:', e.message); }
    });
  },

  // 發送 24 小時前提醒（明天有預約的客戶）
  async send24hReminders() {
    const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
    const [bookings] = await pool.query(
      `SELECT b.*, s.name AS studio_name FROM bookings b
       JOIN studios s ON b.studio_id = s.id
       WHERE b.booking_date = ? AND b.status = 'confirmed'`,
      [tomorrow]
    );

    console.log(`[Scheduler] 發送 24h 提醒，共 ${bookings.length} 筆`);
    for (const booking of bookings) {
      try {
        // 確認尚未發送過
        const [[existing]] = await pool.query(
          `SELECT id FROM notifications
           WHERE booking_id=? AND event='reminder_24h' AND status='sent'`,
          [booking.id]
        );
        if (!existing) await NotifySvc.send('reminder_24h', booking);
      } catch (e) {
        console.error(`[Scheduler] 提醒失敗 ${booking.booking_no}:`, e.message);
      }
    }
  },

  // 催繳即將到期的待付款訂單（1 小時內到期）
  async sendPaymentReminders() {
    const soon = dayjs().add(1, 'hour').format('YYYY-MM-DD HH:mm:ss');
    const now  = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const [bookings] = await pool.query(
      `SELECT b.*, s.name AS studio_name FROM bookings b
       JOIN studios s ON b.studio_id = s.id
       WHERE b.status = 'pending_payment'
         AND b.payment_expire BETWEEN ? AND ?`,
      [now, soon]
    );

    for (const booking of bookings) {
      try {
        const [[existing]] = await pool.query(
          `SELECT id FROM notifications
           WHERE booking_id=? AND event='payment_reminder' AND status='sent'`,
          [booking.id]
        );
        if (!existing) {
          await NotifySvc.send('payment_pending', booking);
          // 記錄已發提醒（避免重複）
          await pool.query(
            'INSERT INTO notifications (booking_id, type, event, recipient, status, sent_at) VALUES (?,?,?,?,?,NOW())',
            [booking.id, 'email', 'payment_reminder', booking.contact_email, 'sent']
          );
        }
      } catch (e) {
        console.error(`[Scheduler] 催繳提醒失敗 ${booking.booking_no}:`, e.message);
      }
    }
  }
};

module.exports = SchedulerService;
