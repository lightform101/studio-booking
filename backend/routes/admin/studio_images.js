/**
 * 後台：場地照片管理 Routes
 * POST   /api/admin/studios/:id/images        上傳照片（最多10張）
 * GET    /api/admin/studios/:id/images        取得該場地所有照片
 * PUT    /api/admin/images/:imageId/main      設為主圖
 * PUT    /api/admin/images/:imageId/alt       更新說明文字
 * PUT    /api/admin/studios/:id/images/sort   調整排序
 * DELETE /api/admin/images/:imageId           刪除照片
 */
const router = require('express').Router({ mergeParams: true });
const path   = require('path');
const fs     = require('fs');
const multer = require('multer');
const sharp  = require('sharp');
const auth   = require('../../middleware/auth');
const { pool } = require('../../config/database');

router.use(auth);

// ─── Multer 設定 ─────────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '../../uploads/studios');
const TEMP_DIR   = path.join(__dirname, '../../uploads/tmp');

// 確保資料夾存在
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(TEMP_DIR))   fs.mkdirSync(TEMP_DIR,   { recursive: true });

// 先存到 tmp，後續用 sharp 壓縮再移到正式目錄
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TEMP_DIR),
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `tmp_${req.params.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`;
    cb(null, name);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('僅支援 JPG / PNG / WEBP / GIF 格式'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

// ─── 取得場地所有照片 ───────────────────────────────────────────────────────────
router.get('/:id/images', async (req, res, next) => {
  try {
    const [images] = await pool.query(
      'SELECT * FROM studio_images WHERE studio_id=? ORDER BY sort_order ASC, id ASC',
      [req.params.id]
    );
    res.json({ success: true, data: images });
  } catch (err) { next(err); }
});

// ─── 上傳照片（支援多張，最多10張） ────────────────────────────────────────────
router.post('/:id/images', upload.array('images', 10), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: '請選擇要上傳的圖片' });
    }

    const studioId = req.params.id;

    // 取得目前最大 sort_order
    const [[maxRow]] = await pool.query(
      'SELECT IFNULL(MAX(sort_order),0) as max_sort FROM studio_images WHERE studio_id=?',
      [studioId]
    );
    let sortBase = (maxRow.max_sort || 0) + 1;

    // 是否有已存在的主圖
    const [[mainRow]] = await pool.query(
      'SELECT id FROM studio_images WHERE studio_id=? AND is_main=TRUE LIMIT 1',
      [studioId]
    );
    const hasMain = !!mainRow;

    const inserted = [];
    for (let i = 0; i < req.files.length; i++) {
      const file   = req.files[i];
      const isMain = (!hasMain && i === 0);

      // ─── 用 sharp 壓縮並轉為 JPEG（最寬 1920px，品質 82）───
      const outName = `studio_${studioId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;
      const outPath = path.join(UPLOAD_DIR, outName);
      try {
        await sharp(file.path)
          .rotate()                          // 自動依 EXIF 旋轉
          .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82, progressive: true })
          .toFile(outPath);
      } catch (sharpErr) {
        fs.unlink(file.path, () => {});
        return res.status(400).json({ success: false, message: '圖片處理失敗，請確認檔案格式是否正確' });
      } finally {
        // 刪除暫存原檔
        fs.unlink(file.path, () => {});
      }

      const outStat = fs.existsSync(outPath) ? fs.statSync(outPath).size : file.size;
      const url     = `/uploads/studios/${outName}`;
      const [result] = await pool.query(
        `INSERT INTO studio_images (studio_id, filename, original, url, alt_text, sort_order, is_main, file_size)
         VALUES (?,?,?,?,?,?,?,?)`,
        [studioId, outName, file.originalname, url,
         req.body.alt_text || null, sortBase + i, isMain, outStat]
      );
      inserted.push({ id: result.insertId, url, is_main: isMain });
    }

    res.status(201).json({
      success: true,
      message: `成功上傳 ${inserted.length} 張照片`,
      data: inserted
    });
  } catch (err) { next(err); }
});

// ─── 設為主圖 ──────────────────────────────────────────────────────────────────
router.put('/images/:imageId/main', async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[img]] = await conn.query('SELECT * FROM studio_images WHERE id=?', [req.params.imageId]);
    if (!img) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: '找不到此照片' });
    }
    // 先取消同場地舊主圖，再設定新主圖（同一 transaction 確保不會有空白期）
    await conn.query('UPDATE studio_images SET is_main=FALSE WHERE studio_id=?', [img.studio_id]);
    await conn.query('UPDATE studio_images SET is_main=TRUE WHERE id=?', [req.params.imageId]);
    await conn.commit();
    res.json({ success: true, message: '已設為主圖' });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// ─── 更新圖片說明 ──────────────────────────────────────────────────────────────
router.put('/images/:imageId/alt', async (req, res, next) => {
  try {
    await pool.query(
      'UPDATE studio_images SET alt_text=? WHERE id=?',
      [req.body.alt_text || null, req.params.imageId]
    );
    res.json({ success: true, message: '已更新說明' });
  } catch (err) { next(err); }
});

// ─── 調整排序 ──────────────────────────────────────────────────────────────────
// body: { order: [{ id, sort_order }, ...] }
router.put('/:id/images/sort', async (req, res, next) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) {
      return res.status(400).json({ success: false, message: 'order 必須為陣列' });
    }
    for (const item of order) {
      await pool.query(
        'UPDATE studio_images SET sort_order=? WHERE id=? AND studio_id=?',
        [item.sort_order, item.id, req.params.id]
      );
    }
    res.json({ success: true, message: '排序已更新' });
  } catch (err) { next(err); }
});

// ─── 刪除照片 ──────────────────────────────────────────────────────────────────
router.delete('/images/:imageId', async (req, res, next) => {
  try {
    const [[img]] = await pool.query('SELECT * FROM studio_images WHERE id=?', [req.params.imageId]);
    if (!img) return res.status(404).json({ success: false, message: '找不到此照片' });

    // 刪除實體檔案
    const filePath = path.join(UPLOAD_DIR, img.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // 刪除資料庫記錄
    await pool.query('DELETE FROM studio_images WHERE id=?', [req.params.imageId]);

    // 如果刪的是主圖，自動把下一張設為主圖
    if (img.is_main) {
      const [[next]] = await pool.query(
        'SELECT id FROM studio_images WHERE studio_id=? ORDER BY sort_order ASC LIMIT 1',
        [img.studio_id]
      );
      if (next) {
        await pool.query('UPDATE studio_images SET is_main=TRUE WHERE id=?', [next.id]);
      }
    }

    res.json({ success: true, message: '照片已刪除' });
  } catch (err) { next(err); }
});

module.exports = router;
