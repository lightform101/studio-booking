/**
 * 外觀設定 Routes
 * GET  /api/appearance              公開 API，前台讀取外觀設定
 * POST /api/appearance/upload/:type 後台上傳背景/Banner 圖片（需登入）
 * DELETE /api/appearance/image/:type 後台刪除圖片（需登入）
 */
const router   = require('express').Router();
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const auth     = require('../middleware/auth');
const { pool } = require('../config/database');

// ─── 允許的圖片類型 ──────────────────────────────
const ALLOWED_TYPES = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const UPLOAD_DIR    = path.join(__dirname, '../uploads/appearance');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ─── Multer 設定 ─────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const type = req.params.type || 'image';
    cb(null, `${type}_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    ALLOWED_TYPES.includes(ext) ? cb(null, true) : cb(new Error('僅支援 JPG/PNG/WEBP/GIF'));
  },
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB（Banner 圖通常較大）
});

// ─── 外觀設定鍵名白名單（前台可讀取）────────────────
const PUBLIC_KEYS = [
  'theme_primary', 'theme_accent', 'theme_gold',
  'theme_bg', 'theme_card_bg', 'theme_text',
  'theme_font', 'theme_border_radius', 'theme_font_size',
  'site_name', 'site_tagline',
  'hero_title', 'hero_subtitle',
  'nav_show_phone', 'site_phone', 'site_email',
  // 圖片設定
  'hero_bg_image',      // Hero 背景圖片 URL
  'hero_bg_overlay',    // Hero 遮罩透明度 0–90
  'banner_image',       // 頂部 Banner 圖片 URL
  'banner_link',        // Banner 點擊連結
  'banner_show',        // Banner 是否顯示
  'page_bg_image',      // 頁面背景圖片 URL
  'page_bg_style',      // 頁面背景樣式：cover / repeat / fixed
  // 頁面內容
  'page_flow',          // 預約流程步驟 JSON
  'page_notes',         // 預約須知 JSON
  'page_faq',           // 常見問題 JSON
  'contact_phone',      // 聯絡電話
  'contact_email',      // 聯絡 Email
  'contact_address',    // 地址
  'contact_hours',      // 服務時間
  'contact_line',       // LINE ID
  'contact_ig'          // Instagram
];

// ─── GET 公開外觀設定 ─────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const placeholders = PUBLIC_KEYS.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT key_name, key_value FROM settings WHERE key_name IN (${placeholders})`,
      PUBLIC_KEYS
    );
    const data = {};
    rows.forEach(r => { data[r.key_name] = r.key_value; });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// ─── POST 上傳圖片（需登入）──────────────────────
// type: hero_bg | banner | page_bg
router.post('/upload/:type', auth, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '請選擇圖片' });

    const type    = req.params.type;
    const url     = `/uploads/appearance/${req.file.filename}`;
    const keyMap  = {
      hero_bg:  'hero_bg_image',
      banner:   'banner_image',
      page_bg:  'page_bg_image'
    };
    const key = keyMap[type];
    if (!key) return res.status(400).json({ success: false, message: '不支援的圖片類型' });

    // 刪除舊圖片檔案（normalize 後限制在 /uploads 目錄內）
    const [[old]] = await pool.query('SELECT key_value FROM settings WHERE key_name=?', [key]);
    if (old?.key_value) {
      const allowedDir = path.resolve(path.join(__dirname, '..', 'uploads'));
      const resolved   = path.resolve(path.join(__dirname, '..', old.key_value));
      if (resolved.startsWith(allowedDir + path.sep)) {
        if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
      }
    }

    // 存入資料庫
    await pool.query(
      'INSERT INTO settings (key_name, key_value) VALUES (?,?) ON DUPLICATE KEY UPDATE key_value=?',
      [key, url, url]
    );

    res.json({ success: true, url, message: '圖片上傳成功' });
  } catch (err) { next(err); }
});

// ─── DELETE 刪除圖片（需登入）────────────────────
router.delete('/image/:type', auth, async (req, res, next) => {
  try {
    const keyMap = {
      hero_bg: 'hero_bg_image',
      banner:  'banner_image',
      page_bg: 'page_bg_image'
    };
    const key = keyMap[req.params.type];
    if (!key) return res.status(400).json({ success: false, message: '不支援的類型' });

    const [[row]] = await pool.query('SELECT key_value FROM settings WHERE key_name=?', [key]);
    if (row?.key_value) {
      const normalized = path.normalize(row.key_value);
      if (normalized.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, '..', normalized);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }
    await pool.query(
      'INSERT INTO settings (key_name, key_value) VALUES (?,?) ON DUPLICATE KEY UPDATE key_value=?',
      [key, '', '']
    );
    res.json({ success: true, message: '圖片已移除' });
  } catch (err) { next(err); }
});

module.exports = router;
