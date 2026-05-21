/**
 * Google Calendar 同步服務
 *
 * 環境變數：
 *   GOOGLE_CALENDAR_ID          — 管理員行事曆 ID（可從 Google Calendar 設定取得）
 *   GOOGLE_SERVICE_ACCOUNT_KEY  — Service Account JSON 金鑰（整個 JSON 字串）
 *
 * 設定步驟：
 *   1. Google Cloud Console → 建立專案 → 啟用 Google Calendar API
 *   2. 建立 Service Account → 下載 JSON 金鑰
 *   3. 將 JSON 金鑰整個字串貼入環境變數 GOOGLE_SERVICE_ACCOUNT_KEY
 *   4. 在 Google Calendar → 行事曆設定 → 分享，將 Service Account email
 *      加入並給予「製作活動的變更」權限
 *   5. 將行事曆 ID 填入 GOOGLE_CALENDAR_ID
 */
const { google } = require('googleapis');
const { pool }   = require('../config/database');

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || '';

// 狀態顏色對應（Google Calendar colorId）
const COLOR_CONFIRMED  = '2';  // Sage（綠）— 已確認
const COLOR_COMPLETED  = '8';  // Graphite（灰）— 已完成

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  try {
    const credentials = JSON.parse(raw);
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
  } catch {
    console.error('[GoogleCal] GOOGLE_SERVICE_ACCOUNT_KEY 格式錯誤，請確認是完整 JSON 字串');
    return null;
  }
}

function isMockMode() {
  return !process.env.GOOGLE_SERVICE_ACCOUNT_KEY || !CALENDAR_ID;
}

function buildEventResource(booking) {
  const date      = booking.booking_date instanceof Date
    ? booking.booking_date.toISOString().slice(0, 10)
    : String(booking.booking_date).slice(0, 10);
  const startTime = String(booking.start_time).slice(0, 5); // HH:MM
  const endTime   = String(booking.end_time).slice(0, 5);

  const lines = [
    `訂單編號：${booking.booking_no}`,
    `聯絡人　：${booking.contact_name}`,
    `聯絡電話：${booking.contact_phone  || '未填'}`,
    `聯絡信箱：${booking.contact_email  || '未填'}`,
    `金　　額：NT$${booking.total_amount}`,
    `付款方式：${booking.payment_method || '未確認'}`,
  ];

  return {
    summary:     `【${booking.studio_name || '場地'}】${booking.contact_name}`,
    description: lines.join('\n'),
    colorId:     COLOR_CONFIRMED,
    start: { dateTime: `${date}T${startTime}:00+08:00`, timeZone: 'Asia/Taipei' },
    end:   { dateTime: `${date}T${endTime}:00+08:00`,   timeZone: 'Asia/Taipei' },
  };
}

const GoogleCalendarService = {

  /**
   * 建立行事曆事件（預約確認時呼叫）
   */
  async createEvent(booking) {
    if (isMockMode()) {
      console.log(`[GoogleCal] 未設定，略過建立事件 (${booking.booking_no})`);
      return null;
    }

    try {
      const auth     = getAuth();
      if (!auth) return null;
      const calendar = google.calendar({ version: 'v3', auth });

      const response = await calendar.events.insert({
        calendarId: CALENDAR_ID,
        resource:   buildEventResource(booking),
      });

      const eventId = response.data.id;
      await pool.query(
        'UPDATE bookings SET google_event_id = ? WHERE id = ?',
        [eventId, booking.id]
      );
      console.log(`[GoogleCal] 事件已建立：${eventId} (${booking.booking_no})`);
      return eventId;
    } catch (err) {
      console.error('[GoogleCal] 建立事件失敗:', err.message);
      return null; // 不阻斷主流程
    }
  },

  /**
   * 刪除行事曆事件（取消預約時呼叫）
   */
  async deleteEvent(booking) {
    if (isMockMode()) return;

    const eventId = booking.google_event_id;
    if (!eventId) return;

    try {
      const auth     = getAuth();
      if (!auth) return;
      const calendar = google.calendar({ version: 'v3', auth });

      await calendar.events.delete({ calendarId: CALENDAR_ID, eventId });
      await pool.query(
        'UPDATE bookings SET google_event_id = NULL WHERE id = ?',
        [booking.id]
      );
      console.log(`[GoogleCal] 事件已刪除：${eventId} (${booking.booking_no})`);
    } catch (err) {
      if (err.code === 410 || err.code === 404) {
        console.log(`[GoogleCal] 事件已不存在，略過 (${booking.booking_no})`);
      } else {
        console.error('[GoogleCal] 刪除事件失敗:', err.message);
      }
    }
  },

  /**
   * 更新行事曆事件（管理員修改預約時呼叫）
   */
  async updateEvent(booking) {
    if (isMockMode()) return;

    const eventId = booking.google_event_id;
    if (!eventId) {
      // 若原本沒有 eventId 就直接建立
      return this.createEvent(booking);
    }

    try {
      const auth     = getAuth();
      if (!auth) return;
      const calendar = google.calendar({ version: 'v3', auth });

      await calendar.events.update({
        calendarId: CALENDAR_ID,
        eventId,
        resource: buildEventResource(booking),
      });
      console.log(`[GoogleCal] 事件已更新：${eventId} (${booking.booking_no})`);
    } catch (err) {
      if (err.code === 410 || err.code === 404) {
        // 已被刪除，重新建立
        await this.createEvent(booking);
      } else {
        console.error('[GoogleCal] 更新事件失敗:', err.message);
      }
    }
  },

  /**
   * 批次刪除超時取消訂單的行事曆事件（排程用）
   * cancelExpired 只回傳影響筆數，需先查出有 eventId 的超時訂單再刪
   */
  async deleteExpiredEvents() {
    if (isMockMode()) return;

    try {
      const [rows] = await pool.query(
        `SELECT id, booking_no, google_event_id
         FROM bookings
         WHERE status = 'cancelled'
           AND cancel_reason = '超時未付款自動取消'
           AND google_event_id IS NOT NULL
           AND cancel_at >= NOW() - INTERVAL 10 MINUTE`
      );
      for (const row of rows) {
        await this.deleteEvent(row);
      }
    } catch (err) {
      console.error('[GoogleCal] deleteExpiredEvents 失敗:', err.message);
    }
  },
};

module.exports = GoogleCalendarService;
