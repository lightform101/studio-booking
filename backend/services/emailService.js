/**
 * Email 通知服務（Nodemailer）
 */
const nodemailer = require('nodemailer');
const fs         = require('fs');
const path       = require('path');
const { pool }   = require('../config/database');

let transporter  = null;
let _smtpCache   = null; // DB 設定快取

// 從 DB 讀取 SMTP 設定，若 DB 無值則 fallback 到環境變數
async function loadSmtpConfig() {
  try {
    const [rows] = await pool.query(
      "SELECT key_name, key_value FROM settings WHERE key_name IN ('smtp_host','smtp_port','smtp_user','smtp_pass','smtp_secure','smtp_from_email','smtp_from_name')"
    );
    const cfg = {};
    for (const r of rows) cfg[r.key_name] = r.key_value;
    return {
      host:     cfg.smtp_host      || process.env.SMTP_HOST      || '',
      port:     parseInt(cfg.smtp_port || process.env.SMTP_PORT) || 587,
      secure:   (cfg.smtp_secure   || process.env.SMTP_SECURE)   === 'true',
      user:     cfg.smtp_user      || process.env.SMTP_USER      || '',
      pass:     cfg.smtp_pass      || process.env.SMTP_PASS      || '',
      fromEmail:cfg.smtp_from_email|| process.env.EMAIL_FROM     || cfg.smtp_user || '',
      fromName: cfg.smtp_from_name || process.env.EMAIL_FROM_NAME|| 'LightForm Studio',
    };
  } catch(e) {
    console.warn('[Email] 無法從 DB 讀取 SMTP 設定，使用環境變數:', e.message);
    return {
      host:     process.env.SMTP_HOST  || '',
      port:     parseInt(process.env.SMTP_PORT) || 587,
      secure:   process.env.SMTP_SECURE === 'true',
      user:     process.env.SMTP_USER  || '',
      pass:     process.env.SMTP_PASS  || '',
      fromEmail:process.env.EMAIL_FROM || '',
      fromName: process.env.EMAIL_FROM_NAME || 'LightForm Studio',
    };
  }
}

async function getTransporter() {
  const cfg = await loadSmtpConfig();
  if (!cfg.host || !cfg.user) {
    throw new Error('SMTP 尚未設定，請至後台系統設定填入 SMTP 資訊');
  }
  // 每次都建立新的（確保 DB 設定變更立即生效）
  return { transporter: nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 10000,  // 10 秒連線 timeout
    greetingTimeout:   8000,   // 8 秒 greeting timeout
    socketTimeout:     15000,  // 15 秒 socket timeout
  }), cfg };
}

// 重置 transporter（設定變更後呼叫，保留向下相容）
function resetTransporter() {
  transporter = null;
  _smtpCache  = null;
  console.log('[Email] Transporter 已重置，下次發信時套用新設定');
}

// 載入 HTML 模板並替換變數 {{key}}
function loadTemplate(templateName, variables = {}) {
  const filePath = path.join(__dirname, '../templates/emails', `${templateName}.html`);
  if (!fs.existsSync(filePath)) return null;
  let html = fs.readFileSync(filePath, 'utf8');
  for (const [key, val] of Object.entries(variables)) {
    html = html.replace(new RegExp(`{{${key}}}`, 'g'), val ?? '');
  }
  return html;
}

// 記錄通知至 DB
async function logNotification(booking_id, event, recipient, status, error_msg = null) {
  try {
    await pool.query(
      'INSERT INTO notifications (booking_id, type, event, recipient, status, sent_at, error_msg) VALUES (?,?,?,?,?,NOW(),?)',
      [booking_id, 'email', event, recipient, status, error_msg]
    );
  } catch (e) { /* 記錄失敗不影響主流程 */ }
}

