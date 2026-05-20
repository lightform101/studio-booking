/**
 * 後台：系統設定 Routes
 */
const router    = require('express').Router();
const auth      = require('../../middleware/auth');
const { pool }  = require('../../config/database');
const EmailSvc  = require('../../services/emailService');
const SmsSvc    = require('../../services/smsService');
const TTLockSvc = require('../../services/ttlockService');
const fs        = require('fs');
const path      = require('path');
const mysql     = require('mysql2/promise');

router.use(auth);

// 取得所有設定
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM settings ORDER BY key_name ASC');
    const settings = {};
    rows.forEach(r => { settings[r.key_name] = r.key_value; });
    res.json({ success: true, data: settings });
  } catch (err) { next(err); }
});

// 批次更新設定
router.put('/', async (req, res, next) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object')
      return res.status(400).json({ success: false, message: '請提供 settings 物件' });

    for (const [key, value] of Object.entries(settings)) {
      await pool.query(
        'INSERT INTO settings (key_name, key_value) VALUES (?,?) ON DUPLICATE KEY UPDATE key_value=?',
        [key, value, value]
      );
    }

    // 同步更新環境變數讓 emailService 即時生效
    const smtpMap = {
      smtp_host:       'SMTP_HOST',
      smtp_port:       'SMTP_PORT',
      smtp_user:       'SMTP_USER',
      smtp_pass:       'SMTP_PASS',
      smtp_from_email: 'EMAIL_FROM',
      smtp_from_name:  'EMAIL_FROM_NAME',
    };
    let smtpChanged = false;
    for (const [dbKey, envKey] of Object.entries(smtpMap)) {
      if (dbKey in settings) {
        process.env[envKey] = settings[dbKey];
        smtpChanged = true;
      }
    }
    // 重置 transporter，讓新設定生效
    if (smtpChanged) EmailSvc.resetTransporter?.();

    res.json({ success: true, message: '設定已更新' });
  } catch (err) { next(err); }
});

// 測試 Email
router.post('/test-email', async (req, res, next) => {
  try {
    const { to } = req.body;
    // 取得網站名稱
    const [[nameSetting]] = await pool.query(
      "SELECT key_value FROM settings WHERE key_name='smtp_from_name'"
    ).catch(() => [[null]]);
    const siteName = nameSetting?.key_value || process.env.EMAIL_FROM_NAME || 'LightForm Studio';

    await EmailSvc.send({
      to: to || req.admin.email,
      subject: `【${siteName}】Email 設定測試`,
      html: `<h2>✅ 測試成功！</h2><p>您的 Email 通知設定正常運作。</p><p style="color:#888;font-size:.85rem;">— ${siteName}</p>`
    });
    res.json({ success: true, message: `測試信已發送至 ${to || req.admin.email}` });
  } catch (err) { next(err); }
});

// 測試 SMS
router.post('/test-sms', async (req, res, next) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: '請提供手機號碼' });
    await SmsSvc.send(phone, '【Studio Space】SMS 設定測試成功！');
    res.json({ success: true, message: `測試簡訊已發送至 ${phone}` });
  } catch (err) { next(err); }
});

