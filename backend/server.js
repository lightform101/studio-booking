/**
 * LightForm Studio 預約系統 - 主伺服器
 */
require('dotenv').config();

// ─── Fail-fast：必要環境變數檢查 ───────────────────
const REQUIRED_ENV = ['JWT_SECRET'];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length) {
  console.error(`[啟動失敗] 缺少必要環境變數：${missingEnv.join(', ')}`);
  process.exit(1);
}

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const path        = require('path');

const { testConnection } = require('./config/database');
const scheduler          = require('./services/schedulerService');

// ─── Routes ────────────────────────────────────────
const studiosRouter      = require('./routes/studios');
const bookingsRouter     = require('./routes/bookings');
const availabilityRouter = require('./routes/availability');
const paymentRouter      = require('./routes/payment');
const appearanceRouter   = require('./routes/appearance');
const adminAuthRouter    = require('./routes/admin/auth');
const adminBookingsRouter= require('./routes/admin/bookings');
const adminStudiosRouter = require('./routes/admin/studios');
const adminImagesRouter  = require('./routes/admin/studio_images');
const adminRevenueRouter = require('./routes/admin/revenue');
const adminSettingsRouter    = require('./routes/admin/settings');
const adminPromotionsRouter  = require('./routes/admin/promotions');
const promotionsRouter       = require('./routes/promotions');
const adminCarouselRouter    = require('./routes/admin/carousel');
const carouselRouter         = require('./routes/carousel');
const adminEventsRouter      = require('./routes/admin/events');
const eventsRouter           = require('./routes/events');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Security Middleware ────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:      ["'self'"],
      scriptSrc:       ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc:        ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc:          ["'self'", "data:", "blob:", "*"],
      connectSrc:      ["'self'", "https://lightformstudio.com.tw"],
      fontSrc:         ["'self'", "data:", "https://fonts.gstatic.com"],
      objectSrc:       ["'none'"],
      frameAncestors:  ["'none'"],
      // 允許 HTML inline 事件屬性（onsubmit, onclick 等），Helmet v7 預設為 'none' 會封鎖登入按鈕
      scriptSrcAttr:   ["'unsafe-inline'"],
      // 允許藍新金流表單提交（沙盒 + 正式站）
      formAction:      ["'self'", "https://core.newebpay.com", "https://ccore.newebpay.com"],
    }
  }
}));
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (process.env.BASE_URL
        ? [process.env.BASE_URL, 'https://lightformstudio.com.tw']
        : ['https://lightformstudio.com.tw'])
    : '*',
  credentials: true
}));

// ─── Rate Limiting ──────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分鐘
  max: 100,
  message: { success: false, message: '請求過於頻繁，請稍後再試' }
});
// 建立預約專用的速率限制已移至 routes/bookings.js（只套用在 POST /）

app.use('/api/', apiLimiter);

// ─── Body Parser ────────────────────────────────────
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true, limit: '512kb' }));

// ─── Static Files（前台網頁 + 上傳圖片）───────────────
app.use(express.static(path.join(__dirname, '../')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── API Routes ─────────────────────────────────────
app.use('/api/studios',       studiosRouter);
app.use('/api/availability',  availabilityRouter);
// 注意：bookingLimiter 只套用在「建立預約」(POST /)，查詢與取消不受此限
// （避免客戶查詢自己訂單幾次後就無法取消的問題），limiter 已移至 bookings.js 內
app.use('/api/bookings',      bookingsRouter);
app.use('/api/payment',       paymentRouter);
app.use('/api/appearance',    appearanceRouter);
app.use('/api/promotions',    promotionsRouter);
app.use('/api/carousel',      carouselRouter);
app.use('/api/events',        eventsRouter);

// Admin Routes
app.use('/api/admin/auth',     adminAuthRouter);
app.use('/api/admin/bookings', adminBookingsRouter);
app.use('/api/admin/studios',  adminStudiosRouter);
app.use('/api/admin/studios',  adminImagesRouter);   // 照片管理（:id/images）
app.use('/api/admin',          adminImagesRouter);   // 照片操作（/images/:imageId）
app.use('/api/admin/revenue',  adminRevenueRouter);
app.use('/api/admin/settings',    adminSettingsRouter);
app.use('/api/admin/promotions',  adminPromotionsRouter);
app.use('/api/admin/carousel',    adminCarouselRouter);
app.use('/api/admin/events',      adminEventsRouter);

// ─── Health Check ───────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'LightForm Studio API 正常運行',
    version: '1.0.0',
    time: new Date().toISOString()
  });
});

