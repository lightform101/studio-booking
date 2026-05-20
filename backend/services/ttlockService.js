/**
 * TTLock 電子鎖服務
 * 文件：https://euopen.ttlock.com/document
 * 使用歐洲節點 euapi.ttlock.com（因為在 euopen.ttlock.com 申請）
 */
const crypto = require('crypto');
const qs     = require('querystring');

const BASE_URL     = 'https://euapi.ttlock.com';
const CLIENT_ID    = process.env.TTLOCK_CLIENT_ID;
const CLIENT_SECRET= process.env.TTLOCK_CLIENT_SECRET;
const USERNAME     = process.env.TTLOCK_USERNAME;   // TTLock 帳號 email
const PASSWORD_RAW = process.env.TTLOCK_PASSWORD;   // TTLock 帳號密碼（明文，程式內部做 MD5）

let _token       = null;
let _tokenExpiry = 0;

// MD5 helper
function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

// 取得 / 刷新 Access Token
async function getAccessToken() {
  if (_token && Date.now() < _tokenExpiry - 60_000) return _token;

  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type:    'password',
    username:      USERNAME,
    password:      md5(PASSWORD_RAW),
  });

  const resp = await fetch(`${BASE_URL}/oauth2/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params.toString(),
  });
  const data = await resp.json();

  if (!data.access_token) {
    throw new Error(`[TTLock] 取得 Token 失敗: ${JSON.stringify(data)}`);
  }

  _token       = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in || 7200) * 1000;
  console.log('[TTLock] Token 已更新');
  return _token;
}

// 建立臨時密碼
// startDate / endDate：JavaScript Date 物件 或 timestamp(ms)
async function createPasscode({ lockId, name, startDate, endDate }) {
  if (!CLIENT_ID || !CLIENT_SECRET || !USERNAME || !PASSWORD_RAW) {
    throw new Error('[TTLock] 環境變數未設定，跳過建立密碼');
  }

  const token = await getAccessToken();
  const now   = Date.now();

  const params = new URLSearchParams({
    clientId:       CLIENT_ID,
    accessToken:    token,
    lockId:         String(lockId),
    keyboardPwdName:name || '臨時密碼',
    startDate:      String(Number(startDate)),
    endDate:        String(Number(endDate)),
    date:           String(now),
  });

  const resp = await fetch(`${BASE_URL}/v3/keyboardPwd/createCustom`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params.toString(),
  });
  const data = await resp.json();

  if (data.errcode && data.errcode !== 0) {
    throw new Error(`[TTLock] 建立密碼失敗: ${JSON.stringify(data)}`);
  }

  console.log(`[TTLock] 密碼已建立: ${data.keyboardPwd} (id: ${data.keyboardPwdId})`);
  return {
    passcode:    String(data.keyboardPwd),
    passkeyId:   data.keyboardPwdId,
  };
}

// 刪除臨時密碼
async function deletePasscode({ lockId, keyboardPwdId }) {
  if (!CLIENT_ID || !CLIENT_SECRET || !USERNAME || !PASSWORD_RAW) return;
  if (!keyboardPwdId) return;

  try {
    const token = await getAccessToken();
    const params = new URLSearchParams({
      clientId:      CLIENT_ID,
      accessToken:   token,
      lockId:        String(lockId),
      keyboardPwdId: String(keyboardPwdId),
      deleteType:    2,   // 2 = 僅刪除雲端記錄（鎖離線時也能刪）
      date:          String(Date.now()),
    });

    const resp = await fetch(`${BASE_URL}/v3/keyboardPwd/delete`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    params.toString(),
    });
    const data = await resp.json();
    if (data.errcode && data.errcode !== 0) {
      console.warn(`[TTLock] 刪除密碼失敗 (id: ${keyboardPwdId}): ${JSON.stringify(data)}`);
    } else {
      console.log(`[TTLock] 密碼已刪除 (id: ${keyboardPwdId})`);
    }
  } catch (e) {
    console.error('[TTLock] deletePasscode error:', e.message);
  }
}

module.exports = { createPasscode, deletePasscode };
