/**
 * 藍新金流 NewebPay 服務
 * 文件: https://cwww.newebpay.com/MPG/mpg_gateway
 */
const crypto = require('crypto');
const qs     = require('querystring');

const SANDBOX_URL    = 'https://ccore.newebpay.com/MPG/mpg_gateway';
const PRODUCTION_URL = 'https://core.newebpay.com/MPG/mpg_gateway';
const REFUND_URL_DEV = 'https://ccore.newebpay.com/API/CreditCard/Cancel';
const REFUND_URL_PRD = 'https://core.newebpay.com/API/CreditCard/Cancel';

function getMerchantId()  { return process.env.NEWEBPAY_MERCHANT_ID; }
function getHashKey()     { return process.env.NEWEBPAY_HASH_KEY; }
function getHashIV()      { return process.env.NEWEBPAY_HASH_IV; }
function isProduction()   { return process.env.NEWEBPAY_ENV === 'production'; }
function getGatewayUrl()  { return isProduction() ? PRODUCTION_URL : SANDBOX_URL; }

// AES-256-CBC 加密
function aesEncrypt(data) {
  const key    = Buffer.from(getHashKey(), 'utf8');
  const iv     = Buffer.from(getHashIV(), 'utf8');
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

// AES-256-CBC 解密
function aesDecrypt(encrypted) {
  const key      = Buffer.from(getHashKey(), 'utf8');
  const iv       = Buffer.from(getHashIV(), 'utf8');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted  = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// SHA256 簽章
function sha256Sign(tradeInfo) {
  const str = `HashKey=${getHashKey()}&${tradeInfo}&HashIV=${getHashIV()}`;
  return crypto.createHash('sha256').update(str).digest('hex').toUpperCase();
}

const NewebPayService = {

  // 產生付款表單資料（前端 POST 至藍新）
  createPaymentUrl(booking) {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const tradeData = {
      MerchantID:  getMerchantId(),
      RespondType: 'JSON',
      TimeStamp:   Math.floor(Date.now() / 1000),
      Version:     '2.0',
      MerchantOrderNo: booking.booking_no,
      Amt:         Math.round(booking.total_amount),
      ItemDesc:    `${booking.studio_name} ${booking.booking_date} ${booking.start_time}-${booking.end_time}`,
      Email:       booking.contact_email,
      NotifyURL:   `${baseUrl}/api/payment/newebpay/notify`,
      ReturnURL:   `${baseUrl}/api/payment/newebpay/return`,
      CREDIT:      1,   // 信用卡
      WEBATM:      1,   // 網路 ATM
      VACC:        1,   // 虛擬帳號
      CVS:         1,   // 超商代碼
      LINEPAY:     0    // 由 LINE Pay 獨立處理
    };
    const tradeStr  = qs.stringify(tradeData);
    const tradeInfo = aesEncrypt(tradeStr);
    const tradeSha  = sha256Sign(tradeInfo);

    // 回傳前端需要的表單資訊
    return {
      gateway_url: getGatewayUrl(),
      merchant_id: getMerchantId(),
      trade_info:  tradeInfo,
      trade_sha:   tradeSha,
      version:     '2.0'
    };
  },

  // 解析藍新回調通知
  parseNotify(body) {
    try {
      if (!body.TradeInfo || !body.TradeSha)
        return { success: false, error: '缺少 TradeInfo 或 TradeSha' };

      // 驗證簽章
      const expectedSha = sha256Sign(body.TradeInfo);
      if (expectedSha !== body.TradeSha)
        return { success: false, error: '簽章驗證失敗' };

      // 解密
      const decrypted  = aesDecrypt(body.TradeInfo);
      const data       = JSON.parse(decrypted);

      if (data.Status !== 'SUCCESS')
        return { success: false, error: `付款失敗: ${data.Message}`, raw: data };

      const result = data.Result;
      return {
        success:       true,
        booking_no:    result.MerchantOrderNo,
        trade_no:      result.TradeNo,
        amount:        result.Amt,
        payment_type:  result.PaymentType,
        raw:           result
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  // 退款（信用卡取消）
  async refund(booking, refundAmount) {
    if (!booking.payment_trade_no) {
      console.warn('[NewebPay] 無交易序號，跳過退款');
      return { trade_no: null };
    }
    const axios = require('axios');
    const refundUrl = isProduction() ? REFUND_URL_PRD : REFUND_URL_DEV;
    const postData = qs.stringify({
      MerchantID_:  getMerchantId(),
      PostData_:    aesEncrypt(qs.stringify({
        RespondType:     'JSON',
        Version:         '1.0',
        Amt:             Math.round(refundAmount),
        MerchantOrderNo: booking.booking_no,
        IndexType:       1,
        TradeNo:         booking.payment_trade_no
      }))
    });
    try {
      const resp = await axios.post(refundUrl, postData,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      const result = JSON.parse(aesDecrypt(resp.data.Result));
      console.log(`[NewebPay] 退款成功: ${booking.booking_no} NT$${refundAmount}`);
      return { trade_no: result.TradeNo };
    } catch (e) {
      console.error('[NewebPay] 退款失敗:', e.message);
      return { trade_no: null, error: e.message };
    }
  }
};

module.exports = NewebPayService;