// ─── 404 Handler ────────────────────────────────────
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, message: '找不到此 API 端點' });
});

// ─── SPA Fallback（前台路由）────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

// ─── Global Error Handler ────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  const status = err.status || 500;
  // 在 production 中仍提供 DB 錯誤代碼，方便管理員排查（不洩漏敏感資訊）
  const extra = (err.code && err.code.startsWith('ER_'))
    ? ` (${err.code})`
    : '';
  res.status(status).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? `伺服器錯誤，請稍後再試${extra}`
      : err.message
  });
});

// ─── Startup ─────────────────────────────────────────
async function runMigrationsOnStart() {
  const fs   = require('fs');
  const path = require('path');
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     || process.env.MYSQL_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || process.env.MYSQL_PORT) || 3306,
    user:     process.env.DB_USER     || process.env.MYSQL_USERNAME  || 'root',
    password: process.env.DB_PASS     || process.env.MYSQL_PASSWORD  || '',
    database: process.env.DB_NAME     || process.env.MYSQL_DATABASE  || 'studio_booking',
    multipleStatements: false
  });
  const IGNORABLE = new Set(['ER_DUP_FIELDNAME','ER_TABLE_EXISTS_ERROR','ER_DUP_ENTRY']);
  const migrDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrDir)
    // 跳過種子檔（seed）：種子資料只在初次建置時手動執行一次，
    // 不可每次部署重跑，否則會把已刪除/已修改的資料（如刪掉的場地）還原回來
    .filter(f => /^\d+.*\.sql$/i.test(f) && !/seed/i.test(f))
    .sort();
  for (const file of files) {
    const fp = path.join(migrDir, file);
    const stmts = fs.readFileSync(fp, 'utf8')
      .split(';')
      .map(s => s.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').trim())
      .filter(s => s);
    for (const sql of stmts) {
      try { await conn.query(sql); }
      catch(e) { if (!IGNORABLE.has(e.code)) console.warn(`[Migration] ${file}: ${e.message}`); }
    }
  }
  await conn.end();
  console.log('✅ Migration 完成');
}

async function start() {
  await testConnection();
  try { await runMigrationsOnStart(); } catch(e) { console.error('[Migration 失敗]', e.message); }
  // 將 .env 中的鎖定時間同步寫入 DB（DB 值優先，只在 DB 無設定時寫入）
  try {
    const { pool } = require('./config/database');
    const [[row]] = await pool.query(
      "SELECT key_value FROM settings WHERE key_name='booking_lock_minutes'"
    );
    if (!row) {
      const envVal = process.env.BOOKING_LOCK_MINUTES || '2880';
      await pool.query(
        "INSERT INTO settings (key_name, key_value) VALUES ('booking_lock_minutes', ?) ON DUPLICATE KEY UPDATE key_value=key_value",
        [envVal]
      );
    }
  } catch(e) { /* 同步失敗不影響啟動 */ }
  scheduler.init();
  const server = app.listen(PORT, () => {
    console.log(`🚀 LightForm Studio API 啟動於 http://localhost:${PORT}`);
    console.log(`📅 環境: ${process.env.NODE_ENV || 'development'}`);
  });

  // ─── Graceful Shutdown ─────────────────────────────
  const shutdown = (signal) => {
    console.log(`[${signal}] 收到關閉信號，等待現有請求完成...`);
    server.close(async () => {
      try {
        const { pool } = require('./config/database');
        await pool.end();
        console.log('[Shutdown] DB 連線已關閉');
      } catch (e) { /* 靜默 */ }
      process.exit(0);
    });
    // 超過 10 秒強制退出
    setTimeout(() => { console.error('[Shutdown] 逾時強制退出'); process.exit(1); }, 10_000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

start().catch(err => {
  console.error('啟動失敗:', err);
  process.exit(1);
});

module.exports = app;