// TTLock 連線診斷
router.post('/test-ttlock', async (req, res) => {
  const report = [];
  try {
    // 1. 檢查環境變數
    const clientId  = process.env.TTLOCK_CLIENT_ID;
    const clientSec = process.env.TTLOCK_CLIENT_SECRET;
    const username  = process.env.TTLOCK_USERNAME;
    const password  = process.env.TTLOCK_PASSWORD;
    report.push(`CLIENT_ID:  ${clientId  ? '✅ 已設定' : '❌ 未設定'}`);
    report.push(`CLIENT_SEC: ${clientSec ? '✅ 已設定' : '❌ 未設定'}`);
    report.push(`USERNAME:   ${username  ? '✅ ' + username : '❌ 未設定'}`);
    report.push(`PASSWORD:   ${password  ? '✅ 已設定' : '❌ 未設定'}`);

    if (!clientId || !clientSec || !username || !password) {
      return res.json({ success: false, report: report.join('\n'), message: '環境變數未設定完整' });
    }

    // 2. 確保欄位存在（直接 ALTER TABLE，若已存在則略過）
    const colChecks = [
      `ALTER TABLE studios  ADD COLUMN ttlock_lock_id    BIGINT      DEFAULT NULL COMMENT 'TTLock Lock ID'`,
      `ALTER TABLE bookings ADD COLUMN ttlock_passcode   VARCHAR(20) DEFAULT NULL COMMENT 'TTLock 臨時密碼'`,
      `ALTER TABLE bookings ADD COLUMN ttlock_passcode_id BIGINT     DEFAULT NULL COMMENT 'TTLock keyboardPwdId'`,
    ];
    for (const sql of colChecks) {
      try { await pool.query(sql); report.push(`✅ 欄位已建立: ${sql.match(/ADD COLUMN (\w+)/)[1]}`); }
      catch(e) {
        if (e.code === 'ER_DUP_FIELDNAME') report.push(`⏭ 欄位已存在: ${sql.match(/ADD COLUMN (\w+)/)[1]}`);
        else throw e;
      }
    }

    // 3. 顯示場地 lock_id
    const [studios] = await pool.query('SELECT id, name, ttlock_lock_id FROM studios');
    studios.forEach(s => {
      report.push(`場地 "${s.name}": lock_id = ${s.ttlock_lock_id || '❌ 未設定'}`);
    });

    // 3. 測試取得 Token（同時測試兩個節點）
    report.push('--- 測試 TTLock API Token ---');
    const crypto = require('crypto');
    const axios  = require('axios');
    const qs     = require('querystring');
    const md5 = str => crypto.createHash('md5').update(str).digest('hex');
    const tokenPayload = qs.stringify({
      client_id: clientId, client_secret: clientSec,
      grant_type: 'password', username, password: md5(password)
    });
    const endpoints = [
      'https://euapi.ttlock.com/oauth2/token',
      'https://api.ttlock.com/oauth2/token',
    ];
    let tokenSuccess = false;
    for (const url of endpoints) {
      try {
        report.push(`嘗試: ${url}`);
        const tokenResp = await axios.post(url, tokenPayload,
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000 }
        );
        const tokenData = tokenResp.data;
        if (tokenData.access_token) {
          report.push(`✅ Token 取得成功！請使用此節點: ${url}`);
          tokenSuccess = true;
          break;
        } else {
          report.push(`❌ 回應: ${JSON.stringify(tokenData)}`);
        }
      } catch(e) {
        const status = e.response?.status;
        const body   = JSON.stringify(e.response?.data)?.slice(0, 200);
        report.push(`❌ ${status || e.message} → ${body || ''}`);
      }
    }
    if (!tokenSuccess) { report.push('❌ 兩個節點均失敗'); }
    else {
      // 4. 查詢帳號下的鎖清單（多種格式嘗試）
      try {
        report.push('--- 查詢鎖清單 ---');
        const tokenResp2 = await axios.post(
          'https://euapi.ttlock.com/oauth2/token',
          qs.stringify({ client_id: clientId, client_secret: clientSec, grant_type: 'password', username, password: md5(password) }),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000 }
        );
        const token2 = tokenResp2.data.access_token;
        const now = Date.now();
        // 顯示 token 格式（助於診斷編碼問題）
        report.push(`Token 長度: ${token2.length}, 前10碼: ${token2.slice(0,10)}, 是否含特殊字元: ${/[^a-zA-Z0-9\-_]/.test(token2) ? '是' : '否'}`);
        // 明確 URL encode
        const encToken = encodeURIComponent(token2);
        const encClient = encodeURIComponent(clientId);

        // 方式A: GET 最小化（只帶3個必要參數，避免多餘參數被拒）
        const urlA = `https://euapi.ttlock.com/v3/lock/list?clientId=${encClient}&accessToken=${encToken}&date=${now}`;
        report.push(`嘗試A GET(最小): ${urlA.slice(0, 100)}...`);
        let lockData = null;
        try {
          const rA = await axios.get(urlA, {
            headers: { 'User-Agent': 'TTLockApp/1.0', 'Accept': '*/*' },
            timeout: 8000
          });
          lockData = rA.data;
          report.push(`A 回應: ${JSON.stringify(lockData).slice(0, 300)}`);
        } catch(eA) {
          report.push(`A 失敗 (${eA.response?.status}): 改試方式B(含分頁)`);
          // 方式B: GET 含 pageNum/pageSize
          try {
            const urlB = `https://euapi.ttlock.com/v3/lock/list?clientId=${encClient}&accessToken=${encToken}&pageNum=1&pageSize=20&date=${now}`;
            const rB = await axios.get(urlB, {
              headers: { 'User-Agent': 'TTLockApp/1.0', 'Accept': 'application/json' },
              timeout: 8000
            });
            lockData = rB.data;
            report.push(`B 回應: ${JSON.stringify(lockData).slice(0, 300)}`);
          } catch(eB) {
            report.push(`B 失敗 (${eB.response?.status}): 改試方式C(POST)`);
            // 方式C: POST（api.ttlock.com 全球節點）
            try {
              const rC = await axios.post(
                'https://api.ttlock.com/v3/lock/list',
                qs.stringify({ clientId, accessToken: token2, pageNum: 1, pageSize: 20, date: now }),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'TTLockApp/1.0' }, timeout: 8000 }
              );
              lockData = rC.data;
              report.push(`C 回應(全球節點): ${JSON.stringify(lockData).slice(0, 300)}`);
            } catch(eC) {
              const body = eC.response?.data;
              report.push(`C 失敗 (${eC.response?.status}): ${typeof body === 'string' ? body.slice(0,150) : JSON.stringify(body)}`);
              report.push('❌ 三種格式均無法查詢鎖清單 → 帳號可能未開放 v3 API 權限');
            }
          }
        }

        if (lockData) {
          if (Array.isArray(lockData.list) && lockData.list.length > 0) {
            lockData.list.forEach(l => {
              report.push(`🔑 ${l.lockName} → lockId=${l.lockId} MAC=${l.lockMac}`);
            });
          } else if (lockData.errcode && lockData.errcode !== 0) {
            report.push(`❌ API 錯誤 ${lockData.errcode}: ${lockData.errmsg}`);
          } else {
            report.push(`ℹ️ 無鎖具或欄位不同: ${JSON.stringify(lockData).slice(0,200)}`);
          }
        }
      } catch(e) {
        report.push(`❌ 查詢鎖清單例外: ${e.message}`);
      }

      // 5. 直接測試密碼建立（多節點 + 帶 User-Agent）
      try {
        report.push('--- 測試建立臨時密碼 ---');
        const [[testStudio]] = await pool.query(
          'SELECT id, name, ttlock_lock_id FROM studios WHERE ttlock_lock_id IS NOT NULL LIMIT 1'
        );
        if (!testStudio) {
          report.push('⏭ 沒有場地設定了 Lock ID，跳過密碼測試');
        } else {
          report.push(`場地: ${testStudio.name} (lockId=${testStudio.ttlock_lock_id})`);
          const tokenResp3 = await axios.post(
            'https://euapi.ttlock.com/oauth2/token',
            qs.stringify({ client_id: clientId, client_secret: clientSec, grant_type: 'password', username, password: md5(password) }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000 }
          );
          const token3 = tokenResp3.data.access_token;
          const startTest = Date.now() + 60_000;
          const endTest   = Date.now() + 2 * 60_000;
          const pwdBody = qs.stringify({
            clientId, accessToken: token3,
            lockId: String(testStudio.ttlock_lock_id),
            keyboardPwdType: '3',
            keyboardPwdName: '診斷測試密碼',
            startDate: String(startTest),
            endDate:   String(endTest),
            date:      String(Date.now()),
          });
          // 用原生 https 模組，強制帶 Content-Length（避免 Tomcat 7 拒絕 chunked encoding）
          const https = require('https');
          const pwdBuf = Buffer.from(pwdBody, 'utf8');

          const httpsPost = (hostname, path, body) => new Promise((resolve, reject) => {
            const opts = {
              hostname, path, method: 'POST',
              headers: {
                'Content-Type':   'application/x-www-form-urlencoded',
                'Content-Length': body.length,
                'User-Agent':     'Mozilla/5.0',
                'Accept':         '*/*',
                'Connection':     'close',
              },
              timeout: 10000,
            };
            const req = https.request(opts, res => {
              let raw = '';
              res.on('data', d => raw += d);
              res.on('end', () => resolve({ status: res.statusCode, body: raw }));
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
            req.write(body);
            req.end();
          });

          const endpoints = [
            { host: 'euapi.ttlock.com', path: '/v3/keyboardPwd/add' },
            { host: 'api.ttlock.com',   path: '/v3/keyboardPwd/add' },
          ];
          let pwdSuccess = false;
          for (const ep of endpoints) {
            try {
              report.push(`嘗試 native https: ${ep.host}${ep.path}`);
              const r = await httpsPost(ep.host, ep.path, pwdBuf);
              report.push(`狀態碼: ${r.status}`);
              report.push(`回應內容: ${r.body.slice(0, 300)}`);
              if (r.status === 200) {
                try {
                  const d = JSON.parse(r.body);
                  if (d.errcode === 0 || d.keyboardPwd != null) {
                    report.push(`✅ 密碼建立成功! 密碼=${d.keyboardPwd} id=${d.keyboardPwdId}`);
                    pwdSuccess = true;
                  } else {
                    report.push(`❌ errcode=${d.errcode}: ${d.errmsg}`);
                  }
                } catch(_) { report.push('（回應非 JSON）'); }
                break;
              }
            } catch(ep_e) {
              report.push(`❌ ${ep.host} 失敗: ${ep_e.message}`);
            }
          }
          if (!pwdSuccess) report.push('❌ 所有節點均無法建立密碼');
        }
      } catch(e) {
        const errBody = e.response?.data;
        report.push(`❌ 密碼測試失敗 (${e.response?.status || e.message}): ${typeof errBody === 'string' ? errBody.slice(0,200) : JSON.stringify(errBody)}`);
      }
    }

    res.json({ success: true, report: report.join('\n') });
  } catch (e) {
    report.push(`❌ 例外錯誤: ${e.message}`);
    res.json({ success: false, report: report.join('\n'), message: e.message });
  }
});

