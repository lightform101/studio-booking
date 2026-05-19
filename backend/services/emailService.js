/**
 * Email 通知服務（Nodemailer）
 */
const nodemailer = require('nodemailer');
const fs         = require('fs');
const path       = require('path');
const { pool }   = require('../config/database');

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
  return transporter;
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
    const t = getTransporter();
    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
      to, subject, html, attachments
    };
    const info = await t.sendMail(mailOptions);
    console.log(`[Email] 已發送: ${subject} → ${to} (${info.messageId})`);
    return info;
  },

  // ─── 預約確認信 ────────────────────────────────
  async sendBookingConfirmed(booking) {
    const vars = buildBookingVars(booking);
    const html = loadTemplate('booking-confirmed', vars);
    if (!html) return console.warn('[Email] 找不到模板: booking-confirmed');
    try {
      await this.send({
        to: booking.contact_email,
        subject: `【Studio Space】預約成功確認 - ${booking.booking_no}`,
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
        subject: `【Studio Space】請於 2 小時內完成付款 - ${booking.booking_no}`,
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
    const html = loadTemplate('reminder-24h', vars);
    if (!html) return;
    try {
      await this.send({
        to: booking.contact_email,
        subject: `【Studio Space】明天的場地提醒 - ${booking.booking_no}`,
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
        subject: `【Studio Space】預約取消確認 - ${booking.booking_no}`,
        html
      });
      await logNotification(booking.id, 'booking_cancelled', booking.contact_email, 'sent');
    } catch (e) {
      await logNotification(booking.id, 'booking_cancelled', booking.contact_email, 'failed', e.message);
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
        subject: `【Studio Space】您的電子發票 - ${booking.invoice_no}`,
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
    site_email:    process.env.EMAIL_FROM || 'contact@studiospace.tw',
    base_url:      process.env.BASE_URL || 'http://localhost:3000'
  };
}

function mapMethodLabel(m) {
  const map = { credit:'信用卡', atm:'ATM 轉帳', cvs:'超商代碼', linepay:'LINE Pay' };
  return map[m] || m || '—';
}

module.exports = EmailService;
