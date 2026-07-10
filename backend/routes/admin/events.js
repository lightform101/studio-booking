/**
 * 後台：活動專區管理
 * GET    /api/admin/events          取得所有活動
 * POST   /api/admin/events          新增（主圖 + 說明附圖 + 影片外連）
 * PUT    /api/admin/events/:id      更新
 * DELETE /api/admin/events/:id      刪除（含所有圖片檔）
 */
const router   = require('express').Router();
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const auth     = require('../../middleware/auth');
const { pool } = require('../../config/database');

const ALLOWED_TYPES  = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const GALLERY_MAX     = 1 * 1024 * 1024;   // 說明附圖每張上限 1MB
const UPLOAD_DIR      = path.join(__dirname, '../../uploads/events');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `event_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    ALLOWED_TYPES.includes(ext) ? cb(null, true) : cb(new Error('僅支援 JPG/PNG/WEBP/GIF'));
  },
  limits: { fileSize: 20 * 1024 * 1024 } // 主圖上限（附圖另在下方檢查 1MB）
}).fields([
  { name: 'image',   maxCount: 1 },
  { name: 'gallery', maxCount: 10 },
]);

const VALID_CATEGORIES = ['course', 'promo', 'talk', 'other'];

// 檢查附圖大小（每張 ≤1MB），超過則刪除本次所有上傳檔並回傳錯誤訊息
function checkGallerySize(files) {
  const gallery = (files && files.gallery) || [];
  for (const f of gallery) {
    if (f.size > GALLERY_MAX) return `說明附圖「${f.originalname}」超過 1MB，請壓縮後再上傳`;
  }
  return null;
}
function cleanupUploaded(files) {
  ['image', 'gallery'].forEach(k => {
    (files && files[k] || []).forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
  });
}

router.use(auth);

// 取得全部
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM events ORDER BY sort_order ASC, id DESC');
    rows.forEach(r => { try { r.gallery = r.gallery ? JSON.parse(r.gallery) : []; } catch { r.gallery = []; } });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// 新增
router.post('/', upload, async (req, res) => {
  try {
    const sizeErr = checkGallerySize(req.files);
    if (sizeErr) { cleanupUploaded(req.files); return res.status(400).json({ success: false, message: sizeErr }); }

    const { title, category, description, event_date, date_note, capacity, price, video_url, link_url, link_label, sort_order } = req.body;
    if (!title) { cleanupUploaded(req.files); return res.status(400).json({ success: false, message: '請輸入活動標題' }); }

    const image_url = req.files?.image?.[0] ? `/uploads/events/${req.files.image[0].filename}` : null;
    const gallery   = (req.files?.gallery || []).map(f => `/uploads/events/${f.filename}`);
    const cat = VALID_CATEGORIES.includes(category) ? category : 'other';

    const [result] = await pool.query(
      `INSERT INTO events
         (title, category, description, image_url, gallery, video_url,
          event_date, date_note, capacity, price, link_url, link_label, sort_order, is_active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      [
        title.trim(), cat,
        description || null,
        image_url,
        gallery.length ? JSON.stringify(gallery) : null,
        video_url || null,
        event_date || null,
        date_note || null,
        (capacity !== undefined && capacity !== '') ? parseInt(capacity) : null,
        (price !== undefined && price !== '') ? parseInt(price) : null,
        link_url || null,
        link_label || null,
        parseInt(sort_order) || 0
      ]
    );
    res.json({ success: true, data: { id: result.insertId }, message: '活動已新增' });
  } catch (err) {
    cleanupUploaded(req.files);
    res.status(500).json({ success: false, message: `新增失敗：${err.sqlMessage || err.message}` });
  }
});

// 更新
router.put('/:id', upload, async (req, res) => {
  try {
    const [[row]] = await pool.query('SELECT image_url, gallery FROM events WHERE id=?', [req.params.id]);
    if (!row) { cleanupUploaded(req.files); return res.status(404).json({ success: false, message: '找不到此活動' }); }

    const sizeErr = checkGallerySize(req.files);
    if (sizeErr) { cleanupUploaded(req.files); return res.status(400).json({ success: false, message: sizeErr }); }

    const { title, category, description, event_date, date_note, capacity, price, video_url, link_url, link_label, sort_order, is_active, keep_gallery } = req.body;
    if (!title) { cleanupUploaded(req.files); return res.status(400).json({ success: false, message: '請輸入活動標題' }); }
    const cat = VALID_CATEGORIES.includes(category) ? category : 'other';

    // 主圖：有上傳新圖才換，並刪舊
    let image_url = row.image_url;
    if (req.files?.image?.[0]) {
      image_url = `/uploads/events/${req.files.image[0].filename}`;
      deleteUploadFile(row.image_url);
    }

    // 附圖：保留前端指定要留的（keep_gallery），加上本次新上傳的；被移除的檔案刪除
    const oldGallery = (() => { try { return row.gallery ? JSON.parse(row.gallery) : []; } catch { return []; } })();
    let keep = [];
    try { keep = keep_gallery ? JSON.parse(keep_gallery) : oldGallery; } catch { keep = oldGallery; }
    const newUploaded = (req.files?.gallery || []).map(f => `/uploads/events/${f.filename}`);
    const finalGallery = [...keep.filter(u => oldGallery.includes(u)), ...newUploaded];
    // 刪除被移除的舊附圖檔
    oldGallery.filter(u => !keep.includes(u)).forEach(deleteUploadFile);

    await pool.query(
      `UPDATE events SET
         title=?, category=?, description=?, image_url=?, gallery=?, video_url=?,
         event_date=?, date_note=?, capacity=?, price=?, link_url=?, link_label=?,
         sort_order=?, is_active=?
       WHERE id=?`,
      [
        title.trim(), cat,
        description || null,
        image_url,
        finalGallery.length ? JSON.stringify(finalGallery) : null,
        video_url || null,
        event_date || null,
        date_note || null,
        (capacity !== undefined && capacity !== '') ? parseInt(capacity) : null,
        (price !== undefined && price !== '') ? parseInt(price) : null,
        link_url || null,
        link_label || null,
        parseInt(sort_order) || 0,
        (is_active === '0' || is_active === 0 || is_active === false || is_active === 'false') ? 0 : 1,
        req.params.id
      ]
    );
    res.json({ success: true, message: '活動已更新' });
  } catch (err) {
    cleanupUploaded(req.files);
    res.status(500).json({ success: false, message: `更新失敗：${err.sqlMessage || err.message}` });
  }
});

// 刪除（含所有圖片檔）
router.delete('/:id', async (req, res, next) => {
  try {
    const [[row]] = await pool.query('SELECT image_url, gallery FROM events WHERE id=?', [req.params.id]);
    if (!row) return res.status(404).json({ success: false, message: '找不到此活動' });

    await pool.query('DELETE FROM events WHERE id=?', [req.params.id]);
    deleteUploadFile(row.image_url);
    try { (row.gallery ? JSON.parse(row.gallery) : []).forEach(deleteUploadFile); } catch {}
    res.json({ success: true, message: '活動已刪除' });
  } catch (err) { next(err); }
});

// 安全刪除 uploads 內的檔案
function deleteUploadFile(url) {
  if (!url) return;
  try {
    const allowedDir = path.resolve(path.join(__dirname, '..', '..', 'uploads'));
    const filePath   = path.resolve(path.join(__dirname, '..', '..', String(url).replace(/^\//, '')));
    if (filePath.startsWith(allowedDir) && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) { /* 檔案刪除失敗不影響 */ }
}

module.exports = router;