// 手動觸發 TTLock 密碼建立（診斷用）
router.post('/trigger-ttlock/:bookingId', async (req, res) => {
  const report = [];
  try {
    const bookingId = req.params.bookingId;
    const [[booking]] = await pool.query(
      `SELECT b.*, s.name as studio_name, s.ttlock_lock_id
       FROM bookings b LEFT JOIN studios s ON b.studio_id = s.id
       WHERE b.id = ?`, [bookingId]
    );
    if (!booking) return res.json({ success: false, message: '找不到訂單' });

    report.push(`訂單: ${booking.booking_no}`);
    report.push(`狀態: ${booking.status}`);
    report.push(`場地: ${booking.studio_name}`);
    report.push(`Lock ID: ${booking.ttlock_lock_id || '❌ 未設定'}`);
    report.push(`日期: ${booking.booking_date} ${booking.start_time}~${booking.end_time}`);

    if (!booking.ttlock_lock_id) {
      return res.json({ success: false, report: report.join('\n'), message: '場地未設定 Lock ID' });
    }

    const dayjs = require('dayjs');
    const dateStr   = dayjs(booking.booking_date).format('YYYY-MM-DD');
    const startDate = dayjs(`${dateStr} ${String(booking.start_time).slice(0,5)}`).subtract(15,'minute').valueOf();
    const endDate   = dayjs(`${dateStr} ${String(booking.end_time).slice(0,5)}`).add(15,'minute').valueOf();
    report.push(`有效期: ${new Date(startDate).toLocaleString()} ~ ${new Date(endDate).toLocaleString()}`);

    report.push('--- 呼叫 TTLock API ---');
    const { passcode, passkeyId } = await TTLockSvc.createPasscode({
      lockId: booking.ttlock_lock_id,
      name:   `${booking.booking_no} ${booking.contact_name}`,
      startDate, endDate,
    });
    report.push(`✅ 密碼建立成功: ${passcode} (id: ${passkeyId})`);

    await pool.query(
      'UPDATE bookings SET ttlock_passcode=?, ttlock_passcode_id=? WHERE id=?',
      [passcode, passkeyId, booking.id]
    );

    report.push('--- 寄送 Email ---');
    await EmailSvc.sendAccessCode({ ...booking }, passcode);
    report.push(`✅ Email 已寄出 → ${booking.contact_email}`);

    res.json({ success: true, report: report.join('\n') });
  } catch(e) {
    report.push(`❌ 錯誤: ${e.message}`);
    res.json({ success: false, report: report.join('\n'), message: e.message });
  }
});

