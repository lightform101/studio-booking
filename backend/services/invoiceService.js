/**
 * 電子發票服務 — 光貿 Amego 加值中心
 * API Endpoint: POST https://invoice-api.amego.tw/json/f0401
 * 簽章: sign = MD5( data_json + time_str + APP_KEY )
 *
 * 環境變數:
 *   AMEGO_APP_KEY   — 向光貿客服申請後填入
 *   NODE_ENV        — 非 production 時自動進入 mock 模式
 */
const crypto   = require('crypto');
const https    = require('https');
const qs       = require('querystring');
const { pool } = require('../config/database');

const AMEGO_HOST = 'invoice-api.amego.tw';
const AMEGO_PATH = '/json/f0401';

// 形彩有限公司統一編號
const SELLER_TAX_ID = process.env.AMEGO_TAX_ID || '96842655';

function getAppKey()  { return process.env.AMEGO_APP_KEY || ''; }
function isMockMode() { return !getAppKey(); }
function md5(str)     { return crypto.createHash('md5').update(str, 'utf8').digest('hex'); }

// ─── 呼叫光貿 API ─────────────────────────────────────
async function callAmego(invoiceData) {
  const timeStr = String(Math.floor(Date.now() / 1000));
  const dataStr = JSON.stringify(invoiceData);
  const sign    = md5(dataStr + timeStr + getAppKey());

  const body    = qs.stringify({ invoice: SELLER_TAX_ID, data: dataStr, time: timeStr, sign });
  const bodyBuf = Buffer.from(body, 'utf8');

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: AMEGO_HOST,
      path:     AMEGO_PATH,
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': bodyBuf.length,
        'User-Agent':     'Mozilla/5.0',
        'Connection':     'close',
      },
      timeout: 15000,
    }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (_) { reject(new Error(`光貿非 JSON 回應: ${raw.slice(0, 300)}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('光貿 API timeout')); });
    req.write(bodyBuf);
    req.end();
  });
}

// ─── 組裝發票資料 ─────────────────────────────────────
function buildInvoiceData(booking) {
  const total      = Math.round(Number(booking.total_amount));
  const salesAmt   = Math.round(total / 1.05);      // 未稅金額
  const taxAmt     = Math.ceil(salesAmt * 0.05);    // 稅額（光貿用 ceil）

  const data = {
    OrderId:            booking.booking_no,
    BuyerName:          booking.contact_name,
    BuyerEmail:         booking.contact_email,
    BuyerIdentifier:    '0000000000', // B2C 固定 10 個零，B2B 再覆蓋
    SalesAmount:        salesAmt,     // 未稅金額
    FreeTaxSalesAmount: 0,
    ZeroTaxSalesAmount: 0,
    TaxType:            1,
    TaxRate:            0.05,         // 小數格式
    TaxAmount:          taxAmt,       // ceil(salesAmt * 0.05)
    TotalAmount:        total,        // 含稅總額
    ProductItem: [{
      Description: `${booking.studio_name || '場地'} 場地使用（${booking.booking_no}）`,
      Quantity:    1,
      UnitPrice:   salesAmt,  // 未稅單價
      Amount:      salesAmt,  // 未稅金額
      TaxType:     1,
      TaxRate:     0.05,
    }],
  };

  // 個人載具（手機條碼）
  if (booking.invoice_type === 'personal' && booking.invoice_carrier) {
    data.CarrierType = 'H';                         // H = 手機條碼
    data.CarrierId1  = booking.invoice_carrier;
    data.CarrierId2  = booking.invoice_carrier;
  }

  // 公司統編（B2B）
  if (booking.invoice_type === 'company') {
    data.BuyerIdentifier = booking.invoice_tax_id || '';
    data.BuyerName       = booking.invoice_company || booking.contact_name;
  }

  // 捐贈發票
  if (booking.invoice_type === 'donate' && booking.invoice_donate) {
    data.NPOBAN = booking.invoice_donate;
  }

  return data;
}

// ─── Mock（開發用：APP_KEY 尚未設定時）──────────────
async function issueMock(booking) {
  const letters  = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const prefix   = letters[Math.floor(Math.random() * letters.length)]
                 + letters[Math.floor(Math.random() * letters.length)];
  const mockNo   = `${prefix}-${String(Math.floor(Math.random() * 90000000 + 10000000))}`;
  const mockRand = String(Math.floor(Math.random() * 9000 + 1000));

  await pool.query(
    `UPDATE bookings
     SET invoice_no=?, invoice_random=?, invoice_at=NOW(), invoice_status='issued'
     WHERE id=?`,
    [mockNo, mockRand, booking.id]
  );
  console.log(`[Invoice Mock] 模擬發票: ${mockNo}  隨機碼: ${mockRand}  (${booking.booking_no})`);
  return { invoice_no: mockNo, random_number: mockRand };
}

// ─── 主要開票邏輯 ─────────────────────────────────────
const InvoiceService = {

  /**
   * 開立電子發票
   * @param {Object} booking — 需含 id, booking_no, need_invoice, invoice_type,
   *                           invoice_carrier, invoice_tax_id, invoice_company,
   *                           invoice_donate, contact_name, contact_email,
   *                           total_amount, studio_name
   */
  async issue(booking) {
    // 不需要發票
    if (!booking.need_invoice) {
      await pool.query(
        `UPDATE bookings SET invoice_status='not_needed' WHERE id=?`, [booking.id]
      );
      return null;
    }

    // 已開立過，略過
    if (booking.invoice_no) {
      console.log(`[Invoice] 已有發票 ${booking.invoice_no}，略過 (${booking.booking_no})`);
      return { invoice_no: booking.invoice_no, random_number: booking.invoice_random };
    }

    // Mock 模式（APP_KEY 尚未設定）
    if (isMockMode()) {
      return issueMock(booking);
    }

    // 標記為開票中（pending）
    await pool.query(
      `UPDATE bookings SET invoice_status='pending' WHERE id=?`, [booking.id]
    );

    try {
      const invoiceData = buildInvoiceData(booking);
      console.log('[Invoice] 呼叫光貿 API，訂單:', booking.booking_no);

      const result = await callAmego(invoiceData);
      console.log('[Invoice] 光貿回應:', JSON.stringify(result));

      // 解析回應（光貿可能回傳多種格式）
      const isOk = result.code === 0 || result.status === 'OK' || result.result === 'success';
      if (!isOk) {
        throw new Error(`開立失敗 (code ${result.code ?? result.status}): ${result.message ?? JSON.stringify(result)}`);
      }

      const invoiceNo  = result.InvoiceNo  ?? result.invoice_no  ?? result.data?.InvoiceNo  ?? '';
      const randomNum  = result.RandomNumber ?? result.random_number ?? result.data?.RandomNumber ?? '';

      await pool.query(
        `UPDATE bookings
         SET invoice_no=?, invoice_random=?, invoice_at=NOW(), invoice_status='issued'
         WHERE id=?`,
        [invoiceNo, randomNum, booking.id]
      );

      // 寄送發票 Email 通知
      try {
        const NotifySvc = require('./notifyService');
        await NotifySvc.send('invoice_issued', { ...booking, invoice_no: invoiceNo, invoice_random: randomNum });
      } catch (e) {
        console.warn('[Invoice] 發票通知 Email 失敗:', e.message);
      }

      console.log(`[Invoice] 開立成功: ${invoiceNo}  隨機碼: ${randomNum}  (${booking.booking_no})`);
      return { invoice_no: invoiceNo, random_number: randomNum };

    } catch (err) {
      console.error('[Invoice] 開立失敗:', err.message);
      await pool.query(
        `UPDATE bookings SET invoice_status='failed' WHERE id=?`, [booking.id]
      );
      throw err;
    }
  },

  /**
   * 依預約編號手動補開發票（管理員用）
   */
  async issueByBookingNo(bookingNo) {
    const [[booking]] = await pool.query(
      `SELECT b.*, s.name AS studio_name
       FROM bookings b
       JOIN studios s ON b.studio_id = s.id
       WHERE b.booking_no = ?`,
      [bookingNo]
    );
    if (!booking) throw new Error('找不到預約：' + bookingNo);
    if (booking.invoice_status === 'issued') {
      throw new Error('發票已開立：' + booking.invoice_no);
    }
    return this.issue(booking);
  },

  /**
   * 取得設定值
   */
  async getSetting(key) {
    try {
      const [[row]] = await pool.query(
        'SELECT key_value FROM settings WHERE key_name=?', [key]
      );
      return row?.key_value ?? '1';
    } catch { return '1'; }
  },
};

module.exports = InvoiceService;
