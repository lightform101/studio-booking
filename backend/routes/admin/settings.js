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

    // 3. 測試取得 Token
    report.push('--- 測試 TTLock API Token ---');
    const crypto = require('crypto');
    const axios  = require('axios');
    const qs     = require('querystring');
    const md5 = str => crypto.createHash('md5').update(str).digest('hex');
    const tokenResp = await axios.post(
      'https://euapi.ttlock.com/oauth2/token',
      qs.stringify({ client_id: clientId, client_secret: clientSec, grant_type: 'password', username, password: md5(password) }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const tokenData = tokenResp.data;
    if (tokenData.access_token) {
      report.push(`✅ Token 取得成功（${tokenData.access_token.slice(0,10)}...）`);
    } else {
      report.push(`❌ Token 取得失敗: ${JSON.stringify(tokenData)}`);
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
