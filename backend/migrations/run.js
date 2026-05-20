/**
 * 資料庫 Migration 執行腳本
 * 執行方式: node migrations/run.js
 */
require('dotenv').config();
const fs    = require('fs');
const path  = require('path');
const mysql = require('mysql2/promise');

// 可安全忽略的 MySQL 錯誤代碼
const IGNORABLE = new Set([
  'ER_DUP_FIELDNAME',   // 欄位已存在
  'ER_TABLE_EXISTS_ERROR', // 表格已存在（schema 重跑時）
]);

async function runMigrations() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'studio_booking',
    multipleStatements: false   // 逐條執行，方便逐條攔截錯誤
  });

  const files = [
    '001_schema.sql',
    '002_seed.sql',
    '003_studio_images.sql',
    '004_appearance.sql',
    '005_studio_rates.sql',
    '006_promotions.sql',
    '007_ttlock.sql',
  ];

  try {
    for (const file of files) {
      const filePath = path.join(__dirname, file);
      if (!fs.existsSync(filePath)) { console.log(`跳過（檔案不存在）: ${file}`); continue; }

      console.log(`\n執行: ${file}`);
      const raw = fs.readFileSync(filePath, 'utf8');

      // 拆分成單條 SQL（去除空行與純註解行）
      const statements = raw
        .split(';')
        .map(s => s.trim())
        .filter(s => s && !s.startsWith('--'));

      let ok = 0, skipped = 0;
      for (const sql of statements) {
        try {
          await conn.query(sql);
          ok++;
        } catch (err) {
          if (IGNORABLE.has(err.code)) {
            console.log(`  ⚠️  略過（${err.code}）: ${sql.slice(0, 60)}...`);
            skipped++;
          } else {
            throw err;   // 其他錯誤仍然終止
          }
        }
      }
      console.log(`✅ 完成: ${file}（${ok} 條執行，${skipped} 條略過）`);
    }
    console.log('\n✅ 所有 Migration 執行完畢！');
  } catch (err) {
    console.error('❌ Migration 失敗:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

runMigrations();
