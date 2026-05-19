/**
 * MySQL 資料庫連線池設定
 */
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  // 同時支援自訂變數（DB_*）與 Zeabur MySQL Plugin 注入的變數（MYSQL_*）
  host:               process.env.DB_HOST     || process.env.MYSQL_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || process.env.MYSQL_PORT) || 3306,
  database:           process.env.DB_NAME     || process.env.MYSQL_DATABASE  || 'studio_booking',
  user:               process.env.DB_USER     || process.env.MYSQL_USERNAME  || 'root',
  password:           process.env.DB_PASS     || process.env.MYSQL_PASSWORD  || '',
  waitForConnections: true,
  connectionLimit:    parseInt(process.env.DB_POOL_MAX) || 10,
  queueLimit:         0,
  charset:            'utf8mb4',
  timezone:           '+08:00',
  dateStrings:        true,       // DATE/DATETIME 以字串返回，避免時區轉換後日期往前一天
  namedPlaceholders:  true
});

// 測試連線
async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log('✅ 資料庫連線成功');
    conn.release();
  } catch (err) {
    console.error('❌ 資料庫連線失敗:', err.message);
    process.exit(1);
  }
}

module.exports = { pool, testConnection };
