/**
 * SMS 通知服務（每日簡訊 mitake）
 */
const axios    = require('axios');
const { pool } = require('../config/database');

async function logSms(booking_id, event, phone, status, error_msg = null) {
  try {
    await pool.query(
      'INSERT INTO notifications (booking_id, type, event, recipient, status, sent_at, error_msg) VALUES (?,?,?,?,?,NOW(),?)',
      [booking_id, 'sms', event, phone, status, error_msg]
    );
  } catch (e) { /* ignore */ }
}

const SmsService = {

  // 低階傳送
  async send(phone, message) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[SMS Mock] To: ${phone} | Msg: ${message}`);
      return { success: true, mock: true };
    }
    const params = new URLSearchParams({
      username: process.env.MITAKE_USERNAME,
      password: process.env.MITAKE_PASSWORD,
      dstaddr:  phone.replace(/-/g, ''),
      smbody:   message
    });
    const response = await axios.post(
      'https://sms.mitake.com.tw/b2c/mtk/SmSend',
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    // mitake 回應格式: msgid=XXXX\nstatcode=1\n
    const text = response.data;
    if (!text.includes('statcode=1')) {
      throw new Error(`SMS 發送失敗: ${text}`);
    }
    return { success: true, response: text };
  },

  // 預約確認簡訊
  async sendBookingConfirmed(booking) {
    const dayjs  = require('dayjs');
    const date   = dayjs(booking.booking_date).format('MM/DD');
    const start  = String(booking.start_time).slice(0, 5);
    const end    = String(booking.end_time).slice(0, 5);
    const msg    = `[LightForm Studio] 預約${booking.booking_no}已確認！` +
                   `${date} ${start}-${end} ${booking.studio_name}。` +
                   `如有問題請聯繫 ${process.env.SITE_PHONE || '02-XXXX-XXXX'}`;
    try {
      await this.send(booking.contact_phone, msg);
      await logSms(booking.id, 'booking_confirmed', booking.contact_phone, 'sent');
    } catch (e) {
      await logSms(booking.id, 'booking_confirmed', booking.contact_phone, 'failed', e.message);
    }
  },

  // 24 小時前提醒
  async sendReminder24h(booking) {
    const dayjs  = require('dayjs');
    const date   = dayjs(booking.booking_date).format('MM/DD');
    const start  = String(booking.start_time).slice(0, 5);
    const msg    = `[LightForm Studio] 提醒：明天${date} ${start} ` +
                   `${booking.studio_name}場地使用。` +
                   `請準時到達，訂單:${booking.booking_no}`;
    try {
      await this.send(booking.contact_phone, msg);
      await logSms(booking.id, 'reminder_24h', booking.contact_phone, 'sent');
    } catch (e) {
      await logSms(booking.id, 'reminder_24h', booking.contact_phone, 'failed', e.message);
    }
  },

  // 取消通知
  async sendBookingCancelled(booking) {
    const refundText = booking.refund_amount > 0
      ? `退款NT$${Number(booking.refund_amount).toLocaleString()}將於5-7工作天退回。`
      : '';
    const msg = `[LightForm Studio] 預約${booking.booking_no}已取消。${refundText}` +
                `如有疑問請聯繫 ${process.env.SITE_PHONE || '02-XXXX-XXXX'}`;
    try {
      await this.send(booking.contact_phone, msg);
      await logSms(booking.id, 'booking_cancelled', booking.contact_phone, 'sent');
    } catch (e) {
      await logSms(booking.id, 'booking_cancelled', booking.contact_phone, 'failed', e.message);
    }
  }
};

module.exports = SmsService;