const EmailService = {

  // 傳送 Email（低階）
  async send({ to, subject, html, attachments = [] }) {
    const { transporter: t, cfg } = await getTransporter();
    const mailOptions = {
      from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
      to, subject, html, attachments
    };
    try {
      const info = await t.sendMail(mailOptions);
      console.log(`[Email] 已發送: ${subject} → ${to} (${info.messageId})`);
      return info;
    } finally {
      t.close(); // 發送完畢後關閉連線，避免佔用資源
    }
  },

  // ─── 預約確認信 ────────────────────────────────
  async sendBookingConfirmed(booking) {
    const vars = buildBookingVars(booking);
    const html = loadTemplate('booking-confirmed', vars);
    if (!html) return console.warn('[Email] 找不到模板: booking-confirmed');
    try {
      await this.send({
        to: booking.contact_email,
        subject: `【LightForm Studio】預約成功確認 - ${booking.booking_no}`,
        html
      });
      await logNotification(booking.id, 'booking_confirmed', booking.contact_email, 'sent');
    } catch (e) {
      await logNotification(booking.id, 'booking_confirmed', booking.contact_email, 'failed', e.message);
      throw e;
    }
  },

  // ─── 待付款提醒 ────────────────────────────────
  async sendPaymentPending(booking) {
    const vars = buildBookingVars(booking);
    const html = loadTemplate('payment-pending', vars);
    if (!html) return;
    try {
      await this.send({
        to: booking.contact_email,
        subject: `【LightForm Studio】請於 2 小時內完成付款 - ${booking.booking_no}`,
        html
      });
      await logNotification(booking.id, 'payment_pending', booking.contact_email, 'sent');
    } catch (e) {
      await logNotification(booking.id, 'payment_pending', booking.contact_email, 'failed', e.message);
    }
  },

  // ─── 24 小時前提醒 ─────────────────────────────
  async sendReminder24h(booking) {
    const vars = buildBookingVars(booking);

    // 地址：從系統設定讀取（contact_address 優先）
    let address = '';
    try {
      const { pool } = require('../config/database');
      const [rows] = await pool.query(
        "SELECT key_name, key_value FROM settings WHERE key_name IN ('contact_address','site_address')"
      );
      const map = {}; rows.forEach(r => map[r.key_name] = r.key_value);
      address = map.contact_address || map.site_address || '';
    } catch (e) { /* 讀取失敗則不顯示地址 */ }

    // 進門密碼區塊：有密碼才顯示，否則提示現場/另行通知
    vars.access_block = booking.ttlock_passcode
      ? `<div class="code-box">
           <div style="font-size:.82rem;color:#6f8060;margin-bottom:6px;">🔐 進門密碼</div>
           <div style="font-size:1.9rem;font-weight:800;letter-spacing:.18em;color:#3a3a36;font-family:monospace;">${booking.ttlock_passcode}</div>
           <div style="font-size:.76rem;color:#888;margin-top:6px;">有效時間：預約開始前 15 分鐘 ～ 結束後 15 分鐘</div>
         </div>`
      : `<div class="code-box" style="background:#fff8e1;border-color:#ffe082;">
           <div style="font-size:.85rem;color:#8a6d3b;">🔐 進門方式將於入場前另行通知，或由現場人員協助。</div>
         </div>`;

    // 地址區塊
    vars.address_block = address
      ? `<div class="detail-row"><span>地址</span><span>${address}</span></div>`
      : '';

    const html = loadTemplate('reminder-24h', vars);
    if (!html) return;
    try {
      await this.send({
        to: booking.contact_email,
        subject: `【LightForm Studio】明天的場地提醒 - ${booking.booking_no}`,
        html
      });
      await logNotification(booking.id, 'reminder_24h', booking.contact_email, 'sent');
    } catch (e) {
      await logNotification(booking.id, 'reminder_24h', booking.contact_email, 'failed', e.message);
    }
  },

  // ─── 取消確認信 ────────────────────────────────
  async sendBookingCancelled(booking) {
    const vars = buildBookingVars(booking);
    const html = loadTemplate('booking-cancelled', vars);
    if (!html) return;
    try {
      await this.send({
        to: booking.contact_email,
        subject: `【LightForm Studio】預約取消確認 - ${booking.booking_no}`,
        html
      });
      await logNotification(booking.id, 'booking_cancelled', booking.contact_email, 'sent');
    } catch (e) {
      await logNotification(booking.id, 'booking_cancelled', booking.contact_email, 'failed', e.message);
    }
  },

  // ─── 進門密碼通知 ──────────────────────────────
  async sendAccessCode(booking, passcode, ttlockWindow = {}) {
    const dayjs = require('dayjs');
    const base  = buildBookingVars(booking);
    // 一律以台灣時區顯示時間（避免伺服器 UTC 造成偏移）
    const fmtHM = (ms) => new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date(ms));
    // 優先使用 TTLock 實際生效區間（整點對齊後），fallback 到 ±15 分鐘估算
    let validFrom, validUntil;
    if (ttlockWindow.validFromMs && ttlockWindow.validUntilMs) {
      validFrom  = fmtHM(ttlockWindow.validFromMs);
      validUntil = fmtHM(ttlockWindow.validUntilMs);
    } else {
      const dateStr = dayjs(booking.booking_date).format('YYYY-MM-DD');
      const sMs = new Date(`${dateStr}T${String(booking.start_time).slice(0,5)}:00+08:00`).getTime() - 15 * 60 * 1000;
      const eMs = new Date(`${dateStr}T${String(booking.end_time).slice(0,5)}:00+08:00`).getTime() + 15 * 60 * 1000;
      validFrom  = fmtHM(sMs);
      validUntil = fmtHM(eMs);
    }
    const vars = {
      ...base,
      passcode,
      valid_from:  validFrom,
      valid_until: validUntil,
      year: new Date().getFullYear(),
    };
    const html = loadTemplate('access-code', vars);
    if (!html) return console.warn('[Email] 找不到模板: access-code');
    try {
      await this.send({
        to: booking.contact_email,
        subject: `【LightForm Studio】您的進門密碼 - ${booking.booking_no}`,
        html
      });
      await logNotification(booking.id, 'access_code', booking.contact_email, 'sent');
      console.log(`[Email] 進門密碼已發送 → ${booking.contact_email}`);
    } catch (e) {
      await logNotification(booking.id, 'access_code', booking.contact_email, 'failed', e.message);
      throw e;
    }
  },

  // ─── 電子發票通知 ──────────────────────────────
  async sendInvoiceIssued(booking) {
    const vars = buildBookingVars(booking);
    const html = loadTemplate('invoice-issued', vars);
    if (!html) return;
    try {
      await this.send({
        to: booking.contact_email,
        subject: `【LightForm Studio】您的電子發票 - ${booking.invoice_no}`,
        html
      });
      await logNotification(booking.id, 'invoice_issued', booking.contact_email, 'sent');
    } catch (e) {
      await logNotification(booking.id, 'invoice_issued', booking.contact_email, 'failed', e.message);
    }
  }
};

