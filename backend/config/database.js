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

// 測試連線（自動重試，最多 5 次，每次間隔 3 秒）
async function testConnection(retries = 5, delay = 3000) {
  for (let i = 1; i <= retries; i++) {
    try {
      const conn = await pool.getConnection();
      console.log('✅ 資料庫連線成功');
      conn.release();
      return;
    } catch (err) {
      console.error(`❌ 資料庫連線失敗 (第 ${i}/${retries} 次): ${err.message}`);
      if (i < retries) {
        console.log(`⏳ ${delay / 1000} 秒後重試...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.error('❌ 無法連線至資料庫，伺服器啟動失敗');
        process.exit(1);
      }
    }
  }
}

module.exports = { pool, testConnection };
