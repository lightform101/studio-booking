/**
 * 電子發票服務（綠界 ECPay）
 * API 文件: https://developers.ecpay.com.tw/?p=2509
 */
const axios    = require('axios');
const crypto   = require('crypto');
const qs       = require('querystring');
const dayjs    = require('dayjs');
const { pool } = require('../config/database');

const SANDBOX_URL    = 'https://einvoice-stage.ecpay.com.tw/B2CInvoice/Issue';
const PRODUCTION_URL = 'https://einvoice.ecpay.com.tw/B2CInvoice/Issue';

function getMerchantId()  { return process.env.ECPAY_MERCHANT_ID; }
function getHashKey()     { return process.env.ECPAY_HASH_KEY; }
function getHashIV()      { return process.env.ECPAY_HASH_IV; }
function isProduction()   { return process.env.ECPAY_ENV === 'production'; }
function getApiUrl()      { return isProduction() ? PRODUCTION_URL : SANDBOX_URL; }

// URL encode 後 SHA256 簽章
function generateCheckMac(params) {
  const sorted = Object.keys(params).sort().reduce((acc, k) => {
    acc[k] = params[k]; return acc;
  }, {});
  let str = `HashKey=${getHashKey()}&${qs.stringify(sorted)}&HashIV=${getHashIV()}`;
  str = encodeURIComponent(str).toLowerCase().replace(/%20/g, '+');
  return crypto.createHash('sha256').update(str).digest('hex').toUpperCase();
}

const InvoiceService = {

  // 開立電子發票
  async issue(booking) {
    // 非發票模式、或未付款，跳過
    if (!booking.need_invoice) return null;

    const autoIssue = await getSetting('invoice_auto_issue');
    if (autoIssue === '0') return null;

    // 開發環境 mock
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Invoice Mock] 模擬開立發票: ${booking.booking_no}`);
      const mockInvoiceNo = `AA-${Math.floor(Math.random()*90000000+10000000)}`;
      const mockRandom    = String(Math.floor(Math.random()*9000+1000));
      await pool.query(
        'UPDATE bookings SET invoice_no=?, invoice_random=?, invoice_at=NOW() WHERE booking_no=?',
        [mockInvoiceNo, mockRandom, booking.booking_no]
      );
      return { invoice_no: mockInvoiceNo, random_number: mockRandom };
    }

    // 判斷載具類型
    let carruerType = '0', carruerNum = '';
    if (booking.invoice_type === 'personal' && booking.invoice_carrier) {
      carruerType = '1'; carruerNum = booking.invoice_carrier;
    } else if (booking.invoice_type === 'personal') {
      carruerType = '';  // 雲端發票
    }

    const params = {
      MerchantID:      getMerchantId(),
      RelateNumber:    booking.booking_no,
      CustomerEmail:   booking.contact_email,
      CustomerPhone:   booking.contact_phone,
      CustomerName:    booking.contact_name,
      CarruerType:     carruerType,
      CarruerNum:      carruerNum,
      Donation:        booking.invoice_type === 'donate' ? '1' : '0',
      LoveCode:        booking.invoice_donate || '',
      Print:           booking.invoice_type === 'company' ? '1' : '0',
      TaxType:         '1',  // 應稅
      SalesAmount:     Math.round(booking.total_amount),
      InvoiceRemark:   `Studio Space 場地預約 ${booking.booking_no}`,
      ItemName:        `${booking.studio_name} 場地使用`,
      ItemCount:       '1',
      ItemWord:        '式',
      ItemPrice:       Math.round(booking.total_amount),
      ItemTaxType:     '1',
      ItemAmount:      Math.round(booking.total_amount),
      InvType:         '07',   // 一般稅額
      vat:             '1',
      TimeStamp:       Math.floor(Date.now() / 1000)
    };

    // 企業發票加上統編
    if (booking.invoice_type === 'company') {
      params.CustomerIdentifier = booking.invoice_tax_id;
    }

    params.CheckMacValue = generateCheckMac(params);

    const response = await axios.post(getApiUrl(), qs.stringify(params), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const result = qs.parse(response.data);

    if (result.RtnCode !== '1') {
      throw new Error(`發票開立失敗: ${result.RtnMsg}`);
    }

    // 更新資料庫
    await pool.query(
      'UPDATE bookings SET invoice_no=?, invoice_random=?, invoice_at=NOW() WHERE booking_no=?',
      [result.InvoiceNo, result.RandomNumber, booking.booking_no]
    );

    // 自動寄送發票通知
    const autoEmail = await getSetting('invoice_auto_email');
    if (autoEmail !== '0') {
      const updatedBooking = { ...booking, invoice_no: result.InvoiceNo };
      const NotifySvc = require('./notifyService');
      await NotifySvc.send('invoice_issued', updatedBooking);
    }

    console.log(`[Invoice] 開立成功: ${result.InvoiceNo} (${booking.booking_no})`);
    return { invoice_no: result.InvoiceNo, random_number: result.RandomNumber };
  }
};

async function getSetting(key) {
  try {
    const [[row]] = await pool.query('SELECT key_value FROM settings WHERE key_name=?', [key]);
    return row?.key_value ?? '1';
  } catch { return '1'; }
}

module.exports = InvoiceService;
