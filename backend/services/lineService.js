/**
 * LINE Messaging API 服務
 * - 讀取後台設定的 Channel Access Token / Secret
 * - 推播訊息給「通知對象」（notify_enabled 的聯絡人）
 * - 驗證 webhook 簽章、取得使用者顯示名稱
 */
const crypto   = require('crypto');
const https    = require('https');
const { pool } = require('../config/database');

// 讀取 LINE 設定（DB settings 優先，其次環境變數）
async function getConfig() {
  const cfg = {
    token:  process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
    secret: process.env.LINE_CHANNEL_SECRET || '',
    enabled: true,
  };
  try {
    const [rows] = await pool.query(
      "SELECT key_name, key_value FROM settings WHERE key_name IN ('line_channel_access_token','line_channel_secret','line_notify_enabled')"
    );
    rows.forEach(r => {
      if (r.key_name === 'line_channel_access_token' && r.key_value) cfg.token  = r.key_value;
      if (r.key_name === 'line_channel_secret'       && r.key_value) cfg.secret = r.key_value;
      if (r.key_name === 'line_notify_enabled') cfg.enabled = r.key_value !== '0';
    });
  } catch (e) { /* 資料表未就緒時用 env */ }
  return cfg;
}

// 通用 LINE API 請求
function lineRequest(pathname, token, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.line.me', path: pathname, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        'Authorization': `Bearer ${token}`,
      },
      timeout: 10000,
    }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(raw || '{}');
        else reject(new Error(`LINE API ${res.statusCode}: ${raw.slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('LINE API timeout')); });
    req.write(body);
    req.end();
  });
}

const LineService = {
  // 驗證 webhook 簽章
  verifySignature(rawBody, signature, secret) {
    if (!secret || !signature) return false;
    const hash = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
    return hash === signature;
  },

  // 取得使用者顯示名稱
  async getProfile(userId, token) {
    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.line.me', path: `/v2/bot/profile/${userId}`, method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }, timeout: 8000,
      }, res => {
        let raw = '';
        res.on('data', d => raw += d);
        res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
      });
      req.on('error', () => resolve({}));
      req.on('timeout', () => { req.destroy(); resolve({}); });
      req.end();
    });
  },

  // 回覆訊息（webhook replyToken）
  async reply(replyToken, text, token) {
    const cfg = token ? { token } : await getConfig();
    if (!cfg.token) return;
    return lineRequest('/v2/bot/message/reply', cfg.token, {
      replyToken, messages: [{ type: 'text', text }]
    });
  },

  // 推播純文字給指定 userId
  async pushTo(userId, text) {
    const cfg = await getConfig();
    if (!cfg.token) throw new Error('LINE Channel Access Token 尚未設定');
    return lineRequest('/v2/bot/message/push', cfg.token, {
      to: userId, messages: [{ type: 'text', text }]
    });
  },

  // 推播給所有「通知對象」（notify_enabled）
  async pushToOwners(text) {
    const cfg = await getConfig();
    if (!cfg.enabled) return { skipped: '已停用' };
    if (!cfg.token)   return { skipped: 'Token 未設定' };
    const [rows] = await pool.query('SELECT user_id FROM line_contacts WHERE notify_enabled=1');
    if (!rows.length) return { skipped: '尚無通知對象' };
    const results = await Promise.allSettled(
      rows.map(r => lineRequest('/v2/bot/message/push', cfg.token, {
        to: r.user_id, messages: [{ type: 'text', text }]
      }))
    );
    return { sent: results.filter(r => r.status === 'fulfilled').length, total: rows.length };
  },

  // 組裝「新預約」通知文字
  buildBookingAlert(booking) {
    const amount = booking.total_amount != null ? `NT$ ${Number(booking.total_amount).toLocaleString()}` : '—';
    const statusMap = { pending_payment: '待付款', confirmed: '已確認', completed: '已完成', cancelled: '已取消' };
    return [
      '📸 有新預約！',
      `訂單：${booking.booking_no}`,
      `場地：${booking.studio_name || '—'}`,
      `日期：${String(booking.booking_date).slice(0,10)} ${String(booking.start_time).slice(0,5)}–${String(booking.end_time).slice(0,5)}`,
      `客戶：${booking.contact_name}（${booking.contact_phone}）`,
      `金額：${amount}`,
      `狀態：${statusMap[booking.status] || booking.status}`,
    ].join('\n');
  },
};

module.exports = LineService;
module.exports._getConfig = getConfig;
