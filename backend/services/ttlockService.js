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

  // 使用 /v3/keyboardPwd/get 取得隨機密碼（TTLock 算法生成，不需 Gateway）
  // keyboardPwdType=3 = 限時密碼；TTLock 時間只精確到小時，須對齊整點
  const startMs    = Math.floor(Number(startDate) / 3600000) * 3600000;          // 捨去到整點
  const endMsRaw   = Math.ceil(Number(endDate)   / 3600000) * 3600000;          // 進位到整點
  const endMs      = Math.max(endMsRaw, startMs + 3_600_000);                    // 確保至少 1 小時差距

  const body = qs.stringify({
    clientId:        CLIENT_ID(),
    accessToken:     token,
    lockId:          String(lockId),
    keyboardPwdType: '3',
    keyboardPwdName: name || '臨時密碼',
    startDate:       String(startMs),
    endDate:         String(endMs),
    date:            String(Date.now()),
  });
  const bodyBuf = Buffer.from(body, 'utf8');

  // 用原生 https 模組確保 Content-Length 正確（避免老 Tomcat 拒絕 chunked）
  const https = require('https');
  const data = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'euapi.ttlock.com',
      path:     '/v3/keyboardPwd/get',
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': bodyBuf.length,
        'User-Agent':     'Mozilla/5.0',
        'Accept':         '*/*',
        'Connection':     'close',
      },
      timeout: 12000,
    }, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch(_) { reject(new Error(`TTLock 非 JSON 回應: ${raw.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('TTLock API timeout')); });
    req.write(bodyBuf);
    req.end();
  });

  if (data.errcode && data.errcode !== 0) {
    throw new Error(`[TTLock] 建立密碼失敗 (errcode ${data.errcode}): ${data.errmsg || JSON.stringify(data)}`);
  }

  // TTLock 回傳 keyboardPwd（生成的密碼）與 keyboardPwdId
  const pwd = data.keyboardPwd ?? data.keyboard_pwd ?? data.pwd;
  const pwdId = data.keyboardPwdId ?? data.keyboard_pwd_id;

  if (!pwd) {
    throw new Error(`[TTLock] 回應未包含密碼: ${JSON.stringify(data)}`);
  }

  console.log(`[TTLock] 密碼已建立 passkeyId=${pwdId}`);
  return {
    passcode:         String(pwd),
    passkeyId:        pwdId,
    effectiveStartMs: startMs,
    effectiveEndMs:   endMs,
  };
}

async function deletePasscode({ lockId, keyboardPwdId }) {
  if (!CLIENT_ID() || !keyboardPwdId) return;
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
    throw new Error(`[TTLock] 刪除密碼失敗 (errcode ${data.errcode}): ${data.errmsg}`);
  }
  console.log(`[TTLock] 密碼已刪除 passkeyId=${keyboardPwdId}`);
}

/**
 * 為預約刪除 TTLock 密碼並清除 DB 記錄。
 * 失敗時 throw，讓呼叫端決定如何處理。
 */
async function deleteTTLockForBooking(booking) {
  if (!booking.ttlock_passcode_id) return; // 無密碼，不需刪
  const { pool } = require('../config/database');

  const [[studio]] = await pool.query(
    'SELECT ttlock_lock_id FROM studios WHERE id=?',
    [booking.studio_id]
  );
  if (!studio?.ttlock_lock_id) return;

  await deletePasscode({
    lockId:        studio.ttlock_lock_id,
    keyboardPwdId: booking.ttlock_passcode_id,
  });

  await pool.query(
    'UPDATE bookings SET ttlock_passcode=NULL, ttlock_passcode_id=NULL WHERE id=?',
    [booking.id]
  );
}

/**
 * 為已確認預約建立 TTLock 密碼、更新 DB、寄送進門碼信件。
 * 呼叫前確保 booking.status === 'confirmed'。
 * 失敗時 throw，讓呼叫端決定是否 catch。
 */
async function createTTLockForBooking(booking) {
  const { pool }        = require('../config/database');
  const EmailSvc        = require('./emailService');
  const dayjs           = require('dayjs');

  const [[studio]] = await pool.query(
    'SELECT ttlock_lock_id, name FROM studios WHERE id=?',
    [booking.studio_id]
  );
  if (!studio?.ttlock_lock_id) return; // 場地未設 lock_id，靜默跳過

  const dateStr  = dayjs(booking.booking_date).format('YYYY-MM-DD');
  const sHHMM    = String(booking.start_time).slice(0, 5);
  const eHHMM    = String(booking.end_time).slice(0, 5);
  // 以固定 +08:00（台灣）解析牆上時間，避免伺服器時區(UTC)導致 8 小時偏移
  const startMs  = new Date(`${dateStr}T${sHHMM}:00+08:00`).getTime() - 15 * 60 * 1000;
  const endMs    = new Date(`${dateStr}T${eHHMM}:00+08:00`).getTime() + 15 * 60 * 1000;

  const { passcode, passkeyId, effectiveStartMs, effectiveEndMs } = await createPasscode({
    lockId:    studio.ttlock_lock_id,
    name:      `${booking.booking_no} ${booking.contact_name}`,
    startDate: startMs,
    endDate:   endMs,
  });

  await pool.query(
    'UPDATE bookings SET ttlock_passcode=?, ttlock_passcode_id=? WHERE id=?',
    [passcode, passkeyId, booking.id]
  );

  await EmailSvc.sendAccessCode(
    { ...booking, studio_name: studio.name },
    passcode,
    { validFromMs: effectiveStartMs, validUntilMs: effectiveEndMs }
  );
  console.log(`[TTLock] 進門碼已建立並寄出 booking=${booking.booking_no} passkeyId=${passkeyId}`);
}

module.exports = { createPasscode, deletePasscode, createTTLockForBooking, deleteTTLockForBooking };
