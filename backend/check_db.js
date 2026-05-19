/**
 * 快速診斷腳本：確認 DB 連線與欄位是否正確
 * 執行方式: node check_db.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function check() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'studio_booking',
  });

  console.log('✅ 資料庫連線成功\n');

  // 檢查 studios 欄位
  const [cols] = await conn.query('SHOW COLUMNS FROM studios');
  const colNames = cols.map(c => c.Field);
  console.log('📋 studios 欄位列表:');
  colNames.forEach(c => console.log('  -', c));

  const required = ['photo_rate', 'video_rate'];
  console.log('\n🔍 必要欄位檢查:');
  required.forEach(c => {
    console.log(`  ${colNames.includes(c) ? '✅' : '❌'} ${c}`);
  });

  // 檢查 promotions 表
  const [tables] = await conn.query("SHOW TABLES LIKE 'promotions'");
  console.log(`\n🔍 promotions 資料表: ${tables.length ? '✅ 存在' : '❌ 不存在'}`);

  await conn.end();
}

check().catch(err => {
  console.error('❌ 連線失敗:', err.message);
  process.exit(1);
});
