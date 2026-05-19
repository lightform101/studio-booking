/**
 * 資料庫修補腳本 — 補齊缺少的欄位與資料表
 * 執行方式: node fix_db.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function fix() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'studio_booking',
  });

  console.log('✅ 資料庫連線成功\n');

  // 1. 補 photo_rate 欄位
  try {
    await conn.query('ALTER TABLE studios ADD COLUMN photo_rate DECIMAL(10,2) NULL COMMENT "平面攝影費率"');
    console.log('✅ 新增欄位 photo_rate');
  } catch(e) {
    if (e.code === 'ER_DUP_FIELDNAME') console.log('⚠️  photo_rate 已存在，略過');
    else throw e;
  }

  // 2. 確認 video_rate（已存在就略過）
  try {
    await conn.query('ALTER TABLE studios ADD COLUMN video_rate DECIMAL(10,2) NULL COMMENT "動態攝影費率"');
    console.log('✅ 新增欄位 video_rate');
  } catch(e) {
    if (e.code === 'ER_DUP_FIELDNAME') console.log('⚠️  video_rate 已存在，略過');
    else throw e;
  }

  // 3. 建立 promotions 資料表
  await conn.query(`
    CREATE TABLE IF NOT EXISTS promotions (
      id            INT PRIMARY KEY AUTO_INCREMENT,
      name          VARCHAR(100) NOT NULL,
      description   TEXT,
      discount_type ENUM('percent','fixed','schedule') NOT NULL,
      discount_value DECIMAL(10,2) NOT NULL,
      min_hours     INT DEFAULT 1,
      studio_id     INT NULL,
      promo_code    VARCHAR(50) NULL,
      applicable_days VARCHAR(20) NULL,
      start_hour    TINYINT NULL,
      end_hour      TINYINT NULL,
      valid_from    DATE NULL,
      valid_to      DATE NULL,
      is_active     BOOLEAN DEFAULT TRUE,
      sort_order    INT DEFAULT 0,
      created_at    DATETIME DEFAULT NOW(),
      updated_at    DATETIME DEFAULT NOW() ON UPDATE NOW(),
      FOREIGN KEY (studio_id) REFERENCES studios(id) ON DELETE SET NULL
    )
  `);
  console.log('✅ promotions 資料表已建立（或已存在）');

  // 4. 最終確認
  const [cols] = await conn.query('SHOW COLUMNS FROM studios');
  const colNames = cols.map(c => c.Field);
  const [tables] = await conn.query("SHOW TABLES LIKE 'promotions'");

  console.log('\n📋 最終確認:');
  console.log(`  photo_rate : ${colNames.includes('photo_rate') ? '✅' : '❌'}`);
  console.log(`  video_rate : ${colNames.includes('video_rate') ? '✅' : '❌'}`);
  console.log(`  promotions : ${tables.length ? '✅' : '❌'}`);

  await conn.end();
  console.log('\n✅ 修補完成，請重啟伺服器：node server.js');
}

fix().catch(err => {
  console.error('❌ 修補失敗:', err.message);
  process.exit(1);
});