// 組裝模板變數
function buildBookingVars(b) {
  const dayjs = require('dayjs');
  return {
    booking_no:    b.booking_no,
    studio_name:   b.studio_name || `Studio ${b.studio_id}`,
    contact_name:  b.contact_name,
    contact_phone: b.contact_phone,
    contact_email: b.contact_email,
    booking_date:  dayjs(b.booking_date).format('YYYY年MM月DD日'),
    start_time:    String(b.start_time).slice(0, 5),
    end_time:      String(b.end_time).slice(0, 5),
    duration_hours:b.duration_hours,
    total_amount:  Number(b.total_amount).toLocaleString(),
    refund_amount: b.refund_amount ? Number(b.refund_amount).toLocaleString() : '0',
    payment_method:mapMethodLabel(b.payment_method),
    payment_expire:b.payment_expire ? dayjs(b.payment_expire).format('YYYY/MM/DD HH:mm') : '',
    invoice_no:    b.invoice_no || '',
    site_email:    process.env.EMAIL_FROM || 'contact@lightformstudio.com.tw',
    base_url:      process.env.BASE_URL || 'http://localhost:3000'
  };
}

function mapMethodLabel(m) {
  const map = { credit:'信用卡', atm:'ATM 轉帳', cvs:'超商代碼', linepay:'LINE Pay' };
  return map[m] || m || '—';
}

EmailService.resetTransporter = resetTransporter;
module.exports = EmailService;
