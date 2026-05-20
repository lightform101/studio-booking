/**
 * TTLock 電子鎖服務
 * 使用歐洲節點：euapi.ttlock.com
 */
const crypto = require('crypto');
const axios  = require('axios');
const qs     = require('querystring');

const BASE_URL      = 'https://euapi.ttlock.com';
const CLIENT_ID     = () => process.env.TTLOCK_CLIENT_ID;
const CLIENT_SECRET = () => process.env.TTLOCK_CLIENT_SECRET;
const USERNAME      = () => process.env.TTLOCK_USERNAME;
const PASSWORD_RAW  = () => process.env.TTLOCK_PASSWORD;

let _token       = null;
let _tokenExpiry = 0;

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

async function getAccessToken() {
  if (_token && Date.now() < _tokenExpiry - 60_000) return _token;

  const resp = await axios.post(
    `${BASE_URL}/oauth2/token`,
    qs.stringify({
      client_id:     CLIENT_ID(),
      client_secret: CLIENT_SECRET(),
      grant_type:    'password',
      username:      USERNAME(),
      password:      md5(PASSWORD_RAW()),
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const data = resp.data;
  if (!data.access_token) {
    throw new Error(`[TTLock] 取得 Token 失敗: ${JSON.stringify(data)}`);
  }

  _token       = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in || 7200) * 1000;
  console.log('[TTLock] Token 已更新');
  return _token;
}

async function createPasscode({ lockId, name, startDate, endDate }) {
  if (!CLIENT_ID() || !CLIENT_SECRET() || !USERNAME() || !PASSWORD_RAW()) {
    throw new Error('[TTLock] 環境變數未設定完整');
  }

  const token = await getAccessToken();

  // 使用 /v3/keyboardPwd/add 讓 TTLock 自動生成密碼
  // keyboardPwdType=3 = 限時密碼（有 startDate / endDate）
  const resp = await axios.post(
    `${BASE_URL}/v3/keyboardPwd/add`,
    qs.stringify({
      clientId:        CLIENT_ID(),
      accessToken:     token,
      lockId:          String(lockId),
      keyboardPwdType: '3',
      keyboardPwdName: name || '臨時密碼',
      startDate:       String(Number(startDate)),
      endDate:         String(Number(endDate)),
      date:            String(Date.now()),
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const data = resp.data;
  console.log('[TTLock] keyboardPwd/add 回應:', JSON.stringify(data));

  if (data.errcode && data.errcode !== 0) {
    throw new Error(`[TTLock] 建立密碼失敗 (errcode ${data.errcode}): ${data.errmsg || JSON.stringify(data)}`);
  }

  // TTLock 回傳 keyboardPwd（生成的密碼）與 keyboardPwdId
  const pwd = data.keyboardPwd ?? data.keyboard_pwd ?? data.pwd;
  const pwdId = data.keyboardPwdId ?? data.keyboard_pwd_id;

  if (!pwd) {
    throw new Error(`[TTLock] 回應未包含密碼: ${JSON.stringify(data)}`);
  }

  console.log(`[TTLock] 密碼已建立: ${pwd} (id: ${pwdId})`);
  return {
    passcode:  String(pwd),
    passkeyId: pwdId,
  };
}

async function deletePasscode({ lockId, keyboardPwdId }) {
  if (!CLIENT_ID() || !keyboardPwdId) return;
  try {
    const token = await getAccessToken();
    const resp = await axios.post(
      `${BASE_URL}/v3/keyboardPwd/delete`,
      qs.stringify({
        clientId:      CLIENT_ID(),
        accessToken:   token,
        lockId:        String(lockId),
        keyboardPwdId: String(keyboardPwdId),
        deleteType:    2,
        date:          String(Date.now()),
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const data = resp.data;
    if (data.errcode && data.errcode !== 0) {
      console.warn(`[TTLock] 刪除密碼失敗: ${JSON.stringify(data)}`);
    } else {
      console.log(`[TTLock] 密碼已刪除 (id: ${keyboardPwdId})`);
    }
  } catch(e) {
    console.error('[TTLock] deletePasscode error:', e.message);
  }
}

module.exports = { createPasscode, deletePasscode };
