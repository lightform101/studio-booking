/**
 * LINE Pay 服務
 * API 文件: https://pay.line.me/tw/developers/apis/onlineApis
 */
const axios  = require('axios');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const SANDBOX_URL    = 'https://sandbox-api-pay.line.me';
const PRODUCTION_URL = 'https://api-pay.line.me';

function getChannelId()     { return process.env.LINEPAY_CHANNEL_ID; }
function getChannelSecret() { return process.env.LINEPAY_CHANNEL_SECRET; }
function isProduction()     { return process.env.LINEPAY_ENV === 'production'; }
function getBaseUrl()       { return isProduction() ? PRODUCTION_URL : SANDBOX_URL; }

// 產生 HMAC-SHA256 簽章
function generateSignature(channelSecret, uri, body, nonce) {
  const text   = channelSecret + uri + JSON.stringify(body) + nonce;
  return crypto.createHmac('sha256', channelSecret).update(text).digest('base64');
}

function getHeaders(uri, body) {
  const nonce     = uuidv4();
  const signature = generateSignature(getChannelSecret(), uri, body, nonce);
  return {
    'Content-Type':                  'application/json',
    'X-LINE-ChannelId':              getChannelId(),
    'X-LINE-Authorization-Nonce':    nonce,
    'X-LINE-Authorization':          signature
  };
}

const LinePayService = {

  // 建立 LINE Pay 付款請求
  async requestPayment(booking) {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const uri     = '/v3/payments/request';
    const body    = {
      amount:   Math.round(booking.total_amount),
      currency: 'TWD',
      orderId:  booking.booking_no,
      packages: [{
        id:       `pkg-${booking.booking_no}`,
        amount:   Math.round(booking.total_amount),
        name:     `LightForm Studio - ${booking.studio_name}`,
        products: [{
          name:     `${booking.studio_name} ${booking.booking_date}`,
          quantity: 1,
          price:    Math.round(booking.total_amount)
        }]
      }],
      redirectUrls: {
        confirmUrl: `${baseUrl}/api/payment/linepay/confirm`,
        cancelUrl:  `${baseUrl}/api/payment/linepay/cancel`
      }
    };

    const response = await axios.post(
      `${getBaseUrl()}${uri}`, body,
      { headers: getHeaders(uri, body) }
    );
    const data = response.data;
    if (data.returnCode !== '0000') {
      throw new Error(`LINE Pay Request 失敗: ${data.returnMessage}`);
    }
    return {
      transactionId: data.info.transactionId,
      paymentUrl:    data.info.paymentUrl.web
    };
  },

  // 確認付款
  async confirmPayment(transactionId, orderId) {
    const booking = await require('../models/BookingModel').findByNo(orderId);
    if (!booking) throw new Error('找不到訂單');

    const uri  = `/v3/payments/${transactionId}/confirm`;
    const body = { amount: Math.round(booking.total_amount), currency: 'TWD' };
    const response = await axios.post(
      `${getBaseUrl()}${uri}`, body,
      { headers: getHeaders(uri, body) }
    );
    const data = response.data;
    if (data.returnCode !== '0000') {
      throw new Error(`LINE Pay Confirm 失敗: ${data.returnMessage}`);
    }
    return data.info;
  }
};

module.exports = LinePayService;