// 執行 DB Migration
router.post('/run-migration', async (req, res, next) => {
  const IGNORABLE = new Set(['ER_DUP_FIELDNAME', 'ER_TABLE_EXISTS_ERROR', 'ER_DUP_ENTRY']);
  const migrationFiles = [
    '001_schema.sql','002_seed.sql','003_studio_images.sql',
    '004_appearance.sql','005_studio_rates.sql','006_promotions.sql','007_ttlock.sql',
  ];
  const logs = [];
  try {
    for (const file of migrationFiles) {
      const filePath = path.join(__dirname, '../../migrations', file);
      if (!fs.existsSync(filePath)) { logs.push(`⏭ 跳過（找不到）: ${file}`); continue; }
      const statements = fs.readFileSync(filePath, 'utf8')
        .split(';').map(s => s.trim()).filter(s => s && !s.startsWith('--'));
      let ok = 0, skipped = 0;
      for (const sql of statements) {
        try { await pool.query(sql); ok++; }
        catch (err) {
          if (IGNORABLE.has(err.code)) { skipped++; }
          else { logs.push(`❌ 錯誤 (${file}): ${err.message}`); throw err; }
        }
      }
      logs.push(`✅ ${file}（${ok} 條執行，${skipped} 條略過）`);
    }
    res.json({ success: true, message: 'Migration 完成', log: logs.join('\n') });
  } catch (err) {
    res.json({ success: false, message: err.message, log: logs.join('\n') });
  }
});

module.exports = router;
